import { NANDA } from '../config';
import { loadSettings } from '../storage/appStorage';
import { getNandaJwt } from '../storage/secureStore';
import { ApiError } from './client';
import type { NandaOrgPayload } from '../nanda/registration';

/**
 * Thin fetch wrapper for a NANDA index server (nanda-index-v2 API).
 * Auth: email/password against /auth/register and /auth/login, then a JWT
 * on the protected org routes. Index records are public reads.
 */

export interface NandaIndexRecord {
  org_id: string;
  display_name: string;
  registry_url: string | null;
  status: 'pending' | 'active' | 'suspended';
  email_verified: boolean;
  identifier?: string;
  media_type?: string;
}

export interface NandaResolveResponse {
  locator: string;
  identifier: string;
  index_record: NandaIndexRecord;
}

export interface RetrievedNandaAgentCard {
  cardUrl: string;
  resolution: NandaResolveResponse;
  card: Record<string, unknown>;
}

export function getNandaBaseUrl(): string {
  return (loadSettings().nandaApiUrl || NANDA.defaultApiUrl).replace(/\/+$/, '');
}

async function nandaRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.auth !== false) {
    const token = await getNandaJwt();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${getNandaBaseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, `Cannot reach NANDA at ${getNandaBaseUrl()}: ${(e as Error).message}`);
  }

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    // non-JSON body; fall through with null payload
  }

  if (!response.ok) {
    const detail = payload?.detail || payload?.error || `HTTP ${response.status}`;
    throw new ApiError(response.status, detail, payload?.error);
  }
  return payload as T;
}

// Auth (returns a NANDA JWT; the caller stores it via secureStore)

export function nandaLogin(email: string, password: string): Promise<{ token: string }> {
  return nandaRequest(NANDA.paths.login, {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
}

export function nandaRegisterAccount(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ token: string }> {
  return nandaRequest(NANDA.paths.register, {
    method: 'POST',
    body: { email, password, ...(displayName ? { display_name: displayName } : {}) },
    auth: false,
  });
}

// Registration + status

/** POST /api/v1/orgs: registers the agent; the index emails a verify link. */
export function createNandaOrg(payload: NandaOrgPayload): Promise<NandaIndexRecord> {
  return nandaRequest(NANDA.paths.orgs, { method: 'POST', body: payload });
}

/** GET /api/v1/index/:org_id; null when the record does not exist. */
export async function getNandaIndexRecord(orgId: string): Promise<NandaIndexRecord | null> {
  try {
    return await nandaRequest<NandaIndexRecord>(NANDA.paths.indexRecord(orgId), { auth: false });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Resolve an agent URN to the index record that advertises its card URL. */
export function resolveNandaAgent(locator: string): Promise<NandaResolveResponse> {
  return nandaRequest<NandaResolveResponse>(
    `${NANDA.paths.resolve}?locator=${encodeURIComponent(locator)}`,
    { auth: false },
  );
}

/**
 * Resolve a directly registered A2A card through NANDA, then retrieve it from
 * the returned registry_url. The identity check prevents a stale or incorrect
 * index pointer from being reported as a successful resolution.
 */
export async function retrieveNandaAgentCard(locator: string): Promise<RetrievedNandaAgentCard> {
  const resolution = await resolveNandaAgent(locator);
  const record = resolution.index_record;

  if (!record.registry_url) {
    throw new ApiError(0, 'NANDA resolution returned no registry_url');
  }
  if (record.media_type && record.media_type !== 'application/a2a-agent-card+json') {
    throw new ApiError(0, `Unsupported NANDA media type: ${record.media_type}`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(record.registry_url);
  } catch {
    throw new ApiError(0, 'NANDA resolution returned an invalid registry_url');
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new ApiError(0, `Unsupported agent card URL protocol: ${parsedUrl.protocol}`);
  }

  let response: Response;
  try {
    response = await fetch(parsedUrl.toString(), {
      headers: { Accept: 'application/a2a-agent-card+json, application/json' },
    });
  } catch (e) {
    throw new ApiError(0, `Cannot retrieve registered agent card: ${(e as Error).message}`);
  }

  let card: unknown = null;
  try {
    card = await response.json();
  } catch {
    throw new ApiError(response.status, 'Registered agent card did not return JSON');
  }
  if (!response.ok) {
    const detail =
      card && typeof card === 'object' && 'detail' in card
        ? String((card as { detail: unknown }).detail)
        : `HTTP ${response.status}`;
    throw new ApiError(response.status, `Cannot retrieve registered agent card: ${detail}`);
  }
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new ApiError(response.status, 'Registered agent card is not a JSON object');
  }

  const identifier = (card as { _meta?: { identifier?: unknown } })._meta?.identifier;
  if (identifier !== locator) {
    throw new ApiError(0, 'Retrieved agent card identity does not match the requested NANDA locator');
  }

  return {
    cardUrl: parsedUrl.toString(),
    resolution,
    card: card as Record<string, unknown>,
  };
}
