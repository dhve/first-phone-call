# Host39

Phone-agent backend: your personal A2A agent runs on your own Android phone. The phone generates its identity key, signs its agent card, downloads a local LLM, and answers questions itself. The server never runs the agent; it publishes the phone's signed card at a stable public URL and relays A2A requests to the phone over a WebSocket.

Monorepo workspaces: `server` (Fastify API + relay), `web` (Next.js dashboard), `mobile` (Expo Android app), `packages/react-native-device-agent` (internal on-device agent harness). Sibling-repo changes live in `patches/`.

## Architecture

The model is phone-authoritative:

- The phone holds an ES256 keypair in the Android Keystore (the private key never leaves the device) and registers the public JWK with the server.
- The phone builds its agent card, signs the RFC 8785 canonicalized card JSON with the Keystore key, and uploads it. The server verifies the signature against the registered device key and stores the card in a signed-card cache. The cache keeps exactly one latest verified card per (account, slug) with a strictly increasing integer version; the server can serve it but cannot forge or alter it.
- The public card URL is `<PUBLIC_BASE_URL>/personal/<handle>/<slug>.json`, where `<handle>` is the account email (URI-encoded). It serves the signed card verbatim, even while the phone is offline.
- The card's `url` field advertises the runtime URL `<PUBLIC_BASE_URL>/a2a/personal/<handle>/<slug>`. A JSON-RPC 2.0 `message/send` POSTed there is forwarded over the relay WebSocket to the phone, where the local LLM answers with a small sandboxed tool set. No phone connected means a structured JSON-RPC error, never a server-generated answer.
- Agent identity is the URN `urn:ai:email:<email>:agent:<slug>` (a stable public contract, `server/src/urn.ts`).

NANDA resolution flow: the app registers the agent with a NANDA index (nanda-index-v2, `POST /api/v1/orgs`, `hosting_path: "personal"`), pointing `registry_url` at the public card URL and `identifier` at the URN. The index emails a verification link to the account email; the record flips from pending to active when it is clicked (the app polls every 15 s). A resolver then goes: URN -> index record -> `registry_url` -> signed card -> `card.url` -> A2A runtime -> relay -> phone. The index-side behavior requires the patch in `patches/` (see `patches/README.md`).

```
 Caller agent                Host39 server                      Android phone
     |                            |                                  |
     | GET /personal/<handle>/    |  card_cache: latest verified     |
     |     <slug>.json            |  signed card (served even        |
     |--------------------------->|  while the phone is offline)     |
     |<------ signed card --------|                                  |
     |                            |   WS /relay?token=<single-use>   |
     | POST /a2a/personal/        |<---------------------------------|
     |      <handle>/<slug>       |  hello -> ready, ping/pong       |
     | JSON-RPC message/send      |                                  |
     |--------------------------->|-- request{id,slug,params, ------>|
     |                            |           deadline}              |
     |                            |              local LLM + tools   |
     |                            |<- response{id,result} / error ---|
     |<----- JSON-RPC result -----|                                  |
```

## Prerequisites

- Node.js >= 20.19 (root `package.json` engines; also what React Native 0.85 / Expo 56 want)
- Docker with the bundled PostgreSQL 16 (`postgres:16-alpine`), or a local PostgreSQL 16 install
- Android SDK plus an emulator or a physical device; JDK 17+ (the Android Studio JetBrains Runtime works)
- Expo custom dev builds only: `llama.rn` and the local `host39-native` module are native code, so Expo Go is not supported
- Android API 26+ (`minSdkVersion 26` in `mobile/app.json`)
- Roughly 2.5 GB free storage on the device: the model is ~1.0 GB, the app enforces a 10 percent margin before downloading, and you want headroom for the app and knowledge files
- A device with 6 GB+ RAM is recommended for loading the model
- To serve requests the device must be online, at or above 15 percent battery (or charging), and not thermally throttled; otherwise requests are rejected with structured errors

## Setup from clone

```bash
git clone <repo> && cd host39
npm ci                                # installs all workspaces
```

Configure the server environment. Both `npm run dev -w server` and `npm run migrate` load `server/.env` via `--env-file`, so it must exist:

```bash
cp server/.env.example server/.env
```

Create the database, either with Docker (exposed on host port 5434, matching the example `DATABASE_URL`):

```bash
docker compose up db -d
```

or on a local Postgres 16 (`createdb host39`, then point `DATABASE_URL` in `server/.env` at it). Then migrate:

```bash
npm run migrate
```

Start the API and the dashboard:

```bash
npm run dev:server    # http://localhost:3010, Swagger UI at /docs
npm run dev:web       # http://localhost:3000 by default; the Docker stack uses 3002 (set PORT=3002 to match)
```

Build and launch the Android app (needs a running emulator or a connected device; the first run generates the native projects):

```bash
npm run android
```

In the app:

1. Sign up or sign in. From the emulator the default server URL `http://10.0.2.2:3010` reaches your machine; on a real device override it on the sign-in screen (optionally with a separate public base URL).
2. Download the model (~1.0 GB). The app checks free space first and verifies the SHA-256 before accepting it.
3. Register the device key (generates the Keystore ES256 keypair and POSTs the public JWK to `/devices`).
4. Create a card, publish it (signs and uploads the card cache), and flip the hosting toggle.

Useful root scripts, each verified against the workspace `package.json` files: `npm run dev:server`, `npm run dev:web`, `npm run dev:mobile` (Metro only), `npm run android`, `npm run build` (server + web), `npm run test`, `npm run typecheck`, `npm run migrate`.

## Environment variables

Every variable read by `server/src/config.ts`. `server/.env.example` mirrors this table; the Docker Compose files inject the same variables. Invalid integer values are fatal at startup, as is a missing `DATABASE_URL`.

| Variable | Required | Default | Dev-safe example |
|---|---|---|---|
| `DATABASE_URL` | yes | none (server exits) | `postgresql://host39:host39-local@localhost:5434/host39` |
| `NODE_ENV` | no | `development` | `development` |
| `PORT` | no | `3010` | `3010` |
| `DB_MAX_CONNECTIONS` | no | `10` | `10` |
| `JWT_SECRET` | prod only | dev default (`host39-dev-secret-change-in-production`) | `dev-secret-0123456789abcdef` |
| `JWT_EXPIRES_IN` | no | `7d` | `7d` |
| `FRONTEND_URL` | no | `http://localhost:3002` | `http://localhost:3002` |
| `PUBLIC_BASE_URL` | no | `http://localhost:3010` | `http://localhost:3010` |
| `RELAY_PUBLIC_URL` | no | derived: `PUBLIC_BASE_URL` with `http`->`ws` plus `/relay` | `ws://localhost:3010/relay` |
| `RELAY_TOKEN_TTL_SECONDS` | no | `60` | `60` |
| `RELAY_HEARTBEAT_INTERVAL_MS` | no | `30000` | `30000` |
| `RELAY_HEARTBEAT_MAX_MISSED` | no | `2` | `2` |
| `RELAY_WS_MAX_PAYLOAD_BYTES` | no | `262144` | `262144` |
| `RUNTIME_TIMEOUT_MS` | no | `120000` | `120000` |
| `RUNTIME_MAX_REQUEST_BYTES` | no | `16384` | `16384` |
| `RUNTIME_RATE_LIMIT_MAX` | no | `30` | `30` |
| `RUNTIME_RATE_LIMIT_WINDOW_MS` | no | `60000` | `60000` |

Notes:

- In production (`NODE_ENV=production`) the server refuses to start if `JWT_SECRET` is unset, equal to the dev default, or shorter than 16 characters.
- `PUBLIC_BASE_URL` is baked into published card URLs, `_meta.publicUrl`, the catalog, and the derived relay URL, and signed card uploads validate `card.url` against it. Server and phone must agree on it.
- `FRONTEND_URL` is read into the config but not currently consumed by any route (CORS allows all origins); it is kept for compatibility.

Related settings outside `server/src/config.ts`:

| Setting | Where | Default | Purpose |
|---|---|---|---|
| `POSTGRES_PASSWORD` | Docker Compose | `host39-local` (dev), required in prod | Postgres password, also interpolated into `DATABASE_URL` |
| `NEXT_PUBLIC_HOST39_API_URL` | web build arg | `http://localhost:3010` | API base URL baked into the dashboard |
| `NEXT_PUBLIC_HOST39_CARDS_URL` | web build arg | `http://localhost:3010` | Card-serving host shown in the dashboard |
| Server URL | mobile sign-in screen | `http://10.0.2.2:3010` | Host39 server the app talks to (10.0.2.2 reaches the dev machine from the emulator) |
| Public base URL | mobile sign-in screen | falls back to the server URL | Base other agents use; goes into the signed `card.url` and NANDA `registry_url` |
| NANDA API URL | mobile NANDA screen (`NANDA.defaultApiUrl` in `mobile/src/config.ts`) | `https://api.nandaindex.org` | nanda-index-v2 instance used for registration; overridable in settings |

## API reference

Interactive OpenAPI docs are served at `/docs`. JWT auth is `Authorization: Bearer <token>`; protected routes answer `401 {"error":"UNAUTHORIZED","detail":"missing or invalid token"}` without one.

### Accounts (`server/src/routes/auth.ts`)

`POST /auth/register` (no auth). Body: `email`, `password` (8 to 128 chars), optional `display_name`, `identity_type` (`email` default, or `domain`), `domain` (required if `identity_type` is `domain`).

```json
{"email":"demo@example.com","password":"demo-pass-123"}
```

Returns `201 {"token":"<jwt>"}`. Errors: `400 BAD_REQUEST` (domain identity without domain), `409 CONFLICT` (email or domain taken).

`POST /auth/login` (no auth). Body: `email`, `password`. Returns `200 {"token":"<jwt>"}` or `401 UNAUTHORIZED`.

`GET /auth/me` (JWT). Returns `200 {"user_id","email","display_name","identity_type","domain"}`.

### Device registration (`server/src/routes/devices.ts`)

`POST /devices` (JWT). Registers a phone by its ES256 public key. Body:

```json
{"name":"Android phone","public_key":{"kty":"EC","crv":"P-256","x":"...","y":"..."}}
```

`public_key` must be an EC P-256 public JWK (`kty`, `crv`, `x`, `y`, no `d`), or the server answers `400 {"error":"INVALID_PUBLIC_KEY", ...}`. Success is `201`:

```json
{"id":"f30b3ecf-...","name":"Android phone","public_key":{},"connected":false,"connected_at":null,"last_heartbeat_at":null,"created_at":"...","last_seen_at":"..."}
```

(The response schema currently serializes `public_key` as an empty object; the key is stored correctly.)

`GET /devices` (JWT). Lists the caller's devices with live connection state: `connected` is true while a relay socket is attached, and `last_heartbeat_at` tracks pongs.

### Relay-session creation (`server/src/routes/devices.ts`)

`POST /devices/:id/relay-session` (JWT). Mints a short-lived single-use WebSocket credential for one of the caller's devices. Returns `201`:

```json
{"token":"xbVbY_...","expires_at":"2026-07-19T18:46:38.734Z","ws_url":"ws://localhost:3010/relay?token=xbVbY_..."}
```

The token lives `RELAY_TOKEN_TTL_SECONDS` (default 60 s), redeems exactly once, and only its SHA-256 hash is stored. `404 NOT_FOUND` when the device is not yours.

### Signed-card upload (`server/src/routes/mobile.ts`, invariants in `server/src/relay/cardCache.ts`)

`PUT /mobile/cards/:slug/cache` (JWT). Body:

```json
{"device_id":"<uuid>","card":{...},"signature":"<base64url ES256>","version":1}
```

Validation, in order:

1. `version` is an integer >= 1 and `card.version` must be present and strictly equal to it, otherwise `400 CARD_VERSION_MISMATCH`.
2. `version` must be strictly greater than the stored version for (account, slug), otherwise `409 STALE_VERSION`. A concurrent-upload guard on the upsert re-checks this atomically.
3. The card's URN (`_meta.identifier` or `identifier`) must be a personal URN whose email equals the account email and whose slug equals `:slug`, otherwise `403 IDENTITY_MISMATCH` (missing or non-personal URN is `400 INVALID_CARD`).
4. `card.url` must equal the public runtime URL `<PUBLIC_BASE_URL>/a2a/personal/<encoded-email>/<slug>` (the raw-email spelling is also accepted), otherwise `400 INVALID_CARD`.
5. `signature` must be a base64url ES256 signature over the RFC 8785 canonicalized card JSON that verifies against the device's registered public key (raw 64-byte r||s and DER encodings both accepted), otherwise `400 INVALID_SIGNATURE`.

Success: `200 {"ok":true,"slug":"demo","version":1}`. Unknown `device_id` for this account: `404 NOT_FOUND`. Slugs must match `^[a-z0-9][a-z0-9-]*$` (DB constraint).

### Public card retrieval (`server/src/routes/public.ts`, no auth)

- `GET /personal/:email/:slug.json`: serves the latest verified signed card from the cache first (works while the phone is offline), falling back to a legacy dashboard-created `agent_cards` row. Content type `application/a2a-agent-card+json`. `404 NOT_FOUND` otherwise.
- `GET /:domain/:slug.json`: domain-identity (business) cards.
- `GET /.well-known/ai-catalog.json`: catalog of active cards (`{"specVersion":"1.0","entries":[...]}`).
- `GET /health`: liveness plus a database round trip; `200 {"status":"ok"}`.

There is also a JWT-protected `/cards` CRUD used by the dashboard; the phone keeps a matching `agent_cards` row in sync through it when publishing.

### A2A message/send (`server/src/routes/a2a.ts`, no auth)

`POST /a2a/personal/:handle/:slug` where `<handle>` is the account email. JSON-RPC 2.0, method `message/send` only, text parts only:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {"message": {"role": "user", "parts": [{"kind": "text", "text": "What time is it?"}]}}
}
```

Success (`200`):

```json
{"jsonrpc":"2.0","id":1,"result":{"kind":"message","role":"agent","parts":[{"kind":"text","text":"..."}],"messageId":"msg-..."}}
```

Limits: the raw body and the concatenated text bytes are both capped at `RUNTIME_MAX_REQUEST_BYTES`; requests are rate limited per `<handle>:<slug>` at `RUNTIME_RATE_LIMIT_MAX` per `RUNTIME_RATE_LIMIT_WINDOW_MS`; the relay wait is bounded by `RUNTIME_TIMEOUT_MS`.

Error codes (from `A2A_ERRORS` in `server/src/relay/a2a.ts`; relay-specific conditions use the -32010..-32016 implementation range):

| JSON-RPC code | Message | HTTP | When |
|---|---|---|---|
| -32700 | Parse error | 400 | body is not valid JSON |
| -32600 | Invalid request | 400 | not a JSON-RPC 2.0 object, bad `id`, bad `params.message` shape |
| -32601 | Method not supported | 400 | method other than `message/send` |
| -32602 | Invalid params | 400 | missing message, empty or non-text parts |
| -32603 | Internal error | 500 | unexpected server failure |
| -32010 | Request too large | 413 | body or text exceeds `RUNTIME_MAX_REQUEST_BYTES` |
| -32011 | Device busy | 429 | the device already has an in-flight request |
| -32012 | Device unavailable | 503 | no live relay connection for the device |
| -32013 | Request timed out | 504 | no phone reply within `RUNTIME_TIMEOUT_MS` |
| -32014 | Agent not found | 404 | unknown handle, or no cached card for the slug |
| -32015 | Agent error | 502 | the phone answered with an error envelope; `error.data.detail` is `"<code>: <message>"` |
| -32016 | Rate limit exceeded | 429 | per-agent rate limit hit |

Device-side codes surfaced through -32015 detail (from `mobile/src/relay/envelope.ts`): `OFFLINE` -32020, `BUSY` -32021, `THERMAL` -32022, `LOW_BATTERY` -32023, `MODEL_NOT_LOADED` -32024, `DEADLINE_EXCEEDED` -32025, `UNKNOWN_CARD` -32026, plus standard -32601/-32602/-32603 for method, bad request, and internal failures on the phone.

## WebSocket relay spec

Protocol version 1 (`server/src/relay/envelope.ts`, mirrored in `mobile/src/relay/envelope.ts`). Each envelope is one JSON object per WebSocket text frame; frames above `RELAY_WS_MAX_PAYLOAD_BYTES` are rejected by the socket layer. Malformed frames are ignored.

Connect: `GET /relay?token=<single-use token>` (WebSocket upgrade). An invalid, expired, or already-redeemed token closes the socket with code 4001. A device has at most one bound socket; a newer connection replaces the older one, which is closed with code 4000.

| Envelope | Direction | Fields |
|---|---|---|
| `hello` | phone -> server | `type`, optional `protocol` (number) |
| `ready` | server -> phone | `type`, `deviceId`, `heartbeatIntervalMs` |
| `ping` | either | `type`, `ts` (unix epoch ms) |
| `pong` | either | `type`, `ts` (echoes the ping's ts) |
| `request` | server -> phone | `type`, `id` (non-empty string), `method` (`"message/send"` only), `slug` (non-empty string; the card the request is addressed to), `params`, `deadline` (unix epoch ms) |
| `response` | phone -> server | `type`, `id`, `result` |
| `error` | phone -> server | `type`, `id`, `code` (number), `message` (string) |

Rules:

- The phone sends `hello` as its first frame; the server answers `ready` announcing the heartbeat cadence.
- Heartbeat: the server pings every `RELAY_HEARTBEAT_INTERVAL_MS` (default 30 s); a pong resets the missed counter. After `RELAY_HEARTBEAT_MAX_MISSED` consecutive unanswered pings (default 2) the next tick closes the socket with code 4008, so a silent device is dropped after roughly (max missed + 1) intervals. Phone-initiated pings are answered with pongs echoing the same `ts`.
- Tokens are single use: every reconnect needs a fresh `POST /devices/:id/relay-session`. The Android foreground service mints them itself (native, using the stored JWT) and also asks JS, reconnecting with exponential backoff (2 s doubling to 60 s, with jitter).
- Request ids are server-generated UUIDs. The phone must answer each `request` with exactly one `response` or `error` carrying the same id. Only the current pending id is accepted; late or mismatched replies are ignored.
- `deadline` is `now + RUNTIME_TIMEOUT_MS` at dispatch. The server stops waiting at the timeout (-32013 to the caller) and ignores replies after it; the phone aborts inference when the deadline passes and reports `DEADLINE_EXCEEDED` (-32025).
- One request per device: a single pending slot per connection. A second concurrent request is refused with -32011 Device busy before anything is sent to the phone.
- Close codes: 4000 replaced by a newer connection, 4001 bad token, 4008 heartbeat timeout, 1001 server shutdown, 1011 internal error during token redemption.

## End-to-end curl walkthrough

Runs against a local dev server (`npm run dev:server` on `http://localhost:3010`). Every step below was executed and its output verified. Only the final `message/send` needs a connected phone; everything else works from a terminal, using a locally generated ES256 key in place of the Android Keystore.

```bash
BASE=http://localhost:3010
EMAIL=demo@example.com
```

1. Create an account and grab a JWT:

```bash
curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"demo-pass-123\"}"
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"demo-pass-123\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
```

2. Generate a test ES256 JWK (run from the repo root; `jose` is a server dependency in the workspace `node_modules`):

```bash
node -e "
(async () => {
  const { generateKeyPair, exportJWK } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  require('fs').writeFileSync('/tmp/host39-key.json', JSON.stringify({
    publicJwk: await exportJWK(publicKey),
    privateJwk: await exportJWK(privateKey),
  }, null, 2));
  console.log('wrote /tmp/host39-key.json');
})();
"
```

3. Register the device with the public JWK:

```bash
PUB=$(node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync("/tmp/host39-key.json")).publicJwk)')
curl -s -X POST $BASE/devices -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"curl walkthrough\",\"public_key\":$PUB}"
DEVICE_ID=<id from the response>
```

4. Mint a relay session (what the phone does before opening the WebSocket; the token is single use and expires in 60 s):

```bash
curl -s -X POST $BASE/devices/$DEVICE_ID/relay-session -H "Authorization: Bearer $TOKEN"
# {"token":"...","expires_at":"...","ws_url":"ws://localhost:3010/relay?token=..."}
```

5. Sign and publish a card. curl cannot ES256-sign, so use this small script (canonicalize + sign + PUT). Save as `sign-and-publish.mjs`:

```js
// TOKEN=... DEVICE_ID=... EMAIL=demo@example.com SLUG=demo VERSION=1 node sign-and-publish.mjs
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';

const { TOKEN, DEVICE_ID, EMAIL, SLUG = 'demo', BASE = 'http://localhost:3010' } = process.env;
const version = Number(process.env.VERSION ?? 1);
const { privateJwk } = JSON.parse(readFileSync('/tmp/host39-key.json', 'utf8'));

// Canonical JSON: sorted keys, no whitespace (matches server/src/relay/canonicalJson.ts).
const canonicalize = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(',')}}`;
};

const card = {
  name: 'Curl Demo Agent',
  description: 'Published from the README walkthrough',
  url: `${BASE}/a2a/personal/${encodeURIComponent(EMAIL)}/${SLUG}`,   // must match PUBLIC_BASE_URL
  version,                                                            // must equal the PUT body version
  capabilities: { streaming: false, pushNotifications: false },
  authentication: { schemes: ['none'] },
  skills: [],
  _meta: { identifier: `urn:ai:email:${EMAIL}:agent:${SLUG}`, hostedBy: 'host39.org' },
};

const key = createPrivateKey({ key: privateJwk, format: 'jwk' });
const signature = sign('sha256', Buffer.from(canonicalize(card), 'utf8'),
  { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');

const res = await fetch(`${BASE}/mobile/cards/${SLUG}/cache`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ device_id: DEVICE_ID, card, signature, version }),
});
console.log(res.status, await res.text());
```

```bash
TOKEN=$TOKEN DEVICE_ID=$DEVICE_ID EMAIL=$EMAIL SLUG=demo VERSION=1 node sign-and-publish.mjs
# 200 {"ok":true,"slug":"demo","version":1}
# Re-running with the same VERSION returns:
# 409 {"error":"STALE_VERSION","detail":"version 1 is not greater than stored version 1"}
```

6. Fetch the public card (no auth; served from the signed cache even with no phone connected):

```bash
curl -s "$BASE/personal/$EMAIL/demo.json"
```

7. Invoke the runtime. This step needs a connected phone: without one the relay has no socket for the device and you get exactly this:

```bash
curl -s -X POST "$BASE/a2a/personal/$EMAIL/demo" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"What time is it?"}]}}}'
# without a phone: HTTP 503
# {"jsonrpc":"2.0","id":1,"error":{"code":-32012,"message":"Device unavailable"}}
```

With the Android app hosting (signed in as the same account, card published, hosting toggle on), the same request returns the local model's answer as a JSON-RPC result.

## Android hosting guide

The hosting toggle (`mobile/src/hosting/hostingService.ts`) requires a saved card, a registered device key, a valid session, and the model. Turning it on verifies the model file's SHA-256, loads the engine (`n_ctx` 4096), mints a relay session, and starts the native foreground service with the WS URL, the single-use token, the API base URL, the device id, and the JWT.

- Foreground service: a `dataSync` foreground service (`RelayForegroundService`) owns the WebSocket so hosting survives backgrounding. It shows a persistent notification with the hosting state; Android 13+ prompts for notification permission.
- Restart and boot recovery: the service is `START_STICKY`; after a process kill it restores the WS URL, API base URL, device id, and JWT from encrypted preferences and mints a fresh relay token natively (`POST /devices/:id/relay-session` with the stored JWT), so hosting resumes without opening the app. A `BOOT_COMPLETED` receiver does the same after a reboot when hosting was left enabled. Relay tokens themselves are never persisted (single use). If the stored JWT is rejected, native minting latches off and the notification asks you to open the app.
- Reconnects: exponential backoff from 2 s doubling to 60 s with jitter, each attempt with a freshly minted token. The service answers relay pings natively (no JS round trip) and keeps a 30 s transport ping plus a 90 s inactivity watchdog that forces a reconnect.
- Offline signed cache: the server keeps serving the last verified signed card at the public URL while the phone is offline; only the runtime becomes unavailable (-32012).
- Request gating, checked before any inference: device online (else `OFFLINE`), no other request running (else `BUSY`), thermal status not in severe/critical/emergency/shutdown (else `THERMAL`), battery at or above 15 percent or charging (else `LOW_BATTERY`), model loaded (else `MODEL_NOT_LOADED`), the request's slug matches a locally published card (else `UNKNOWN_CARD`). Each rejection is a structured error envelope and an outcome-only audit entry.
- Confirming the relay is connected: the in-app status panel shows model / card / signed publication / relay / NANDA / public resolution state, and `GET /devices` (with your JWT) reports `connected: true` plus `last_heartbeat_at` for the device.

## Internal Device Agent package

`packages/react-native-device-agent` is the on-device agent harness: an `Agent` loop (think -> call tool -> observe -> repeat) over `LlamaEngine` (llama.rn) with a `ToolRegistry` of JSON-Schema-validated tools. The `mobile` workspace consumes it by package name; Metro watches and transpiles the workspace source directly (no build step).

Provenance (`packages/react-native-device-agent/UPSTREAM.md`): imported as monorepo source from `github.com/tremblerz/device-agent` at commit `30ca528` (main, July 2026), excluding the upstream demo app. Upstream ships no LICENSE, so the package is declared `UNLICENSED` and must remain private until upstream adds a license grant. Tests here are original; there is intentionally no sync machinery with upstream.

Model configuration (`mobile/src/config.ts`): Qwen2.5-1.5B-Instruct Q4_K_M (single-file GGUF from the bartowski repo, ~1.0 GB), loaded with `n_ctx` 4096. Downloads are verified against the pinned official SHA-256 (`1adf0b11...`, from the Hugging Face API) and the file is deleted on mismatch; the same check re-runs before every engine load.

Permitted tools (`mobile/src/agent/tools.ts`): the hosted agent gets ONLY `get_current_time`, `device_health`, `read_file`, `list_files`, and `write_file` (the last one registered only when the card's allow-writes setting is on). The Device Agent package's built-in tools (network, clipboard, contacts, calendar, location, notifications, wider filesystem) are deliberately not registered for remote callers. File tools are jailed to the knowledge folder by a path guard plus a resolved-URI check.

Adding a new app-sandbox tool safely:

1. Define it with `defineTool` in `createHostTools` in `mobile/src/agent/tools.ts` and add it to the returned array; that function is the single registration point per request.
2. Give the JSON Schema `"type": "object"` with explicit `properties`, `required`, and `"additionalProperties": false` so the model cannot smuggle extra arguments past validation.
3. Keep it read-only and side-effect free unless gated (follow the `allowWrites` pattern), never touch identity keys, tokens, or paths outside the knowledge folder, and remember every caller is an untrusted remote agent.

## Security

- JWTs: the server signs session JWTs with `JWT_SECRET` (`JWT_EXPIRES_IN`, default 7 d). On the device they live in `expo-secure-store` (Android Keystore backed), with an encrypted-preferences copy scoped to the foreground service so it can mint relay tokens after restarts.
- Single-use relay credentials: 32 random bytes, base64url. Only the SHA-256 hash is stored; redemption is one atomic UPDATE, so replay, expiry (60 s default), and double redemption all fail closed (socket close 4001).
- Device keys: ES256 (EC P-256) generated in the Android Keystore; the private key is non-exportable and the server only ever holds the public JWK. Registration rejects JWKs carrying a private component (`d`).
- Card integrity: the cache stores only cards whose ES256 signature verifies over the RFC 8785 canonical JSON against the registered device key, whose embedded `version` equals the upload version and strictly exceeds the stored one (no rollback), whose URN matches the authenticated account email and slug, and whose `url` is the real public runtime URL. The server serves the stored bytes verbatim.
- Public email-derived URNs: `urn:ai:email:<email>:agent:<slug>` makes the account email public by design, in the URN, the card URL, and the catalog. Do not host from an email address you are not willing to publish.
- Rate limiting and size caps: the A2A runtime is rate limited per agent (`RUNTIME_RATE_LIMIT_MAX` per window) and bounds request bodies (`RUNTIME_MAX_REQUEST_BYTES`), relay frames (`RELAY_WS_MAX_PAYLOAD_BYTES`), and wait time (`RUNTIME_TIMEOUT_MS`).
- No prompt logging: request and response payloads transit memory only. The database persists cards, signatures, device public keys, versions, and connection timestamps; relay session rows are token hashes. The phone keeps an outcome-only audit log (timestamp, card, outcome, error code), never prompt or answer text.

## Troubleshooting

- Migrations fail: `npm run migrate` needs `server/.env` (it loads `--env-file=.env`) and a reachable `DATABASE_URL`. Applied files are tracked in `schema_migrations` and each file runs in its own transaction, so a failed migration rolls back and can be rerun; "no migrations directory found" means you are not running from `server/` via the workspace script.
- WebSocket disconnects: close 4001 means a bad or reused token (they are single use; mint a new session per connect), 4000 means another socket for the same device took over, 4008 means missed heartbeats. Behind a proxy, confirm the `/relay` route passes the upgrade through and that `RELAY_PUBLIC_URL` (or the `PUBLIC_BASE_URL` it derives from) points at that proxy.
- `INVALID_SIGNATURE` on card upload: sign exactly the canonicalized card JSON (sorted keys, no whitespace), base64url-encode the signature, and make sure the signing key matches the registered device key. Both raw 64-byte and DER signatures are accepted.
- `CARD_VERSION_MISMATCH`: the `version` inside the signed card must be present and strictly equal to the top-level `version` in the PUT body.
- `STALE_VERSION` (409): the version must be strictly greater than the stored one; bump it and re-sign.
- `INVALID_CARD` mentioning `card.url`: the card must advertise `<PUBLIC_BASE_URL>/a2a/personal/<encoded-email>/<slug>` and the server's `PUBLIC_BASE_URL` must match the base URL the phone used. Check both sides after changing either.
- Model checksum or load failures: a checksum mismatch deletes the file; download again on a stable connection. Load failures after a good checksum are usually memory pressure; close other apps or use a device with more RAM.
- Runtime timeouts (-32013 / 504): the phone did not answer within `RUNTIME_TIMEOUT_MS`. Small devices can be slow at `n_ctx` 4096; raise the timeout or shorten prompts. -32015 with `DEADLINE_EXCEEDED` detail means the phone itself gave up at the deadline.
- Battery restrictions: below 15 percent and not charging the phone rejects requests (`LOW_BATTERY`). Also exclude the app from aggressive OEM battery optimization if the foreground service keeps dying.
- NANDA record stuck pending: the registration activates only when the contact email is verified; click the link the index sent, and confirm the account email matches the URN email exactly (the index rejects or holds mismatches; this behavior comes from `patches/nanda-index-v2-personal-email-activation.patch`). The app polls every 15 s, or use the refresh action.
- Port gotchas: the API listens on 3010, not 3000. The emulator default is `http://10.0.2.2:3010`; the Compose Postgres is on host port 5434 (not 5432); `npm run dev:web` serves on 3000 unless `PORT=3002` while the Docker stack uses 3002.

## Deployment

Local stack (Postgres + API + web) with Docker:

```bash
cp .env.example .env
docker compose up --build
```

| Service | URL |
|---|---|
| Web UI | http://localhost:3002 |
| API | http://localhost:3010 |
| API docs | http://localhost:3010/docs |
| Postgres | localhost:5434 |

Both Dockerfiles require the repo root as the build context (the workspace `package-lock.json` lives there); the compose files set `context: .` with `dockerfile: server/Dockerfile` and `web/Dockerfile` accordingly. The server image runs `entrypoint.sh`, which applies migrations before starting, so a fresh stack needs no manual migrate step. The dev compose runs `NODE_ENV=development`; the db service has a `pg_isready` healthcheck the server waits on.

Production:

```bash
cp .env.prod.example .env.prod
# Fill in POSTGRES_PASSWORD and JWT_SECRET (generate with: openssl rand -hex 64)
docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d
```

`docker-compose.prod.yml` runs db, server (`NODE_ENV=production`), web, and Caddy, and forwards the full relay/runtime variable group (`RELAY_PUBLIC_URL`, `RELAY_TOKEN_TTL_SECONDS`, `RELAY_HEARTBEAT_INTERVAL_MS`, `RELAY_HEARTBEAT_MAX_MISSED`, `RELAY_WS_MAX_PAYLOAD_BYTES`, `RUNTIME_TIMEOUT_MS`, `RUNTIME_MAX_REQUEST_BYTES`, `RUNTIME_RATE_LIMIT_MAX`, `RUNTIME_RATE_LIMIT_WINDOW_MS`) with the defaults above; only override what you need. Leave `RELAY_PUBLIC_URL` blank to derive `wss://<PUBLIC_BASE_URL host>/relay`.

Caddy (`Caddyfile.prod`) terminates TLS for two hosts:

- `host39.org`: dashboard plus API. `/auth/*`, `/cards/*`, `/.well-known/*`, `/devices/*`, `/mobile/*`, `/relay`, `/a2a/*`, and `/health` go to the server; everything else to the Next.js web container.
- `agentcards.host39.org` (`PUBLIC_BASE_URL`): public card serving. `/personal/*`, `/a2a/*`, `/relay`, `/health`, and the domain-card regex route go to the server; other paths redirect to host39.org. `reverse_proxy` passes the WebSocket upgrade for `/relay` through unchanged.

`Caddyfile` (non-prod) is the same shape against `localhost` ports for a single-host setup.

Production verification, in order:

```bash
# 1. Health (includes a DB round trip) on both hosts
curl -s https://host39.org/health
curl -s https://agentcards.host39.org/health
# {"status":"ok"}

# 2. Card serving and catalog
curl -s https://agentcards.host39.org/.well-known/ai-catalog.json
curl -s "https://agentcards.host39.org/personal/<email>/<slug>.json"

# 3. Relay endpoint: the upgrade must pass through the proxy.
#    Expect "HTTP/1.1 101 Switching Protocols"; the socket then closes 4001 (bad token).
curl -si -N --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: c2FtcGxlIG5vbmNlMTIzNA==' \
  'https://agentcards.host39.org/relay?token=invalid' | head -1

# 4. A2A runtime routing: expect a JSON-RPC error body, proving the route hits the server
#    (-32014 Agent not found for an unknown agent, -32012 Device unavailable for a real
#    agent whose phone is offline)
curl -s -X POST https://agentcards.host39.org/a2a/personal/nobody@example.com/none \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"ping"}]}}}'
```

A phone can then sign in with the production URL, publish, and host; `GET /devices` shows `connected: true` once its relay socket is up.

---

## Also in this repo

| Path | What it is |
| --- | --- |
| [`packages/react-native-device-agent`](packages/react-native-device-agent) | The on-device LLM agent harness (llama.rn-based): the agentic loop, tool registry, and batteries-included device/filesystem/network tools. Imported internally per [`UPSTREAM.md`](packages/react-native-device-agent/UPSTREAM.md); consumed by the `mobile` workspace. |
| [`mobile`](mobile) | The Host39 Android app: runs the device-agent harness locally, signs its own agent card, and relays A2A requests through this server. |
| [`example`](example) | A standalone Expo demo app for the `react-native-device-agent` harness (chat UI, not part of the `mobile` Host39 app). Run it with the `example:*` npm scripts (`example:start`, `example:ios`, `example:android`, `example:web`). |
| [`agentfacts.json`](agentfacts.json) | A static AgentFacts / Agent Card describing the `example` demo's configuration. See [`AGENTS.md`](AGENTS.md) for the decisions and known limitations behind it, including why this repo has two unrelated git histories merged together. |
