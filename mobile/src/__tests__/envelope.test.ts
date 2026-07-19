import { describe, expect, it } from 'vitest';
import {
  RELAY_AGENT_ERRORS,
  agentTextMessage,
  parseEnvelope,
  textFromMessage,
} from '../relay/envelope';

describe('relay envelope helpers', () => {
  it('parses a request envelope with its slug binding', () => {
    const env = parseEnvelope(
      JSON.stringify({
        type: 'request',
        id: 'r1',
        method: 'message/send',
        slug: 'my-agent',
        params: { message: { role: 'user', parts: [{ kind: 'text', text: 'hi' }] } },
        deadline: 123,
      }),
    );
    expect(env).toMatchObject({ type: 'request', slug: 'my-agent' });
  });

  it('returns null for malformed frames', () => {
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope('42')).toBeNull();
    expect(parseEnvelope(JSON.stringify({ id: 'no-type' }))).toBeNull();
  });

  it('concatenates only text parts into the prompt', () => {
    expect(
      textFromMessage({
        role: 'user',
        parts: [
          { kind: 'text', text: '  first' },
          { kind: 'file', uri: 'x' },
          { kind: 'text', text: 'second  ' },
        ],
      }),
    ).toBe('first\nsecond');
    expect(textFromMessage(undefined)).toBe('');
  });

  it('wraps agent text as an A2A agent message', () => {
    const msg = agentTextMessage('done');
    expect(msg.role).toBe('agent');
    expect(msg.parts).toEqual([{ kind: 'text', text: 'done' }]);
    expect(msg.messageId).toBeTruthy();
  });

  it('keeps UNKNOWN_CARD inside the device-gating code range', () => {
    expect(RELAY_AGENT_ERRORS.UNKNOWN_CARD).toBe(-32026);
    expect(RELAY_AGENT_ERRORS.UNKNOWN_CARD).toBeLessThan(-32019);
    expect(RELAY_AGENT_ERRORS.UNKNOWN_CARD).toBeGreaterThan(-32100);
  });
});
