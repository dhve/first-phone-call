import type { Tool, ToolSpec, ToolContext } from './types';

/**
 * Holds the set of tools available to an agent and dispatches calls to them.
 *
 * The registry is the core developer-facing API: apps call `register()` with a
 * plain async function plus a JSON-Schema description, and the agent does the
 * rest.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool<any, any>>();

  constructor(tools: Tool<any, any>[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register<TArgs, TResult>(tool: Tool<TArgs, TResult>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool as Tool<any, any>);
    return this;
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool<any, any> | undefined {
    return this.tools.get(name);
  }

  list(): Tool<any, any>[] {
    return [...this.tools.values()];
  }

  /** Render the tools as OpenAI-style specs for the model's chat template. */
  toSpecs(): ToolSpec[] {
    return this.list().map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * Parse a raw model-emitted argument string and run the tool.
   * Returns either a result or a structured error (never throws), so a bad
   * tool call degrades into feedback the model can recover from.
   */
  async invoke(
    name: string,
    rawArgs: string,
    ctx: ToolContext,
  ): Promise<{ result?: unknown; error?: string }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { error: `Unknown tool "${name}". Available: ${[...this.tools.keys()].join(', ')}` };
    }

    let args: unknown;
    try {
      args = rawArgs && rawArgs.trim() ? JSON.parse(rawArgs) : {};
    } catch (e) {
      return { error: `Arguments were not valid JSON: ${(e as Error).message}. Received: ${rawArgs}` };
    }

    const missing = (tool.parameters.required ?? []).filter(
      (key) => !(args as Record<string, unknown>)[key],
    );
    if (missing.length) {
      return { error: `Missing required argument(s): ${missing.join(', ')}` };
    }

    try {
      const result = await tool.execute(args as any, ctx);
      return { result };
    } catch (e) {
      return { error: `Tool "${name}" threw: ${(e as Error).message}` };
    }
  }
}
