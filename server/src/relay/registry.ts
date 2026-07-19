import { randomUUID } from 'node:crypto';
import { decodeEnvelope, encodeEnvelope } from './envelope.js';
import type { RelayEnvelope } from './envelope.js';

/** Minimal socket surface the registry needs (satisfied by ws WebSocket). */
export interface RelaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RelayConnectionEvents {
  onConnect?: (deviceId: string) => void;
  onHeartbeat?: (deviceId: string) => void;
  onDisconnect?: (deviceId: string) => void;
}

export type RelayFailureReason = 'busy' | 'unavailable' | 'timeout';

export class RelayRequestError extends Error {
  constructor(readonly reason: RelayFailureReason) {
    super(`relay request failed: ${reason}`);
    this.name = 'RelayRequestError';
  }
}

/** Raised when the phone answers a runtime request with an error envelope. */
export class RelayAgentError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'RelayAgentError';
  }
}

interface PendingRequest {
  id: string;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface Connection {
  socket: RelaySocket;
  connectedAt: number;
  lastHeartbeat: number;
  missedPings: number;
  pingTimer: NodeJS.Timeout;
  pending: PendingRequest | null;
}

export interface RelayRegistryOptions {
  heartbeatIntervalMs: number;
  maxMissedHeartbeats: number;
  events?: RelayConnectionEvents;
}

/**
 * In-memory registry of live phone relay connections. One socket per
 * device (a new socket replaces the old one), one in-flight runtime
 * request per device. Request and response payloads only transit
 * memory; they are never persisted.
 */
export class RelayRegistry {
  private readonly connections = new Map<string, Connection>();

  constructor(private readonly opts: RelayRegistryOptions) {}

  isConnected(deviceId: string): boolean {
    return this.connections.has(deviceId);
  }

  /** Binds a socket to a device, replacing any previous socket. */
  attach(deviceId: string, socket: RelaySocket): void {
    const existing = this.connections.get(deviceId);
    if (existing) {
      this.teardown(deviceId, existing, 4000, 'replaced by a newer connection');
    }
    const connection: Connection = {
      socket,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      missedPings: 0,
      pingTimer: setInterval(() => this.tick(deviceId), this.opts.heartbeatIntervalMs),
      pending: null,
    };
    this.connections.set(deviceId, connection);
    this.opts.events?.onConnect?.(deviceId);
  }

  /**
   * Removes a device's connection. When a socket is given, only detaches
   * if it is still the bound socket (so a replaced socket's close event
   * cannot tear down its replacement).
   */
  detach(deviceId: string, socket?: RelaySocket): void {
    const connection = this.connections.get(deviceId);
    if (!connection) return;
    if (socket && connection.socket !== socket) return;
    this.teardown(deviceId, connection);
  }

  /** Handles a raw inbound frame from the device's socket. */
  handleMessage(deviceId: string, raw: string): void {
    const connection = this.connections.get(deviceId);
    if (!connection) return;

    const decoded = decodeEnvelope(raw);
    if (!decoded.ok) return;

    const envelope = decoded.envelope;
    switch (envelope.type) {
      case 'hello':
        this.trySend(connection, {
          type: 'ready',
          deviceId,
          heartbeatIntervalMs: this.opts.heartbeatIntervalMs,
        });
        break;

      case 'ping':
        this.trySend(connection, { type: 'pong', ts: envelope.ts });
        break;

      case 'pong':
        connection.missedPings = 0;
        connection.lastHeartbeat = Date.now();
        this.opts.events?.onHeartbeat?.(deviceId);
        break;

      case 'response':
        if (connection.pending && connection.pending.id === envelope.id) {
          const pending = connection.pending;
          connection.pending = null;
          clearTimeout(pending.timer);
          pending.resolve(envelope.result);
        }
        break;

      case 'error':
        if (connection.pending && connection.pending.id === envelope.id) {
          const pending = connection.pending;
          connection.pending = null;
          clearTimeout(pending.timer);
          pending.reject(new RelayAgentError(envelope.code, envelope.message));
        }
        break;

      default:
        break;
    }
  }

  /**
   * Forwards a runtime "message/send" request to the device and awaits
   * its response. Rejects with RelayRequestError (busy, unavailable,
   * timeout) or RelayAgentError (phone replied with an error envelope).
   */
  async request(deviceId: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const connection = this.connections.get(deviceId);
    if (!connection) throw new RelayRequestError('unavailable');
    if (connection.pending) throw new RelayRequestError('busy');

    const id = randomUUID();
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (connection.pending && connection.pending.id === id) {
          connection.pending = null;
        }
        reject(new RelayRequestError('timeout'));
      }, timeoutMs);

      connection.pending = { id, resolve, reject, timer };

      const sent = this.trySend(connection, {
        type: 'request',
        id,
        method: 'message/send',
        params,
        deadline: Date.now() + timeoutMs,
      });
      if (!sent) {
        connection.pending = null;
        clearTimeout(timer);
        reject(new RelayRequestError('unavailable'));
      }
    });
  }

  /** Closes every connection; used on server shutdown. */
  shutdown(): void {
    for (const [deviceId, connection] of this.connections) {
      this.teardown(deviceId, connection, 1001, 'server shutting down');
    }
  }

  private tick(deviceId: string): void {
    const connection = this.connections.get(deviceId);
    if (!connection) return;
    if (connection.missedPings >= this.opts.maxMissedHeartbeats) {
      this.teardown(deviceId, connection, 4008, 'heartbeat timeout');
      return;
    }
    connection.missedPings += 1;
    this.trySend(connection, { type: 'ping', ts: Date.now() });
  }

  private trySend(connection: Connection, envelope: RelayEnvelope): boolean {
    try {
      connection.socket.send(encodeEnvelope(envelope));
      return true;
    } catch {
      return false;
    }
  }

  private teardown(deviceId: string, connection: Connection, closeCode?: number, closeReason?: string): void {
    clearInterval(connection.pingTimer);
    if (connection.pending) {
      const pending = connection.pending;
      connection.pending = null;
      clearTimeout(pending.timer);
      pending.reject(new RelayRequestError('unavailable'));
    }
    this.connections.delete(deviceId);
    if (closeCode !== undefined) {
      try {
        connection.socket.close(closeCode, closeReason);
      } catch {
        // socket already closed
      }
    }
    this.opts.events?.onDisconnect?.(deviceId);
  }
}
