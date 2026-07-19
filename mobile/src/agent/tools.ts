import { Directory, File } from 'expo-file-system';
import { defineTool } from 'react-native-device-agent';
import type { Tool } from 'react-native-device-agent';
import { requireHost39Native } from '../../modules/host39-native';

/**
 * The ONLY tools the hosted agent gets. Deliberately no Device Agent
 * built-ins: remote callers must never reach clipboard, contacts, network,
 * or the wider filesystem. File tools are scoped to the knowledge directory;
 * write_file is registered only when the card's allow-writes setting is on.
 */
export function createHostTools(opts: { knowledgeDir: Directory; allowWrites: boolean }): Tool[] {
  const base = opts.knowledgeDir;

  /** Path-traversal guard: reject escapes, then double-check the resolved URI. */
  const guard = (relPath: string): string => {
    const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = cleaned.split('/');
    if (cleaned.length === 0 || segments.some((s) => s === '..' || s === '')) {
      throw new Error('Invalid path: must be relative, inside the knowledge folder');
    }
    return cleaned;
  };

  const assertInside = (uri: string) => {
    const baseUri = base.uri.endsWith('/') ? base.uri : `${base.uri}/`;
    if (!uri.startsWith(baseUri)) {
      throw new Error('Path escapes the knowledge folder');
    }
  };

  const getCurrentTime = defineTool({
    name: 'get_current_time',
    description: 'Get the current date and time on the device.',
    parameters: { type: 'object', properties: {} },
    execute: () => ({ iso: new Date().toISOString() }),
  });

  const deviceHealth = defineTool({
    name: 'device_health',
    description: 'Get device battery level, charging state, and thermal status.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const health = await requireHost39Native().deviceHealth();
      return {
        batteryPercent: health.batteryLevel,
        charging: health.charging,
        thermal: health.thermal,
      };
    },
  });

  const readFile = defineTool<{ path: string }>({
    name: 'read_file',
    description: 'Read a text file from the knowledge folder.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative file path, e.g. "faq.txt"' } },
      required: ['path'],
    },
    execute: async ({ path }) => {
      const file = new File(base, guard(path));
      assertInside(file.uri);
      if (!file.exists) throw new Error(`File not found: ${path}`);
      return { content: await file.text() };
    },
  });

  const listFiles = defineTool<{ path?: string }>({
    name: 'list_files',
    description: 'List files and folders in the knowledge folder.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path, default root' },
      },
    },
    execute: async ({ path = '' }) => {
      const dir = path ? new Directory(base, guard(path)) : base;
      assertInside(dir.uri.endsWith('/') ? dir.uri : `${dir.uri}/`);
      if (!dir.exists) throw new Error(`Directory not found: ${path || '/'}`);
      return {
        entries: dir.list().map((entry) => ({
          name: entry.name,
          type: entry instanceof Directory ? 'directory' : 'file',
        })),
      };
    },
  });

  const tools: Tool[] = [getCurrentTime, deviceHealth, readFile, listFiles];

  if (opts.allowWrites) {
    tools.push(
      defineTool<{ path: string; content: string }>({
        name: 'write_file',
        description: 'Write a text file into the knowledge folder (overwrites).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path' },
            content: { type: 'string', description: 'Text to write' },
          },
          required: ['path', 'content'],
        },
        execute: ({ path, content }) => {
          const file = new File(base, guard(path));
          assertInside(file.uri);
          const parent = file.parentDirectory;
          if (!parent.exists) parent.create({ intermediates: true });
          if (!file.exists) file.create();
          file.write(content);
          return { uri: file.uri, bytes: content.length };
        },
      }),
    );
  }

  return tools;
}
