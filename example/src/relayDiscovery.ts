import { NativeModules } from 'react-native';
import { DEFAULT_RELAY_URL, PROBE_TIMEOUT_MS, RELAY_PORT } from './relayConfig';
import { loadRelayUrl } from './relayStore';

/**
 * Finding the relay when the dev machine's IP has moved.
 *
 * A hardcoded address is the demo's most likely failure: LAN addresses change
 * with a new DHCP lease, a rejoined hotspot, a different room. Rather than
 * trusting one, we collect the addresses the relay could plausibly be at and
 * ask each one whether it is actually there.
 *
 * The useful trick is that the phone already knows the answer. In a dev build
 * the JS bundle was downloaded from Metro, which runs on the same machine as
 * the relay, so the bundle URL carries a host that is correct by construction
 * — it cannot be stale, because the app is running the code it served. In a
 * release build there is no Metro and no bundle host, so discovery falls back
 * to the saved address and then the compiled-in default.
 */

/** Host the JS bundle was served from, or null in a release build. */
function bundleHost(): string | null {
  try {
    const source = NativeModules?.SourceCode;
    const scriptURL: unknown =
      source?.getConstants?.().scriptURL ?? source?.scriptURL;
    if (typeof scriptURL !== 'string') return null;

    // Release builds load from disk (file://, or an asset path) — no host.
    const match = scriptURL.match(/^https?:\/\/([^/:]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Is a relay actually answering here? */
async function probe(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Candidate addresses, best guess first, de-duplicated. */
export function relayCandidates(): string[] {
  const host = bundleHost();
  const ordered = [
    // A saved address first: if someone typed one, it was deliberate.
    loadRelayUrl(),
    // Then the machine serving our own bundle — right whenever Metro is.
    host ? `http://${host}:${RELAY_PORT}` : null,
    DEFAULT_RELAY_URL,
  ].filter((u): u is string => !!u);

  return [...new Set(ordered.map((u) => u.replace(/\/+$/, '')))];
}

export interface Discovery {
  url: string;
  /** False when nothing answered and `url` is only a best guess. */
  reachable: boolean;
  tried: string[];
}

/**
 * Probe each candidate in turn and return the first live relay. Sequential on
 * purpose: the first candidate is usually right, and a hit costs one request.
 */
export async function discoverRelay(): Promise<Discovery> {
  const tried = relayCandidates();
  for (const url of tried) {
    if (await probe(url)) return { url, reachable: true, tried };
  }
  return { url: tried[0], reachable: false, tried };
}
