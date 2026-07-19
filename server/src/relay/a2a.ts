import { RelayAgentError, RelayRequestError } from './registry.js';

/**
 * JSON-RPC 2.0 validation and error mapping for the A2A phone runtime.
 * Standard JSON-RPC codes are used where they apply; relay-specific
 * conditions use codes in the -32010..-32016 implementation range.
 */
export interface JsonRpcErrorSpec {
  code: number;
  message: string;
  httpStatus: number;
}

export const A2A_ERRORS = {
  parse:             { code: -32700, message: 'Parse error', httpStatus: 400 },
  invalidRequest:    { code: -32600, message: 'Invalid request', httpStatus: 400 },
  methodNotFound:    { code: -32601, message: 'Method not supported', httpStatus: 400 },
  invalidParams:     { code: -32602, message: 'Invalid params', httpStatus: 400 },
  internal:          { code: -32603, message: 'Internal error', httpStatus: 500 },
  oversized:         { code: -32010, message: 'Request too large', httpStatus: 413 },
  busy:              { code: -32011, message: 'Device busy', httpStatus: 429 },
  deviceUnavailable: { code: -32012, message: 'Device unavailable', httpStatus: 503 },
  timeout:           { code: -32013, message: 'Request timed out', httpStatus: 504 },
  agentNotFound:     { code: -32014, message: 'Agent not found', httpStatus: 404 },
  agentError:        { code: -32015, message: 'Agent error', httpStatus: 502 },
  rateLimited:       { code: -32016, message: 'Rate limit exceeded', httpStatus: 429 },
} as const satisfies Record<string, JsonRpcErrorSpec>;

export type JsonRpcId = string | number | null;

export interface JsonRpcErrorBody {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: { detail: string } };
}

export function jsonRpcError(id: JsonRpcId, spec: JsonRpcErrorSpec, detail?: string): JsonRpcErrorBody {
  const error: JsonRpcErrorBody['error'] = { code: spec.code, message: spec.message };
  if (detail) error.data = { detail };
  return { jsonrpc: '2.0', id, error };
}

export interface ValidA2ARequest {
  id: string | number;
  /** The JSON-RPC params, forwarded verbatim to the phone. */
  params: Record<string, unknown>;
  /** Concatenated text of all message parts. */
  text: string;
  textBytes: number;
}

export type A2AValidation =
  | { ok: true; request: ValidA2ARequest }
  | { ok: false; id: JsonRpcId; spec: JsonRpcErrorSpec; detail?: string };

/**
 * Validates a JSON-RPC 2.0 "message/send" request with text-only parts,
 * enforcing the configured text byte cap.
 */
export function validateA2ARequest(body: unknown, maxTextBytes: number): A2AValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, id: null, spec: A2A_ERRORS.invalidRequest, detail: 'body must be a JSON-RPC 2.0 request object' };
  }
  const obj = body as Record<string, unknown>;

  const id: JsonRpcId = typeof obj.id === 'string' || typeof obj.id === 'number' ? obj.id : null;

  if (obj.jsonrpc !== '2.0') {
    return { ok: false, id, spec: A2A_ERRORS.invalidRequest, detail: 'jsonrpc must be "2.0"' };
  }
  if (id === null) {
    return { ok: false, id, spec: A2A_ERRORS.invalidRequest, detail: 'id must be a string or number' };
  }
  if (obj.method !== 'message/send') {
    const detail = typeof obj.method === 'string' ? `unsupported method: ${obj.method}` : 'method must be a string';
    return { ok: false, id, spec: A2A_ERRORS.methodNotFound, detail };
  }

  const params = obj.params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { ok: false, id, spec: A2A_ERRORS.invalidParams, detail: 'params must be an object' };
  }
  const message = (params as Record<string, unknown>).message;
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return { ok: false, id, spec: A2A_ERRORS.invalidParams, detail: 'params.message is required' };
  }
  const parts = (message as Record<string, unknown>).parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return { ok: false, id, spec: A2A_ERRORS.invalidParams, detail: 'message.parts must be a non-empty array' };
  }

  let text = '';
  for (const part of parts) {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      return { ok: false, id, spec: A2A_ERRORS.invalidParams, detail: 'message parts must be objects' };
    }
    const candidate = part as Record<string, unknown>;
    const kind = candidate.kind ?? candidate.type;
    if (kind !== 'text' || typeof candidate.text !== 'string') {
      return { ok: false, id, spec: A2A_ERRORS.invalidParams, detail: 'only text parts are supported' };
    }
    text += candidate.text;
  }

  const textBytes = Buffer.byteLength(text, 'utf8');
  if (textBytes > maxTextBytes) {
    return {
      ok: false,
      id,
      spec: A2A_ERRORS.oversized,
      detail: `request text is ${textBytes} bytes (limit ${maxTextBytes})`,
    };
  }

  return {
    ok: true,
    request: { id, params: params as Record<string, unknown>, text, textBytes },
  };
}

/** Maps a relay failure to its JSON-RPC error spec. */
export function mapRelayError(err: unknown): { spec: JsonRpcErrorSpec; detail?: string } {
  if (err instanceof RelayRequestError) {
    switch (err.reason) {
      case 'busy':
        return { spec: A2A_ERRORS.busy };
      case 'timeout':
        return { spec: A2A_ERRORS.timeout };
      default:
        return { spec: A2A_ERRORS.deviceUnavailable };
    }
  }
  if (err instanceof RelayAgentError) {
    return { spec: A2A_ERRORS.agentError, detail: `${err.code}: ${err.message}` };
  }
  return { spec: A2A_ERRORS.internal };
}
