import { LlamaEngine } from './llama';
import { ToolRegistry } from './toolRegistry';
import type {
  AgentEvent,
  AgentEventHandler,
  ChatMessage,
  ToolCall,
  ToolContext,
} from './types';

export interface AgentOptions {
  engine: LlamaEngine;
  registry?: ToolRegistry;
  /** Prepended as the system message for every run. */
  systemPrompt?: string;
  /** Safety cap on tool-call/think iterations per run. Default 8. */
  maxSteps?: number;
  temperature?: number;
  /** Per-completion generation cap (llama.rn n_predict). Default 512. */
  maxTokens?: number;
  /**
   * Token budget for the whole context window. Prompts are trimmed (oldest
   * turns first) to `contextTokens - maxTokens` before each completion.
   * Default: the engine's n_ctx.
   */
  contextTokens?: number;
  /** Chars-per-token heuristic used to estimate prompt size. Default 4. */
  charsPerToken?: number;
  /**
   * Cap on serialized tool-result characters fed back to the model; larger
   * results are cut and given an explicit truncation marker. Default 8000.
   */
  maxToolResultChars?: number;
}

export interface RunOptions {
  /**
   * Cancels the run: an active llama.rn completion is stopped via the engine
   * and `send()` rejects with an `AbortError` after a `cancelled` event.
   */
  signal?: AbortSignal;
  onEvent?: AgentEventHandler;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful on-device assistant. You can call tools to take actions ' +
  'or fetch information. Only call a tool when it genuinely helps; otherwise ' +
  'answer directly. After a tool returns, use its result to respond to the user.';

/** Rough per-message chat-template overhead (role tags, separators). */
const MESSAGE_TOKEN_OVERHEAD = 8;

/**
 * The harness: drives the think → call-tool → observe → repeat loop over a
 * {@link LlamaEngine}, executing tools from a {@link ToolRegistry} until the
 * model produces a final answer (or `maxSteps` is hit).
 *
 * Conversation state is held internally so a chat UI can call `send()`
 * repeatedly; use `reset()` to start a fresh conversation.
 */
export class Agent {
  private engine: LlamaEngine;
  private registry: ToolRegistry;
  private systemPrompt: string;
  private maxSteps: number;
  private temperature: number;
  private maxTokens: number;
  private contextTokens: number;
  private charsPerToken: number;
  private maxToolResultChars: number;
  private history: ChatMessage[] = [];

  constructor(options: AgentOptions) {
    this.engine = options.engine;
    this.registry = options.registry ?? new ToolRegistry();
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.maxSteps = options.maxSteps ?? 8;
    this.temperature = options.temperature ?? 0.7;
    this.maxTokens = options.maxTokens ?? 512;
    this.contextTokens = options.contextTokens ?? options.engine.contextSize;
    this.charsPerToken = options.charsPerToken ?? 4;
    this.maxToolResultChars = options.maxToolResultChars ?? 8000;
    if (this.contextTokens - this.maxTokens <= 0) {
      throw new Error(
        `contextTokens (${this.contextTokens}) must be larger than maxTokens ` +
          `(${this.maxTokens}) to leave room for the prompt`,
      );
    }
    this.history = [{ role: 'system', content: this.systemPrompt }];
  }

  get tools(): ToolRegistry {
    return this.registry;
  }

  /** Clear conversation history back to just the system prompt. */
  reset(): void {
    this.history = [{ role: 'system', content: this.systemPrompt }];
  }

  /** Current conversation transcript (system + turns), for inspection/UI. */
  get messages(): readonly ChatMessage[] {
    return this.history;
  }

  /**
   * Send a user message and run the agent loop to completion.
   * Returns the final assistant text; emits {@link AgentEvent}s along the way.
   */
  async send(userMessage: string, runOptions: RunOptions = {}): Promise<string> {
    const emit = (e: AgentEvent) => runOptions.onEvent?.(e);
    const signal = runOptions.signal;
    const ctx: ToolContext = { signal, scratch: {} };
    const specs = this.registry.toSpecs();

    const cancel = (): never => {
      emit({ type: 'cancelled' });
      throw abortError('Agent run aborted');
    };

    this.history.push({ role: 'user', content: userMessage });

    for (let step = 0; step < this.maxSteps; step++) {
      if (signal?.aborted) cancel();
      emit({ type: 'step', index: step });

      try {
        this.trimHistoryToContext();
      } catch (e) {
        emit({ type: 'error', error: (e as Error).message });
        throw e;
      }

      let content: string;
      let toolCalls: ToolCall[] | undefined;
      try {
        ({ content, toolCalls } = await this.engine.chat(this.history, {
          tools: specs.length ? specs : undefined,
          temperature: this.temperature,
          n_predict: this.maxTokens,
          signal,
          onToken: (text) => emit({ type: 'token', text }),
        }));
      } catch (e) {
        if (signal?.aborted || (e as Error)?.name === 'AbortError') cancel();
        emit({ type: 'error', error: (e as Error).message });
        throw e;
      }

      this.history.push({
        role: 'assistant',
        content,
        tool_calls: toolCalls,
      });
      emit({ type: 'assistant_message', content, toolCalls });

      // No tool calls → this is the final answer.
      if (!toolCalls || toolCalls.length === 0) {
        emit({ type: 'final', content });
        return content;
      }

      // Execute each requested tool and feed results back as tool messages.
      for (const call of toolCalls) {
        if (signal?.aborted) cancel();
        emit({ type: 'tool_call', call });
        const { result, error } = await this.registry.invoke(
          call.function.name,
          call.function.arguments,
          ctx,
        );
        emit({
          type: 'tool_result',
          callId: call.id,
          name: call.function.name,
          result,
          error,
        });
        this.history.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: this.renderToolContent(result, error),
        });
      }
    }

    const msg = `Reached maxSteps (${this.maxSteps}) without a final answer.`;
    emit({ type: 'max_steps', steps: this.maxSteps });
    return msg;
  }

  /**
   * Serialize a tool outcome for the model, enforcing `maxToolResultChars`.
   * Oversized payloads are cut and suffixed with an explicit marker so the
   * model knows it is looking at a truncated result.
   */
  private renderToolContent(result: unknown, error: string | undefined): string {
    const payload = error !== undefined ? { error } : result === undefined ? null : result;
    let content: string;
    try {
      content = JSON.stringify(payload) ?? 'null';
    } catch {
      content = String(payload);
    }
    if (content.length > this.maxToolResultChars) {
      const marker =
        `[truncated: tool result was ${content.length} chars, ` +
        `limit is ${this.maxToolResultChars}]`;
      content = content.slice(0, this.maxToolResultChars) + marker;
    }
    return content;
  }

  /**
   * Keep the prompt inside the context window: estimate tokens for the
   * current history and drop the oldest non-system messages until it fits
   * `contextTokens - maxTokens`. The system prompt and the current turn (last
   * user message onward) are never trimmed; if what remains still exceeds the
   * budget, throw a predictable error before the completion is attempted.
   */
  private trimHistoryToContext(): void {
    const budget = this.contextTokens - this.maxTokens;
    const total = () =>
      this.history.reduce((sum, m) => sum + estimateMessageTokens(m, this.charsPerToken), 0);
    const lastUserIndex = () => {
      for (let i = this.history.length - 1; i >= 0; i--) {
        if (this.history[i].role === 'user') return i;
      }
      return -1;
    };

    // Index 0 is the system prompt; index 1 is always the oldest trimmable
    // message while it sits before the current turn.
    while (total() > budget && lastUserIndex() > 1) {
      this.history.splice(1, 1);
      // Drop tool results whose assistant tool-call message was just trimmed,
      // so the transcript never starts with orphaned tool messages.
      while (this.history[1]?.role === 'tool' && lastUserIndex() > 1) {
        this.history.splice(1, 1);
      }
    }

    const estimated = total();
    if (estimated > budget) {
      throw new Error(
        `Context limit exceeded: the prompt is an estimated ${estimated} tokens but the ` +
          `budget is ${budget} (contextTokens ${this.contextTokens} minus maxTokens ` +
          `${this.maxTokens}), and no earlier turns remain to trim.`,
      );
    }
  }
}

function estimateMessageTokens(message: ChatMessage, charsPerToken: number): number {
  let chars = message.content.length;
  if (message.tool_calls) chars += JSON.stringify(message.tool_calls).length;
  return Math.ceil(chars / charsPerToken) + MESSAGE_TOKEN_OVERHEAD;
}

function abortError(message: string): Error {
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError');
  }
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}
