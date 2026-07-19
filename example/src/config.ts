/**
 * Demo configuration: which model to download and the agent's behavior.
 *
 * Gemma 3 270M (instruction-tuned, Q8_0) is tiny (~292 MB), loads in a couple
 * of seconds, and leaves plenty of RAM headroom next to whisper during audio
 * calls. Its chat template has no tool-calling support, so the local chat
 * tools degrade on this model; the phone-call flow never calls tools, which is
 * the trade this demo makes on purpose.
 *
 * stripThinking is kept even though Gemma does not emit <think> blocks: it is
 * a no-op on clean output and a guard if the model is swapped again.
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
  'tool returns, summarize the outcome for the user in plain language. ' +
  'Answer directly without showing your reasoning.';

/**
 * System prompt used when another AI agent calls this device (not the local
 * user). Kept short and firm: the reply is read aloud on someone else's
 * screen, so rambling or visible reasoning looks broken.
 */
export const REMOTE_SYSTEM_PROMPT =
  'You are an AI agent running entirely on a phone, talking with another AI ' +
  'agent on a different device. Talk the way people talk: short casual ' +
  'sentences, contractions, no markdown, no lists. Have your own take. If ' +
  'you see it differently, push back and say why — do not just agree with ' +
  'everything. One or two sentences. Do not show reasoning.';

/**
 * Cap on tokens per agent-to-agent reply.
 *
 * The engine defaults to 512, which is a long way past the one or two
 * sentences we ask for — and on a phone every token generated after the model
 * had already finished is time someone stands and waits through. 256 leaves
 * room for a stray <think> block to burn tokens and still fit the one or two
 * sentences we asked for — at 120 the thinking alone could eat the budget,
 * which surfaced as replies cut mid-sentence or stripped to nothing.
 */
export const REMOTE_MAX_TOKENS = 256;

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
  'You are an AI agent on a phone, having a conversation with another AI ' +
  'agent on a different phone. Talk the way people talk: short casual ' +
  'sentences, contractions, plain text, no lists, no markdown, no reasoning. ' +
  'Have opinions. React to what they actually said — push back when you see ' +
  'it differently, concede a point when they earn it, ask a question back ' +
  'now and then. Never open a message with "I agree". Only when the ' +
  'discussion has truly run its course and you both see it the same way, ' +
  `end your message with the single word ${AGREEMENT_MARKER}.`;

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

/**
 * Drop the "I agree." tic from the front of a line.
 *
 * The model opens half its messages with it no matter what the prompt says,
 * which is what makes the exchange read like robots. The sentence after the
 * tic carries the actual content, so cutting the opener loses nothing — but
 * if the whole message WAS the tic, keep it, or we'd send an empty line.
 */
export function stripAgreementTic(text: string): string {
  // Only "I agree" is the tic. "We agree" is a settlement claim about both
  // sides — that one should survive so signalsAgreement can end the run.
  const cleaned = text
    .replace(/^\s*(?:i\s+agree(?:\s+with\s+(?:you|that))?|agreed)[.,!:]?\s*/i, '')
    .trim();
  return cleaned.length >= 8 ? cleaned : text.trim();
}

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
 * Deliberately narrow. A small model opens half its sentences with "I agree"
 * as a verbal tic while still adding new points — treating that as the end
 * kills the discussion two turns in. Only the marker and phrases that declare
 * the question settled for BOTH sides count; ordinary politeness does not.
 */
const AGREEMENT_PHRASES = [
  AGREEMENT_MARKER,
  'we agree',
  'we are agreed',
  "we're agreed",
  'we both agree',
  'it is settled',
  "it's settled",
  'we are on the same page',
  "we're on the same page",
  'we see it the same way',
  'nothing left to settle',
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
