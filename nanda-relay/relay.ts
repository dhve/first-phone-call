/**
 * NANDA demo relay — a dumb mailbox between the public internet and a phone.
 *
 * Phones cannot accept inbound HTTP, so callers POST /run here and the phone
 * long-polls GET /inbox for work, then POSTs the answer to /outbox.
 *
 * This process performs NO inference and calls NO LLM API. It stores and
 * forwards messages, nothing else. All state is in memory and dies with it.
 *
 *   npx tsx relay.ts
 */

import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, '');
const AGENT_NAME = process.env.AGENT_NAME ?? 'Phone Agent';
/** How long POST /run waits for the phone before giving up. */
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? 60_000);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type CallStatus = 'queued' | 'in-flight' | 'answered' | 'timed-out';

interface Call {
  id: string;
  message: string;
  from: string;
  status: CallStatus;
  receivedAt: number;
}

/** Every call ever seen this process lifetime, oldest first. */
const calls: Call[] = [];
/** id -> resolver for the HTTP request currently blocked in POST /run. */
const waiters = new Map<string, (reply: string | null) => void>();

interface LogEvent {
  at: string;
  kind: string;
  id?: string;
  text: string;
}

const events: LogEvent[] = [];

function log(kind: string, text: string, id?: string): void {
  const at = new Date().toISOString();
  events.push({ at, kind, id, text });
  if (events.length > 50) events.shift();
  // One readable line per event — this goes on a projector.
  const short = id ? id.slice(0, 8) : '--------';
  console.log(`${at}  ${kind.padEnd(18)}  ${short}  ${text}`);
}

/** Trim a message for log lines so one call never wraps the projector. */
function preview(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '1mb' }));

// No auth by design; open CORS so a browser tab can drive the demo too.
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  next();
});
app.options(/.*/, (_req, res) => res.sendStatus(204));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/**
 * A2A agent card. `url` points at this relay's /run, so a remote agent that
 * discovers us through the NANDA Index knows exactly where to send messages.
 */
app.get('/agent-card', (_req: Request, res: Response) => {
  res.json({
    protocolVersion: '0.2.0',
    name: AGENT_NAME,
    description:
      'An AI agent running entirely on an Android phone (Qwen2.5-1.5B via llama.rn). ' +
      'Reached through a store-and-forward relay because phones cannot accept inbound HTTP.',
    url: `${PUBLIC_URL}/run`,
    version: '0.1.0',
    provider: { organization: 'NANDA hackathon demo' },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'chat',
        name: 'Chat',
        description: 'Answer a question or hold a conversation. Inference runs on-device.',
        tags: ['chat', 'on-device', 'local-llm'],
        examples: ['What model are you running?', 'Who am I talking to?'],
      },
      {
        id: 'agent-to-agent',
        name: 'Agent-to-agent call',
        description:
          'Accept a message from another agent discovered via the NANDA Index and reply in text.',
        tags: ['a2a', 'nanda'],
        examples: ['Introduce yourself to the agent on the other phone.'],
      },
    ],
  });
});

/** Inbound call from the outside world. Blocks until the phone answers. */
app.post('/run', async (req: Request, res: Response) => {
  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  const from = typeof req.body?.from === 'string' && req.body.from ? req.body.from : 'anonymous';

  if (!message.trim()) {
    res.status(400).json({ error: 'body must include a non-empty "message" string' });
    return;
  }

  const call: Call = { id: randomUUID(), message, from, status: 'queued', receivedAt: Date.now() };
  calls.push(call);
  log('CALL RECEIVED', `from ${from}: "${preview(message)}"`, call.id);

  const reply = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(call.id);
      resolve(null);
    }, RUN_TIMEOUT_MS);

    waiters.set(call.id, (value) => {
      clearTimeout(timer);
      waiters.delete(call.id);
      resolve(value);
    });

    // Caller hung up — stop holding the slot. This must listen on `res`, not
    // `req`: the request stream closes as soon as express.json() drains the
    // body, which would abort every call the moment it arrived.
    res.on('close', () => {
      if (!res.writableEnded && waiters.has(call.id)) {
        clearTimeout(timer);
        waiters.delete(call.id);
        resolve(null);
      }
    });
  });

  if (reply === null) {
    // Only queued work is worth cancelling; if the phone already took it,
    // leave it alone so the late /outbox still logs cleanly.
    if (call.status === 'queued') call.status = 'timed-out';
    log('CALL TIMED OUT', `no device reply in ${RUN_TIMEOUT_MS / 1000}s`, call.id);
    res.status(504).json({ id: call.id });
    return;
  }

  log('REPLY RETURNED', `to ${from}: "${preview(reply)}"`, call.id);
  res.json({ id: call.id, reply });
});

/** The phone polls this. Hands out each queued call exactly once. */
app.get('/inbox', (_req: Request, res: Response) => {
  const next = calls.find((c) => c.status === 'queued');
  if (!next) {
    res.sendStatus(204);
    return;
  }
  next.status = 'in-flight';
  log('HANDED TO DEVICE', `"${preview(next.message)}"`, next.id);
  res.json({ id: next.id, message: next.message, from: next.from });
});

/** The phone posts its answer here, unblocking the matching /run. */
app.post('/outbox', (req: Request, res: Response) => {
  const id = typeof req.body?.id === 'string' ? req.body.id : '';
  const reply = typeof req.body?.reply === 'string' ? req.body.reply : '';

  if (!id || !reply) {
    res.status(400).json({ error: 'body must include "id" and "reply" strings' });
    return;
  }

  const call = calls.find((c) => c.id === id);
  if (!call) {
    log('UNKNOWN REPLY', `no such call id ${id}`, id);
    res.status(404).json({ error: `unknown call id ${id}` });
    return;
  }

  log('DEVICE REPLIED', `"${preview(reply)}"`, id);
  call.status = 'answered';

  const waiter = waiters.get(id);
  if (!waiter) {
    // The caller already gave up (504) or disconnected. Not an error for the
    // phone — it did its job — but worth showing on the projector.
    log('REPLY TOO LATE', 'caller already gave up; reply discarded', id);
    res.status(202).json({ ok: true, delivered: false });
    return;
  }

  waiter(reply);
  res.json({ ok: true, delivered: true });
});

/** Last 50 events, for the demo screen. */
app.get('/log', (_req: Request, res: Response) => {
  res.json({ events });
});

app.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  NANDA relay listening on http://${HOST}:${PORT}`);
  console.log(`  public url    ${PUBLIC_URL}`);
  console.log(`  agent card    ${PUBLIC_URL}/agent-card`);
  console.log(`  run timeout   ${RUN_TIMEOUT_MS / 1000}s`);
  console.log('');
});
