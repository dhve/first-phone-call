import { Directory, File, Paths } from 'expo-file-system';

/**
 * On-disk app state as JSON files under the document directory:
 *
 *   host39/settings.json   app settings (server URL, active card, ...)
 *   host39/cards.json      local agent cards
 *   host39/audit.json      task audit log (outcomes only, never content)
 *   knowledge/             files the hosted agent may read (and optionally write)
 */

export interface Settings {
  serverBaseUrl?: string;
  email?: string;
  deviceId?: string;
  activeCardSlug?: string;
  hostingEnabled?: boolean;
}

export interface CardSkill {
  id: string;
  name: string;
  description?: string;
}

export interface LocalCard {
  slug: string;
  name: string;
  description: string;
  skills: CardSkill[];
  /** Per-card setting: expose write_file into the knowledge dir. Default off. */
  allowWrites: boolean;
  /**
   * Last successfully published cache version (server requires a strictly
   * increasing integer). 0 means never published.
   */
  version: number;
  updatedAt: string;
}

export interface AuditEntry {
  ts: string;
  card: string;
  outcome: 'ok' | 'rejected' | 'error';
  /** Structured code for rejected/error outcomes. Never prompt/response text. */
  code?: string;
}

const MAX_AUDIT_ENTRIES = 200;

function stateDir(): Directory {
  const dir = new Directory(Paths.document, 'host39');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Dedicated directory the agent's file tools are scoped to. */
export function knowledgeDir(): Directory {
  const dir = new Directory(Paths.document, 'knowledge');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function readJson<T>(name: string, fallback: T): T {
  try {
    const file = new File(stateDir(), name);
    if (!file.exists) return fallback;
    return JSON.parse(file.textSync()) as T;
  } catch {
    return fallback;
  }
}

function writeJson(name: string, value: unknown): void {
  const file = new File(stateDir(), name);
  if (!file.exists) file.create();
  file.write(JSON.stringify(value, null, 2));
}

export function loadSettings(): Settings {
  return readJson<Settings>('settings.json', {});
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  writeJson('settings.json', next);
  return next;
}

export function loadCards(): LocalCard[] {
  return readJson<LocalCard[]>('cards.json', []);
}

export function saveCard(card: LocalCard): LocalCard[] {
  const cards = loadCards();
  const idx = cards.findIndex((c) => c.slug === card.slug);
  if (idx >= 0) cards[idx] = card;
  else cards.push(card);
  writeJson('cards.json', cards);
  return cards;
}

export function getCard(slug: string | undefined): LocalCard | undefined {
  if (!slug) return undefined;
  return loadCards().find((c) => c.slug === slug);
}

export function loadAudit(): AuditEntry[] {
  return readJson<AuditEntry[]>('audit.json', []);
}

export function appendAudit(entry: AuditEntry): void {
  const log = loadAudit();
  log.push(entry);
  writeJson('audit.json', log.slice(-MAX_AUDIT_ENTRIES));
}
