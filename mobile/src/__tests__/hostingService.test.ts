import { describe, expect, it } from 'vitest';
import { MODEL } from '../config';
import { RELAY_AGENT_ERRORS, type RequestEnvelope } from '../relay/envelope';
import {
  bootHostingService,
  cardFixture,
  requestEnvelope,
  waitForSent,
} from './harness';
import type { LocalCard } from '../storage/appStorage';

/**
 * End-to-end tests of the request path through hostingService with the
 * native module, filesystem, secure store, and llama context all faked:
 * gating decisions, card-slug binding, and model integrity on load.
 */

type Harness = Awaited<ReturnType<typeof bootHostingService>>;

async function bootWithCard(slugs: Array<Partial<LocalCard> & { slug: string }> = [{ slug: 'alpha' }]) {
  const h = await bootHostingService();
  for (const patch of slugs) h.storage.saveCard(cardFixture(patch.slug, patch));
  h.storage.saveSettings({
    activeCardSlug: slugs[0]?.slug,
    deviceId: 'dev-1',
    email: 'vedh@example.com',
    serverBaseUrl: 'http://10.0.2.2:3010',
  });
  await h.hostingService.init();
  return h;
}

async function startHosting(h: Harness) {
  new h.fs.File(h.fs.Paths.document, MODEL.fileName).write('model-bytes');
  await h.secureStore.setHost39Jwt('host39-jwt');
  await h.hostingService.startHosting();
}

function sendRequest(h: Harness, env: RequestEnvelope) {
  h.native.emit('onRelayMessage', { json: JSON.stringify(env) });
}

async function expectRejection(
  h: Harness,
  env: { id: string },
  code: keyof typeof RELAY_AGENT_ERRORS,
  frameIndex = 0,
) {
  const sent = await waitForSent(h.native, frameIndex + 1);
  const frame = JSON.parse(sent[frameIndex]);
  expect(frame).toMatchObject({ type: 'error', id: env.id, code: RELAY_AGENT_ERRORS[code] });
  return frame;
}

describe('request gating', () => {
  it('rejects OFFLINE when the device has no connectivity', async () => {
    const h = await bootWithCard();
    h.native.setHealth({ online: false });
    const env = requestEnvelope('alpha');
    sendRequest(h, env);
    await expectRejection(h, env, 'OFFLINE');
  });

  it('rejects THERMAL under severe thermal status', async () => {
    const h = await bootWithCard();
    h.native.setHealth({ thermal: 'critical' });
    const env = requestEnvelope('alpha');
    sendRequest(h, env);
    await expectRejection(h, env, 'THERMAL');
  });

  it('rejects LOW_BATTERY below the floor when not charging', async () => {
    const h = await bootWithCard();
    h.native.setHealth({ batteryLevel: 10, charging: false });
    const env = requestEnvelope('alpha');
    sendRequest(h, env);
    await expectRejection(h, env, 'LOW_BATTERY');
  });

  it('rejects MODEL_NOT_LOADED when hosting has no engine', async () => {
    const h = await bootWithCard();
    const env = requestEnvelope('alpha');
    sendRequest(h, env);
    await expectRejection(h, env, 'MODEL_NOT_LOADED');
  });

  it('rejects METHOD_NOT_FOUND for unsupported methods', async () => {
    const h = await bootWithCard();
    const env = requestEnvelope('alpha', { method: 'tasks/get' });
    sendRequest(h, env);
    await expectRejection(h, env, 'METHOD_NOT_FOUND');
  });

  it('rejects BUSY while another request is in flight', async () => {
    const h = await bootWithCard();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.llama.__setContextFactory(() => ({
      completion: async () => {
        await gate;
        return { content: 'late answer', tool_calls: [] };
      },
      stopCompletion: async () => undefined,
      release: async () => undefined,
    }));
    await startHosting(h);

    const first = requestEnvelope('alpha');
    sendRequest(h, first);
    // Wait for the first request to occupy the mutex.
    const start = Date.now();
    while (!h.hostingService.getStatus().busy) {
      if (Date.now() - start > 2000) throw new Error('first request never became busy');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const second = requestEnvelope('alpha');
    sendRequest(h, second);
    await expectRejection(h, second, 'BUSY');

    release();
    const sent = await waitForSent(h.native, 2);
    expect(JSON.parse(sent[1])).toMatchObject({ type: 'response', id: first.id });
  });
});

describe('card-slug binding', () => {
  it('rejects UNKNOWN_CARD when no local card matches the slug', async () => {
    const h = await bootWithCard([{ slug: 'alpha' }]);
    const env = requestEnvelope('ghost');
    sendRequest(h, env);
    const frame = await expectRejection(h, env, 'UNKNOWN_CARD');
    expect(frame.message).toContain('ghost');
    expect(h.hostingService.getStatus().audit.at(-1)).toMatchObject({
      card: 'ghost',
      outcome: 'rejected',
      code: 'UNKNOWN_CARD',
    });
  });

  it('rejects UNKNOWN_CARD for a saved but never-published card', async () => {
    const h = await bootWithCard([{ slug: 'alpha' }, { slug: 'draft', version: 0 }]);
    const env = requestEnvelope('draft');
    sendRequest(h, env);
    await expectRejection(h, env, 'UNKNOWN_CARD');
  });

  it('answers with the envelope card context, not the active card', async () => {
    const captured: Array<Record<string, any>> = [];
    const h = await bootWithCard([
      { slug: 'alpha', allowWrites: false },
      { slug: 'beta', allowWrites: true, name: 'Agent beta' },
    ]);
    h.llama.__setContextFactory(() => ({
      completion: async (params: Record<string, any>) => {
        captured.push(params);
        return { content: 'from the right card', tool_calls: [] };
      },
      stopCompletion: async () => undefined,
      release: async () => undefined,
    }));
    await startHosting(h); // active card is alpha

    const env = requestEnvelope('beta');
    sendRequest(h, env);
    const sent = await waitForSent(h.native, 1);

    expect(JSON.parse(sent[0])).toMatchObject({ type: 'response', id: env.id });
    expect(JSON.parse(sent[0]).result.parts[0].text).toBe('from the right card');

    // System prompt comes from the beta card, not the active alpha card.
    const messages = captured[0].messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Agent beta');
    expect(messages[0].content).not.toContain('Agent alpha');

    // And beta's allow-writes setting exposes write_file to the model.
    const toolNames = (captured[0].tools ?? []).map(
      (t: any) => t.function?.name ?? t.name,
    );
    expect(toolNames).toContain('write_file');

    expect(h.hostingService.getStatus().audit.at(-1)).toMatchObject({
      card: 'beta',
      outcome: 'ok',
    });
  });

  it('does not expose write_file for a card with writes off', async () => {
    const captured: Array<Record<string, any>> = [];
    const h = await bootWithCard([{ slug: 'alpha', allowWrites: false }]);
    h.llama.__setContextFactory(() => ({
      completion: async (params: Record<string, any>) => {
        captured.push(params);
        return { content: 'ok', tool_calls: [] };
      },
      stopCompletion: async () => undefined,
      release: async () => undefined,
    }));
    await startHosting(h);

    sendRequest(h, requestEnvelope('alpha'));
    await waitForSent(h.native, 1);

    const toolNames = (captured[0].tools ?? []).map(
      (t: any) => t.function?.name ?? t.name,
    );
    expect(toolNames).toContain('read_file');
    expect(toolNames).not.toContain('write_file');
  });
});

describe('model integrity on engine load', () => {
  it('verifies the SHA-256 before loading and deletes a corrupt file', async () => {
    const h = await bootWithCard();
    new h.fs.File(h.fs.Paths.document, MODEL.fileName).write('tampered-bytes');
    await h.secureStore.setHost39Jwt('host39-jwt');
    h.native.setSha256('f'.repeat(64));

    await expect(h.hostingService.startHosting()).rejects.toThrow(/checksum mismatch/);

    const model = h.hostingService.getStatus().model;
    expect(model.state).toBe('not-downloaded');
    expect(model.error).toMatch(/checksum mismatch/);
    expect(new h.fs.File(h.fs.Paths.document, MODEL.fileName).exists).toBe(false);
  });

  it('loads the engine when the hash matches', async () => {
    const h = await bootWithCard();
    await startHosting(h);
    expect(h.hostingService.getStatus().model.state).toBe('loaded');
    expect(h.hostingService.getStatus().hostingEnabled).toBe(true);
    expect(h.native.mod.startRelayService).toHaveBeenCalledWith(
      'ws://host/relay',
      'relay-token',
      'http://10.0.2.2:3010',
      'dev-1',
      'host39-jwt',
    );
  });
});
