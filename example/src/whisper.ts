/**
 * Thin wrapper around whisper.rn: one context for the app's lifetime,
 * initialized once the model file is present, plus a transcribe helper that
 * takes the 16 kHz mono WAV the relay serves.
 *
 * Whisper and llama inference NEVER run at the same time here by design: the
 * call state machine transcribes first, then thinks. The two native runtimes
 * coexist fine in memory; it is concurrent compute that would thrash a phone.
 */

// The bare specifier fails under bundler-mode TS: whisper.rn's exports map
// has "./*" but no "." entry. The /index subpath satisfies both TS and Metro.
import { initWhisper, type WhisperContext } from 'whisper.rn/index';
import { ensureWhisperModel } from './whisperModel';

let context: WhisperContext | null = null;
let initializing: Promise<WhisperContext> | null = null;

export function isWhisperReady(): boolean {
  return context !== null;
}

/** Idempotent; concurrent callers share one init. */
export function ensureWhisperContext(
  onProgress?: (fraction: number) => void,
): Promise<WhisperContext> {
  if (context) return Promise.resolve(context);
  if (initializing) return initializing;
  initializing = (async () => {
    const uri = await ensureWhisperModel(onProgress);
    const ctx = await initWhisper({ filePath: uri });
    context = ctx;
    initializing = null;
    return ctx;
  })();
  initializing.catch(() => {
    initializing = null;
  });
  return initializing;
}

/**
 * Transcribe a WAV file on disk. Returns plain text with whisper's leading
 * annotations trimmed. English-only model, so language is pinned.
 */
export async function transcribeWav(wavPath: string): Promise<string> {
  const ctx = await ensureWhisperContext();
  const { promise } = ctx.transcribe(wavPath, {
    language: 'en',
    maxLen: 0,
  });
  const { result } = await promise;
  return cleanTranscript(result);
}

/**
 * Whisper emits bracketed non-speech annotations like [BLANK_AUDIO] or
 * (upbeat music) on silence and noise; the LLM must never see those.
 */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
