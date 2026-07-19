/**
 * React Native provides `global` at runtime, but expo's tsconfig pulls no
 * Node types, so packages whose exports map hands TypeScript raw source
 * (whisper.rn resolves via its "react-native" condition) fail on the name.
 */
declare var global: typeof globalThis & Record<string, unknown>;
