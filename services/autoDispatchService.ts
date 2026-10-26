import { db, auth } from '@/config/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { optimizeBarangayRouteWithTraffic } from './trafficAwareOptimizerService';
import { dieselContext } from './dieselService';

export interface AutoDispatchResult {
  success: boolean;
  dispatched: boolean;
  driverName?: string;
  driverId?: string;
  barangay?: string;
  message: string;
}

let cachedAutoDispatchSetting: boolean | null = null;

/**
 * Checks if autonomous AI dispatch is currently enabled.
 * Defaults to true if no configuration document exists.
 */
export async function isAutoDispatchEnabled(): Promise<boolean> {
  if (!db) return true;
  try {
    const settingRef = doc(db, 'system_settings', 'auto_dispatch');
    const snap = await getDoc(settingRef);
    if (snap.exists()) {
      const data = snap.data();
      cachedAutoDispatchSetting = data.enabled !== false;
      return cachedAutoDispatchSetting;
    }
    return true;
  } catch (error) {
    console.warn('Could not read auto_dispatch setting, defaulting to enabled:', error);
    return cachedAutoDispatchSetting ?? true;
  }
}

/**
 * Updates the global AI Auto-Dispatch toggle setting in Firestore.
 */
export async function setAutoDispatchEnabled(enabled: boolean): Promise<void> {
  cachedAutoDispatchSetting = enabled;
  if (!db) return;
  try {
    const settingRef = doc(db, 'system_settings', 'auto_dispatch');
    await setDoc(
      settingRef,
      {
        enabled,
        updatedByEmail: auth.currentUser?.email || 'admin@cenro.gov.ph',
        updatedByUid: auth.currentUser?.uid || 'cenro_admin',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error('Error saving auto_dispatch setting:', error);
  }
}

/**
 * Automatically slots an acknowledged/verified citizen report into the active driver's live route.
 * 1. Checks if AI Auto-Dispatch is enabled.
 * 2. Checks if an active on-duty driver is assigned to the report's barangay.
 * 3. Runs the Traffic & Lowest Detour AI Optimizer to insert the waypoint into the driver's route.
 * 4. Updates or creates the live dispatch schedule in Firestore.
 * 5. Marks the report as 'in_progress' and sends a push/in-app alert to the driver.
 */
export function deriveReportCollectionCategory(report: any): 'BIODEGRADABLE' | 'NON-BIODEGRADABLE' | 'UNSEGREGATED' {
  const explicitCat = String(
    report?.wasteCategory || report?.aiAnalysis?.collectionCategory || ''
  ).trim().toUpperCase();

  if (explicitCat === 'UNSEGREGATED' || explicitCat === 'MIXED' || report?.isUnsegregated || report?.aiAnalysis?.isUnsegregated) {
    return 'UNSEGREGATED';
  }
  if (explicitCat === 'BIODEGRADABLE') {
    return 'BIODEGRADABLE';
  }
  if (explicitCat === 'NON-BIODEGRADABLE') {
    return 'NON-BIODEGRADABLE';
  }

  const wt = String(report?.aiAnalysis?.wasteType || report?.wasteType || '').toLowerCase();
  if (wt.includes('unsegregated') || wt.includes('mixed')) {
    return 'UNSEGREGATED';
  }
  if (wt.includes('organic') || wt.includes('biodegradable')) {
    return 'BIODEGRADABLE';
  }
  return 'NON-BIODEGRADABLE';
}

export function isScheduleCategoryCompatible(
  scheduleCategoryRaw: string | undefined,
  reportCategory: 'BIODEGRADABLE' | 'NON-BIODEGRADABLE' | 'UNSEGREGATED'
): boolean {
  if (reportCategory === 'UNSEGREGATED') return true; // Unsegregated/Mixed can be picked up by active truck or flagged
  const schedCat = String(scheduleCategoryRaw || '').trim().toUpperCase();
  if (!schedCat || schedCat === 'ALL' || schedCat.includes('CITIZEN REPORTS') || schedCat.includes('MIXED')) {
    return true;
  }
  if (schedCat === 'NON-BIODEGRADABLE' || schedCat === 'RESIDUAL' || schedCat === 'RECYCLABLE' || schedCat === 'SPECIAL') {
    return reportCategory === 'NON-BIODEGRADABLE';
  }
  if (schedCat === 'BIODEGRADABLE' || schedCat === 'ORGANIC') {
    return reportCategory === 'BIODEGRADABLE';
  }
  return true;
}

export async function autoDispatchReportToActiveRoute(report: {
  id: string;
  title?: string;
  street?: string;
  barangay?: string;
  wasteCategory?: string;
  isUnsegregated?: boolean;
  location?: { lat?: number; lng?: number; latitude?: number; longitude?: number } | null;
  aiAnalysis?: { wasteType?: string; collectionCategory?: string; isUnsegregated?: boolean; estimatedWeight?: string; [key: string]: any } | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}): Promise<AutoDispatchResult> {
  if (!db || !report || !report.id) {
    return { success: false, dispatched: false, message: 'Invalid report data or database uninitialized.' };
  }

  const barangay = (report.barangay || '').trim();
  if (!barangay) {
    return { success: false, dispatched: false, message: 'Report has no barangay specified.' };
  }

  const reportCollectionCat = deriveReportCollectionCategory(report);

  const isEnabled = await isAutoDispatchEnabled();
  if (!isEnabled) {
    return {
      success: true,
      dispatched: false,
      barangay,
      message: 'AI Auto-Dispatch is currently turned OFF by CENRO. Report is queued for manual dispatch.',
    };
  }

  try {
    // 1. Find active on-duty driver for this barangay
    const usersRef = collection(db, 'users');
    const qDrivers = query(
      usersRef,
      where('role', '==', 'driver')
    );
    const driversSnap = await getDocs(qDrivers);

    // Also fetch active schedules in this barangay to check Biodegradable vs Non-Biodegradable compatibility
    const schedulesRef = collection(db, 'schedules');
    const qBarangaySchedules = query(
      schedulesRef,
      where('barangay', '==', barangay)
    );
    const barangaySchedulesSnap = await getDocs(qBarangaySchedules);
    const activeBarangaySchedules = barangaySchedulesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .filter((s) => ['in_progress', 'in-progress', 'active', 'scheduled'].includes(String(s.status || '').toLowerCase()));

    let activeDriver: {
      id: string;
      displayName?: string;
      currentTruckId?: string;
      currentTruckPlate?: string;
      assignedBarangay?: string;
    } | null = null;
    let incompatibleScheduleCategory: string | null = null;

    driversSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const dBarangay = (data.assignedBarangay || data.barangay || '').trim().toLowerCase();
      const targetB = barangay.toLowerCase();
      const isBarangayMatch = dBarangay === targetB || dBarangay.includes(targetB) || targetB.includes(dBarangay);
      const hasActiveScheduleInBarangay = activeBarangaySchedules.some(
        (s) => s.assignedDriverId === docSnap.id
      );
      const isBarangayMatched = isBarangayMatch || hasActiveScheduleInBarangay;

      const isOnDuty =
        (data.dutyStatus === 'on_duty' || data.status === 'on_duty') &&
        data.dutyStatus !== 'off_duty' &&
        data.status !== 'off_duty' &&
        data.status !== 'disabled' &&
        data.disabled !== true &&
        data.status !== 'inactive';

      if (isBarangayMatched && isOnDuty && !activeDriver) {
        // Check if this driver has an active routine schedule with a specific wasteCategory
        const driverSchedules = activeBarangaySchedules.filter(
          (s) => s.assignedDriverId === docSnap.id && !s.isLiveDispatch
        );
        if (driverSchedules.length > 0) {
          const matchingSched = driverSchedules.find((s) =>
            isScheduleCategoryCompatible(s.wasteCategory || s.wasteType, reportCollectionCat)
          );
          if (!matchingSched) {
            incompatibleScheduleCategory = driverSchedules[0].wasteCategory || 'Scheduled';
            return; // Skip this driver since their active truck schedule is for a different segregation category
          }
        }

        activeDriver = {
          id: docSnap.id,
          displayName: data.displayName || data.name || 'Assigned Driver',
          currentTruckId: data.currentTruckId || null,
          currentTruckPlate: data.currentTruckPlate || data.assignedTruckPlate || null,
          assignedBarangay: data.assignedBarangay || data.barangay || barangay,
        };
      }
    });

    if (!activeDriver) {
      // Mark report as queued for the next matching driver shift in this barangay
      const reportRef = doc(db, 'reports', report.id);
      const queueReason = incompatibleScheduleCategory
        ? `Queued for ${reportCollectionCat} collection day (Active truck in Brgy. ${barangay} is currently collecting ${incompatibleScheduleCategory}).`
        : `Queued for next ${reportCollectionCat} collection shift in Brgy. ${barangay}.`;

      await updateDoc(reportRef, {
        queuedForDriver: true,
        queuedBarangay: barangay,
        queuedWasteCategory: reportCollectionCat,
        queuedReason: queueReason,
        flaggedForReview: reportCollectionCat === 'UNSEGREGATED',
        updatedAt: serverTimestamp(),
      });

      return {
        success: true,
        dispatched: false,
        barangay,
        message: incompatibleScheduleCategory
          ? `Report is ${reportCollectionCat} and queued for the next matching ${reportCollectionCat} schedule in Brgy. ${barangay} (current truck is collecting ${incompatibleScheduleCategory}).`
          : `Report is acknowledged (${reportCollectionCat}) and queued for Brgy. ${barangay}. Will auto-inject when matching driver starts shift.`,
      };
    }

    const driverName = (activeDriver as any).displayName || 'Assigned Driver';
    const driverId = (activeDriver as any).id;
    const truckPlate = (activeDriver as any).currentTruckPlate || 'TRK-ACTIVE';

    // 2. Fetch any other existing in-progress/acknowledged reports for this barangay to optimize them together
    const reportsRef = collection(db, 'reports');
    const qReports = query(
      reportsRef,
      where('barangay', '==', barangay),
      where('status', 'in', ['acknowledged', 'in_progress', 'in-progress'])
    );
    const existingReportsSnap = await getDocs(qReports);
    const allReportsForSector: any[] = [];

    existingReportsSnap.forEach((d) => {
      if (d.id !== report.id) {
        allReportsForSector.push({ id: d.id, ...d.data() });
      }
    });
    // Add the current report
    allReportsForSector.push(report);

    // 3. Run AI Traffic & Fuel Lowest-Detour Optimization
    const diesel = await dieselContext((activeDriver as any).currentTruckId);
    const optResult = optimizeBarangayRouteWithTraffic(barangay, allReportsForSector, diesel.parameters, diesel.factor, diesel.modelId, diesel.source);

    // 4. Check if an active live dispatch schedule already exists for this driver today
    const qActiveSchedule = query(
      schedulesRef,
      where('assignedDriverId', '==', driverId)
    );
    const scheduleSnap = await getDocs(qActiveSchedule);
    const openTrip = scheduleSnap.docs.find(item => {
      const itemData = item.data();
      const st = String(itemData.status || '').toLowerCase();
      return (
        itemData.isLiveDispatch === true &&
        !itemData.dieselClosedAt &&
        ['in_progress', 'in-progress', 'pending', 'active'].includes(st)
      );
    });

    const today = new Date();
    const dateText = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const formattedStops = optResult.optimizedStops.map((s, idx) => ({
      order: idx + 1,
      name: s.name,
      lat: s.latitude,
      lng: s.longitude,
      type: s.stopType,
      reportId: s.reportId || null,
      timeWindow: s.optimalTimeWindow || 'Routine',
    }));

    if (openTrip) {
      // Update existing live schedule
      const activeSchedDoc = openTrip;
      const openTripData = activeSchedDoc.data();
      const fuelBudget =
        openTripData.fuelBudgetLiters ||
        (openTripData.routeOptimization?.dieselEstimate?.optimized?.liters
          ? Math.round(openTripData.routeOptimization.dieselEstimate.optimized.liters * 1.10 * 100) / 100
          : null);

      // Check if adding this report exceeds the driver's refueled fuel budget
      if (fuelBudget && fuelBudget > 0 && optResult.optimizedFuelLiters > fuelBudget) {
        // Exceeds shift budget; defer to next shift or trip for this barangay
        const reportRef = doc(db, 'reports', report.id);
        await updateDoc(reportRef, {
          queuedForDriver: true,
          queuedForNextShift: true,
          queuedBarangay: barangay,
          queuedReason: `Exceeds current shift diesel capacity (${optResult.optimizedFuelLiters.toFixed(1)} L required vs ${fuelBudget.toFixed(1)} L refueled budget); held for next shift.`,
          updatedAt: serverTimestamp(),
        });

        return {
          success: true,
          dispatched: false,
          driverName,
          driverId,
          barangay,
          message: `Report queued for the next shift in Brgy. ${barangay} because Driver ${driverName} reached safe shift diesel capacity (${fuelBudget.toFixed(1)} L).`,
        };
      }

      await updateDoc(activeSchedDoc.ref, {
        street: `Master AI Collection Route (${optResult.optimizedStops.length} Stops)`,
        wasteCategory: 'Scheduled & Citizen Reports',
        stops: formattedStops,
        fuelBudgetLiters: Math.max(fuelBudget || 0, Math.round(optResult.optimizedFuelLiters * 1.10 * 100) / 100),
        'routeOptimization.stopCount': optResult.optimizedStops.length,
        'routeOptimization.optimizedDistanceKm': optResult.optimizedDistanceKm,
        'routeOptimization.baselineDistanceKm': optResult.baselineDistanceKm,
        'routeOptimization.fuelCostSavedPhp': optResult.fuelCostSavedPhp,
        'routeOptimization.lastReplannedAt': new Date().toISOString(),
        'routeOptimization.fuelSavingsLiters': optResult.fuelSavingsLiters,
        'routeOptimization.timeSavingsMinutes': optResult.timeSavingsMinutes,
        'routeOptimization.roadPolyline': optResult.roadPolyline,
        updatedAt: serverTimestamp(),
      });
    } else {
      // Create new live schedule for driver
      await addDoc(schedulesRef, {
        barangay: barangay,
        street: `Master AI Collection Route (${optResult.optimizedStops.length} Stops)`,
        wasteCategory: 'Scheduled & Citizen Reports',
        timeText: 'Active Route Sequence',
        dateText: dateText,
        status: 'in_progress',
        driver: driverName,
        assignedDriverId: driverId,
        truckId: (activeDriver as any).currentTruckId || null,
        truckPlate: truckPlate,
        isLiveDispatch: true,
        fuelBudgetLiters: Math.round(optResult.optimizedFuelLiters * 1.10 * 100) / 100,
        routeOptimization: {
          method: 'traffic-aware-fuel-optimized',
          ...(diesel.parameters.pricePerLiter > 0 ? { dieselEstimate: optResult.dieselEstimate } : {}),
          baselineDistanceKm: optResult.baselineDistanceKm,
          optimizedDistanceKm: optResult.optimizedDistanceKm,
          fuelSavingsLiters: optResult.fuelSavingsLiters,
          fuelCostSavedPhp: optResult.fuelCostSavedPhp,
          timeSavingsMinutes: optResult.timeSavingsMinutes,
          bottlenecksAvoided: optResult.bottlenecksAvoided,
          stopCount: optResult.optimizedStops.length,
          roadPolyline: optResult.roadPolyline,
        },
        stops: formattedStops,
        createdByUid: auth.currentUser?.uid || 'system_auto_dispatch',
        createdAt: serverTimestamp(),
      });
    }

    // 5. Update the report document status to 'in-progress'
    const reportRef = doc(db, 'reports', report.id);
    await updateDoc(reportRef, {
      status: 'in-progress',
      assignedDriverId: driverId,
      assignedDriverName: driverName,
      assignedTruckPlate: truckPlate,
      queuedForDriver: false,
      dispatchedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 6. Send push & in-app audible notification to driver
    try {
      const driverNotif = {
        userId: driverId,
        type: 'route_waypoint_added',
        title: '🚨 New Pickup Added to Route',
        message: `A verified citizen report (${report.title || 'Trash Report'} at ${report.street || barangay}) was automatically added to your active route at lowest detour.`,
        reportId: report.id,
        barangay: barangay,
        read: false,
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, 'notifications'), driverNotif);
      await addDoc(collection(db, 'userNotifications'), driverNotif);
    } catch (notifErr) {
      console.warn('Could not dispatch driver in-app notification:', notifErr);
    }

    // 7. Record audit activity
    try {
      await addDoc(collection(db, 'client_activity'), {
        type: 'client',
        action: 'Report Auto-Dispatched to Driver',
        category: 'dispatch',
        description: `Verified report at ${report.street || barangay} auto-injected into Driver ${driverName}'s active route (${truckPlate}).`,
        targetId: report.id,
        actorUid: auth.currentUser?.uid || driverId,
        userEmail: auth.currentUser?.email || 'ai_dispatcher@trashtrack.gov.ph',
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
    } catch (auditErr) {
      console.warn('Audit activity log warning:', auditErr);
    }

    return {
      success: true,
      dispatched: true,
      driverName,
      driverId,
      barangay,
      message: `Auto-dispatched to ${driverName} in Brgy. ${barangay} with smart detour route insertion.`,
    };
  } catch (error: any) {
    console.warn('Error during auto-dispatch (non-fatal):', error);
    return {
      success: false,
      dispatched: false,
      barangay,
      message: `Failed to auto-dispatch: ${error?.message || error}`,
    };
  }
}

/**
 * Automatically bundles all waiting/queued verified reports for a barangay into a driver's initial shift schedule.
 * Called immediately when a driver starts their shift in select-truck.tsx.
 */
export async function autoAssignQueuedReportsOnDriverShiftStart(
  driverId: string,
  barangay: string,
  truckId?: string | null,
  truckPlate?: string | null
): Promise<{ bundledCount: number; message: string }> {
  if (!db || !driverId || !barangay) {
    return { bundledCount: 0, message: 'Invalid arguments for shift start auto-assignment.' };
  }

  const isEnabled = await isAutoDispatchEnabled();
  if (!isEnabled) {
    return { bundledCount: 0, message: 'AI Auto-Dispatch is currently turned off.' };
  }

  try {
    // 1. Query all acknowledged reports waiting in this barangay
    const reportsRef = collection(db, 'reports');
    const qQueued = query(
      reportsRef,
      where('barangay', '==', barangay),
      where('status', 'in', ['acknowledged', 'pending'])
    );
    const snap = await getDocs(qQueued);

    if (snap.empty) {
      return { bundledCount: 0, message: 'No queued reports for this barangay.' };
    }

    // Check if the driver has a routine schedule for a specific wasteCategory (Biodegradable vs Non-Biodegradable)
    const schedulesRef = collection(db, 'schedules');
    const qDriverRoutine = query(
      schedulesRef,
      where('assignedDriverId', '==', driverId)
    );
    const driverRoutineSnap = await getDocs(qDriverRoutine);
    const routineSchedules = driverRoutineSnap.docs
      .map((d) => d.data())
      .filter((s) => !s.isLiveDispatch && ['in_progress', 'in-progress', 'active', 'scheduled'].includes(String(s.status || '').toLowerCase()));

    const queuedReports: any[] = [];
    snap.forEach((d) => {
      const rData = { id: d.id, ...d.data() };
      const rCat = deriveReportCollectionCategory(rData);
      if (routineSchedules.length > 0) {
        const isCompatible = routineSchedules.some((s) =>
          isScheduleCategoryCompatible(s.wasteCategory || s.wasteType, rCat)
        );
        if (!isCompatible) return; // Hold report for its matching schedule day
      }
      queuedReports.push(rData);
    });

    if (queuedReports.length === 0) {
      return { bundledCount: 0, message: 'No queued reports matching current shift waste category.' };
    }

    // 2. Run AI Traffic & Detour Optimization
    const diesel = await dieselContext(truckId || undefined);
    const optResult = optimizeBarangayRouteWithTraffic(barangay, queuedReports, diesel.parameters, diesel.factor, diesel.modelId, diesel.source);

    const today = new Date();
    const dateText = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const formattedStops = optResult.optimizedStops.map((s, idx) => ({
      order: idx + 1,
      name: s.name,
      lat: s.latitude,
      lng: s.longitude,
      type: s.stopType,
      reportId: s.reportId || null,
      timeWindow: s.optimalTimeWindow || 'Routine',
    }));

    // 3. Create/update active schedule for the driver
    const qActiveSched = query(
      schedulesRef,
      where('assignedDriverId', '==', driverId),
      where('status', '==', 'in_progress')
    );
    const activeSchedSnap = await getDocs(qActiveSched);
    const openTrip = activeSchedSnap.docs.find(item => item.data().isLiveDispatch && !item.data().dieselClosedAt);

    if (openTrip) {
      const activeDoc = openTrip;
      await updateDoc(activeDoc.ref, {
        street: `Master AI Collection Route (${optResult.optimizedStops.length} Stops)`,
        wasteCategory: 'Scheduled & Citizen Reports',
        stops: formattedStops,
        fuelBudgetLiters: Math.round(optResult.optimizedFuelLiters * 1.10 * 100) / 100,
        'routeOptimization.stopCount': optResult.optimizedStops.length,
        'routeOptimization.optimizedDistanceKm': optResult.optimizedDistanceKm,
        'routeOptimization.baselineDistanceKm': optResult.baselineDistanceKm,
        'routeOptimization.fuelCostSavedPhp': optResult.fuelCostSavedPhp,
        'routeOptimization.lastReplannedAt': new Date().toISOString(),
        'routeOptimization.fuelSavingsLiters': optResult.fuelSavingsLiters,
        'routeOptimization.timeSavingsMinutes': optResult.timeSavingsMinutes,
        'routeOptimization.roadPolyline': optResult.roadPolyline,
        updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(schedulesRef, {
        barangay,
        street: `Master AI Collection Route (${optResult.optimizedStops.length} Stops)`,
        wasteCategory: 'Scheduled & Citizen Reports',
        timeText: 'Shift Master Route',
        dateText,
        status: 'in_progress',
        assignedDriverId: driverId,
        truckId: truckId || null,
        truckPlate: truckPlate || 'TRK-01',
        isLiveDispatch: true,
        fuelBudgetLiters: Math.round(optResult.optimizedFuelLiters * 1.10 * 100) / 100,
        routeOptimization: {
          method: 'traffic-aware-fuel-optimized',
          ...(diesel.parameters.pricePerLiter > 0 ? { dieselEstimate: optResult.dieselEstimate } : {}),
          baselineDistanceKm: optResult.baselineDistanceKm,
          optimizedDistanceKm: optResult.optimizedDistanceKm,
          fuelSavingsLiters: optResult.fuelSavingsLiters,
          fuelCostSavedPhp: optResult.fuelCostSavedPhp,
          timeSavingsMinutes: optResult.timeSavingsMinutes,
          bottlenecksAvoided: optResult.bottlenecksAvoided,
          stopCount: optResult.optimizedStops.length,
          roadPolyline: optResult.roadPolyline,
        },
        stops: formattedStops,
        createdByUid: driverId,
        createdAt: serverTimestamp(),
      });
    }

    // 4. Update all queued reports to 'in-progress' and assign to driver
    const updatePromises = queuedReports.map(async (r) => {
      try {
        const rRef = doc(db, 'reports', r.id);
        await updateDoc(rRef, {
          status: 'in-progress',
          assignedDriverId: driverId,
          assignedTruckPlate: truckPlate || null,
          queuedForDriver: false,
          dispatchedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (rErr) {
        console.warn(`[AutoDispatch] Could not assign queued report ${r.id}:`, rErr);
      }
    });
    await Promise.all(updatePromises);

    // 5. Audit log
    try {
      await addDoc(collection(db, 'client_activity'), {
        type: 'client',
        action: 'Driver Shift Start Auto-Bundle',
        category: 'dispatch',
        description: `AI automatically bundled ${queuedReports.length} queued verified citizen report(s) into Driver's initial route for Brgy. ${barangay}.`,
        targetId: driverId,
        actorUid: auth.currentUser?.uid || driverId,
        userEmail: auth.currentUser?.email || 'driver@trashtrack.gov.ph',
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
    } catch (auditErr) {
      console.warn('Audit activity log note:', auditErr);
    }

    return {
      bundledCount: queuedReports.length,
      message: `AI bundled ${queuedReports.length} queued reports into your active route.`,
    };
  } catch (error: any) {
    console.warn('Auto-bundling queued reports on shift start note:', error);
    return { bundledCount: 0, message: `Auto-bundle note: ${error?.message || error}` };
  }
}

/**
 * Strips a report waypoint from a driver's active collection route in Firestore.
 */
export async function removeReportFromDriverActiveSchedule(driverId: string, reportId: string): Promise<void> {
  if (!db || !driverId || !reportId) return;
  try {
    const schedulesRef = collection(db, 'schedules');
    const qActive = query(
      schedulesRef,
      where('assignedDriverId', '==', driverId),
      where('status', '==', 'in_progress')
    );
    const snap = await getDocs(qActive);
    for (const d of snap.docs) {
      const data = d.data();
      if (Array.isArray(data.stops)) {
        const filteredStops = data.stops
          .filter((s: any) => s.reportId !== reportId)
          .map((s: any, idx: number) => ({ ...s, order: idx + 1 }));

        if (filteredStops.length !== data.stops.length) {
          await updateDoc(d.ref, {
            stops: filteredStops,
            'routeOptimization.stopCount': filteredStops.length,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }
  } catch (err) {
    console.warn('removeReportFromDriverActiveSchedule error:', err);
  }
}

/**
 * Reverts an uncollected in-progress report back to the acknowledged dispatch queue (Shopee-style fallback).
 * Strips the stop from the old driver's terminal and notifies the resident.
 */
export async function revertReportToQueue(
  reportId: string,
  reason = 'Pickup not completed during shift. Rescheduled for next dispatch.',
  notifyResident = true
): Promise<boolean> {
  if (!db || !reportId) return false;
  try {
    const reportRef = doc(db, 'reports', reportId);
    const reportSnap = await getDoc(reportRef);
    if (!reportSnap.exists()) return false;

    const data = reportSnap.data();
    const oldDriverId = data.assignedDriverId || null;
    const oldDriverName = data.assignedDriverName || 'Driver';
    const citizenUid = data.userId || (data as any).reportedByUid;
    const locationText = data.street ? `${data.street}, Brgy. ${data.barangay || ''}` : `Brgy. ${data.barangay || ''}`;

    // 1. Revert report status to 'acknowledged' and clear driver assignment
    await updateDoc(reportRef, {
      status: 'acknowledged',
      assignedDriverId: null,
      assignedDriverName: null,
      assignedTruckPlate: null,
      queuedForDriver: true,
      queuedReason: reason,
      updatedAt: serverTimestamp(),
    });

    // 2. Remove stop from old driver's active route if assigned
    if (oldDriverId) {
      await removeReportFromDriverActiveSchedule(oldDriverId, reportId);
    }

    // 3. Send Shopee-style reschedule notification to resident
    if (notifyResident && citizenUid) {
      const payload = {
        userId: citizenUid,
        title: '📦 Pickup Rescheduled',
        body: `Your waste collection at ${locationText} was not completed during today's driver route. It has been safely returned to the dispatch queue for the next scheduled route.`,
        type: 'pickup_rescheduled',
        reportId: reportId,
        read: false,
        createdAt: serverTimestamp(),
      };
      try {
        await addDoc(collection(db, 'userNotifications'), payload);
        await addDoc(collection(db, 'notifications'), payload);
      } catch (notifErr) {
        console.warn('Could not send resident reschedule notification:', notifErr);
      }
    }

    // 4. Log in client_activity audit trail
    try {
      await addDoc(collection(db, 'client_activity'), {
        type: 'client',
        action: 'Report Returned to Queue (Shopee Fallback)',
        category: 'dispatch',
        description: `Report at ${locationText} was returned to dispatch queue (${reason}). Previous driver: ${oldDriverName}.`,
        targetId: reportId,
        actorUid: auth.currentUser?.uid || 'system',
        userEmail: auth.currentUser?.email || 'cenro@trashtrack.gov.ph',
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
    } catch {
      // safe fallback
    }

    return true;
  } catch (error) {
    console.error('revertReportToQueue error:', error);
    return false;
  }
}

/**
 * Reassigns an in-progress or queued report to a new driver.
 * Strips the stop from the old driver's terminal and notifies the resident of the new driver.
 */
export async function reassignReportToDriver(
  reportId: string,
  newDriver: { id: string; displayName: string; currentTruckPlate?: string | null },
  notifyResident = true
): Promise<boolean> {
  if (!db || !reportId || !newDriver?.id) return false;
  try {
    const reportRef = doc(db, 'reports', reportId);
    const reportSnap = await getDoc(reportRef);
    if (!reportSnap.exists()) return false;

    const data = reportSnap.data();
    const oldDriverId = data.assignedDriverId || null;
    const citizenUid = data.userId || (data as any).reportedByUid;
    const locationText = data.street ? `${data.street}, Brgy. ${data.barangay || ''}` : `Brgy. ${data.barangay || ''}`;

    // 1. Strip stop from old driver's active route schedule if different
    if (oldDriverId && oldDriverId !== newDriver.id) {
      await removeReportFromDriverActiveSchedule(oldDriverId, reportId);
    }

    // 2. Update report document
    await updateDoc(reportRef, {
      status: 'in-progress',
      assignedDriverId: newDriver.id,
      assignedDriverName: newDriver.displayName,
      assignedTruckPlate: newDriver.currentTruckPlate || '',
      queuedForDriver: false,
      dispatchedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 2b. Inject stop into new driver's active route in 'schedules' if currently on shift
    try {
      const schedulesRef = collection(db, 'schedules');
      const qDriverSchedules = query(
        schedulesRef,
        where('assignedDriverId', '==', newDriver.id)
      );
      const schedSnap = await getDocs(qDriverSchedules);
      const activeTrip = schedSnap.docs.find((d) => {
        const sData = d.data();
        const st = String(sData.status || '').toLowerCase();
        return (
          sData.isLiveDispatch &&
          !sData.dieselClosedAt &&
          ['in_progress', 'in-progress', 'pending', 'active'].includes(st)
        );
      });

      if (activeTrip) {
        const tripData = activeTrip.data();
        const existingStops = Array.isArray(tripData.stops) ? [...tripData.stops] : [];
        const alreadyInRoute = existingStops.some(
          (s) => s.reportId === reportId || s.id === `report-${reportId}`
        );

        if (!alreadyInRoute) {
          const rawLat =
            data.location?.lat ??
            data.location?.latitude ??
            data.latitude ??
            10.5186;
          const rawLng =
            data.location?.lng ??
            data.location?.longitude ??
            data.longitude ??
            124.0272;

          const newStop = {
            order: existingStops.length + 1,
            name: `Citizen Report: ${data.title || data.street || 'Waste Cluster'}`,
            lat: Number(rawLat),
            lng: Number(rawLng),
            type: 'verified_report',
            reportId: reportId,
            street: data.street || '',
            barangay: data.barangay || tripData.barangay || 'Danao City',
            timeWindow: 'Insert Priority Stop',
            priority: data.priority || 'high',
            wasteType: data.aiAnalysis?.wasteType || data.wasteType || 'Unsegregated Solid Waste',
          };

          if (existingStops.length > 1) {
            existingStops.splice(existingStops.length - 1, 0, newStop);
          } else {
            existingStops.push(newStop);
          }

          const reorderedStops = existingStops.map((s, idx) => ({
            ...s,
            order: idx + 1,
          }));

          await updateDoc(activeTrip.ref, {
            stops: reorderedStops,
            street: `Master AI Collection Route (${reorderedStops.length} Stops)`,
            'routeOptimization.stopCount': reorderedStops.length,
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch (schedInjectErr) {
      console.warn('Could not inject report stop into driver active schedule:', schedInjectErr);
    }

    // 2c. Send immediate notification to new assigned driver
    try {
      const driverNotif = {
        userId: newDriver.id,
        type: 'route_waypoint_added',
        title: '🚨 New Pickup Added to Route',
        message: `A citizen report (${data.title || 'Trash Report'} at ${locationText}) was assigned to your active route.`,
        reportId: reportId,
        barangay: data.barangay || '',
        read: false,
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, 'notifications'), driverNotif);
      await addDoc(collection(db, 'userNotifications'), driverNotif);
    } catch (notifErr) {
      console.warn('Could not send driver notification:', notifErr);
    }

    // 3. Notify resident of the driver reassignment
    if (notifyResident && citizenUid) {
      const truckInfo = newDriver.currentTruckPlate ? ` (Truck ${newDriver.currentTruckPlate})` : '';
      const payload = {
        userId: citizenUid,
        title: '🚚 Driver Reassigned',
        body: `Your pickup at ${locationText} has been transferred to Driver ${newDriver.displayName}${truckInfo}.`,
        type: 'driver_reassigned',
        reportId: reportId,
        read: false,
        createdAt: serverTimestamp(),
      };
      try {
        await addDoc(collection(db, 'userNotifications'), payload);
        await addDoc(collection(db, 'notifications'), payload);
      } catch (notifErr) {
        console.warn('Could not send resident reassignment notification:', notifErr);
      }
    }

    // 4. Log in client_activity audit trail
    try {
      await addDoc(collection(db, 'client_activity'), {
        type: 'client',
        action: 'Report Reassigned to Driver',
        category: 'dispatch',
        description: `Report at ${locationText} transferred from ${data.assignedDriverName || 'Previous Driver'} to Driver ${newDriver.displayName}.`,
        targetId: reportId,
        actorUid: auth.currentUser?.uid || 'coordinator',
        userEmail: auth.currentUser?.email || 'coordinator@trashtrack.gov.ph',
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
    } catch {
      // safe fallback
    }

    return true;
  } catch (error) {
    console.error('reassignReportToDriver error:', error);
    return false;
  }
}

/**
 * Automatically reverts all uncompleted in-progress reports assigned to a driver when they end their shift.
 */
export async function revertUncollectedReportsOnDriverShiftEnd(driverId: string): Promise<number> {
  if (!db || !driverId) return 0;
  try {
    const reportsRef = collection(db, 'reports');
    const qUncollected = query(
      reportsRef,
      where('assignedDriverId', '==', driverId)
    );
    const snap = await getDocs(qUncollected);
    let revertedCount = 0;

    for (const d of snap.docs) {
      const st = String(d.data().status || '').toLowerCase().replace(/_/g, '-');
      if (st === 'in-progress' || st === 'pending') {
        const ok = await revertReportToQueue(d.id, 'Driver completed shift/logged off before pickup. Rescheduled for next dispatch.');
        if (ok) revertedCount++;
      }
    }

    return revertedCount;
  } catch (error) {
    console.warn('revertUncollectedReportsOnDriverShiftEnd error:', error);
    return 0;
  }
}

/**
 * Normalizes a barangay name for consistent comparison.
 */
function normalizeBarangayName(str?: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/^brgy\.?\s*/i, '')
    .replace(/^barangay\s*/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Handles driver reassignment to a new barangay.
 * 1. Finds all active schedules assigned to this driver that belong to a DIFFERENT barangay.
 * 2. Cancels those out-of-barangay schedules so they are removed from the driver's schedule.
 * 3. Identifies any associated reports from those schedules (or any report in 'reports' assigned to this driver in a different barangay).
 * 4. Updates their status to 'pickup_not_successful' with reason 'Driver was reassigned to Brgy. <newBarangay>', clears driver assignment.
 * 5. Cleans up any barangay_schedules documents where this driver is assigned outside the new barangay.
 * 6. Sends notifications to the residents and logs to client_activity.
 */
export async function handleDriverBarangayReassignment(
  driverId: string,
  newBarangay: string
): Promise<{ cancelledSchedulesCount: number; affectedReportsCount: number }> {
  if (!db || !driverId) return { cancelledSchedulesCount: 0, affectedReportsCount: 0 };

  const normNewBrgy = normalizeBarangayName(newBarangay);
  let cancelledSchedulesCount = 0;
  let affectedReportsCount = 0;

  try {
    // Fetch driver details to enable matching by name/email in case legacy schedules lack assignedDriverId
    let driverDisplayName = '';
    let driverEmail = '';
    try {
      const driverDocSnap = await getDoc(doc(db, 'users', driverId));
      if (driverDocSnap.exists()) {
        const dData = driverDocSnap.data();
        driverDisplayName = String(dData.displayName || dData.name || dData.fullName || '').trim().toLowerCase();
        driverEmail = String(dData.email || '').trim().toLowerCase();
      }
    } catch (dErr) {
      console.warn('handleDriverBarangayReassignment: Could not fetch driver user doc:', dErr);
    }

    // 0. Clean up any existing barangay_schedules where this driver is assigned to a different barangay
    try {
      const bSchedRef = collection(db, 'barangay_schedules');
      const bSchedSnap = await getDocs(bSchedRef);

      for (const bDoc of bSchedSnap.docs) {
        const bData = bDoc.data();
        const bName = normalizeBarangayName(bData.barangayName || bData.barangay);
        if (!bName || !normNewBrgy || bName === normNewBrgy) continue;

        let needsUpdate = false;
        const updates: any = {};

        const isWeeklyMatch =
          bData.assignedDriverId === driverId ||
          (driverDisplayName && String(bData.assignedDriverName || '').trim().toLowerCase() === driverDisplayName) ||
          (driverEmail && String(bData.assignedDriverEmail || '').trim().toLowerCase() === driverEmail);

        if (isWeeklyMatch) {
          updates.assignedDriverId = null;
          updates.assignedDriverName = null;
          updates.assignedDriverEmail = null;
          needsUpdate = true;
        }

        if (Array.isArray(bData.specificSchedules) && bData.specificSchedules.length > 0) {
          const hasSpecificMatch = bData.specificSchedules.some(
            (ss: any) =>
              ss.assignedDriverId === driverId ||
              (driverDisplayName && String(ss.assignedDriverName || '').trim().toLowerCase() === driverDisplayName) ||
              (driverEmail && String(ss.assignedDriverEmail || '').trim().toLowerCase() === driverEmail)
          );
          if (hasSpecificMatch) {
            updates.specificSchedules = bData.specificSchedules.map((ss: any) => {
              const ssMatch =
                ss.assignedDriverId === driverId ||
                (driverDisplayName && String(ss.assignedDriverName || '').trim().toLowerCase() === driverDisplayName) ||
                (driverEmail && String(ss.assignedDriverEmail || '').trim().toLowerCase() === driverEmail);
              if (ssMatch) {
                return {
                  ...ss,
                  assignedDriverId: null,
                  assignedDriverName: null,
                  assignedDriverEmail: null,
                };
              }
              return ss;
            });
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          updates.updatedAt = serverTimestamp();
          await updateDoc(bDoc.ref, updates);
        }
      }
    } catch (bsErr) {
      console.warn('handleDriverBarangayReassignment: Could not clean barangay_schedules:', bsErr);
    }

    // 1. Query schedules assigned to this driver
    const schedulesRef = collection(db, 'schedules');
    const qSchedules = query(
      schedulesRef,
      where('assignedDriverId', '==', driverId)
    );
    const schedSnap = await getDocs(qSchedules);


    const affectedReportIds = new Set<string>();

    for (const sDoc of schedSnap.docs) {
      const sData = sDoc.data();
      const schedStatus = String(sData.status || '').toLowerCase();
      // Skip completed or already cancelled schedules
      if (schedStatus === 'completed' || schedStatus === 'cancelled') continue;

      const schedBrgy = String(sData.barangay || sData.barangayName || '').toLowerCase().replace(/^brgy\.?\s*/i, '').trim();

      // If this schedule is in a different barangay than the driver's new assigned barangay:
      if (schedBrgy && normNewBrgy && schedBrgy !== normNewBrgy) {
        // Collect report IDs from stops
        const stops = Array.isArray(sData.stops) ? sData.stops : [];
        for (const st of stops) {
          if (st.reportId && st.status !== 'completed' && st.status !== 'done') {
            affectedReportIds.add(st.reportId);
          }
        }

        // Cancel this schedule
        await updateDoc(sDoc.ref, {
          status: 'cancelled',
          cancellationReason: `Driver was reassigned to Brgy. ${newBarangay}`,
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        cancelledSchedulesCount++;
      }
    }

    // 2. Also query any reports currently assigned to this driver that belong to a different barangay
    const reportsRef = collection(db, 'reports');
    const qReports = query(
      reportsRef,
      where('assignedDriverId', '==', driverId)
    );
    const repSnap = await getDocs(qReports);

    for (const rDoc of repSnap.docs) {
      const rData = rDoc.data();
      const repStatus = String(rData.status || '').toLowerCase().replace(/_/g, '-');
      if (repStatus === 'resolved' || repStatus === 'declined' || repStatus === 'pickup-not-successful') continue;

      const repBrgy = String(rData.barangay || '').toLowerCase().replace(/^brgy\.?\s*/i, '').trim();
      if (repBrgy && normNewBrgy && repBrgy !== normNewBrgy) {
        affectedReportIds.add(rDoc.id);
      }
    }

    // 3. Update all affected reports to 'pickup_not_successful' and notify residents
    for (const repId of affectedReportIds) {
      try {
        const reportRef = doc(db, 'reports', repId);
        const reportSnap = await getDoc(reportRef);
        if (!reportSnap.exists()) continue;

        const reportData = reportSnap.data();
        const repStatus = String(reportData.status || '').toLowerCase().replace(/_/g, '-');
        if (repStatus === 'resolved' || repStatus === 'declined') continue;

        const citizenUid = reportData.userId || reportData.reportedByUid;
        const locationText = reportData.street
          ? `${reportData.street}, Brgy. ${reportData.barangay || ''}`
          : `Brgy. ${reportData.barangay || ''}`;

        await updateDoc(reportRef, {
          status: 'pickup_not_successful',
          assignedDriverId: null,
          assignedDriverName: null,
          assignedTruckPlate: null,
          unsuccessfulReason: `Driver was reassigned to Brgy. ${newBarangay}. Pickup not successful.`,
          failedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        affectedReportsCount++;

        // Send resident notification
        if (citizenUid) {
          const payload = {
            userId: citizenUid,
            title: '⚠️ Pickup Not Successful',
            body: `Your pickup at ${locationText} was not completed as the assigned driver was reassigned to Brgy. ${newBarangay}. CENRO has been alerted to review and reschedule.`,
            type: 'pickup_not_successful',
            reportId: repId,
            read: false,
            createdAt: serverTimestamp(),
          };
          try {
            await addDoc(collection(db, 'userNotifications'), payload);
            await addDoc(collection(db, 'notifications'), payload);
          } catch (notifErr) {
            console.warn('Could not send resident notification:', notifErr);
          }
        }

        // Activity log
        try {
          await addDoc(collection(db, 'client_activity'), {
            type: 'client',
            action: 'Pickup Not Successful (Driver Reassigned)',
            category: 'dispatch',
            description: `Report at ${locationText} set to pickup_not_successful due to driver reassignment to Brgy. ${newBarangay}.`,
            targetId: repId,
            actorUid: auth?.currentUser?.uid || 'system',
            userEmail: auth?.currentUser?.email || 'cenro@trashtrack.gov.ph',
            timestamp: serverTimestamp(),
            createdAt: serverTimestamp(),
          });
        } catch {
          // safe fallback
        }
      } catch (repErr) {
        console.warn(`Error updating report ${repId} on driver reassignment:`, repErr);
      }
    }

    return { cancelledSchedulesCount, affectedReportsCount };
  } catch (error) {
    console.error('handleDriverBarangayReassignment error:', error);
    return { cancelledSchedulesCount, affectedReportsCount };
  }
}

