import { getAuthToken } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_HOST39_API_URL ?? "";

export class ApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const errorCode = typeof obj["error"] === "string" ? obj["error"] : null;
    const detail = typeof obj["detail"] === "string" ? obj["detail"] : null;
    const message =
      detail && errorCode ? `${errorCode} — ${detail}` :
      detail ?? errorCode ??
      (typeof obj["message"] === "string" ? obj["message"] : `Request failed with status ${res.status}`);
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? getAuthToken() : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = !!init?.body;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  return parseApiResponse<T>(res);
}

// Auth
export async function registerUser(payload: {
  email: string;
  password: string;
  display_name?: string;
  identity_type?: "domain" | "email";
  domain?: string;
}): Promise<string> {
  const res = await request<{ token: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.token;
}

export async function loginUser(email: string, password: string): Promise<string> {
  const res = await request<{ token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return res.token;
}

export interface Me {
  user_id: string;
  email: string;
  display_name: string | null;
  identity_type: "domain" | "email";
  domain: string | null;
}

export async function getMe(): Promise<Me> {
  return request<Me>("/auth/me");
}

// Agent cards
export interface AgentCard {
  id: string;
  user_id: string;
  slug: string;
  display_name: string;
  description: string | null;
  runtime_url: string | null;
  version: string;
  capabilities: { streaming: boolean; pushNotifications: boolean };
  authentication: { schemes: string[] };
  skills: unknown[];
  provider_name: string | null;
  provider_url: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

export async function listCards(): Promise<AgentCard[]> {
  return request<AgentCard[]>("/cards");
}

export async function getCard(id: string): Promise<AgentCard> {
  return request<AgentCard>(`/cards/${encodeURIComponent(id)}`);
}

export interface CreateCardPayload {
  slug: string;
  display_name: string;
  description?: string;
  runtime_url?: string;
  version?: string;
  capabilities?: { streaming?: boolean; pushNotifications?: boolean };
  authentication?: { schemes?: string[] };
  skills?: unknown[];
  provider_name?: string;
  provider_url?: string;
}

export async function createCard(payload: CreateCardPayload): Promise<AgentCard> {
  return request<AgentCard>("/cards", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateCard(id: string, payload: Partial<CreateCardPayload> & { status?: string }): Promise<AgentCard> {
  return request<AgentCard>(`/cards/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteCard(id: string): Promise<void> {
  await request<null>(`/cards/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// URL generation helpers (client-side preview)
//
// Public agent cards are served from the card-serving host (in production,
// `agentcards.host39.org`), which is a *different* origin from the API/dashboard
// host (`host39.org`). Use NEXT_PUBLIC_HOST39_CARDS_URL so the URL we show and
// copy actually resolves. Fall back to the API URL for local dev, where the API
// serves cards on the same origin.
const CARDS_BASE =
  process.env.NEXT_PUBLIC_HOST39_CARDS_URL ??
  process.env.NEXT_PUBLIC_HOST39_API_URL ??
  "http://localhost:3010";

export function getPublicUrl(
  identityType: "domain" | "email",
  domainOrEmail: string,
  slug: string,
  baseUrl?: string
): string {
  const base = baseUrl ?? CARDS_BASE;
  if (identityType === "domain") {
    return `${base}/${domainOrEmail}/${slug}.json`;
  }
  return `${base}/personal/${encodeURIComponent(domainOrEmail)}/${slug}.json`;
}
