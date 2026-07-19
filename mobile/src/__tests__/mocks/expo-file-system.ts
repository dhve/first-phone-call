/**
 * In-memory stand-in for the expo-file-system (SDK 52+) object API, covering
 * exactly what src/ uses: Paths.document, Paths.availableDiskSpace, Directory
 * and File with exists/create/delete/read/write/list, and
 * File.createDownloadTask. Relative segments (`..`, `.`) are resolved the way
 * the real API resolves them, so path-escape guards behave identically.
 */

const files = new Map<string, string>();
const dirs = new Set<string>();
let availableDiskSpace = Number.MAX_SAFE_INTEGER;

export const DOCUMENT_URI = 'file:///mock-documents';

export function __reset(): void {
  files.clear();
  dirs.clear();
  availableDiskSpace = Number.MAX_SAFE_INTEGER;
}

export function __setAvailableDiskSpace(bytes: number): void {
  availableDiskSpace = bytes;
}

export function __files(): Map<string, string> {
  return files;
}

/** Normalize a file:// URI: collapse `.` and resolve `..` segments. */
function normalize(uri: string): string {
  const withoutScheme = uri.replace(/^file:\/\//, '');
  const segments: string[] = [];
  for (const part of withoutScheme.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return `file:///${segments.join('/')}`;
}

function join(base: string, ...parts: string[]): string {
  return normalize([base.replace(/\/+$/, ''), ...parts].join('/'));
}

type PathPart = string | Directory | File;

function partToUri(part: PathPart): string {
  return typeof part === 'string' ? part : part.uri;
}

function resolveUri(parts: PathPart[]): string {
  const [first, ...rest] = parts;
  const base = partToUri(first).startsWith('file://')
    ? partToUri(first)
    : join(DOCUMENT_URI, partToUri(first));
  return join(base, ...rest.map(partToUri));
}

export class Directory {
  private readonly key: string;

  constructor(...parts: PathPart[]) {
    this.key = resolveUri(parts);
  }

  get uri(): string {
    return `${this.key}/`;
  }

  get name(): string {
    return this.key.split('/').pop() ?? '';
  }

  get exists(): boolean {
    return this.key === normalize(DOCUMENT_URI) || dirs.has(this.key);
  }

  create(_options?: { intermediates?: boolean }): void {
    let current = this.key.replace(/^file:\/\/\//, '');
    const segments = current.split('/');
    for (let i = 1; i <= segments.length; i++) {
      dirs.add(`file:///${segments.slice(0, i).join('/')}`);
    }
  }

  list(): (Directory | File)[] {
    const prefix = `${this.key}/`;
    const entries = new Map<string, 'file' | 'dir'>();
    for (const uri of files.keys()) {
      if (!uri.startsWith(prefix)) continue;
      const rest = uri.slice(prefix.length);
      const head = rest.split('/')[0];
      entries.set(head, rest.includes('/') ? 'dir' : 'file');
    }
    for (const uri of dirs) {
      if (!uri.startsWith(prefix)) continue;
      const head = uri.slice(prefix.length).split('/')[0];
      if (head) entries.set(head, 'dir');
    }
    return [...entries.entries()].map(([name, type]) =>
      type === 'dir' ? new Directory(this.key, name) : new File(this.key, name),
    );
  }
}

export class File {
  readonly uri: string;

  constructor(...parts: PathPart[]) {
    this.uri = resolveUri(parts);
  }

  get name(): string {
    return this.uri.split('/').pop() ?? '';
  }

  get exists(): boolean {
    return files.has(this.uri);
  }

  get parentDirectory(): Directory {
    return new Directory(this.uri.split('/').slice(0, -1).join('/'));
  }

  create(): void {
    files.set(this.uri, '');
  }

  write(content: string): void {
    files.set(this.uri, content);
  }

  textSync(): string {
    const content = files.get(this.uri);
    if (content === undefined) throw new Error(`File not found: ${this.uri}`);
    return content;
  }

  async text(): Promise<string> {
    return this.textSync();
  }

  delete(): void {
    files.delete(this.uri);
  }

  static createDownloadTask(
    _url: string,
    dest: File,
    options?: { onProgress?: (p: { bytesWritten: number; totalBytes: number }) => void },
  ): { downloadAsync(): Promise<File | null> } {
    return {
      async downloadAsync() {
        options?.onProgress?.({ bytesWritten: 100, totalBytes: 100 });
        files.set(dest.uri, 'downloaded-model-bytes');
        return dest;
      },
    };
  }
}

export class Paths {
  static get document(): Directory {
    return new Directory(DOCUMENT_URI);
  }

  static get availableDiskSpace(): number {
    return availableDiskSpace;
  }

  static get totalDiskSpace(): number {
    return Number.MAX_SAFE_INTEGER;
  }
}
