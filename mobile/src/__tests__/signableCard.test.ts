import { describe, expect, it } from 'vitest';
import { buildSignableCard } from '../hosting/signableCard';
import { canonicalize } from '../util/canonicalize';
import { cardFixture } from './harness';

const EMAIL = 'vedh@example.com';
const PUBLIC_BASE = 'http://public.example.com:3010';

describe('signable card invariants', () => {
  it('advertises the runtime url <publicBaseUrl>/a2a/personal/<handle>/<slug>', () => {
    const card = buildSignableCard(cardFixture('my-agent'), EMAIL, 2, PUBLIC_BASE);
    expect(card.url).toBe('http://public.example.com:3010/a2a/personal/vedh%40example.com/my-agent');
  });

  it('trims trailing slashes off the public base URL', () => {
    const card = buildSignableCard(cardFixture('my-agent'), EMAIL, 2, `${PUBLIC_BASE}///`);
    expect(card.url).toBe('http://public.example.com:3010/a2a/personal/vedh%40example.com/my-agent');
  });

  it('embeds a version exactly equal to the top-level cache PUT version', () => {
    const version = 7;
    const card = buildSignableCard(cardFixture('my-agent'), EMAIL, version, PUBLIC_BASE);
    expect(card.version).toBe(version);
    expect(typeof card.version).toBe('number');
  });

  it('carries the personal agent URN identifier', () => {
    const card = buildSignableCard(cardFixture('my-agent'), EMAIL, 1, PUBLIC_BASE);
    expect((card._meta as Record<string, unknown>).identifier).toBe(
      'urn:ai:email:vedh@example.com:agent:my-agent',
    );
  });
});

describe('canonicalization (RFC 8785)', () => {
  it('sorts object keys and strips whitespace', () => {
    expect(canonicalize({ b: 2, a: 1, c: { z: true, y: null } })).toBe(
      '{"a":1,"b":2,"c":{"y":null,"z":true}}',
    );
  });

  it('is stable across key insertion order', () => {
    const card = buildSignableCard(cardFixture('my-agent'), EMAIL, 3, PUBLIC_BASE);
    const shuffled = Object.fromEntries(Object.entries(card).reverse());
    expect(canonicalize(shuffled)).toBe(canonicalize(card));
  });

  it('serializes undefined array elements as null and drops undefined members', () => {
    expect(canonicalize([1, undefined, 2])).toBe('[1,null,2]');
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('rejects undefined and non-finite numbers', () => {
    expect(() => canonicalize(undefined)).toThrow();
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow();
  });
});
