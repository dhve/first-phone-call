/** In-memory stand-in for expo-secure-store. */

const store = new Map<string, string>();

export function __reset(): void {
  store.clear();
}

export async function getItemAsync(key: string): Promise<string | null> {
  return store.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}
