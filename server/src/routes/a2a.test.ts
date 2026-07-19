import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerA2ARoutes } from './a2a.js';
import { closeSql } from '../db/client.js';
import { RelayRegistry } from '../relay/registry.js';

const MAX_BYTES = 1024;
const URL_PATH = '/a2a/personal/vedh%40example.com/phone-agent';

let fastify: FastifyInstance;
let registry: RelayRegistry;

beforeAll(async () => {
  // The route only needs config + a lazily created sql client; no query
  // runs before validation, so no live database is required here.
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://host39:host39@localhost:5434/host39';
  process.env.RUNTIME_MAX_REQUEST_BYTES = String(MAX_BYTES);

  fastify = Fastify();
  await fastify.register(rateLimit, { global: false });
  registry = new RelayRegistry({ heartbeatIntervalMs: 60_000, maxMissedHeartbeats: 2 });
  await registerA2ARoutes(fastify, registry);
  await fastify.ready();
});

afterAll(async () => {
  registry.shutdown();
  await fastify.close();
  await closeSql();
});

describe('POST /a2a/personal/:handle/:slug body handling', () => {
  it('rejects a raw body over RUNTIME_MAX_REQUEST_BYTES with the oversized JSON-RPC error', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'message/send',
      params: { message: { parts: [{ kind: 'text', text: 'x'.repeat(MAX_BYTES) }] } },
    });
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(MAX_BYTES);

    const response = await fastify.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { 'content-type': 'application/json' },
      payload: body,
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32010, message: 'Request too large' },
    });
  });

  it('rejects malformed JSON with the parse JSON-RPC error', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  });

  it('still returns structured validation errors for bodies under the cap', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '1.0', id: 'req-1', method: 'message/send', params: {} }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      error: { code: -32600, message: 'Invalid request' },
    });
  });
});
