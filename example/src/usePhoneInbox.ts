import { useCallback, useEffect, useRef, useState } from 'react';
import { deviceId, deviceName } from './deviceIdentity';
import { INBOX_POLL_MS, PAIR_POLL_MS } from './relayConfig';

export type InboxStatus = 'off' | 'pairing' | 'listening' | 'answering' | 'error';

export interface Pairing {
  /** Lane this device holds on the relay. */
  agentId: string;
  /** Lane the other device holds, once it has registered. */
  peerId: string | null;
  peerName: string | null;
}

export interface InboxOptions {
  /** Relay base URL, e.g. http://10.0.0.5:8787 */
  relayUrl: string;
  /** Only run when the model is loaded and idle. */
  enabled: boolean;
  /** Runs an incoming message through the local model. */
  answer: (message: string, from: string) => Promise<string>;
  /** Surface activity in the UI. */
  onEvent?: (line: string) => void;
}

interface InboxItem {
  id: string;
  message: string;
  from: string;
}

/**
 * Registers this device with the relay, then polls its own lane, answers each
 * incoming message with the on-device model, and posts the reply back.
 *
 * Polling pauses while a request is in flight: inference occupies the single
 * llama context, so overlapping runs would contend for it. The relay hands out
 * each message once, so a paused poller simply leaves work queued.
 */
export function usePhoneInbox(options: InboxOptions) {
  const { relayUrl, enabled, answer, onEvent } = options;
  const [status, setStatus] = useState<InboxStatus>('off');
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(0);

  // Refs so the loop isn't torn down and restarted on every render.
  const answerRef = useRef(answer);
  const onEventRef = useRef(onEvent);
  answerRef.current = answer;
  onEventRef.current = onEvent;

  const emit = useCallback((line: string) => onEventRef.current?.(line), []);

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }

    let cancelled = false;
    const base = relayUrl.replace(/\/+$/, '');
    let announcedPeer: string | null = null;

    /** Claim a lane and learn the peer's. Returns null if the relay is down. */
    const register = async (): Promise<Pairing | null> => {
      try {
        const res = await fetch(`${base}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId(), name: deviceName() }),
        });
        if (!res.ok) throw new Error(`register returned ${res.status}`);
        const body = (await res.json()) as Pairing;
        setPairing(body);
        setLastError(null);
        if (body.peerId && body.peerId !== announcedPeer) {
          announcedPeer = body.peerId;
          emit(`🤝 paired with ${body.peerName ?? body.peerId}`);
        }
        return body;
      } catch (e) {
        setLastError((e as Error).message);
        return null;
      }
    };

    const loop = async () => {
      setStatus('pairing');

      // Keep re-registering until a peer appears; also refreshes lastSeen so
      // this device's lane isn't reclaimed while it waits.
      let me = await register();
      while (!cancelled && (!me || !me.peerId)) {
        setStatus(me ? 'pairing' : 'error');
        await sleep(PAIR_POLL_MS);
        if (cancelled) return;
        me = await register();
      }
      if (cancelled || !me) return;

      setStatus('listening');

      while (!cancelled) {
        try {
          const res = await fetch(`${base}/inbox?agent=${encodeURIComponent(me.agentId)}`);

          if (res.status === 204) {
            setStatus('listening');
            await sleep(INBOX_POLL_MS);
            // Cheap keepalive + peer refresh; the relay uses it for liveness.
            void register();
            continue;
          }
          if (!res.ok) throw new Error(`inbox returned ${res.status}`);

          const item = (await res.json()) as InboxItem;
          if (cancelled) return;

          setStatus('answering');
          emit(`📞 incoming from ${item.from}: "${item.message}"`);

          let reply: string;
          try {
            reply = await answerRef.current(item.message, item.from);
          } catch (e) {
            // Still reply, so the caller isn't left hanging until timeout.
            reply = `The device agent failed to answer: ${(e as Error).message}`;
            emit(`⚠️  ${reply}`);
          }
          if (cancelled) return;

          const post = await fetch(`${base}/outbox`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, reply }),
          });
          if (!post.ok) throw new Error(`outbox returned ${post.status}`);

          emit(`↩️  replied: "${reply}"`);
          setAnswered((n) => n + 1);
          setLastError(null);
          setStatus('listening');
        } catch (e) {
          if (cancelled) return;
          const msg = (e as Error).message;
          setLastError(msg);
          setStatus('error');
          emit(`⚠️  inbox: ${msg}`);
          await sleep(INBOX_POLL_MS * 3);
          if (!cancelled) setStatus('listening');
        }
      }
    };

    loop();
    return () => {
      cancelled = true;
    };
  }, [enabled, relayUrl, emit]);

  return { status, pairing, lastError, answered };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call the paired agent and wait for its reply. The relay long-polls, so this
 * resolves only once the far device has answered (or the relay gives up).
 */
export async function callPeerAgent(args: {
  relayUrl: string;
  peerId: string;
  message: string;
  from: string;
}): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const base = args.relayUrl.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: args.message, from: args.from, to: args.peerId }),
    });

    if (res.status === 504) {
      return { ok: false, error: 'timed out — the other agent did not reply in time' };
    }
    if (!res.ok) return { ok: false, error: `relay returned ${res.status}` };

    const body = (await res.json()) as { id: string; reply?: string };
    if (typeof body.reply !== 'string') {
      return { ok: false, error: 'relay returned no reply field' };
    }
    return { ok: true, reply: body.reply };
  } catch (e) {
    return { ok: false, error: `could not reach ${base}: ${(e as Error).message}` };
  }
}
