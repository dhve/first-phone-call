import type { FastifyInstance } from 'fastify';
import { getSql } from '../db/client.js';
import { buildConfig } from '../config.js';
import { A2A_ERRORS, jsonRpcError, mapRelayError, validateA2ARequest } from '../relay/a2a.js';
import type { RelayRegistry } from '../relay/registry.js';

export async function registerA2ARoutes(fastify: FastifyInstance, registry: RelayRegistry): Promise<void> {
  const sql = getSql();
  const config = buildConfig();

  // POST /a2a/personal/:handle/:slug - JSON-RPC 2.0 "message/send" runtime
  fastify.post<{ Params: { handle: string; slug: string }; Body: unknown }>(
    '/a2a/personal/:handle/:slug',
    {
      // Cap the full raw JSON-RPC body, not just the concatenated text parts.
      bodyLimit: config.runtime.maxRequestBytes,
      // Body-parser failures (oversized, malformed JSON) bypass the handler,
      // so map them to JSON-RPC errors here instead of the app error shape.
      errorHandler: (error, request, reply) => {
        request.log.error({ err: error, url: request.url }, 'a2a request error');
        if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
          return reply
            .code(A2A_ERRORS.oversized.httpStatus)
            .send(jsonRpcError(null, A2A_ERRORS.oversized,
              `request body exceeds ${config.runtime.maxRequestBytes} bytes`));
        }
        if ((error.statusCode ?? 500) < 500) {
          return reply
            .code(A2A_ERRORS.parse.httpStatus)
            .send(jsonRpcError(null, A2A_ERRORS.parse, 'request body is not a valid JSON object'));
        }
        return reply
          .code(A2A_ERRORS.internal.httpStatus)
          .send(jsonRpcError(null, A2A_ERRORS.internal));
      },
      config: {
        rateLimit: {
          max: config.runtime.rateLimitMax,
          timeWindow: config.runtime.rateLimitWindowMs,
          keyGenerator: (request) => {
            const params = request.params as { handle?: string; slug?: string };
            return `a2a:${params.handle ?? ''}:${params.slug ?? ''}`;
          },
          errorResponseBuilder: () => jsonRpcError(null, A2A_ERRORS.rateLimited),
        },
      },
      schema: {
        tags: ['a2a'],
        summary: 'JSON-RPC 2.0 message/send runtime for a phone-hosted personal agent',
        params: {
          type: 'object',
          properties: {
            handle: { type: 'string' },
            slug:   { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { handle, slug } = request.params;

      const validation = validateA2ARequest(request.body, config.runtime.maxRequestBytes);
      if (!validation.ok) {
        return reply
          .code(validation.spec.httpStatus)
          .send(jsonRpcError(validation.id, validation.spec, validation.detail));
      }
      const rpcId = validation.request.id;

      const email = decodeURIComponent(handle);
      const [user] = await sql<{ id: string }[]>`
        SELECT id FROM users WHERE email = ${email}
      `;
      if (!user) {
        return reply
          .code(A2A_ERRORS.agentNotFound.httpStatus)
          .send(jsonRpcError(rpcId, A2A_ERRORS.agentNotFound, 'unknown handle'));
      }

      const [cached] = await sql<{ deviceId: string }[]>`
        SELECT device_id FROM card_cache WHERE user_id = ${user.id} AND slug = ${slug}
      `;
      if (!cached) {
        return reply
          .code(A2A_ERRORS.agentNotFound.httpStatus)
          .send(jsonRpcError(rpcId, A2A_ERRORS.agentNotFound, 'no cached card for this agent'));
      }

      try {
        const result = await registry.request(cached.deviceId, slug, validation.request.params, config.runtime.timeoutMs);
        return reply.send({ jsonrpc: '2.0', id: rpcId, result });
      } catch (err) {
        const mapped = mapRelayError(err);
        return reply.code(mapped.spec.httpStatus).send(jsonRpcError(rpcId, mapped.spec, mapped.detail));
      }
    },
  );
}
