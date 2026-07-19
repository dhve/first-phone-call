import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fjwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { buildConfig } from './config.js';
import { getSql, closeSql } from './db/client.js';
import { registerA2ARoutes } from './routes/a2a.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCardsRoutes } from './routes/cards.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerMobileRoutes } from './routes/mobile.js';
import { registerPublicRoutes } from './routes/public.js';
import { createRelayRegistry, registerRelayRoutes } from './routes/relay.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; email: string };
    user: { userId: string; email: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function buildServer() {
  const config = buildConfig();

  const fastify = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'debug',
    },
  });

  // Error handler
  fastify.setErrorHandler((error: { statusCode?: number; code?: string; message?: string }, request, reply) => {
    const status = error.statusCode ?? 500;
    fastify.log.error({ err: error, method: request.method, url: request.url }, 'request error');
    const body: { error: string; detail?: string } = {
      error: status >= 500 ? 'internal_server_error' : (error.code ?? error.message ?? 'error'),
    };
    if (status < 500 && error.message) {
      body.detail = error.message;
    }
    return reply.status(status).send(body);
  });

  // CORS - allow all origins (public card endpoints need open access)
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // JWT
  await fastify.register(fjwt, { secret: config.jwt.secret });

  // WebSocket support for the phone relay
  await fastify.register(websocket, {
    options: { maxPayload: config.relay.maxPayloadBytes },
  });

  // Rate limiting is opt-in per route (used by the A2A runtime)
  await fastify.register(rateLimit, { global: false });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'missing or invalid token' });
    }
  });

  // Swagger - must register before routes
  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'host39 Server',
        description: 'A2A Agent Card hosting service - register, create, and publish agent cards.',
        version: '1.0.0',
      },
      servers: [{ url: 'http://localhost:3010', description: 'local dev' }],
      tags: [
        { name: 'auth', description: 'Authentication routes' },
        { name: 'cards', description: 'Agent card CRUD (protected)' },
        { name: 'public', description: 'Public agent card serving' },
        { name: 'devices', description: 'Phone device registration and relay sessions (protected)' },
        { name: 'mobile', description: 'Device-facing card cache upload (protected)' },
        { name: 'relay', description: 'Device relay WebSocket' },
        { name: 'a2a', description: 'A2A JSON-RPC runtime for phone-hosted agents' },
      ],
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { deepLinking: true },
  });

  // Health check
  fastify.get('/health', {
    schema: { tags: ['public'], summary: 'Health check' },
  }, async () => {
    const sql = getSql();
    await sql`SELECT 1`;
    return { status: 'ok' };
  });

  // Shared relay connection registry (one socket per device)
  const relayRegistry = createRelayRegistry();
  fastify.addHook('onClose', async () => {
    relayRegistry.shutdown();
  });

  // Register route groups
  // IMPORTANT: public routes with /personal/ prefix must be registered FIRST
  // to avoid being caught by the generic /:domain/:slug.json route.
  await registerPublicRoutes(fastify);
  await registerAuthRoutes(fastify);
  await registerCardsRoutes(fastify);
  await registerDeviceRoutes(fastify);
  await registerMobileRoutes(fastify);
  await registerRelayRoutes(fastify, relayRegistry);
  await registerA2ARoutes(fastify, relayRegistry);

  return { fastify, config };
}

async function main(): Promise<void> {
  const { fastify, config } = await buildServer();

  const shutdown = async () => {
    await fastify.close();
    await closeSql();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await fastify.listen({ port: config.port, host: '0.0.0.0' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
