import { beforeEach, describe, expect, it } from 'vitest';
import { __reset } from './mocks/expo-file-system';
import {
  appendAudit,
  getCard,
  loadAudit,
  loadCards,
  loadSettings,
  saveCard,
  saveSettings,
  type AuditEntry,
} from '../storage/appStorage';
import { cardFixture } from './harness';
import type { LocalCard } from '../storage/appStorage';

describe('settings storage', () => {
  beforeEach(() => __reset());

  it('round-trips settings through the JSON file', () => {
    saveSettings({ serverBaseUrl: 'http://10.0.2.2:3010', email: 'vedh@example.com' });
    saveSettings({ publicBaseUrl: 'https://pub.example.com', nandaOrgId: 'vedh-my-agent' });
    expect(loadSettings()).toEqual({
      serverBaseUrl: 'http://10.0.2.2:3010',
      email: 'vedh@example.com',
      publicBaseUrl: 'https://pub.example.com',
      nandaOrgId: 'vedh-my-agent',
    });
  });

  it('clears a setting when the patch sets it to undefined', () => {
    saveSettings({ publicBaseUrl: 'https://pub.example.com' });
    saveSettings({ publicBaseUrl: undefined });
    expect(loadSettings().publicBaseUrl).toBeUndefined();
  });

  it('returns empty settings when nothing was saved', () => {
    expect(loadSettings()).toEqual({});
  });
});

describe('card storage', () => {
  beforeEach(() => __reset());

  it('inserts and updates cards keyed by slug', () => {
    saveCard(cardFixture('alpha'));
    saveCard(cardFixture('beta'));
    saveCard(cardFixture('alpha', { name: 'Renamed', version: 4 }));

    expect(loadCards()).toHaveLength(2);
    expect(getCard('alpha')).toMatchObject({ name: 'Renamed', version: 4 });
    expect(getCard('beta')?.name).toBe('Agent beta');
  });

  it('returns undefined for unknown or missing slugs', () => {
    expect(getCard('ghost')).toBeUndefined();
    expect(getCard(undefined)).toBeUndefined();
  });
});

describe('audit log storage', () => {
  beforeEach(() => __reset());

  it('round-trips entries', () => {
    const entry: AuditEntry = {
      ts: '2026-07-19T12:00:00.000Z',
      card: 'alpha',
      outcome: 'rejected',
      code: 'UNKNOWN_CARD',
    };
    appendAudit(entry);
    expect(loadAudit()).toEqual([entry]);
  });

  it('caps the log at 200 entries, dropping the oldest', () => {
    for (let i = 0; i < 205; i++) {
      appendAudit({ ts: `t${i}`, card: 'alpha', outcome: 'ok' });
    }
    const log = loadAudit();
    expect(log).toHaveLength(200);
    expect(log[0].ts).toBe('t5');
    expect(log[199].ts).toBe('t204');
  });
});
