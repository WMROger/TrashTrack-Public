export interface FleetInventoryQrPayload {
  app: 'TrashTrack';
  type: 'fleet_inventory' | 'truck_checkout';
  version: '1.0';
  station: string;
  truckId: string;
  plateNumber: string;
  barangay?: string;
  truckType?: string;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
  shiftStartedAt?: any;
  issuedAt: number;
}

export function buildFleetInventoryQrPayload(params: {
  truckId: string;
  plateNumber: string;
  barangay?: string;
  truckType?: string;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
  shiftStartedAt?: any;
}): FleetInventoryQrPayload {
  return {
    app: 'TrashTrack',
    type: 'fleet_inventory',
    version: '1.0',
    station: 'CENRO_DANAO_FLEET_INVENTORY',
    truckId: params.truckId,
    plateNumber: (params.plateNumber || '').trim().toUpperCase(),
    barangay: params.barangay || 'Danao City',
    truckType: params.truckType || 'Compactor',
    assignedDriverId: params.assignedDriverId || null,
    assignedDriverName: params.assignedDriverName || null,
    shiftStartedAt: params.shiftStartedAt ? (typeof params.shiftStartedAt.toDate === 'function' ? params.shiftStartedAt.toDate().toISOString() : params.shiftStartedAt) : null,
    issuedAt: Date.now(),
  };
}

export function encodeFleetInventoryQrString(payload: FleetInventoryQrPayload): string {
  return JSON.stringify(payload);
}

export interface QrVerificationResult {
  valid: boolean;
  error?: string;
  matchedPlate?: string;
  scannedType?: string;
}

/**
 * Validates whether a scanned QR string matches the expected active truck.
 * Accepts:
 * 1. Fleet Inventory QR (app: 'TrashTrack', type: 'fleet_inventory')
 * 2. Driver Credential QR (app: 'TrashTrack', role: 'driver')
 * 3. General JSON with matching plateNumber or truckId
 * 4. Plain text containing the plate number
 */
export function verifyFleetInventoryQr(
  rawScanned: string,
  targetTruck: { id: string; plateNumber: string },
  activeDriverUid?: string
): QrVerificationResult {
  if (!rawScanned || typeof rawScanned !== 'string') {
    return { valid: false, error: 'Empty or unreadable QR code data.' };
  }

  const clean = rawScanned.trim();
  const normalizedTargetPlate = (targetTruck.plateNumber || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const targetTruckId = (targetTruck.id || '').trim();

  // Try JSON parse
  try {
    const parsed = JSON.parse(clean);
    
    // 1. Official Fleet Inventory QR
    if (parsed.app === 'TrashTrack' && (parsed.type === 'fleet_inventory' || parsed.type === 'truck_checkout')) {
      const scannedPlate = (parsed.plateNumber || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const scannedTruckId = (parsed.truckId || '').trim();

      const isMatch =
        (scannedPlate && scannedPlate === normalizedTargetPlate) ||
        (scannedTruckId && scannedTruckId === targetTruckId);

      if (isMatch) {
        return {
          valid: true,
          matchedPlate: parsed.plateNumber || targetTruck.plateNumber,
          scannedType: 'fleet_inventory',
        };
      } else {
        return {
          valid: false,
          error: `Mismatched Vehicle: This Fleet QR is for truck "${parsed.plateNumber || parsed.truckId}", but your active shift is on "${targetTruck.plateNumber}". Please scan the Fleet Inventory QR for your assigned truck.`,
        };
      }
    }

    // 2. Personal Driver Login Badge - explicitly reject for fleet truck verification
    if (parsed.role === 'driver' || parsed.type === 'driver_login' || Boolean(parsed.qrLoginToken)) {
      return {
        valid: false,
        error: `This is a personal Driver Login badge. Please scan the official Fleet Inventory QR badge physically located on or assigned to truck "${targetTruck.plateNumber}".`,
      };
    }

    // 3. Generic JSON with plateNumber or truckId
    if (parsed.plateNumber || parsed.truckId) {
      const scannedPlate = (parsed.plateNumber || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const scannedTruckId = (parsed.truckId || '').trim();

      if (
        (scannedPlate && scannedPlate === normalizedTargetPlate) ||
        (scannedTruckId && scannedTruckId === targetTruckId)
      ) {
        return {
          valid: true,
          matchedPlate: parsed.plateNumber || targetTruck.plateNumber,
          scannedType: 'generic_truck_qr',
        };
      }
    }
  } catch {
    // Not JSON, continue to string match check
  }

  // 4. Fallback string check
  const cleanUpper = clean.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (normalizedTargetPlate && cleanUpper.includes(normalizedTargetPlate)) {
    return {
      valid: true,
      matchedPlate: targetTruck.plateNumber,
      scannedType: 'raw_plate_match',
    };
  }

  return {
    valid: false,
    error: `Invalid QR Code: The scanned code is not recognized as the Fleet Inventory QR for truck "${targetTruck.plateNumber}". Please point your camera at the Fleet Inventory QR badge at the CENRO Dispatch.`,
  };
}

/**
 * Calculates shift duration and formatted timings
 */
export function calculateShiftTiming(
  rawShiftStartedAt: any,
  endTime: Date = new Date()
): {
  timeIn: Date;
  timeOut: Date;
  durationMs: number;
  durationMinutes: number;
  durationFormatted: string;
  timeInFormatted: string;
  timeOutFormatted: string;
} {
  let timeIn: Date;

  if (rawShiftStartedAt) {
    if (typeof rawShiftStartedAt.toDate === 'function') {
      timeIn = rawShiftStartedAt.toDate();
    } else if (rawShiftStartedAt instanceof Date) {
      timeIn = rawShiftStartedAt;
    } else if (typeof rawShiftStartedAt === 'number') {
      timeIn = new Date(rawShiftStartedAt);
    } else if (typeof rawShiftStartedAt === 'string') {
      const parsed = new Date(rawShiftStartedAt);
      timeIn = isNaN(parsed.getTime()) ? new Date(Date.now() - 4 * 3600000) : parsed;
    } else if (rawShiftStartedAt.seconds) {
      timeIn = new Date(rawShiftStartedAt.seconds * 1000);
    } else {
      timeIn = new Date(Date.now() - 4 * 3600000);
    }
  } else {
    // Fallback: 4 hours prior or today morning
    timeIn = new Date(Date.now() - 4 * 3600000);
  }

  const timeOut = endTime;
  const diffMs = Math.max(0, timeOut.getTime() - timeIn.getTime());
  const durationMinutes = Math.round(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);

  const durationFormatted =
    hours > 0
      ? `${hours} hr${hours !== 1 ? 's' : ''} ${minutes} min${minutes !== 1 ? 's' : ''}`
      : `${minutes} min${minutes !== 1 ? 's' : ''}`;

  const formatOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    month: 'short',
    day: 'numeric',
  };

  const timeInFormatted = timeIn.toLocaleString('en-US', formatOptions);
  const timeOutFormatted = timeOut.toLocaleString('en-US', formatOptions);

  return {
    timeIn,
    timeOut,
    durationMs: diffMs,
    durationMinutes,
    durationFormatted,
    timeInFormatted,
    timeOutFormatted,
  };
}

/**
 * Parses and extracts truck data from a Fleet Inventory QR string.
 */
export function parseFleetInventoryQr(rawScanned: string): {
  valid: boolean;
  truckId?: string;
  plateNumber?: string;
  barangay?: string;
  truckType?: string;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
  error?: string;
} {
  if (!rawScanned || typeof rawScanned !== 'string') {
    return { valid: false, error: 'Empty QR code data.' };
  }
  const clean = rawScanned.trim();
  try {
    let jsonStr = clean;
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = clean.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(jsonStr);
    // Explicitly reject personal Driver Credential Badges so they are handled by the Driver QR login flow
    if (parsed.role === 'driver' || Boolean(parsed.qrLoginToken) || parsed.type === 'driver_login') {
      return { valid: false, error: 'This is a personal Driver Login badge, not a Fleet Inventory truck QR. Please scan the official Fleet Inventory QR badge assigned to the truck.' };
    }
    if (parsed.app === 'TrashTrack' && (parsed.type === 'fleet_inventory' || parsed.type === 'truck_checkout')) {
      return {
        valid: true,
        truckId: parsed.truckId,
        plateNumber: parsed.plateNumber,
        barangay: parsed.barangay,
        truckType: parsed.truckType,
        assignedDriverId: parsed.assignedDriverId || null,
        assignedDriverName: parsed.assignedDriverName || null,
      };
    }
    const rawPlate = typeof parsed.plateNumber === 'string' ? parsed.plateNumber.trim() : '';
    const isPlaceholderPlate = !rawPlate || rawPlate.toLowerCase().includes('pending') || rawPlate.toLowerCase() === 'unassigned' || rawPlate.toLowerCase() === 'none';
    if (parsed.truckId || (!isPlaceholderPlate && rawPlate)) {
      return {
        valid: true,
        truckId: parsed.truckId,
        plateNumber: parsed.plateNumber,
        barangay: parsed.barangay,
        truckType: parsed.truckType || parsed.type,
        assignedDriverId: parsed.assignedDriverId || null,
        assignedDriverName: parsed.assignedDriverName || null,
      };
    }
  } catch {
    // If a raw license plate format is scanned or entered (e.g. ABC-1111 or ABC 1111 or ABC1111)
    const cleaned = clean.replace(/[^a-zA-Z0-9-]/g, '').toUpperCase();
    if (/^[A-Z]{3}-?[0-9]{3,4}$/.test(cleaned)) {
      return {
        valid: true,
        plateNumber: cleaned,
      };
    }
  }
  return { valid: false, error: 'Scanned QR code is not a valid TrashTrack Fleet Inventory badge.' };
}
