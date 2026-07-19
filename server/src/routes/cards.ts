import type { FastifyInstance } from 'fastify';
import { getSql } from '../db/client.js';
import type { DbAgentCard } from '../types.js';

const apiErrorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    detail: { type: 'string' },
  },
} as const;

const agentCardSchema = {
  type: 'object',
  properties: {
    id:             { type: 'string' },
    user_id:        { type: 'string' },
    slug:           { type: 'string' },
    display_name:   { type: 'string' },
    description:    { type: 'string', nullable: true },
    runtime_url:    { type: 'string', nullable: true },
    version:        { type: 'string' },
    capabilities:   { type: 'object' },
    authentication: { type: 'object' },
    skills:         { type: 'array' },
    provider_name:  { type: 'string', nullable: true },
    provider_url:   { type: 'string', nullable: true },
    status:         { type: 'string' },
    created_at:     { type: 'string' },
    updated_at:     { type: 'string' },
  },
} as const;

interface CreateCardBody {
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

interface UpdateCardBody {
  slug?: string;
  display_name?: string;
  description?: string;
  runtime_url?: string;
  version?: string;
  capabilities?: { streaming?: boolean; pushNotifications?: boolean };
  authentication?: { schemes?: string[] };
  skills?: unknown[];
  provider_name?: string;
  provider_url?: string;
  status?: 'active' | 'inactive';
}

function mapCard(card: DbAgentCard) {
  return {
    id:             card.id,
    user_id:        card.userId,
    slug:           card.slug,
    display_name:   card.displayName,
    description:    card.description,
    runtime_url:    card.runtimeUrl,
    version:        card.version,
    capabilities:   card.capabilities,
    authentication: card.authentication,
    skills:         card.skills,
    provider_name:  card.providerName,
    provider_url:   card.providerUrl,
    status:         card.status,
    created_at:     card.createdAt,
    updated_at:     card.updatedAt,
  };
}

export async function registerCardsRoutes(fastify: FastifyInstance): Promise<void> {
  const sql = getSql();

  // GET /cards — list user's cards
  fastify.get(
    '/cards',
    {
      schema: {
        tags: ['cards'],
        summary: 'List agent cards for the current user',
        response: {
          200: { type: 'array', items: agentCardSchema },
          401: apiErrorSchema,
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { userId } = request.user;
      const cards = await sql<DbAgentCard[]>`
        SELECT * FROM agent_cards WHERE user_id = ${userId} ORDER BY created_at DESC
      `;
      return reply.send(cards.map(mapCard));
    },
  );

  // POST /cards — create a card
  fastify.post<{ Body: CreateCardBody }>(
    '/cards',
    {
      schema: {
        tags: ['cards'],
        summary: 'Create a new agent card',
        body: {
          type: 'object',
          required: ['slug', 'display_name'],
          additionalProperties: false,
          properties: {
            slug:           { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 64 },
            display_name:   { type: 'string', maxLength: 255 },
            description:    { type: 'string' },
            runtime_url:    { type: 'string', maxLength: 512 },
            version:        { type: 'string', maxLength: 32 },
            capabilities:   { type: 'object' },
            authentication: { type: 'object' },
            skills:         { type: 'array' },
            provider_name:  { type: 'string', maxLength: 255 },
            provider_url:   { type: 'string', maxLength: 512 },
          },
        },
        response: {
          201: agentCardSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { userId } = request.user;
      const {
        slug,
        display_name,
        description,
        runtime_url,
        version = '1.0',
        capabilities = { streaming: false, pushNotifications: false },
        authentication = { schemes: ['none'] },
        skills = [],
        provider_name,
        provider_url,
      } = request.body;

      // Check slug uniqueness for this user
      const [existing] = await sql<DbAgentCard[]>`
        SELECT id FROM agent_cards WHERE user_id = ${userId} AND slug = ${slug}
      `;
      if (existing) {
        return reply.code(409).send({ error: 'CONFLICT', detail: 'slug already exists for this user' });
      }

      const [card] = await sql<DbAgentCard[]>`
        INSERT INTO agent_cards (
          user_id, slug, display_name, description, runtime_url, version,
          capabilities, authentication, skills, provider_name, provider_url
        ) VALUES (
          ${userId},
          ${slug},
          ${display_name},
          ${description ?? null},
          ${runtime_url ?? null},
          ${version},
          ${sql.json(JSON.parse(JSON.stringify(capabilities)))},
          ${sql.json(JSON.parse(JSON.stringify(authentication)))},
          ${sql.json(JSON.parse(JSON.stringify(skills)))},
          ${provider_name ?? null},
          ${provider_url ?? null}
        )
        RETURNING *
      `;

      if (!card) {
        return reply.code(500).send({ error: 'internal_server_error' });
      }

      return reply.code(201).send(mapCard(card));
    },
  );

  // GET /cards/:id — get own card
  fastify.get<{ Params: { id: string } }>(
    '/cards/:id',
    {
      schema: {
        tags: ['cards'],
        summary: 'Get an agent card by ID',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          200: agentCardSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { userId } = request.user;
      const { id } = request.params;

      const [card] = await sql<DbAgentCard[]>`
        SELECT * FROM agent_cards WHERE id = ${id} AND user_id = ${userId}
      `;

      if (!card) {
        return reply.code(404).send({ error: 'NOT_FOUND', detail: 'card not found' });
      }

      return reply.send(mapCard(card));
    },
  );

  // PUT /cards/:id — update card
  fastify.put<{ Params: { id: string }; Body: UpdateCardBody }>(
    '/cards/:id',
    {
      schema: {
        tags: ['cards'],
        summary: 'Update an agent card',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slug:           { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 64 },
            display_name:   { type: 'string', maxLength: 255 },
            description:    { type: 'string' },
            runtime_url:    { type: 'string', maxLength: 512 },
            version:        { type: 'string', maxLength: 32 },
            capabilities:   { type: 'object' },
            authentication: { type: 'object' },
            skills:         { type: 'array' },
            provider_name:  { type: 'string', maxLength: 255 },
            provider_url:   { type: 'string', maxLength: 512 },
            status:         { type: 'string', enum: ['active', 'inactive'] },
          },
        },
        response: {
          200: agentCardSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { userId } = request.user;
      const { id } = request.params;

      const [card] = await sql<DbAgentCard[]>`
        SELECT * FROM agent_cards WHERE id = ${id} AND user_id = ${userId}
      `;

      if (!card) {
        return reply.code(404).send({ error: 'NOT_FOUND', detail: 'card not found' });
      }

      const {
        slug,
        display_name,
        description,
        runtime_url,
        version,
        capabilities,
        authentication,
        skills,
        provider_name,
        provider_url,
        status,
      } = request.body;

      // Check slug conflict if slug is being changed
      if (slug && slug !== card.slug) {
        const [conflict] = await sql<DbAgentCard[]>`
          SELECT id FROM agent_cards WHERE user_id = ${userId} AND slug = ${slug} AND id != ${id}
        `;
        if (conflict) {
          return reply.code(409).send({ error: 'CONFLICT', detail: 'slug already exists for this user' });
        }
      }

      const [updated] = await sql<DbAgentCard[]>`
        UPDATE agent_cards SET
          slug           = ${slug ?? card.slug},
          display_name   = ${display_name ?? card.displayName},
          description    = ${description !== undefined ? description : card.description},
          runtime_url    = ${runtime_url !== undefined ? runtime_url : card.runtimeUrl},
          version        = ${version ?? card.version},
          capabilities   = ${sql.json(JSON.parse(JSON.stringify(capabilities ?? card.capabilities)))},
          authentication = ${sql.json(JSON.parse(JSON.stringify(authentication ?? card.authentication)))},
          skills         = ${sql.json(JSON.parse(JSON.stringify(skills ?? card.skills)))},
          provider_name  = ${provider_name !== undefined ? provider_name : card.providerName},
          provider_url   = ${provider_url !== undefined ? provider_url : card.providerUrl},
          status         = ${status ?? card.status},
          updated_at     = NOW()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING *
      `;

      if (!updated) {
        return reply.code(500).send({ error: 'internal_server_error' });
      }

      return reply.send(mapCard(updated));
    },
  );

  // DELETE /cards/:id — delete card
  fastify.delete<{ Params: { id: string } }>(
    '/cards/:id',
    {
      schema: {
        tags: ['cards'],
        summary: 'Delete an agent card',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          204: { type: 'null' },
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { userId } = request.user;
      const { id } = request.params;

      const result = await sql`
        DELETE FROM agent_cards WHERE id = ${id} AND user_id = ${userId}
      `;

      if (result.count === 0) {
        return reply.code(404).send({ error: 'NOT_FOUND', detail: 'card not found' });
      }

      return reply.code(204).send();
    },
  );
}
