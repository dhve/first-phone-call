// Metro config for an npm-workspaces monorepo.
// Lets Metro watch the whole repo (so the local package resolves) and find
// dependencies hoisted to the root node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the monorepo.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from both the app and the workspace root. Hierarchical
//    lookup stays ENABLED so Metro can also find deps npm chose to nest (e.g.
//    expo/node_modules/expo-asset) rather than hoist.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
