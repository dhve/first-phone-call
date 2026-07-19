/**
 * Demo configuration: which model to download and the agent's behavior.
 *
 * Gemma 3 270M (instruction-tuned, Q8_0) is a tiny model: fast to download
 * and quick even on emulators. Swap MODEL for a larger GGUF (e.g.
 * Qwen2.5-1.5B-Instruct Q4_K_M) when you need stronger tool-calling.
 */
export const MODEL = {
  /** Single-file GGUF download (llama.cpp org quant repo). */
  url: 'https://huggingface.co/ggml-org/gemma-3-270m-it-GGUF/resolve/main/gemma-3-270m-it-Q8_0.gguf',
  /** Local filename to store it as. */
  fileName: 'gemma-3-270m-it-Q8_0.gguf',
  /** Approx download size, for the UI. */
  sizeLabel: '~292 MB',
  /** Context window. */
  nCtx: 4096,
};

export const SYSTEM_PROMPT =
  'You are a helpful assistant running entirely on the user\'s device. ' +
  'You can call tools to take real actions (clipboard, files, web requests, ' +
  'notifications) or to fetch information. Prefer calling a tool when it lets ' +
  'you actually do what the user asked, rather than describing how. When a ' +
  'tool returns, summarize the outcome for the user in plain language.';
