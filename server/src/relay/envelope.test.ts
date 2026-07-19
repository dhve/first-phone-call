import { describe, expect, it } from 'vitest';
import { decodeEnvelope, encodeEnvelope } from './envelope.js';
import type { RelayEnvelope } from './envelope.js';

function roundTrip(envelope: RelayEnvelope): void {
  const decoded = decodeEnvelope(encodeEnvelope(envelope));
  expect(decoded).toEqual({ ok: true, envelope });
}

describe('relay envelope protocol', () => {
  it('round-trips every envelope type', () => {
    roundTrip({ type: 'hello', protocol: 1 });
    roundTrip({ type: 'hello' });
    roundTrip({ type: 'ready', deviceId: 'dev-1', heartbeatIntervalMs: 30000 });
    roundTrip({ type: 'ping', ts: 1_760_000_000_000 });
    roundTrip({ type: 'pong', ts: 1_760_000_000_000 });
    roundTrip({
      type: 'request',
      id: 'req-1',
      method: 'message/send',
      params: { message: { parts: [{ kind: 'text', text: 'hi' }] } },
      deadline: 1_760_000_120_000,
    });
    roundTrip({ type: 'response', id: 'req-1', result: { message: 'done' } });
    roundTrip({ type: 'response', id: 'req-1', result: null });
    roundTrip({ type: 'error', id: 'req-1', code: 500, message: 'model failed' });
  });

  it('rejects invalid JSON', () => {
    expect(decodeEnvelope('{nope')).toMatchObject({ ok: false });
  });

  it('rejects non-object frames', () => {
    expect(decodeEnvelope('"hello"')).toMatchObject({ ok: false });
    expect(decodeEnvelope('[1,2]')).toMatchObject({ ok: false });
    expect(decodeEnvelope('null')).toMatchObject({ ok: false });
  });

  it('rejects unknown envelope types', () => {
    expect(decodeEnvelope(JSON.stringify({ type: 'shutdown' }))).toMatchObject({ ok: false });
    expect(decodeEnvelope(JSON.stringify({ id: 'x' }))).toMatchObject({ ok: false });
  });

  it('rejects envelopes with missing or mistyped fields', () => {
    expect(decodeEnvelope(JSON.stringify({ type: 'ready', deviceId: 'd' }))).toMatchObject({ ok: false });
    expect(decodeEnvelope(JSON.stringify({ type: 'ping' }))).toMatchObject({ ok: false });
    expect(decodeEnvelope(JSON.stringify({ type: 'pong', ts: 'now' }))).toMatchObject({ ok: false });
    expect(
      decodeEnvelope(JSON.stringify({ type: 'request', id: 'r', method: 'tasks/get', params: {}, deadline: 1 })),
    ).toMatchObject({ ok: false });
    expect(
      decodeEnvelope(JSON.stringify({ type: 'request', id: 'r', method: 'message/send', deadline: 1 })),
    ).toMatchObject({ ok: false });
    expect(
      decodeEnvelope(JSON.stringify({ type: 'request', id: '', method: 'message/send', params: {}, deadline: 1 })),
    ).toMatchObject({ ok: false });
    expect(decodeEnvelope(JSON.stringify({ type: 'response', id: 'r' }))).toMatchObject({ ok: false });
    expect(decodeEnvelope(JSON.stringify({ type: 'response', result: {} }))).toMatchObject({ ok: false });
    expect(decodeEnvelope(JSON.stringify({ type: 'error', id: 'r', code: 'bad', message: 'x' }))).toMatchObject({
      ok: false,
    });
    expect(decodeEnvelope(JSON.stringify({ type: 'error', id: 'r', code: 1 }))).toMatchObject({ ok: false });
  });

  it('preserves the response result payload exactly', () => {
    const result = { message: { parts: [{ kind: 'text', text: 'answer' }] }, tokens: 42 };
    const decoded = decodeEnvelope(encodeEnvelope({ type: 'response', id: 'abc', result }));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.envelope.type === 'response') {
      expect(decoded.envelope.result).toEqual(result);
    }
  });
});
