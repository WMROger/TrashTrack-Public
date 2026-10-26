const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// ─── Resolver ─────────────────────────────────────────────────────────────────
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

config.resolver.alias = {
  ...config.resolver.alias,
  // Fix lodash resolution issue
  lodash: require.resolve('lodash'),
};

// Disable symlinks (avoids duplicated package issues on Windows)
config.resolver.symlinks = false;

// Platform order matters: web/browser variants are picked before native ones
config.resolver.platforms = ['ios', 'android', 'web', 'native'];

// ─── Block server-only packages from web browser bundles ─────────────────────
// firebase-admin is a Node.js-only server package and must never be bundled
// for the browser.
//
// IMPORTANT: Do NOT add Node.js built-ins (fs, dns, net, tls, etc.) here.
// The SSR bundle (expo-router/node/render.js) also uses platform='web' but
// runs in Node.js — shimming built-ins breaks util.promisify() in that context.
// Metro's own browser resolver already handles built-ins for true browser builds.
const SERVER_ONLY_MODULES = new Set([
  'firebase-admin',
  'firebase-admin/app',
  'firebase-admin/auth',
  'firebase-admin/firestore',
  'firebase-admin/storage',
  'firebase-admin/messaging',
  'firebase-admin/database',
]);

// Wrap the existing resolver so we can intercept only for web
const originalResolver = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && SERVER_ONLY_MODULES.has(moduleName)) {
    // Return a synthetic empty module so the bundle compiles without Node.js APIs
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'shims/empty-module.js'),
    };
  }
  if (originalResolver) {
    return originalResolver(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

// ─── Web-specific transformer ──────────────────────────────────────────────────
if (process.env.EXPO_PLATFORM === 'web') {
  config.transformer = {
    ...config.transformer,
    assetPlugins: ['expo-asset/tools/hashAssetFiles'],
  };
}

module.exports = config;
