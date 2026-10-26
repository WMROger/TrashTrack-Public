/** Transparent planning model. Defaults are demonstration assumptions, not measured truck specifications. */
export type DieselParameters = {
  pricePerLiter: number;
  kmPerLiter: number;
  idleLitersPerHour: number;
  collectionLitersPerHour: number;
  fullLoadPenaltyPercent: number;
  averageLoadPercent: number;
  minutesPerStop: number;
};
export const DEMO_DIESEL_PARAMETERS: DieselParameters = {
  pricePerLiter: 0, kmPerLiter: 3, idleLitersPerHour: 1,
  collectionLitersPerHour: 2, fullLoadPenaltyPercent: 20,
  averageLoadPercent: 50, minutesPerStop: 3,
};
export type DieselInputs = { distanceKm: number; drivingHours: number; idleHours: number; collectionHours: number; averageLoadPercent: number };
export type DieselCalculation = {
  drivingLiters: number; idleLiters: number; collectionLiters: number;
  baseLiters: number; liters: number; cost: number | null; operatingHours: number; factor: number;
};
export const roundDiesel = (n: number) => Math.round(n * 100) / 100;
export function validateDieselParameters(p: DieselParameters) {
  for (const [key, value] of Object.entries(p)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a non-negative number.`);
  }
  if (p.kmPerLiter <= 0 || p.kmPerLiter > 30) throw new Error('Fuel efficiency must be greater than 0 and at most 30 km/L.');
  if (p.averageLoadPercent > 100 || p.fullLoadPenaltyPercent > 100) throw new Error('Load and load penalty must be between 0 and 100%.');
  if (p.pricePerLiter > 1000 || p.idleLitersPerHour > 100 || p.collectionLitersPerHour > 100 || p.minutesPerStop > 120) throw new Error('A diesel parameter exceeds its supported range.');
}
export function calculateDiesel(inputs: DieselInputs, p: DieselParameters, factor = 1): DieselCalculation {
  validateDieselParameters(p);
  for (const value of Object.values(inputs)) if (!Number.isFinite(value) || value < 0) throw new Error('Distance, hours, and load must be non-negative numbers.');
  if (inputs.averageLoadPercent > 100 || !Number.isFinite(factor) || factor < 0.5 || factor > 2) throw new Error('Invalid load or learned adjustment.');
  const drivingLiters = inputs.distanceKm / p.kmPerLiter * (1 + p.fullLoadPenaltyPercent / 100 * inputs.averageLoadPercent / 100);
  const idleLiters = inputs.idleHours * p.idleLitersPerHour;
  const collectionLiters = inputs.collectionHours * p.collectionLitersPerHour;
  const baseLiters = drivingLiters + idleLiters + collectionLiters;
  const liters = baseLiters * factor;
  return { drivingLiters, idleLiters, collectionLiters, baseLiters, liters,
    cost: p.pricePerLiter > 0 ? liters * p.pricePerLiter : null,
    operatingHours: inputs.drivingHours + inputs.idleHours + inputs.collectionHours, factor };
}
export function dieselSavings(baseline: DieselCalculation, optimized: DieselCalculation) {
  const liters = baseline.liters - optimized.liters;
  return { liters, percent: baseline.liters > 0 ? liters / baseline.liters * 100 : null,
    cost: baseline.cost === null || optimized.cost === null ? null : baseline.cost - optimized.cost };
}
export type DieselPlan = {
  version: 1; savedAt: string; parameters: DieselParameters; parameterSource: string;
  distanceSource: string; baselineInputs: DieselInputs; optimizedInputs: DieselInputs;
  baseline: DieselCalculation; optimized: DieselCalculation; modelId: string | null;
};
export type DieselActual = DieselInputs & {
  collectedKg: number; actualLiters: number | null; distanceSource: 'gps' | 'odometer' | 'manual';
  fuelMethod: 'not-recorded' | 'tank-balance' | 'full-to-full' | 'metered';
  evidence: string; isDemo: boolean; tripDate: string;
};
export type TrainingRow = { id: string; truckId: string; status: string; actual: DieselActual };
export type DieselModel = {
  id: string; truckId: string; trainedAt: string; factor: number; candidateFactor: number;
  sampleCount: number; trainingCount: number; validationCount: number; baselineMae: number | null;
  candidateMae: number | null; status: 'waiting' | 'validated' | 'baseline-retained'; recordIds: string[];
  parameterSignature: string;
};
// Price does not affect liters. A change to physical truck assumptions invalidates the learned correction.
export const dieselParameterSignature = (p: DieselParameters) => JSON.stringify([p.kmPerLiter, p.idleLitersPerHour, p.collectionLitersPerHour, p.fullLoadPenaltyPercent]);
export function trainDieselModel(rows: TrainingRow[], truckId: string, p: DieselParameters): DieselModel {
  const samples = rows.filter(r => r.truckId === truckId && r.status === 'approved' && !r.actual.isDemo
    && r.actual.actualLiters !== null && r.actual.actualLiters > 0 && r.actual.fuelMethod !== 'not-recorded'
    && r.actual.evidence.trim().length > 0 && r.actual.distanceSource !== 'manual')
    .map(r => ({ ...r, base: calculateDiesel({ distanceKm: r.actual.distanceKm, drivingHours: r.actual.drivingHours,
      idleHours: r.actual.idleHours, collectionHours: r.actual.collectionHours, averageLoadPercent: r.actual.averageLoadPercent }, p).baseLiters }))
    .filter(r => r.base > 0).sort((a, b) => a.actual.tripDate.localeCompare(b.actual.tripDate) || a.id.localeCompare(b.id));
  const model: DieselModel = { id: `${truckId}-${Date.now()}`, truckId, trainedAt: new Date().toISOString(), factor: 1, candidateFactor: 1,
    sampleCount: samples.length, trainingCount: 0, validationCount: 0, baselineMae: null, candidateMae: null,
    status: 'waiting', recordIds: samples.map(r => r.id), parameterSignature: dieselParameterSignature(p) };
  if (samples.length < 12) return model;
  // Chronological split by entire day prevents trips from the same shift leaking across the split.
  const boundary = samples[Math.floor(samples.length * 0.75)].actual.tripDate;
  const train = samples.filter(r => r.actual.tripDate < boundary);
  const validation = samples.filter(r => r.actual.tripDate >= boundary);
  if (train.length < 8 || validation.length < 3) return model;
  const fit = train.reduce((sum, r) => sum + r.base * r.actual.actualLiters!, 0) / train.reduce((sum, r) => sum + r.base ** 2, 0);
  const factor = Math.max(0.5, Math.min(2, fit));
  const mae = (f: number) => validation.reduce((sum, r) => sum + Math.abs(r.base * f - r.actual.actualLiters!), 0) / validation.length;
  model.trainingCount = train.length; model.validationCount = validation.length;
  model.baselineMae = mae(1); model.candidateMae = mae(factor); model.candidateFactor = factor;
  model.status = model.candidateMae < model.baselineMae * 0.95 ? 'validated' : 'baseline-retained';
  model.factor = model.status === 'validated' ? factor : 1;
  return model;
}
export type DieselGpsPoint = { latitude: number; longitude: number; timestampMs: number; accuracyMeters: number; isSimulation: boolean };
export function summarizeDieselGps(points: DieselGpsPoint[]) {
  let distanceKm = 0, gaps = 0, rejected = 0, accepted = 0;
  let previous: DieselGpsPoint | null = null;
  const sorted = [...points].filter(p => !p.isSimulation).sort((a, b) => a.timestampMs - b.timestampMs);
  for (const p of sorted) {
    if (![p.latitude, p.longitude, p.timestampMs, p.accuracyMeters].every(Number.isFinite)
      || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180 || p.accuracyMeters < 0 || p.accuracyMeters > 50) { rejected++; previous = null; continue; }
    accepted++;
    if (previous) {
      const hours = (p.timestampMs - previous.timestampMs) / 3600000;
      const rad = Math.PI / 180;
      const a = Math.sin((p.latitude - previous.latitude) * rad / 2) ** 2
        + Math.cos(p.latitude * rad) * Math.cos(previous.latitude * rad) * Math.sin((p.longitude - previous.longitude) * rad / 2) ** 2;
      const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
      if (hours > 5 / 60) gaps++;
      else if (hours > 0 && km / hours <= 100) distanceKm += km;
      else if (hours > 0) { rejected++; accepted--; previous = null; continue; }
    }
    previous = p;
  }
  return { distanceKm: roundDiesel(distanceKm), gaps, rejected, accepted };
}
