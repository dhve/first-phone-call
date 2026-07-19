import { defineTool } from '../defineTool';
import type { Tool } from '../types';

/**
 * Filesystem tools backed by `expo-file-system` (SDK 54+ `File`/`Directory`
 * API). Reads/writes are confined to a base directory (the app document dir by
 * default) so the agent can't wander the device. Install `expo-file-system`.
 */
export function createFilesystemTools(opts: { baseDir?: unknown } = {}): Tool[] {
  // Lazily required so importing the package doesn't hard-depend on the module.
  const { File, Directory, Paths } = require('expo-file-system');
  const baseDir = opts.baseDir ?? Paths.document;

  const guard = (relPath: string) => {
    if (relPath.includes('..')) throw new Error('Path traversal ("..") is not allowed');
    return relPath.replace(/^\/+/, '');
  };

  const writeFile = defineTool<{ path: string; content: string }>({
    name: 'write_file',
    description: 'Write text content to a file in the app sandbox (overwrites).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path, e.g. "notes/todo.txt"' },
        content: { type: 'string', description: 'Text to write' },
      },
      required: ['path', 'content'],
    },
    execute: async ({ path, content }) => {
      const file = new File(baseDir, guard(path));
      const parent = file.parentDirectory;
      if (!parent.exists) parent.create({ intermediates: true });
      if (!file.exists) file.create();
      file.write(content);
      return { uri: file.uri, bytes: content.length };
    },
  });

  const readFile = defineTool<{ path: string }>({
    name: 'read_file',
    description: 'Read text content from a file in the app sandbox.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative file path' } },
      required: ['path'],
    },
    execute: async ({ path }) => {
      const file = new File(baseDir, guard(path));
      if (!file.exists) throw new Error(`File not found: ${path}`);
      return { content: await file.text() };
    },
  });

  const listFiles = defineTool<{ path?: string }>({
    name: 'list_files',
    description: 'List files and folders in a directory inside the app sandbox.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative directory path, default root' } },
    },
    execute: async ({ path = '' }) => {
      const dir = path ? new Directory(baseDir, guard(path)) : new Directory(baseDir);
      if (!dir.exists) throw new Error(`Directory not found: ${path || '/'}`);
      return {
        entries: dir.list().map((e: any) => ({
          name: e.name,
          type: e instanceof Directory ? 'directory' : 'file',
        })),
      };
    },
  });

  return [writeFile, readFile, listFiles];
}
