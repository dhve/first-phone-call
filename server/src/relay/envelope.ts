/**
 * Typed JSON envelope protocol for the phone relay WebSocket.
 * Shared contract between the server and the phone client.
 * Each envelope is a single JSON object sent as one WebSocket text frame.
 *
 * Flow:
 *   phone -> server  hello       (first frame after connecting)
 *   server -> phone  ready       (acknowledges hello, announces heartbeat cadence)
 *   server -> phone  ping        (every heartbeat interval; drop after N missed pongs)
 *   phone -> server  pong
 *   server -> phone  request     (runtime "message/send" with a deadline)
 *   phone -> server  response    (successful result for a request id)
 *   phone -> server  error       (failure for a request id)
 */

export const RELAY_PROTOCOL_VERSION = 1;

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

/** Heartbeat reply. */
export interface PongEnvelope {
  type: 'pong';
  ts: number;
}

/** Server -> phone runtime request. */
export interface RequestEnvelope {
  type: 'request';
  id: string;
  method: 'message/send';
  /** Card slug the request is addressed to; the phone rejects slugs it has not published. */
  slug: string;
  params: unknown;
  /** Unix epoch ms after which the server no longer accepts a response. */
  deadline: number;
}

/** Phone -> server successful runtime response. */
export interface ResponseEnvelope {
  type: 'response';
  id: string;
  result: unknown;
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

export type EnvelopeDecodeResult =
  | { ok: true; envelope: RelayEnvelope }
  | { ok: false; error: string };

export function encodeEnvelope(envelope: RelayEnvelope): string {
  return JSON.stringify(envelope);
}

export function decodeEnvelope(raw: string): EnvelopeDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'envelope must be a JSON object' };
  }
  const obj = parsed as Record<string, unknown>;

  switch (obj.type) {
    case 'hello':
      if (obj.protocol !== undefined && typeof obj.protocol !== 'number') {
        return { ok: false, error: 'hello.protocol must be a number' };
      }
      return { ok: true, envelope: obj as unknown as HelloEnvelope };

    case 'ready':
      if (typeof obj.deviceId !== 'string' || typeof obj.heartbeatIntervalMs !== 'number') {
        return { ok: false, error: 'ready requires deviceId and heartbeatIntervalMs' };
      }
      return { ok: true, envelope: obj as unknown as ReadyEnvelope };

    case 'ping':
    case 'pong':
      if (typeof obj.ts !== 'number') {
        return { ok: false, error: `${obj.type} requires a numeric ts` };
      }
      return { ok: true, envelope: obj as unknown as PingEnvelope | PongEnvelope };

    case 'request':
      if (typeof obj.id !== 'string' || obj.id === '') {
        return { ok: false, error: 'request requires a string id' };
      }
      if (obj.method !== 'message/send') {
        return { ok: false, error: 'request method must be "message/send"' };
      }
      if (typeof obj.slug !== 'string' || obj.slug === '') {
        return { ok: false, error: 'request requires a string slug' };
      }
      if (typeof obj.deadline !== 'number') {
        return { ok: false, error: 'request requires a numeric deadline' };
      }
      if (!('params' in obj)) {
        return { ok: false, error: 'request requires params' };
      }
      return { ok: true, envelope: obj as unknown as RequestEnvelope };

    case 'response':
      if (typeof obj.id !== 'string' || obj.id === '') {
        return { ok: false, error: 'response requires a string id' };
      }
      if (!('result' in obj)) {
        return { ok: false, error: 'response requires a result' };
      }
      return { ok: true, envelope: obj as unknown as ResponseEnvelope };

    case 'error':
      if (typeof obj.id !== 'string' || typeof obj.code !== 'number' || typeof obj.message !== 'string') {
        return { ok: false, error: 'error requires id, code, and message' };
      }
      return { ok: true, envelope: obj as unknown as ErrorEnvelope };

    default:
      return { ok: false, error: 'unknown envelope type' };
  }
}
