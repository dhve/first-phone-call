import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalizeJson } from './canonicalJson.js';
import { buildRuntimeUrl, validateCardUpload } from './cardCache.js';
import type { Es256PublicJwk } from './cardSigning.js';
import { buildPersonalUrn } from '../urn.js';

const EMAIL = 'vedh@example.com';
const SLUG = 'phone-agent';
const PUBLIC_BASE_URL = 'https://agentcards.host39.org';
const RUNTIME_URL = buildRuntimeUrl(PUBLIC_BASE_URL, EMAIL, SLUG);

let publicJwk: Es256PublicJwk;
let privateJwk: JsonWebKey;

function makeCard(version = 1, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Phone Agent',
    description: 'runs on my phone',
    version,
    url: RUNTIME_URL,
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

describe('buildRuntimeUrl', () => {
  it('builds publicBaseUrl + /a2a/personal/<handle>/<slug> with a URI-encoded handle', () => {
    expect(RUNTIME_URL).toBe('https://agentcards.host39.org/a2a/personal/vedh%40example.com/phone-agent');
  });
});

describe('validateCardUpload', () => {
  it('accepts a correctly signed card with a greater version', () => {
    const card = makeCard(2);
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 2,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: 1,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
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
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an equal version as stale', () => {
    const card = makeCard(3);
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 3,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: 3,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'STALE_VERSION' } });
  });

  it('rejects a lower version as stale', () => {
    const card = makeCard(2);
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 2,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: 5,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'STALE_VERSION' } });
  });

  it('rejects a card whose version does not equal the upload version', () => {
    const card = makeCard(1);
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 2,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: 1,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'CARD_VERSION_MISMATCH' } });
  });

  it('rejects a card without a version', () => {
    const card = makeCard(1);
    delete card.version;
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'CARD_VERSION_MISMATCH' } });
  });

  it('rejects a string card version even when it spells the upload version', () => {
    const card = makeCard(1, { version: '1' });
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'CARD_VERSION_MISMATCH' } });
  });

  it('rejects a card without a url', () => {
    const card = makeCard(1);
    delete card.url;
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_CARD' } });
  });

  it('rejects a card whose url is not the runtime URL for its handle and slug', () => {
    const card = makeCard(1, { url: `${PUBLIC_BASE_URL}/a2a/personal/vedh%40example.com/other-slug` });
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_CARD' } });
  });

  it('accepts the raw-email spelling of the runtime URL handle', () => {
    const card = makeCard(1, { url: `${PUBLIC_BASE_URL}/a2a/personal/${EMAIL}/${SLUG}` });
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a card whose URN email does not match the account', () => {
    const card = makeCard(1, { _meta: { identifier: buildPersonalUrn('other@example.com', SLUG) } });
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'IDENTITY_MISMATCH' } });
  });

  it('rejects a card whose URN slug does not match the route slug', () => {
    const card = makeCard(1, { _meta: { identifier: buildPersonalUrn(EMAIL, 'different-slug') } });
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'IDENTITY_MISMATCH' } });
  });

  it('rejects a card without a personal URN identifier', () => {
    const card = makeCard(1, { _meta: {} });
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_CARD' } });
  });

  it('rejects a tampered card as an invalid signature', () => {
    const card = makeCard(1);
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
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_SIGNATURE' } });
  });

  it('verifies independently of card key ordering (canonicalization)', () => {
    const card = makeCard(1);
    const signature = signCard(card);
    const reordered = JSON.parse(
      JSON.stringify({
        _meta: card._meta,
        url: card.url,
        version: card.version,
        description: card.description,
        name: card.name,
      }),
    ) as Record<string, unknown>;
    const result = validateCardUpload({
      card: reordered,
      signature,
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a signature made with a different key', async () => {
    const other = await generateKeyPair('ES256', { extractable: true });
    const otherPublic = (await exportJWK(other.publicKey)) as unknown as Es256PublicJwk;
    const card = makeCard(1);
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: otherPublic,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_SIGNATURE' } });
  });

  it('rejects non-integer versions', () => {
    const card = makeCard(1);
    const result = validateCardUpload({
      card,
      signature: signCard(card),
      version: 1.5,
      slug: SLUG,
      accountEmail: EMAIL,
      storedVersion: null,
      publicKeyJwk: publicJwk,
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_CARD' } });
  });
});
