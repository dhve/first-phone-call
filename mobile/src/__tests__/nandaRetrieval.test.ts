import { afterEach, describe, expect, it, vi } from 'vitest';
import { retrieveNandaAgentCard } from '../api/nanda';
import { agentUrn } from '../config';
import { jsonResponse } from './harness';

const LOCATOR = agentUrn('vedh@example.com', 'my-agent');
const CARD_URL = 'https://host39.example.com/personal/vedh%40example.com/my-agent.json';

function resolution(registryUrl: string | null = CARD_URL) {
  return {
    locator: LOCATOR,
    identifier: 'my-agent',
    index_record: {
      org_id: 'vedh-my-agent',
      display_name: 'My Agent',
      registry_url: registryUrl,
      status: 'active',
      email_verified: true,
      identifier: LOCATOR,
      media_type: 'application/a2a-agent-card+json',
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registered NANDA agent-card retrieval', () => {
  it('resolves the URN and fetches the card from the returned registry_url', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/api/v1/resolve?locator=')) return jsonResponse(resolution());
      if (url === CARD_URL) {
        return jsonResponse({
          name: 'My Agent',
          url: 'https://host39.example.com/a2a/personal/vedh%40example.com/my-agent',
          _meta: { identifier: LOCATOR },
        });
      }
      return jsonResponse({ detail: 'unexpected URL' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveNandaAgentCard(LOCATOR);

    expect(result.cardUrl).toBe(CARD_URL);
    expect(result.card).toMatchObject({ name: 'My Agent', _meta: { identifier: LOCATOR } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/api/v1/resolve?locator=${encodeURIComponent(LOCATOR)}`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(CARD_URL);
  });

  it('rejects a card whose identity does not match the requested locator', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('/api/v1/resolve?locator=')
          ? jsonResponse(resolution())
          : jsonResponse({ name: 'Wrong Agent', _meta: { identifier: 'urn:ai:email:other@example.com:agent:other' } }),
      ),
    );

    await expect(retrieveNandaAgentCard(LOCATOR)).rejects.toThrow(/identity does not match/);
  });

  it('fails when NANDA does not return a card URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(resolution(null))));

    await expect(retrieveNandaAgentCard(LOCATOR)).rejects.toThrow(/no registry_url/);
  });
});
