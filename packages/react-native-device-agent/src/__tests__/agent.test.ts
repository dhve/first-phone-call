import { describe, expect, it, vi } from 'vitest';

// The native module is fully mocked: no llama.rn (or react-native) code is
// loaded at test time. Each test scripts the completions a fake context
// returns, and the real LlamaEngine/Agent stack runs on top of it.
vi.mock('llama.rn', () => ({ initLlama: vi.fn() }));

import { initLlama } from 'llama.rn';
import { Agent } from '../agent';
import { defineTool } from '../defineTool';
import { LlamaEngine } from '../llama';
import { ToolRegistry } from '../toolRegistry';
import type { AgentEvent, ChatMessage } from '../types';

interface ScriptedTurn {
  content?: string;
  tool_calls?: Array<{ id?: string; function: { name: string; arguments: string } }>;
  /** When true, the completion hangs until stopCompletion() resolves it. */
  hang?: boolean;
}

function createFakeContext(turns: ScriptedTurn[]) {
  let pendingResolve: ((value: unknown) => void) | null = null;
  /** Deep copies of the `messages` array each completion call received. */
  const promptSnapshots: ChatMessage[][] = [];

  const completion = vi.fn((params: { messages: ChatMessage[] }) => {
    promptSnapshots.push(JSON.parse(JSON.stringify(params.messages)));
    const turn = turns[completion.mock.calls.length - 1] ?? { content: 'out of scripted turns' };
    if (turn.hang) {
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    }
    return Promise.resolve({ content: turn.content ?? '', tool_calls: turn.tool_calls });
  });

  const stopCompletion = vi.fn(async () => {
    if (pendingResolve) {
      pendingResolve({ content: 'partial output before stop' });
      pendingResolve = null;
    }
  });

  const release = vi.fn(async () => {});

  return { completion, stopCompletion, release, promptSnapshots };
}

async function createEngine(turns: ScriptedTurn[], n_ctx = 4096) {
  const fake = createFakeContext(turns);
  vi.mocked(initLlama).mockResolvedValueOnce(fake as any);
  const engine = await LlamaEngine.load({ model: '/fake/model.gguf', n_ctx });
  return { engine, fake };
}

function toolCall(name: string, args: unknown, id = 'call_1') {
  return { id, function: { name, arguments: JSON.stringify(args) } };
}

function noopRegistry() {
  return new ToolRegistry([
    defineTool({
      name: 'noop',
      description: 'Do nothing',
      parameters: { type: 'object', properties: {} },
      execute: () => ({ ok: true }),
    }),
  ]);
}

describe('cancellation', () => {
  it('stops an active llama.rn completion and rejects with AbortError', async () => {
    const { engine, fake } = await createEngine([{ hang: true }]);
    const agent = new Agent({ engine });
    const controller = new AbortController();
    const events: AgentEvent[] = [];

    const pending = agent.send('hello', {
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    });
    pending.catch(() => {}); // keep the rejection handled while we assert below

    await vi.waitFor(() => expect(fake.completion).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.stopCompletion).toHaveBeenCalledTimes(1);
    expect(events[events.length - 1]).toEqual({ type: 'cancelled' });
  });

  it('cancels between steps without touching the engine again', async () => {
    const controller = new AbortController();
    const registry = new ToolRegistry([
      defineTool({
        name: 'interrupt',
        description: 'Aborts the run from inside a tool',
        parameters: { type: 'object', properties: {} },
        execute: () => {
          controller.abort();
          return { ok: true };
        },
      }),
    ]);
    const { engine, fake } = await createEngine([
      { tool_calls: [toolCall('interrupt', {})] },
      { content: 'never reached' },
    ]);
    const agent = new Agent({ engine, registry });
    const events: AgentEvent[] = [];

    await expect(
      agent.send('go', { signal: controller.signal, onEvent: (e) => events.push(e) }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(fake.completion).toHaveBeenCalledTimes(1);
    expect(fake.stopCompletion).not.toHaveBeenCalled();
    expect(events[events.length - 1]).toEqual({ type: 'cancelled' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { engine, fake } = await createEngine([{ content: 'unused' }]);
    const agent = new Agent({ engine });
    const controller = new AbortController();
    controller.abort();

    await expect(
      agent.send('hello', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.completion).not.toHaveBeenCalled();
  });
});

describe('tool argument validation', () => {
  const makeRegistry = (received: unknown[]) =>
    new ToolRegistry([
      defineTool({
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
        execute: (args) => {
          received.push(args);
          return { ok: true };
        },
      }),
    ]);

  it('accepts falsy argument values (0, false, empty string)', async () => {
    const received: unknown[] = [];
    const { engine, fake } = await createEngine([
      { tool_calls: [toolCall('set_values', { count: 0, flag: false, text: '' })] },
      { content: 'done' },
    ]);
    const agent = new Agent({ engine, registry: makeRegistry(received) });
    const events: AgentEvent[] = [];

    await expect(agent.send('set them', { onEvent: (e) => events.push(e) })).resolves.toBe('done');

    expect(received).toEqual([{ count: 0, flag: false, text: '' }]);
    const toolEvent = events.find((e) => e.type === 'tool_result');
    expect(toolEvent).toMatchObject({ result: { ok: true }, error: undefined });
    const toolMsg = fake.promptSnapshots[1].find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe(JSON.stringify({ ok: true }));
  });

  it('feeds a structured validation error back to the model on bad types', async () => {
    const received: unknown[] = [];
    const { engine, fake } = await createEngine([
      { tool_calls: [toolCall('set_values', { count: 'zero', flag: false, text: '' })] },
      { content: 'recovered' },
    ]);
    const agent = new Agent({ engine, registry: makeRegistry(received) });
    const events: AgentEvent[] = [];

    await expect(agent.send('set them', { onEvent: (e) => events.push(e) })).resolves.toBe(
      'recovered',
    );

    expect(received).toEqual([]); // the tool never ran
    const toolMsg = fake.promptSnapshots[1].find((m) => m.role === 'tool');
    const fedBack = JSON.parse(toolMsg?.content ?? '{}');
    expect(fedBack.error).toContain('Invalid arguments for tool "set_values"');
    expect(fedBack.error).toContain('.count');
    const toolEvent = events.find((e) => e.type === 'tool_result');
    expect(toolEvent).toMatchObject({
      error: expect.stringContaining('Invalid arguments'),
    });
  });

  it('reports missing required arguments without running the tool', async () => {
    const received: unknown[] = [];
    const { engine, fake } = await createEngine([
      { tool_calls: [toolCall('set_values', {})] },
      { content: 'recovered' },
    ]);
    const agent = new Agent({ engine, registry: makeRegistry(received) });

    await expect(agent.send('set them')).resolves.toBe('recovered');

    expect(received).toEqual([]);
    const toolMsg = fake.promptSnapshots[1].find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain("required property 'count'");
  });
});

describe('step limit', () => {
  it('stops after maxSteps and emits a max_steps terminal event', async () => {
    const looping: ScriptedTurn = { tool_calls: [toolCall('noop', {})] };
    const { engine, fake } = await createEngine([looping, looping, looping]);
    const agent = new Agent({ engine, registry: noopRegistry(), maxSteps: 2 });
    const events: AgentEvent[] = [];

    const reply = await agent.send('loop forever', { onEvent: (e) => events.push(e) });

    expect(reply).toBe('Reached maxSteps (2) without a final answer.');
    expect(fake.completion).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toEqual({ type: 'max_steps', steps: 2 });
  });
});

describe('tool result truncation', () => {
  it('truncates oversized tool results with an explicit marker', async () => {
    const bigData = 'x'.repeat(500);
    const registry = new ToolRegistry([
      defineTool({
        name: 'big',
        description: 'Return a large payload',
        parameters: { type: 'object', properties: {} },
        execute: () => ({ data: bigData }),
      }),
    ]);
    const { engine, fake } = await createEngine([
      { tool_calls: [toolCall('big', {})] },
      { content: 'done' },
    ]);
    const agent = new Agent({ engine, registry, maxToolResultChars: 100 });
    const events: AgentEvent[] = [];

    await expect(agent.send('fetch it', { onEvent: (e) => events.push(e) })).resolves.toBe('done');

    const toolMsg = fake.promptSnapshots[1].find((m) => m.role === 'tool');
    const fullLength = JSON.stringify({ data: bigData }).length;
    expect(toolMsg?.content).toBe(
      JSON.stringify({ data: bigData }).slice(0, 100) +
        `[truncated: tool result was ${fullLength} chars, limit is 100]`,
    );
    // The event still carries the untruncated result for the app/UI.
    const toolEvent = events.find((e) => e.type === 'tool_result');
    expect(toolEvent).toMatchObject({ result: { data: bigData } });
  });

  it('leaves small results untouched', async () => {
    const registry = new ToolRegistry([
      defineTool({
        name: 'small',
        description: 'Return a small payload',
        parameters: { type: 'object', properties: {} },
        execute: () => ({ value: 0 }),
      }),
    ]);
    const { engine, fake } = await createEngine([
      { tool_calls: [toolCall('small', {})] },
      { content: 'done' },
    ]);
    const agent = new Agent({ engine, registry, maxToolResultChars: 100 });

    await agent.send('fetch it');

    const toolMsg = fake.promptSnapshots[1].find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe(JSON.stringify({ value: 0 }));
  });
});

describe('context limit', () => {
  // Budget: contextTokens 48 - maxTokens 8 = 40 estimated prompt tokens.
  // Each message costs ceil(chars / 4) + 8 overhead.
  const limits = { systemPrompt: 'sys', contextTokens: 48, maxTokens: 8, charsPerToken: 4 };

  it('trims the oldest turns so the prompt fits the budget', async () => {
    const { engine, fake } = await createEngine([
      { content: 'answer one' },
      { content: 'answer two' },
    ]);
    const agent = new Agent({ engine, ...limits });

    await agent.send('first question please'); // sys(9) + user(14) = 23, fits
    const reply = await agent.send('second question please'); // 48 > 40, trims

    expect(reply).toBe('answer two');
    const secondPrompt = fake.promptSnapshots[1];
    const contents = secondPrompt.map((m) => m.content);
    expect(contents).not.toContain('first question please'); // trimmed
    expect(contents).toContain('answer one'); // still fits
    expect(contents).toContain('second question please');
    expect(secondPrompt[0].role).toBe('system');
  });

  it('fails predictably when the untrimmable turn exceeds the budget', async () => {
    const { engine, fake } = await createEngine([{ content: 'unused' }]);
    const agent = new Agent({ engine, ...limits });
    const events: AgentEvent[] = [];

    await expect(
      agent.send('x'.repeat(1000), { onEvent: (e) => events.push(e) }),
    ).rejects.toThrow(/Context limit exceeded/);

    expect(fake.completion).not.toHaveBeenCalled();
    expect(events[events.length - 1]).toMatchObject({
      type: 'error',
      error: expect.stringContaining('Context limit exceeded'),
    });
  });

  it('rejects a configuration that leaves no room for the prompt', async () => {
    const { engine } = await createEngine([]);
    expect(() => new Agent({ engine, contextTokens: 100, maxTokens: 100 })).toThrow(
      /must be larger than maxTokens/,
    );
  });
});

describe('history isolation', () => {
  it('gives each Agent instance its own conversation state', async () => {
    const first = await createEngine([{ content: 'hi one' }]);
    const agent1 = new Agent({ engine: first.engine });
    await agent1.send('first agent message');

    const second = await createEngine([{ content: 'hi two' }]);
    const agent2 = new Agent({ engine: second.engine });

    expect(agent2.messages).toHaveLength(1);
    expect(agent2.messages[0].role).toBe('system');

    await agent2.send('second agent message');

    expect(agent1.messages).not.toBe(agent2.messages);
    expect(agent1.messages.some((m) => m.content === 'second agent message')).toBe(false);
    expect(agent2.messages.some((m) => m.content === 'first agent message')).toBe(false);

    agent1.reset();
    expect(agent1.messages).toHaveLength(1);
    expect(agent2.messages.length).toBeGreaterThan(1); // reset() is per-instance
  });
});

describe('LlamaEngine', () => {
  it('throws when chatting before a model is loaded', async () => {
    const engine = new LlamaEngine();
    await expect(engine.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /Model not loaded/,
    );
  });

  it('stop() is a safe no-op when nothing is loaded or running', async () => {
    const engine = new LlamaEngine();
    await expect(engine.stop()).resolves.toBeUndefined();
  });

  it('exposes the n_ctx it was loaded with', async () => {
    const { engine } = await createEngine([], 2048);
    expect(engine.contextSize).toBe(2048);
  });

  it('rejects a chat whose signal is already aborted without calling completion', async () => {
    const { engine, fake } = await createEngine([{ content: 'unused' }]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      engine.chat([{ role: 'user', content: 'hi' }], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.completion).not.toHaveBeenCalled();
  });
});
