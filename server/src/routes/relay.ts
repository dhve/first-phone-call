import type { FastifyInstance } from 'fastify';
import { getSql } from '../db/client.js';
import { buildConfig } from '../config.js';
import { RelayRegistry } from '../relay/registry.js';
import type { RelaySocket } from '../relay/registry.js';
import { PgRelaySessionStore, redeemRelayToken } from '../relay/tokens.js';

/** The subset of the ws socket API the relay route uses. */
interface RelayWebSocket extends RelaySocket {
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

function rawFrameToString(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return '';
}

/**
 * Builds the shared relay registry with DB-backed connection metadata.
 * Only connected_at / last_heartbeat_at / last_seen_at are persisted;
 * request and response payloads never touch the database.
 */
export function createRelayRegistry(): RelayRegistry {
  const sql = getSql();
  const config = buildConfig();

  const record = (query: PromiseLike<unknown>): void => {
    query.then(undefined, () => undefined);
  };

  return new RelayRegistry({
    heartbeatIntervalMs: config.relay.heartbeatIntervalMs,
    maxMissedHeartbeats: config.relay.heartbeatMaxMissed,
    events: {
      onConnect: (deviceId) => {
        record(sql`
          UPDATE devices
          SET connected_at = NOW(), last_heartbeat_at = NOW(), last_seen_at = NOW()
          WHERE id = ${deviceId}
        `);
      },
      onHeartbeat: (deviceId) => {
        record(sql`
          UPDATE devices
          SET last_heartbeat_at = NOW(), last_seen_at = NOW()
          WHERE id = ${deviceId}
        `);
      },
      onDisconnect: (deviceId) => {
        record(sql`
          UPDATE devices
          SET connected_at = NULL, last_seen_at = NOW()
          WHERE id = ${deviceId}
        `);
      },
    },
  });
}

export async function registerRelayRoutes(fastify: FastifyInstance, registry: RelayRegistry): Promise<void> {
  const sql = getSql();
  const sessionStore = new PgRelaySessionStore(sql);

  // GET /relay?token=... - WebSocket upgrade with a single-use relay token
  fastify.get<{ Querystring: { token: string } }>(
    '/relay',
    {
      websocket: true,
      schema: {
        tags: ['relay'],
        summary: 'Device relay WebSocket (requires a single-use relay-session token)',
        querystring: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string', minLength: 1, maxLength: 512 },
          },
        },
      },
    },
    async (connection, request) => {
      const socket = connection as unknown as RelayWebSocket;
      const { token } = request.query;

      let session: { deviceId: string } | null;
      try {
        session = await redeemRelayToken(sessionStore, token);
      } catch (err) {
        request.log.error({ err }, 'relay token redemption failed');
        socket.close(1011, 'internal error');
        return;
      }

      if (!session) {
        socket.close(4001, 'invalid, expired, or already used token');
        return;
      }

      const { deviceId } = session;
      registry.attach(deviceId, socket);

      socket.on('message', (data) => {
        registry.handleMessage(deviceId, rawFrameToString(data));
      });
      socket.on('close', () => {
        registry.detach(deviceId, socket);
      });
      socket.on('error', (err) => {
        request.log.warn({ err, deviceId }, 'relay socket error');
        registry.detach(deviceId, socket);
      });
    },
  );
}
