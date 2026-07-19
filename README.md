# host39

A2A agent card hosting — publish standardized agent cards at stable public URLs without running your own server.

## What it does

host39 lets individuals and businesses register agent identities and publish A2A-compliant agent cards. Cards are served at predictable public URLs and aggregated into a discovery catalog.

```
GET /moonbakery.com/orders.json         # domain identity
GET /personal/john@email.com/card.json  # personal identity
GET /.well-known/ai-catalog.json        # all active cards
```

---

## Quick start

```bash
cp .env.example .env
docker compose up --build
```

| Service   | URL                       |
|-----------|---------------------------|
| Web UI    | http://localhost:3002     |
| API       | http://localhost:3010     |
| API Docs  | http://localhost:3010/docs |

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | (none) | Postgres connection string. Set by docker-compose; required explicitly when running the server without Docker. |
| `JWT_SECRET` | yes (prod) | dev default | Must be at least 16 chars in production |
| `JWT_EXPIRES_IN` | no | `7d` | Token lifetime |
| `FRONTEND_URL` | no | `http://localhost:3002` | Used for CORS and redirects |
| `PUBLIC_BASE_URL` | no | `http://localhost:3010` | Host that serves public cards. Baked into `/.well-known/ai-catalog.json` and each card's `_meta.publicUrl`. Set to `https://agentcards.host39.org` in production. |
| `NEXT_PUBLIC_HOST39_API_URL` | no | `http://localhost:3010` | API base URL baked into the frontend |
| `NEXT_PUBLIC_HOST39_CARDS_URL` | no | falls back to API URL | Card-serving host shown/copied in the dashboard. Set to `https://agentcards.host39.org` in production. |
| `POSTGRES_PASSWORD` | yes | `host39-local` in dev | Postgres password |
| `PORT` | no | `3010` | API server port |

---

## API reference

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | Create account (email + password, optional domain) |
| `POST` | `/auth/login` | — | Sign in, returns JWT |
| `GET` | `/auth/me` | JWT | Current user profile |

### Agent cards (protected)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/cards` | JWT | List your cards |
| `POST` | `/cards` | JWT | Create a card |
| `GET` | `/cards/:id` | JWT | Get one card |
| `PUT` | `/cards/:id` | JWT | Update a card |
| `DELETE` | `/cards/:id` | JWT | Delete a card |

### Public (no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/personal/:email/:slug.json` | Fetch a personal agent card |
| `GET` | `/:domain/:slug.json` | Fetch a domain agent card |
| `GET` | `/.well-known/ai-catalog.json` | All active cards |
| `GET` | `/health` | Liveness probe |

---

## Identity types

**Personal (email)** — for individuals. Cards are served under `/personal/<email>/`.

**Domain (business)** — for orgs with a domain. Cards are served under `/<domain>/`. Only one user can register a given domain.

---

## Database schema

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `email` | VARCHAR(255) | Unique, used for login |
| `password_hash` | VARCHAR(255) | bcrypt |
| `display_name` | VARCHAR(255) | Optional |
| `identity_type` | VARCHAR(20) | `email` or `domain` |
| `domain` | VARCHAR(255) | Unique. Domain-identity users only |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### `agent_cards`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK → `users.id` |
| `slug` | VARCHAR(64) | URL slug. Unique per user. |
| `display_name` | VARCHAR(255) | |
| `description` | TEXT | Optional |
| `runtime_url` | VARCHAR(512) | Actual agent endpoint |
| `version` | VARCHAR(32) | Default `1.0` |
| `capabilities` | JSONB | `{ streaming, pushNotifications }` |
| `authentication` | JSONB | `{ schemes: string[] }` |
| `skills` | JSONB | Array of skill objects |
| `provider_name` | VARCHAR(255) | Optional |
| `provider_url` | VARCHAR(512) | Optional |
| `status` | VARCHAR(20) | `active` or `inactive` |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

---

## Local development (without Docker)

```bash
# Start Postgres only
docker compose up db -d

# Server
cd server && npm install
cp ../.env.example .env
npm run migrate
npm run dev

# Web (separate terminal)
cd web && npm install && npm run dev
```

---

## Production

```bash
cp .env.prod.example .env.prod
# Fill in JWT_SECRET, POSTGRES_PASSWORD
# Generate: openssl rand -hex 64

docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d
```

Production domains: `host39.org` (UI + API), `agentcards.host39.org` (public card serving).

---

## Tech stack

| Concern | Technology |
|---|---|
| Runtime | Node.js 20, TypeScript |
| Framework | Fastify 5 |
| Database | PostgreSQL 16, postgres.js |
| Auth | JWT, bcryptjs |
| Frontend | Next.js, Tailwind CSS 4 |
| Reverse proxy | Caddy 2 |

---

## Also in this repo

| Path | What it is |
| --- | --- |
| [`packages/react-native-device-agent`](packages/react-native-device-agent) | The on-device LLM agent harness (llama.rn-based): the agentic loop, tool registry, and batteries-included device/filesystem/network tools. Imported internally per [`UPSTREAM.md`](packages/react-native-device-agent/UPSTREAM.md); consumed by the `mobile` workspace. |
| [`mobile`](mobile) | The Host39 Android app: runs the device-agent harness locally, signs its own agent card, and relays A2A requests through this server. |
| [`example`](example) | A standalone Expo demo app for the `react-native-device-agent` harness (chat UI, not part of the `mobile` Host39 app). Run it with the `example:*` npm scripts (`example:start`, `example:ios`, `example:android`, `example:web`). |
| [`agentfacts.json`](agentfacts.json) | A static AgentFacts / Agent Card describing the `example` demo's configuration. See [`AGENTS.md`](AGENTS.md) for the decisions and known limitations behind it — including why this repo has two unrelated git histories merged together. |
