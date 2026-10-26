const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(relative) {
  const file = path.resolve(__dirname, '..', relative);
  if (cache.has(file)) return cache.get(file);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  const resolve = name => {
    if (name === 'react-native') return { Platform: { OS: 'web' }, Share: {} };
    if (!name.startsWith('.') && !name.startsWith('@/')) {
      try { return require(name); } catch { return {}; }
    }
    const resolved = name.startsWith('@/') ? name.slice(2) + '.ts' : path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(file), name + '.ts'));
    return load(resolved);
  };
  new Function('require', 'module', 'exports', output)(resolve, module, module.exports);
  cache.set(file, module.exports); return module.exports;
}
const { calculateDiesel, dieselSavings, DEMO_DIESEL_PARAMETERS: defaults, trainDieselModel, dieselParameterSignature, summarizeDieselGps } = load('services/dieselMath.ts');
const { optimizeBarangayRouteWithTraffic } = load('services/trafficAwareOptimizerService.ts');
const { csvCell, dieselReportRows, printDieselReport } = load('services/dieselReports.ts');
const parameters = { ...defaults, pricePerLiter: 50, kmPerLiter: 4, idleLitersPerHour: 1, collectionLitersPerHour: 2, fullLoadPenaltyPercent: 20 };
const inputs = { distanceKm: 40, drivingHours: 2, idleHours: 1, collectionHours: 1.5, averageLoadPercent: 50 };
test('fuel components use distinct hours, partial load, supply price, and signed savings', () => {
  const result = calculateDiesel(inputs, parameters);
  assert.equal(result.drivingLiters, 11);
  assert.equal(result.idleLiters, 1);
  assert.equal(result.collectionLiters, 3);
  assert.equal(result.liters, 15);
  assert.equal(result.cost, 750);
  assert.equal(result.operatingHours, 4.5);
  assert.equal(calculateDiesel({ ...inputs, drivingHours: 8 }, parameters).liters, 15, 'do not count driving fuel again as hourly fuel');
  const worse = calculateDiesel({ ...inputs, distanceKm: 80 }, parameters);
  assert.equal(dieselSavings(result, worse).liters, -11);
  assert.equal(dieselSavings(result, worse).cost, -550);
  assert.equal(dieselSavings(result, result).liters, 0);
});
test('unset price is unknown, invalid parameters and nonfinite inputs are rejected', () => {
  assert.equal(calculateDiesel(inputs, { ...parameters, pricePerLiter: 0 }).cost, null);
  assert.throws(() => calculateDiesel(inputs, { ...parameters, kmPerLiter: 0 }));
  assert.throws(() => calculateDiesel({ ...inputs, distanceKm: NaN }, parameters));
  assert.throws(() => calculateDiesel({ ...inputs, averageLoadPercent: 101 }, parameters));
  assert.throws(() => calculateDiesel(inputs, parameters, Infinity));
});
test('optimizer uses one physical truck model and preserves a calculation snapshot', () => {
  const first = optimizeBarangayRouteWithTraffic('Poblacion', [], parameters);
  const changedPrice = optimizeBarangayRouteWithTraffic('Poblacion', [], { ...parameters, pricePerLiter: 100 });
  assert.equal(first.baselineFuelLiters, Math.round(first.dieselEstimate.baseline.liters * 100) / 100);
  assert.equal(changedPrice.optimizedFuelLiters, first.optimizedFuelLiters);
  assert.ok(Math.abs(changedPrice.fuelCostSavedPhp - first.fuelCostSavedPhp * 2) < 0.02);
  assert.equal(first.dieselEstimate.parameters.pricePerLiter, 50);
  assert.equal(first.dieselEstimate.baselineInputs.collectionHours, first.dieselEstimate.optimizedInputs.collectionHours);
});
function trainingRows(multiplier = 1.25) {
  return Array.from({ length: 16 }, (_, index) => {
    const actualInputs = { ...inputs, distanceKm: 30 + index };
    return { id: 'trip-' + index, truckId: 'truck-1', status: 'approved', actual: {
      ...actualInputs, actualLiters: calculateDiesel(actualInputs, parameters).liters * multiplier, collectedKg: 1000,
      fuelMethod: 'tank-balance', evidence: 'Start + added - end readings checked', isDemo: false,
      distanceSource: 'odometer', tripDate: '2026-08-' + String(index + 1).padStart(2, '0'),
    } };
  });
}
test('learning fits real measurements and evaluates later dates without price leakage', () => {
  const rows = trainingRows(), model = trainDieselModel(rows, 'truck-1', parameters);
  assert.equal(model.status, 'validated');
  assert.equal(model.trainingCount, 12); assert.equal(model.validationCount, 4);
  assert.ok(Math.abs(model.factor - 1.25) < 1e-9); assert.ok(model.candidateMae < 1e-8);
  assert.equal(dieselParameterSignature(parameters), dieselParameterSignature({ ...parameters, pricePerLiter: 100 }));
  assert.notEqual(dieselParameterSignature(parameters), dieselParameterSignature({ ...parameters, kmPerLiter: 2 }));
  assert.equal(trainDieselModel(rows, 'other-truck', parameters).status, 'waiting');
});
test('demo, missing fuel, manual distances, pending and same-day records cannot promote a model', () => {
  for (const transform of [
    row => ({ ...row, status: 'pending' }),
    row => ({ ...row, actual: { ...row.actual, isDemo: true } }),
    row => ({ ...row, actual: { ...row.actual, actualLiters: null } }),
    row => ({ ...row, actual: { ...row.actual, distanceSource: 'manual' } }),
    row => ({ ...row, actual: { ...row.actual, evidence: '' } }),
    row => ({ ...row, actual: { ...row.actual, tripDate: '2026-08-01' } }),
  ]) assert.equal(trainDieselModel(trainingRows().map(transform), 'truck-1', parameters).status, 'waiting');
});
test('a learned adjustment that is worse on future trips is rejected', () => {
  const rows = trainingRows();
  rows.slice(12).forEach(row => { row.actual.actualLiters = calculateDiesel(inputs, parameters).liters; });
  const model = trainDieselModel(rows, 'truck-1', parameters);
  assert.equal(model.status, 'baseline-retained'); assert.equal(model.factor, 1);
});
test('GPS ignores simulator points, poor accuracy, implausible jumps and missing sections', () => {
  const point = (latitude, timestampMs, rest = {}) => ({ latitude, longitude: 124.03, timestampMs, accuracyMeters: 5, isSimulation: false, ...rest });
  const real = [point(10.52, 0), point(10.521, 20000), point(10.522, 40000)];
  const summary = summarizeDieselGps(real);
  assert.ok(summary.distanceKm >= 0.21 && summary.distanceKm <= 0.23);
  assert.equal(summarizeDieselGps(real.map(p => ({ ...p, isSimulation: true }))).distanceKm, 0);
  assert.equal(summarizeDieselGps([point(10.52, 0), point(10.53, 600000)]).gaps, 1);
  assert.equal(summarizeDieselGps([point(10.52, 0), point(11, 1000)]).distanceKm, 0);
  assert.equal(summarizeDieselGps([point(10.52, 0), point(10.521, 20000, { accuracyMeters: 90 }), point(10.522, 40000)]).distanceKm, 0);
});
test('CSV blocks spreadsheet formulas and leaves missing actual readings explicit', () => {
  assert.equal(csvCell('=HYPERLINK("malicious")'), '"\'=HYPERLINK(""malicious"")"');
  assert.equal(csvCell(' text, "quoted"'), '" text, ""quoted"""');
  const rows = dieselReportRows([{ id: 'trip-1', truckId: 't', assignedDriverId: 'd', barangay: 'Poblacion' }], [], {});
  assert.equal(rows[0][14], 'Not recorded'); assert.equal(rows[0][15], 'Not recorded');
});
test('print report includes saved assumptions and escapes operator text', () => {
  let html = '', printed = false;
  global.window = { open: () => ({ document: { write: text => { html = text; }, close() {} }, focus() {}, print() { printed = true; } }) };
  const plan = optimizeBarangayRouteWithTraffic('Poblacion', [], parameters).dieselEstimate;
  printDieselReport([{ id: 'trip-1', truckId: 'truck-1', assignedDriverId: 'driver', barangay: '<script>bad()</script>' }], [], { 'trip-1': plan });
  assert.ok(printed); assert.ok(html.includes('Driving liters = distance'));
  assert.ok(html.includes('PHP 50.00')); assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>bad()'));
  delete global.window;
});
