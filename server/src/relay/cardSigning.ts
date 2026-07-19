import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';

/** ES256 (EC P-256) public key as a JWK, as produced by the Android Keystore. */
export interface Es256PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  [key: string]: unknown;
}

export function isEs256PublicJwk(jwk: unknown): jwk is Es256PublicJwk {
  if (typeof jwk !== 'object' || jwk === null || Array.isArray(jwk)) return false;
  const candidate = jwk as Record<string, unknown>;
  return (
    candidate.kty === 'EC' &&
    candidate.crv === 'P-256' &&
    typeof candidate.x === 'string' &&
    typeof candidate.y === 'string' &&
    candidate.d === undefined
  );
}

/**
 * Verifies an ES256 signature (base64url) over a payload.
 * Accepts both raw r||s (JWS style, 64 bytes) and DER-encoded signatures
 * (as produced by Android Keystore's SHA256withECDSA).
 * Never throws; any failure returns false.
 */
export function verifyEs256(jwk: Es256PublicJwk, payload: string | Uint8Array, signatureB64u: string): boolean {
  if (typeof signatureB64u !== 'string' || signatureB64u === '') return false;

  const signature = Buffer.from(signatureB64u, 'base64url');
  if (signature.length === 0) return false;

  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);

  try {
    const key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
    const dsaEncoding = signature.length === 64 ? 'ieee-p1363' : 'der';
    return cryptoVerify('sha256', data, { key, dsaEncoding }, signature);
  } catch {
    return false;
  }
}
