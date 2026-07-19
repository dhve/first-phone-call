import type { JSONSchema, Tool, ToolContext } from './types';

/**
 * Ergonomic helper for declaring a tool with inferred argument typing.
 *
 * @example
 * const echo = defineTool({
 *   name: 'echo',
 *   description: 'Echo a message back',
 *   parameters: {
 *     type: 'object',
 *     properties: { text: { type: 'string', description: 'what to echo' } },
 *     required: ['text'],
 *   },
 *   execute: ({ text }) => text,
 * });
 */
export function defineTool<TArgs = Record<string, unknown>, TResult = unknown>(spec: {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (args: TArgs, ctx: ToolContext) => Promise<TResult> | TResult;
}): Tool<TArgs, TResult> {
  return spec;
}
