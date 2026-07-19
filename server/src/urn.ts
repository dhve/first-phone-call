/**
 * Personal agent URNs. The format is a stable public contract and must
 * not change: urn:ai:email:<account-email>:agent:<slug>
 */

const PERSONAL_URN_PREFIX = 'urn:ai:email:';
const AGENT_MARKER = ':agent:';

export function buildPersonalUrn(email: string, slug: string): string {
  return `${PERSONAL_URN_PREFIX}${email}${AGENT_MARKER}${slug}`;
}

export interface ParsedPersonalUrn {
  email: string;
  slug: string;
}

/**
 * Parses urn:ai:email:<email>:agent:<slug>. Returns null when the value
 * is not a personal agent URN.
 */
export function parsePersonalUrn(urn: string): ParsedPersonalUrn | null {
  if (!urn.startsWith(PERSONAL_URN_PREFIX)) return null;
  const rest = urn.slice(PERSONAL_URN_PREFIX.length);
  const marker = rest.lastIndexOf(AGENT_MARKER);
  if (marker <= 0) return null;
  const email = rest.slice(0, marker);
  const slug = rest.slice(marker + AGENT_MARKER.length);
  if (!email || !slug) return null;
  return { email, slug };
}
