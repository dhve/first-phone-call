import { describe, expect, it } from 'vitest';
import {
  InMemoryRelaySessionStore,
  generateRelayToken,
  hashRelayToken,
  issueRelayToken,
  redeemRelayToken,
} from './tokens.js';

const T0 = new Date('2026-07-19T12:00:00Z');

function at(secondsAfter: number): Date {
  return new Date(T0.getTime() + secondsAfter * 1000);
}

describe('relay session tokens', () => {
  it('generates opaque url-safe tokens and stable hashes', () => {
    const token = generateRelayToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateRelayToken()).not.toBe(token);
    expect(hashRelayToken(token)).toBe(hashRelayToken(token));
    expect(hashRelayToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('issues a token that expires ttl seconds later', async () => {
    const store = new InMemoryRelaySessionStore();
    const { token, expiresAt } = await issueRelayToken(store, 'device-1', 60, T0);
    expect(token).toBeTruthy();
    expect(expiresAt.getTime()).toBe(at(60).getTime());
  });

  it('redeems a valid token exactly once and rejects replay', async () => {
    const store = new InMemoryRelaySessionStore();
    const { token } = await issueRelayToken(store, 'device-1', 60, T0);

    const first = await redeemRelayToken(store, token, at(30));
    expect(first).toEqual({ deviceId: 'device-1' });

    const replay = await redeemRelayToken(store, token, at(31));
    expect(replay).toBeNull();

    const laterReplay = await redeemRelayToken(store, token, at(59));
    expect(laterReplay).toBeNull();
  });

  it('rejects an expired token', async () => {
    const store = new InMemoryRelaySessionStore();
    const { token } = await issueRelayToken(store, 'device-1', 60, T0);

    expect(await redeemRelayToken(store, token, at(60))).toBeNull();
    expect(await redeemRelayToken(store, token, at(3600))).toBeNull();
  });

  it('redeems right up to (but not at) the expiry instant', async () => {
    const store = new InMemoryRelaySessionStore();
    const { token } = await issueRelayToken(store, 'device-1', 60, T0);
    expect(await redeemRelayToken(store, token, at(59))).toEqual({ deviceId: 'device-1' });
  });

  it('rejects unknown tokens', async () => {
    const store = new InMemoryRelaySessionStore();
    await issueRelayToken(store, 'device-1', 60, T0);
    expect(await redeemRelayToken(store, generateRelayToken(), at(1))).toBeNull();
  });

  it('keeps tokens independent per device', async () => {
    const store = new InMemoryRelaySessionStore();
    const a = await issueRelayToken(store, 'device-a', 60, T0);
    const b = await issueRelayToken(store, 'device-b', 60, T0);

    expect(await redeemRelayToken(store, b.token, at(1))).toEqual({ deviceId: 'device-b' });
    expect(await redeemRelayToken(store, a.token, at(2))).toEqual({ deviceId: 'device-a' });
  });
});
