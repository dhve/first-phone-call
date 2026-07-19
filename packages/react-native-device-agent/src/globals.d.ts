/**
 * Ambient declaration for the bundler-provided `require`, used to lazily load
 * optional Expo modules from inside tool factories without pulling in
 * `@types/node`.
 */
declare function require(moduleName: string): any;
