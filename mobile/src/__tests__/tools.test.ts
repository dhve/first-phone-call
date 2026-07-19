import { beforeEach, describe, expect, it } from 'vitest';
import { Directory, File, __reset } from './mocks/expo-file-system';
import { createHostTools } from '../agent/tools';
import type { Directory as ExpoDirectory } from 'expo-file-system';
import type { Tool, ToolContext } from 'react-native-device-agent';

const ctx: ToolContext = { scratch: {} };

// The runtime value is the in-memory mock (vitest alias); the type cast keeps
// createHostTools' real expo-file-system signature satisfied.
function knowledge(): ExpoDirectory {
  const dir = new Directory('file:///mock-documents/knowledge');
  dir.create({ intermediates: true });
  return dir as unknown as ExpoDirectory;
}

function tool(tools: Tool[], name: string): Tool {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  return found;
}

describe('host tool allowlist', () => {
  beforeEach(() => __reset());

  it('registers only the explicit allowlist when writes are off', () => {
    const tools = createHostTools({ knowledgeDir: knowledge(), allowWrites: false });
    expect(tools.map((t) => t.name).sort()).toEqual([
      'device_health',
      'get_current_time',
      'list_files',
      'read_file',
    ]);
  });

  it('adds write_file only when the card allows writes', () => {
    const tools = createHostTools({ knowledgeDir: knowledge(), allowWrites: true });
    expect(tools.map((t) => t.name)).toContain('write_file');
  });
});

describe('knowledge-dir path traversal guards', () => {
  let tools: Tool[];

  beforeEach(() => {
    __reset();
    const dir = knowledge();
    new File(dir.uri, 'faq.txt').write('the answer');
    tools = createHostTools({ knowledgeDir: dir, allowWrites: true });
  });

  it('reads a plain relative path', async () => {
    const result = (await tool(tools, 'read_file').execute({ path: 'faq.txt' }, ctx)) as {
      content: string;
    };
    expect(result.content).toBe('the answer');
  });

  it.each(['../secret.txt', 'a/../../secret.txt', '..', 'a//b.txt', '', '..\\up.txt'])(
    'rejects traversal or malformed path %j',
    async (path) => {
      await expect(tool(tools, 'read_file').execute({ path }, ctx)).rejects.toThrow(
        /Invalid path|escapes the knowledge folder/,
      );
    },
  );

  it('rejects traversal on write_file too', () => {
    // write_file's execute throws synchronously on a guarded path.
    expect(() =>
      tool(tools, 'write_file').execute({ path: '../evil.txt', content: 'x' }, ctx),
    ).toThrow(/Invalid path/);
  });

  it('writes inside the knowledge dir and lists it', async () => {
    await tool(tools, 'write_file').execute({ path: 'notes/todo.txt', content: 'hi' }, ctx);
    const listed = (await tool(tools, 'list_files').execute({}, ctx)) as {
      entries: { name: string; type: string }[];
    };
    const names = listed.entries.map((e) => e.name).sort();
    expect(names).toEqual(['faq.txt', 'notes']);
  });

  it('rejects list_files traversal', async () => {
    await expect(tool(tools, 'list_files').execute({ path: '../' }, ctx)).rejects.toThrow(
      /Invalid path/,
    );
  });
});
