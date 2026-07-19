import { vi } from 'vitest';
import { MODEL } from '../config';
import type { LocalCard } from '../storage/appStorage';
import type { RequestEnvelope } from '../relay/envelope';

/**
 * Shared harness for hostingService-level tests: fresh module registry per
 * boot (the service is a singleton), a scriptable fake Host39Native module,
 * and a fetch stub for the Host39 server API.
 */

export interface FakeHealth {
  batteryLevel: number;
  charging: boolean;
  thermal: string;
  online: boolean;
}

export function createFakeNative() {
  const listeners: Record<string, ((payload?: unknown) => void)[]> = {};
  const sent: string[] = [];
  let health: FakeHealth = { batteryLevel: 80, charging: true, thermal: 'none', online: true };
  let sha256 = MODEL.sha256;

  const mod = {
    addListener(name: string, fn: (payload?: unknown) => void) {
      (listeners[name] ??= []).push(fn);
      return { remove: () => undefined };
    },
    removeAllListeners(name: string) {
      listeners[name] = [];
    },
    getPublicKeyJwk: async () => ({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', alg: 'ES256' }),
    sign: async () => 'c2lnbmF0dXJl',
    sha256File: async () => sha256,
    deviceHealth: async () => health,
    startRelayService: vi.fn(async () => undefined),
    stopRelayService: vi.fn(async () => undefined),
    updateHostJwt: vi.fn(async () => undefined),
    provideRelayToken: vi.fn(async () => undefined),
    sendRelayMessage: vi.fn(async (json: string) => {
      sent.push(json);
      return true;
    }),
    getRelayState: () => 'stopped',
  };

  return {
    mod,
    sent,
    emit(name: string, payload?: unknown) {
      for (const fn of listeners[name] ?? []) fn(payload);
    },
    setHealth(patch: Partial<FakeHealth>) {
      health = { ...health, ...patch };
    },
    setSha256(hex: string) {
      sha256 = hex;
    },
  };
}

export type FakeNative = ReturnType<typeof createFakeNative>;

/** Default fetch stub covering the Host39 endpoints startHosting touches. */
export function stubServerFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/relay-session')) {
        return jsonResponse({
          token: 'relay-token',
          expires_at: new Date().toISOString(),
          ws_url: 'ws://host/relay?token=relay-token',
        });
      }
      if (url.endsWith('/cards')) return jsonResponse([]);
      return jsonResponse({});
    }),
  );
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Boot a fresh hostingService with mocked modules. Returns the service, the
 * fake native module, and the freshly-imported mock/storage modules.
 */
export async function bootHostingService() {
  vi.resetModules();
  vi.unstubAllGlobals();

  const fs = await import('./mocks/expo-file-system');
  const secure = await import('./mocks/expo-secure-store');
  const core = await import('./mocks/expo-modules-core');
  const llama = await import('./mocks/llama.rn');
  fs.__reset();
  secure.__reset();
  core.__reset();
  llama.__reset();

  const native = createFakeNative();
  core.__setNativeModule('Host39Native', native.mod);

  stubServerFetch();

  const storage = await import('../storage/appStorage');
  const secureStore = await import('../storage/secureStore');
  const { hostingService } = await import('../hosting/hostingService');

  return { hostingService, native, fs, llama, storage, secureStore };
}

/** A published local card, saved straight through storage. */
export function cardFixture(slug: string, patch: Partial<LocalCard> = {}): LocalCard {
  return {
    name: `Agent ${slug}`,
    description: `The ${slug} agent`,
    skills: [{ id: 'faq', name: 'faq', description: 'Answers questions' }],
    allowWrites: false,
    version: 1,
    updatedAt: new Date().toISOString(),
    ...patch,
    slug,
  };
}

export function requestEnvelope(
  slug: string,
  patch: Partial<Omit<RequestEnvelope, 'method'>> & { method?: string } = {},
): RequestEnvelope {
  return {
    type: 'request',
    id: `req-${Math.random().toString(36).slice(2, 8)}`,
    method: 'message/send',
    slug,
    params: { message: { role: 'user', parts: [{ kind: 'text', text: 'hello there' }] } },
    deadline: Date.now() + 60_000,
    ...patch,
  } as RequestEnvelope;
}

/** Wait until the fake native captured `count` outbound frames. */
export async function waitForSent(native: FakeNative, count: number, timeoutMs = 2000): Promise<string[]> {
  const start = Date.now();
  while (native.sent.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${count} sent frames (got ${native.sent.length})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return native.sent;
}
