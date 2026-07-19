import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const mock = (name: string) =>
  fileURLToPath(new URL(`./src/__tests__/mocks/${name}.ts`, import.meta.url));

/**
 * Unit tests for the pure logic in src/. Native and Expo modules are replaced
 * with in-memory test doubles via aliases, so no React Native runtime is
 * involved (see src/__tests__/mocks).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      'expo-file-system': mock('expo-file-system'),
      'expo-secure-store': mock('expo-secure-store'),
      'expo-modules-core': mock('expo-modules-core'),
      'llama.rn': mock('llama.rn'),
    },
  },
});
