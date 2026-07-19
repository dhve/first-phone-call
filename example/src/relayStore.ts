import { File, Paths } from 'expo-file-system';
import { DEFAULT_RELAY_URL } from './relayConfig';

/**
 * The relay address, persisted to disk.
 *
 * LAN addresses move — a different room, a rejoined hotspot, a new DHCP lease.
 * Without this, a corrected address lives only in component state and is lost
 * on the next reload, so both phones have to be retyped by hand every time.
 */

const URL_FILE = 'relay-url.txt';

let cached: string | null = null;

export function loadRelayUrl(): string {
  if (cached) return cached;

  const file = new File(Paths.document, URL_FILE);
  try {
    if (file.exists) {
      const saved = file.textSync().trim();
      if (saved) {
        cached = saved;
        return cached;
      }
    }
  } catch {
    // Unreadable — fall back to the compiled-in default.
  }

  cached = DEFAULT_RELAY_URL;
  return cached;
}

export function saveRelayUrl(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  cached = trimmed;

  const file = new File(Paths.document, URL_FILE);
  try {
    if (!file.exists) file.create();
    file.write(trimmed);
  } catch {
    // Still applies this session; it just won't survive a reload.
  }
}
