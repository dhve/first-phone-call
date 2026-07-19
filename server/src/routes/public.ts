import type { FastifyInstance } from 'fastify';
import { getSql } from '../db/client.js';
import { buildConfig } from '../config.js';
import { buildPersonalUrn } from '../urn.js';
import type { DbUser, DbAgentCard, A2AAgentCard } from '../types.js';

function buildIdentifier(user: DbUser, slug: string): string {
  if (user.identityType === 'domain' && user.domain) {
    return `urn:ai:domain:${user.domain}:agent:${slug}`;
  }
  return buildPersonalUrn(user.email, slug);
}

function buildPublicUrl(user: DbUser, slug: string, baseUrl: string): string {
  if (user.identityType === 'domain' && user.domain) {
    return `${baseUrl}/${user.domain}/${slug}.json`;
  }
  return `${baseUrl}/personal/${encodeURIComponent(user.email)}/${slug}.json`;
}

function buildAgentCard(user: DbUser, card: DbAgentCard, publicUrl: string): A2AAgentCard {
  const identifier = buildIdentifier(user, card.slug);

  return {
    name:           card.displayName,
    description:    card.description,
    url:            card.runtimeUrl,
    version:        card.version,
    capabilities:   card.capabilities,
    authentication: card.authentication,
    skills:         card.skills,
    provider:
      card.providerName || card.providerUrl
        ? { organization: card.providerName, url: card.providerUrl }
        : null,
    _meta: {
      identifier,
      publicUrl,
      hostedBy: 'host39.org',
    },
  };
}

export async function registerPublicRoutes(fastify: FastifyInstance): Promise<void> {
  const sql = getSql();
  const config = buildConfig();

  // IMPORTANT: Register /personal/:email/:slug.json BEFORE /:domain/:slug.json
  // so Fastify matches the more specific route first.

  // GET /personal/:email/:slug.json - personal (email-identity) user card
  fastify.get<{ Params: { email: string; slug: string } }>(
    '/personal/:email/:slug.json',
    {
      schema: {
        tags: ['public'],
        summary: 'Get agent card for a personal (email-identity) user',
        params: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            slug:  { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, slug } = request.params;

      const decodedEmail = decodeURIComponent(email);

      const [user] = await sql<DbUser[]>`
        SELECT id, email, display_name, identity_type, domain
        FROM users
        WHERE email = ${decodedEmail}
      `;

      if (!user) {
        return reply.code(404).send({ error: 'NOT_FOUND', detail: 'user not found' });
      }

      // Phone-hosted agents: serve the latest verified signed card from the
      // cache, even while the phone is offline.
      const [cachedCard] = await sql<{ card: Record<string, unknown> }[]>`
        SELECT card FROM card_cache WHERE user_id = ${user.id} AND slug = ${slug}
      `;
      if (cachedCard) {
        reply.header('Content-Type', 'application/a2a-agent-card+json');
        return reply.send(cachedCard.card);
      }

      const [card] = await sql<DbAgentCard[]>`
        SELECT * FROM agent_cards
        WHERE user_id = ${user.id} AND slug = ${slug} AND status = 'active'
      `;

      if (!card) {
        return reply.code(404).send({ error: 'NOT_FOUND', detail: 'agent card not found' });
      }

      const publicUrl = buildPublicUrl(user, card.slug, config.publicBaseUrl);
      const agentCard = buildAgentCard(user, card, publicUrl);

      reply.header('Content-Type', 'application/a2a-agent-card+json');
      return reply.send(agentCard);
    },
  );

  // GET /:domain/:slug.json - domain-identity user card (SMB)
  fastify.get<{ Params: { domain: string; slug: string } }>(
    '/:domain/:slug.json',
    {
      schema: {
        tags: ['public'],
        summary: 'Get agent card for a domain-identity user (SMB)',
        params: {
          type: 'object',
          properties: {
            domain: { type: 'string' },
            slug:   { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { domain, slug } = request.params;

      const [user] = await sql<DbUser[]>`
        SELECT id, email, display_name, identity_type, domain
        FROM users
        WHERE identity_type = 'domain' AND domain = ${domain}
      `;

      if (!user) {
        return reply.code(404).send({ error: 'NOT_FOUND', detail: 'domain not found' });
      }

      const [card] = await sql<DbAgentCard[]>`
        SELECT * FROM agent_cards
        WHERE user_id = ${user.id} AND slug = ${slug} AND status = 'active'
      `;

      if (!card) {
        return reply.code(404).send({ error: 'NOT_FOUND', detail: 'agent card not found' });
      }

      const publicUrl = buildPublicUrl(user, card.slug, config.publicBaseUrl);
      const agentCard = buildAgentCard(user, card, publicUrl);

      reply.header('Content-Type', 'application/a2a-agent-card+json');
      return reply.send(agentCard);
    },
  );

  // GET /.well-known/ai-catalog.json - aggregate catalog of all active cards
  fastify.get(
    '/.well-known/ai-catalog.json',
    {
      schema: {
        tags: ['public'],
        summary: 'Aggregate catalog of all active agent cards',
      },
    },
    async (_request, reply) => {
      const rows = await sql<(DbAgentCard & { userEmail: string; userIdentityType: string; userDomain: string | null })[
      ]>`
        SELECT
          ac.*,
          u.email    AS user_email,
          u.identity_type AS user_identity_type,
          u.domain   AS user_domain
        FROM agent_cards ac
        JOIN users u ON u.id = ac.user_id
        WHERE ac.status = 'active'
        ORDER BY ac.created_at DESC
      `;

      const entries = rows.map((row) => {
        const user: DbUser = {
          id:           row.userId,
          email:        row.userEmail,
          displayName:  null,
          passwordHash: '',
          identityType: row.userIdentityType as 'domain' | 'email',
          domain:       row.userDomain,
          createdAt:    row.createdAt,
          updatedAt:    row.updatedAt,
        };

        const publicUrl = buildPublicUrl(user, row.slug, config.publicBaseUrl);
        const identifier = buildIdentifier(user, row.slug);

        return {
          identifier,
          displayName: row.displayName,
          mediaType:   'application/a2a-agent-card+json',
          url:         publicUrl,
          description: row.description,
          tags:        [] as string[],
        };
      });

      reply.header('Content-Type', 'application/json');
      return reply.send({ specVersion: '1.0', entries });
    },
  );
}
