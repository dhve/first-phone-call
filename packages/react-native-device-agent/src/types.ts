/**
 * Core type contracts for the device-agent harness.
 *
 * These are intentionally framework-agnostic: a `Tool` is just a described
 * async function, and the agent loop only depends on these shapes (not on
 * llama.rn directly), so the harness stays testable and portable.
 */

/** A minimal JSON-Schema object describing a tool's parameters. */
export interface JSONSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: unknown[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  [key: string]: unknown;
}

/** Context handed to every tool invocation. */
export interface ToolContext {
  /** AbortSignal that fires if the agent run is cancelled. */
  signal?: AbortSignal;
  /** Free-form per-run state the app can read/write across tool calls. */
  scratch: Record<string, unknown>;
}

/**
 * A tool the model can call. `execute` receives validated arguments and
 * returns any JSON-serializable result, which is fed back to the model.
 */
export interface Tool<TArgs = any, TResult = any> {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (args: TArgs, ctx: ToolContext) => Promise<TResult> | TResult;
}

/** OpenAI-style tool descriptor passed to the model. */
export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant messages that requested tool calls. */
  tool_calls?: ToolCall[];
  /** Present on tool-result messages: which call this answers. */
  tool_call_id?: string;
  /** Human/tool name (for tool-role messages). */
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** Raw JSON string of arguments, as emitted by the model. */
    arguments: string;
  };
}

/** Events emitted during an agent run so UIs can render the loop live. */
export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'assistant_message'; content: string; toolCalls?: ToolCall[] }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; callId: string; name: string; result: unknown; error?: string }
  | { type: 'step'; index: number }
  | { type: 'final'; content: string }
  /** Terminal: the run was cancelled via its AbortSignal. */
  | { type: 'cancelled' }
  /** Terminal: `maxSteps` iterations elapsed without a final answer. */
  | { type: 'max_steps'; steps: number }
  | { type: 'error'; error: string };

export type AgentEventHandler = (event: AgentEvent) => void;
