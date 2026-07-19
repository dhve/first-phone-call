/**
 * Stand-in for llama.rn: initLlama returns whatever fake context the test
 * scripted. The real LlamaEngine/Agent stack from react-native-device-agent
 * runs on top of it.
 */

export interface FakeCompletionResult {
  content?: string;
  tool_calls?: Array<{ id?: string; function: { name: string; arguments: string } }>;
}

type CompletionFn = (
  params: Record<string, unknown>,
  onToken?: (data: { token?: string }) => void,
) => Promise<FakeCompletionResult>;

function defaultContext() {
  return {
    completion: async () => ({ content: 'ok', tool_calls: [] }),
    stopCompletion: async () => undefined,
    release: async () => undefined,
  };
}

let factory: () => unknown = defaultContext;

export function __reset(): void {
  factory = defaultContext;
}

/** Script the context (and its completion behavior) the next load returns. */
export function __setContextFactory(f: () => { completion: CompletionFn } & Record<string, unknown>): void {
  factory = f;
}

export async function initLlama(_options: Record<string, unknown>): Promise<any> {
  return factory();
}
