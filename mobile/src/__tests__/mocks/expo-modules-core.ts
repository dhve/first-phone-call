/**
 * Stand-in for expo-modules-core: tests register fake native modules before
 * the code under test imports them via requireOptionalNativeModule.
 */

export interface EventSubscription {
  remove(): void;
}

let modules: Record<string, unknown> = {};

export function __reset(): void {
  modules = {};
}

export function __setNativeModule(name: string, module: unknown): void {
  modules[name] = module;
}

export function requireOptionalNativeModule<T>(name: string): T | null {
  return (modules[name] as T | undefined) ?? null;
}

export function requireNativeModule<T>(name: string): T {
  const module = modules[name];
  if (!module) throw new Error(`Native module not mocked: ${name}`);
  return module as T;
}
