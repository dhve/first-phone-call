import { canonicalizeJson } from './canonicalJson.js';
import { isEs256PublicJwk, verifyEs256 } from './cardSigning.js';
import { parsePersonalUrn } from '../urn.js';

export type CardUploadRejection =
  | { code: 'INVALID_CARD'; detail: string }
  | { code: 'STALE_VERSION'; detail: string }
  | { code: 'IDENTITY_MISMATCH'; detail: string }
  | { code: 'INVALID_SIGNATURE'; detail: string };

export interface CardUploadInput {
  card: unknown;
  /** base64url ES256 signature over the RFC 8785 canonicalized card JSON. */
  signature: string;
  version: number;
  slug: string;
  accountEmail: string;
  /** Currently cached version for (account, slug), or null when none. */
  storedVersion: number | null;
  /** The device's registered ES256 public JWK. */
  publicKeyJwk: unknown;
}

export type CardUploadResult =
  | { ok: true; canonicalCard: string }
  | { ok: false; rejection: CardUploadRejection };

/** Extracts the agent URN from a card (_meta.identifier, or identifier). */
export function extractCardUrn(card: Record<string, unknown>): string | null {
  const meta = card._meta;
  if (typeof meta === 'object' && meta !== null) {
    const identifier = (meta as Record<string, unknown>).identifier;
    if (typeof identifier === 'string') return identifier;
  }
  if (typeof card.identifier === 'string') return card.identifier;
  return null;
}

/**
 * Validates a signed card upload: version must be strictly greater than
 * the stored one, the card URN must match the account email and slug,
 * and the ES256 signature must verify over the canonicalized card JSON
 * with the device's registered key.
 */
export function validateCardUpload(input: CardUploadInput): CardUploadResult {
  const { card, signature, version, slug, accountEmail, storedVersion, publicKeyJwk } = input;

  if (typeof card !== 'object' || card === null || Array.isArray(card)) {
    return { ok: false, rejection: { code: 'INVALID_CARD', detail: 'card must be a JSON object' } };
  }
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, rejection: { code: 'INVALID_CARD', detail: 'version must be a positive integer' } };
  }
  if (storedVersion !== null && version <= storedVersion) {
    return {
      ok: false,
      rejection: {
        code: 'STALE_VERSION',
        detail: `version ${version} is not greater than stored version ${storedVersion}`,
      },
    };
  }

  const urn = extractCardUrn(card as Record<string, unknown>);
  if (!urn) {
    return { ok: false, rejection: { code: 'INVALID_CARD', detail: 'card is missing a URN identifier' } };
  }
  const parsed = parsePersonalUrn(urn);
  if (!parsed) {
    return { ok: false, rejection: { code: 'INVALID_CARD', detail: 'card identifier is not a personal agent URN' } };
  }
  if (parsed.email !== accountEmail) {
    return {
      ok: false,
      rejection: { code: 'IDENTITY_MISMATCH', detail: 'card URN email does not match the account email' },
    };
  }
  if (parsed.slug !== slug) {
    return {
      ok: false,
      rejection: { code: 'IDENTITY_MISMATCH', detail: 'card URN slug does not match the requested slug' },
    };
  }

  if (!isEs256PublicJwk(publicKeyJwk)) {
    return {
      ok: false,
      rejection: { code: 'INVALID_SIGNATURE', detail: 'device key is not a valid ES256 public JWK' },
    };
  }

  let canonicalCard: string;
  try {
    canonicalCard = canonicalizeJson(card);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'card is not canonicalizable JSON';
    return { ok: false, rejection: { code: 'INVALID_CARD', detail } };
  }

  if (!verifyEs256(publicKeyJwk, canonicalCard, signature)) {
    return {
      ok: false,
      rejection: { code: 'INVALID_SIGNATURE', detail: 'signature does not verify against the device key' },
    };
  }

  return { ok: true, canonicalCard };
}
