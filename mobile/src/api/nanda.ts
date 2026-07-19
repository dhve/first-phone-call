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
