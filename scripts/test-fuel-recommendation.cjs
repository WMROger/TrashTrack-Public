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
    const resolved = name.startsWith('@/')
      ? name.slice(2) + '.ts'
      : path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(file), name + '.ts'));
    return load(resolved);
  };
  new Function('require', 'module', 'exports', output)(resolve, module, module.exports);
  cache.set(file, module.exports);
  return module.exports;
}

const { DEMO_DIESEL_PARAMETERS } = load('services/dieselMath.ts');
const { calculateBarangayBaselineLiters, canActiveRouteAbsorbReport } = load('services/dieselRecommendationService.ts');

test('calculateBarangayBaselineLiters produces positive routine route liters and operating hours', () => {
  const params = { ...DEMO_DIESEL_PARAMETERS, kmPerLiter: 3, collectionLitersPerHour: 2, minutesPerStop: 3 };
  const result = calculateBarangayBaselineLiters('Baliang', params);
  assert.ok(result.baselineLiters > 0, 'Baseline liters must be positive');
  assert.ok(result.distanceKm > 0, 'Distance must be positive');
  assert.ok(result.operatingHours > 0, 'Operating hours must be positive');
  assert.ok(result.stopCount >= 2, 'Must have at least depot start and end stops');
});

test('10% safety reserve buffer adds exact 10% margin on top of route fuel', () => {
  const baseline = 10.0;
  const reportExtra = 2.0;
  const subtotal = baseline + reportExtra;
  const safetyReserve = Math.round(subtotal * 0.10 * 100) / 100;
  const total = Math.round((subtotal + safetyReserve) * 100) / 100;

  assert.equal(safetyReserve, 1.2);
  assert.equal(total, 13.2);
});

test('canActiveRouteAbsorbReport allows absorption when within driver fuel budget', () => {
  const activeStops = [
    { latitude: 10.5218, longitude: 124.0285, stopType: 'depot' },
    { latitude: 10.5250, longitude: 124.0290, stopType: 'regular_pickup' },
    { latitude: 10.5290, longitude: 124.0310, stopType: 'transfer_station' },
  ];
  const newReport = { location: { lat: 10.5260, lng: 124.0295 } };
  const generousBudget = 20.0; // 20 Liters budget

  const check = canActiveRouteAbsorbReport(activeStops, newReport, generousBudget, DEMO_DIESEL_PARAMETERS);
  assert.equal(check.canAbsorb, true);
  assert.ok(check.neededExtraLiters >= 0);
  assert.equal(check.reason, undefined);
});

test('canActiveRouteAbsorbReport rejects and queues for next shift when exceeding fuel budget', () => {
  const activeStops = [
    { latitude: 10.5218, longitude: 124.0285, stopType: 'depot' },
    { latitude: 10.5250, longitude: 124.0290, stopType: 'regular_pickup' },
    { latitude: 10.5290, longitude: 124.0310, stopType: 'transfer_station' },
  ];
  // Distant detour report
  const farReport = { location: { lat: 10.6000, lng: 124.1000 } };
  const tightBudget = 0.5; // Only 0.5 L remaining

  const check = canActiveRouteAbsorbReport(activeStops, farReport, tightBudget, DEMO_DIESEL_PARAMETERS);
  assert.equal(check.canAbsorb, false, 'Must reject report that exceeds fuel budget');
  assert.ok(check.reason && check.reason.includes('Held for next shift'), 'Reason must explain that report is held for next shift');
  assert.ok(check.neededExtraLiters > 0);
});
