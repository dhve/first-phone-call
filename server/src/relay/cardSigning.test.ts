import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { isEs256PublicJwk, verifyEs256 } from './cardSigning.js';
import type { Es256PublicJwk } from './cardSigning.js';

let publicJwk: Es256PublicJwk;
let privateJwk: JsonWebKey;

function signPayload(payload: string, dsaEncoding: 'ieee-p1363' | 'der' = 'ieee-p1363'): string {
  const key = createPrivateKey({ key: privateJwk, format: 'jwk' });
  return cryptoSign('sha256', Buffer.from(payload, 'utf8'), { key, dsaEncoding }).toString('base64url');
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  publicJwk = (await exportJWK(publicKey)) as unknown as Es256PublicJwk;
  privateJwk = (await exportJWK(privateKey)) as JsonWebKey;
});

describe('isEs256PublicJwk', () => {
  it('accepts a jose-generated ES256 public JWK', () => {
    expect(isEs256PublicJwk(publicJwk)).toBe(true);
  });

  it('rejects malformed keys', () => {
    expect(isEs256PublicJwk(null)).toBe(false);
    expect(isEs256PublicJwk('key')).toBe(false);
    expect(isEs256PublicJwk({ kty: 'RSA', n: 'x', e: 'AQAB' })).toBe(false);
    expect(isEs256PublicJwk({ kty: 'EC', crv: 'P-384', x: 'a', y: 'b' })).toBe(false);
    expect(isEs256PublicJwk({ kty: 'EC', crv: 'P-256', x: 'a' })).toBe(false);
  });

  it('rejects private keys', () => {
    expect(isEs256PublicJwk(privateJwk)).toBe(false);
  });
});

describe('verifyEs256', () => {
  it('verifies an ES256 sign/verify roundtrip (raw r||s signature)', () => {
    const payload = '{"a":1,"b":"two"}';
    const signature = signPayload(payload);
    expect(verifyEs256(publicJwk, payload, signature)).toBe(true);
  });

  it('verifies DER-encoded signatures (Android Keystore style)', () => {
    const payload = '{"card":true}';
    const signature = signPayload(payload, 'der');
    expect(verifyEs256(publicJwk, payload, signature)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const signature = signPayload('{"a":1}');
    expect(verifyEs256(publicJwk, '{"a":2}', signature)).toBe(false);
  });

  it('rejects a signature from a different key', async () => {
    const other = await generateKeyPair('ES256', { extractable: true });
    const otherPublic = (await exportJWK(other.publicKey)) as unknown as Es256PublicJwk;
    const signature = signPayload('{"a":1}');
    expect(verifyEs256(otherPublic, '{"a":1}', signature)).toBe(false);
  });

  it('rejects garbage signatures without throwing', () => {
    expect(verifyEs256(publicJwk, '{"a":1}', '')).toBe(false);
    expect(verifyEs256(publicJwk, '{"a":1}', 'not-a-signature')).toBe(false);
    expect(verifyEs256(publicJwk, '{"a":1}', Buffer.alloc(64).toString('base64url'))).toBe(false);
  });
});
