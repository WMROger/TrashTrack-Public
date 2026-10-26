import { useAuthContext } from '@/components/AuthContext';
import OpenStreetMap, { OpenStreetMapRef } from '@/components/OpenStreetMap';
import CompletePickupModal from '@/components/driver/CompletePickupModal';
import DriveModeSelectModal from '@/components/driver/DriveModeSelectModal';
import { db, auth } from '@/config/firebase';
import { useTheme } from '@/hooks/useTheme';
import { locationService, SimulationState, DANAO_SIMULATION_ROUTE } from '@/services/locationService';
import { getBarangaySimulationRoute } from '@/constants/barangaySimulationRoutes';
import { getRoadPolylineForBarangay } from '@/services/osrmRoutingService';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { addDoc, collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { isRawFirestoreIdOrUuid } from '@/services/incomingCollectionService';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  subscribeToSystemOverrides,
  SystemOverridesData,
  DEFAULT_OVERRIDES,
} from '@/services/systemOverridesService';
import { getDriverSessionOrigin, clearDriverSessionOrigin } from '@/services/driverQrService';

type Coordinate = { latitude: number; longitude: number };

type RouteStop = {
  id: string;
  scheduleId?: string;
  reportId?: string | null;
  street: string;
  barangay: string;
  wasteCategory: string;
  status: string;
  routeOrder: number;
  isLiveDispatch: boolean;
  location?: { lat?: number; lng?: number; latitude?: number; longitude?: number } | null;
  routeOptimization?: {
    estimatedDistanceKm?: number;
    estimatedDurationMinutes?: number;
    method?: string;
    provider?: string;
    roadPolyline?: Coordinate[];
  } | null;
};

const DANAO_CENTER: Coordinate = { latitude: 10.5200, longitude: 124.0270 };

function haversineMeters(c1: Coordinate, c2: Coordinate): number {
  const R = 6371000;
  const dLat = ((c2.latitude - c1.latitude) * Math.PI) / 180;
  const dLng = ((c2.longitude - c1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((c1.latitude * Math.PI) / 180) *
      Math.cos((c2.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function coordinateOf(stop: RouteStop): Coordinate | null {
  const latitude = stop.location?.lat ?? stop.location?.latitude;
  const longitude = stop.location?.lng ?? stop.location?.longitude;
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude: Number(latitude), longitude: Number(longitude) }
    : null;
}

function formatMinutesSeconds(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.floor(Math.max(0, sec) % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function DriverRouteMap() {
  // Keep phone screen awake during navigation to comply with Hands-Free Driving (RA 10913)
  useKeepAwake();

  const router = useRouter();
  const params = useLocalSearchParams<{
    scheduleId?: string | string[];
    autoDrive?: string;
    driveMode?: string;
    targetBarangay?: string;
    routeVariant?: string;
  }>();
  const requestedScheduleId = Array.isArray(params.scheduleId) ? params.scheduleId[0] : params.scheduleId;
  const { user } = useAuthContext();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const mapRef = useRef<any>(null);

  const [stops, setStops] = useState<RouteStop[]>([]);
  const [selectedId, setSelectedId] = useState(requestedScheduleId || '');
  const [truckCoordinate, setTruckCoordinate] = useState<Coordinate | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [simulationState, setSimulationState] = useState<SimulationState>(locationService.getSimulationState());
  const [isActualDriving, setIsActualDriving] = useState<boolean>(locationService.isGpsTracking());
  const [showDriveModeModal, setShowDriveModeModal] = useState<boolean>(false);
  const [actualSpeedKph, setActualSpeedKph] = useState<number>(0);
  const [isCockpitMode, setIsCockpitMode] = useState<boolean>(true);
  const [assignedTruckPlate, setAssignedTruckPlate] = useState<string>('TRUCK-DANAO-01');
  const [assignedTruckId, setAssignedTruckId] = useState<string>('');
  const autoDriveTriggeredRef = useRef(false);

  const initialVariant: 'whole' | 'original' | 'direct' =
    params.routeVariant === 'direct' ? 'direct' : (params.routeVariant === 'original' ? 'original' : 'whole');
  const [selectedRouteVariant, setSelectedRouteVariant] = useState<'whole' | 'original' | 'direct'>(initialVariant);

  useEffect(() => {
    return locationService.onSimulationChange((state) => {
      setSimulationState({ ...state });
      if (state.currentCoordinate) {
        setTruckCoordinate(state.currentCoordinate);
      }
    });
  }, []);

  const [driverAssignedBarangay, setDriverAssignedBarangay] = useState<string>((user as any)?.assignedBarangay || (user as any)?.barangay || '');
  const [isShiftActive, setIsShiftActive] = useState<boolean>(false);

  const effectiveBarangay = (params.targetBarangay || driverAssignedBarangay || (user as any)?.assignedBarangay || (user as any)?.barangay || 'Baliang').trim();

  // Road-snapped geometry fetched from OSRM to curve realistically along Danao City streets
  const [roadSnappedPolyline, setRoadSnappedPolyline] = useState<Coordinate[]>([]);
  // Route polyline visibility toggle (hidden by default for clean map view)
  const [showRouteLine, setShowRouteLine] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;
    const routeKey = effectiveBarangay.toLowerCase().includes('baliang')
      ? (selectedRouteVariant === 'direct' ? 'Baliang_Direct' : (selectedRouteVariant === 'original' ? 'Baliang_Original' : 'Baliang_Whole'))
      : effectiveBarangay;
    getRoadPolylineForBarangay(routeKey)
      .then((poly) => {
        if (!isCancelled && poly && poly.length > 1) {
          setRoadSnappedPolyline(poly);
        }
      })
      .catch((err) => {
        console.warn('RouteMap: getRoadPolylineForBarangay error:', err);
      });
    return () => {
      isCancelled = true;
    };
  }, [effectiveBarangay, selectedRouteVariant]);

  // CENRO System Overrides State
  const [systemOverrides, setSystemOverrides] = useState<SystemOverridesData>(DEFAULT_OVERRIDES);
  const prevRoutePauseRef = useRef<boolean>(false);

  useEffect(() => {
    const unsub = subscribeToSystemOverrides((data) => {
      setSystemOverrides(data);

      if (data.forcePauseCollection && !prevRoutePauseRef.current) {
        // Paused while in cockpit: immediately halt drive simulation & GPS
        const activeUid = user?.uid || auth?.currentUser?.uid;
        if (activeUid) {
          locationService.stopSimulation(activeUid).catch(() => {});
          locationService.stopTracking(activeUid).catch(() => {});
        }
        setIsActualDriving(false);
      }
      prevRoutePauseRef.current = Boolean(data.forcePauseCollection);
    });

    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !db) return;
    return onSnapshot(
      doc(db, 'users', user.uid),
      (docSnap) => {
        if (docSnap.exists()) {
          const u = docSnap.data();
          const b = (u.assignedBarangay || u.barangay || '').trim();
          if (b) setDriverAssignedBarangay(b);
          const active = Boolean(u.dutyStatus === 'on_duty' || u.status === 'on_duty' || u.currentTruckId);
          setIsShiftActive(active);
          if (u.currentTruckPlate && !isRawFirestoreIdOrUuid(u.currentTruckPlate)) {
            setAssignedTruckPlate(u.currentTruckPlate);
          } else if (u.currentTruckId) {
            setAssignedTruckId(u.currentTruckId);
            if (db) {
              getDoc(doc(db, 'trucks', u.currentTruckId)).then((tSnap) => {
                if (tSnap.exists()) {
                  const pNum = tSnap.data()?.plateNumber;
                  if (pNum && !isRawFirestoreIdOrUuid(pNum)) {
                    setAssignedTruckPlate(pNum);
                  }
                }
              }).catch(() => {});
            }
          }
        }
      },
      (err) => {
        if (err?.code !== 'permission-denied') {
          console.warn('RouteMap: user doc listener error:', err);
        }
      }
    );
  }, [user?.uid]);

  const performCompleteRoute = async () => {
    if (!user || !db) return;

    const elapsedSec = simulationState.elapsedDurationSeconds || 0;
    const distTraveled = simulationState.distanceTraveledKm || 0;
    const fuelLiters = simulationState.fuelBurnedLiters || 0;
    const fuelCost = simulationState.fuelCostBurnedPhp || 0;
    const progressPct = simulationState.progressPercent || 100;
    const elapsedMins = Math.max(1, Math.round(elapsedSec / 60));
    const stopsCount = Math.max(1, Math.round((progressPct / 100) * (activeStops.length || 10)));

    setIsActualDriving(false);
    setTruckCoordinate(null);
    await locationService.stopSimulation(user.uid);
    await locationService.stopTracking(user.uid);

    // 1. Reset truck_locations
    try {
      await setDoc(doc(db, 'truck_locations', user.uid), {
        status: 'inactive',
        isSimulation: false,
        isSimulated: false,
        speedKph: 0,
        speed: 0,
        lastUpdate: serverTimestamp(),
      }, { merge: true });
    } catch (locErr) {
      console.warn('Could not reset truck_locations on complete route:', locErr);
    }

    // 2. Mark active schedules and linked reports completed
    try {
      for (const st of activeStops) {
        if (st.scheduleId) {
          const cleanSchedId = st.scheduleId.includes('_stop_') ? st.scheduleId.split('_stop_')[0] : st.scheduleId;
          await setDoc(doc(db, 'schedules', cleanSchedId), {
            status: 'completed',
            completedAt: serverTimestamp(),
            dieselClosedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            completedByUid: user.uid,
            assignedDriverId: user.uid,
          }, { merge: true });
        }
        if (st.reportId) {
          await setDoc(doc(db, 'reports', st.reportId), {
            status: 'resolved',
            collectedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            resolvedByUid: user.uid,
            assignedDriverId: user.uid,
          }, { merge: true });
        }
      }
    } catch (schedErr) {
      console.warn('Could not mark schedules completed:', schedErr);
    }

    // 3. Record driver_route_history and sync master schedule for CENRO audit
    try {
      const stopsList = (activeStops && activeStops.length > 0)
        ? activeStops.map((s) => s.street || s.id || 'Collection Waypoint')
        : undefined;

      const histRef = await addDoc(collection(db, 'driver_route_history'), {
        driverId: user.uid,
        driverName: user.displayName || 'Driver',
        truckPlate: assignedTruckPlate,
        barangay: effectiveBarangay,
        routeName: `Brgy. ${effectiveBarangay} Collection Route`,
        durationMinutes: elapsedMins,
        pickupsCompleted: stopsCount,
        totalDistanceKm: distTraveled,
        fuelBurnedLiters: fuelLiters,
        fuelCostPhp: fuelCost,
        status: 'completed',
        completedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        summaryText: `Drove for ${elapsedMins} mins and completed ${stopsCount} pickups in Brgy. ${effectiveBarangay}.`,
        ...(stopsList && stopsList.length > 0 ? { stops: stopsList } : {}),
      });

      // Synchronize into schedules so CENRO / Coordinator immediately sees
      // this driver-completed trip in the Web Admin "Assigned collection trip" dropdown
      const dateText = new Date().toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'Asia/Manila',
      });
      await setDoc(doc(db, 'schedules', histRef.id), {
        barangay: effectiveBarangay,
        truckId: assignedTruckId || assignedTruckPlate,
        truckPlate: assignedTruckPlate,
        assignedDriverId: user.uid,
        assignedDriverName: user.displayName || 'Driver',
        driver: user.displayName || 'Driver',
        driverName: user.displayName || 'Driver',
        dateText,
        timeText: 'Shift Master Route',
        street: `Brgy. ${effectiveBarangay} Collection Route`,
        status: 'completed',
        isLiveDispatch: true,
        completedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        dieselClosedAt: serverTimestamp(),
        completedByUid: user.uid,
        createdByUid: user.uid,
        actualDistanceKm: distTraveled,
        actualFuelLiters: fuelLiters,
        durationMinutes: elapsedMins,
        pickupsCompleted: stopsCount,
        routeOptimization: {
          baselineDistanceKm: Math.round(distTraveled * 1.15 * 100) / 100,
          optimizedDistanceKm: Math.round(distTraveled * 100) / 100,
          stopCount: stopsCount,
          method: 'driver-telemetry',
        },
      }, { merge: true });
    } catch (histErr) {
      console.warn('Could not record driver_route_history on complete route:', histErr);
    }

    Alert.alert(
      '🎉 Route Completed!',
      `Route for Brgy. ${effectiveBarangay} has been completed and submitted to CENRO.\n\n• Duration: ${elapsedMins} mins\n• Distance: ${distTraveled.toFixed(2)} km\n• Fuel: ${fuelLiters.toFixed(2)} L (≈ ₱${fuelCost.toFixed(0)})\n• Pickups: ${stopsCount}\n\nPlease return to the dashboard to scan the Fleet QR code at dispatch, or have your Coordinator / CENRO conclude your shift.`,
      [
        {
          text: 'Return to Dashboard',
          onPress: () => router.replace('/(driver)'),
        },
        {
          text: 'Stay on Map',
          style: 'cancel',
        },
      ]
    );
  };

  const handleCompleteRouteAction = () => {
    if (!user) {
      Alert.alert('Authentication Required', 'Please sign in as a driver.');
      return;
    }

    Alert.alert(
      'Complete Collection Route',
      `Are you sure you want to finish your collection route for Brgy. ${effectiveBarangay}? This will close today's collection and submit the trip record to CENRO.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete Route',
          style: 'default',
          onPress: async () => {
            await performCompleteRoute();
          },
        },
      ]
    );
  };

  const handleToggleSimulation = async () => {
    if (!user) {
      Alert.alert('Authentication Required', 'Please sign in as a driver.');
      return;
    }

    if (simulationState.isActive || isActualDriving) {
      setIsActualDriving(false);
      setTruckCoordinate(null);
      await locationService.stopSimulation(user.uid);
      await locationService.stopTracking(user.uid);
      if (db) {
        try {
          await setDoc(doc(db, 'truck_locations', user.uid), {
            status: 'inactive',
            isSimulation: false,
            isSimulated: false,
            speedKph: 0,
            speed: 0,
            lastUpdate: serverTimestamp(),
          }, { merge: true });
        } catch (locErr) {
          console.warn('Could not reset truck_locations on stop drive:', locErr);
        }
      }
      Alert.alert('Drive Stopped', 'Drive navigation / GPS broadcasting paused. Your route and pickups remain active.');
    } else {
      if (systemOverrides.forcePauseCollection) {
        Alert.alert(
          '🚨 Dispatch Paused by CENRO',
          `Municipal truck dispatch is currently paused by CENRO due to an emergency directive:\n\n"${systemOverrides.forcePauseReason || 'Emergency Standby Directive'}"\n\nPlease safely park on standby until CENRO authorizes resumption.`
        );
        return;
      }
      setShowDriveModeModal(true);
    }
  };

  const handleSelectDriveMode = async (mode: 'sim_baliang_direct' | 'sim_baliang_whole' | 'sim_baliang_orig' | 'sim_sector' | 'actual_gps') => {
    setShowDriveModeModal(false);
    if (!user?.uid) return;

    const resolvedDriverName = user.displayName || user.email?.split('@')[0] || 'Driver';

    if (mode === 'sim_baliang_direct') {
      await locationService.stopTracking(user.uid);
      setIsActualDriving(false);
      setSelectedRouteVariant('direct');
      await locationService.startSimulation(
        user.uid,
        assignedTruckPlate,
        'Baliang_Direct',
        {
          barangay: 'Baliang',
          assignedBarangay: 'Baliang',
          driverName: resolvedDriverName,
          assignedDriverName: resolvedDriverName,
          plateNumber: assignedTruckPlate,
        },
        1
      );
      setIsCockpitMode(true);
    } else if (mode === 'sim_baliang_whole') {
      await locationService.stopTracking(user.uid);
      setIsActualDriving(false);
      setSelectedRouteVariant('whole');
      await locationService.startSimulation(
        user.uid,
        assignedTruckPlate,
        'Baliang_Whole',
        {
          barangay: 'Baliang',
          assignedBarangay: 'Baliang',
          driverName: resolvedDriverName,
          assignedDriverName: resolvedDriverName,
          plateNumber: assignedTruckPlate,
        },
        1
      );
      setIsCockpitMode(true);
    } else if (mode === 'sim_baliang_orig') {
      await locationService.stopTracking(user.uid);
      setIsActualDriving(false);
      setSelectedRouteVariant('original');
      await locationService.startSimulation(
        user.uid,
        assignedTruckPlate,
        'Baliang_Original',
        {
          barangay: 'Baliang',
          assignedBarangay: 'Baliang',
          driverName: resolvedDriverName,
          assignedDriverName: resolvedDriverName,
          plateNumber: assignedTruckPlate,
        },
        1
      );
      setIsCockpitMode(true);
    } else if (mode === 'sim_sector') {
      await locationService.stopTracking(user.uid);
      setIsActualDriving(false);
      await locationService.startSimulation(
        user.uid,
        assignedTruckPlate,
        effectiveBarangay,
        {
          barangay: effectiveBarangay,
          assignedBarangay: effectiveBarangay,
          driverName: resolvedDriverName,
          assignedDriverName: resolvedDriverName,
          plateNumber: assignedTruckPlate,
        },
        1
      );
      setIsCockpitMode(true);
    } else if (mode === 'actual_gps') {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Location permission is required to broadcast physical truck location.');
          return;
        }
        await locationService.stopSimulation(user.uid);
        await locationService.startTracking(user.uid, assignedTruckPlate, {
          barangay: effectiveBarangay,
          plateNumber: assignedTruckPlate,
          truckPlate: assignedTruckPlate,
          driverName: resolvedDriverName,
        });
        setIsActualDriving(true);
        setIsCockpitMode(true);
      } catch (e) {
        console.error('RouteMap: actual GPS start error:', e);
      }
    }
  };

  useEffect(() => {
    if (requestedScheduleId) setSelectedId(requestedScheduleId);
  }, [requestedScheduleId]);

  useEffect(() => {
    if (!user?.uid || !db) {
      setLoading(false);
      return;
    }

    setLoading(true);
    let schedStops: RouteStop[] = [];
    let repStops: RouteStop[] = [];

    const updateCombinedStops = () => {
      const combined = [...schedStops, ...repStops];
      const seenStopKeys = new Set<string>();
      const dedupedStops: RouteStop[] = [];

      for (const st of combined) {
        const repKey = (st as any).reportId ? `report_${(st as any).reportId}` : null;
        const coordKey = st.location
          ? `${st.street}_${(st.location.latitude ?? 0).toFixed(4)}_${(st.location.longitude ?? 0).toFixed(4)}`
          : `${st.street}_${st.routeOrder}`;
        const key = repKey || coordKey;

        if (seenStopKeys.has(key)) {
          continue;
        }
        seenStopKeys.add(key);
        dedupedStops.push(st);
      }

      dedupedStops.sort((a, b) => (a.routeOrder || 0) - (b.routeOrder || 0));

      setStops(dedupedStops);
      setSelectedId(current => dedupedStops.some(stop => stop.id === current) ? current : (dedupedStops[0]?.id || ''));
      setLoading(false);
      setErrorText('');
    };

    const assignedQuery = query(collection(db, 'schedules'), where('assignedDriverId', '==', user.uid));
    const unsubSchedules = onSnapshot(assignedQuery, snapshot => {
      const nextStops: RouteStop[] = [];

      snapshot.docs.forEach(scheduleDoc => {
        const data = scheduleDoc.data();
        const status = data.status || 'pending';
        if (status === 'completed' || status === 'cancelled') return;

        // If the schedule has embedded optimized stops (from AI auto-dispatch or route optimization)
        if (Array.isArray(data.stops) && data.stops.length > 0) {
          data.stops.forEach((s: any, idx: number) => {
            if (s.completed) return;
            nextStops.push({
              id: `${scheduleDoc.id}_stop_${idx + 1}`,
              scheduleId: scheduleDoc.id,
              reportId: s.reportId || null,
              street: s.name || data.street || `Stop ${idx + 1}`,
              barangay: data.barangay || effectiveBarangay || 'Danao City',
              wasteCategory: s.type === 'citizen_report' ? 'Verified Citizen Report' : (data.wasteCategory || 'Routine Collection'),
              status: status,
              routeOrder: Number(s.order) || (idx + 1),
              isLiveDispatch: true,
              location: (s.lat && s.lng) ? { latitude: Number(s.lat), longitude: Number(s.lng) } : (data.location || null),
              routeOptimization: data.routeOptimization || null,
            });
          });
        } else if (data.isLiveDispatch || scheduleDoc.id === requestedScheduleId) {
          nextStops.push({
            id: scheduleDoc.id,
            scheduleId: scheduleDoc.id,
            reportId: data.reportId || null,
            street: data.street || 'Unknown street',
            barangay: data.barangay || effectiveBarangay || 'Danao City',
            wasteCategory: data.wasteCategory || 'General waste',
            status: status,
            routeOrder: Number(data.routeOrder) || 0,
            isLiveDispatch: data.isLiveDispatch === true,
            location: data.location || null,
            routeOptimization: data.routeOptimization || null,
          });
        }
      });

      schedStops = nextStops;
      updateCombinedStops();
    }, error => {
      if ((error as any)?.code !== 'permission-denied') {
        console.warn('Live route map schedules listener notice:', error);
      }
      schedStops = [];
      updateCombinedStops();
    });

    const reportsQuery = query(collection(db, 'reports'), where('assignedDriverId', '==', user.uid));
    const unsubReports = onSnapshot(reportsQuery, snap => {
      const liveRepStops: RouteStop[] = [];
      snap.forEach(rDoc => {
        const rData = rDoc.data();
        const normStatus = (rData.status || '').toLowerCase().replace(/_/g, '-');
        if (normStatus === 'in-progress' || normStatus === 'acknowledged' || normStatus === 'pending') {
          liveRepStops.push({
            id: `rep_${rDoc.id}`,
            scheduleId: rDoc.id,
            reportId: rDoc.id,
            street: rData.street || rData.address || rData.locationDescription || `Report: ${rData.title || 'Trash Pickup'}`,
            barangay: rData.barangay || effectiveBarangay || 'Danao City',
            wasteCategory: `Citizen Report • ${rData.aiAnalysis?.wasteType || rData.wasteType || 'General'}`,
            status: rData.status || 'in_progress',
            routeOrder: 25,
            isLiveDispatch: true,
            location: (rData.location?.latitude && rData.location?.longitude)
              ? { latitude: Number(rData.location.latitude), longitude: Number(rData.location.longitude) }
              : (rData.location?.lat && rData.location?.lng)
              ? { latitude: Number(rData.location.lat), longitude: Number(rData.location.lng) }
              : null,
            routeOptimization: null,
          });
        }
      });
      repStops = liveRepStops;
      updateCombinedStops();
    }, rErr => {
      if (rErr?.code !== 'permission-denied') {
        console.warn('DriverRouteMap: reports listener error:', rErr);
      }
    });

    return () => {
      unsubSchedules();
      unsubReports();
    };
  }, [requestedScheduleId, user?.uid, effectiveBarangay]);

  useEffect(() => {
    if (!user?.uid || !db) return;
    return onSnapshot(
      doc(db, 'truck_locations', user.uid),
      snapshot => {
        // If simulation is actively running, local simulationState is authoritative and smooth;
        // do NOT overwrite it with lagged Firestore snapshot echoes
        if (simulationState.isActive) {
          return;
        }

        const data = snapshot.data();
        const isInactive = !data || data.status === 'inactive' || data.status === 'completed';
        if (isInactive) {
          setTruckCoordinate(null);
          setIsActualDriving(false);
          setActualSpeedKph(0);
          return;
        }

        const latitude = data?.lat ?? data?.location?.latitude;
        const longitude = data?.lng ?? data?.location?.longitude;
        setTruckCoordinate(Number.isFinite(latitude) && Number.isFinite(longitude)
          ? { latitude: Number(latitude), longitude: Number(longitude) }
          : null);
        if (data?.speedKph !== undefined || data?.speed !== undefined) {
          setActualSpeedKph(Math.round(Number(data.speedKph ?? data.speed ?? 0)));
        }
        const isSim = Boolean(data?.isSimulation || data?.isSimulated);
        const isGpsActive = Boolean(data?.status === 'active' && !isSim && locationService.isGpsTracking());
        setIsActualDriving(isGpsActive);
      },
      error => {
        if (error?.code !== 'permission-denied') {
          console.warn('RouteMap: truck_locations listener error:', error);
        }
      }
    );
  }, [user?.uid, simulationState.isActive]);

  const sectorWaypoints = useMemo(() => {
    return getBarangaySimulationRoute(effectiveBarangay, selectedRouteVariant);
  }, [effectiveBarangay, selectedRouteVariant]);

  const handleSwitchRouteVariant = async (variant: 'whole' | 'original' | 'direct') => {
    if (selectedRouteVariant === variant) return;
    setSelectedRouteVariant(variant);
    const activeUid = user?.uid || auth?.currentUser?.uid;
    if (!activeUid) return;
    const routeKey = variant === 'direct' ? 'Baliang_Direct' : (variant === 'whole' ? 'Baliang_Whole' : 'Baliang_Original');
    await locationService.startSimulation(
      activeUid,
      assignedTruckPlate,
      routeKey,
      { barangay: 'Baliang', assignedBarangay: 'Baliang' },
      simulationState.speedMultiplier || 1
    );
  };

  const sectorRoutePoints = useMemo(() => {
    return sectorWaypoints.map((pt) => ({
      latitude: pt.latitude,
      longitude: pt.longitude,
    }));
  }, [sectorWaypoints]);

  const isRoutineSectorMode = stops.length === 0;

  const sectorStops: RouteStop[] = useMemo(() => {
    if (stops.length > 0) return [];
    return sectorWaypoints.map((wp, idx) => ({
      id: `sector_wp_${idx + 1}`,
      street: wp.name || `Waypoint ${idx + 1}`,
      barangay: wp.barangay || effectiveBarangay,
      wasteCategory: 'Routine Collection',
      status: 'standby',
      routeOrder: idx + 1,
      isLiveDispatch: false,
      location: { latitude: wp.latitude, longitude: wp.longitude },
      routeOptimization: null,
    }));
  }, [stops.length, sectorWaypoints, effectiveBarangay]);

  const activeStops = stops.length > 0 ? stops : sectorStops;
  const selectedStop = activeStops.find(stop => stop.id === selectedId) || activeStops[0] || null;
  const locatedStops = useMemo(() => activeStops
    .map(stop => ({ stop, coordinate: coordinateOf(stop) }))
    .filter((item): item is { stop: RouteStop; coordinate: Coordinate } => item.coordinate !== null), [activeStops]);
  const routeCoordinates = useMemo(() => [
    ...(truckCoordinate ? [truckCoordinate] : []),
    ...locatedStops.map(item => item.coordinate),
  ], [locatedStops, truckCoordinate]);
  const routeMetadata = stops.find(stop => stop.routeOptimization)?.routeOptimization;
  const roadPolyline = useMemo(() => (routeMetadata?.roadPolyline || []).filter(point =>
    Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)), [routeMetadata?.roadPolyline]);
  const displayedPolyline = useMemo(() => {
    if (!showRouteLine) return [];
    if (roadPolyline.length > 1) return roadPolyline;
    if (simulationState.routePolyline && simulationState.routePolyline.length > 1) {
      return simulationState.routePolyline;
    }
    if (roadSnappedPolyline.length > 1) return roadSnappedPolyline;
    return [];
  }, [showRouteLine, roadPolyline, simulationState.routePolyline, roadSnappedPolyline]);

  // Dynamically compute the upcoming stop / waypoint based on simulation progress
  const currentUpcomingStop = useMemo(() => {
    if (!activeStops || activeStops.length === 0) return null;
    if (activeStops.length === 1) return activeStops[0];
    if (!simulationState.isActive) {
      return selectedStop || activeStops[1] || activeStops[0];
    }
    const progressFrac = Math.max(0, Math.min(0.999, (simulationState.progressPercent || 0) / 100));
    const nextIdx = Math.min(
      activeStops.length - 1,
      Math.max(1, Math.floor(progressFrac * (activeStops.length - 1)) + 1)
    );
    return activeStops[nextIdx] || activeStops[0];
  }, [activeStops, simulationState.isActive, simulationState.progressPercent, selectedStop]);
  const mapFitCoordinates = useMemo(() => [
    ...displayedPolyline,
    ...routeCoordinates,
  ], [displayedPolyline, routeCoordinates]);

  const initialMapCenter = useMemo(() => {
    if (truckCoordinate && Number.isFinite(truckCoordinate.latitude) && Number.isFinite(truckCoordinate.longitude)) {
      return truckCoordinate;
    }
    if (sectorRoutePoints[0]) return sectorRoutePoints[0];
    return DANAO_CENTER;
  }, [truckCoordinate, sectorRoutePoints]);

  // Auto-drive when navigated with autoDrive or driveMode params
  useEffect(() => {
    if (!autoDriveTriggeredRef.current && user?.uid) {
      if (params.driveMode === 'actual') {
        autoDriveTriggeredRef.current = true;
        setIsCockpitMode(true);
        setIsActualDriving(true);
        (async () => {
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
              await locationService.stopSimulation(user.uid);
              const dName = user.displayName || user.email?.split('@')[0] || 'Driver';
              await locationService.startTracking(user.uid, assignedTruckPlate, {
                barangay: effectiveBarangay,
                plateNumber: assignedTruckPlate,
                truckPlate: assignedTruckPlate,
                driverName: dName,
              });
            }
          } catch (e) {
            console.warn('RouteMap: Actual GPS tracking init error:', e);
          }
        })();
      } else if (params.autoDrive === 'true') {
        autoDriveTriggeredRef.current = true;
        setIsCockpitMode(true);
        if (!locationService.getSimulationState().isActive) {
          const dName = user.displayName || user.email?.split('@')[0] || 'Driver';
          locationService.startSimulation(user.uid, assignedTruckPlate, effectiveBarangay, {
            barangay: effectiveBarangay,
            assignedBarangay: effectiveBarangay,
            driverName: dName,
            assignedDriverName: dName,
            plateNumber: assignedTruckPlate,
          }, 1);
        }
      }
    }
  }, [params.autoDrive, params.driveMode, user?.uid, effectiveBarangay, assignedTruckPlate]);

  // Smooth Navigation Camera Auto-Follow (Hands-Free, keeps truck centered)
  useEffect(() => {
    if ((!simulationState.isActive && !isActualDriving) || !isCockpitMode || !truckCoordinate || !mapRef.current) return;
    mapRef.current?.animateToRegion?.({
      latitude: truckCoordinate.latitude,
      longitude: truckCoordinate.longitude,
      latitudeDelta: 0.007,
      longitudeDelta: 0.007,
    }, 450);
  }, [truckCoordinate?.latitude, truckCoordinate?.longitude, simulationState.isActive, isActualDriving, isCockpitMode]);

  // Auto-proximity stop selection (hands-free awareness)
  useEffect(() => {
    if ((!simulationState.isActive && !isActualDriving) || !truckCoordinate || locatedStops.length === 0) return;
    let closestStop: RouteStop | null = null;
    let minMeters = 999999;
    for (const item of locatedStops) {
      const d = haversineMeters(truckCoordinate, item.coordinate);
      if (d < minMeters) {
        minMeters = d;
        closestStop = item.stop;
      }
    }
    if (closestStop && minMeters < 60 && closestStop.id !== selectedId) {
      setSelectedId(closestStop.id);
    }
  }, [truckCoordinate?.latitude, truckCoordinate?.longitude, simulationState.isActive, isActualDriving, locatedStops, selectedId]);

  // Fit overview map initially when NOT actively driving
  const hasFittedInitialRouteRef = useRef(false);
  useEffect(() => {
    if (!mapRef.current || mapFitCoordinates.length === 0) return;
    if (simulationState.isActive || isActualDriving) return;
    if (hasFittedInitialRouteRef.current) return;
    hasFittedInitialRouteRef.current = true;
    const timer = setTimeout(() => {
      if (mapFitCoordinates.length > 1) {
        mapRef.current?.fitToCoordinates?.(mapFitCoordinates, {
          edgePadding: { top: 120, right: 60, bottom: 330, left: 60 },
          animated: true,
        });
      } else if (mapFitCoordinates[0]) {
        mapRef.current?.animateToRegion?.({
          ...mapFitCoordinates[0], latitudeDelta: 0.018, longitudeDelta: 0.018,
        }, 450);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [mapFitCoordinates, simulationState.isActive, isActualDriving]);

  const focusStop = (stop: RouteStop) => {
    setSelectedId(stop.id);
    const coordinate = coordinateOf(stop);
    if (coordinate) {
      mapRef.current?.animateToRegion?.({ ...coordinate, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 400);
    }
  };

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(driver)' as any);
    }
  };

  const routeDistance = stops.find(stop => Number.isFinite(stop.routeOptimization?.estimatedDistanceKm))
    ?.routeOptimization?.estimatedDistanceKm;
  const routeDuration = routeMetadata?.estimatedDurationMinutes;
  const hasRoadRoute = roadPolyline.length > 1 && routeMetadata?.provider === 'Google Routes API';

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <OpenStreetMap
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialCenter={initialMapCenter}
        zoom={15}
        polyline={displayedPolyline}
        polylineColor={isRoutineSectorMode ? "#2E8B57" : "#7C3AED"}
        truckCoordinate={truckCoordinate}
        zoomBottomOffset={
          (simulationState.isActive || isActualDriving) && isCockpitMode
            ? Math.max(insets.bottom, 14) + 85
            : 340
        }
        stops={locatedStops.map(({ stop, coordinate }) => {
          const routeNumber = activeStops.indexOf(stop) + 1;
          return {
            id: stop.id,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            title: `${routeNumber}. ${stop.street}`,
            subtitle: stop.barangay,
            orderNumber: routeNumber,
            selected: stop.id === selectedStop?.id,
          };
        })}
        onSelectStop={(id) => {
          const found = activeStops.find((s) => s.id === id);
          if (found) focusStop(found);
        }}
        isDark={isDark}
        interactive={true}
      />

      {/* 🛡️ HANDS-FREE FULLSCREEN COCKPIT HUD (RA 10913 COMPLIANT) */}
      {(simulationState.isActive || isActualDriving) ? (
        <View style={[styles.cockpitHudContainer, { top: insets.top + 8 }]}>
          {/* Top Control Bar: Back | Hands-Free Compliance Badge | Stop Button */}
          <View style={styles.cockpitTopBar}>
            <TouchableOpacity
              style={[styles.cockpitExitBtn, isDark && styles.cockpitExitBtnDark]}
              onPress={handleGoBack}
              accessibilityLabel="Exit to driver tab"
              activeOpacity={0.8}
            >
              <MaterialIcons name="arrow-back" size={20} color={isDark ? '#FFFFFF' : '#1F2937'} />
            </TouchableOpacity>

            <View style={[styles.cockpitComplianceBadge, isDark && styles.cockpitComplianceBadgeDark]}>
              <View style={styles.simLivePulseDot} />
              <MaterialIcons name={isActualDriving ? 'gps-fixed' : 'security'} size={14} color="#16A34A" />
              <Text style={[styles.cockpitComplianceText, isDark && { color: '#86EFAC' }]} numberOfLines={1}>
                {isActualDriving ? 'ACTUAL GPS · PHYSICAL DRIVE' : 'HANDS-FREE · RA 10913'}
              </Text>
            </View>

            {/* 1-Tap Route Line Visibility Toggle */}
            <TouchableOpacity
              style={[
                styles.cockpitRouteToggleBtn,
                showRouteLine && styles.cockpitRouteToggleBtnActive,
                isDark && styles.cockpitRouteToggleBtnDark,
                showRouteLine && isDark && styles.cockpitRouteToggleBtnActiveDark,
              ]}
              onPress={() => setShowRouteLine((prev) => !prev)}
              activeOpacity={0.8}
              accessibilityLabel={showRouteLine ? "Hide route line" : "Show route line"}
            >
              <MaterialIcons
                name={showRouteLine ? "alt-route" : "route"}
                size={18}
                color={showRouteLine ? (isDark ? '#86EFAC' : '#166534') : (isDark ? '#94A3B8' : '#64748B')}
              />
            </TouchableOpacity>

            {/* Stop Drive Button */}
            <TouchableOpacity
              style={styles.cockpitStopBtn}
              onPress={handleToggleSimulation}
              activeOpacity={0.85}
              accessibilityLabel="Stop driving"
            >
              <MaterialIcons name="stop" size={16} color="#FFFFFF" />
              <Text style={styles.cockpitStopBtnText}>Stop</Text>
            </TouchableOpacity>

            {/* Complete Route Button */}
            <TouchableOpacity
              style={[styles.cockpitStopBtn, styles.cockpitCompleteBtn]}
              onPress={handleCompleteRouteAction}
              activeOpacity={0.85}
              accessibilityLabel="Complete route"
            >
              <MaterialIcons name="check-circle" size={16} color="#FFFFFF" />
              <Text style={styles.cockpitStopBtnText}>Complete</Text>
            </TouchableOpacity>
          </View>

          {/* Dedicated Floating Speed Multiplier Bar (Simulation Mode Only) */}
          {isCockpitMode && simulationState.isActive && !isActualDriving && (
            <View style={[styles.cockpitSpeedBarRow, isDark && styles.cockpitSpeedBarRowDark]}>
              <View style={styles.cockpitSpeedBarLabel}>
                <MaterialIcons name="speed" size={14} color={isDark ? '#A78BFA' : '#7C3AED'} />
                <Text style={[styles.cockpitSpeedBarText, isDark && { color: '#C4B5FD' }]}>SIM SPEED</Text>
              </View>
              <View style={styles.cockpitSpeedPills}>
                {[
                  { label: '1x Normal', val: 1 },
                  { label: '2x', val: 2 },
                  { label: '5x Fast', val: 5 },
                  { label: '10x Warp', val: 10 },
                ].map((s) => {
                  const isSel = (simulationState.speedMultiplier || 1) === s.val;
                  return (
                    <TouchableOpacity
                      key={s.val}
                      style={[
                        styles.cockpitPill,
                        isSel && styles.cockpitPillActive,
                        isDark && { backgroundColor: '#1E293B', borderColor: '#334155' },
                        isSel && isDark && { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
                      ]}
                      onPress={() => locationService.setSimulationSpeed(s.val)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.cockpitPillText, isSel && styles.cockpitPillTextActive]}>
                        {s.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Baliang Route Variant Switcher Bar (1-Tap Route Switch in Cockpit) */}
          {isCockpitMode && simulationState.isActive && !isActualDriving && effectiveBarangay.toLowerCase().includes('baliang') && (
            <View style={[styles.cockpitSpeedBarRow, { marginTop: 6 }, isDark && styles.cockpitSpeedBarRowDark]}>
              <View style={styles.cockpitSpeedBarLabel}>
                <MaterialIcons name="alt-route" size={14} color={isDark ? '#34D399' : '#059669'} />
                <Text style={[styles.cockpitSpeedBarText, isDark && { color: '#6EE7B7' }]}>ROUTE</Text>
              </View>
              <View style={styles.cockpitSpeedPills}>
                <TouchableOpacity
                  style={[
                    styles.cockpitPill,
                    selectedRouteVariant === 'direct' && styles.cockpitPillActive,
                    isDark && { backgroundColor: '#1E293B', borderColor: '#334155' },
                    selectedRouteVariant === 'direct' && isDark && { backgroundColor: '#059669', borderColor: '#059669' },
                  ]}
                  onPress={() => handleSwitchRouteVariant('direct')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.cockpitPillText, selectedRouteVariant === 'direct' && styles.cockpitPillTextActive]}>
                    🎯 Direct (3)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.cockpitPill,
                    selectedRouteVariant === 'whole' && styles.cockpitPillActive,
                    isDark && { backgroundColor: '#1E293B', borderColor: '#334155' },
                    selectedRouteVariant === 'whole' && isDark && { backgroundColor: '#059669', borderColor: '#059669' },
                  ]}
                  onPress={() => handleSwitchRouteVariant('whole')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.cockpitPillText, selectedRouteVariant === 'whole' && styles.cockpitPillTextActive]}>
                    🌟 Whole (3)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.cockpitPill,
                    selectedRouteVariant === 'original' && styles.cockpitPillActive,
                    isDark && { backgroundColor: '#1E293B', borderColor: '#334155' },
                    selectedRouteVariant === 'original' && isDark && { backgroundColor: '#059669', borderColor: '#059669' },
                  ]}
                  onPress={() => handleSwitchRouteVariant('original')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.cockpitPillText, selectedRouteVariant === 'original' && styles.cockpitPillTextActive]}>
                    📍 Original (3)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* 🚨 In-Cab Emergency Standby Directive Banner */}
          {systemOverrides.forcePauseCollection ? (
            <View style={styles.inCabEmergencyBanner}>
              <View style={styles.inCabEmergencyIconWrap}>
                <MaterialIcons name="pause-circle-filled" size={20} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inCabEmergencyTitle}>FLEET DISPATCH PAUSED BY CENRO</Text>
                <Text style={styles.inCabEmergencySubtitle} numberOfLines={2}>
                  {systemOverrides.forcePauseReason || 'Operations halted. Pull over safely and standby at safe zone.'}
                </Text>
              </View>
            </View>
          ) : systemOverrides.severeWeatherProtocol ? (
            <View style={styles.inCabWeatherBanner}>
              <View style={[styles.inCabEmergencyIconWrap, { backgroundColor: '#E0F2FE' }]}>
                <MaterialIcons name="thunderstorm" size={20} color="#0284C7" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inCabWeatherTitle}>SEVERE WEATHER FLOOD DEFENSE</Text>
                <Text style={styles.inCabWeatherSubtitle} numberOfLines={1}>
                  Bypass riverbanks and low basins • Elevated arterial detours active
                </Text>
              </View>
            </View>
          ) : null}

          {/* Large Glanceable Drive HUD Bar (Fullscreen Cockpit Mode Only) */}
          {isCockpitMode && (
            <View style={[styles.cockpitMainCard, isDark && styles.cockpitMainCardDark]}>
              {/* Speedometer */}
              <View style={[styles.cockpitSpeedometerBox, isDark && styles.cockpitSpeedometerBoxDark]}>
                <Text style={[styles.cockpitSpeedometerNumber, (isActualDriving ? actualSpeedKph : simulationState.currentSpeedKph) >= 60 && { color: '#DC2626' }]}>
                  {isActualDriving ? actualSpeedKph : simulationState.currentSpeedKph}
                </Text>
                <Text style={styles.cockpitSpeedometerUnit}>KM/H</Text>
              </View>

              {/* Roadway & Target Street Info */}
              <View style={styles.cockpitStreetInfo}>
                <Text style={[styles.cockpitStreetHeading, isDark && { color: '#C4B5FD' }]} numberOfLines={1}>
                  {isActualDriving ? 'Live Phone GPS Active' : (simulationState.locationName || `Brgy. ${effectiveBarangay}`)}
                </Text>
                <Text style={[styles.cockpitStreetTarget, isDark && styles.textLight]} numberOfLines={1}>
                  {currentUpcomingStop
                    ? `Next: ${currentUpcomingStop.street}`
                    : (selectedStop ? `Next: ${selectedStop.street}` : `Sector: Brgy. ${effectiveBarangay}`)}
                </Text>
                {/* Progress Bar */}
                <View style={styles.cockpitProgressTrack}>
                  <View
                    style={[
                      styles.cockpitProgressFill,
                      isActualDriving
                        ? { width: '100%', backgroundColor: '#10B981' }
                        : { width: `${Math.max(4, simulationState.progressPercent || 0)}%` },
                    ]}
                  />
                </View>
              </View>
            </View>
          )}

          {/* Telemetry Glance Strip: Time | Fuel | Distance (Fullscreen Cockpit Mode Only) */}
          {isCockpitMode && (
            isActualDriving ? (
              <View style={[styles.cockpitTelemetryRow, isDark && styles.cockpitTelemetryRowDark]}>
                <View style={styles.cockpitTelemetryItem}>
                  <MaterialIcons name="my-location" size={13} color="#10B981" />
                  <Text style={[styles.cockpitTelemetryVal, { color: '#10B981' }]}>
                    GPS BROADCASTING
                  </Text>
                </View>
                <View style={styles.cockpitTelemetryDivider} />
                <View style={styles.cockpitTelemetryItem}>
                  <MaterialIcons name="location-city" size={13} color="#8B5CF6" />
                  <Text style={[styles.cockpitTelemetryVal, isDark && styles.textLight]}>
                    Brgy. {effectiveBarangay}
                  </Text>
                </View>
                <View style={styles.cockpitTelemetryDivider} />
                <View style={styles.cockpitTelemetryItem}>
                  <MaterialIcons name="speed" size={13} color="#F59E0B" />
                  <Text style={[styles.cockpitTelemetryVal, isDark && styles.textLight]}>
                    {actualSpeedKph} km/h
                  </Text>
                </View>
              </View>
            ) : (
              <View style={[styles.cockpitTelemetryRow, isDark && styles.cockpitTelemetryRowDark]}>
                <View style={styles.cockpitTelemetryItem}>
                  <MaterialIcons name="timer" size={13} color="#8B5CF6" />
                  <Text style={[styles.cockpitTelemetryVal, isDark && styles.textLight]}>
                    {formatMinutesSeconds(simulationState.elapsedDurationSeconds || 0)}
                    <Text style={styles.cockpitTelemetrySub}> / {formatMinutesSeconds(simulationState.totalDurationSeconds || 600)}</Text>
                  </Text>
                </View>

                <View style={styles.cockpitTelemetryDivider} />

                <View style={styles.cockpitTelemetryItem}>
                  <MaterialIcons name="local-gas-station" size={13} color="#10B981" />
                  <Text style={[styles.cockpitTelemetryVal, { color: '#10B981' }]}>
                    {(simulationState.fuelBurnedLiters || 0).toFixed(2)} L
                    <Text style={styles.cockpitTelemetrySub}> (≈ ₱{(simulationState.fuelCostBurnedPhp || 0).toFixed(0)})</Text>
                  </Text>
                </View>

                <View style={styles.cockpitTelemetryDivider} />

                <View style={styles.cockpitTelemetryItem}>
                  <MaterialIcons name="navigation" size={13} color="#F59E0B" />
                  <Text style={[styles.cockpitTelemetryVal, isDark && styles.textLight]}>
                    {(simulationState.distanceTraveledKm || 0).toFixed(2)} km
                    <Text style={styles.cockpitTelemetrySub}> ({simulationState.progressPercent}%)</Text>
                  </Text>
                </View>
              </View>
            )
          )}
        </View>
      ) : (
        /* Standard Header when NOT in active drive */
        <>
        <View style={[styles.header, { top: insets.top + 10 }, isDark && styles.panelDark]}>
          <TouchableOpacity
            style={[styles.iconButton, isDark && styles.iconButtonDark]}
            onPress={handleGoBack}
            accessibilityLabel="Back to driver dashboard"
            activeOpacity={0.8}
          >
            <MaterialIcons name="arrow-back" size={24} color={isDark ? '#FFFFFF' : '#1F2937'} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={[styles.headerTitle, isDark && styles.textLight]}>
              {isRoutineSectorMode ? `Brgy. ${effectiveBarangay} Sector` : 'Live Route Dispatch'}
            </Text>
            <Text style={[styles.headerSubtitle, isDark && styles.textMuted]}>
              {isRoutineSectorMode
                ? `${sectorWaypoints.length} waypoints · In-app sector map`
                : `${stops.length} stop${stops.length === 1 ? '' : 's'}${routeDistance ? ` · ${routeDistance} km${routeDuration ? ` · ${routeDuration} min` : ''}` : ' · in-app map'}`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {!(simulationState.isActive || isActualDriving) ? (
              <TouchableOpacity
                style={[
                  styles.simMapBtn,
                  systemOverrides.forcePauseCollection && styles.simMapBtnPaused,
                ]}
                onPress={handleToggleSimulation}
                accessibilityLabel="Start Drive"
              >
                <MaterialIcons
                  name={systemOverrides.forcePauseCollection ? 'pause' : 'play-arrow'}
                  size={18}
                  color="#FFFFFF"
                />
                <Text style={styles.simMapBtnText}>
                  {systemOverrides.forcePauseCollection ? 'Paused' : 'Start Drive'}
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.simMapBtn, styles.simMapBtnStop]}
                  onPress={handleToggleSimulation}
                  accessibilityLabel="Stop Drive"
                >
                  <MaterialIcons name="stop" size={18} color="#FFFFFF" />
                  <Text style={styles.simMapBtnText}>Stop Drive</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.simMapBtn, styles.simMapBtnComplete]}
                  onPress={handleCompleteRouteAction}
                  accessibilityLabel="Complete Route"
                >
                  <MaterialIcons name="check-circle" size={18} color="#FFFFFF" />
                  <Text style={styles.simMapBtnText}>Complete</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={[
                styles.iconButton,
                showRouteLine && { backgroundColor: isDark ? '#14532D' : '#DCFCE7', borderColor: '#86EFAC' },
                isDark && styles.iconButtonDark,
              ]}
              onPress={() => setShowRouteLine((prev) => !prev)}
              accessibilityLabel={showRouteLine ? "Hide route line" : "Show route line"}
            >
              <MaterialIcons
                name={showRouteLine ? "alt-route" : "route"}
                size={22}
                color={showRouteLine ? (isDark ? '#86EFAC' : '#166534') : (isDark ? '#94A3B8' : '#64748B')}
              />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.iconButton, isDark && styles.iconButtonDark]} onPress={() => {
              if (mapFitCoordinates.length > 1) {
                mapRef.current?.fitToCoordinates?.(mapFitCoordinates, { edgePadding: { top: 120, right: 60, bottom: 330, left: 60 }, animated: true });
              } else if (initialMapCenter) {
                mapRef.current?.animateToRegion?.({ ...initialMapCenter, latitudeDelta: 0.015, longitudeDelta: 0.015 }, 400);
              }
            }} accessibilityLabel="Show the full route">
              <MaterialIcons name="center-focus-strong" size={22} color={isRoutineSectorMode ? "#166534" : "#7C3AED"} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Non-cockpit emergency/weather alert strip */}
        {systemOverrides.forcePauseCollection ? (
          <View style={[styles.headerAlertStrip, { top: insets.top + 76 }]}>
            <MaterialIcons name="pause-circle-filled" size={16} color="#DC2626" />
            <Text style={styles.headerAlertText} numberOfLines={1}>
              DISPATCH PAUSED: {systemOverrides.forcePauseReason || 'Standby directive active'}
            </Text>
          </View>
        ) : systemOverrides.severeWeatherProtocol ? (
          <View style={[styles.headerWeatherStrip, { top: insets.top + 76 }]}>
            <MaterialIcons name="thunderstorm" size={16} color="#0284C7" />
            <Text style={styles.headerWeatherText} numberOfLines={1}>
              FLOOD HAZARD: Avoid riverbanks & flood basins
            </Text>
          </View>
        ) : null}
      </>
      )}

      {/* BOTTOM SECTION: Fullscreen Cockpit Floating Dock OR Expanded Route Drawer */}
      {(simulationState.isActive || isActualDriving) && isCockpitMode ? (
        <View style={[styles.cockpitBottomDock, { bottom: Math.max(insets.bottom, 14) }, isDark && styles.cockpitBottomDockDark]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={[styles.cockpitStopBadge, isRoutineSectorMode && { backgroundColor: '#DCFCE7' }]}>
                <Text style={[styles.cockpitStopBadgeText, isRoutineSectorMode && { color: '#166534' }]}>
                  #{currentUpcomingStop ? Math.max(1, activeStops.indexOf(currentUpcomingStop) + 1) : (selectedStop ? Math.max(1, activeStops.indexOf(selectedStop) + 1) : 1)}
                </Text>
              </View>
              <Text style={[styles.cockpitBottomStreet, isDark && styles.textLight]} numberOfLines={1}>
                {currentUpcomingStop?.street || selectedStop?.street || 'En Route to Target Sector'}
              </Text>
            </View>
            <Text style={[styles.cockpitBottomSub, isDark && styles.textMuted]} numberOfLines={1}>
              {currentUpcomingStop
                ? `${currentUpcomingStop.barangay} · ${currentUpcomingStop.wasteCategory}`
                : (selectedStop ? `${selectedStop.barangay} · ${selectedStop.wasteCategory}` : 'Follow map route hands-free')}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.cockpitExpandDrawerBtn, isDark && styles.cockpitExpandDrawerBtnDark]}
            onPress={() => {
              const targetStop = currentUpcomingStop || selectedStop;
              if (targetStop) {
                focusStop(targetStop);
              }
              setIsCockpitMode(false);
            }}
            activeOpacity={0.8}
            accessibilityLabel="View stop details"
          >
            <MaterialIcons name="list" size={16} color={isDark ? '#86EFAC' : '#166534'} />
            <Text style={[styles.cockpitExpandDrawerText, isDark && { color: '#86EFAC' }]}>
              Stop Details
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.routePanel, { paddingBottom: Math.max(insets.bottom, 14) }, isDark && styles.panelDark]}>
          {(simulationState.isActive || isActualDriving) && (
            <TouchableOpacity
              style={styles.returnToCockpitBtn}
              onPress={() => {
                setIsCockpitMode(true);
                if (truckCoordinate) {
                  mapRef.current?.animateToRegion?.({
                    latitude: truckCoordinate.latitude,
                    longitude: truckCoordinate.longitude,
                    latitudeDelta: 0.007,
                    longitudeDelta: 0.007,
                  }, 450);
                }
              }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="fullscreen" size={18} color="#FFFFFF" />
              <Text style={styles.returnToCockpitText}>Return to Hands-Free Fullscreen Drive</Text>
            </TouchableOpacity>
          )}

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#7C3AED" />
              <Text style={[styles.loadingText, isDark && styles.textMuted]}>Loading the assigned route…</Text>
            </View>
          ) : errorText ? (
            <View style={styles.emptyBox}>
              <MaterialIcons name="cloud-off" size={30} color="#EF4444" />
              <Text style={styles.errorText}>{errorText}</Text>
              <TouchableOpacity style={styles.backHomeBtn} onPress={handleGoBack}>
                <MaterialIcons name="arrow-back" size={18} color="#FFFFFF" />
                <Text style={styles.backHomeBtnText}>Back to Dashboard</Text>
              </TouchableOpacity>
            </View>
          ) : !selectedStop ? (
            <View style={styles.emptyBox}>
              <MaterialIcons name="check-circle" size={35} color="#2E8B57" />
              <Text style={[styles.emptyTitle, isDark && styles.textLight]}>No active route stops</Text>
              <Text style={[styles.emptyText, isDark && styles.textMuted]}>Return to Home to wait for the next dispatch.</Text>
              <TouchableOpacity style={styles.backHomeBtn} onPress={handleGoBack}>
                <MaterialIcons name="arrow-back" size={18} color="#FFFFFF" />
                <Text style={styles.backHomeBtnText}>Back to Dashboard</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.panelHeadingRow}>
                <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <Text style={[styles.eyebrow, isRoutineSectorMode && { color: '#166534' }]}>
                    {isRoutineSectorMode ? 'SECTOR WAYPOINT' : 'CURRENT TARGET'}
                  </Text>
                  <Text style={[styles.targetStreet, isDark && styles.textLight]} numberOfLines={1}>{selectedStop.street}</Text>
                  <Text style={[styles.targetMeta, isDark && styles.textMuted]}>{selectedStop.barangay} · {selectedStop.wasteCategory}</Text>
                </View>
                <View style={[styles.orderBadge, isRoutineSectorMode && { backgroundColor: '#DCFCE7' }]}>
                  <Text style={[styles.orderBadgeText, isRoutineSectorMode && { color: '#166534' }]}>
                    #{Math.max(1, activeStops.indexOf(selectedStop) + 1)}
                  </Text>
                </View>
              </View>

              <View style={[styles.routeTypeBadge, (isRoutineSectorMode || hasRoadRoute) ? styles.routeTypeRoad : styles.routeTypeFallback]}>
                <MaterialIcons
                  name={isRoutineSectorMode ? "alt-route" : (hasRoadRoute ? 'add-road' : 'route')}
                  size={15}
                  color={isRoutineSectorMode || hasRoadRoute ? '#166534' : '#6D28D9'}
                />
                <Text style={[styles.routeTypeText, { color: isRoutineSectorMode || hasRoadRoute ? '#166534' : '#6D28D9' }]}>
                  {isRoutineSectorMode
                    ? `Standard Sector Loop · Brgy. ${effectiveBarangay}`
                    : (hasRoadRoute ? 'Road-aware optimized route' : 'Geographic fallback route')}
                </Text>
              </View>

              {!coordinateOf(selectedStop) && (
                <View style={styles.gpsWarning}>
                  <MaterialIcons name="location-off" size={16} color="#92400E" />
                  <Text style={styles.gpsWarningText}>This stop has no GPS pin. Use the address shown above.</Text>
                </View>
              )}

              <Text style={[styles.stopsLabel, isDark && styles.textMuted]}>
                {isRoutineSectorMode ? 'SECTOR WAYPOINTS' : 'ROUTE ORDER'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stopStrip}>
                {activeStops.map((stop, index) => (
                  <TouchableOpacity
                    key={stop.id}
                    style={[
                      styles.stopChip,
                      stop.id === selectedStop.id && (isRoutineSectorMode ? { backgroundColor: '#166534', borderColor: '#166534' } : styles.stopChipActive),
                      isDark && styles.stopChipDark
                    ]}
                    onPress={() => focusStop(stop)}
                  >
                    <Text style={[
                      styles.stopChipNumber,
                      isRoutineSectorMode && { color: '#166534' },
                      stop.id === selectedStop.id && styles.stopChipTextActive
                    ]}>
                      {index + 1}
                    </Text>
                    <Text style={[styles.stopChipStreet, stop.id === selectedStop.id && styles.stopChipTextActive]} numberOfLines={1}>
                      {stop.street}
                    </Text>
                    {!coordinateOf(stop) && <MaterialIcons name="location-off" size={13} color="#F59E0B" />}
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {isRoutineSectorMode ? (
                (simulationState.isActive || isActualDriving) ? (
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 15 }}>
                    <TouchableOpacity
                      style={[styles.completeButton, { flex: 1, backgroundColor: '#DC2626', marginTop: 0 }]}
                      onPress={handleToggleSimulation}
                    >
                      <MaterialIcons name="stop" size={19} color="#FFFFFF" />
                      <Text style={styles.completeButtonText}>Stop Drive</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.completeButton, { flex: 1, backgroundColor: '#059669', marginTop: 0 }]}
                      onPress={handleCompleteRouteAction}
                    >
                      <MaterialIcons name="check-circle" size={19} color="#FFFFFF" />
                      <Text style={styles.completeButtonText}>Complete Route</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.completeButton,
                      { backgroundColor: isShiftActive ? '#16A34A' : '#64748B' }
                    ]}
                    onPress={() => {
                      if (!isShiftActive && !simulationState.isActive && !isActualDriving) {
                        Alert.alert(
                          'Read-Only Mode (Off Duty)',
                          'Route navigation is disabled while off duty or until CENRO assigns a truck to your account in Fleet Inventory.',
                          [{ text: 'OK', style: 'default' }]
                        );
                        return;
                      }
                      handleToggleSimulation();
                    }}
                  >
                    <MaterialIcons
                      name={isShiftActive ? "navigation" : "lock"}
                      size={19}
                      color="#FFFFFF"
                    />
                    <Text style={styles.completeButtonText}>
                      {isShiftActive ? `Start Route (Brgy. ${effectiveBarangay})` : "Viewing Mode (Off Duty)"}
                    </Text>
                  </TouchableOpacity>
                )
              ) : (
                <View style={{ marginTop: 15, gap: 10 }}>
                  <TouchableOpacity
                    style={[styles.completeButton, !isShiftActive && { backgroundColor: '#64748B' }, { marginTop: 0 }]}
                    onPress={() => {
                      if (!isShiftActive) {
                        Alert.alert(
                          'Read-Only Mode (Off Duty)',
                          'You cannot complete pickups while off duty or without an assigned truck in CENRO Fleet Inventory.',
                          [{ text: 'OK', style: 'default' }]
                        );
                        return;
                      }
                      setShowCompleteModal(true);
                    }}
                  >
                    <MaterialIcons name={isShiftActive ? "photo-camera" : "lock"} size={19} color="#FFFFFF" />
                    <Text style={styles.completeButtonText}>
                      {isShiftActive ? "Complete this pickup" : "Viewing Mode (Off Duty)"}
                    </Text>
                  </TouchableOpacity>

                  {(simulationState.isActive || isActualDriving) && (
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TouchableOpacity
                        style={[styles.completeButton, { flex: 1, backgroundColor: '#DC2626', marginTop: 0, height: 44 }]}
                        onPress={handleToggleSimulation}
                      >
                        <MaterialIcons name="stop" size={17} color="#FFFFFF" />
                        <Text style={[styles.completeButtonText, { fontSize: 13 }]}>Stop Drive</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.completeButton, { flex: 1, backgroundColor: '#059669', marginTop: 0, height: 44 }]}
                        onPress={handleCompleteRouteAction}
                      >
                        <MaterialIcons name="check-circle" size={17} color="#FFFFFF" />
                        <Text style={[styles.completeButtonText, { fontSize: 13 }]}>Complete Route</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      )}

      {selectedStop && (
        <CompletePickupModal
          visible={showCompleteModal}
          scheduleId={selectedStop.scheduleId || (selectedStop.id.includes('_stop_') ? selectedStop.id.split('_stop_')[0] : selectedStop.id)}
          reportId={selectedStop.reportId || (selectedStop.id.startsWith('rep_') ? selectedStop.id.replace('rep_', '') : null)}
          location={`${selectedStop.street}, ${selectedStop.barangay}`}
          wasteType={selectedStop.wasteCategory}
          onClose={() => setShowCompleteModal(false)}
          onSubmit={() => {
            setShowCompleteModal(false);
            Alert.alert('✅ Pickup Completed', 'Collection evidence successfully recorded.');
          }}
        />
      )}

      <DriveModeSelectModal
        visible={showDriveModeModal}
        onClose={() => setShowDriveModeModal(false)}
        assignedBarangay={effectiveBarangay}
        truckPlate={assignedTruckPlate}
        isDark={isDark}
        onSelectMode={handleSelectDriveMode}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E5E7EB' },
  containerDark: { backgroundColor: '#111827' },
  header: { position: 'absolute', left: 16, right: 16, minHeight: 68, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 18, padding: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.14, shadowRadius: 8, elevation: 5 },
  panelDark: { backgroundColor: 'rgba(31,41,55,0.97)' },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },
  iconButtonDark: { backgroundColor: '#374151' },
  headerCopy: { flex: 1, marginHorizontal: 10 },
  headerTitle: { color: '#111827', fontSize: 17, fontWeight: '800' },
  headerSubtitle: { color: '#6B7280', fontSize: 11, marginTop: 2 },
  routePanel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 18, paddingHorizontal: 18, backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 9 },
  panelHeadingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14 },
  eyebrow: { color: '#7C3AED', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginBottom: 4 },
  targetStreet: { color: '#111827', fontSize: 20, fontWeight: '800', maxWidth: 280 },
  targetMeta: { color: '#6B7280', fontSize: 12, marginTop: 3 },
  orderBadge: { width: 45, height: 45, borderRadius: 15, backgroundColor: '#EDE9FE', alignItems: 'center', justifyContent: 'center' },
  orderBadgeText: { color: '#6D28D9', fontWeight: '900', fontSize: 16 },
  stopsLabel: { color: '#6B7280', fontSize: 10, fontWeight: '800', letterSpacing: 0.7, marginTop: 16, marginBottom: 8 },
  stopStrip: { gap: 8, paddingRight: 20 },
  stopChip: { width: 150, height: 47, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 13, paddingHorizontal: 10, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  stopChipDark: { backgroundColor: '#374151', borderColor: '#4B5563' },
  stopChipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  stopChipNumber: { color: '#7C3AED', fontSize: 12, fontWeight: '900' },
  stopChipStreet: { flex: 1, color: '#374151', fontSize: 12, fontWeight: '700' },
  stopChipTextActive: { color: '#FFFFFF' },
  completeButton: { height: 49, marginTop: 15, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2E8B57' },
  completeButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  truckMarker: { width: 42, height: 42, borderRadius: 21, borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },
  stopMarker: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center' },
  stopMarkerSelected: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#2E8B57' },
  stopMarkerText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  gpsWarning: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 9, backgroundColor: '#FFFBEB', marginTop: 12 },
  gpsWarningText: { flex: 1, color: '#92400E', fontSize: 11, fontWeight: '600' },
  routeTypeBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, marginTop: 11 },
  routeTypeRoad: { backgroundColor: '#DCFCE7' },
  routeTypeFallback: { backgroundColor: '#EDE9FE' },
  routeTypeText: { fontSize: 11, fontWeight: '800' },
  loadingBox: { minHeight: 125, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  loadingText: { color: '#6B7280', fontSize: 13 },
  emptyBox: { minHeight: 140, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  emptyTitle: { color: '#111827', fontSize: 16, fontWeight: '800', marginTop: 8 },
  emptyText: { color: '#6B7280', fontSize: 12, textAlign: 'center', marginTop: 3 },
  errorText: { color: '#B91C1C', fontSize: 12, textAlign: 'center', marginTop: 8 },
  backHomeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2E8B57',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 14,
  },
  backHomeBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  textLight: { color: '#F9FAFB' },
  textMuted: { color: '#9CA3AF' },
  simMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#059669',
    paddingHorizontal: 10,
    height: 42,
    borderRadius: 21,
  },
  simMapBtnActive: {
    backgroundColor: '#DC2626',
  },
  simMapBtnStop: {
    backgroundColor: '#DC2626',
  },
  simMapBtnComplete: {
    backgroundColor: '#059669',
  },
  simMapBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  simHudCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderRadius: 18,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  simHudCardDark: {
    backgroundColor: 'rgba(30, 41, 59, 0.98)',
    borderColor: '#334155',
  },
  simHudHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  simLivePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  simHudTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1E293B',
    letterSpacing: 0.5,
  },
  simHudRatioBadge: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  simHudRatioText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#7C3AED',
  },
  simHudStopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  simHudStopText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#EF4444',
  },
  simHudProgressBarTrack: {
    height: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 10,
  },
  simHudProgressBarFill: {
    height: '100%',
    backgroundColor: '#7C3AED',
    borderRadius: 2,
  },
  simHudMetricsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  simHudMetricCard: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  simHudMetricCardDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  simHudMetricIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  simHudMetricLabel: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  simHudMetricVal: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  simHudMetricSubVal: {
    fontSize: 10,
    fontWeight: '500',
    color: '#94A3B8',
  },
  simHudMetricCaption: {
    fontSize: 9,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  simSpeedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0',
    paddingTop: 8,
  },
  simSpeedRowLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#64748B',
  },
  simSpeedPillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    flex: 1,
  },
  simSpeedPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  simSpeedPillDark: {
    backgroundColor: '#334155',
    borderColor: '#475569',
  },
  simSpeedPillActive: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
  },
  simSpeedPillActiveDark: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  simSpeedPillText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#475569',
  },
  simSpeedPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  // Cockpit Mode HUD (RA 10913 Hands-Free Driving Compliant)
  cockpitHudContainer: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 999,
  },
  cockpitTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  cockpitExitBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  cockpitExitBtnDark: {
    backgroundColor: 'rgba(31, 41, 55, 0.95)',
  },
  cockpitComplianceBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(240, 253, 244, 0.95)',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 8,
  },
  cockpitComplianceBadgeDark: {
    backgroundColor: 'rgba(20, 83, 45, 0.9)',
    borderColor: '#166534',
  },
  cockpitComplianceText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#15803D',
    letterSpacing: 0.3,
  },
  cockpitRouteToggleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cockpitRouteToggleBtnActive: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  cockpitRouteToggleBtnDark: {
    backgroundColor: 'rgba(31, 41, 55, 0.95)',
    borderColor: '#374151',
  },
  cockpitRouteToggleBtnActiveDark: {
    backgroundColor: 'rgba(20, 83, 45, 0.95)',
    borderColor: '#166534',
  },
  cockpitSpeedBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  cockpitSpeedBarRowDark: {
    backgroundColor: 'rgba(30, 41, 59, 0.96)',
    borderColor: '#334155',
  },
  cockpitSpeedBarLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cockpitSpeedBarText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7C3AED',
    letterSpacing: 0.5,
  },
  cockpitSpeedPills: {
    flexDirection: 'row',
    gap: 4,
  },
  cockpitPill: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cockpitPillActive: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
  },
  cockpitPillText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#475569',
  },
  cockpitPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  cockpitStopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 19,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 4,
  },
  cockpitCompleteBtn: {
    backgroundColor: '#059669',
    shadowColor: '#059669',
  },
  cockpitStopBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  cockpitMainCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderRadius: 20,
    padding: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cockpitMainCardDark: {
    backgroundColor: 'rgba(30, 41, 59, 0.97)',
    borderColor: '#334155',
  },
  cockpitSpeedometerBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#22C55E',
  },
  cockpitSpeedometerBoxDark: {
    backgroundColor: '#020617',
    borderColor: '#16A34A',
  },
  cockpitSpeedometerNumber: {
    fontSize: 26,
    fontWeight: '900',
    color: '#22C55E',
    lineHeight: 30,
  },
  cockpitSpeedometerUnit: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  cockpitStreetInfo: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  cockpitStreetHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7C3AED',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cockpitStreetTarget: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginVertical: 2,
  },
  cockpitProgressTrack: {
    height: 5,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 4,
  },
  cockpitProgressFill: {
    height: '100%',
    backgroundColor: '#7C3AED',
    borderRadius: 3,
  },
  cockpitTelemetryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  cockpitTelemetryRowDark: {
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderColor: '#334155',
  },
  cockpitTelemetryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cockpitTelemetryVal: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
  },
  cockpitTelemetrySub: {
    fontSize: 9.5,
    fontWeight: '500',
    color: '#64748B',
  },
  cockpitTelemetryDivider: {
    width: 1,
    height: 14,
    backgroundColor: '#CBD5E1',
  },
  cockpitBottomDock: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cockpitBottomDockDark: {
    backgroundColor: 'rgba(30, 41, 59, 0.96)',
    borderColor: '#334155',
  },
  cockpitStopBadge: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  cockpitStopBadgeText: {
    color: '#7C3AED',
    fontWeight: '900',
    fontSize: 12,
  },
  cockpitBottomStreet: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  cockpitBottomSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  cockpitExpandDrawerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  cockpitExpandDrawerBtnDark: {
    backgroundColor: '#064E3B',
  },
  cockpitExpandDrawerText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },
  returnToCockpitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16A34A',
    borderRadius: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  returnToCockpitText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  inCabEmergencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 8,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  inCabEmergencyIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inCabEmergencyTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#991B1B',
    letterSpacing: 0.3,
  },
  inCabEmergencySubtitle: {
    fontSize: 10,
    color: '#7F1D1D',
    fontWeight: '600',
    lineHeight: 14,
  },
  inCabWeatherBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0F9FF',
    borderWidth: 1.5,
    borderColor: '#7DD3FC',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 8,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  inCabWeatherTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#075985',
    letterSpacing: 0.3,
  },
  inCabWeatherSubtitle: {
    fontSize: 10,
    color: '#0369A1',
    fontWeight: '600',
  },
  simMapBtnPaused: {
    backgroundColor: '#DC2626',
  },
  headerAlertStrip: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 999,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerAlertText: {
    fontSize: 11,
    color: '#991B1B',
    fontWeight: '700',
    flex: 1,
  },
  headerWeatherStrip: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 999,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#7DD3FC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerWeatherText: {
    fontSize: 11,
    color: '#075985',
    fontWeight: '700',
    flex: 1,
  },
});
