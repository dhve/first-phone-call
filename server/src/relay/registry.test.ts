import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeEnvelope } from './envelope.js';
import { RelayRegistry } from './registry.js';
import type { RelaySocket } from './registry.js';

interface FakeSocket extends RelaySocket {
  sent: string[];
  closed: { code?: number; reason?: string }[];
}

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    sent: [],
    closed: [],
    send(data: string) {
      socket.sent.push(data);
    },
    close(code?: number, reason?: string) {
      socket.closed.push({ code, reason });
    },
  };
  return socket;
}

function frames(socket: FakeSocket): Record<string, unknown>[] {
  return socket.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

const HEARTBEAT_MS = 30_000;

describe('RelayRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeRegistry(overrides: Partial<{ heartbeatIntervalMs: number; maxMissedHeartbeats: number }> = {}) {
    return new RelayRegistry({
      heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? HEARTBEAT_MS,
      maxMissedHeartbeats: overrides.maxMissedHeartbeats ?? 2,
    });
  }

  it('answers hello with ready', () => {
    const registry = makeRegistry();
    const socket = fakeSocket();
    registry.attach('dev-1', socket);

    registry.handleMessage('dev-1', encodeEnvelope({ type: 'hello', protocol: 1 }));

    expect(frames(socket)).toEqual([{ type: 'ready', deviceId: 'dev-1', heartbeatIntervalMs: HEARTBEAT_MS }]);
    registry.shutdown();
  });

  it('replaces the old socket when the same device attaches again', () => {
    const registry = makeRegistry();
    const oldSocket = fakeSocket();
    const newSocket = fakeSocket();

    registry.attach('dev-1', oldSocket);
    registry.attach('dev-1', newSocket);

    expect(oldSocket.closed).toEqual([{ code: 4000, reason: 'replaced by a newer connection' }]);
    expect(registry.isConnected('dev-1')).toBe(true);

    // A late close event from the replaced socket must not detach the new one
    registry.detach('dev-1', oldSocket);
    expect(registry.isConnected('dev-1')).toBe(true);

    registry.shutdown();
  });

  it('pings every interval and drops the connection after 2 missed heartbeats', () => {
    const registry = makeRegistry();
    const socket = fakeSocket();
    registry.attach('dev-1', socket);

    vi.advanceTimersByTime(HEARTBEAT_MS);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(frames(socket).filter((f) => f.type === 'ping')).toHaveLength(2);
    expect(registry.isConnected('dev-1')).toBe(true);

    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(registry.isConnected('dev-1')).toBe(false);
    expect(socket.closed).toEqual([{ code: 4008, reason: 'heartbeat timeout' }]);
  });

  it('keeps the connection alive while pongs arrive', () => {
    const registry = makeRegistry();
    const socket = fakeSocket();
    registry.attach('dev-1', socket);

    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(HEARTBEAT_MS);
      registry.handleMessage('dev-1', encodeEnvelope({ type: 'pong', ts: Date.now() }));
    }

    expect(registry.isConnected('dev-1')).toBe(true);
    registry.shutdown();
  });

  it('rejects requests to a device that is not connected', async () => {
    const registry = makeRegistry();
    await expect(registry.request('nobody', 'phone-agent', {}, 1000)).rejects.toMatchObject({
      name: 'RelayRequestError',
      reason: 'unavailable',
    });
  });

  it('forwards a request and resolves with the phone response', async () => {
    const registry = makeRegistry();
    const socket = fakeSocket();
    registry.attach('dev-1', socket);

    const params = { message: { parts: [{ kind: 'text', text: 'hi' }] } };
    const pending = registry.request('dev-1', 'phone-agent', params, 120_000);

    const requestFrame = frames(socket).find((f) => f.type === 'request');
    expect(requestFrame).toMatchObject({ method: 'message/send', slug: 'phone-agent', params });
    expect(typeof requestFrame?.deadline).toBe('number');

    registry.handleMessage(
      'dev-1',
      encodeEnvelope({ type: 'response', id: requestFrame?.id as string, result: { text: 'hello back' } }),
    );

    await expect(pending).resolves.toEqual({ text: 'hello back' });
    registry.shutdown();
  });

  it('rejects a concurrent request with busy', async () => {
    const registry = makeRegistry();
    const socket = fakeSocket();
    registry.attach('dev-1', socket);

    const first = registry.request('dev-1', 'phone-agent', {}, 120_000);
    await expect(registry.request('dev-1', 'phone-agent', {}, 120_000)).rejects.toMatchObject({ reason: 'busy' });

    const requestFrame = frames(socket).find((f) => f.type === 'request');
    registry.handleMessage(
      'dev-1',
      encodeEnvelope({ type: 'response', id: requestFrame?.id as string, result: 'ok' }),
    );
    await expect(first).resolves.toBe('ok');

    // After the first settles, a new request is accepted again
    const second = registry.request('dev-1', 'phone-agent', {}, 120_000);
    const secondFrame = frames(socket).filter((f) => f.type === 'request')[1];
    registry.handleMessage(
      'dev-1',
      encodeEnvelope({ type: 'response', id: secondFrame?.id as string, result: 'ok2' }),
    );
    await expect(second).resolves.toBe('ok2');
    registry.shutdown();
  });

  it('times out a request that the phone never answers', async () => {
    // Large heartbeat so the heartbeat reaper does not fire first
    const registry = makeRegistry({ heartbeatIntervalMs: 10_000_000 });
    const socket = fakeSocket();
    registry.attach('dev-1', socket);

    const pending = registry.request('dev-1', 'phone-agent', {}, 120_000);
    const assertion = expect(pending).rejects.toMatchObject({ reason: 'timeout' });
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;

    // The slot frees up after the timeout: a new request is not rejected
    // with busy, it times out on its own
    const second = registry.request('dev-1', 'phone-agent', {}, 1000);
    const secondAssertion = expect(second).rejects.toMatchObject({ reason: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await secondAssertion;
    registry.shutdown();
  });

  it('rejects the pending request when the phone reports an error envelope', async () => {
    const registry = makeRegistry();
    const socket = fakeSocket();
    registry.attach('dev-1', socket);

    const pending = registry.request('dev-1', 'phone-agent', {}, 120_000);
    const requestFrame = frames(socket).find((f) => f.type === 'request');
    registry.handleMessage(
      'dev-1',
      encodeEnvelope({ type: 'error', id: requestFrame?.id as string, code: 429, message: 'model overloaded' }),
    );

    await expect(pending).rejects.toMatchObject({
      name: 'RelayAgentError',
      code: 429,
      message: 'model overloaded',
    });
    registry.shutdown();
  });

  it('ignores responses with a mismatched id', async () => {
    const registry = makeRegistry({ heartbeatIntervalMs: 10_000_000 });
    const socket = fakeSocket();
    registry.attach('dev-1', socket);

    const pending = registry.request('dev-1', 'phone-agent', {}, 60_000);
    registry.handleMessage('dev-1', encodeEnvelope({ type: 'response', id: 'wrong-id', result: 'nope' }));

    const assertion = expect(pending).rejects.toMatchObject({ reason: 'timeout' });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    registry.shutdown();
  });

  it('rejects the pending request with unavailable when the socket disconnects', async () => {
    const registry = makeRegistry();
    const socket = fakeSocket();
    registry.attach('dev-1', socket);

    const pending = registry.request('dev-1', 'phone-agent', {}, 120_000);
    registry.detach('dev-1', socket);

    await expect(pending).rejects.toMatchObject({ reason: 'unavailable' });
    expect(registry.isConnected('dev-1')).toBe(false);
  });

  it('fires connection lifecycle events', () => {
    const events = {
      onConnect: vi.fn(),
      onHeartbeat: vi.fn(),
      onDisconnect: vi.fn(),
    };
    const registry = new RelayRegistry({
      heartbeatIntervalMs: HEARTBEAT_MS,
      maxMissedHeartbeats: 2,
      events,
    });
    const socket = fakeSocket();

    registry.attach('dev-1', socket);
    expect(events.onConnect).toHaveBeenCalledWith('dev-1');

    registry.handleMessage('dev-1', encodeEnvelope({ type: 'pong', ts: Date.now() }));
    expect(events.onHeartbeat).toHaveBeenCalledWith('dev-1');

    registry.detach('dev-1', socket);
    expect(events.onDisconnect).toHaveBeenCalledWith('dev-1');
  });
});
