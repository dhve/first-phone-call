import { File, Paths } from 'expo-file-system';
import { MODEL } from './config';
import { requireHost39Native } from '../modules/host39-native';

/** Local File handle for the model in the app document directory. */
export function modelFile(): File {
  return new File(Paths.document, MODEL.fileName);
}

export function isModelDownloaded(): boolean {
  return modelFile().exists;
}

/** Extra free-space margin required beyond the model size before downloading. */
export const DOWNLOAD_SPACE_MARGIN = 0.1;

/** Bytes of free storage the download preflight requires (size + margin). */
export function requiredDownloadBytes(sizeBytes: number = MODEL.sizeBytes): number {
  return Math.ceil(sizeBytes * (1 + DOWNLOAD_SPACE_MARGIN));
}

function gb(bytes: number): string {
  return (bytes / 1_000_000_000).toFixed(1);
}

/**
 * Free-storage preflight: the download needs the configured model size plus
 * a 10% margin. Throws a clear error when the device is short on space.
 */
export function assertEnoughFreeSpace(): void {
  const required = requiredDownloadBytes();
  const available = Paths.availableDiskSpace;
  if (Number.isFinite(available) && available < required) {
    throw new Error(
      `Not enough free storage for the model: about ${gb(required)} GB is ` +
        `needed (model size plus a 10% margin) but only ${gb(available)} GB ` +
        'is available. Free up space and try again.',
    );
  }
}

/**
 * Download the model with progress, unless already present.
 * Returns the local `file://` URI to hand to llama.rn.
 */
export async function downloadModel(
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const dest = modelFile();
  if (dest.exists) return dest.uri;

  assertEnoughFreeSpace();

  const task = File.createDownloadTask(MODEL.url, dest, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress?.(bytesWritten / totalBytes);
    },
  });
  const file = await task.downloadAsync();
  if (!file) throw new Error('Model download was cancelled');
  return file.uri;
}

/**
 * Verify the downloaded model against the official SHA-256 (streamed in the
 * native module). On mismatch the file is deleted and an error is thrown so
 * the UI can surface it.
 */
export async function verifyModel(): Promise<void> {
  const file = modelFile();
  if (!file.exists) throw new Error('Model file is missing');

  const actual = (await requireHost39Native().sha256File(file.uri)).toLowerCase();
  if (actual !== MODEL.sha256) {
    file.delete();
    throw new Error(
      `Model checksum mismatch (expected ${MODEL.sha256.slice(0, 12)}..., ` +
        `got ${actual.slice(0, 12)}...). The corrupt file was deleted; download again.`,
    );
  }
}

export async function deleteModel(): Promise<void> {
  const f = modelFile();
  if (f.exists) f.delete();
}
