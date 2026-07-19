import { describe, expect, it } from 'vitest';
import { canonicalizeJson } from './canonicalJson.js';

describe('canonicalizeJson (RFC 8785 subset)', () => {
  it('serializes scalars', () => {
    expect(canonicalizeJson(null)).toBe('null');
    expect(canonicalizeJson(true)).toBe('true');
    expect(canonicalizeJson(false)).toBe('false');
    expect(canonicalizeJson(42)).toBe('42');
    expect(canonicalizeJson(-0)).toBe('0');
    expect(canonicalizeJson(1e21)).toBe('1e+21');
    expect(canonicalizeJson('hi')).toBe('"hi"');
  });

  it('sorts object keys by UTF-16 code units', () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    // 'Z' (90) < 'a' (97) < 'é' (233)
    expect(canonicalizeJson({ 'é': 1, a: 2, Z: 3 })).toBe('{"Z":3,"a":2,"é":1}');
  });

  it('emits no insignificant whitespace and recurses into arrays', () => {
    expect(canonicalizeJson({ list: [1, { y: 2, x: 3 }, 'z'] })).toBe('{"list":[1,{"x":3,"y":2},"z"]}');
  });

  it('omits undefined object members like JSON.stringify', () => {
    expect(canonicalizeJson({ a: 1, skip: undefined })).toBe('{"a":1}');
  });

  it('is stable across a JSON round-trip', () => {
    const value = {
      name: 'Phone Agent',
      version: 3,
      capabilities: { streaming: false, pushNotifications: false },
      skills: [{ name: 'chat', tags: ['text', 'a2a'] }],
      _meta: { identifier: 'urn:ai:email:a@b.co:agent:phone' },
    };
    const canonical = canonicalizeJson(value);
    expect(canonicalizeJson(JSON.parse(canonical))).toBe(canonical);
  });

  it('is order-insensitive for equivalent objects', () => {
    const a = { x: 1, y: { b: 2, a: 3 } };
    const b = { y: { a: 3, b: 2 }, x: 1 };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
  });

  it('rejects non-JSON values', () => {
    expect(() => canonicalizeJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalizeJson(undefined)).toThrow(TypeError);
    expect(() => canonicalizeJson(() => 1)).toThrow(TypeError);
    expect(() => canonicalizeJson(10n as unknown)).toThrow(TypeError);
  });
});
