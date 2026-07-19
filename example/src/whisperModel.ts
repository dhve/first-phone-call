/**
 * Whisper model download, following the same pattern as the LLM's
 * modelManager: fetch once into the app sandbox, verify the SHA-256 against
 * the checksum published by Hugging Face, delete on mismatch.
 *
 * base.en over tiny.en by default: the transcription is fed to a 270M-param
 * LLM that derails on garbled input, so STT accuracy is worth the extra 30 MB.
 */

import { sha256 } from 'js-sha256';
import { Directory, File, Paths } from 'expo-file-system';
import { WHISPER } from './config';

function modelFile(): File {
  return new File(Paths.document, WHISPER.fileName);
}

export function isWhisperModelDownloaded(): boolean {
  return modelFile().exists;
}

/**
 * Download the whisper model if absent and return its local URI.
 * Verifies the checksum on every fresh download; an existing file is trusted
 * (it was verified when it landed, and hashing 60 MB in JS on every launch
 * is seconds of dead time on a phone).
 */
export async function ensureWhisperModel(
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const dest = modelFile();
  if (dest.exists) return dest.uri;

  const task = File.createDownloadTask(WHISPER.url, dest, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress?.(bytesWritten / totalBytes);
    },
  });
  const file = await task.downloadAsync();
  if (!file) throw new Error('Whisper model download was cancelled');

  const digest = await sha256File(file);
  if (digest !== WHISPER.sha256) {
    file.delete();
    throw new Error(
      `Whisper model checksum mismatch (got ${digest.slice(0, 12)}..., ` +
        `expected ${WHISPER.sha256.slice(0, 12)}...); deleted the download`,
    );
  }
  return file.uri;
}

/**
 * Pure-JS hash: Hermes has no crypto.subtle, and a native module here would
 * force a rebuild for a once-per-install 60 MB hash that JS does in about a
 * second. Reading the file into one Uint8Array is fine on 6 GB devices.
 */
async function sha256File(file: File): Promise<string> {
  const bytes = file.bytesSync();
  return sha256(bytes);
}

export function deleteWhisperModel(): void {
  const f = modelFile();
  if (f.exists) f.delete();
}

/** Where downloaded turn audio lives; cleared opportunistically per call. */
export function turnAudioDir(): Directory {
  const dir = new Directory(Paths.cache, 'call-audio');
  if (!dir.exists) dir.create();
  return dir;
}
