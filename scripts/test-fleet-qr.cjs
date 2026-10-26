const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const cache = new Map();
function load(relative) {
  const file = path.resolve(__dirname, '..', relative);
  if (cache.has(file)) return cache.get(file);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const resolve = (name) => {
    if (name === 'react-native') return { Platform: { OS: 'web' }, Share: {} };
    if (name.includes('firebase')) return { db: null, auth: { currentUser: { uid: 'test' } } };
    if (name.includes('expo-crypto')) return { getRandomBytes: () => [1, 2, 3] };
    if (!name.startsWith('.') && !name.startsWith('@/')) {
      try { return require(name); } catch { return {}; }
    }
    const resolved = name.startsWith('@/')
      ? name.slice(2) + '.ts'
      : path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(file), name + '.ts'));
    return load(resolved);
  };
  new Function('require', 'module', 'exports', output)(resolve, module, module.exports);
  cache.set(file, module.exports);
  return module.exports;
}

const {
  buildFleetInventoryQrPayload,
  encodeFleetInventoryQrString,
  parseFleetInventoryQr,
  verifyFleetInventoryQr,
  calculateShiftTiming,
} = load('services/fleetInventoryQrService.ts');

const { parseDriverQrString } = load('services/driverQrService.ts');

test('buildFleetInventoryQrPayload and parseFleetInventoryQr encode and decode accurately', () => {
  const payload = buildFleetInventoryQrPayload({
    truckId: 'truck-123',
    plateNumber: 'ABC-1111',
    barangay: 'Brgy. Baliang',
    truckType: 'Mini-Dump',
    assignedDriverId: 'driver-999',
    assignedDriverName: 'Juan Dela Cruz',
  });

  assert.equal(payload.app, 'TrashTrack');
  assert.equal(payload.type, 'fleet_inventory');
  assert.equal(payload.plateNumber, 'ABC-1111');
  assert.equal(payload.truckId, 'truck-123');

  const encoded = encodeFleetInventoryQrString(payload);
  const parsed = parseFleetInventoryQr(encoded);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.truckId, 'truck-123');
  assert.equal(parsed.plateNumber, 'ABC-1111');
  assert.equal(parsed.assignedDriverName, 'Juan Dela Cruz');
});

test('parseFleetInventoryQr extracts JSON even when wrapped in text or shared messages', () => {
  const payload = buildFleetInventoryQrPayload({
    truckId: 'truck-123',
    plateNumber: 'ABC-1111',
  });
  const encoded = encodeFleetInventoryQrString(payload);
  const sharedText = `Official CENRO Fleet Inventory Shift End QR for Truck ABC-1111:\n${encoded}\nScan to end shift.`;

  const parsed = parseFleetInventoryQr(sharedText);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.plateNumber, 'ABC-1111');
  assert.equal(parsed.truckId, 'truck-123');
});

test('parseDriverQrString correctly identifies Fleet Inventory badges and rejects them for driver login', () => {
  const payload = buildFleetInventoryQrPayload({
    truckId: 'truck-123',
    plateNumber: 'ABC-1111',
  });
  const encoded = encodeFleetInventoryQrString(payload);

  const result = parseDriverQrString(encoded);
  assert.equal(result.valid, false);
  assert.equal(result.isFleetBadge, true);
  assert.equal(result.fleetPayload?.plateNumber, 'ABC-1111');
  assert.ok(result.error?.includes('Fleet Inventory truck QR badge'));
});

test('calculateShiftTiming accurately calculates shift durations for Time In & Time Out', () => {
  const fourHoursAgo = new Date(Date.now() - 4 * 3600000);
  const now = new Date();

  const timing = calculateShiftTiming(fourHoursAgo, now);
  assert.equal(timing.durationMinutes, 240);
  assert.ok(timing.durationFormatted.includes('4 hr'));
  assert.ok(timing.timeInFormatted.length > 0);
  assert.ok(timing.timeOutFormatted.length > 0);
});

test('verifyFleetInventoryQr validates matching target truck', () => {
  const payload = buildFleetInventoryQrPayload({
    truckId: 'truck-abc',
    plateNumber: 'ABC-1111',
  });
  const encoded = encodeFleetInventoryQrString(payload);

  const match = verifyFleetInventoryQr(encoded, { id: 'truck-abc', plateNumber: 'ABC-1111' });
  assert.equal(match.valid, true);
  assert.equal(match.matchedPlate, 'ABC-1111');

  const mismatch = verifyFleetInventoryQr(encoded, { id: 'truck-xyz', plateNumber: 'XYZ-9999' });
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.error?.includes('Mismatched Vehicle'));
});

test('verifyFleetInventoryQr rejects personal Driver Login badges', () => {
  const driverBadgeJson = JSON.stringify({
    app: 'TrashTrack',
    type: 'driver_login',
    role: 'driver',
    uid: 'drv-1',
    qrLoginToken: 'tok-123',
    plateNumber: 'ABC-1111',
  });

  const result = verifyFleetInventoryQr(driverBadgeJson, { id: 'truck-abc', plateNumber: 'ABC-1111' });
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('personal Driver Login badge'));
});
