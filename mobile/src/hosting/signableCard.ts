import { API_PATHS, agentUrn, emailHandle } from '../config';
import type { LocalCard } from '../storage/appStorage';

/**
 * Builds the canonical card object that gets signed and pushed to
 * PUT /mobile/cards/:slug/cache. Server-validated invariants:
 *
 * - `url` advertises the runtime endpoint the server serves for this agent:
 *   <publicBaseUrl>/a2a/personal/<handle>/<slug>
 * - `version` equals the top-level integer version in the cache PUT body.
 * - `_meta.identifier` is the personal agent URN for the account email.
 */
export function buildSignableCard(
  card: Pick<LocalCard, 'slug' | 'name' | 'description' | 'skills'>,
  email: string,
  version: number,
  publicBaseUrl: string,
): Record<string, unknown> {
  const base = publicBaseUrl.replace(/\/+$/, '');
  return {
    name: card.name,
    description: card.description || null,
    url: `${base}${API_PATHS.a2aRuntime(emailHandle(email), card.slug)}`,
    version,
    capabilities: { streaming: false, pushNotifications: false },
    authentication: { schemes: ['none'] },
    skills: card.skills,
    _meta: {
      identifier: agentUrn(email, card.slug),
      hostedBy: 'host39.org',
    },
  };
}
