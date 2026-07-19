/**
 * Mobile-side mirror of the relay protocol: typed JSON envelopes exchanged
 * over the device WebSocket. Must stay in sync with the server's contract in
 * server/src/relay/envelope.ts.
 *
 * Flow: the device connects to /relay?token=<single-use token>, sends `hello`,
 * and the server answers `ready`. The server pings every heartbeat interval
 * and the device pongs (handled inside the foreground service). Inbound work
 * arrives as `request` envelopes; the device answers each with exactly one
 * `response` or `error` carrying the same id.
 */

export const RELAY_PROTOCOL_VERSION = 1;

/**
 * Numeric JSON-RPC-style error codes the phone returns in error envelopes.
 * Standard codes where they apply; gating conditions use the device range
 * -32020..-32025. The server surfaces them via A2A "Agent error" details.
 */
export const RELAY_AGENT_ERRORS = {
  OFFLINE: -32020,
  BUSY: -32021,
  THERMAL: -32022,
  LOW_BATTERY: -32023,
  MODEL_NOT_LOADED: -32024,
  DEADLINE_EXCEEDED: -32025,
  METHOD_NOT_FOUND: -32601,
  BAD_REQUEST: -32602,
  INTERNAL: -32603,
} as const;

export type RelayErrorName = keyof typeof RELAY_AGENT_ERRORS;

// A2A message shapes (text-only subset the phone agent supports).

export interface A2ATextPart {
  kind: 'text';
  text: string;
}

export interface A2AOtherPart {
  kind: string;
  [key: string]: unknown;
}

export type A2APart = A2ATextPart | A2AOtherPart;

export interface A2AMessage {
  kind?: 'message';
  role: 'user' | 'agent';
  parts: A2APart[];
  messageId?: string;
}

/** JSON-RPC "message/send" params, forwarded verbatim by the relay. */
export interface MessageSendParams {
  message: A2AMessage;
  [key: string]: unknown;
}

// Envelopes.

/** Phone -> server, first frame after connecting. */
export interface HelloEnvelope {
  type: 'hello';
  protocol?: number;
}

/** Server -> phone, acknowledges hello. */
export interface ReadyEnvelope {
  type: 'ready';
  deviceId: string;
  heartbeatIntervalMs: number;
}

/** Heartbeat probe. ts is unix epoch ms. */
export interface PingEnvelope {
  type: 'ping';
  ts: number;
}

/** Heartbeat reply (echoes the ping's ts). */
export interface PongEnvelope {
  type: 'pong';
  ts: number;
}

/** Server -> phone runtime request. */
export interface RequestEnvelope {
  type: 'request';
  id: string;
  method: 'message/send';
  params: MessageSendParams;
  /** Unix epoch ms after which the server no longer accepts a response. */
  deadline: number;
}

/** Phone -> server successful runtime response. */
export interface ResponseEnvelope {
  type: 'response';
  id: string;
  result: A2AMessage;
}

/** Phone -> server runtime failure. */
export interface ErrorEnvelope {
  type: 'error';
  id: string;
  code: number;
  message: string;
}

export type RelayEnvelope =
  | HelloEnvelope
  | ReadyEnvelope
  | PingEnvelope
  | PongEnvelope
  | RequestEnvelope
  | ResponseEnvelope
  | ErrorEnvelope;

/** Parse an incoming frame; returns null for malformed or unknown envelopes. */
export function parseEnvelope(json: string): RelayEnvelope | null {
  try {
    const value = JSON.parse(json);
    if (!value || typeof value !== 'object' || typeof value.type !== 'string') {
      return null;
    }
    return value as RelayEnvelope;
  } catch {
    return null;
  }
}

/** Concatenate the text parts of an A2A message into a single prompt string. */
export function textFromMessage(message: A2AMessage | undefined): string {
  if (!message || !Array.isArray(message.parts)) return '';
  return message.parts
    .filter((p): p is A2ATextPart => p.kind === 'text' && typeof (p as A2ATextPart).text === 'string')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

/** Wrap final agent text as an A2A agent message result. */
export function agentTextMessage(text: string): A2AMessage {
  return {
    kind: 'message',
    role: 'agent',
    parts: [{ kind: 'text', text }],
    messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}
