import * as SecureStore from 'expo-secure-store';

/**
 * Tokens live in expo-secure-store (Android Keystore backed), never in the
 * JSON state files.
 */

const HOST39_JWT_KEY = 'host39_jwt';
const NANDA_JWT_KEY = 'nanda_jwt';

export async function getHost39Jwt(): Promise<string | null> {
  return SecureStore.getItemAsync(HOST39_JWT_KEY);
}

export async function setHost39Jwt(token: string): Promise<void> {
  await SecureStore.setItemAsync(HOST39_JWT_KEY, token);
}

export async function clearHost39Jwt(): Promise<void> {
  await SecureStore.deleteItemAsync(HOST39_JWT_KEY);
}

export async function getNandaJwt(): Promise<string | null> {
  return SecureStore.getItemAsync(NANDA_JWT_KEY);
}

export async function setNandaJwt(token: string): Promise<void> {
  await SecureStore.setItemAsync(NANDA_JWT_KEY, token);
}

export async function clearNandaJwt(): Promise<void> {
  await SecureStore.deleteItemAsync(NANDA_JWT_KEY);
}
