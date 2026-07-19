import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * A stable per-install identity, persisted to disk.
 *
 * The relay hands out lanes keyed on this value, so it MUST survive a JS
 * reload. A value generated in memory changes on every hot reload, which makes
 * one device look like a stream of new devices — it then takes a second lane
 * and evicts its own peer.
 */

const ID_FILE = 'device-id.txt';

let cached: string | null = null;

function generate(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Platform.OS}-${rand}`;
}

export function deviceId(): string {
  if (cached) return cached;

  const file = new File(Paths.document, ID_FILE);
  try {
    if (file.exists) {
      const existing = file.textSync().trim();
      if (existing) {
        cached = existing;
        return cached;
      }
    }
  } catch {
    // Unreadable (corrupt/permissions) — fall through and rewrite it.
  }

  const id = generate();
  try {
    if (!file.exists) file.create();
    file.write(id);
  } catch {
    // Persisting failed; the id still works for this session, it just won't
    // survive a reload. Better than throwing and blocking the agent entirely.
  }
  cached = id;
  return id;
}

/**
 * Human-readable name shown on the other device and in relay logs.
 *
 * The suffix is what makes two identical phones tellable apart on the
 * projector — without it every device is "Android agent" and the log gives no
 * way to see which one answered.
 */
export function deviceName(): string {
  const base = Platform.OS === 'android' ? 'Android agent' : 'Device agent';
  const suffix = deviceId().slice(-4);
  return `${base} (${suffix})`;
}
