import type { FastifyInstance } from 'fastify';
import { getSql } from '../db/client.js';
import { buildConfig } from '../config.js';
import { isEs256PublicJwk } from '../relay/cardSigning.js';
import { PgRelaySessionStore, issueRelayToken } from '../relay/tokens.js';
import type { DbDevice } from '../types.js';

const apiErrorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    detail: { type: 'string' },
  },
} as const;

const deviceSchema = {
  type: 'object',
  properties: {
    id:                { type: 'string' },
    name:              { type: 'string', nullable: true },
    public_key:        { type: 'object' },
    connected:         { type: 'boolean' },
    connected_at:      { type: 'string', nullable: true },
    last_heartbeat_at: { type: 'string', nullable: true },
    created_at:        { type: 'string' },
    last_seen_at:      { type: 'string' },
  },
} as const;

interface RegisterDeviceBody {
  name?: string;
  public_key: Record<string, unknown>;
}

function mapDevice(device: DbDevice) {
  return {
    id:                device.id,
    name:              device.name,
    public_key:        device.publicKeyJwk,
    connected:         device.connectedAt !== null,
    connected_at:      device.connectedAt,
    last_heartbeat_at: device.lastHeartbeatAt,
    created_at:        device.createdAt,
    last_seen_at:      device.lastSeenAt,
  };
}

export async function registerDeviceRoutes(fastify: FastifyInstance): Promise<void> {
  const sql = getSql();
  const config = buildConfig();
  const sessionStore = new PgRelaySessionStore(sql);

  // POST /devices - register a phone with its Android Keystore ES256 public key
  fastify.post<{ Body: RegisterDeviceBody }>(
    '/devices',
    {
      schema: {
        tags: ['devices'],
        summary: 'Register a device with its ES256 public key (JWK)',
        body: {
          type: 'object',
          required: ['public_key'],
          additionalProperties: false,
          properties: {
            name:       { type: 'string', maxLength: 255 },
            public_key: { type: 'object' },
          },
        },
        response: {
          201: deviceSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { userId } = request.user;
      const { name, public_key } = request.body;

      if (!isEs256PublicJwk(public_key)) {
        return reply.code(400).send({
          error: 'INVALID_PUBLIC_KEY',
          detail: 'public_key must be an ES256 (EC P-256) public JWK with kty, crv, x, and y',
        });
      }

      const [device] = await sql<DbDevice[]>`
        INSERT INTO devices (user_id, name, public_key_jwk)
        VALUES (
          ${userId},
          ${name ?? null},
          ${sql.json(JSON.parse(JSON.stringify(public_key)))}
        )
        RETURNING *
      `;

      if (!device) {
        return reply.code(500).send({ error: 'internal_server_error' });
      }

      return reply.code(201).send(mapDevice(device));
    },
  );

  // GET /devices - list the caller's devices
  fastify.get(
    '/devices',
    {
      schema: {
        tags: ['devices'],
        summary: 'List devices for the current user',
        response: {
          200: { type: 'array', items: deviceSchema },
          401: apiErrorSchema,
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { userId } = request.user;
      const devices = await sql<DbDevice[]>`
        SELECT * FROM devices WHERE user_id = ${userId} ORDER BY created_at DESC
      `;
      return reply.send(devices.map(mapDevice));
    },
  );

  // POST /devices/:id/relay-session - mint a short-lived single-use WS credential
  fastify.post<{ Params: { id: string } }>(
    '/devices/:id/relay-session',
    {
      schema: {
        tags: ['devices'],
        summary: 'Create short-lived single-use WebSocket relay credentials',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              token:      { type: 'string' },
              expires_at: { type: 'string' },
              ws_url:     { type: 'string' },
            },
          },
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { userId } = request.user;
      const { id } = request.params;

      const [device] = await sql<DbDevice[]>`
        SELECT id FROM devices WHERE id = ${id} AND user_id = ${userId}
      `;
      if (!device) {
        return reply.code(404).send({ error: 'NOT_FOUND', detail: 'device not found' });
      }

      const { token, expiresAt } = await issueRelayToken(sessionStore, id, config.relay.tokenTtlSeconds);

      await sql`UPDATE devices SET last_seen_at = NOW() WHERE id = ${id}`;

      return reply.code(201).send({
        token,
        expires_at: expiresAt,
        ws_url: `${config.relay.publicUrl}?token=${encodeURIComponent(token)}`,
      });
    },
  );
}
