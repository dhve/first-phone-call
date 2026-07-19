import { File, Paths } from 'expo-file-system';
import { MODEL } from './config';

/** Local File handle for the model in the app document directory. */
export function modelFile(): File {
  return new File(Paths.document, MODEL.fileName);
}

export function isModelDownloaded(): boolean {
  return modelFile().exists;
}

/**
 * Download the model with progress, unless already present.
 * Returns the local `file://` URI to hand to llama.rn.
 */
export async function ensureModel(
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const dest = modelFile();
  if (dest.exists) return dest.uri;

  const task = File.createDownloadTask(MODEL.url, dest, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress?.(bytesWritten / totalBytes);
    },
  });
  const file = await task.downloadAsync();
  if (!file) throw new Error('Model download was cancelled');
  return file.uri;
}

export async function deleteModel(): Promise<void> {
  const f = modelFile();
  if (f.exists) f.delete();
}
