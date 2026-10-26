import { auth, db } from '@/config/firebase';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { BARANGAY_COLLECTION_ROUTES, CENRO_DEPOT_WAYPOINT, CENRO_RETURN_WAYPOINT, getBarangaySimulationRoute } from '@/constants/barangaySimulationRoutes';
import { calculateDiesel, DEMO_DIESEL_PARAMETERS, DieselParameters, DieselPlan, roundDiesel } from './dieselMath';
import { applicableDieselFactor, DEFAULT_DIESEL_SETTINGS, DieselLog, DieselSettings, parametersForTruck, readDieselSettings } from './dieselService';
import { calculateRouteDistance, haversineKm, insertVerifiedReportsIntoRoute, optimizeBarangayRouteWithTraffic, waypointsToRouteStops } from './trafficAwareOptimizerService';

export interface ShiftDieselRecommendation {
  barangay: string;
  truckId: string | null;
  driverId: string | null;
  // Liters Breakdown
  usualBaselineLiters: number;
  reportCount: number;
  reportExtraLiters: number;
  safetyReserveLiters: number; // 10% safety reserve buffer
  totalRecommendedLiters: number;
  // Distance & Time Metrics
  baselineDistanceKm: number;
  totalEstimatedDistanceKm: number;
  estimatedOperatingHours: number;
  // Financial
  pricePerLiter: number;
  estimatedCostPhp: number | null;
  // AI Learning Status
  isAiLearned: boolean;
  eligibleTripsCount: number;
  learningThreshold: number; // 12 trips
  learningMessage: string;
  appliedFactor: number;
  // Safe Fuel Budget for Active Route Gating
  maxSafeFuelLiters: number;
  // Truck Specifics
  truckType?: string;
  kmPerLiter?: number;
}

export interface ReportAbsorptionCheck {
  canAbsorb: boolean;
  reason?: string;
  neededExtraLiters: number;
  remainingFuelMarginLiters: number;
  currentEstimatedLiters: number;
  newEstimatedLiters: number;
}

/**
 * Computes standard baseline physical diesel consumption for a barangay route without extra citizen reports.
 */
export function calculateBarangayBaselineLiters(
  barangay: string,
  parameters: DieselParameters = DEMO_DIESEL_PARAMETERS,
  factor = 1
): { baselineLiters: number; distanceKm: number; operatingHours: number; stopCount: number } {
  const waypoints = getBarangaySimulationRoute(barangay);

  const stops = waypointsToRouteStops(waypoints, barangay);
  const distanceKm = calculateRouteDistance(stops);
  const intermediateStops = Math.max(1, stops.length - 2);

  const inputs = {
    distanceKm,
    drivingHours: distanceKm / 20,
    idleHours: 0,
    collectionHours: (intermediateStops * parameters.minutesPerStop) / 60,
    averageLoadPercent: parameters.averageLoadPercent,
  };

  const calc = calculateDiesel(inputs, parameters, factor);
  return {
    baselineLiters: roundDiesel(calc.liters),
    distanceKm,
    operatingHours: roundDiesel(calc.operatingHours),
    stopCount: stops.length,
  };
}

/**
 * Evaluates historical trip logs and active citizen reports to produce the AI Shift Refueling Recommendation.
 * 1. Checks if enough approved trips exist for the truck (>= 12) to use the trained AI factor and historical median.
 * 2. If < 12 trips, uses physical verified formula on Danao City master route waypoints.
 * 3. Finds pending/verified citizen reports in that barangay and adds the exact detour & compaction liters needed.
 * 4. Adds a 10% safety reserve buffer to prevent trucks from running dry in Danao traffic.
 */
export async function getDriverShiftDieselRecommendation(
  driverId: string | null,
  truckId: string | null,
  barangay: string,
  truckSpecs?: { type?: string; capacity?: string | number; plateNumber?: string }
): Promise<ShiftDieselRecommendation> {
  const targetBarangay = (barangay || 'Poblacion').trim();
  let settings = DEFAULT_DIESEL_SETTINGS;
  try {
    settings = await readDieselSettings();
  } catch (err) {
    console.warn('Could not read diesel settings, using default:', err);
  }

  // Resolve truck specs if not directly provided
  let resolvedSpecs = truckSpecs;
  if (!resolvedSpecs && truckId && db) {
    try {
      const tSnap = await getDoc(doc(db, 'trucks', truckId));
      if (tSnap.exists()) {
        const d = tSnap.data();
        resolvedSpecs = { type: d.type, capacity: d.capacity, plateNumber: d.plateNumber };
      }
    } catch (tErr) {
      console.warn('Could not fetch truck details for diesel recommendation:', tErr);
    }
  }

  const parameters = parametersForTruck(settings, truckId || undefined, resolvedSpecs);

  // 1. Fetch truck learned regression model if available
  let factor = 1;
  let truckModelId: string | null = null;
  if (truckId && db) {
    try {
      const modelSnap = await getDoc(doc(db, 'diesel_models', truckId));
      if (modelSnap.exists()) {
        const m = modelSnap.data() as any;
        factor = applicableDieselFactor(m, parameters);
        if (factor !== 1) truckModelId = m.id || null;
      }
    } catch (modelErr) {
      console.warn('Could not read diesel model for truck:', truckId, modelErr);
    }
  }

  // 2. Query historical approved non-demo trips for this truck/barangay
  let eligibleTripsCount = 0;
  let historicalTripLiters: number[] = [];
  if (db && truckId) {
    try {
      const qLogs = query(
        collection(db, 'diesel_logs'),
        where('truckId', '==', truckId),
        where('status', '==', 'approved')
      );
      const snap = await getDocs(qLogs);
      snap.forEach((d) => {
        const data = d.data() as DieselLog;
        if (
          !data.actual.isDemo &&
          data.actual.actualLiters !== null &&
          data.actual.actualLiters > 0 &&
          data.actual.fuelMethod !== 'not-recorded' &&
          data.actual.distanceSource !== 'manual'
        ) {
          eligibleTripsCount++;
          if (!data.barangay || data.barangay.toLowerCase() === targetBarangay.toLowerCase()) {
            historicalTripLiters.push(data.actual.actualLiters);
          }
        }
      });
    } catch (logErr) {
      console.warn('Could not query diesel logs for recommendation:', logErr);
    }
  }

  // 3. Compute Usual Baseline Shift Liters
  const LEARNING_THRESHOLD = 12;
  const isAiLearned = eligibleTripsCount >= LEARNING_THRESHOLD;
  const baseRouteMetrics = calculateBarangayBaselineLiters(targetBarangay, parameters, factor);

  let usualBaselineLiters = baseRouteMetrics.baselineLiters;
  let learningMessage =
    eligibleTripsCount === 0
      ? `Road Network Baseline (0/${LEARNING_THRESHOLD} shifts logged • Cold-Start)`
      : `Road Network Baseline (${eligibleTripsCount}/${LEARNING_THRESHOLD} shifts gathered • Calibrating)`;

  if (isAiLearned) {
    if (historicalTripLiters.length >= 3) {
      // Use median of verified historical consumption for this specific barangay
      const sorted = [...historicalTripLiters].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const medianLiters = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      usualBaselineLiters = roundDiesel(medianLiters);
      learningMessage = `AI Calibrated (Learned from ${eligibleTripsCount} verified Danao City shifts)`;
    } else {
      usualBaselineLiters = roundDiesel(baseRouteMetrics.baselineLiters * factor);
      learningMessage = `AI Calibrated (${factor.toFixed(2)}x truck model applied; ${eligibleTripsCount} shifts)`;
    }
  }

  // 4. Query active/verified citizen reports in this barangay
  let queuedReports: any[] = [];
  if (db) {
    try {
      const qReports = query(
        collection(db, 'reports'),
        where('barangay', '==', targetBarangay),
        where('status', 'in', ['acknowledged', 'pending', 'verified'])
      );
      const rSnap = await getDocs(qReports);
      rSnap.forEach((d) => {
        queuedReports.push({ id: d.id, ...d.data() });
      });
    } catch (rErr) {
      console.warn('Could not query active reports for fuel recommendation:', rErr);
    }
  }

  // 5. Calculate Extra Fuel for Reports Detour & Compaction
  let reportExtraLiters = 0;
  let totalEstimatedDistanceKm = baseRouteMetrics.distanceKm;
  let estimatedOperatingHours = baseRouteMetrics.operatingHours;

  if (queuedReports.length > 0) {
    try {
      const optResult = optimizeBarangayRouteWithTraffic(
        targetBarangay,
        queuedReports,
        parameters,
        factor,
        truckModelId,
        'AI Shift Refueling Recommendation'
      );
      totalEstimatedDistanceKm = optResult.optimizedDistanceKm;
      estimatedOperatingHours = roundDiesel(optResult.optimizedDurationMins / 60);

      const withReportsFuel = optResult.optimizedFuelLiters;
      reportExtraLiters = Math.max(0, roundDiesel(withReportsFuel - baseRouteMetrics.baselineLiters));
    } catch (optErr) {
      console.warn('Error running route optimizer for fuel recommendation:', optErr);
      // Fallback heuristic: 0.8 km detour per report + 3 min compaction
      const extraKm = queuedReports.length * 0.8;
      const extraCompactionHours = (queuedReports.length * parameters.minutesPerStop) / 60;
      const extraDrivingLiters = (extraKm / parameters.kmPerLiter) * (1 + (parameters.fullLoadPenaltyPercent / 100) * 0.5);
      const extraCompactionLiters = extraCompactionHours * parameters.collectionLitersPerHour;
      reportExtraLiters = roundDiesel(extraDrivingLiters + extraCompactionLiters);
      totalEstimatedDistanceKm = roundDiesel(baseRouteMetrics.distanceKm + extraKm);
      estimatedOperatingHours = roundDiesel(baseRouteMetrics.operatingHours + extraCompactionHours + extraKm / 20);
    }
  }

  // 6. Calculate 10% Safety Reserve Buffer
  const subtotalLiters = usualBaselineLiters + reportExtraLiters;
  const safetyReserveLiters = roundDiesel(subtotalLiters * 0.10);

  // 7. Total Recommended Refuel
  const totalRecommendedLiters = roundDiesel(subtotalLiters + safetyReserveLiters);
  const estimatedCostPhp = parameters.pricePerLiter > 0 ? roundDiesel(totalRecommendedLiters * parameters.pricePerLiter) : null;
  const maxSafeFuelLiters = roundDiesel(totalRecommendedLiters);

  return {
    barangay: targetBarangay,
    truckId,
    driverId,
    usualBaselineLiters,
    reportCount: queuedReports.length,
    reportExtraLiters,
    safetyReserveLiters,
    totalRecommendedLiters,
    baselineDistanceKm: baseRouteMetrics.distanceKm,
    totalEstimatedDistanceKm,
    estimatedOperatingHours,
    pricePerLiter: parameters.pricePerLiter,
    estimatedCostPhp,
    isAiLearned,
    eligibleTripsCount,
    learningThreshold: LEARNING_THRESHOLD,
    learningMessage,
    appliedFactor: factor,
    maxSafeFuelLiters,
    truckType: resolvedSpecs?.type || 'Standard',
    kmPerLiter: parameters.kmPerLiter,
  };
}

/**
 * Checks if an active driver route can absorb an incoming citizen report without exceeding the safe fuel budget.
 * If adding this report causes the route fuel to exceed the fuel budget or exhausts the 10% safety margin,
 * it returns canAbsorb: false so the report can be held for the next shift/trip.
 */
export function canActiveRouteAbsorbReport(
  activeStops: Array<{ latitude: number; longitude: number; stopType?: string }>,
  newReport: { location?: { lat?: number; lng?: number; latitude?: number; longitude?: number } | null },
  fuelBudgetLiters: number,
  parameters: DieselParameters = DEMO_DIESEL_PARAMETERS,
  factor = 1
): ReportAbsorptionCheck {
  const repLat = newReport.location?.lat ?? newReport.location?.latitude;
  const repLng = newReport.location?.lng ?? newReport.location?.longitude;

  if (!Number.isFinite(repLat) || !Number.isFinite(repLng) || activeStops.length < 2) {
    return {
      canAbsorb: true,
      neededExtraLiters: 0,
      remainingFuelMarginLiters: fuelBudgetLiters,
      currentEstimatedLiters: 0,
      newEstimatedLiters: 0,
    };
  }

  // 1. Current route metrics
  const currentDistKm = calculateRouteDistance(activeStops);
  const currentStopsCount = Math.max(1, activeStops.length - 2);
  const currentInputs = {
    distanceKm: currentDistKm,
    drivingHours: currentDistKm / 20,
    idleHours: 0,
    collectionHours: (currentStopsCount * parameters.minutesPerStop) / 60,
    averageLoadPercent: parameters.averageLoadPercent,
  };
  const currentCalc = calculateDiesel(currentInputs, parameters, factor);
  const currentEstimatedLiters = roundDiesel(currentCalc.liters);

  // 2. Simulate inserting new report stop at lowest detour point
  let minAddedDist = Number.POSITIVE_INFINITY;
  for (let i = 1; i < activeStops.length; i++) {
    const prev = activeStops[i - 1];
    const next = activeStops[i];
    const originalLeg = haversineKm(prev.latitude, prev.longitude, next.latitude, next.longitude);
    const newLegs =
      haversineKm(prev.latitude, prev.longitude, Number(repLat), Number(repLng)) +
      haversineKm(Number(repLat), Number(repLng), next.latitude, next.longitude);
    const added = newLegs - originalLeg;
    if (added < minAddedDist) {
      minAddedDist = added;
    }
  }

  const addedDistKm = Number.isFinite(minAddedDist) ? minAddedDist : 1.2;
  const newDistKm = currentDistKm + addedDistKm;
  const newStopsCount = currentStopsCount + 1;
  const newInputs = {
    distanceKm: newDistKm,
    drivingHours: newDistKm / 20,
    idleHours: 0,
    collectionHours: (newStopsCount * parameters.minutesPerStop) / 60,
    averageLoadPercent: parameters.averageLoadPercent,
  };
  const newCalc = calculateDiesel(newInputs, parameters, factor);
  const newEstimatedLiters = roundDiesel(newCalc.liters);
  const neededExtraLiters = Math.max(0.1, roundDiesel(newEstimatedLiters - currentEstimatedLiters));

  // 3. Compare with fuel budget
  // Allow absorption if newEstimatedLiters <= fuelBudgetLiters
  const remainingFuelMarginLiters = roundDiesel(fuelBudgetLiters - currentEstimatedLiters);
  const canAbsorb = fuelBudgetLiters <= 0 || newEstimatedLiters <= fuelBudgetLiters;

  let reason: string | undefined;
  if (!canAbsorb) {
    reason = `Report detour requires +${neededExtraLiters.toFixed(1)} L diesel, exceeding the driver's refueled capacity (Remaining margin: ${remainingFuelMarginLiters.toFixed(1)} L). Held for next shift to prevent fuel starvation.`;
  }

  return {
    canAbsorb,
    reason,
    neededExtraLiters,
    remainingFuelMarginLiters,
    currentEstimatedLiters,
    newEstimatedLiters,
  };
}
