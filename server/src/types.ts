export interface JwtPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

export interface DbUser {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  identityType: 'domain' | 'email';
  domain: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbAgentCard {
  id: string;
  userId: string;
  slug: string;
  displayName: string;
  description: string | null;
  runtimeUrl: string | null;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  authentication: {
    schemes: string[];
  };
  skills: AgentSkill[];
  providerName: string | null;
  providerUrl: string | null;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentSkill {
  id?: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface DbDevice {
  id: string;
  userId: string;
  name: string | null;
  publicKeyJwk: Record<string, unknown>;
  connectedAt: Date | null;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface DbRelaySession {
  id: string;
  deviceId: string;
  tokenHash: string;
  expiresAt: Date;
  redeemedAt: Date | null;
  createdAt: Date;
}

export interface DbCardCache {
  id: string;
  userId: string;
  deviceId: string;
  slug: string;
  card: Record<string, unknown>;
  signature: string;
  // BIGINT: postgres.js may return this as a string
  version: string | number;
  createdAt: Date;
  updatedAt: Date;
}

export interface A2AAgentCard {
  name: string;
  description: string | null;
  url: string | null;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  authentication: {
    schemes: string[];
  };
  skills: AgentSkill[];
  provider: {
    organization: string | null;
    url: string | null;
  } | null;
  _meta: {
    identifier: string;
    publicUrl: string;
    hostedBy: string;
  };
}
