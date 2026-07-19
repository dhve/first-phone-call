import { initLlama } from 'llama.rn';
import type { ChatMessage, ToolCall, ToolSpec } from './types';

/** Options for loading a GGUF model into a llama.rn context. */
export interface LlamaLoadOptions {
  /** Absolute file path or `file://` URI to a .gguf model. */
  model: string;
  /** Context window size (tokens). Default 4096. */
  n_ctx?: number;
  /** Layers to offload to GPU (Metal/OpenCL). 99 = all. Default 99. */
  n_gpu_layers?: number;
  /** Pin model in RAM to avoid swap. Default true. */
  use_mlock?: boolean;
  /** Extra llama.rn init params passed through verbatim. */
  extra?: Record<string, unknown>;
}

export interface ChatOptions {
  tools?: ToolSpec[];
  /** 'auto' (default), 'none', or 'required'. */
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
  n_predict?: number;
  stop?: string[];
  /**
   * Whether the chat template may open a reasoning (<think>) block. llama.rn
   * defaults this to true; hybrid-reasoning models like Qwen3.5 then spend
   * the whole n_predict budget thinking and never emit a visible answer.
   */
  enableThinking?: boolean;
  /**
   * Abort signal for this completion. When it fires, the active llama.rn
   * completion is stopped and `chat()` rejects with an `AbortError`.
   */
  signal?: AbortSignal;
  /** Streaming callback for each generated token of the visible text. */
  onToken?: (text: string) => void;
}

export interface ChatResult {
  content: string;
  toolCalls?: ToolCall[];
}

/**
 * Thin, replaceable wrapper around a llama.rn context.
 *
 * Everything llama.rn-specific lives here; the rest of the harness talks to the
 * `LlamaEngine` interface only, so swapping inference backends later is local.
 */
export class LlamaEngine {
  private ctx: Awaited<ReturnType<typeof initLlama>> | null = null;
  private ctxSize = 4096;

  get isLoaded(): boolean {
    return this.ctx !== null;
  }

  /** Context window size (n_ctx) the model was loaded with. */
  get contextSize(): number {
    return this.ctxSize;
  }

  static async load(options: LlamaLoadOptions): Promise<LlamaEngine> {
    const engine = new LlamaEngine();
    await engine.loadModel(options);
    return engine;
  }

  async loadModel(options: LlamaLoadOptions): Promise<void> {
    if (this.ctx) await this.release();
    this.ctxSize = options.n_ctx ?? 4096;
    this.ctx = await initLlama({
      model: options.model,
      n_ctx: this.ctxSize,
      n_gpu_layers: options.n_gpu_layers ?? 99,
      use_mlock: options.use_mlock ?? true,
      ...(options.extra ?? {}),
    });
  }

  /**
   * Stop the active completion, if any. Safe to call at any time; the
   * in-flight `chat()` settles promptly with whatever was generated so far.
   */
  async stop(): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.ctx.stopCompletion();
    } catch {
      // No active completion (or the context is tearing down); nothing to stop.
    }
  }

  /**
   * Run one chat turn. When `tools` are provided we enable the jinja chat
   * template so the model's native tool-calling format is parsed for us.
   */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    if (!this.ctx) throw new Error('Model not loaded. Call loadModel() first.');
    throwIfAborted(options.signal);

    const onAbort = () => {
      void this.stop();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const hasTools = !!options.tools?.length;
      const result: any = await this.ctx.completion(
        {
          messages,
          // jinja unconditionally: enable_thinking is a jinja template kwarg,
          // so on the legacy template path it is silently ignored — which
          // left Qwen3.5 thinking through its whole token budget and
          // returning empty answers on the no-tools path.
          jinja: true,
          ...(hasTools
            ? { tools: options.tools, tool_choice: options.toolChoice ?? 'auto' }
            : {}),
          temperature: options.temperature ?? 0.7,
          n_predict: options.n_predict ?? 512,
          stop: options.stop,
          enable_thinking: options.enableThinking ?? true,
        },
        (data: { token?: string }) => {
          if (options.onToken && typeof data?.token === 'string') options.onToken(data.token);
        },
      );
      // A stopped completion resolves with partial output; surface the abort.
      throwIfAborted(options.signal);

      return {
        content: (result?.content ?? result?.text ?? '').trim(),
        toolCalls: normalizeToolCalls(result?.tool_calls),
      };
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  async release(): Promise<void> {
    if (this.ctx) {
      await this.ctx.release();
      this.ctx = null;
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (typeof DOMException === 'function') {
    throw new DOMException('Completion aborted', 'AbortError');
  }
  const err = new Error('Completion aborted');
  err.name = 'AbortError';
  throw err;
}

/** llama.rn may omit call ids; normalize into our ToolCall shape. */
function normalizeToolCalls(raw: unknown): ToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((c: any, i: number) => {
    const args = c?.function?.arguments;
    return {
      id: c?.id ?? `call_${i}`,
      type: 'function' as const,
      function: {
        name: c?.function?.name ?? c?.name ?? 'unknown',
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      },
    };
  });
}
