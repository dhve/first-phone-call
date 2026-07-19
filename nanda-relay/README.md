# NANDA relay

A store-and-forward mailbox. Phones can't accept inbound HTTP, so callers POST
to `/run` here and the phone long-polls `/inbox` for work, answering on `/outbox`.

**No inference, no LLM API calls, no database.** In-memory only; state dies with
the process.

## Run

```bash
cd nanda-relay
npm install
npx tsx relay.ts
```

Binds `0.0.0.0:8787`, so the phone can reach it over the LAN
(`http://<mac-lan-ip>:8787`) as well as through the tunnel.

Find your Mac's LAN IP:

```bash
ipconfig getifaddr en0
```

## Expose it (second terminal)

```bash
cloudflared tunnel --url http://localhost:8787
```

Copy the printed `https://<something>.trycloudflare.com` URL, then restart the
relay with it so the agent card advertises the right address:

```bash
PUBLIC_URL=https://<something>.trycloudflare.com npx tsx relay.ts
```

## Env

| var              | default                 | purpose                                    |
| ---------------- | ----------------------- | ------------------------------------------ |
| `PORT`           | `8787`                  | listen port                                 |
| `HOST`           | `0.0.0.0`               | listen host                                 |
| `PUBLIC_URL`     | `http://localhost:8787` | base URL written into the agent card's `url` |
| `AGENT_NAME`     | `Phone Agent`           | agent card name                             |
| `RUN_TIMEOUT_MS` | `60000`                 | how long `/run` waits for the phone         |

## Endpoints

| method | path          | purpose                                                        |
| ------ | ------------- | -------------------------------------------------------------- |
| GET    | `/health`     | `{ ok: true }`                                                  |
| GET    | `/agent-card` | A2A card; `url` is `${PUBLIC_URL}/run`                          |
| POST   | `/run`        | `{ message, from? }` → blocks → `{ id, reply }` or 504 `{ id }` |
| GET    | `/inbox`      | phone polls; oldest pending `{ id, message, from }` or 204      |
| POST   | `/outbox`     | `{ id, reply }` → unblocks the waiting `/run`                   |
| GET    | `/log`        | last 50 events                                                  |

## Prove the loop with no phone attached

**Terminal A** — place a call. This blocks:

```bash
curl -s -X POST localhost:8787/run \
  -H 'Content-Type: application/json' \
  -d '{"message":"Hello from the other agent. Who are you?","from":"urn:ai:demo:mac"}'
```

**Terminal B** — play the phone:

```bash
curl -s localhost:8787/inbox
# {"id":"b3bea042-...","message":"Hello from the other agent. Who are you?","from":"urn:ai:demo:mac"}

curl -s -X POST localhost:8787/outbox \
  -H 'Content-Type: application/json' \
  -d '{"id":"PASTE_ID_HERE","reply":"I am a Qwen2.5-1.5B agent running on-device."}'
```

Terminal A unblocks with:

```json
{ "id": "b3bea042-...", "reply": "I am a Qwen2.5-1.5B agent running on-device." }
```

## Audio phone calls

The relay also mediates spoken calls between the two phones. Text still moves
as text; the relay synthesizes each turn with Microsoft Edge TTS (the one
outbound dependency; only this laptop needs internet) and the phones fetch the
audio by reference, play it, and transcribe it with whisper on-device.

Call endpoints (all JSON):

- `POST /call/offer {from}` starts a session; the peer lane's inbox rings.
  Unanswered calls hang up after 30 s (`RING_TIMEOUT_MS`).
- `POST /call/accept {sessionId, from}` answers; the caller speaks first.
- `POST /call/turn {sessionId, from, text}` synthesizes speech (voice per
  lane: `TTS_VOICE_A`/`TTS_VOICE_B`, defaults Guy/Jenny) and delivers
  `{kind:"turn", turnNo, audioId, debugText}` to the peer. If TTS fails twice
  the turn is delivered with `audioId: null` and the peer reads the text.
- `GET /audio/:id` returns the 16 kHz mono WAV for a turn (5 min TTL).
- `POST /call/hangup {sessionId, from, reason}` ends the call.
- `POST /ack {messageId}` marks a typed inbox item processed. Unacked items
  requeue after 40 s, so a phone dying mid-turn does not eat the call.
- `GET /tts?text=...&lane=a` is the debug shortcut: the exact per-turn
  synthesis path, as a WAV response.

Typed items ride the same `GET /inbox` as legacy calls; anything with a
`kind` field is a call item, anything without is the old text shape.
