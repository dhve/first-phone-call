/**
 * Demo configuration: which model to download and the agent's behavior.
 *
 * Qwen3-0.6B (Q4_K_M) is the smallest Qwen 3 — ~370 MB, loads in seconds, and
 * runs on modest hardware. Unlike Gemma 3, its chat template DOES support
 * tool calling, which the agent-to-agent flow depends on.
 *
 * Qwen 3 is a hybrid-reasoning model: it can emit <think>...</think> blocks
 * before its answer. Those must never reach the other agent, so replies are
 * stripped (see stripThinking) and the system prompt asks it not to think.
 */
export const MODEL = {
  /** Single-file GGUF download (unsloth mirror — ungated, no HF token needed). */
  url: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf',
  /** Local filename to store it as. */
  fileName: 'Qwen3-0.6B-Q4_K_M.gguf',
  /** Approx download size, for the UI. */
  sizeLabel: '~370 MB',
  /** Context window. */
  nCtx: 4096,
};

export const SYSTEM_PROMPT =
  'You are a helpful assistant running entirely on the user\'s device. ' +
  'You can call tools to take real actions (clipboard, files, web requests, ' +
  'notifications) or to fetch information. Prefer calling a tool when it lets ' +
  'you actually do what the user asked, rather than describing how. When a ' +
  'tool returns, summarize the outcome for the user in plain language. ' +
  'Answer directly without showing your reasoning. /no_think';

/**
 * System prompt used when another AI agent calls this device (not the local
 * user). Kept short and firm: the reply is read aloud on someone else's
 * screen, so rambling or visible reasoning looks broken.
 */
export const REMOTE_SYSTEM_PROMPT =
  'You are an AI agent running entirely on a phone. Another AI agent, on a ' +
  'different device, is sending you a message. Reply in one or two short ' +
  'sentences, in plain text, as yourself. Do not show reasoning, do not use ' +
  'markdown, and do not pretend to be human. /no_think';

/**
 * Cap on tokens per agent-to-agent reply.
 *
 * The engine defaults to 512, which is a long way past the one or two
 * sentences we ask for — and on a phone every token generated after the model
 * had already finished is time someone stands and waits through. 120 leaves
 * room for a full two-sentence answer without truncating it mid-word.
 */
export const REMOTE_MAX_TOKENS = 120;

/**
 * How this device argues its side when two agents are working toward
 * agreement, rather than trading one-off questions.
 *
 * The marker is what lets the loop stop on its own. A 0.6B model follows an
 * instruction like this unreliably, so the turn cap — not the marker — is what
 * ends most conversations; treat agreement as the good case, not the contract.
 */
export const AGREEMENT_MARKER = 'AGREED';

export const CONVERSATION_SYSTEM_PROMPT =
  'You are an AI agent on a phone, talking to another AI agent on a different ' +
  'phone. You are working together to settle one question. Reply in one or two ' +
  'short sentences, plain text, no markdown, no reasoning. Respond to what the ' +
  'other agent actually said. When you genuinely agree with them and there is ' +
  'nothing left to settle, end your message with the single word ' +
  `${AGREEMENT_MARKER}. Do not use that word until you truly agree. /no_think`;

/** Hard stop, so a pair of agents cannot talk forever on stage. */
export const CONVERSATION_MAX_TURNS = 8;

/** Has an agent signalled it is done? */
export function signalsAgreement(text: string): boolean {
  return new RegExp(`\\b${AGREEMENT_MARKER}\\b`, 'i').test(text);
}

/**
 * Remove Qwen 3's reasoning blocks from a completion. The model may emit
 * <think>...</think> before its answer; an unterminated block is also possible
 * if generation was cut short, so drop a dangling opener too.
 */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}
