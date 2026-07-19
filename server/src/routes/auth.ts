import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { getSql } from '../db/client.js';
import { buildConfig } from '../config.js';
import type { DbUser } from '../types.js';

const BCRYPT_ROUNDS = 12;

const jwtResponseSchema = {
  type: 'object',
  required: ['token'],
  properties: {
    token: { type: 'string' },
  },
} as const;

const apiErrorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    detail: { type: 'string' },
  },
} as const;

interface RegisterBody {
  email: string;
  password: string;
  display_name?: string;
  identity_type?: 'domain' | 'email';
  domain?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();
  const sql = getSql();

  // POST /auth/register
  fastify.post<{ Body: RegisterBody }>(
    '/auth/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Register a new account',
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email:         { type: 'string', format: 'email', maxLength: 255 },
            password:      { type: 'string', minLength: 8, maxLength: 128 },
            display_name:  { type: 'string', maxLength: 255 },
            identity_type: { type: 'string', enum: ['domain', 'email'] },
            domain:        { type: 'string', maxLength: 255 },
          },
        },
        response: {
          201: jwtResponseSchema,
          409: apiErrorSchema,
          400: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { email, password, display_name, identity_type = 'email', domain } = request.body;

      // Domain identity requires a domain
      if (identity_type === 'domain' && !domain) {
        return reply.code(400).send({ error: 'BAD_REQUEST', detail: 'domain is required for domain identity type' });
      }

      // Check email uniqueness
      const [existing] = await sql<DbUser[]>`
        SELECT id FROM users WHERE email = ${email}
      `;
      if (existing) {
        return reply.code(409).send({ error: 'CONFLICT', detail: 'email already registered' });
      }

      // Check domain uniqueness if provided
      if (domain) {
        const [existingDomain] = await sql<DbUser[]>`
          SELECT id FROM users WHERE domain = ${domain}
        `;
        if (existingDomain) {
          return reply.code(409).send({ error: 'CONFLICT', detail: 'domain already registered' });
        }
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const [user] = await sql<DbUser[]>`
        INSERT INTO users (email, display_name, password_hash, identity_type, domain)
        VALUES (
          ${email},
          ${display_name ?? null},
          ${passwordHash},
          ${identity_type},
          ${domain ?? null}
        )
        RETURNING id, email, display_name, identity_type, domain
      `;

      if (!user) {
        return reply.code(500).send({ error: 'internal_server_error' });
      }

      const token = await reply.jwtSign(
        { userId: user.id, email: user.email },
        { expiresIn: config.jwt.expiresIn },
      );

      return reply.code(201).send({ token });
    },
  );

  // POST /auth/login
  fastify.post<{ Body: LoginBody }>(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Sign in with email and password',
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email:    { type: 'string', format: 'email', maxLength: 255 },
            password: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        response: {
          200: jwtResponseSchema,
          401: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const [user] = await sql<DbUser[]>`
        SELECT id, email, display_name, password_hash, identity_type, domain
        FROM users WHERE email = ${email}
      `;

      if (!user || !user.passwordHash) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'invalid email or password' });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'invalid email or password' });
      }

      const token = await reply.jwtSign(
        { userId: user.id, email: user.email },
        { expiresIn: config.jwt.expiresIn },
      );

      return reply.code(200).send({ token });
    },
  );

  // GET /auth/me
  fastify.get(
    '/auth/me',
    {
      schema: {
        tags: ['auth'],
        summary: 'Get current user profile',
        response: {
          200: {
            type: 'object',
            properties: {
              user_id:       { type: 'string' },
              email:         { type: 'string' },
              display_name:  { type: 'string', nullable: true },
              identity_type: { type: 'string' },
              domain:        { type: 'string', nullable: true },
            },
          },
          401: apiErrorSchema,
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { userId } = request.user;

      const [user] = await sql<DbUser[]>`
        SELECT id, email, display_name, identity_type, domain
        FROM users WHERE id = ${userId}
      `;

      if (!user) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'user not found' });
      }

      return reply.send({
        user_id:       user.id,
        email:         user.email,
        display_name:  user.displayName,
        identity_type: user.identityType,
        domain:        user.domain,
      });
    },
  );
}
