import { db } from '@/config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

const DRIVER_SESSION_ORIGIN_KEY = '@driver_session_origin';

export type DriverSessionOrigin = 'login' | 'resident';

export async function setDriverSessionOrigin(origin: DriverSessionOrigin): Promise<void> {
  try {
    await AsyncStorage.setItem(DRIVER_SESSION_ORIGIN_KEY, origin);
  } catch (e) {
    console.warn('Failed to set driver session origin:', e);
  }
}

export async function getDriverSessionOrigin(): Promise<DriverSessionOrigin | null> {
  try {
    const origin = await AsyncStorage.getItem(DRIVER_SESSION_ORIGIN_KEY);
    if (origin === 'resident' || origin === 'login') {
      return origin;
    }
  } catch (e) {
    console.warn('Failed to get driver session origin:', e);
  }
  return null;
}

export async function clearDriverSessionOrigin(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DRIVER_SESSION_ORIGIN_KEY);
  } catch (e) {
    console.warn('Failed to clear driver session origin:', e);
  }
}

export interface DriverQrPayload {
  app: 'TrashTrack';
  type?: 'driver_login';
  role: 'driver';
  version: '1.0';
  uid: string;
  email: string;
  employeeId: string;
  name: string;
  qrLoginToken: string;
  authKey?: string;
  assignedBarangay?: string;
  plateNumber?: string;
  issuedAt: number;
  expiresAt?: number;
}

/**
 * Calculates the start and end of the daily 6:00 AM rotation cycle for any given timestamp.
 * A cycle starts at 6:00 AM local time and expires at 6:00 AM the next day.
 */
export function getDaily6amCycle(nowMs: number = Date.now()): { startMs: number; endMs: number } {
  // Fixed Philippine Standard Time (PST / Asia/Manila, UTC+8, no DST).
  // Anchoring strictly to UTC+8 ensures consistent 6:00 AM shift cycles across
  // all platforms, emulators, and browsers regardless of local device timezone.
  const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
  const phtDate = new Date(nowMs + PHT_OFFSET_MS);
  const phtYear = phtDate.getUTCFullYear();
  const phtMonth = phtDate.getUTCMonth();
  let phtDay = phtDate.getUTCDate();
  const phtHours = phtDate.getUTCHours();

  if (phtHours < 6) {
    // Current time is between midnight and 5:59:59 AM PHT; cycle started yesterday at 6:00 AM PHT
    phtDay -= 1;
  }

  const startPhtUtcMs = Date.UTC(phtYear, phtMonth, phtDay, 6, 0, 0, 0) - PHT_OFFSET_MS;
  const endPhtUtcMs = startPhtUtcMs + 24 * 60 * 60 * 1000;

  return { startMs: startPhtUtcMs, endMs: endPhtUtcMs };
}

function sanitizePlateNumber(plate?: string | null): string | undefined {
  if (!plate || typeof plate !== 'string') return undefined;
  const trimmed = plate.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || lower.includes('pending') || lower === 'unassigned' || lower === 'none' || lower === 'n/a') {
    return undefined;
  }
  return trimmed;
}

export function buildDriverQrPayload(params: {
  uid: string;
  email: string;
  employeeId: string;
  name: string;
  qrLoginToken: string;
  authKey?: string;
  assignedBarangay?: string;
  plateNumber?: string;
  expiresAt?: number;
}): DriverQrPayload {
  const now = Date.now();
  const cycle = getDaily6amCycle(now);
  return {
    app: 'TrashTrack',
    type: 'driver_login',
    role: 'driver',
    version: '1.0',
    uid: params.uid,
    email: params.email.trim().toLowerCase(),
    employeeId: params.employeeId.trim().toUpperCase(),
    name: params.name.trim(),
    qrLoginToken: params.qrLoginToken,
    authKey: params.authKey,
    assignedBarangay: params.assignedBarangay,
    plateNumber: sanitizePlateNumber(params.plateNumber),
    issuedAt: now,
    expiresAt: params.expiresAt || cycle.endMs,
  };
}

export function encodeDriverQrString(payload: DriverQrPayload): string {
  return JSON.stringify(payload);
}

export interface DriverQrParseResult {
  valid: boolean;
  isFleetBadge?: boolean;
  fleetPayload?: {
    app: 'TrashTrack';
    type: 'fleet_inventory' | 'truck_checkout';
    truckId: string;
    plateNumber: string;
    station?: string;
    barangay?: string;
    truckType?: string;
    assignedDriverId?: string | null;
    assignedDriverName?: string | null;
  };
  payload?: DriverQrPayload;
  error?: string;
}

export function parseDriverQrString(raw: string): DriverQrParseResult {
  try {
    if (!raw || typeof raw !== 'string') {
      return { valid: false, error: 'Empty or invalid QR code content.' };
    }
    const clean = raw.trim();
    let jsonStr = clean;
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = clean.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(jsonStr);

    if (parsed.app !== 'TrashTrack') {
      return { valid: false, error: 'This QR code is not an official TrashTrack credential.' };
    }

    // 1. Official Fleet Inventory Badge (strictly rejected for Driver Login)
    if (parsed.type === 'fleet_inventory' || parsed.type === 'truck_checkout' || parsed.station === 'CENRO_DANAO_FLEET_INVENTORY') {
      return {
        valid: false,
        isFleetBadge: true,
        fleetPayload: parsed,
        error: 'This is a Fleet Inventory truck QR badge. Driver Login requires your personal Driver QR badge. Please scan or upload your Driver Login badge.',
      };
    }

    // 2. Official Driver Personal Badge
    if (parsed.role !== 'driver' && parsed.type !== 'driver_login') {
      return { valid: false, error: 'This QR code is not an official TrashTrack Driver credential.' };
    }

    if (typeof parsed.uid !== 'string' || !parsed.uid.trim() || typeof parsed.qrLoginToken !== 'string' || !parsed.qrLoginToken) {
      return { valid: false, error: 'This badge is missing the driver ID or security token.' };
    }

    return { valid: true, isFleetBadge: false, payload: parsed as DriverQrPayload };
  } catch {
    return { valid: false, error: 'Could not decode QR code data. Please ensure it is a valid driver QR badge.' };
  }
}

/**
 * Validates a scanned badge and returns credentials or driver profile
 * so the driver enters an authenticated session on Spark plan or with Cloud Functions.
 */
async function attachAssignedFleetTruck(driverObj: any): Promise<any> {
  if (!db || !driverObj?.uid) return driverObj;
  try {
    const qSnap = await getDocs(
      query(collection(db, 'trucks'), where('assignedDriverId', '==', driverObj.uid), limit(1))
    );
    if (!qSnap.empty) {
      const trDoc = qSnap.docs[0];
      const trData = trDoc.data();
      return {
        ...driverObj,
        currentTruckId: trDoc.id,
        currentTruckPlate: trData.plateNumber || driverObj.plateNumber || null,
        plateNumber: trData.plateNumber || driverObj.plateNumber || null,
        assignedBarangay: driverObj.assignedBarangay || trData.assignedBarangay || trData.barangay || '',
      };
    }
  } catch (e) {
    console.warn('attachAssignedFleetTruck lookup warning:', e);
  }
  return {
    ...driverObj,
    currentTruckId: null,
    currentTruckPlate: null,
    plateNumber: null,
  };
}

export async function authenticateDriverQrLogin(payload: DriverQrPayload): Promise<{
  success: boolean;
  customToken?: string;
  authKey?: string;
  driver?: any;
  error?: string;
}> {
  if (!payload.uid || !payload.qrLoginToken) {
    return {
      success: false,
      error: 'Driver QR badge is missing required security tokens.',
    };
  }

  // Check QR expiration against daily 6:00 AM cycle (Asia/Manila PHT)
  const now = Date.now();
  const currentCycle = getDaily6amCycle(now);
  const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5-minute grace period for device clock drift

  // If payload has expiresAt and it is before now (with grace period), reject
  if (payload.expiresAt && (payload.expiresAt + CLOCK_SKEW_TOLERANCE_MS) <= now) {
    return {
      success: false,
      error: 'This Driver QR badge expired at 6:00 AM. Please obtain today’s refreshed QR badge from CENRO.',
    };
  }

  // If payload was issued before the current 6:00 AM cycle started (with grace period), reject
  if (payload.issuedAt && (payload.issuedAt + CLOCK_SKEW_TOLERANCE_MS) < currentCycle.startMs) {
    return {
      success: false,
      error: 'This Driver QR badge expired at 6:00 AM. Please obtain today’s refreshed QR badge from CENRO.',
    };
  }

  // 1. Validation via driver_qr_credentials in Firestore (Primary source of truth for active token)
  if (db && payload.uid) {
    try {
      const snap = await getDoc(doc(db, 'driver_qr_credentials', payload.uid));
      if (snap.exists()) {
        const cred = snap.data();
        const activeToken = cred?.token || '';

        // Token MUST match the active token in driver_qr_credentials
        if (!activeToken || activeToken !== payload.qrLoginToken) {
          return {
            success: false,
            error: 'This Driver QR badge is invalid or has been replaced by CENRO. Please request a new badge.',
          };
        }

        // Verify that the stored credential hasn't expired past 6:00 AM
        const credGeneratedAt = cred?.qrGeneratedAt?.toMillis
          ? cred.qrGeneratedAt.toMillis()
          : (cred?.qrGeneratedAt?.toDate ? cred.qrGeneratedAt.toDate().getTime() : (cred?.qrGeneratedAt || 0));

        if (credGeneratedAt && (credGeneratedAt + CLOCK_SKEW_TOLERANCE_MS) < currentCycle.startMs) {
          return {
            success: false,
            error: 'This Driver QR badge expired at 6:00 AM. Please open your updated badge in CENRO.',
          };
        }

        const driver = await attachAssignedFleetTruck({
          uid: payload.uid,
          email: cred.email || payload.email,
          displayName: payload.name,
          role: 'driver',
          employeeId: payload.employeeId,
          assignedBarangay: payload.assignedBarangay,
          plateNumber: payload.plateNumber,
        });

        return {
          success: true,
          authKey: cred.authKey || payload.authKey,
          driver,
        };
      } else {
        return {
          success: false,
          error: 'Driver credential record not found in system. Please contact CENRO.',
        };
      }
    } catch (e) {
      console.warn('driver_qr_credentials direct lookup error:', e);
    }
  }

  // 3. Fallback: If user doc exists, return driver info so UI can prompt for driver password
  if (db && payload.uid) {
    try {
      const userSnap = await getDoc(doc(db, 'users', payload.uid));
      if (userSnap.exists()) {
        const uData = userSnap.data();
        const driver = await attachAssignedFleetTruck({
          uid: payload.uid,
          email: uData.email || payload.email,
          displayName: uData.displayName || uData.name || payload.name,
          role: 'driver',
          employeeId: payload.employeeId,
          assignedBarangay: uData.assignedBarangay || payload.assignedBarangay,
          plateNumber: uData.currentTruckPlate || payload.plateNumber,
        });
        return {
          success: true,
          driver,
        };
      }
    } catch {}
  }

  // 4. Also check users by employeeId or email if uid was not matched
  if (db && (payload.employeeId || payload.email)) {
    try {
      if (payload.employeeId) {
        const qSnap = await getDocs(
          query(collection(db, 'users'), where('employeeId', '==', payload.employeeId), limit(1))
        );
        if (!qSnap.empty) {
          const uDoc = qSnap.docs[0];
          const uData = uDoc.data();
          const driver = await attachAssignedFleetTruck({
            uid: uDoc.id,
            email: uData.email || payload.email,
            displayName: uData.displayName || uData.name || payload.name,
            role: 'driver',
            employeeId: payload.employeeId,
            assignedBarangay: uData.assignedBarangay || payload.assignedBarangay,
            plateNumber: uData.currentTruckPlate || payload.plateNumber,
          });
          return {
            success: true,
            driver,
          };
        }
      }
      if (payload.email) {
        const qSnap = await getDocs(
          query(collection(db, 'users'), where('email', '==', payload.email.trim().toLowerCase()), limit(1))
        );
        if (!qSnap.empty) {
          const uDoc = qSnap.docs[0];
          const uData = uDoc.data();
          const driver = await attachAssignedFleetTruck({
            uid: uDoc.id,
            email: uData.email || payload.email,
            displayName: uData.displayName || uData.name || payload.name,
            role: 'driver',
            employeeId: uData.employeeId || payload.employeeId,
            assignedBarangay: uData.assignedBarangay || payload.assignedBarangay,
            plateNumber: uData.currentTruckPlate || payload.plateNumber,
          });
          return {
            success: true,
            driver,
          };
        }
      }
    } catch {}
  }

  return {
    success: false,
    error: 'Driver QR credentials could not be verified. Please sign in with your driver email and password.',
  };
}

/**
 * Validates a scanned fleet inventory / truck badge and returns driver details
 * so the driver assigned to that truck enters an authenticated session.
 */
export async function authenticateFleetTruckQrLogin(params: {
  truckId?: string;
  plateNumber?: string;
  assignedDriverId?: string | null;
}): Promise<{
  success: boolean;
  customToken?: string;
  authKey?: string;
  driver?: any;
  truck?: any;
  error?: string;
}> {
  // Direct Spark-plan verification: Check trucks in Firestore
  if (db && (params.truckId || params.plateNumber)) {
    try {
      let truckDoc: any = null;
      if (params.truckId) {
        const snap = await getDoc(doc(db, 'trucks', params.truckId));
        if (snap.exists()) truckDoc = snap;
      }
      if (!truckDoc && params.plateNumber) {
        const cleanPlate = params.plateNumber.trim().toUpperCase();
        const qSnap = await getDocs(
          query(collection(db, 'trucks'), where('plateNumber', '==', cleanPlate), limit(1))
        );
        if (!qSnap.empty) {
          truckDoc = qSnap.docs[0];
        } else {
          const allTrucks = await getDocs(collection(db, 'trucks'));
          const normPlate = cleanPlate.replace(/[^a-zA-Z0-9]/g, '');
          for (const d of allTrucks.docs) {
            const p = (d.data().plateNumber || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            if (p && p === normPlate) {
              truckDoc = d;
              break;
            }
          }
        }
      }

      if (truckDoc) {
        const truckData = truckDoc.data();
        const targetDriverId = truckData.assignedDriverId || params.assignedDriverId || truckData.lastDriverId;
        if (!targetDriverId) {
          return {
            success: false,
            error: `Truck "${truckData.plateNumber || 'vehicle'}" has no assigned driver in CENRO. Please assign a driver in CENRO or scan your Driver QR badge.`,
          };
        }

        let credData: any = null;
        try {
          const credSnap = await getDoc(doc(db, 'driver_qr_credentials', targetDriverId));
          if (credSnap.exists()) credData = credSnap.data();
        } catch {}

        let userData: any = null;
        try {
          const uSnap = await getDoc(doc(db, 'users', targetDriverId));
          if (uSnap.exists()) userData = uSnap.data();
        } catch {}

        const driverEmail = credData?.email || userData?.email || '';
        const driverName = userData?.displayName || userData?.name || truckData.assignedDriverName || truckData.lastDriverName || 'Assigned Driver';

        if (credData?.authKey && driverEmail) {
          return {
            success: true,
            authKey: credData.authKey,
            driver: {
              uid: targetDriverId,
              email: driverEmail,
              displayName: driverName,
              role: 'driver',
              currentTruckId: truckDoc.id,
              currentTruckPlate: truckData.plateNumber,
              assignedBarangay: userData?.assignedBarangay || truckData.assignedBarangay || '',
            },
            truck: {
              id: truckDoc.id,
              ...truckData,
            },
          };
        }

        return {
          success: true,
          driver: {
            uid: targetDriverId,
            email: driverEmail,
            displayName: driverName,
            role: 'driver',
            currentTruckId: truckDoc.id,
            currentTruckPlate: truckData.plateNumber,
            assignedBarangay: userData?.assignedBarangay || truckData.assignedBarangay || '',
          },
          truck: {
            id: truckDoc.id,
            ...truckData,
          },
        };
      }
    } catch (directErr) {
      console.warn('Direct truck lookup error:', directErr);
    }
  }

  return {
    success: false,
    error: `Truck "${params.plateNumber || 'vehicle'}" not found in fleet inventory.`,
  };
}

export function createDriverQrToken(employeeId?: string): string {
  const secureRandom = Array.from(Crypto.getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `TT-DRV-${(employeeId || 'DRV').trim().toUpperCase()}-${secureRandom}`;
}

/**
 * Generates or retrieves an active QR login token for a driver.
 * Automatically rotates the token if the current token was generated before the latest 6:00 AM cycle.
 * Passing forceRotate=true immediately forces a fresh token rotation.
 */
export async function ensureDriverQrToken(
  userId: string,
  employeeId?: string,
  forceRotate: boolean = false
): Promise<string> {
  if (!db || !userId) {
    throw new Error('Driver credentials could not be secured because the database is unavailable.');
  }

  const currentCycle = getDaily6amCycle(Date.now());

  try {
    const credentialRef = doc(db, 'driver_qr_credentials', userId);
    const credentialSnap = await getDoc(credentialRef);

    if (credentialSnap.exists() && !forceRotate) {
      const data = credentialSnap.data();
      const existingToken = typeof data?.token === 'string' ? data.token : '';
      const genTime = data?.qrGeneratedAt?.toMillis
        ? data.qrGeneratedAt.toMillis()
        : (data?.qrGeneratedAt?.toDate ? data.qrGeneratedAt.toDate().getTime() : (data?.qrGeneratedAt || 0));

      // Token is valid only if generated during the current 6:00 AM cycle
      const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
      if (existingToken && genTime && (genTime + CLOCK_SKEW_TOLERANCE_MS) >= currentCycle.startMs) {
        return existingToken;
      }
    }

    // Otherwise, generate a fresh daily token for this 6:00 AM cycle
    const newToken = createDriverQrToken(employeeId);
    await setDoc(credentialRef, {
      token: newToken,
      uid: userId,
      qrGeneratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return newToken;
  } catch (err) {
    console.warn('ensureDriverQrToken warning:', err);
    throw err;
  }
}
