import { describe, expect, it } from 'vitest';
import {
  buildNandaOrgPayload,
  defaultNandaOrgId,
  sanitizeOrgId,
} from '../nanda/registration';

describe('NANDA org_id prefill', () => {
  it('prefills <handle>-<slug> from the email local part', () => {
    expect(defaultNandaOrgId('vedh@example.com', 'my-agent')).toBe('vedh-my-agent');
  });

  it('sanitizes characters the org_id pattern rejects', () => {
    expect(defaultNandaOrgId('vedh.krishnan+test@gmail.com', 'my-agent')).toBe(
      'vedh-krishnan-test-my-agent',
    );
    expect(sanitizeOrgId('--Weird__ID!!')).toBe('weird-id');
  });

  it('caps the org_id length without a trailing hyphen', () => {
    const long = sanitizeOrgId(`${'a'.repeat(63)}-b`);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.endsWith('-')).toBe(false);
    expect(long).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  });
});

describe('NANDA registration payload', () => {
  const payload = buildNandaOrgPayload({
    orgId: 'vedh-my-agent',
    email: 'vedh@example.com',
    displayName: 'Vedh Krishnan',
    card: { slug: 'my-agent', name: 'My Agent' },
    publicBaseUrl: 'https://host39.example.com/',
  });

  it('builds the personal-registration body the index validates', () => {
    expect(payload).toEqual({
      org_id: 'vedh-my-agent',
      display_name: 'My Agent',
      hosting_path: 'personal',
      contact_email: 'vedh@example.com',
      registry_url: 'https://host39.example.com/personal/vedh%40example.com/my-agent.json',
      identifier: 'urn:ai:email:vedh@example.com:agent:my-agent',
      media_type: 'application/a2a-agent-card+json',
      publisher: {
        identifier: 'vedh@example.com',
        displayName: 'Vedh Krishnan',
        identityType: 'email',
      },
    });
  });

  it('keeps the identifier email equal to contact_email (index invariant)', () => {
    const urnEmail = /^urn:ai:email:(.+)@(.+):agent:/.exec(payload.identifier);
    expect(`${urnEmail?.[1]}@${urnEmail?.[2]}`).toBe(payload.contact_email);
  });

  it('falls back to the handle when no display name is set', () => {
    const p = buildNandaOrgPayload({
      orgId: 'vedh-my-agent',
      email: 'vedh@example.com',
      card: { slug: 'my-agent', name: 'My Agent' },
      publicBaseUrl: 'https://host39.example.com',
    });
    expect(p.publisher.displayName).toBe('vedh');
  });
});
