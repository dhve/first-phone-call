import type { FastifyInstance } from 'fastify';
import { getSql } from '../db/client.js';
import { validateCardUpload } from '../relay/cardCache.js';
import type { DbDevice } from '../types.js';

const apiErrorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    detail: { type: 'string' },
  },
} as const;

interface CacheCardBody {
  device_id: string;
  card: Record<string, unknown>;
  signature: string;
  version: number;
}

export async function registerMobileRoutes(fastify: FastifyInstance): Promise<void> {
  const sql = getSql();

  // PUT /mobile/cards/:slug/cache - store a canonical signed agent card
  fastify.put<{ Params: { slug: string }; Body: CacheCardBody }>(
    '/mobile/cards/:slug/cache',
    {
      schema: {
        tags: ['mobile'],
        summary: 'Cache a canonical signed agent card from a device',
        params: {
          type: 'object',
          properties: { slug: { type: 'string' } },
        },
        body: {
          type: 'object',
          required: ['device_id', 'card', 'signature', 'version'],
          additionalProperties: false,
          properties: {
            device_id: { type: 'string' },
            card:      { type: 'object' },
            signature: { type: 'string', minLength: 1, maxLength: 1024 },
            version:   { type: 'integer', minimum: 1 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              ok:      { type: 'boolean' },
              slug:    { type: 'string' },
              version: { type: 'integer' },
            },
          },
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { userId, email } = request.user;
      const { slug } = request.params;
      const { device_id, card, signature, version } = request.body;

      const [device] = await sql<DbDevice[]>`
        SELECT * FROM devices WHERE id = ${device_id} AND user_id = ${userId}
      `;
      if (!device) {
        return reply.code(404).send({ error: 'NOT_FOUND', detail: 'device not found' });
      }

      const [existing] = await sql<{ version: string | number }[]>`
        SELECT version FROM card_cache WHERE user_id = ${userId} AND slug = ${slug}
      `;
      const storedVersion = existing ? Number(existing.version) : null;

      const result = validateCardUpload({
        card,
        signature,
        version,
        slug,
        accountEmail: email,
        storedVersion,
        publicKeyJwk: device.publicKeyJwk,
      });

      if (!result.ok) {
        const { code, detail } = result.rejection;
        const status = code === 'STALE_VERSION' ? 409 : code === 'IDENTITY_MISMATCH' ? 403 : 400;
        return reply.code(status).send({ error: code, detail });
      }

      // The version guard on the upsert re-checks staleness atomically in
      // case of a concurrent upload for the same slug.
      const [stored] = await sql<{ version: string | number }[]>`
        INSERT INTO card_cache (user_id, device_id, slug, card, signature, version)
        VALUES (
          ${userId},
          ${device_id},
          ${slug},
          ${sql.json(JSON.parse(JSON.stringify(card)))},
          ${signature},
          ${version}
        )
        ON CONFLICT (user_id, slug) DO UPDATE SET
          device_id  = EXCLUDED.device_id,
          card       = EXCLUDED.card,
          signature  = EXCLUDED.signature,
          version    = EXCLUDED.version,
          updated_at = NOW()
        WHERE card_cache.version < EXCLUDED.version
        RETURNING version
      `;

      if (!stored) {
        return reply.code(409).send({
          error: 'STALE_VERSION',
          detail: 'an equal or newer version is already cached',
        });
      }

      await sql`UPDATE devices SET last_seen_at = NOW() WHERE id = ${device_id}`;

      return reply.send({ ok: true, slug, version: Number(stored.version) });
    },
  );
}
