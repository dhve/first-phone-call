/**
 * NANDA demo relay — a dumb mailbox between the public internet and a phone.
 *
 * Phones cannot accept inbound HTTP, so callers POST /run here and the phone
 * long-polls GET /inbox for work, then POSTs the answer to /outbox.
 *
 * This process performs NO inference and calls NO LLM API. Its one outbound
 * dependency is Microsoft Edge TTS, used to synthesize call turns to speech
 * so the phones need only LAN access. All state is in memory and dies with it.
 *
 *   npx tsx relay.ts
 */

import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { speakTurn } from './tts.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, '');
const AGENT_NAME = process.env.AGENT_NAME ?? 'Phone Agent';
/** How long POST /run waits for the phone before giving up. */
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? 120_000);
/**
 * How long a message may sit with a device before it is offered again.
 *
 * A phone that is killed mid-inference — which happens on a memory-tight
 * device holding a model — takes the message with it. Without this the call is
 * simply lost: the relay has marked it handed out, so nothing ever gives it to
 * the phone that comes back, and the caller waits out the full timeout for a
 * reply nobody is still working on.
 */
const REQUEUE_AFTER_MS = Number(process.env.REQUEUE_AFTER_MS ?? 40_000);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type CallStatus = 'queued' | 'in-flight' | 'answered' | 'timed-out';

interface Call {
  id: string;
  message: string;
  from: string;
  /** Which registered agent this call is addressed to. */
  to: string;
  status: CallStatus;
  receivedAt: number;
  /** When a device took this call, for the stale-in-flight sweep. */
  handedAt?: number;
}

/** Every call ever seen this process lifetime, oldest first. */
const calls: Call[] = [];
/** id -> resolver for the HTTP request currently blocked in POST /run. */
const waiters = new Map<string, (reply: string | null) => void>();

// ---------------------------------------------------------------------------
// Agent registry — so devices pair themselves instead of being configured
// ---------------------------------------------------------------------------

interface Agent {
  /** Stable lane name: the first device to register is "a", the second "b". */
  id: string;
  /** Caller-supplied identity, used only for logging. */
  name: string;
  /** Per-install id, so a reload reclaims the same lane instead of a new one. */
  deviceId: string;
  lastSeen: number;
}

/** Lane -> agent. Capped at two: this is a phone call, not a conference. */
const agents = new Map<string, Agent>();
const LANES = ['a', 'b'];

/**
 * Give a device a lane. Re-registering with the same deviceId returns the same
 * lane, so hot-reloading the app doesn't consume the second slot and strand
 * the real peer. When both lanes are taken by other devices, the stalest is
 * evicted -- during a demo that is always a dead app, never a live one.
 */
function registerAgent(deviceId: string, name: string): Agent {
  for (const agent of agents.values()) {
    if (agent.deviceId === deviceId) {
      agent.name = name;
      agent.lastSeen = Date.now();
      return agent;
    }
  }

  let lane = LANES.find((l) => !agents.has(l));
  if (!lane) {
    let stalest: Agent | undefined;
    for (const agent of agents.values()) {
      if (!stalest || agent.lastSeen < stalest.lastSeen) stalest = agent;
    }
    lane = stalest!.id;
    log('LANE RECLAIMED', `${lane} was idle, reassigning to ${name}`);
    agents.delete(lane);
  }

  const agent: Agent = { id: lane, name, deviceId, lastSeen: Date.now() };
  agents.set(lane, agent);
  return agent;
}

/** The other occupied lane, if a second device has registered. */
function peerOf(id: string): Agent | null {
  for (const agent of agents.values()) if (agent.id !== id) return agent;
  return null;
}

// ---------------------------------------------------------------------------
// Call sessions - ring, answer, spoken turns, hangup
// ---------------------------------------------------------------------------

type CallSessionState = 'ringing' | 'active' | 'ended';

interface CallSession {
  id: string;
  caller: string;
  callee: string;
  state: CallSessionState;
  createdAt: number;
  lastActivityAt: number;
  /** Count of spoken turns so far; stamped onto each turn item. */
  turnNo: number;
}

const sessions = new Map<string, CallSession>();
/** How long a call may ring before the relay gives up for the caller. */
const RING_TIMEOUT_MS = Number(process.env.RING_TIMEOUT_MS ?? 30_000);
/** Sessions with no activity this long are swept; demos never pause 5 min. */
const SESSION_IDLE_MS = Number(process.env.SESSION_IDLE_MS ?? 5 * 60_000);

/**
 * Synthesized turn audio, by id, fetched once by the receiving phone.
 * Kept out of the inbox JSON on purpose: a WAV would blow the 1 MB body
 * limit, and the phone only needs the bytes once.
 */
const audioStore = new Map<string, { wav: Buffer; at: number }>();
const AUDIO_TTL_MS = Number(process.env.AUDIO_TTL_MS ?? 5 * 60_000);

/**
 * Typed call items delivered through the same inbox as legacy text calls.
 * Items keep the hand-out-once + requeue-if-stale discipline that took real
 * debugging to get right for /run; the completion signal here is POST /ack
 * instead of /outbox, because call items have no blocked HTTP caller.
 */
interface CallItem {
  id: string;
  /** Lane this item is addressed to. */
  to: string;
  kind: 'offer' | 'accept' | 'turn' | 'hangup';
  sessionId: string;
  status: 'queued' | 'in-flight' | 'done';
  handedAt?: number;
  /** offer only */
  fromName?: string;
  /** turn only */
  turnNo?: number;
  audioId?: string | null;
  debugText?: string;
  /** hangup only */
  reason?: string;
}

const callItems: CallItem[] = [];

function queueItem(item: Omit<CallItem, 'id' | 'status'>): CallItem {
  const full: CallItem = { ...item, id: randomUUID(), status: 'queued' };
  callItems.push(full);
  return full;
}

function touchSession(session: CallSession): void {
  session.lastActivityAt = Date.now();
}

function endSession(session: CallSession, reason: string, notify: string[]): void {
  if (session.state === 'ended') return;
  session.state = 'ended';
  touchSession(session);
  // Anything still queued for this call is moot once it is over.
  for (const item of callItems) {
    if (item.sessionId === session.id && item.status !== 'done' && item.kind !== 'hangup') {
      item.status = 'done';
    }
  }
  for (const lane of notify) {
    queueItem({ to: lane, kind: 'hangup', sessionId: session.id, reason });
  }
  log('HUNG UP', `${reason} (${session.caller} <-> ${session.callee})`, session.id);
}

/** Ringing timeouts, idle sessions, and expired audio, in one sweep. */
setInterval(() => {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (session.state === 'ringing' && now - session.createdAt > RING_TIMEOUT_MS) {
      endSession(session, 'no-answer', [session.caller, session.callee]);
    } else if (session.state !== 'ended' && now - session.lastActivityAt > SESSION_IDLE_MS) {
      endSession(session, 'idle-timeout', [session.caller, session.callee]);
    }
  }
  for (const [id, entry] of audioStore) {
    if (now - entry.at > AUDIO_TTL_MS) audioStore.delete(id);
  }
}, 5_000).unref();

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
      'An AI agent running entirely on an Android phone (Gemma 3 270M via llama.rn). ' +
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

/**
 * A device claims a lane and learns who it is talking to. Polled until a peer
 * shows up, so the two apps pair themselves with no addresses typed by hand.
 */
app.post('/register', (req: Request, res: Response) => {
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : '';
  const name = typeof req.body?.name === 'string' && req.body.name ? req.body.name : 'unnamed device';

  if (!deviceId) {
    res.status(400).json({ error: 'body must include a "deviceId" string' });
    return;
  }

  const known = [...agents.values()].some((a) => a.deviceId === deviceId);
  const agent = registerAgent(deviceId, name);
  const peer = peerOf(agent.id);

  if (!known) {
    log('AGENT REGISTERED', `"${name}" took lane ${agent.id}`, agent.id);
  }

  res.json({
    agentId: agent.id,
    name: agent.name,
    peerId: peer?.id ?? null,
    peerName: peer?.name ?? null,
  });
});

/** Inbound call. Blocks until the addressed device answers. */
app.post('/run', async (req: Request, res: Response) => {
  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  const from = typeof req.body?.from === 'string' && req.body.from ? req.body.from : 'anonymous';
  // Default to the first registered lane so plain curl still works.
  const to = typeof req.body?.to === 'string' && req.body.to
    ? req.body.to
    : (agents.keys().next().value ?? 'a');

  if (!message.trim()) {
    res.status(400).json({ error: 'body must include a non-empty "message" string' });
    return;
  }

  const call: Call = {
    id: randomUUID(),
    message,
    from,
    to,
    status: 'queued',
    receivedAt: Date.now(),
  };
  calls.push(call);
  const toName = agents.get(to)?.name ?? to;
  log('CALL RECEIVED', `${from} → ${toName}: "${preview(message)}"`, call.id);

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

/**
 * A device polls its own lane. Hands out each queued call exactly once, and
 * only to the agent it was addressed to -- without the lane filter two devices
 * polling the same relay would steal each other's messages.
 */
app.get('/inbox', (req: Request, res: Response) => {
  const agentId = typeof req.query.agent === 'string' ? req.query.agent : '';
  if (agentId) {
    const agent = agents.get(agentId);
    if (agent) agent.lastSeen = Date.now();
  }

  // Offer again anything a device took but never answered — it died holding
  // the message. Only while the caller is still waiting; a call nobody is
  // listening for is not worth redelivering.
  const now = Date.now();
  for (const call of calls) {
    if (
      call.status === 'in-flight' &&
      waiters.has(call.id) &&
      now - (call.handedAt ?? now) > REQUEUE_AFTER_MS
    ) {
      call.status = 'queued';
      log('CALL REQUEUED', 'device went away holding it; offering again', call.id);
    }
  }

  // Typed call items follow the same discipline, with /ack as the completion
  // signal and the session having to still be live to be worth redelivering.
  for (const item of callItems) {
    if (
      item.status === 'in-flight' &&
      sessions.get(item.sessionId)?.state !== 'ended' &&
      now - (item.handedAt ?? now) > REQUEUE_AFTER_MS
    ) {
      item.status = 'queued';
      log('ITEM REQUEUED', `${item.kind} went unacked; offering again`, item.sessionId);
    }
  }

  // Call items outrank legacy text calls: a ringing phone should ring now,
  // not after a queued trivia question drains.
  const nextItem = callItems.find((i) => i.status === 'queued' && i.to === agentId);
  if (nextItem) {
    nextItem.status = 'in-flight';
    nextItem.handedAt = Date.now();
    if (nextItem.kind === 'offer') {
      log('RINGING', `lane ${nextItem.to} is ringing (${nextItem.fromName})`, nextItem.sessionId);
    }
    const { status: _s, handedAt: _h, to: _t, ...wire } = nextItem;
    res.json(wire);
    return;
  }

  const next = calls.find(
    (c) => c.status === 'queued' && (!agentId || c.to === agentId),
  );
  if (!next) {
    res.sendStatus(204);
    return;
  }
  next.status = 'in-flight';
  next.handedAt = Date.now();
  log('HANDED TO DEVICE', `lane ${next.to}: "${preview(next.message)}"`, next.id);
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

// ---------------------------------------------------------------------------
// Call routes - ring, answer, spoken turns, hangup
// ---------------------------------------------------------------------------

function laneOf(req: Request): string {
  return typeof req.body?.from === 'string' ? req.body.from : '';
}

function sessionOf(req: Request, res: Response): CallSession | null {
  const id = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  const session = sessions.get(id);
  if (!session) {
    res.status(404).json({ error: `unknown sessionId ${id}` });
    return null;
  }
  return session;
}

/** A phone dials its peer. The peer's inbox rings; ours waits for accept. */
app.post('/call/offer', (req: Request, res: Response) => {
  const from = laneOf(req);
  const caller = agents.get(from);
  if (!caller) {
    res.status(400).json({ error: '"from" must be a registered lane' });
    return;
  }
  const peer = peerOf(from);
  if (!peer) {
    res.status(409).json({ error: 'no peer registered yet' });
    return;
  }
  // One live call at a time: a new offer while another session is ringing or
  // active would interleave two conversations on the same two phones.
  for (const s of sessions.values()) {
    if (s.state !== 'ended') {
      res.status(409).json({ error: `session ${s.id} is still ${s.state}`, sessionId: s.id });
      return;
    }
  }

  const session: CallSession = {
    id: randomUUID(),
    caller: from,
    callee: peer.id,
    state: 'ringing',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    turnNo: 0,
  };
  sessions.set(session.id, session);
  queueItem({ to: peer.id, kind: 'offer', sessionId: session.id, fromName: caller.name });
  log('CALL OFFERED', `${caller.name} (${from}) is calling ${peer.name} (${peer.id})`, session.id);
  res.json({ sessionId: session.id, ringTimeoutMs: RING_TIMEOUT_MS });
});

/** The ringing phone answers. The caller's inbox learns and speaks first. */
app.post('/call/accept', (req: Request, res: Response) => {
  const session = sessionOf(req, res);
  if (!session) return;
  const from = laneOf(req);
  if (from !== session.callee) {
    res.status(403).json({ error: 'only the callee can accept' });
    return;
  }
  if (session.state !== 'ringing') {
    res.status(409).json({ error: `session is ${session.state}, not ringing` });
    return;
  }
  session.state = 'active';
  touchSession(session);
  queueItem({ to: session.caller, kind: 'accept', sessionId: session.id });
  log('ANSWERED', `${agents.get(from)?.name ?? from} picked up`, session.id);
  res.json({ ok: true });
});

/**
 * A spoken turn. The relay synthesizes the text to speech (voice keyed by the
 * SENDING lane, so each agent keeps one recognizable voice) and delivers the
 * audio by reference. If Edge TTS fails twice the turn still goes through
 * with audioId null and the receiver falls back to the text.
 */
app.post('/call/turn', async (req: Request, res: Response) => {
  const session = sessionOf(req, res);
  if (!session) return;
  const from = laneOf(req);
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (from !== session.caller && from !== session.callee) {
    res.status(403).json({ error: '"from" is not part of this call' });
    return;
  }
  if (session.state !== 'active') {
    res.status(409).json({ error: `session is ${session.state}, not active` });
    return;
  }
  if (!text) {
    res.status(400).json({ error: 'body must include a non-empty "text" string' });
    return;
  }

  touchSession(session);
  const to = from === session.caller ? session.callee : session.caller;
  session.turnNo += 1;
  const turnNo = session.turnNo;

  let audioId: string | null = null;
  try {
    const wav = await speakTurn(text, from);
    audioId = randomUUID();
    audioStore.set(audioId, { wav, at: Date.now() });
    log('TURN SPOKEN', `turn ${turnNo} by ${from}: "${preview(text)}" (${wav.length} bytes)`, session.id);
  } catch (e) {
    log('TTS FAILED', `turn ${turnNo} degrades to text: ${(e as Error).message}`, session.id);
  }

  touchSession(session);
  queueItem({ to, kind: 'turn', sessionId: session.id, turnNo, audioId, debugText: text });
  res.json({ ok: true, turnNo, audioId });
});

/** Either side ends the call; the peer's inbox hears about it. */
app.post('/call/hangup', (req: Request, res: Response) => {
  const session = sessionOf(req, res);
  if (!session) return;
  const from = laneOf(req);
  const reason = typeof req.body?.reason === 'string' && req.body.reason ? req.body.reason : 'hangup';
  const peerLane = from === session.caller ? session.callee : session.caller;
  endSession(session, reason, [peerLane]);
  res.json({ ok: true });
});

/** The receiving phone fetches a turn's synthesized audio exactly once. */
app.get('/audio/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  const entry = audioStore.get(typeof id === 'string' ? id : '');
  if (!entry) {
    res.status(404).json({ error: 'unknown or expired audio id' });
    return;
  }
  res.setHeader('Content-Type', 'audio/wav');
  res.send(entry.wav);
});

/**
 * A phone confirms it fully processed a typed inbox item. Until then the
 * item is redelivered after REQUEUE_AFTER_MS, same as legacy calls, so a
 * phone dying mid-turn does not silently eat the call.
 */
app.post('/ack', (req: Request, res: Response) => {
  const id = typeof req.body?.messageId === 'string' ? req.body.messageId : '';
  const item = callItems.find((i) => i.id === id);
  if (!item) {
    res.status(404).json({ error: `unknown messageId ${id}` });
    return;
  }
  if (item.status !== 'done') {
    item.status = 'done';
    if (item.kind === 'turn') {
      log('TURN HEARD', `lane ${item.to} finished turn ${item.turnNo}`, item.sessionId);
    }
  }
  res.json({ ok: true });
});

/**
 * Debug: synthesize arbitrary text exactly the way a call turn would be.
 * `curl "$RELAY/tts?text=hello" -o out.wav` is the fastest way to prove the
 * laptop-side audio path works before any phone is involved.
 */
app.get('/tts', async (req: Request, res: Response) => {
  const text = typeof req.query.text === 'string' ? req.query.text.trim() : '';
  const lane = typeof req.query.lane === 'string' ? req.query.lane : 'a';
  if (!text) {
    res.status(400).json({ error: 'text query parameter is required' });
    return;
  }
  try {
    const wav = await speakTurn(text, lane);
    log('TTS DEBUG', `lane ${lane}: "${preview(text)}" -> ${wav.length} bytes`);
    res.setHeader('Content-Type', 'audio/wav');
    res.send(wav);
  } catch (e) {
    log('TTS FAILED', `${(e as Error).message}`);
    res.status(502).json({ error: `tts failed: ${(e as Error).message}` });
  }
});

/** Last 50 events, for the demo screen. */
app.get('/log', (_req: Request, res: Response) => {
  res.json({ events });
});

/**
 * Every address a phone on the same network could reach this process at.
 * Printed on boot because this machine's IP is the one thing that moves
 * between networks, and knowing it beats guessing from another terminal.
 */
function lanAddresses(): string[] {
  const found: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        found.push(`http://${addr.address}:${PORT}  (${name})`);
      }
    }
  }
  return found;
}

app.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  NANDA relay listening on http://${HOST}:${PORT}`);
  console.log(`  public url    ${PUBLIC_URL}`);
  console.log(`  agent card    ${PUBLIC_URL}/agent-card`);
  console.log(`  run timeout   ${RUN_TIMEOUT_MS / 1000}s`);
  console.log('');
  const lan = lanAddresses();
  if (lan.length) {
    console.log('  reachable from a phone at:');
    for (const addr of lan) console.log(`    ${addr}`);
  } else {
    console.log('  no external network interface — a phone cannot reach this.');
  }
  console.log('');
});
