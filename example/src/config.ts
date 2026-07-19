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
  'other agent actually said. Take a clear position first and give a reason ' +
  'for it. Only after several exchanges, if you genuinely agree and nothing ' +
  `is left to settle, end that message with the single word ${AGREEMENT_MARKER}. ` +
  'Never open with agreement. /no_think';

/**
 * Exchanges that must happen before agreement is allowed to end the run.
 *
 * A 0.6B model latches onto the marker and will open with "Agreed." if
 * permitted, which ends the conversation before it starts. Ignoring the marker
 * early forces an actual exchange.
 */
export const MIN_TURNS_BEFORE_AGREEMENT = 3;

/**
 * Backstop, not the intended ending. A conversation is meant to run until the
 * agents agree or the user stops it; this only exists so two agents cannot
 * talk forever unattended. The engine trims old turns to fit the context
 * window, so a long conversation degrades rather than crashing.
 */
export const CONVERSATION_MAX_TURNS = 20;

/**
 * Consecutive repeated turns tolerated before giving up.
 *
 * One repeat is worth trying to break out of — the model is nudged to take a
 * different angle. Two in a row means it is stuck, and continuing just prints
 * the same sentence at the audience.
 */
export const MAX_CONSECUTIVE_REPEATS = 2;

/** Compare two replies ignoring case, punctuation and spacing. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Did the model just parrot what it was given?
 *
 * A small model will echo its prompt verbatim, and once that echo is in its
 * history it does it again — two agents then trade the identical sentence
 * until the turn cap. Catching it needs an explicit check; nothing about the
 * text itself looks wrong.
 */
export function isEcho(reply: string, prompt: string): boolean {
  const a = normalize(reply);
  const b = normalize(prompt);
  if (!a || !b) return false;
  if (a === b) return true;

  // Exact comparison is not enough: the model reproduces the sentence with a
  // word added or dropped ("First call on Internet" -> "First call on the
  // Internet"), which reads as an echo but does not match. Compare overlap.
  const wordsA = new Set(a.split(' '));
  const wordsB = new Set(b.split(' '));
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared++;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && shared / union >= 0.7;
}

/**
 * Has an agent signalled it is done?
 *
 * The marker alone is not enough. A small model settles the question in plain
 * English — "I agree", "that is right" — and never reaches for the keyword, so
 * the two of them go on restating a point they have already conceded. Ordinary
 * agreement counts.
 */
const AGREEMENT_PHRASES = [
  AGREEMENT_MARKER,
  'i agree',
  'we agree',
  'fully agree',
  'i concur',
  'that is right',
  "that's right",
  'you are right',
  "you're right",
  'exactly right',
];

export function signalsAgreement(text: string): boolean {
  const t = normalize(text);
  return AGREEMENT_PHRASES.some((p) => t.includes(normalize(p)));
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
