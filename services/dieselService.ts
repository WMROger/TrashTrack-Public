import { auth, db } from '@/config/firebase';
import { collection, doc, getDoc, getDocs, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { calculateDiesel, DEMO_DIESEL_PARAMETERS, DieselActual, DieselGpsPoint, DieselModel, DieselParameters, DieselPlan, dieselParameterSignature, summarizeDieselGps, trainDieselModel, validateDieselParameters } from './dieselMath';

export type DieselSettings = { parameters: DieselParameters; priceDate: string; priceSource: string; parameterSource: string; profiles: Record<string, Omit<DieselParameters, 'pricePerLiter'>> };
export const DEFAULT_DIESEL_SETTINGS: DieselSettings = { parameters: DEMO_DIESEL_PARAMETERS, priceDate: '', priceSource: 'CENRO supply', parameterSource: 'Demonstration assumptions', profiles: {} };
export type DieselSchedule = {
  id: string; assignedDriverId: string; truckId: string; barangay: string; driver?: string;
  driverName?: string; assignedDriverName?: string; truckPlate?: string;
  dateText?: string; status?: string; street?: string; isLiveDispatch?: boolean; dieselClosedAt?: unknown;
  actualDistanceKm?: number; actualFuelLiters?: number; durationMinutes?: number; pickupsCompleted?: number;
  completedAt?: unknown; createdAt?: unknown;
  routeOptimization?: { baselineDistanceKm?: number; optimizedDistanceKm?: number; baselineDurationMins?: number;
    optimizedDurationMins?: number; dieselEstimate?: DieselPlan; stopCount?: number; distanceSource?: string; lastReplannedAt?: string };
  stops?: { type?: string }[];
  collectionMeasurement?: { value: number; unit: string };
};
export type DieselLog = { id: string; scheduleId: string; driverId: string; truckId: string; barangay: string;
  actual: DieselActual; status: 'pending' | 'approved' | 'needs-correction'; submittedBy: string;
  reviewedBy: string | null; reviewNote: string; submittedAt: unknown; reviewedAt: unknown };
export function getDefaultParametersForTruckType(
  type?: string,
  capacity?: string | number,
  baseParams: DieselParameters = DEMO_DIESEL_PARAMETERS
): DieselParameters {
  const normType = (type || '').toLowerCase().trim();
  const capTons = typeof capacity === 'number' ? capacity : parseFloat(String(capacity || '5').replace(/[^0-9.]/g, '')) || 5;

  let kmPerLiter = baseParams.kmPerLiter || 3.0;
  let collectionLitersPerHour = baseParams.collectionLitersPerHour || 2.0;
  let idleLitersPerHour = baseParams.idleLitersPerHour || 1.0;
  let fullLoadPenaltyPercent = baseParams.fullLoadPenaltyPercent || 20;

  if (normType.includes('mini')) {
    // Mini-Dump: lighter 4-wheel chassis (2-5 tons), smaller 3.0-4.0L diesel engine (~4.2 km/L)
    kmPerLiter = 4.2;
    collectionLitersPerHour = 1.4;
    idleLitersPerHour = 0.8;
    fullLoadPenaltyPercent = 18;
  } else if (normType.includes('compactor')) {
    // Heavy Compactor: continuous hydraulic packer blade on PTO, heavier chassis (~2.2 km/L)
    kmPerLiter = 2.2;
    collectionLitersPerHour = 3.5;
    idleLitersPerHour = 1.4;
    fullLoadPenaltyPercent = 25;
  } else if (normType.includes('dump')) {
    // Standard Dump Truck (4-10 tons, 6-wheeler): heavier chassis, 6-cylinder engine (~3.0 km/L)
    kmPerLiter = 3.0;
    collectionLitersPerHour = 2.2;
    idleLitersPerHour = 1.2;
    fullLoadPenaltyPercent = 20;
  }

  // Scale slightly for capacity tonnage
  if (capTons > 5) {
    fullLoadPenaltyPercent = Math.min(30, fullLoadPenaltyPercent + (capTons - 5) * 1.5);
  } else if (capTons < 5) {
    fullLoadPenaltyPercent = Math.max(12, fullLoadPenaltyPercent - (5 - capTons) * 1.5);
  }

  return {
    ...baseParams,
    kmPerLiter,
    collectionLitersPerHour,
    idleLitersPerHour,
    fullLoadPenaltyPercent,
  };
}

export const parametersForTruck = (
  settings: DieselSettings,
  truckId?: string,
  truckSpecs?: { type?: string; capacity?: string | number }
): DieselParameters => {
  if (truckId && settings.profiles[truckId]) {
    return {
      ...settings.parameters,
      ...settings.profiles[truckId],
      pricePerLiter: settings.parameters.pricePerLiter,
    };
  }

  const derived = getDefaultParametersForTruckType(truckSpecs?.type, truckSpecs?.capacity, settings.parameters);
  return {
    ...derived,
    pricePerLiter: settings.parameters.pricePerLiter,
  };
};
const validDate = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text + 'T00:00:00Z'))
  && new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text;
export async function readDieselSettings(): Promise<DieselSettings> {
  const snap = await getDoc(doc(db, 'diesel_settings', 'main'));
  if (!snap.exists()) return DEFAULT_DIESEL_SETTINGS;
  return { ...DEFAULT_DIESEL_SETTINGS, ...snap.data(), parameters: { ...DEMO_DIESEL_PARAMETERS, ...snap.data().parameters } } as DieselSettings;
}
export async function saveDieselSettings(settings: DieselSettings) {
  validateDieselParameters(settings.parameters);
  Object.values(settings.profiles).forEach(profile => validateDieselParameters({ ...profile, pricePerLiter: settings.parameters.pricePerLiter }));
  if (settings.parameters.pricePerLiter <= 0 || !validDate(settings.priceDate) || !settings.priceSource.trim()) throw new Error('Enter a positive supply price, valid effective date (YYYY-MM-DD), and source.');
  if (!settings.parameterSource.trim()) throw new Error('Describe the source of the truck parameters or label them as demonstration assumptions.');
  await setDoc(doc(db, 'diesel_settings', 'main'), { ...settings, updatedBy: auth.currentUser?.uid, updatedAt: serverTimestamp() });
}
export function makeDieselPlan(baselineKm: number, optimizedKm: number, stops: number, p: DieselParameters, source = 'Demonstration assumptions'): DieselPlan {
  const inputs = (distanceKm: number) => ({ distanceKm, drivingHours: distanceKm / 20,
    idleHours: 0, collectionHours: stops * p.minutesPerStop / 60, averageLoadPercent: p.averageLoadPercent });
  const baselineInputs = inputs(baselineKm), optimizedInputs = inputs(optimizedKm);
  return { version: 1, savedAt: new Date().toISOString(), parameters: p, parameterSource: source,
    distanceSource: 'Demo route; straight-line distance between stops', baselineInputs, optimizedInputs,
    baseline: calculateDiesel(baselineInputs, p), optimized: calculateDiesel(optimizedInputs, p), modelId: null };
}
export async function dieselContext(truckId?: string) {
  const settings = await readDieselSettings();
  const parameters = parametersForTruck(settings, truckId);
  const modelSnapshot = truckId ? await getDoc(doc(db, 'diesel_models', truckId)) : null;
  const model = modelSnapshot?.exists() ? modelSnapshot.data() as DieselModel : null;
  const factor = applicableDieselFactor(model, parameters);
  return { settings, parameters, factor, modelId: factor !== 1 ? model?.id || null : null,
    source: settings.parameterSource + '; ' + settings.priceSource + '; price effective ' + (settings.priceDate || 'not configured') };
}
export async function saveDieselPlan(schedule: DieselSchedule, plan: DieselPlan) {
  const ref = doc(db, 'diesel_estimates', schedule.id);
  await runTransaction(db, async transaction => {
    if ((await transaction.get(ref)).exists()) throw new Error('An estimate is already saved for this trip. It is preserved for comparison.');
    transaction.set(ref, { scheduleId: schedule.id, driverId: schedule.assignedDriverId, truckId: schedule.truckId,
      barangay: schedule.barangay, plan, createdBy: auth.currentUser?.uid, createdAt: serverTimestamp() });
  });
}
export function validateDieselActual(actual: DieselActual) {
  const { distanceKm, drivingHours, idleHours, collectionHours, averageLoadPercent, collectedKg } = actual;
  calculateDiesel({ distanceKm, drivingHours, idleHours, collectionHours, averageLoadPercent }, DEMO_DIESEL_PARAMETERS);
  if (!Number.isFinite(collectedKg) || collectedKg < 0 || collectedKg > 100000) throw new Error('Collected weight must be between 0 and 100,000 kg.');
  if (distanceKm > 2000 || drivingHours + idleHours + collectionHours <= 0 || drivingHours + idleHours + collectionHours > 24) throw new Error('Enter a trip distance up to 2,000 km and total operating time greater than 0 and at most 24 hours.');
  if (!validDate(actual.tripDate)) throw new Error('Enter a valid trip date as YYYY-MM-DD.');
  if (actual.tripDate > new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })) throw new Error('Actual trips cannot be dated in the future.');
  if (actual.actualLiters !== null && (!Number.isFinite(actual.actualLiters) || actual.actualLiters <= 0 || actual.actualLiters > 2000)) throw new Error('Measured consumption must be greater than 0 and at most 2,000 L, or left blank.');
  if ((actual.actualLiters === null) !== (actual.fuelMethod === 'not-recorded')) throw new Error('Select how fuel was measured, or leave liters blank and choose Not recorded.');
  if (actual.actualLiters !== null && !actual.evidence.trim()) throw new Error('Describe the fuel measurement or reference the trip log. Fuel issued alone is not consumption.');
}
export async function submitDieselActual(schedule: DieselSchedule, actual: DieselActual) {
  const actualLiters = actual.actualLiters != null && actual.actualLiters > 0 ? actual.actualLiters : null;
  const fuelMethod = actualLiters != null
    ? ((actual.fuelMethod as string) === 'dispenser' || actual.fuelMethod === 'not-recorded' ? 'metered' : actual.fuelMethod)
    : 'not-recorded';
  const evidence = actual.evidence?.trim()
    ? actual.evidence.trim()
    : 'Telemetry shift log recorded for collection run.';
  const normalizedActual: DieselActual = {
    ...actual,
    actualLiters,
    fuelMethod: fuelMethod as DieselActual['fuelMethod'],
    evidence,
  };
  validateDieselActual(normalizedActual);
  const ref = doc(db, 'diesel_logs', schedule.id);
  await runTransaction(db, async transaction => {
    const existing = await transaction.get(ref);
    if (existing.exists() && existing.data().status === 'approved') throw new Error('CENRO has approved this trip. Its measurements are locked.');
    transaction.set(ref, {
      scheduleId: schedule.id,
      driverId: schedule.assignedDriverId || (schedule as any).driverId || '',
      truckId: schedule.truckId || (schedule as any).truckPlate || '',
      barangay: schedule.barangay || '',
      actual: normalizedActual,
      status: 'pending',
      submittedBy: auth.currentUser?.uid,
      submittedAt: serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: '',
    }, { merge: true });
  });
}
export async function reviewDieselLog(id: string, status: 'approved' | 'needs-correction', note: string) {
  if (!note.trim()) throw new Error('Enter a review note describing the checks or corrections needed.');
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'diesel_logs', id), snap = await transaction.get(ref);
    if (!snap.exists() || snap.data().status !== 'pending') throw new Error('Only pending submissions can be reviewed.');
    transaction.update(ref, { status, reviewNote: note.trim(), reviewedBy: auth.currentUser?.uid, reviewedAt: serverTimestamp() });
  });
}
export async function loadDieselGps(schedule: DieselSchedule) {
  const snapshot = await getDocs(query(collection(db, 'diesel_gps', schedule.id, 'points'), orderBy('timestampMs')));
  return summarizeDieselGps(snapshot.docs.map(point => point.data() as DieselGpsPoint));
}
export async function trainTruckDiesel(truckId: string, p: DieselParameters): Promise<DieselModel> {
  const snapshot = await getDocs(query(collection(db, 'diesel_logs'), where('truckId', '==', truckId)));
  const model = trainDieselModel(snapshot.docs.map(s => ({ id: s.id, ...s.data() } as DieselLog)), truckId, p);
  await setDoc(doc(db, 'diesel_models', truckId), { ...model, trainedBy: auth.currentUser?.uid, updatedAt: serverTimestamp() });
  return model;
}
export async function closeDieselTripsForShift(driverId: string, truckId?: string) {
  const snapshot = await getDocs(query(collection(db, 'schedules'), where('assignedDriverId', '==', driverId)));
  const trips = snapshot.docs.filter(item => item.data().isLiveDispatch && !item.data().dieselClosedAt
    && (!truckId || item.data().truckId === truckId));
  await Promise.all(trips.map(item => updateDoc(item.ref, { dieselClosedAt: serverTimestamp() })));
}
export function applicableDieselFactor(model: DieselModel | null, parameters: DieselParameters) {
  return model?.status === 'validated' && model.parameterSignature === dieselParameterSignature(parameters) ? model.factor : 1;
}
