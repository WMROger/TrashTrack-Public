// Empty shim — replaces server-only (Node.js) packages when bundling for web.
// This prevents metro from trying to bundle things like firebase-admin, fs, net, etc.
module.exports = {};
