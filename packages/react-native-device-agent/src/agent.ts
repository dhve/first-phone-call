import { LlamaEngine } from './llama';
import { ToolRegistry } from './toolRegistry';
import type {
  AgentEvent,
  AgentEventHandler,
  ChatMessage,
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
}

export interface RunOptions {
  signal?: AbortSignal;
  onEvent?: AgentEventHandler;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful on-device assistant. You can call tools to take actions ' +
  'or fetch information. Only call a tool when it genuinely helps; otherwise ' +
  'answer directly. After a tool returns, use its result to respond to the user.';

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
  private history: ChatMessage[] = [];

  constructor(options: AgentOptions) {
    this.engine = options.engine;
    this.registry = options.registry ?? new ToolRegistry();
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.maxSteps = options.maxSteps ?? 8;
    this.temperature = options.temperature ?? 0.7;
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
    const ctx: ToolContext = { signal: runOptions.signal, scratch: {} };
    const specs = this.registry.toSpecs();

    this.history.push({ role: 'user', content: userMessage });

    for (let step = 0; step < this.maxSteps; step++) {
      if (runOptions.signal?.aborted) {
        emit({ type: 'error', error: 'aborted' });
        throw new DOMException('Agent run aborted', 'AbortError');
      }
      emit({ type: 'step', index: step });

      const { content, toolCalls } = await this.engine.chat(this.history, {
        tools: specs.length ? specs : undefined,
        temperature: this.temperature,
        onToken: (text) => emit({ type: 'token', text }),
      });

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
          content: JSON.stringify(error ? { error } : (result ?? null)),
        });
      }
    }

    const msg = `Reached maxSteps (${this.maxSteps}) without a final answer.`;
    emit({ type: 'error', error: msg });
    return msg;
  }
}
