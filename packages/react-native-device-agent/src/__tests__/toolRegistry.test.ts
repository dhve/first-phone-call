import { describe, expect, it } from 'vitest';

import { defineTool } from '../defineTool';
import { ToolRegistry } from '../toolRegistry';
import type { ToolContext } from '../types';

const ctx = (): ToolContext => ({ scratch: {} });

const valuesTool = defineTool<{ count: number; flag: boolean; text: string }>({
  name: 'set_values',
  description: 'Record some values',
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'number' },
      flag: { type: 'boolean' },
      text: { type: 'string' },
    },
    required: ['count', 'flag', 'text'],
  },
  execute: (args) => ({ received: args }),
});

describe('ToolRegistry registration', () => {
  it('rejects duplicate tool names', () => {
    const registry = new ToolRegistry([valuesTool]);
    expect(() => registry.register(valuesTool)).toThrow(/already registered/);
  });

  it('rejects an invalid parameters schema at registration time', () => {
    const registry = new ToolRegistry();
    const broken = defineTool({
      name: 'broken',
      description: 'Bad schema',
      parameters: {
        type: 'object',
        properties: { a: { type: 'not-a-type' as any } },
      },
      execute: () => null,
    });
    expect(() => registry.register(broken)).toThrow(/invalid parameters schema/);
  });

  it('allows re-registration after unregister', () => {
    const registry = new ToolRegistry([valuesTool]);
    expect(registry.unregister('set_values')).toBe(true);
    expect(registry.has('set_values')).toBe(false);
    expect(() => registry.register(valuesTool)).not.toThrow();
  });
});

describe('ToolRegistry.invoke validation', () => {
  it('accepts falsy values that satisfy the schema', async () => {
    const registry = new ToolRegistry([valuesTool]);
    const outcome = await registry.invoke(
      'set_values',
      JSON.stringify({ count: 0, flag: false, text: '' }),
      ctx(),
    );
    expect(outcome).toEqual({ result: { received: { count: 0, flag: false, text: '' } } });
  });

  it('rejects wrong types with a structured error', async () => {
    const registry = new ToolRegistry([valuesTool]);
    const outcome = await registry.invoke(
      'set_values',
      JSON.stringify({ count: 'zero', flag: false, text: '' }),
      ctx(),
    );
    expect(outcome.result).toBeUndefined();
    expect(outcome.error).toContain('Invalid arguments for tool "set_values"');
    expect(outcome.error).toContain('.count');
  });

  it('rejects missing required properties even when other values are falsy', async () => {
    const registry = new ToolRegistry([valuesTool]);
    const outcome = await registry.invoke(
      'set_values',
      JSON.stringify({ count: 0, flag: false }),
      ctx(),
    );
    expect(outcome.error).toContain("required property 'text'");
  });

  it('reports unknown tools', async () => {
    const registry = new ToolRegistry([valuesTool]);
    const outcome = await registry.invoke('nope', '{}', ctx());
    expect(outcome.error).toContain('Unknown tool "nope"');
    expect(outcome.error).toContain('set_values');
  });

  it('reports unparseable argument JSON', async () => {
    const registry = new ToolRegistry([valuesTool]);
    const outcome = await registry.invoke('set_values', '{not json', ctx());
    expect(outcome.error).toContain('not valid JSON');
  });

  it('treats an empty argument string as an empty object', async () => {
    const registry = new ToolRegistry([
      defineTool({
        name: 'no_args',
        description: 'Takes nothing',
        parameters: { type: 'object', properties: {} },
        execute: () => ({ ok: true }),
      }),
    ]);
    const outcome = await registry.invoke('no_args', '', ctx());
    expect(outcome).toEqual({ result: { ok: true } });
  });

  it('converts a throwing tool into a structured error', async () => {
    const registry = new ToolRegistry([
      defineTool({
        name: 'boom',
        description: 'Always throws',
        parameters: { type: 'object', properties: {} },
        execute: () => {
          throw new Error('kaput');
        },
      }),
    ]);
    const outcome = await registry.invoke('boom', '{}', ctx());
    expect(outcome.error).toBe('Tool "boom" threw: kaput');
  });
});
