import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL } from '../config';
import { createFakeNative } from './harness';

type FsMock = typeof import('./mocks/expo-file-system');
type CoreMock = typeof import('./mocks/expo-modules-core');
type ModelManager = typeof import('../modelManager');

let fs: FsMock;
let native: ReturnType<typeof createFakeNative>;
let modelManager: ModelManager;

beforeEach(async () => {
  // The native module is resolved at import time, so register the fake
  // before pulling in modelManager.
  vi.resetModules();
  fs = await import('./mocks/expo-file-system');
  const core: CoreMock = await import('./mocks/expo-modules-core');
  fs.__reset();
  core.__reset();
  native = createFakeNative();
  core.__setNativeModule('Host39Native', native.mod);
  modelManager = await import('../modelManager');
});

describe('download free-space preflight', () => {
  it('requires the configured model size plus a 10% margin', () => {
    expect(modelManager.requiredDownloadBytes(1_000)).toBe(1_100);
    expect(modelManager.requiredDownloadBytes()).toBe(Math.ceil(MODEL.sizeBytes * 1.1));
  });

  it('rejects the download with a clear error when storage is short', async () => {
    fs.__setAvailableDiskSpace(MODEL.sizeBytes); // less than size + margin
    await expect(modelManager.downloadModel()).rejects.toThrow(/Not enough free storage/);
  });

  it('downloads when enough space is available', async () => {
    fs.__setAvailableDiskSpace(modelManager.requiredDownloadBytes() + 1);
    const uri = await modelManager.downloadModel();
    expect(uri).toContain(MODEL.fileName);
    expect(modelManager.isModelDownloaded()).toBe(true);
  });
});

describe('model integrity verification', () => {
  it('passes when the native SHA-256 matches the pinned hash', async () => {
    new fs.File(fs.Paths.document, MODEL.fileName).write('model-bytes');
    await expect(modelManager.verifyModel()).resolves.toBeUndefined();
  });

  it('deletes the file and throws on checksum mismatch', async () => {
    new fs.File(fs.Paths.document, MODEL.fileName).write('corrupted-bytes');
    native.setSha256('0'.repeat(64));
    await expect(modelManager.verifyModel()).rejects.toThrow(/checksum mismatch/);
    expect(modelManager.isModelDownloaded()).toBe(false);
  });
});
