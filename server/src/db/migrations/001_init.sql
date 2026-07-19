-- Users
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  display_name  VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  -- Identity type: 'domain' (SMB) or 'email' (personal)
  identity_type VARCHAR(20) NOT NULL DEFAULT 'email' CHECK (identity_type IN ('domain', 'email')),
  -- For domain-identity users: their domain (e.g., moonbakery.com)
  -- Must be unique when set
  domain        VARCHAR(255) UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent cards
CREATE TABLE IF NOT EXISTS agent_cards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- URL slug (e.g., "orders", "support")
  slug          VARCHAR(64) NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  -- Public display name
  display_name  VARCHAR(255) NOT NULL,
  description   TEXT,
  -- The actual agent runtime endpoint
  runtime_url   VARCHAR(512),
  -- Version
  version       VARCHAR(32) DEFAULT '1.0',
  -- A2A capabilities as JSONB
  capabilities  JSONB NOT NULL DEFAULT '{"streaming":false,"pushNotifications":false}',
  -- Authentication info as JSONB
  authentication JSONB NOT NULL DEFAULT '{"schemes":["none"]}',
  -- Skills/actions as JSONB array
  skills        JSONB NOT NULL DEFAULT '[]',
  -- Provider info
  provider_name VARCHAR(255),
  provider_url  VARCHAR(512),
  -- Status
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Each user can only have one card per slug
  UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_agent_cards_user_id ON agent_cards(user_id);
