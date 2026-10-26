const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('../../node_modules/typescript');
const { assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } = require('firebase/firestore');

test('Diesel module authorizes operators, validates measurements and preserves reviewed records', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  const environment = await initializeTestEnvironment({ projectId: 'diesel-rules-test', firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8') } });
  t.after(() => environment.cleanup());
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [id, role, barangay] of [['admin', 'cenro', ''], ['driver', 'driver', ''], ['other-driver', 'driver', ''], ['coord', 'coordinator', 'Poblacion'], ['other-coord', 'coordinator', 'Suba'], ['resident', 'user', '']]) {
      await setDoc(doc(db, 'users', id), { uid: id, role, assignedBarangay: barangay, status: 'active', disabled: false });
    }
    await setDoc(doc(db, 'schedules', 'trip-1'), { assignedDriverId: 'driver', truckId: 'truck-1', barangay: 'Poblacion', status: 'in_progress', isLiveDispatch: true });
  });
  const dbFor = id => environment.authenticatedContext(id).firestore();
  const admin = dbFor('admin'), driver = dbFor('driver'), coord = dbFor('coord'), other = dbFor('other-driver'), otherCoord = dbFor('other-coord'), resident = dbFor('resident');
  const identity = { scheduleId: 'trip-1', truckId: 'truck-1', driverId: 'driver', barangay: 'Poblacion' };
  const actual = { distanceKm: 20, drivingHours: 2, idleHours: 0.5, collectionHours: 1, averageLoadPercent: 50, collectedKg: 1000,
    actualLiters: 8, fuelMethod: 'tank-balance', distanceSource: 'odometer', evidence: 'Tank readings checked', isDemo: false, tripDate: '2026-09-01' };
  const submission = (by = 'driver') => ({ ...identity, actual, status: 'pending', submittedBy: by, submittedAt: serverTimestamp(), reviewedBy: null, reviewedAt: null, reviewNote: '' });
  await t.test('CENRO alone edits supply price and learned models', async () => {
    const settings = { parameters: { pricePerLiter: 50, kmPerLiter: 3 }, updatedAt: serverTimestamp(), updatedBy: 'admin' };
    await assertSucceeds(setDoc(doc(admin, 'diesel_settings', 'main'), settings));
    await assertSucceeds(getDoc(doc(driver, 'diesel_settings', 'main')));
    await assertFails(getDoc(doc(resident, 'diesel_settings', 'main')));
    await assertFails(setDoc(doc(coord, 'diesel_settings', 'main'), { ...settings, updatedBy: 'coord' }));
    await assertFails(setDoc(doc(driver, 'diesel_models', 'truck-1'), { truckId: 'truck-1', factor: 1.1, trainedBy: 'driver', updatedAt: serverTimestamp() }));
  });
  await t.test('drivers and coordinators can read only their assigned trip data', async () => {
    await assertSucceeds(getDoc(doc(driver, 'diesel_logs', 'trip-1')));
    await assertSucceeds(getDoc(doc(coord, 'diesel_logs', 'trip-1')));
    await assertFails(getDoc(doc(other, 'diesel_logs', 'trip-1')));
    await assertFails(getDoc(doc(otherCoord, 'diesel_logs', 'trip-1')));
    await assertSucceeds(getDocs(query(collection(coord, 'schedules'), where('barangay', '==', 'Poblacion'))));
    await assertFails(getDocs(query(collection(otherCoord, 'schedules'), where('barangay', '==', 'Poblacion'))));
  });
  await t.test('invalid fuel, cross-driver submission and self-approval are denied', async () => {
    await assertFails(setDoc(doc(driver, 'diesel_logs', 'trip-1'), { ...submission(), actual: { ...actual, actualLiters: -1 } }));
    await assertFails(setDoc(doc(driver, 'diesel_logs', 'trip-1'), { ...submission(), actual: { ...actual, actualLiters: null } }));
    await assertFails(setDoc(doc(driver, 'diesel_logs', 'trip-1'), { ...submission(), actual: { ...actual, collectionHours: 24 } }));
    await assertFails(setDoc(doc(other, 'diesel_logs', 'trip-1'), submission('other-driver')));
    await assertFails(setDoc(doc(coord, 'diesel_logs', 'trip-1'), { ...submission('coord'), barangay: 'Suba' }));
    await assertFails(setDoc(doc(driver, 'diesel_logs', 'trip-1'), { ...submission(), status: 'approved' }));
    await assertSucceeds(setDoc(doc(driver, 'diesel_logs', 'trip-1'), submission()));
    await assertSucceeds(getDocs(query(collection(driver, 'diesel_logs'), where('driverId', '==', 'driver'))));
    await assertSucceeds(getDocs(query(collection(coord, 'diesel_logs'), where('barangay', '==', 'Poblacion'))));
    await assertFails(getDocs(collection(driver, 'diesel_logs')));
  });
  await t.test('coordinator may correct pending entry; only CENRO reviews and approved actuals are locked', async () => {
    await assertSucceeds(setDoc(doc(coord, 'diesel_logs', 'trip-1'), submission('coord')));
    const review = { status: 'approved', reviewedBy: 'admin', reviewedAt: serverTimestamp(), reviewNote: 'Verified tank balance and odometer log' };
    await assertFails(updateDoc(doc(coord, 'diesel_logs', 'trip-1'), { ...review, reviewedBy: 'coord' }));
    await assertSucceeds(updateDoc(doc(admin, 'diesel_logs', 'trip-1'), review));
    await assertFails(setDoc(doc(driver, 'diesel_logs', 'trip-1'), submission()));
    await assertFails(updateDoc(doc(admin, 'diesel_logs', 'trip-1'), { 'actual.actualLiters': 99 }));
  });
  await t.test('saved estimates and GPS points are immutable; simulator data cannot be added as real GPS', async () => {
    const estimate = { ...identity, plan: { version: 1 }, createdBy: 'admin', createdAt: serverTimestamp() };
    await assertSucceeds(getDoc(doc(admin, 'diesel_estimates', 'trip-1')));
    await assertSucceeds(setDoc(doc(admin, 'diesel_estimates', 'trip-1'), estimate));
    await assertFails(setDoc(doc(admin, 'diesel_estimates', 'trip-1'), estimate));
    await assertSucceeds(getDocs(query(collection(driver, 'diesel_estimates'), where('driverId', '==', 'driver'))));
    const point = { latitude: 10.52, longitude: 124.03, timestampMs: Date.now(), accuracyMeters: 5, isSimulation: false, driverId: 'driver', createdAt: serverTimestamp() };
    await assertFails(setDoc(doc(other, 'diesel_gps', 'trip-1', 'points', 'point-1'), point));
    await assertFails(setDoc(doc(driver, 'diesel_gps', 'trip-1', 'points', 'point-1'), { ...point, isSimulation: true }));
    await assertSucceeds(setDoc(doc(driver, 'diesel_gps', 'trip-1', 'points', 'point-1'), point));
    await assertFails(updateDoc(doc(driver, 'diesel_gps', 'trip-1', 'points', 'point-1'), { latitude: 11 }));
    await assertSucceeds(getDocs(collection(coord, 'diesel_gps', 'trip-1', 'points')));
    await assertFails(getDocs(collection(otherCoord, 'diesel_gps', 'trip-1', 'points')));
  });
  await t.test('ending a shift closes its fuel trip without completing pickups or allowing a forged timestamp', async () => {
    await assertFails(updateDoc(doc(driver, 'schedules', 'trip-1'), { dieselClosedAt: 'yesterday' }));
    await assertSucceeds(updateDoc(doc(driver, 'schedules', 'trip-1'), { dieselClosedAt: serverTimestamp() }));
    const closed = (await getDoc(doc(driver, 'schedules', 'trip-1'))).data();
    assert.ok(closed.dieselClosedAt); assert.equal(closed.status, 'in_progress');
  });
  await t.test('application service saves snapshots and submits, reviews and trains through real transactions', async () => {
    const loadService = (db, uid) => {
      const load = name => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../services', name + '.ts'), 'utf8');
        const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
        const module = { exports: {} };
        new Function('require', 'module', 'exports', compiled)(id => id === '@/config/firebase' ? { db, auth: { currentUser: { uid } } }
          : id === 'firebase/firestore' ? require(id) : load(id.replace('./', '')), module, module.exports);
        return module.exports;
      };
      return load('dieselService');
    };
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'schedules', 'trip-2'), {
      assignedDriverId: 'driver', truckId: 'truck-1', barangay: 'Poblacion', status: 'in_progress', isLiveDispatch: true,
    }));
    const managerService = loadService(admin, 'admin'), driverService = loadService(driver, 'driver');
    const params = { pricePerLiter: 50, kmPerLiter: 4, idleLitersPerHour: 1, collectionLitersPerHour: 2, fullLoadPenaltyPercent: 20, averageLoadPercent: 50, minutesPerStop: 3 };
    const schedule = { id: 'trip-2', assignedDriverId: 'driver', truckId: 'truck-1', barangay: 'Poblacion' };
    await managerService.saveDieselSettings({ parameters: params, priceDate: '2026-09-01', priceSource: 'CENRO batch 1', parameterSource: 'Demo assumptions', profiles: {} });
    const plan = managerService.makeDieselPlan(30, 20, 8, params);
    await managerService.saveDieselPlan(schedule, plan);
    await assert.rejects(managerService.saveDieselPlan(schedule, plan), /already saved/);
    await driverService.submitDieselActual(schedule, actual);
    await managerService.reviewDieselLog('trip-2', 'approved', 'Verified trip readings');
    await assert.rejects(driverService.submitDieselActual(schedule, actual), /approved/);
    const model = await managerService.trainTruckDiesel('truck-1', params);
    assert.equal(model.status, 'waiting'); assert.equal(model.sampleCount, 2);
    const estimate = (await getDoc(doc(admin, 'diesel_estimates', 'trip-2'))).data();
    assert.equal(estimate.plan.parameters.pricePerLiter, 50);
  });
});
