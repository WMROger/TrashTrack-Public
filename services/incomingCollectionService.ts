import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import * as Location from 'expo-location';
import { BARANGAY_ANCHORS } from '@/constants/barangaySimulationRoutes';
import { NotificationService } from './notificationService';
import { soundAlertService } from './soundAlertService';
import { locationService } from './locationService';

export async function getResidentCurrentCoordinates(): Promise<Coordinate | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const lastKnown = await Location.getLastKnownPositionAsync();
    if (lastKnown?.coords) {
      return { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
    }
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    if (current?.coords) {
      return { latitude: current.coords.latitude, longitude: current.coords.longitude };
    }
  } catch {
    // Location permission or hardware disabled, fallback to barangay anchor
  }
  return null;
}

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface TruckLocationData {
  id: string;
  driverId?: string;
  driverUid?: string;
  truckId?: string;
  plateNumber?: string;
  plate?: string;
  truckPlate?: string;
  lat?: number;
  lng?: number;
  parsedLat?: number;
  parsedLng?: number;
  latitude?: number;
  longitude?: number;
  location?: { lat?: number; lng?: number; latitude?: number; longitude?: number };
  speed?: number;
  speedKph?: number;
  heading?: number;
  status?: string;
  barangay?: string;
  assignedBarangay?: string;
  locationName?: string;
  isSimulation?: boolean;
  isSimulated?: boolean;
  remainingDurationSeconds?: number;
  totalDurationSeconds?: number;
  distanceTraveledKm?: number;
  totalDistanceKm?: number;
  lastUpdate?: any;
  timestamp?: any;
}

export interface IncomingCollectionState {
  hasActiveTruck: boolean;
  activeTruck: {
    id: string;
    driverId?: string;
    plate: string;
    barangay: string;
    currentCoord: Coordinate;
    speedKph: number;
    locationName?: string;
  } | null;
  distanceMeters: number | null;
  aiEtaMinutes: number | null;
  isApproaching30Min: boolean;
  isNearby: boolean;
  statusBadgeText: string;
  lastEvaluatedAt: number;
}

const STORAGE_PREFIX = '@trashtrack_incoming_alert_';

/**
 * Normalizes barangay name by removing prefixes like "Brgy.", "Barangay", whitespace, etc.
 */
export function normalizeBarangay(str?: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/^(brgy\.?|barangay)\s*/i, '')
    .replace(/_(whole|original|direct)/i, '')
    .trim();
}

/**
 * Detects whether an identifier is a raw database key or UUID rather than a human-readable plate/name.
 */
export function isRawFirestoreIdOrUuid(str?: string | null): boolean {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (!s) return false;

  // Standard UUID (with hyphens)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return true;
  }

  // Internal placeholders
  if (/^(demo_truck_|active_sim_|truck_[0-9]+|sim_truck)/i.test(s)) {
    return true;
  }

  // Firestore auto-generated document ID: 18-32 characters alphanumeric without spaces or hyphens
  if (/^[A-Za-z0-9]{18,32}$/.test(s) && !/\s|-|_/.test(s)) {
    const hasLower = /[a-z]/.test(s);
    const hasUpper = /[A-Z]/.test(s);
    const hasDigit = /[0-9]/.test(s);
    if ((hasLower && hasUpper) || (hasLower && hasDigit && s.length >= 20) || s.length >= 20) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves a friendly, human-assigned truck plate or name (e.g. "ABC-1111", "Mini-Dump 1"),
 * completely filtering out raw UUIDs and Firestore document IDs.
 */
export function resolveTruckDisplayName(truckOrData: any, fallback = 'Collection Truck'): string {
  if (!truckOrData) return fallback;

  if (typeof truckOrData === 'string') {
    if (!isRawFirestoreIdOrUuid(truckOrData)) {
      return truckOrData.trim();
    }
    return fallback;
  }

  const candidates = [
    truckOrData.plateNumber,
    truckOrData.truckPlate,
    truckOrData.plate,
    truckOrData.truckName,
    truckOrData.name,
    truckOrData.assignedTruck,
    truckOrData.model ? `${truckOrData.model}` : null,
    truckOrData.type ? `${truckOrData.type} Truck` : null,
  ];

  for (const c of candidates) {
    if (c && typeof c === 'string' && c.trim() && !isRawFirestoreIdOrUuid(c)) {
      return c.trim();
    }
  }

  return fallback;
}

/**
 * Calculate Haversine distance in meters between two coordinates.
 */
export function haversineMeters(coord1: Coordinate, coord2: Coordinate): number {
  const R = 6371e3; // Earth radius in meters
  const dLat = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
  const dLng = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((coord1.latitude * Math.PI) / 180) *
      Math.cos((coord2.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Resolve target coordinates for a barangay (using verified anchors or default Danao City Hall).
 */
export function getBarangayCoordinates(barangayName?: string): Coordinate {
  if (!barangayName) {
    return { latitude: 10.5218, longitude: 124.0285 }; // Danao City Hall default
  }
  const clean = normalizeBarangay(barangayName);
  // Match key case-insensitively from BARANGAY_ANCHORS
  for (const [key, val] of Object.entries(BARANGAY_ANCHORS)) {
    if (normalizeBarangay(key) === clean) {
      return { latitude: val.lat, longitude: val.lng };
    }
  }
  return { latitude: 10.5218, longitude: 124.0285 };
}

/**
 * AI-powered ETA and arrival time estimation for garbage trucks.
 * Factors in:
 * - Direct distance + Danao City urban road detour curvature factor (1.35x)
 * - Dynamic collection travel speed (18-25 km/h with residential stops)
 * - Collection stop delays (~1.5 min per km)
 * - Telemetry from truck remaining duration if available
 */
export function calculateAiEtaMinutes(
  truckCoord: Coordinate,
  targetCoord: Coordinate,
  telemetrySpeedKph?: number,
  remainingDurationSeconds?: number
): { distanceMeters: number; aiEtaMinutes: number } {
  const distanceMeters = haversineMeters(truckCoord, targetCoord);

  // If the truck is in the immediate sector (<= 600m), ETA is purely immediate local travel (1 to 3 mins)
  if (distanceMeters <= 600) {
    const immediateMinutes = Math.max(1, Math.min(3, Math.round((distanceMeters / 250) * 1)));
    return { distanceMeters, aiEtaMinutes: immediateMinutes };
  }

  const roadDistanceKm = (distanceMeters / 1000) * 1.35; // Road curvature factor

  // Operating speed: Danao urban/barangay collection pace
  const liveSpeed = Number(telemetrySpeedKph || 0);
  const transitSpeedKph = liveSpeed > 5 ? Math.max(16, Math.min(32, liveSpeed)) : 20;

  // Stop buffer delay for collection points along the route
  const stopBufferMinutes = Math.round(roadDistanceKm * 1.5);
  const travelTimeMinutes = Math.round((roadDistanceKm / transitSpeedKph) * 60) + stopBufferMinutes;

  let finalEtaMinutes = Math.max(1, travelTimeMinutes);

  // Only blend remainingDurationSeconds if the truck is farther away (> 1500m)
  // because within the barangay/neighborhood, full shift remaining duration (e.g. 118 min) does not apply to arrival!
  if (distanceMeters > 1500 && remainingDurationSeconds && remainingDurationSeconds > 0) {
    const telemetryMinutes = Math.max(1, Math.round(remainingDurationSeconds / 60));
    finalEtaMinutes = Math.max(1, Math.round(travelTimeMinutes * 0.4 + telemetryMinutes * 0.6));
  }

  return { distanceMeters, aiEtaMinutes: finalEtaMinutes };
}

export class IncomingCollectionService {
  private static activeEvaluationLocks = new Set<string>();
  private static userRoleCache = new Map<string, string>();

  static setUserRole(userId: string, role: string) {
    if (userId && role) {
      IncomingCollectionService.userRoleCache.set(userId, role.toLowerCase().trim());
    }
  }

  static getUserRole(userId: string): string | undefined {
    return IncomingCollectionService.userRoleCache.get(userId);
  }

  /**
   * Resets simulation and arrival alert cooldowns so repeated tests trigger alerts cleanly
   */
  static async resetSimulationAlertCooldowns(truckId?: string): Promise<void> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const alertKeys = allKeys.filter(
        (k) =>
          k.startsWith('@trashtrack_incoming_30m_') ||
          k.startsWith('@trashtrack_incoming_near_') ||
          (truckId && k.includes(truckId))
      );
      if (alertKeys.length > 0) {
        await AsyncStorage.multiRemove(alertKeys);
        console.log(`[IncomingCollectionService] Cleared ${alertKeys.length} simulation alert cooldown key(s).`);
      }
    } catch (e) {
      console.warn('[IncomingCollectionService] Could not reset simulation alert cooldowns:', e);
    }
  }

  /**
   * Evaluates live truck positions against a resident's barangay,
   * calculates AI ETA, and dispatches 30-min incoming collection reminders
   * and nearby proximity alerts with deduplication.
   */
  static async evaluateAndAlertResident(params: {
    userId: string;
    userBarangay: string;
    truck: TruckLocationData;
    customResidentCoord?: Coordinate;
    userRole?: string;
  }): Promise<{
    aiEtaMinutes: number;
    distanceMeters: number;
    dispatchedAlert?: '30_min_incoming' | 'proximity_nearby';
  }> {
    const { userId, userBarangay, truck, customResidentCoord, userRole } = params;
    if (!userId || !userBarangay) return { aiEtaMinutes: 0, distanceMeters: 0 };

    // 1. CRITICAL GUARD: The driver operating the vehicle and staff must NEVER receive citizen collection alerts!
    const currentAuthUid = auth?.currentUser?.uid;
    const isSelfTruck =
      (truck.driverId && (truck.driverId === userId || truck.driverId === currentAuthUid)) ||
      (truck.driverUid && ((truck as any).driverUid === userId || (truck as any).driverUid === currentAuthUid)) ||
      (truck.id && (truck.id === userId || truck.id === currentAuthUid));

    const directRole = (userRole || '').toLowerCase().trim();
    const cachedRole = (userId ? IncomingCollectionService.userRoleCache.get(userId) : undefined) ||
      (currentAuthUid ? IncomingCollectionService.userRoleCache.get(currentAuthUid) : undefined);
    const effectiveRole = directRole || cachedRole || '';

    const isNonResidentStaff =
      effectiveRole === 'driver' ||
      effectiveRole === 'cenro' ||
      effectiveRole === 'cicto' ||
      effectiveRole === 'coordinator';

    const isSimulation = Boolean(
      (truck as any).isSim ||
      (truck as any).isSimulation ||
      locationService.getSimulationState()?.isActive
    );

    // Allow alerts during simulation runs or testing on emulators when acting as a resident
    if (isNonResidentStaff || (!isSimulation && isSelfTruck)) {
      return { aiEtaMinutes: 0, distanceMeters: 0 };
    }

    // Verify user role from Firestore if not provided
    const targetUidToCheck = (userId && userId !== 'resident_device') ? userId : currentAuthUid;
    if (db && targetUidToCheck && !effectiveRole) {
      try {
        let resolvedRole = IncomingCollectionService.userRoleCache.get(targetUidToCheck);
        if (!resolvedRole) {
          const userDoc = await getDoc(doc(db, 'users', targetUidToCheck));
          if (userDoc.exists()) {
            resolvedRole = String(userDoc.data()?.role || '').toLowerCase().trim();
            IncomingCollectionService.userRoleCache.set(targetUidToCheck, resolvedRole);
          }
        }
        if (
          resolvedRole === 'driver' ||
          resolvedRole === 'cenro' ||
          resolvedRole === 'cicto' ||
          resolvedRole === 'coordinator'
        ) {
          return { aiEtaMinutes: 0, distanceMeters: 0 };
        }
      } catch {}
    }

    const truckId = truck.id || truck.truckId || truck.driverId || 'truck_1';
    const evalLockKey = `${userId}_${truckId}`;
    if (IncomingCollectionService.activeEvaluationLocks.has(evalLockKey)) {
      return { aiEtaMinutes: 0, distanceMeters: 0 };
    }
    IncomingCollectionService.activeEvaluationLocks.add(evalLockKey);
    setTimeout(() => {
      IncomingCollectionService.activeEvaluationLocks.delete(evalLockKey);
    }, 4000);

    // Extract truck coordinates
    const lat = Number(truck.parsedLat ?? truck.lat ?? truck.latitude ?? truck.location?.lat ?? truck.location?.latitude);
    const lng = Number(truck.parsedLng ?? truck.lng ?? truck.longitude ?? truck.location?.lng ?? truck.location?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) {
      return { aiEtaMinutes: 0, distanceMeters: 0 };
    }

    const truckCoord: Coordinate = { latitude: lat, longitude: lng };
    const targetCoord = customResidentCoord || getBarangayCoordinates(userBarangay);

    const { distanceMeters, aiEtaMinutes } = calculateAiEtaMinutes(
      truckCoord,
      targetCoord,
      truck.speedKph || (truck.speed ? truck.speed * 3.6 : undefined),
      truck.remainingDurationSeconds
    );

    // Fetch user preferences (proximity alert settings)
    let proximityAlertsEnabled = true;
    let proximityRadiusMeters = 500;

    if (db && userId) {
      try {
        const settingsSnap = await getDoc(doc(db, 'user_settings', userId));
        if (settingsSnap.exists()) {
          const prefs = settingsSnap.data()?.notificationPreferences;
          if (prefs?.proximityAlerts !== undefined) {
            proximityAlertsEnabled = prefs.proximityAlerts !== false;
          }
          if (prefs?.proximityRadiusMeters) {
            proximityRadiusMeters = Number(prefs.proximityRadiusMeters);
          }
        }
      } catch (err) {
        // Fallback to defaults on error
      }
    }

    if (!proximityAlertsEnabled) {
      return { aiEtaMinutes, distanceMeters };
    }

    const plate = resolveTruckDisplayName(truck, 'Collection Truck');
    const truckDisplayName = plate.toLowerCase().includes('truck') ? plate : `Truck ${plate}`;
    const todayKey = new Date().toISOString().split('T')[0];

    // Deduplication keys per truck and day
    const alert30mKey = `${STORAGE_PREFIX}30m_${userId}_${truckId}_${todayKey}`;
    const alertNearKey = `${STORAGE_PREFIX}near_${userId}_${truckId}_${todayKey}`;

    let dispatchedAlert: '30_min_incoming' | 'proximity_nearby' | undefined;

    // 1. Check ~30-Minute Incoming Collection Threshold (ETA between 15 and 35 mins or <= 30 mins)
    const is30MinWindow = aiEtaMinutes <= 35 && aiEtaMinutes >= 15;
    if (is30MinWindow) {
      const alreadySent = await AsyncStorage.getItem(alert30mKey);
      const lastAlertTime = alreadySent ? Number(alreadySent) : 0;
      const cooldownElapsed = Date.now() - lastAlertTime > 2 * 60 * 1000; // 2 min cooldown so test simulations re-trigger cleanly

      if (!alreadySent || cooldownElapsed) {
        // Mark as sent immediately to prevent race conditions
        await AsyncStorage.setItem(alert30mKey, String(Date.now()));

        // Dispatch local notification with sound & banner
        await NotificationService.scheduleIncomingTruckNotification({
          truckId,
          truckPlate: plate,
          barangay: userBarangay,
          etaMinutes: aiEtaMinutes,
          distanceMeters,
        });

        // Trigger audible fleet arrival sound alert + voice announce
        soundAlertService.playFleetArrivalChime(userBarangay).catch(() => {});

        // Write in-app notification to Firestore userNotifications
        if (db && userId) {
          try {
            await addDoc(collection(db, 'userNotifications'), {
              userId,
              title: `🚛 Incoming Trash Collection (~${aiEtaMinutes} mins)`,
              body: `AI Arrival Alert: ${truckDisplayName} is approaching Brgy. ${userBarangay}. Estimated arrival in ~${aiEtaMinutes} minutes. Please prepare your segregated waste!`,
              type: 'truck_incoming',
              truckId,
              barangay: userBarangay,
              etaMinutes: aiEtaMinutes,
              distanceMeters,
              read: false,
              createdAt: serverTimestamp(),
            });
          } catch (e) {
            // Non-critical if offline or permission restricted
          }

          try {
            const alertDocId = `incoming_${truckId}_${userId}_${todayKey}`;
            await setDoc(doc(db, 'proximity_alerts', alertDocId), {
              userId,
              driverId: truck.driverId || truckId,
              barangay: userBarangay,
              type: 'incoming_30min',
              aiEtaMinutes,
              distanceMeters,
              createdAt: serverTimestamp(),
            }, { merge: true });
          } catch {
            // Optional telemetry audit log
          }
        }

        dispatchedAlert = '30_min_incoming';
      }
    }

    // 2. Check Close Proximity / Nearby Threshold (< proximityRadiusMeters or <= 8 mins)
    const effectiveRadius = Math.max(proximityRadiusMeters || 500, 600);
    const isNearbyWindow = distanceMeters <= effectiveRadius || aiEtaMinutes <= 8;
    if (isNearbyWindow) {
      const alreadySentNear = await AsyncStorage.getItem(alertNearKey);
      const lastAlertTime = alreadySentNear ? Number(alreadySentNear) : 0;
      const cooldownElapsed = Date.now() - lastAlertTime > 3 * 60 * 1000; // 3 min cooldown to allow timely re-alerts

      if (!alreadySentNear || cooldownElapsed) {
        await AsyncStorage.setItem(alertNearKey, String(Date.now()));

        await NotificationService.scheduleProximityAlertNotification({
          truckId,
          truckPlate: plate,
          barangay: userBarangay,
          distanceMeters,
        });

        // Trigger audible fleet arrival sound alert + voice announce
        soundAlertService.playFleetArrivalChime(userBarangay).catch(() => {});

        if (db && userId) {
          try {
            await addDoc(collection(db, 'userNotifications'), {
              userId,
              title: '🔔 Collection Truck Nearby!',
              body: `${truckDisplayName} is now in your immediate sector (~${Math.round(distanceMeters)}m away) in Brgy. ${userBarangay}. Collection is underway!`,
              type: 'truck_proximity',
              truckId,
              barangay: userBarangay,
              distanceMeters,
              read: false,
              createdAt: serverTimestamp(),
            });
          } catch (e) {
            // Non-critical if offline or restricted
          }

          try {
            const nearbyBucket = Math.floor(Date.now() / (3 * 60 * 1000));
            const alertDocId = `nearby_${truckId}_${userId}_${todayKey}_${nearbyBucket}`;
            await setDoc(doc(db, 'proximity_alerts', alertDocId), {
              userId,
              driverId: truck.driverId || truckId,
              barangay: userBarangay,
              type: 'truck_proximity',
              distanceMeters,
              createdAt: serverTimestamp(),
            }, { merge: true });
          } catch {
            // Optional audit log
          }
        }

        dispatchedAlert = 'proximity_nearby';
      }
    }

    return { aiEtaMinutes, distanceMeters, dispatchedAlert };
  }

  /**
   * Real-time subscription to active truck locations for resident's barangay.
   * Feeds live ETA state to UI components and monitors incoming thresholds.
   */
  static subscribeToResidentIncomingTruck(
    userId: string,
    userBarangay: string = 'Baliang',
    callback: (state: IncomingCollectionState) => void,
    customResidentCoord?: Coordinate,
    userRole?: string
  ): () => void {
    if (!db) {
      callback({
        hasActiveTruck: false,
        activeTruck: null,
        distanceMeters: null,
        aiEtaMinutes: null,
        isApproaching30Min: false,
        isNearby: false,
        statusBadgeText: 'No Active Collection',
        lastEvaluatedAt: Date.now(),
      });
      return () => {};
    }

    const currentAuthUid = auth?.currentUser?.uid;
    const directRole = (userRole || '').toLowerCase().trim();
    const cachedRole = (userId ? IncomingCollectionService.userRoleCache.get(userId) : undefined) ||
      (currentAuthUid ? IncomingCollectionService.userRoleCache.get(currentAuthUid) : undefined);
    const effectiveRole = directRole || cachedRole || '';

    if (
      effectiveRole === 'driver' ||
      effectiveRole === 'cenro' ||
      effectiveRole === 'cicto' ||
      effectiveRole === 'coordinator'
    ) {
      callback({
        hasActiveTruck: false,
        activeTruck: null,
        distanceMeters: null,
        aiEtaMinutes: null,
        isApproaching30Min: false,
        isNearby: false,
        statusBadgeText: 'Driver Mode (Alerts Muted)',
        lastEvaluatedAt: Date.now(),
      });
      return () => {};
    }

    const effectiveBrgy = userBarangay || 'Baliang';
    const normUserBrgy = normalizeBarangay(effectiveBrgy);
    const brgyAnchor = getBarangayCoordinates(effectiveBrgy);
    let resolvedResidentCoord: Coordinate = customResidentCoord || brgyAnchor;

    // Asynchronously attempt to refine with actual device GPS coordinates IF the device is physically within/near the barangay (<= 3km)
    getResidentCurrentCoordinates().then((coords) => {
      if (coords && haversineMeters(coords, brgyAnchor) <= 3000) {
        resolvedResidentCoord = coords;
      }
    }).catch(() => {});

    const unsub = onSnapshot(
      collection(db, 'truck_locations'),
      async (snapshot) => {
        let bestTruck: any = null;
        let bestDistance = Infinity;
        const targetCoord = resolvedResidentCoord || brgyAnchor;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const isInactive =
            data.status === 'inactive' ||
            data.status === 'completed' ||
            data.status === 'off_duty';
          if (isInactive) return;

          const lastUpdateDate = data.lastUpdate?.toDate?.() || data.timestamp?.toDate?.() || (data.lastUpdate ? new Date(data.lastUpdate) : null);
          const isStale = lastUpdateDate && (Date.now() - lastUpdateDate.getTime() > 180000);
          if (isStale) return;

          const assigned = normalizeBarangay(data.assignedBarangay);
          const target = normalizeBarangay(data.targetBarangay);
          const current = normalizeBarangay(data.barangay);
          const locationName = (data.locationName || '').toLowerCase();
          const routeName = (data.routeName || '').toLowerCase();

          const lat = Number(data.lat ?? data.latitude ?? data.location?.lat ?? data.location?.latitude);
          const lng = Number(data.lng ?? data.longitude ?? data.location?.lng ?? data.location?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return;

          const dist = haversineMeters({ latitude: lat, longitude: lng }, targetCoord);

          const isServingResident =
            assigned === normUserBrgy ||
            target === normUserBrgy ||
            current === normUserBrgy ||
            (locationName.includes(normUserBrgy) && !locationName.includes(`from ${normUserBrgy}`)) ||
            routeName.includes(normUserBrgy);

          // If truck is serving this resident's barangay OR is physically within 1.2 km of the resident
          if (isServingResident || dist <= 1200) {
            if (dist < bestDistance) {
              bestDistance = dist;
              bestTruck = { id: docSnap.id, ...data, parsedLat: lat, parsedLng: lng };
            }
          }
        });

        // If local simulation is active in Danao City, prioritize the simulation vehicle
        const simState = locationService.getSimulationState();
        if (simState?.isActive && simState.currentCoordinate) {
          const simBarangay = normalizeBarangay(simState.barangay);
          if (!normUserBrgy || simBarangay === normUserBrgy || !simBarangay) {
            const simLat = simState.currentCoordinate.latitude;
            const simLng = simState.currentCoordinate.longitude;
            const simDist = haversineMeters({ latitude: simLat, longitude: simLng }, targetCoord);
            const simPlate = resolveTruckDisplayName(simState, 'ABB-1235');
            bestTruck = {
              id: simState.driverId || 'active_sim_truck',
              driverId: simState.driverId,
              plate: simPlate,
              truckPlate: simPlate,
              plateNumber: simPlate,
              speedKph: simState.currentSpeedKph,
              status: 'active',
              parsedLat: simLat,
              parsedLng: simLng,
              locationName: simState.locationName,
              remainingDurationSeconds: simState.remainingDurationSeconds,
            };
            bestDistance = simDist;
          }
        }

        if (!bestTruck) {
          callback({
            hasActiveTruck: false,
            activeTruck: null,
            distanceMeters: null,
            aiEtaMinutes: null,
            isApproaching30Min: false,
            isNearby: false,
            statusBadgeText: 'Standby for Collection',
            lastEvaluatedAt: Date.now(),
          });
          return;
        }

        const truckCoord: Coordinate = {
          latitude: bestTruck.parsedLat,
          longitude: bestTruck.parsedLng,
        };
        const speedKph = Number(bestTruck.speedKph || (bestTruck.speed ? bestTruck.speed * 3.6 : 22));

        const { distanceMeters, aiEtaMinutes } = calculateAiEtaMinutes(
          truckCoord,
          targetCoord,
          speedKph,
          bestTruck.remainingDurationSeconds
        );

        const isNearby = distanceMeters <= 600 || aiEtaMinutes <= 8;
        const isApproaching30Min = aiEtaMinutes <= 35 && aiEtaMinutes >= 15;

        let statusBadgeText = `Arriving in ~${aiEtaMinutes} mins`;
        if (isNearby) {
          statusBadgeText = `Truck Nearby (~${Math.max(50, Math.round(distanceMeters / 50) * 50)}m)`;
        } else if (isApproaching30Min) {
          statusBadgeText = `AI ETA: ~${aiEtaMinutes} mins (Approaching)`;
        }

        // Trigger evaluations and alerts asynchronously only for residents (never for the driver of bestTruck or any driver/staff)
        const isSelfDriver =
          bestTruck.id === userId ||
          bestTruck.id === currentAuthUid ||
          bestTruck.driverId === userId ||
          bestTruck.driverId === currentAuthUid ||
          bestTruck.driverUid === userId ||
          bestTruck.driverUid === currentAuthUid;

        const dynRole = effectiveRole || (userId ? IncomingCollectionService.userRoleCache.get(userId) : undefined);
        const isDriverOrStaff =
          dynRole === 'driver' ||
          dynRole === 'cenro' ||
          dynRole === 'cicto' ||
          dynRole === 'coordinator';

        const isSimulation = Boolean(
          bestTruck.isSimulation ||
          (bestTruck as any).isSim ||
          locationService.getSimulationState()?.isActive
        );

        if ((!isSelfDriver || isSimulation) && !isDriverOrStaff) {
          IncomingCollectionService.evaluateAndAlertResident({
            userId,
            userBarangay,
            userRole: dynRole,
            truck: bestTruck,
            customResidentCoord: targetCoord,
          }).catch((err) => {
            console.warn('Error in background incoming collection evaluation:', err);
          });
        }

        callback({
          hasActiveTruck: true,
          activeTruck: {
            id: bestTruck.id,
            driverId: bestTruck.driverId,
            plate: resolveTruckDisplayName(bestTruck, 'ABB-1235'),
            barangay: userBarangay,
            currentCoord: truckCoord,
            speedKph,
            locationName: bestTruck.locationName,
          },
          distanceMeters,
          aiEtaMinutes,
          isApproaching30Min,
          isNearby,
          statusBadgeText,
          lastEvaluatedAt: Date.now(),
        });
      },
      (err) => {
        if (err?.code !== 'permission-denied') {
          console.warn('incomingCollectionService listener error:', err);
        }
      }
    );

    const unsubSim = locationService.onSimulationChange((simState) => {
      if (!simState.isActive || !simState.currentCoordinate) return;
      const simBarangay = normalizeBarangay(simState.barangay);
      if (normUserBrgy && simBarangay && simBarangay !== normUserBrgy) return;

      const simLat = simState.currentCoordinate.latitude;
      const simLng = simState.currentCoordinate.longitude;
      const truckCoord: Coordinate = { latitude: simLat, longitude: simLng };
      const speedKph = Number(simState.currentSpeedKph || 20);

      const targetCoord = resolvedResidentCoord || brgyAnchor;
      const { distanceMeters, aiEtaMinutes } = calculateAiEtaMinutes(
        truckCoord,
        targetCoord,
        speedKph,
        simState.remainingDurationSeconds
      );

      const isNearby = distanceMeters <= 600 || aiEtaMinutes <= 8;
      const isApproaching30Min = aiEtaMinutes <= 35 && aiEtaMinutes >= 15;

      let statusBadgeText = `Arriving in ~${aiEtaMinutes} mins`;
      if (isNearby) {
        statusBadgeText = `Truck Nearby (~${Math.max(50, Math.round(distanceMeters / 50) * 50)}m)`;
      } else if (isApproaching30Min) {
        statusBadgeText = `AI ETA: ~${aiEtaMinutes} mins (Approaching)`;
      }

      const simPlate = resolveTruckDisplayName(simState, 'ABB-1235');
      callback({
        hasActiveTruck: true,
        activeTruck: {
          id: simState.driverId || 'active_sim_truck',
          driverId: simState.driverId,
          plate: simPlate,
          barangay: userBarangay,
          currentCoord: truckCoord,
          speedKph,
          locationName: simState.locationName,
        },
        distanceMeters,
        aiEtaMinutes,
        isApproaching30Min,
        isNearby,
        statusBadgeText,
        lastEvaluatedAt: Date.now(),
      });
    });

    return () => {
      unsub();
      unsubSim();
    };
  }

  /**
   * Evaluator / Demonstration test trigger.
   * Can be pressed to simulate a live 30-minute incoming collection alert.
   */
  static async triggerDemoIncomingAlert(
    userId: string,
    userBarangay: string = 'Baliang',
    etaMinutes: number = 30
  ): Promise<void> {
    const truckId = 'demo_truck_cenro_1';
    const plate = 'TT-DANAO-2026';

    await NotificationService.scheduleIncomingTruckNotification({
      truckId,
      truckPlate: plate,
      barangay: userBarangay,
      etaMinutes,
      distanceMeters: 2800,
    });

    if (db && userId) {
      await addDoc(collection(db, 'userNotifications'), {
        userId,
        title: `🚛 Incoming Trash Collection (~${etaMinutes} mins)`,
        body: `AI Arrival Alert: Collection truck ${plate} is approaching Brgy. ${userBarangay}. Estimated arrival in ~${etaMinutes} minutes. Please prepare your segregated waste!`,
        type: 'truck_incoming',
        truckId,
        barangay: userBarangay,
        etaMinutes,
        distanceMeters: 2800,
        read: false,
        createdAt: serverTimestamp(),
      });
    }
  }
}
