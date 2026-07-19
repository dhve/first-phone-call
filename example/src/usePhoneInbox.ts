import { useCallback, useEffect, useRef, useState } from 'react';
import { INBOX_POLL_MS } from './relayConfig';

export type InboxStatus = 'off' | 'listening' | 'answering' | 'error';

export interface InboxOptions {
  /** Base URL of THIS device's mailbox, e.g. http://10.0.0.5:8787 */
  relayUrl: string;
  /** Only poll when the model is loaded and idle. */
  enabled: boolean;
  /** Runs the incoming message through the local model. */
  answer: (message: string, from: string) => Promise<string>;
  /** Surface activity in the UI (incoming call, reply sent, errors). */
  onEvent?: (line: string) => void;
}

interface InboxItem {
  id: string;
  message: string;
  from: string;
}

/**
 * Polls this device's relay mailbox, answers each incoming message with the
 * on-device model, and posts the reply back.
 *
 * Polling pauses while a request is in flight: inference occupies the single
 * llama context, so overlapping runs would contend for it. The relay hands out
 * each message once, so a paused poller simply leaves work queued.
 */
export function usePhoneInbox(options: InboxOptions) {
  const { relayUrl, enabled, answer, onEvent } = options;
  const [status, setStatus] = useState<InboxStatus>('off');
  const [lastError, setLastError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(0);

  // Keep callbacks in refs so the poll loop isn't torn down on every render.
  const answerRef = useRef(answer);
  const onEventRef = useRef(onEvent);
  answerRef.current = answer;
  onEventRef.current = onEvent;

  /** Guards against a second loop starting, and stops the loop on unmount. */
  const runningRef = useRef(false);

  const emit = useCallback((line: string) => onEventRef.current?.(line), []);

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }

    let cancelled = false;
    runningRef.current = true;
    setStatus('listening');

    const base = relayUrl.replace(/\/+$/, '');

    const loop = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${base}/inbox`);

          // 204 = nothing waiting. Sleep, then poll again.
          if (res.status === 204) {
            setStatus('listening');
            await sleep(INBOX_POLL_MS);
            continue;
          }

          if (!res.ok) {
            throw new Error(`inbox returned ${res.status}`);
          }

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
          // Back off a little so a down relay doesn't spin the loop.
          await sleep(INBOX_POLL_MS * 3);
          if (!cancelled) setStatus('listening');
        }
      }
    };

    loop();

    return () => {
      cancelled = true;
      runningRef.current = false;
    };
  }, [enabled, relayUrl, emit]);

  return { status, lastError, answered };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Place an outbound call to another agent's mailbox and wait for its reply.
 * The relay long-polls, so this resolves only once the far device has answered
 * (or the relay gives up and returns 504).
 */
export async function callPeerAgent(args: {
  peerUrl: string;
  message: string;
  from: string;
}): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const base = args.peerUrl.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: args.message, from: args.from }),
    });

    if (res.status === 504) {
      return { ok: false, error: 'timed out — the other agent did not reply in time' };
    }
    if (!res.ok) {
      return { ok: false, error: `relay returned ${res.status}` };
    }

    const body = (await res.json()) as { id: string; reply?: string };
    if (typeof body.reply !== 'string') {
      return { ok: false, error: 'relay returned no reply field' };
    }
    return { ok: true, reply: body.reply };
  } catch (e) {
    return { ok: false, error: `could not reach ${base}: ${(e as Error).message}` };
  }
}
