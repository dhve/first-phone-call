/**
 * How a device finds the relay and its peer.
 *
 * There is ONE relay. Each device registers on launch, is given a lane ("a" or
 * "b"), and is told which lane its peer holds. Nothing is configured by hand:
 * whichever device starts first becomes "a", the second becomes "b", and they
 * are automatically each other's peer.
 *
 * Only the relay's address is a constant, because a device has no way to guess
 * it. It stays editable in the UI since LAN addresses move around.
 */

/** Port the relay listens on. The host is discovered; see relayDiscovery.ts. */
export const RELAY_PORT = 8787;

/** Last-resort relay URL, used when discovery finds nothing reachable. */
export const DEFAULT_RELAY_URL = `http://10.198.223.53:${RELAY_PORT}`;

/** How long a single /health probe may take while hunting for the relay. */
export const PROBE_TIMEOUT_MS = 1500;

/** How often to poll /inbox when idle. */
export const INBOX_POLL_MS = 1000;

/** How often to re-register while waiting for a peer to appear. */
export const PAIR_POLL_MS = 2000;
