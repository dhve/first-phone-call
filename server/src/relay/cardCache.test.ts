import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalizeJson } from './canonicalJson.js';
import { validateCardUpload } from './cardCache.js';
import type { Es256PublicJwk } from './cardSigning.js';
import { buildPersonalUrn } from '../urn.js';

const EMAIL = 'vedh@example.com';
const SLUG = 'phone-agent';

let publicJwk: Es256PublicJwk;
let privateJwk: JsonWebKey;

function makeCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Phone Agent',
    description: 'runs on my phone',
    version: '1.0',
    _meta: { identifier: buildPersonalUrn(EMAIL, SLUG) },
    ...overrides,
  };
}

function signCard(card: Record<string, unknown>): string {
  const key = createPrivateKey({ key: privateJwk, format: 'jwk' });
  return cryptoSign('sha256', Buffer.from(canonicalizeJson(card), 'utf8'), {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  publicJwk = (await exportJWK(publicKey)) as unknown as Es256PublicJwk;
  privateJwk = (await exportJWK(privateKey)) as JsonWebKey;
});

describe('validateCardUpload', () => {
  it('accepts a correctly signed card with a greater version', () => {
    const card = makeCard();
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 2,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: 1,
      publicKeyJwk: publicJwk,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.canonicalCard).toBe(canonicalizeJson(card));
    }
  });

  it('accepts the first upload when nothing is stored', () => {
    const card = makeCard();
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an equal version as stale', () => {
    const card = makeCard();
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 3,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: 3,
      publicKeyJwk: publicJwk,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'STALE_VERSION' } });
  });

  it('rejects a lower version as stale', () => {
    const card = makeCard();
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 2,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: 5,
      publicKeyJwk: publicJwk,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'STALE_VERSION' } });
  });

  it('rejects a card whose URN email does not match the account', () => {
    const card = makeCard({ _meta: { identifier: buildPersonalUrn('other@example.com', SLUG) } });
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'IDENTITY_MISMATCH' } });
  });

  it('rejects a card whose URN slug does not match the route slug', () => {
    const card = makeCard({ _meta: { identifier: buildPersonalUrn(EMAIL, 'different-slug') } });
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'IDENTITY_MISMATCH' } });
  });

  it('rejects a card without a personal URN identifier', () => {
    const card = makeCard({ _meta: {} });
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_CARD' } });
  });

  it('rejects a tampered card as an invalid signature', () => {
    const card = makeCard();
    const signature = signCard(card);
    const tampered = { ...card, description: 'tampered' };
    const result = validateCardUpload({
      card: tampered,
      signature,
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_SIGNATURE' } });
  });

  it('verifies independently of card key ordering (canonicalization)', () => {
    const card = makeCard();
    const signature = signCard(card);
    const reordered = JSON.parse(
      JSON.stringify({ _meta: card._meta, version: card.version, description: card.description, name: card.name }),
    ) as Record<string, unknown>;
    const result = validateCardUpload({
      card: reordered,
      signature,
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a signature made with a different key', async () => {
    const other = await generateKeyPair('ES256', { extractable: true });
    const otherPublic = (await exportJWK(other.publicKey)) as unknown as Es256PublicJwk;
    const card = makeCard();
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: otherPublic,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_SIGNATURE' } });
  });

  it('rejects non-integer versions', () => {
    const card = makeCard();
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1.5,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_CARD' } });
  });
});
