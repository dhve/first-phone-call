-- Phone relay: registered devices, single-use relay session tokens,
-- and the verified signed card cache.
-- Only public cards, signatures, device public keys, versions, and
-- connection metadata are persisted. Request/response payloads never are.

-- Devices registered by phone apps (ES256 public key from Android Keystore)
CREATE TABLE IF NOT EXISTS devices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR(255),
  -- ES256 (EC P-256) public key as a JWK
  public_key_jwk    JSONB NOT NULL,
  -- Relay connection metadata; connected_at IS NULL means offline
  connected_at      TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

-- Short-lived single-use WebSocket credentials.
-- Only the SHA-256 hash of the opaque token is stored; redemption is a
-- single atomic UPDATE so a token can be redeemed exactly once.
CREATE TABLE IF NOT EXISTS relay_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  token_hash  VARCHAR(64) UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_relay_sessions_device_id ON relay_sessions(device_id);

-- Latest verified signed agent card per (user, slug), served publicly
-- even while the phone is offline.
CREATE TABLE IF NOT EXISTS card_cache (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  slug       VARCHAR(64) NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  -- The canonical signed agent card JSON, exactly as verified
  card       JSONB NOT NULL,
  -- base64url ES256 signature over the RFC 8785 canonicalized card
  signature  TEXT NOT NULL,
  -- Strictly increasing integer version
  version    BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_card_cache_device_id ON card_cache(device_id);
