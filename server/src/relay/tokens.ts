import { createHash, randomBytes } from 'node:crypto';
import type { Sql } from 'postgres';

/**
 * Single-use relay session tokens. The opaque token is returned to the
 * caller once; only its SHA-256 hash is stored. Redemption is atomic:
 * a token redeems exactly once and replay or expiry yields null.
 */
export interface RelaySessionStore {
  create(session: { tokenHash: string; deviceId: string; expiresAt: Date }): Promise<void>;
  /** Atomically marks the session redeemed. Null when unknown, expired, or already redeemed. */
  redeem(tokenHash: string, now: Date): Promise<{ deviceId: string } | null>;
}

export function generateRelayToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRelayToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueRelayToken(
  store: RelaySessionStore,
  deviceId: string,
  ttlSeconds: number,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateRelayToken();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  await store.create({ tokenHash: hashRelayToken(token), deviceId, expiresAt });
  return { token, expiresAt };
}

export async function redeemRelayToken(
  store: RelaySessionStore,
  token: string,
  now: Date = new Date(),
): Promise<{ deviceId: string } | null> {
  return await store.redeem(hashRelayToken(token), now);
}

/** Postgres-backed store; single-use is enforced by the atomic UPDATE. */
export class PgRelaySessionStore implements RelaySessionStore {
  constructor(private readonly sql: Sql) {}

  async create(session: { tokenHash: string; deviceId: string; expiresAt: Date }): Promise<void> {
    await this.sql`
      INSERT INTO relay_sessions (device_id, token_hash, expires_at)
      VALUES (${session.deviceId}, ${session.tokenHash}, ${session.expiresAt})
    `;
  }

  async redeem(tokenHash: string, _now: Date): Promise<{ deviceId: string } | null> {
    const [row] = await this.sql<{ deviceId: string }[]>`
      UPDATE relay_sessions
      SET redeemed_at = NOW()
      WHERE token_hash = ${tokenHash} AND redeemed_at IS NULL AND expires_at > NOW()
      RETURNING device_id
    `;
    return row ? { deviceId: row.deviceId } : null;
  }
}

/** In-memory store with the same single-use semantics; used by unit tests. */
export class InMemoryRelaySessionStore implements RelaySessionStore {
  private readonly sessions = new Map<
    string,
    { deviceId: string; expiresAt: Date; redeemedAt: Date | null }
  >();

  async create(session: { tokenHash: string; deviceId: string; expiresAt: Date }): Promise<void> {
    this.sessions.set(session.tokenHash, {
      deviceId: session.deviceId,
      expiresAt: session.expiresAt,
      redeemedAt: null,
    });
  }

  async redeem(tokenHash: string, now: Date): Promise<{ deviceId: string } | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (session.redeemedAt !== null) return null;
    if (session.expiresAt.getTime() <= now.getTime()) return null;
    session.redeemedAt = now;
    return { deviceId: session.deviceId };
  }
}
