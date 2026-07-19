import { describe, expect, it } from 'vitest';
import { A2A_ERRORS, jsonRpcError, mapRelayError, validateA2ARequest } from './a2a.js';
import { RelayAgentError, RelayRequestError } from './registry.js';

const MAX_BYTES = 1024;

function validBody(text = 'hello'): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 'req-1',
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text }],
      },
    },
  };
}

describe('validateA2ARequest', () => {
  it('accepts a valid text-only message/send request', () => {
    const result = validateA2ARequest(validBody(), MAX_BYTES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.id).toBe('req-1');
      expect(result.request.text).toBe('hello');
      expect(result.request.textBytes).toBe(5);
    }
  });

  it('accepts A2A parts that use "type" instead of "kind"', () => {
    const body = validBody();
    (body.params as { message: { parts: unknown[] } }).message.parts = [{ type: 'text', text: 'hey' }];
    const result = validateA2ARequest(body, MAX_BYTES);
    expect(result.ok).toBe(true);
  });

  it('accepts numeric ids', () => {
    const body = { ...validBody(), id: 7 };
    const result = validateA2ARequest(body, MAX_BYTES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.id).toBe(7);
  });

  it('rejects non-object bodies as invalid request', () => {
    for (const body of [null, 'x', 42, [validBody()]]) {
      const result = validateA2ARequest(body, MAX_BYTES);
      expect(result).toMatchObject({ ok: false, spec: A2A_ERRORS.invalidRequest, id: null });
    }
  });

  it('rejects a missing or wrong jsonrpc version', () => {
    expect(validateA2ARequest({ ...validBody(), jsonrpc: '1.0' }, MAX_BYTES)).toMatchObject({
      ok: false,
      spec: A2A_ERRORS.invalidRequest,
      id: 'req-1',
    });
    const { jsonrpc: _unused, ...withoutVersion } = validBody();
    expect(validateA2ARequest(withoutVersion, MAX_BYTES)).toMatchObject({
      ok: false,
      spec: A2A_ERRORS.invalidRequest,
    });
  });

  it('rejects a missing id', () => {
    const { id: _unused, ...withoutId } = validBody();
    expect(validateA2ARequest(withoutId, MAX_BYTES)).toMatchObject({
      ok: false,
      spec: A2A_ERRORS.invalidRequest,
      id: null,
    });
  });

  it('rejects unsupported methods with method not found', () => {
    expect(validateA2ARequest({ ...validBody(), method: 'tasks/get' }, MAX_BYTES)).toMatchObject({
      ok: false,
      spec: A2A_ERRORS.methodNotFound,
      id: 'req-1',
    });
  });

  it('rejects missing or malformed params', () => {
    expect(validateA2ARequest({ ...validBody(), params: undefined }, MAX_BYTES)).toMatchObject({
      ok: false,
      spec: A2A_ERRORS.invalidParams,
    });
    expect(validateA2ARequest({ ...validBody(), params: { message: {} } }, MAX_BYTES)).toMatchObject({
      ok: false,
      spec: A2A_ERRORS.invalidParams,
    });
    expect(
      validateA2ARequest({ ...validBody(), params: { message: { parts: [] } } }, MAX_BYTES),
    ).toMatchObject({ ok: false, spec: A2A_ERRORS.invalidParams });
  });

  it('rejects non-text parts', () => {
    const body = validBody();
    (body.params as { message: { parts: unknown[] } }).message.parts = [
      { kind: 'text', text: 'ok' },
      { kind: 'file', file: { uri: 'https://example.com/x.png' } },
    ];
    expect(validateA2ARequest(body, MAX_BYTES)).toMatchObject({
      ok: false,
      spec: A2A_ERRORS.invalidParams,
      detail: 'only text parts are supported',
    });
  });

  it('rejects oversized request text', () => {
    const result = validateA2ARequest(validBody('x'.repeat(MAX_BYTES + 1)), MAX_BYTES);
    expect(result).toMatchObject({ ok: false, spec: A2A_ERRORS.oversized, id: 'req-1' });
  });

  it('counts bytes (not characters) across all parts', () => {
    const body = validBody();
    // Four 3-byte characters in two parts: 12 bytes total
    (body.params as { message: { parts: unknown[] } }).message.parts = [
      { kind: 'text', text: '€€' },
      { kind: 'text', text: '€€' },
    ];
    expect(validateA2ARequest(body, 11)).toMatchObject({ ok: false, spec: A2A_ERRORS.oversized });
    expect(validateA2ARequest(body, 12)).toMatchObject({ ok: true });
  });
});

describe('mapRelayError', () => {
  it('maps busy, timeout, and unavailable relay failures', () => {
    expect(mapRelayError(new RelayRequestError('busy'))).toEqual({ spec: A2A_ERRORS.busy });
    expect(mapRelayError(new RelayRequestError('timeout'))).toEqual({ spec: A2A_ERRORS.timeout });
    expect(mapRelayError(new RelayRequestError('unavailable'))).toEqual({
      spec: A2A_ERRORS.deviceUnavailable,
    });
  });

  it('maps phone error envelopes to agent errors with detail', () => {
    expect(mapRelayError(new RelayAgentError(500, 'model failed'))).toEqual({
      spec: A2A_ERRORS.agentError,
      detail: '500: model failed',
    });
  });

  it('maps anything else to internal', () => {
    expect(mapRelayError(new Error('boom'))).toEqual({ spec: A2A_ERRORS.internal });
    expect(mapRelayError('weird')).toEqual({ spec: A2A_ERRORS.internal });
  });
});

describe('jsonRpcError', () => {
  it('builds a structured JSON-RPC error body', () => {
    expect(jsonRpcError('req-1', A2A_ERRORS.busy)).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      error: { code: -32011, message: 'Device busy' },
    });
  });

  it('includes detail as error data', () => {
    expect(jsonRpcError(null, A2A_ERRORS.oversized, 'request text is 2048 bytes (limit 1024)')).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32010,
        message: 'Request too large',
        data: { detail: 'request text is 2048 bytes (limit 1024)' },
      },
    });
  });

  it('uses distinct codes and http statuses per error', () => {
    const codes = Object.values(A2A_ERRORS).map((spec) => spec.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(A2A_ERRORS.busy.httpStatus).toBe(429);
    expect(A2A_ERRORS.deviceUnavailable.httpStatus).toBe(503);
    expect(A2A_ERRORS.timeout.httpStatus).toBe(504);
    expect(A2A_ERRORS.oversized.httpStatus).toBe(413);
  });
});
