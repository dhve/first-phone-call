import { describe, expect, it } from 'vitest';
import { buildPersonalUrn, parsePersonalUrn } from './urn.js';

describe('personal agent URN', () => {
  it('matches the required urn:ai:email:<email>:agent:<slug> format', () => {
    expect(buildPersonalUrn('vedh@example.com', 'assistant')).toBe(
      'urn:ai:email:vedh@example.com:agent:assistant',
    );
  });

  it('is compatible with the identifier served by the public card route', () => {
    // The public route builds `urn:ai:email:${user.email}:agent:${slug}`
    // for email-identity users; the shared builder must stay identical.
    const email = 'someone+tag@sub.example.org';
    const slug = 'my-agent-2';
    expect(buildPersonalUrn(email, slug)).toBe(`urn:ai:email:${email}:agent:${slug}`);
  });

  it('round-trips through parse', () => {
    const urn = buildPersonalUrn('a@b.co', 'helper');
    expect(parsePersonalUrn(urn)).toEqual({ email: 'a@b.co', slug: 'helper' });
  });

  it('rejects non-personal URNs', () => {
    expect(parsePersonalUrn('urn:ai:domain:moonbakery.com:agent:orders')).toBeNull();
    expect(parsePersonalUrn('urn:ai:email:a@b.co')).toBeNull();
    expect(parsePersonalUrn('urn:ai:email::agent:slug')).toBeNull();
    expect(parsePersonalUrn('urn:ai:email:a@b.co:agent:')).toBeNull();
    expect(parsePersonalUrn('not-a-urn')).toBeNull();
  });
});
