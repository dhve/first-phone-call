/**
 * Where this device polls for work, and where it sends outbound calls.
 *
 * Each device needs its OWN mailbox, otherwise two phones polling the same
 * /inbox would steal each other's messages (the relay hands each message out
 * exactly once). So run one relay per device on different ports:
 *
 *   PORT=8787 PUBLIC_URL=... npx tsx relay.ts   # Pixel's mailbox
 *   PORT=8788 PUBLIC_URL=... npx tsx relay.ts   # Lenovo's mailbox
 *
 * Then on each device set MY relay to its own port and PEER to the other's.
 * Both values are editable in the app so you don't need a rebuild to change
 * them (tunnel/LAN addresses move around).
 */

/** Host running the relays — the dev machine on the shared network. */
export const RELAY_HOST = 'http://10.198.223.53';

export const DEFAULT_RELAY = {
  /** Mailbox this device polls for incoming calls. */
  mine: `${RELAY_HOST}:8787`,
  /** Mailbox of the agent we place outbound calls to. */
  peer: `${RELAY_HOST}:8788`,
  /** Who we identify as when calling another agent. */
  from: 'urn:ai:demo:pixel',
};

/** How often to poll /inbox when idle. */
export const INBOX_POLL_MS = 1000;
