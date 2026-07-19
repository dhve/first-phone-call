import { API_PATHS, SERVER, emailHandle } from '../config';
import { loadSettings } from '../storage/appStorage';
import { getHost39Jwt } from '../storage/secureStore';
import type { DevicePublicKeyJwk } from '../../modules/host39-native';

/** Thin fetch wrapper for the Host39 server API (server/src/routes). */

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ServerCard {
  id: string;
  user_id: string;
  slug: string;
  display_name: string;
  description: string | null;
  runtime_url: string | null;
  version: string;
  capabilities: Record<string, unknown>;
  authentication: Record<string, unknown>;
  skills: unknown[];
  provider_name: string | null;
  provider_url: string | null;
  status: string;
}

export interface UserProfile {
  user_id: string;
  email: string;
  display_name: string | null;
  identity_type: string;
  domain: string | null;
}

export function getBaseUrl(): string {
  return (loadSettings().serverBaseUrl || SERVER.defaultBaseUrl).replace(/\/+$/, '');
}

/**
 * Base URL other agents reach the server on (used in the signed card's url
 * and NANDA registry_url). Defaults to the configured server base URL.
 */
export function getPublicBaseUrl(): string {
  return (loadSettings().publicBaseUrl || '').replace(/\/+$/, '') || getBaseUrl();
}

/** WS URL for the relay, derived from the HTTP base URL. */
export function getRelayWsUrl(): string {
  return getBaseUrl().replace(/^http/, 'ws') + API_PATHS.relayWs;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.auth !== false) {
    const token = await getHost39Jwt();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, `Cannot reach server at ${getBaseUrl()}: ${(e as Error).message}`);
  }

  if (response.status === 204) return undefined as T;

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

// Auth

export function login(email: string, password: string): Promise<{ token: string }> {
  return request(API_PATHS.login, { method: 'POST', body: { email, password }, auth: false });
}

export function registerAccount(email: string, password: string): Promise<{ token: string }> {
  return request(API_PATHS.register, {
    method: 'POST',
    body: { email, password, identity_type: 'email' },
    auth: false,
  });
}

export function me(): Promise<UserProfile> {
  return request(API_PATHS.me);
}

// Cards (server-side CRUD, used to keep the DB record in sync before caching)

export function listServerCards(): Promise<ServerCard[]> {
  return request(API_PATHS.cards);
}

export function createServerCard(body: Record<string, unknown>): Promise<ServerCard> {
  return request(API_PATHS.cards, { method: 'POST', body });
}

export function updateServerCard(id: string, body: Record<string, unknown>): Promise<ServerCard> {
  return request(`${API_PATHS.cards}/${id}`, { method: 'PUT', body });
}

// Device + relay endpoints (server/src/routes/devices.ts, mobile.ts)

export interface RegisteredDevice {
  id: string;
  name: string | null;
  connected: boolean;
}

export function registerDevice(publicKeyJwk: DevicePublicKeyJwk): Promise<RegisteredDevice> {
  return request(API_PATHS.devices, {
    method: 'POST',
    body: { name: 'Android phone', public_key: publicKeyJwk },
  });
}

export interface RelaySession {
  token: string;
  expires_at: string;
  ws_url: string;
}

/** Mint a short-lived single-use WebSocket credential for this device. */
export function mintRelaySession(deviceId: string): Promise<RelaySession> {
  return request(API_PATHS.relaySession(deviceId), { method: 'POST' });
}

/**
 * Publish the signed card cache: integer version (strictly increasing) plus
 * an ES256 signature over the RFC 8785 canonicalized card JSON, verified by
 * the server against the registered device key.
 */
export function putCardCache(
  slug: string,
  body: {
    device_id: string;
    card: Record<string, unknown>;
    signature: string;
    version: number;
  },
): Promise<{ ok: boolean; slug: string; version: number }> {
  return request(API_PATHS.cardCache(slug), { method: 'PUT', body });
}

/**
 * True when the public card URL resolves to the signed card. Uses the public
 * base URL and the account handle, matching the URL NANDA registrations
 * advertise as registry_url.
 */
export async function checkPublicResolution(email: string, slug: string): Promise<boolean> {
  try {
    const url = `${getPublicBaseUrl()}${API_PATHS.publicCard(emailHandle(email), slug)}`;
    const response = await fetch(url);
    if (!response.ok) return false;
    const card = (await response.json()) as { name?: unknown } | null;
    return !!card && typeof card.name === 'string';
  } catch {
    return false;
  }
}
