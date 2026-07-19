import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/**
 * JS surface of the host39-native local Expo module (Android, Kotlin).
 * Provides Keystore-backed ES256 signing, streaming SHA-256, device health,
 * and control of the relay foreground service that owns the WebSocket.
 */

export type ThermalStatus =
  | 'none'
  | 'light'
  | 'moderate'
  | 'severe'
  | 'critical'
  | 'emergency'
  | 'shutdown'
  | 'unknown';

export interface DeviceHealthSnapshot {
  /** Battery percent, 0-100. */
  batteryLevel: number;
  charging: boolean;
  thermal: ThermalStatus;
  /** Whether the active network claims internet connectivity. */
  online: boolean;
}

/** Public key as a JWK, verifiable with WebCrypto/jose (ES256, P-256). */
export interface DevicePublicKeyJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  alg: 'ES256';
}

export type NativeRelayState =
  | 'stopped'
  | 'connecting'
  | 'connected'
  | 'waiting-token'
  | 'backoff';

export type Host39NativeEvents = {
  /** A relay envelope (JSON string) forwarded from the foreground service. */
  onRelayMessage: (event: { json: string }) => void;
  /** Connection state changes from the foreground service. */
  onRelayState: (event: { state: NativeRelayState }) => void;
  /**
   * The service needs a fresh single-use relay token (e.g. to reconnect after
   * a drop or a START_STICKY restart). JS answers via provideRelayToken().
   */
  onRelayTokenRequest: () => void;
};

export interface Host39NativeModule {
  addListener<EventName extends keyof Host39NativeEvents>(
    eventName: EventName,
    listener: Host39NativeEvents[EventName],
  ): EventSubscription;
  removeAllListeners(eventName: keyof Host39NativeEvents): void;
  /**
   * Returns the device's ES256 public key as a JWK, generating a
   * non-exportable keypair in the Android Keystore on first call.
   */
  getPublicKeyJwk(): Promise<DevicePublicKeyJwk>;
  /**
   * Sign bytes (standard base64 input) with the Keystore key. Returns a
   * base64url raw (r || s) ECDSA signature suitable for WebCrypto/jose.
   */
  sign(dataBase64: string): Promise<string>;
  /** Streaming SHA-256 of a file; accepts a path or file:// URI, returns hex. */
  sha256File(path: string): Promise<string>;
  deviceHealth(): Promise<DeviceHealthSnapshot>;
  /** Start (or restart) the relay foreground service with a WS URL + token. */
  startRelayService(url: string, token: string): Promise<void>;
  stopRelayService(): Promise<void>;
  /** Answer an onRelayTokenRequest with a freshly minted single-use token. */
  provideRelayToken(token: string): Promise<void>;
  /** Send an envelope (JSON string) to the relay. False if not connected. */
  sendRelayMessage(json: string): Promise<boolean>;
  getRelayState(): NativeRelayState;
}

/** Null when the native module is absent (e.g. Expo Go or iOS builds). */
export const Host39Native = requireOptionalNativeModule<Host39NativeModule>('Host39Native');

export function requireHost39Native(): Host39NativeModule {
  if (!Host39Native) {
    throw new Error(
      'host39-native module is unavailable. Rebuild the dev client (expo run:android); Expo Go is not supported.',
    );
  }
  return Host39Native;
}
