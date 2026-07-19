/**
 * Host39 phone agent configuration: the model we host, the agent's runtime
 * limits, and how to reach the Host39 server.
 */
export const MODEL = {
  /** Single-file GGUF download (bartowski quant repo). */
  url: 'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  /** Local filename to store it as. */
  fileName: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  /** Approx download size, for the UI. */
  sizeLabel: '~1.0 GB',
  /** Context window. */
  nCtx: 4096,
  /**
   * Official SHA-256 of Qwen2.5-1.5B-Instruct-Q4_K_M.gguf. Source: Hugging
   * Face API, `lfs.oid` for that file at
   * https://huggingface.co/api/models/bartowski/Qwen2.5-1.5B-Instruct-GGUF/tree/main
   * (fetched 2026-07-19). The download is verified against this and deleted
   * on mismatch.
   */
  sha256: '1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370',
};

/** Runtime limits for every remote-request agent run. */
export const AGENT = {
  /** Tool-call/think iterations per request. */
  maxSteps: 4,
  temperature: 0.3,
  /** Hard cap on generated tokens per completion. */
  maxOutputTokens: 512,
  /** Fallback deadline when a request envelope carries none (ms). */
  defaultDeadlineMs: 120_000,
};

export const SERVER = {
  /**
   * Default Host39 server base URL. 10.0.2.2 reaches the dev machine from the
   * Android emulator; override it on the sign-in screen for real devices.
   */
  defaultBaseUrl: 'http://10.0.2.2:3000',
};

/** Server route paths the app talks to (see server/src/routes). */
export const API_PATHS = {
  register: '/auth/register',
  login: '/auth/login',
  me: '/auth/me',
  cards: '/cards',
  devices: '/devices',
  relaySession: (deviceId: string) =>
    `/devices/${encodeURIComponent(deviceId)}/relay-session`,
  /** Fallback WS path when the server response omits ws_url. */
  relayWs: '/relay',
  cardCache: (slug: string) => `/mobile/cards/${encodeURIComponent(slug)}/cache`,
  publicCard: (email: string, slug: string) =>
    `/personal/${encodeURIComponent(email)}/${encodeURIComponent(slug)}.json`,
};

/** Canonical agent identifier for a personal (email-identity) user. */
export function agentUrn(email: string, slug: string): string {
  return `urn:ai:email:${email}:agent:${slug}`;
}

/** Battery floor (percent) below which requests are rejected on battery power. */
export const MIN_BATTERY_PERCENT = 15;

export function buildSystemPrompt(card: {
  name: string;
  description?: string;
  skills?: { name: string; description?: string }[];
}): string {
  const skills = (card.skills ?? [])
    .map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ''}`)
    .join('\n');
  return (
    `You are "${card.name}", a personal agent hosted on its owner's phone via Host39. ` +
    (card.description ? `About you: ${card.description} ` : '') +
    'You answer a single question from another agent; there is no back-and-forth. ' +
    'You can call tools for the current time, device health, and files in your ' +
    'knowledge folder. Base factual answers on your knowledge files or tool ' +
    'results; if you do not know, say so plainly. Keep answers short.' +
    (skills ? `\n\nYour skills:\n${skills}` : '')
  );
}
