import { API_PATHS, agentUrn, emailHandle, shortHandle } from '../config';

/**
 * Pure helpers for registering the hosted agent with a NANDA index server
 * (nanda-index-v2 API, POST /api/v1/orgs with hosting_path "personal").
 */

export interface NandaPublisherBlock {
  identifier: string;
  displayName: string;
  identityType: 'email';
}

export interface NandaOrgPayload {
  org_id: string;
  display_name: string;
  hosting_path: 'personal';
  contact_email: string;
  registry_url: string;
  identifier: string;
  media_type: 'application/a2a-agent-card+json';
  publisher: NandaPublisherBlock;
}

/** Coerce arbitrary text into the org_id shape ^[a-z0-9][a-z0-9-]*[a-z0-9]$. */
export function sanitizeOrgId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

/** Prefill for the editable org_id field: <handle>-<slug>. */
export function defaultNandaOrgId(email: string, slug: string): string {
  return sanitizeOrgId(`${shortHandle(email)}-${slug}`);
}

/**
 * POST /api/v1/orgs body for a personal registration. The index validates
 * that the identifier URN's email matches contact_email and activates the
 * registration when the contact email is verified.
 */
export function buildNandaOrgPayload(opts: {
  orgId: string;
  email: string;
  displayName?: string;
  card: { slug: string; name: string };
  publicBaseUrl: string;
}): NandaOrgPayload {
  const base = opts.publicBaseUrl.replace(/\/+$/, '');
  return {
    org_id: opts.orgId,
    display_name: opts.card.name,
    hosting_path: 'personal',
    contact_email: opts.email,
    registry_url: `${base}${API_PATHS.publicCard(emailHandle(opts.email), opts.card.slug)}`,
    identifier: agentUrn(opts.email, opts.card.slug),
    media_type: 'application/a2a-agent-card+json',
    publisher: {
      identifier: opts.email,
      displayName: opts.displayName || shortHandle(opts.email),
      identityType: 'email',
    },
  };
}
