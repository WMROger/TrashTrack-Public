import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

import { auth, db } from '@/config/firebase';
import { getOptimizedReportImageUrl } from '@/config/cloudinary';
import { mergeDanaoBarangays } from '@/constants/danaoBarangays';
import { locationService, SimulationState } from '@/services/locationService';
import {
  optimizeBarangayRouteWithTraffic,
  RouteStop,
  TrafficOptimizationResult,
} from '@/services/trafficAwareOptimizerService';
import RouteOptimizationMap from './RouteOptimizationMap';
import {
  isAutoDispatchEnabled,
  setAutoDispatchEnabled,
  reassignReportToDriver,
  revertReportToQueue,
} from '@/services/autoDispatchService';
import { writeAuditLog } from '@/services/auditLogService';
import { applicableDieselFactor, DEFAULT_DIESEL_SETTINGS, DieselSettings, parametersForTruck } from '@/services/dieselService';
import { DieselModel } from '@/services/dieselMath';

interface Report {
  id: string;
  title: string;
  description: string;
  street: string;
  barangay: string;
  status: string;
  imageURL?: string;
  createdAt: any;
  userEmail?: string;
  userId?: string;
  location?: { lat?: number; lng?: number; latitude?: number; longitude?: number } | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  aiAnalysis?: {
    wasteType: string;
    estimatedWeight: string;
    confidence: string;
    details: string;
  };
}

interface Driver {
  id: string;
  displayName: string;
  email: string;
  assignedBarangay?: string;
  barangay?: string;
  currentTruckId?: string;
  currentTruckPlate?: string;
  status?: string;
  dutyStatus?: string;
}

interface RouteOptimizationTabProps {
  userRole?: string;
  assignedBarangay?: string;
  isReadOnly?: boolean;
}

export default function RouteOptimizationTab({
  userRole = 'admin',
  assignedBarangay = '',
  isReadOnly = false,
}: RouteOptimizationTabProps) {
  const isCoordinator = userRole === 'coordinator';
  const effectiveBarangay = (assignedBarangay || '').trim();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const isNarrow = width < 1024;

  // Active Sub-Tab
  const [activeSubView, setActiveSubView] = useState<'route-ai' | 'stops-sequence' | 'report-dispatch'>('route-ai');

  // Core Data
  const [availableBarangays, setAvailableBarangays] = useState<string[]>(
    isCoordinator && effectiveBarangay ? [effectiveBarangay] : []
  );
  const [selectedBarangay, setSelectedBarangay] = useState<string>(
    isCoordinator && effectiveBarangay ? effectiveBarangay : 'Poblacion'
  );
  const [isBarangayDropdownOpen, setIsBarangayDropdownOpen] = useState(false);
  const [isDriverDropdownOpen, setIsDriverDropdownOpen] = useState(false);
  const [barangaySearchQuery, setBarangaySearchQuery] = useState('');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [trucksMap, setTrucksMap] = useState<Record<string, string>>({});
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  // Keep selected barangay strictly locked for coordinators
  useEffect(() => {
    if (isCoordinator && effectiveBarangay) {
      setSelectedBarangay(effectiveBarangay);
      setAvailableBarangays([effectiveBarangay]);
    }
  }, [isCoordinator, effectiveBarangay]);

  // Simulation & Live State
  const [simState, setSimState] = useState<SimulationState>(locationService.getSimulationState());

  // AI Optimization State
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(new Set());
  const [isOptimizingAI, setIsOptimizingAI] = useState(false);
  const [optResult, setOptResult] = useState<TrafficOptimizationResult | null>(null);

  // Dispatch Modal State
  const [showDispatchConfirmModal, setShowDispatchConfirmModal] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);

  // Active live dispatch schedule for the selected driver
  const [activeDriverSchedule, setActiveDriverSchedule] = useState<any | null>(null);

  useEffect(() => {
    if (!db || !selectedDriverId) {
      setActiveDriverSchedule(null);
      return;
    }
    const q = query(
      collection(db, 'schedules'),
      where('assignedDriverId', '==', selectedDriverId),
      where('status', '==', 'in_progress')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const active = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .find((d: any) => d.isLiveDispatch && !d.dieselClosedAt);
        setActiveDriverSchedule(active || null);
      },
      (error) => {
        console.warn('Active driver schedule listener warning:', error);
      }
    );
    return () => unsub();
  }, [selectedDriverId]);

  // AI Autonomous Dispatch Toggle State
  const [autoDispatchActive, setAutoDispatchActive] = useState(true);
  const [isTogglingAutoDispatch, setIsTogglingAutoDispatch] = useState(false);

  // Report Preview Modal
  const [viewingReport, setViewingReport] = useState<Report | null>(null);
  const [reportSearch, setReportSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'acknowledged' | 'in_progress'>('acknowledged');

  // Fetch initial auto dispatch toggle setting
  useEffect(() => {
    isAutoDispatchEnabled().then((enabled) => {
      setAutoDispatchActive(enabled);
    });
  }, []);

  const handleToggleAutoDispatch = async () => {
    setIsTogglingAutoDispatch(true);
    const nextVal = !autoDispatchActive;
    setAutoDispatchActive(nextVal);
    await setAutoDispatchEnabled(nextVal);
    setIsTogglingAutoDispatch(false);
  };

  const autoDispatchedReportsCount = useMemo(() => {
    return reports.filter((r) => r.status === 'in-progress' || r.status === 'in_progress').length;
  }, [reports]);

  const queuedReportsCount = useMemo(() => {
    return reports.filter((r) => r.status === 'acknowledged' || (r as any).queuedForDriver === true).length;
  }, [reports]);

  // 1. Subscribe to Collection Schedules for Dynamic Barangays + All Danao City & Report Barangays
  useEffect(() => {
    if (!db) return;
    if (isCoordinator && effectiveBarangay) {
      setAvailableBarangays([effectiveBarangay]);
      setSelectedBarangay(effectiveBarangay);
      return;
    }
    const unsubSchedules = onSnapshot(collection(db, 'barangay_schedules'), (snap) => {
      const scheduleNames = new Set<string>();
      snap.forEach((d) => {
        const data = d.data();
        if (data.barangayName && typeof data.barangayName === 'string' && data.barangayName.trim()) {
          scheduleNames.add(data.barangayName.trim());
        }
      });
      const reportBarangays = reports.map((r) => r.barangay).filter(Boolean);
      const resolved = mergeDanaoBarangays([...Array.from(scheduleNames), ...reportBarangays]);
      setAvailableBarangays(resolved);
      if (resolved.length > 0 && (!selectedBarangay || !resolved.includes(selectedBarangay))) {
        setSelectedBarangay(resolved[0]);
      }
    });
    return () => unsubSchedules();
  }, [reports, selectedBarangay, isCoordinator, effectiveBarangay]);

  // Also update availableBarangays when reports change (only for non-coordinator)
  useEffect(() => {
    if (isCoordinator && effectiveBarangay) {
      setAvailableBarangays([effectiveBarangay]);
      setSelectedBarangay(effectiveBarangay);
      return;
    }
    if (reports.length > 0) {
      setAvailableBarangays((prev) => {
        const reportBrs = reports.map((r) => r.barangay).filter(Boolean);
        return mergeDanaoBarangays([...prev, ...reportBrs]);
      });
    }
  }, [reports, isCoordinator, effectiveBarangay]);

  // 2. Fetch Trucks Map
  useEffect(() => {
    if (!db) return;
    const unsubTrucks = onSnapshot(collection(db, 'trucks'), (snap) => {
      const map: Record<string, string> = {};
      snap.forEach((d) => {
        const data = d.data();
        map[d.id] = data.plateNumber || data.truckNumber || `Truck ${d.id.slice(-4)}`;
      });
      setTrucksMap(map);
    });
    return () => unsubTrucks();
  }, []);

  // 3. Fetch Drivers
  useEffect(() => {
    if (!db) return;
    const qUsers = query(collection(db, 'users'), where('role', '==', 'driver'));
    const unsubUsers = onSnapshot(qUsers, (snap) => {
      const driverList: Driver[] = [];
      snap.forEach((d) => {
        const u = d.data();
        if (u.disabled !== true && u.status !== 'disabled') {
          const rawDuty = u.dutyStatus || (u.status === 'on_duty' || u.status === 'off_duty' ? u.status : 'off_duty');
          const isOnDuty = (u.dutyStatus === 'on_duty' || u.status === 'on_duty') && rawDuty !== 'off_duty' && u.status !== 'off_duty';

          driverList.push({
            id: d.id,
            displayName: u.displayName || u.name || u.email || 'Assigned Driver',
            email: u.email || '',
            assignedBarangay: (u.assignedBarangay || u.barangay || '').trim(),
            barangay: (u.barangay || '').trim(),
            currentTruckId: u.currentTruckId || undefined,
            currentTruckPlate: u.currentTruckPlate || undefined,
            status: isOnDuty ? 'on_duty' : 'off_duty',
            dutyStatus: rawDuty,
          });
        }
      });
      setDrivers(driverList);
      setLoading(false);
    });
    return () => unsubUsers();
  }, []);

  // 4. Fetch Verified Reports (including acknowledged and in-progress)
  useEffect(() => {
    if (!db) return;
    const reportsRef = collection(db, 'reports');
    const qReports = query(
      reportsRef,
      where('status', 'in', ['acknowledged', 'in-progress', 'in_progress', 'in progress', 'verified'])
    );
    const unsubReports = onSnapshot(qReports, (snapshot) => {
      const data: Report[] = [];
      snapshot.forEach((docSnap) => {
        data.push({ id: docSnap.id, ...docSnap.data() } as Report);
      });
      data.sort((a, b) => (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0));
      setReports(data);
    });
    return () => unsubReports();
  }, []);

  // 5. Listen to Live Driver Movement Simulation State
  useEffect(() => {
    const unsubSim = locationService.onSimulationChange((state) => {
      setSimState(state);
    });
    return () => unsubSim();
  }, []);

  // 6. Filter Barangays for Searchable Dropdown
  const filteredBarangays = useMemo(() => {
    const q = barangaySearchQuery.trim().toLowerCase();
    if (!q) return availableBarangays;
    return availableBarangays.filter((b) => b.toLowerCase().includes(q));
  }, [availableBarangays, barangaySearchQuery]);

  // 7. All drivers registered to this barangay
  const barangayDrivers = useMemo(() => {
    const current = selectedBarangay.trim().toLowerCase();
    if (!current) return [];

    return drivers.filter((d) => {
      const b = (d.assignedBarangay || d.barangay || '').trim().toLowerCase();
      if (!b) return false;
      return b === current || b === `${current} city` || current.includes(b) || b.includes(current);
    });
  }, [drivers, selectedBarangay]);

  // 8. Active on-duty drivers strictly assigned to this barangay
  const activeBarangayDrivers = useMemo(() => {
    return barangayDrivers.filter((d) => {
      const isAvailable = (d.status === 'on_duty' || d.dutyStatus === 'on_duty') &&
        d.status !== 'off_duty' && d.dutyStatus !== 'off_duty' && d.status !== 'disabled' && d.status !== 'inactive';
      return isAvailable;
    });
  }, [barangayDrivers]);

  // Auto-select first available driver for this barangay when barangay changes
  useEffect(() => {
    if (activeBarangayDrivers.length > 0) {
      if (!selectedDriverId || !activeBarangayDrivers.some((d) => d.id === selectedDriverId)) {
        setSelectedDriverId(activeBarangayDrivers[0].id);
      }
    } else {
      setSelectedDriverId('');
    }
  }, [activeBarangayDrivers, selectedDriverId]);

  // Selected driver object
  const currentSelectedDriver = useMemo(() => {
    return drivers.find((d) => d.id === selectedDriverId) || null;
  }, [drivers, selectedDriverId]);

  // Diesel settings
  const [dieselSettings, setDieselSettings] = useState<DieselSettings>(DEFAULT_DIESEL_SETTINGS);
  const [dieselModel, setDieselModel] = useState<DieselModel | null>(null);
  const [dieselError, setDieselError] = useState('');
  const dieselParameters = useMemo(() => parametersForTruck(dieselSettings, currentSelectedDriver?.currentTruckId), [dieselSettings, currentSelectedDriver?.currentTruckId]);

  useEffect(() => onSnapshot(doc(db, 'diesel_settings', 'main'), (snap) => {
    setDieselSettings(snap.exists() ? { ...DEFAULT_DIESEL_SETTINGS, ...snap.data() } as DieselSettings : DEFAULT_DIESEL_SETTINGS);
    setDieselError('');
  }, () => setDieselError('Supply settings could not be loaded. Fuel figures use demonstration assumptions.')), []);

  useEffect(() => {
    setDieselModel(null);
    if (!currentSelectedDriver?.currentTruckId) return;
    return onSnapshot(doc(db, 'diesel_models', currentSelectedDriver.currentTruckId), (snap) => setDieselModel(snap.exists() ? snap.data() as DieselModel : null),
      () => setDieselError('Truck learning could not be loaded. The basic diesel formula is in use.'));
  }, [currentSelectedDriver?.currentTruckId]);

  // All reports within this selected Barangay
  const barangayReportsAll = useMemo(() => {
    return reports.filter((r) => {
      const b = (r.barangay || '').trim().toLowerCase();
      const current = selectedBarangay.trim().toLowerCase();
      return b === current || b === `${current} city` || current.includes(b) || b.includes(current);
    });
  }, [reports, selectedBarangay]);

  // Verified reports waiting for route slotting
  const queuedInBarangayCount = useMemo(() => {
    return barangayReportsAll.filter((r) => {
      const s = (r.status || '').toLowerCase().replace(/_/g, '-');
      const isDispatched = s === 'in-progress' || Boolean((r as any).assignedDriverId);
      return !isDispatched && (s === 'acknowledged' || (r as any).queuedForDriver === true);
    }).length;
  }, [barangayReportsAll]);

  // Reports already slotted into an active driver route
  const inProgressInBarangayCount = useMemo(() => {
    return barangayReportsAll.filter((r) => {
      const s = (r.status || '').toLowerCase().replace(/_/g, '-');
      return s === 'in-progress' || Boolean((r as any).assignedDriverId);
    }).length;
  }, [barangayReportsAll]);

  // Filter Verified Reports for this Barangay based on status tab
  const barangayReports = useMemo(() => {
    return barangayReportsAll.filter((r) => {
      const normStatus = (r.status || '').toLowerCase().replace(/_/g, '-');
      const isDispatched = normStatus === 'in-progress' || Boolean((r as any).assignedDriverId);

      if (statusFilter === 'acknowledged' && isDispatched) {
        return false;
      }
      if (statusFilter === 'in_progress' && !isDispatched) {
        return false;
      }
      if (reportSearch.trim()) {
        const q = reportSearch.toLowerCase().trim();
        return (
          (r.title || '').toLowerCase().includes(q) ||
          (r.street || '').toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q) ||
          (r.aiAnalysis?.wasteType || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [barangayReportsAll, statusFilter, reportSearch]);

  // Selected Report objects explicitly chosen by coordinator
  const selectedReportObjects = useMemo(() => {
    return reports.filter((r) => selectedReportIds.has(r.id));
  }, [reports, selectedReportIds]);

  // All reports included in this driver's optimized route:
  // 1. Any report already assigned to this driver in this barangay
  // 2. Any pending reports explicitly selected by coordinator
  const reportsInRoute = useMemo(() => {
    const cleanBarangay = selectedBarangay.trim().toLowerCase();
    const driverActiveReports = reports.filter((r) => {
      const repBrgy = (r.barangay || '').trim().toLowerCase();
      const isBrgyMatch =
        repBrgy === cleanBarangay ||
        repBrgy.includes(cleanBarangay) ||
        cleanBarangay.includes(repBrgy);
      if (!isBrgyMatch) return false;
      const isDriverMatch = (r as any).assignedDriverId === selectedDriverId;
      const normStatus = String(r.status || '')
        .toLowerCase()
        .replace(/_/g, '-');
      const isInProg = normStatus === 'in-progress';
      return isDriverMatch && isInProg;
    });
    const manuallySelected = reports.filter((r) => {
      const repBrgy = (r.barangay || '').trim().toLowerCase();
      const isBrgyMatch =
        repBrgy === cleanBarangay ||
        repBrgy.includes(cleanBarangay) ||
        cleanBarangay.includes(repBrgy);
      return (
        isBrgyMatch &&
        selectedReportIds.has(r.id) &&
        (r as any).assignedDriverId !== selectedDriverId
      );
    });
    const combinedMap = new Map<string, Report>();
    driverActiveReports.forEach((r) => combinedMap.set(r.id, r));
    manuallySelected.forEach((r) => combinedMap.set(r.id, r));
    return Array.from(combinedMap.values());
  }, [reports, selectedReportIds, selectedDriverId, selectedBarangay]);

  // Trigger AI Traffic & Fuel Optimization
  const runOptimization = useCallback((extraReps: Report[] = reportsInRoute) => {
    setIsOptimizingAI(true);
    try {
      const factor = applicableDieselFactor(dieselModel, dieselParameters);
      const result = optimizeBarangayRouteWithTraffic(
        selectedBarangay,
        extraReps,
        dieselParameters,
        factor,
        factor !== 1 ? dieselModel?.id || null : null,
        dieselSettings.parameterSource + '; ' + dieselSettings.priceSource + '; price effective ' + (dieselSettings.priceDate || 'not configured')
      );
      setOptResult(result);
    } catch (err) {
      console.error('Error running traffic optimization:', err);
    } finally {
      setIsOptimizingAI(false);
    }
  }, [reportsInRoute, selectedBarangay, dieselParameters, dieselModel, dieselSettings]);

  // Run automatically when selected barangay or inserted reports change
  useEffect(() => {
    if (selectedBarangay) {
      runOptimization(reportsInRoute);
    }
  }, [selectedBarangay, reportsInRoute, runOptimization]);

  // Toggle report insertion (works for pending reports and reassigning in-progress reports)
  const toggleReportSelection = (id: string) => {
    setSelectedReportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Driver Live Phone GPS Location from Firestore
  const [driverLiveLocation, setDriverLiveLocation] = useState<{
    latitude: number;
    longitude: number;
    speed: number;
    locationName?: string;
    isBroadcasting: boolean;
    isSimulation?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!db || !selectedDriverId) {
      setDriverLiveLocation(null);
      return;
    }
    const unsubLocation = onSnapshot(doc(db, 'truck_locations', selectedDriverId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const lat = data.lat ?? data.location?.latitude;
        const lng = data.lng ?? data.location?.longitude;
        const isActive = data.status === 'active';
        if (Number.isFinite(lat) && Number.isFinite(lng) && isActive) {
          setDriverLiveLocation({
            latitude: Number(lat),
            longitude: Number(lng),
            speed: Number(data.speed || 0),
            locationName: data.locationName || data.barangay || 'Active Route',
            isBroadcasting: true,
            isSimulation: !!data.isSimulation,
          });
          return;
        }
      }
      setDriverLiveLocation(null);
    });
    return () => unsubLocation();
  }, [selectedDriverId]);

  // Dispatch Route to Driver Terminal (Only for Barangay Coordinators)
  const handleDispatchToDriver = async () => {
    if (!isCoordinator) {
      Alert.alert(
        'View-Only Oversight Mode',
        'Route dispatch is delegated to Barangay Field Stewards to prevent duplicate output. CENRO maintains municipal oversight.'
      );
      return;
    }
    if (!selectedDriverId || !currentSelectedDriver) {
      Alert.alert('No Driver Selected', 'Please select an active driver for dispatch in the operational deck above.');
      return;
    }
    if (!optResult) {
      Alert.alert('No Optimized Route', 'Please generate the optimized route first.');
      return;
    }

    setIsDispatching(true);
    try {
      const driverName = currentSelectedDriver.displayName || 'Assigned Driver';
      const truckId = currentSelectedDriver.currentTruckId || null;
      const today = new Date();
      const dateText = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      // 1. Check if an active open live dispatch schedule already exists for this driver to avoid duplicate schedules
      const schedulesRef = collection(db, 'schedules');
      let openTrip: any = null;
      try {
        const qActiveSchedule = query(
          schedulesRef,
          where('assignedDriverId', '==', selectedDriverId),
          where('status', '==', 'in_progress')
        );
        const scheduleSnap = await getDocs(qActiveSchedule);
        openTrip = scheduleSnap.docs.find(item => item.data().isLiveDispatch && !item.data().dieselClosedAt);
      } catch (checkErr) {
        console.warn('Could not query active live dispatch schedule, will proceed to create new schedule:', checkErr);
      }

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
        // Update existing live schedule to prevent duplicating schedules on driver terminal
        await updateDoc(openTrip.ref, {
          barangay: selectedBarangay,
          street: `Master AI Collection Route (${optResult.optimizedStops.length} Stops)`,
          wasteCategory: 'Scheduled & Citizen Reports',
          timeText: 'Active Route Sequence',
          dateText: dateText,
          status: 'in_progress',
          driver: driverName,
          truckId: truckId,
          truckPlate: currentSelectedDriver.currentTruckPlate || '',
          fuelBudgetLiters: Math.round(optResult.optimizedFuelLiters * 1.10 * 100) / 100,
          stops: formattedStops,
          'routeOptimization.stopCount': optResult.optimizedStops.length,
          'routeOptimization.optimizedDistanceKm': optResult.optimizedDistanceKm,
          'routeOptimization.baselineDistanceKm': optResult.baselineDistanceKm,
          'routeOptimization.fuelSavingsLiters': optResult.fuelSavingsLiters,
          'routeOptimization.fuelCostSavedPhp': optResult.fuelCostSavedPhp,
          'routeOptimization.timeSavingsMinutes': optResult.timeSavingsMinutes,
          'routeOptimization.roadPolyline': optResult.roadPolyline,
          updatedAt: serverTimestamp(),
        });
      } else {
        // Create new live master route schedule in Firestore
        await addDoc(schedulesRef, {
          barangay: selectedBarangay,
          street: `Master AI Collection Route (${optResult.optimizedStops.length} Stops)`,
          wasteCategory: 'Scheduled & Citizen Reports',
          timeText: 'Active Route Sequence',
          dateText: dateText,
          status: 'in_progress',
          driver: driverName,
          assignedDriverId: selectedDriverId,
          truckId: truckId,
          truckPlate: currentSelectedDriver.currentTruckPlate || '',
          isLiveDispatch: true,
          fuelBudgetLiters: Math.round(optResult.optimizedFuelLiters * 1.10 * 100) / 100,
          routeOptimization: {
            method: 'traffic-aware-fuel-optimized',
            ...(dieselParameters.pricePerLiter > 0 ? { dieselEstimate: optResult.dieselEstimate } : {}),
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
          createdByUid: auth.currentUser?.uid || null,
          createdAt: serverTimestamp(),
        });
      }

      // 2. Mark inserted citizen reports as in-progress and assigned to driver (handles new dispatches and reassignments from old drivers)
      for (const rep of reportsInRoute) {
        try {
          await reassignReportToDriver(rep.id, {
            id: selectedDriverId,
            displayName: driverName,
            currentTruckPlate: currentSelectedDriver.currentTruckPlate || '',
          }, true);
        } catch (repErr) {
          console.warn('Error updating report status:', repErr);
        }
      }

      // 3. Update driver's assigned barangay in their user profile
      if (selectedDriverId) {
        try {
          await updateDoc(doc(db, 'users', selectedDriverId), {
            assignedBarangay: selectedBarangay,
            barangay: selectedBarangay,
            updatedAt: serverTimestamp(),
          });
        } catch (uErr) {
          console.warn('Error updating driver assigned barangay:', uErr);
        }
      }

      await writeAuditLog('route.dispatched', 'driver', selectedDriverId, {
        barangay: selectedBarangay,
        driverName,
        stopsCount: optResult.optimizedStops.length,
        reportsCount: reportsInRoute.length,
        fuelSavingsLiters: optResult.fuelSavingsLiters,
        fuelCostSavedPhp: optResult.fuelCostSavedPhp,
      });

      setShowDispatchConfirmModal(false);
      setSelectedReportIds(new Set());
      Alert.alert(
        'Route Dispatched Successfully! 🚛',
        `The traffic-optimized collection route with ${optResult.optimizedStops.length} stopping points has been transmitted directly to ${driverName}'s terminal.`
      );
    } catch (err: any) {
      console.error('Error dispatching route:', err);
      Alert.alert('Dispatch Error', err?.message || 'Failed to dispatch route.');
    } finally {
      setIsDispatching(false);
    }
  };

  const isDriverBroadcasting = Boolean(
    driverLiveLocation?.isBroadcasting || (simState.isActive && simState.driverId === selectedDriverId)
  );

  return (
    <ScrollView style={[styles.container, isMobile && { padding: 12 }]} showsVerticalScrollIndicator={false}>
      {/* Top Header Banner & Subview Segmented Switcher */}
      <View style={[styles.headerRow, isNarrow && { flexDirection: 'column', alignItems: 'flex-start', gap: 12 }]}>
        <View style={{ flex: 1 }}>
          <View style={styles.headerTagRow}>
            <View style={styles.headerTagPill}>
              <MaterialIcons name="alt-route" size={13} color="#059669" />
              <Text style={styles.headerTagText}>
                {isCoordinator
                  ? `BARANGAY FIELD STEWARD • BRGY. ${(effectiveBarangay || selectedBarangay).toUpperCase()}`
                  : 'CENRO SOLID WASTE MANAGEMENT • SMART DISPATCH'}
              </Text>
            </View>
          </View>
          <Text style={styles.headerTitle}>
            {isCoordinator
              ? `Brgy. ${effectiveBarangay || selectedBarangay} Route & AI Dispatch`
              : 'Route & Autonomous AI Dispatch'}
          </Text>
          <Text style={styles.headerDescription}>
            {isCoordinator
              ? `Simulate collection corridors, bypass traffic bottlenecks, and dispatch verified citizen reports for Barangay ${effectiveBarangay || selectedBarangay}.`
              : 'Simulate baseline collection corridors, bypass Danao City commercial traffic bottlenecks, and slot verified citizen reports into active driver routes.'}
          </Text>
        </View>

        {/* View Segmented Switcher Tabs */}
        <View style={styles.segmentedContainer}>
          <TouchableOpacity
            style={[styles.segmentBtn, activeSubView === 'route-ai' && styles.segmentBtnActive]}
            onPress={() => setActiveSubView('route-ai')}
            activeOpacity={0.85}
          >
            <MaterialIcons
              name="map"
              size={16}
              color={activeSubView === 'route-ai' ? '#FFFFFF' : '#475569'}
            />
            <Text style={[styles.segmentBtnText, activeSubView === 'route-ai' && styles.segmentBtnTextActive]}>
              Corridor Map
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.segmentBtn, activeSubView === 'stops-sequence' && styles.segmentBtnActive]}
            onPress={() => setActiveSubView('stops-sequence')}
            activeOpacity={0.85}
          >
            <MaterialIcons
              name="format-list-numbered"
              size={16}
              color={activeSubView === 'stops-sequence' ? '#FFFFFF' : '#475569'}
            />
            <Text style={[styles.segmentBtnText, activeSubView === 'stops-sequence' && styles.segmentBtnTextActive]}>
              Stop Sequence ({optResult?.optimizedStops.length || 0})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.segmentBtn, activeSubView === 'report-dispatch' && styles.segmentBtnActive]}
            onPress={() => setActiveSubView('report-dispatch')}
            activeOpacity={0.85}
          >
            <MaterialIcons
              name="notification-important"
              size={16}
              color={activeSubView === 'report-dispatch' ? '#FFFFFF' : '#475569'}
            />
            <Text style={[styles.segmentBtnText, activeSubView === 'report-dispatch' && styles.segmentBtnTextActive]}>
              Citizen Reports ({selectedReportIds.size > 0 ? `${selectedReportIds.size}/${barangayReports.length}` : barangayReports.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Autonomous AI Report Dispatch Master Control Bar */}
      <View style={[styles.autoDispatchHeaderBar, isNarrow && { flexDirection: 'column', gap: 14 }]}>
        <View style={styles.autoDispatchLeft}>
          <View
            style={[
              styles.autoDispatchIconCircle,
              autoDispatchActive ? styles.autoDispatchIconCircleActive : styles.autoDispatchIconCirclePaused,
            ]}
          >
            <MaterialIcons name="auto-mode" size={24} color={autoDispatchActive ? '#059669' : '#64748B'} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={styles.autoDispatchTitle}>
                {isCoordinator
                  ? `Brgy. ${effectiveBarangay || selectedBarangay} AI Dispatch`
                  : 'Autonomous AI Report Dispatch'}
              </Text>
              <View
                style={[
                  styles.autoDispatchStatusBadge,
                  autoDispatchActive ? styles.autoDispatchStatusBadgeActive : styles.autoDispatchStatusBadgePaused,
                ]}
              >
                <View
                  style={[
                    styles.autoDispatchStatusDot,
                    { backgroundColor: autoDispatchActive ? '#10B981' : '#94A3B8' },
                  ]}
                />
                <Text
                  style={[
                    styles.autoDispatchStatusText,
                    { color: autoDispatchActive ? '#065F46' : '#475569' },
                  ]}
                >
                  {autoDispatchActive ? 'ACTIVE (Auto-Slots into Driver Route)' : 'PAUSED (Manual Mode)'}
                </Text>
              </View>
            </View>
            <Text style={styles.autoDispatchDesc}>
              {isCoordinator
                ? `Verified citizen reports in Brgy. ${effectiveBarangay || selectedBarangay} are automatically slotted into the active on-duty driver's collection sequence at lowest detour.`
                : 'Municipal View-Only Mode: Route dispatches and live driver transmissions are managed by designated Barangay Field Stewards to prevent duplicate output. CENRO monitors routes and traffic metrics across all 42 barangays.'}
            </Text>
          </View>
        </View>

        <View style={[styles.autoDispatchRight, isMobile && { flexWrap: 'wrap' }]}>
          <View style={styles.autoDispatchStatPill}>
            <Text style={styles.autoDispatchStatNum}>{autoDispatchedReportsCount}</Text>
            <Text style={styles.autoDispatchStatLabel}>Auto-Dispatched</Text>
          </View>
          <TouchableOpacity
            style={[styles.autoDispatchStatPill, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}
            onPress={() => setActiveSubView('report-dispatch')}
            activeOpacity={0.8}
          >
            <Text style={[styles.autoDispatchStatNum, { color: '#B45309' }]}>{queuedReportsCount}</Text>
            <Text style={[styles.autoDispatchStatLabel, { color: '#92400E' }]}>In Queue &rarr;</Text>
          </TouchableOpacity>
          {isCoordinator ? (
            <View style={[styles.autoDispatchToggleBtn, styles.autoDispatchToggleBtnActive, { opacity: 0.95 }]}>
              <MaterialIcons name="verified" size={18} color="#059669" />
              <Text style={[styles.autoDispatchToggleText, { color: '#065F46' }]}>
                Sector Active
              </Text>
            </View>
          ) : (
            <View style={[styles.autoDispatchToggleBtn, styles.autoDispatchToggleBtnActive, { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', opacity: 0.95 }]}>
              <MaterialIcons name="remove-red-eye" size={18} color="#475569" />
              <Text style={[styles.autoDispatchToggleText, { color: '#334155' }]}>
                View-Only Mode
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Operational Command Deck: Barangay & Active Driver Deployment */}
      <View
        style={[
          styles.commandDeckCard,
          (isBarangayDropdownOpen || isDriverDropdownOpen) && { zIndex: 1000, elevation: 25 },
        ]}
      >
        <View style={[styles.commandDeckGrid, isNarrow && { flexDirection: 'column', gap: 14 }]}>
          {/* Column 1: Searchable Barangay Dropdown or Locked Jurisdiction for Coordinator */}
          <View style={{ flex: 1.1, zIndex: 1000, position: 'relative' }}>
            <View style={styles.selectorLabelRow}>
              <MaterialIcons name={isCoordinator ? "verified-user" : "location-city"} size={16} color="#059669" />
              <Text style={styles.selectorLabel}>
                {isCoordinator ? "BARANGAY JURISDICTION (LOCKED)" : "SELECT OPERATIONAL BARANGAY"}
              </Text>
            </View>

            {/* Dropdown Button */}
            <TouchableOpacity
              style={[
                styles.deckDropdownBtn,
                isBarangayDropdownOpen && styles.deckDropdownBtnActive,
                isCoordinator && { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
              ]}
              disabled={isCoordinator}
              onPress={() => {
                if (isCoordinator) return;
                setIsBarangayDropdownOpen(!isBarangayDropdownOpen);
                setIsDriverDropdownOpen(false);
              }}
              activeOpacity={isCoordinator ? 1 : 0.85}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <View style={[styles.deckIconBox, isCoordinator && { backgroundColor: '#DCFCE7' }]}>
                  <MaterialIcons name="holiday-village" size={18} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.deckItemTitle}>
                    Brgy. {selectedBarangay || 'Select Barangay'}
                  </Text>
                  <Text style={styles.deckItemSub}>
                    {isCoordinator
                      ? `Assigned Sector • ${barangayReports.length} Active ${barangayReports.length === 1 ? 'Report' : 'Reports'}`
                      : `${availableBarangays.length} Barangays Available • ${barangayReports.length} Active ${barangayReports.length === 1 ? 'Report' : 'Reports'}`}
                  </Text>
                </View>
              </View>
              {isCoordinator ? (
                <View style={styles.assignedDirectBadge}>
                  <MaterialIcons name="lock" size={11} color="#065F46" style={{ marginRight: 2 }} />
                  <Text style={styles.assignedDirectBadgeText}>Assigned</Text>
                </View>
              ) : (
                <MaterialIcons
                  name={isBarangayDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={22}
                  color="#64748B"
                />
              )}
            </TouchableOpacity>

            {/* Dropdown Menu with Search */}
            {isBarangayDropdownOpen && !isCoordinator && (
              <View style={styles.deckDropdownMenu}>
                <View style={styles.dropdownSearchContainer}>
                  <MaterialIcons name="search" size={16} color="#64748B" />
                  <TextInput
                    style={styles.dropdownSearchInput}
                    placeholder="Search barangay name..."
                    placeholderTextColor="#94A3B8"
                    value={barangaySearchQuery}
                    onChangeText={setBarangaySearchQuery}
                    autoFocus
                  />
                  {barangaySearchQuery ? (
                    <TouchableOpacity onPress={() => setBarangaySearchQuery('')}>
                      <MaterialIcons name="close" size={14} color="#94A3B8" />
                    </TouchableOpacity>
                  ) : null}
                </View>

                <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {filteredBarangays.length === 0 ? (
                    <View style={{ padding: 14, alignItems: 'center' }}>
                      <Text style={{ fontSize: 12, color: '#94A3B8', fontStyle: 'italic' }}>
                        No matching barangays found.
                      </Text>
                    </View>
                  ) : (
                    filteredBarangays.map((b) => {
                      const isSelected = selectedBarangay === b;
                      const bLower = b.trim().toLowerCase();
                      const bReportCount = reports.filter((r) => {
                        const rBLower = (r.barangay || '').trim().toLowerCase();
                        return rBLower === bLower || bLower.includes(rBLower) || rBLower.includes(bLower);
                      }).length;

                      const bDriverCount = drivers.filter((d) => {
                        const dbLower = (d.assignedBarangay || d.barangay || '').trim().toLowerCase();
                        return (dbLower === bLower || bLower.includes(dbLower)) && (d.status === 'on_duty' || d.dutyStatus === 'on_duty');
                      }).length;

                      return (
                        <TouchableOpacity
                          key={b}
                          style={[
                            styles.deckDropdownItem,
                            isSelected && styles.deckDropdownItemSelected,
                          ]}
                          onPress={() => {
                            setSelectedBarangay(b);
                            setSelectedReportIds(new Set());
                            setIsBarangayDropdownOpen(false);
                            setBarangaySearchQuery('');
                          }}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons
                            name={isSelected ? 'check-circle' : 'location-on'}
                            size={16}
                            color={isSelected ? '#059669' : '#94A3B8'}
                          />
                          <Text
                            style={[
                              styles.deckDropdownItemText,
                              isSelected && styles.deckDropdownItemTextSelected,
                            ]}
                          >
                            Brgy. {b}
                          </Text>

                          {bDriverCount > 0 && (
                            <View style={styles.driverPresentBadge}>
                              <Text style={styles.driverPresentBadgeText}>🚚 {bDriverCount} Driver</Text>
                            </View>
                          )}

                          {bReportCount > 0 && (
                            <View style={styles.reportCountPill}>
                              <Text style={styles.reportCountPillText}>
                                {bReportCount} {bReportCount === 1 ? 'Report' : 'Reports'}
                              </Text>
                            </View>
                          )}

                          {isSelected && (
                            <View style={styles.activeSelectedBadge}>
                              <Text style={styles.activeSelectedBadgeText}>Active</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Column 2: Active Driver Selector & Flexible Deployment */}
          <View style={{ flex: 1.3, zIndex: 900, position: 'relative' }}>
            <View style={styles.selectorLabelRow}>
              <MaterialIcons name="badge" size={16} color="#0284C7" />
              <Text style={styles.selectorLabel}>ACTIVE DRIVER & VEHICLE</Text>
            </View>

            {/* If driver is selected */}
            {currentSelectedDriver ? (
              <View style={styles.driverActiveCard}>
                <View style={styles.driverActiveLeft}>
                  <View style={styles.driverAvatarCircle}>
                    <Text style={styles.driverAvatarInitial}>
                      {(currentSelectedDriver.displayName || 'D').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.driverActiveName}>{currentSelectedDriver.displayName}</Text>
                      <View style={styles.activeBadgeSmall}>
                        <Text style={styles.activeBadgeSmallText}>ON DUTY</Text>
                      </View>
                      {!!currentSelectedDriver.assignedBarangay && currentSelectedDriver.assignedBarangay.toLowerCase() !== selectedBarangay.toLowerCase() && (
                        <View style={styles.reassignedBadge}>
                          <Text style={styles.reassignedBadgeText}>Deploying to {selectedBarangay}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.driverActiveTruck}>
                      🚚 {currentSelectedDriver.currentTruckPlate || trucksMap[currentSelectedDriver.currentTruckId || ''] || 'CENRO Compactor Unit'}
                      {' &bull; '}
                      {isDriverBroadcasting ? (
                        <Text style={{ color: '#059669', fontWeight: '700' }}>
                          Live GPS ({driverLiveLocation?.speed || simState.currentSpeedKph || 0} km/h)
                        </Text>
                      ) : (
                        <Text style={{ color: '#64748B' }}>Awaiting Terminal Start</Text>
                      )}
                    </Text>
                  </View>
                </View>

                {/* Change Driver Button (Only for Coordinators actively managing dispatch) */}
                {isCoordinator ? (
                  <TouchableOpacity
                    style={styles.changeDriverBtn}
                    onPress={() => {
                      setIsDriverDropdownOpen(!isDriverDropdownOpen);
                      setIsBarangayDropdownOpen(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="swap-horiz" size={16} color="#0284C7" />
                    <Text style={styles.changeDriverBtnText}>Switch Driver</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.changeDriverBtn, { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' }]}>
                    <MaterialIcons name="visibility" size={14} color="#64748B" />
                    <Text style={[styles.changeDriverBtnText, { color: '#64748B' }]}>Monitoring</Text>
                  </View>
                )}
              </View>
            ) : (
              /* No driver currently on duty for this barangay */
              <View style={styles.noDriverActionCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <MaterialIcons name="info-outline" size={20} color="#D97706" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.noDriverNoticeTitle}>
                      No driver currently on duty for Brgy. {selectedBarangay}
                    </Text>
                    <Text style={styles.noDriverNoticeSub}>
                      {barangayDrivers.length > 0
                        ? `Assigned driver ${barangayDrivers[0].displayName} is currently Off Duty (Pending Scan). Drivers must scan vehicle QR code or clock in via mobile app.`
                        : `No drivers are registered to Brgy. ${selectedBarangay}. Assign a driver in Fleet Inventory or Driver Accounts.`}
                    </Text>
                  </View>
                </View>

                {barangayDrivers.length > 1 && isCoordinator && (
                  <TouchableOpacity
                    style={styles.deployAvailableBtn}
                    onPress={() => {
                      setIsDriverDropdownOpen(!isDriverDropdownOpen);
                      setIsBarangayDropdownOpen(false);
                    }}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="person-add" size={16} color="#FFFFFF" />
                    <Text style={styles.deployAvailableBtnText}>Select Driver</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Driver Dropdown Picker for Reassignment / Switching */}
            {isDriverDropdownOpen && isCoordinator && (
              <View style={styles.driverDropdownMenu}>
                <View style={styles.driverDropdownHeader}>
                  <Text style={styles.driverDropdownHeaderText}>
                    Select Driver for Brgy. {selectedBarangay}
                  </Text>
                  <TouchableOpacity onPress={() => setIsDriverDropdownOpen(false)}>
                    <MaterialIcons name="close" size={16} color="#64748B" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {barangayDrivers.length === 0 ? (
                    <View style={{ padding: 14, alignItems: 'center' }}>
                      <Text style={{ fontSize: 12, color: '#94A3B8', fontStyle: 'italic', textAlign: 'center' }}>
                        No drivers are registered to Brgy. {selectedBarangay}.
                      </Text>
                    </View>
                  ) : (
                    barangayDrivers.map((d) => {
                      const isSelected = selectedDriverId === d.id;
                      const isOnDuty = (d.status === 'on_duty' || d.dutyStatus === 'on_duty') &&
                        d.status !== 'off_duty' && d.dutyStatus !== 'off_duty' && d.status !== 'disabled' && d.status !== 'inactive';

                      return (
                        <TouchableOpacity
                          key={d.id}
                          style={[
                            styles.deckDropdownItem,
                            isSelected && styles.deckDropdownItemSelected,
                            !isOnDuty && { opacity: 0.65 },
                          ]}
                          onPress={() => {
                            if (!isOnDuty) {
                              Alert.alert(
                                'Driver Off Duty',
                                `${d.displayName} is currently off duty. The driver must scan the vehicle QR code or clock in via the mobile app before being dispatched.`
                              );
                              return;
                            }
                            setSelectedDriverId(d.id);
                            setIsDriverDropdownOpen(false);
                          }}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons
                            name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'}
                            size={16}
                            color={isSelected ? '#059669' : '#94A3B8'}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.deckDropdownItemText, isSelected && styles.deckDropdownItemTextSelected]}>
                              {d.displayName}
                            </Text>
                            <Text style={{ fontSize: 10.5, color: '#64748B' }}>
                              🚚 {d.currentTruckPlate || trucksMap[d.currentTruckId || ''] || 'CENRO Unit'} &bull; Brgy. {selectedBarangay}
                            </Text>
                          </View>

                          {isOnDuty ? (
                            <View style={styles.assignedDirectBadge}>
                              <Text style={styles.assignedDirectBadgeText}>On Duty</Text>
                            </View>
                          ) : (
                            <View style={[styles.assignedDirectBadge, { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' }]}>
                              <Text style={[styles.assignedDirectBadgeText, { color: '#64748B' }]}>Off Duty</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* AI Fuel & Traffic Optimization Breakdown Hero Grid (3 Polished Cards) */}
      {optResult && (
        <View style={[styles.metricsGrid, isMobile && { flexDirection: 'column' }]}>
          {/* Metric 1: Fuel Saved */}
          <View style={[styles.metricCard, { borderLeftColor: '#059669' }]}>
            <View style={styles.metricHeader}>
              <Text style={styles.metricLabel}>FUEL EFFICIENCY ESTIMATE</Text>
              <View style={styles.metricIconWrap}>
                <MaterialIcons name="local-gas-station" size={18} color="#059669" />
              </View>
            </View>

            {optResult.fuelSavingsLiters > 0 ? (
              <Text style={styles.metricMainValue}>
                +{optResult.fuelSavingsLiters}{' '}
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748B' }}>Liters Saved</Text>
              </Text>
            ) : (
              <Text style={styles.metricMainValue}>
                Optimal{' '}
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748B' }}>Route Efficiency</Text>
              </Text>
            )}

            <View style={styles.metricSubRow}>
              <Text style={styles.metricSubText}>
                Baseline: <Text style={{ fontWeight: '700' }}>{optResult.baselineFuelLiters} L</Text> &bull; AI Target:{' '}
                <Text style={{ fontWeight: '700', color: '#059669' }}>{optResult.optimizedFuelLiters} L</Text>
              </Text>

              {optResult.fuelSavingsLiters > 0 ? (
                <View style={styles.savingsChip}>
                  <Text style={styles.savingsChipText}>₱{optResult.fuelCostSavedPhp} Diesel Saved</Text>
                </View>
              ) : (
                <View style={[styles.savingsChip, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                  <Text style={[styles.savingsChipText, { color: '#065F46' }]}>100% Balanced Consumption</Text>
                </View>
              )}
            </View>
          </View>

          {/* Metric 2: Travel & Transit Time */}
          <View style={[styles.metricCard, { borderLeftColor: '#0284C7' }]}>
            <View style={styles.metricHeader}>
              <Text style={styles.metricLabel}>TRAVEL & IDLING TRANSIT</Text>
              <View style={[styles.metricIconWrap, { backgroundColor: '#E0F2FE' }]}>
                <MaterialIcons name="timer" size={18} color="#0284C7" />
              </View>
            </View>

            {optResult.timeSavingsMinutes > 0 ? (
              <Text style={[styles.metricMainValue, { color: '#0369A1' }]}>
                +{optResult.timeSavingsMinutes}{' '}
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748B' }}>Minutes Shaved</Text>
              </Text>
            ) : (
              <Text style={[styles.metricMainValue, { color: '#0369A1' }]}>
                {optResult.optimizedDurationMins}m{' '}
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748B' }}>Target Transit</Text>
              </Text>
            )}

            <View style={styles.metricSubRow}>
              <Text style={styles.metricSubText}>
                Baseline: {optResult.baselineDurationMins}m &bull; Optimized:{' '}
                <Text style={{ fontWeight: '700', color: '#0369A1' }}>{optResult.optimizedDurationMins}m</Text>
              </Text>

              {optResult.timeSavingsMinutes > 0 ? (
                <View style={[styles.savingsChip, { backgroundColor: '#E0F2FE', borderColor: '#BAE6FD' }]}>
                  <Text style={[styles.savingsChipText, { color: '#0369A1' }]}>
                    +{optResult.efficiencyGainPercent}% Faster
                  </Text>
                </View>
              ) : (
                <View style={[styles.savingsChip, { backgroundColor: '#E0F2FE', borderColor: '#BAE6FD' }]}>
                  <Text style={[styles.savingsChipText, { color: '#0369A1' }]}>Optimal Transit Speed</Text>
                </View>
              )}
            </View>
          </View>

          {/* Metric 3: Bottleneck Traffic Avoidance */}
          <View style={[styles.metricCard, { borderLeftColor: '#F59E0B' }]}>
            <View style={styles.metricHeader}>
              <Text style={styles.metricLabel}>TRAFFIC BOTTLENECKS AVOIDED</Text>
              <View style={[styles.metricIconWrap, { backgroundColor: '#FEF3C7' }]}>
                <MaterialIcons name="traffic" size={18} color="#D97706" />
              </View>
            </View>

            <Text style={[styles.metricMainValue, { color: '#B45309' }]}>
              {optResult.bottlenecksAvoided}{' '}
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748B' }}>Hotspots Managed</Text>
            </Text>

            <View style={styles.metricSubRow}>
              <Text style={styles.metricSubText}>
                Commercial / market stops scheduled for off-peak clearance.
              </Text>
              <View style={[styles.savingsChip, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                <Text style={[styles.savingsChipText, { color: '#B45309' }]}>100% Scheduled Stops</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* VIEW 1: CORRIDOR MAP */}
      {activeSubView === 'route-ai' && optResult && (
        <View style={styles.workspaceCard}>
          <View style={styles.mapCardHeader}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.mapCardTitle}>Interactive GPS Collection Corridor</Text>
                {reportsInRoute.length > 0 && (
                  <View style={styles.insertedReportsBadge}>
                    <MaterialIcons name="add-location" size={13} color="#B45309" />
                    <Text style={styles.insertedReportsBadgeText}>
                      +{reportsInRoute.length} Verified Reports Included
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.mapCardSubtitle}>
                Blue dotted line: Driver baseline trajectory &bull; Green solid line: AI traffic-optimized order
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity
                style={styles.reoptimizeBtn}
                onPress={() => runOptimization(reportsInRoute)}
                disabled={isOptimizingAI}
                activeOpacity={0.8}
              >
                {isOptimizingAI ? (
                  <ActivityIndicator size="small" color="#1B4D3E" />
                ) : (
                  <MaterialIcons name="refresh" size={16} color="#1B4D3E" />
                )}
                <Text style={styles.reoptimizeBtnText}>Recalculate AI Route</Text>
              </TouchableOpacity>
            </View>
          </View>

          <RouteOptimizationMap
            baselineStops={optResult.baselineStops}
            optimizedStops={optResult.optimizedStops}
            currentSimPosition={
              driverLiveLocation
                ? { latitude: driverLiveLocation.latitude, longitude: driverLiveLocation.longitude }
                : simState.isActive && simState.currentCoordinate && simState.driverId === selectedDriverId
                ? simState.currentCoordinate
                : null
            }
            activeDriverName={currentSelectedDriver?.displayName}
            barangayName={selectedBarangay}
          />
        </View>
      )}

      {/* VIEW 2: TURN-BY-TURN STOP SEQUENCE TABLE */}
      {activeSubView === 'stops-sequence' && optResult && (
        <View style={styles.workspaceCard}>
          <View style={styles.tableCardHeader}>
            <View>
              <Text style={styles.tableCardTitle}>
                AI-Optimized Stop Sequence ({optResult.optimizedStops.length} Total Points)
              </Text>
              <Text style={styles.tableCardSubtitle}>
                Preserves all designated collection locations while eliminating cross-town backtrack and rush-hour bottlenecks.
              </Text>
            </View>
            {reportsInRoute.length > 0 && (
              <View style={styles.insertedReportsBadge}>
                <MaterialIcons name="add-location" size={14} color="#B45309" />
                <Text style={styles.insertedReportsBadgeText}>
                  +{reportsInRoute.length} Verified Reports Included
                </Text>
              </View>
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ minWidth: 740 }}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.th, { width: 55 }]}>SEQ</Text>
                <Text style={[styles.th, { width: 230 }]}>COLLECTION STOP / WAYPOINT</Text>
                <Text style={[styles.th, { width: 130 }]}>STOP TYPE</Text>
                <Text style={[styles.th, { width: 140 }]}>TRAFFIC IMPACT</Text>
                <Text style={[styles.th, { width: 160 }]}>OPTIMAL WINDOW</Text>
              </View>

              {optResult.optimizedStops.map((stop, idx) => {
                const isStart = idx === 0;
                const isEnd = idx === optResult.optimizedStops.length - 1;
                const isReport = stop.stopType === 'verified_report';
                const isHotspot = stop.trafficCongestionLevel === 'high';

                return (
                  <View
                    key={stop.id}
                    style={[
                      styles.tableRow,
                      idx % 2 === 1 && { backgroundColor: '#F8FAFC' },
                      isReport && { backgroundColor: '#FEF9C3' },
                    ]}
                  >
                    <View style={[styles.td, { width: 55 }]}>
                      <View
                        style={[
                          styles.seqBadge,
                          isStart && { backgroundColor: '#059669' },
                          isEnd && { backgroundColor: '#DC2626' },
                          isReport && { backgroundColor: '#D97706' },
                        ]}
                      >
                        <Text style={styles.seqBadgeText}>{idx + 1}</Text>
                      </View>
                    </View>

                    <View style={[styles.td, { width: 230 }]}>
                      <Text style={styles.stopNameText}>{stop.name}</Text>
                      <Text style={styles.stopLocationText}>
                        {stop.street ? `${stop.street}, ` : ''}Brgy. {stop.barangay}
                      </Text>
                    </View>

                    <View style={[styles.td, { width: 130 }]}>
                      {isStart ? (
                        <View style={styles.typeBadgeDepot}>
                          <Text style={styles.typeBadgeDepotText}>Depot Start</Text>
                        </View>
                      ) : isEnd ? (
                        <View style={styles.typeBadgeReturn}>
                          <Text style={styles.typeBadgeReturnText}>Transfer Station</Text>
                        </View>
                      ) : isReport ? (
                        <View style={styles.typeBadgeReport}>
                          <Text style={styles.typeBadgeReportText}>Citizen Report</Text>
                        </View>
                      ) : (
                        <View style={styles.typeBadgeRegular}>
                          <Text style={styles.typeBadgeRegularText}>Routine Stop</Text>
                        </View>
                      )}
                    </View>

                    <View style={[styles.td, { width: 140 }]}>
                      {isHotspot ? (
                        <View style={styles.trafficHighBadge}>
                          <MaterialIcons name="warning" size={12} color="#DC2626" />
                          <Text style={styles.trafficHighText}>Peak Congestion</Text>
                        </View>
                      ) : (
                        <View style={styles.trafficLowBadge}>
                          <MaterialIcons name="check" size={12} color="#059669" />
                          <Text style={styles.trafficLowText}>Clear Transit</Text>
                        </View>
                      )}
                    </View>

                    <View style={[styles.td, { width: 160 }]}>
                      <Text style={styles.timeWindowText}>{stop.optimalTimeWindow || 'Routine Schedule'}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
      )}

      {/* VIEW 3: VERIFIED CITIZEN REPORTS DISPATCH QUEUE */}
      {activeSubView === 'report-dispatch' && (
        <View style={{ gap: 16 }}>
          {/* Header Intro Banner */}
          <View style={styles.reportDispatchIntroCard}>
            <View style={styles.reportDispatchIntroIcon}>
              <MaterialIcons name="playlist-add-check" size={24} color="#059669" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reportDispatchIntroTitle}>
                {isCoordinator
                  ? `Slot Verified Citizen Reports into Brgy. ${selectedBarangay} Route`
                  : `Verified Citizen Reports Overview • Brgy. ${selectedBarangay}`}
              </Text>
              <Text style={styles.reportDispatchIntroSubtitle}>
                {isCoordinator
                  ? "Verified resident waste clusters. The AI optimizer will slot selected reports into the driver's collection route at the lowest detour distance and traffic cost."
                  : "CENRO Oversight Mode: Review verified resident waste clusters. Citizen report route insertion and dispatch is executed by the designated Barangay Field Steward."}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.switchBackBtn}
              onPress={() => setActiveSubView('route-ai')}
              activeOpacity={0.8}
            >
              <MaterialIcons name="map" size={16} color="#1B4D3E" />
              <Text style={styles.switchBackBtnText}>
                Preview on Map ({selectedReportIds.size > 0 ? selectedReportIds.size : barangayReports.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Search and Filters */}
          <View style={styles.reportFilterBar}>
            <View style={styles.reportSearchBox}>
              <MaterialIcons name="search" size={18} color="#94A3B8" />
              <TextInput
                value={reportSearch}
                onChangeText={setReportSearch}
                placeholder="Search street, description, or waste type..."
                placeholderTextColor="#94A3B8"
                style={styles.reportSearchInput}
              />
              {reportSearch.length > 0 && (
                <TouchableOpacity onPress={() => setReportSearch('')}>
                  <MaterialIcons name="close" size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.filterPillsRow}>
              <TouchableOpacity
                style={[styles.statusFilterPill, statusFilter === 'acknowledged' && styles.statusFilterPillActive]}
                onPress={() => setStatusFilter('acknowledged')}
              >
                <Text style={[styles.statusFilterPillText, statusFilter === 'acknowledged' && styles.statusFilterPillTextActive]}>
                  Pending Slotting ({queuedInBarangayCount})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusFilterPill, statusFilter === 'in_progress' && styles.statusFilterPillActive]}
                onPress={() => setStatusFilter('in_progress')}
              >
                <Text style={[styles.statusFilterPillText, statusFilter === 'in_progress' && styles.statusFilterPillTextActive]}>
                  In Driver Route ({inProgressInBarangayCount})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusFilterPill, statusFilter === 'all' && styles.statusFilterPillActive]}
                onPress={() => setStatusFilter('all')}
              >
                <Text style={[styles.statusFilterPillText, statusFilter === 'all' && styles.statusFilterPillTextActive]}>
                  All Verified ({barangayReportsAll.length})
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Reports List */}
          {barangayReports.length === 0 ? (
            <View style={styles.noReportsCard}>
              <MaterialIcons name="check-circle" size={36} color="#10B981" />
              <Text style={styles.noReportsTitle}>
                {statusFilter === 'acknowledged'
                  ? 'All Verified Reports Slotted & Dispatched'
                  : 'No Reports Found'}
              </Text>
              <Text style={styles.noReportsSubtitle}>
                {statusFilter === 'acknowledged'
                  ? `All verified citizen reports in Brgy. ${selectedBarangay} have been slotted into active driver routes or addressed.`
                  : `No citizen reports in Brgy. ${selectedBarangay} match the current filter.`}
              </Text>
            </View>
          ) : (
            <View style={styles.reportsTableCard}>
              <View style={styles.reportsTableHeader}>
                {isCoordinator ? (
                  <TouchableOpacity
                    style={styles.selectAllBtn}
                    disabled={barangayReports.filter((r) => (r.status || '').toLowerCase().replace(/_/g, '-') !== 'in-progress' && !(r as any).assignedDriverId).length === 0}
                    onPress={() => {
                      const unassignedReports = barangayReports.filter(
                        (r) => (r.status || '').toLowerCase().replace(/_/g, '-') !== 'in-progress' && !(r as any).assignedDriverId
                      );
                      if (unassignedReports.length === 0) return;
                      if (selectedReportIds.size >= unassignedReports.length) {
                        setSelectedReportIds(new Set());
                      } else {
                        setSelectedReportIds(new Set(unassignedReports.map((r) => r.id)));
                      }
                    }}
                  >
                    <MaterialIcons
                      name={
                        barangayReports.filter((r) => (r.status || '').toLowerCase().replace(/_/g, '-') !== 'in-progress' && !(r as any).assignedDriverId).length > 0 &&
                        selectedReportIds.size >= barangayReports.filter((r) => (r.status || '').toLowerCase().replace(/_/g, '-') !== 'in-progress' && !(r as any).assignedDriverId).length
                          ? 'check-box'
                          : 'check-box-outline-blank'
                      }
                      size={20}
                      color={
                        barangayReports.filter((r) => (r.status || '').toLowerCase().replace(/_/g, '-') !== 'in-progress' && !(r as any).assignedDriverId).length === 0
                          ? '#94A3B8'
                          : '#059669'
                      }
                    />
                    <Text
                      style={[
                        styles.selectAllText,
                        barangayReports.filter((r) => (r.status || '').toLowerCase().replace(/_/g, '-') !== 'in-progress' && !(r as any).assignedDriverId).length === 0 && { color: '#94A3B8' },
                      ]}
                    >
                      {barangayReports.filter((r) => (r.status || '').toLowerCase().replace(/_/g, '-') !== 'in-progress' && !(r as any).assignedDriverId).length === 0
                        ? 'All Reports in Route'
                        : selectedReportIds.size > 0
                          ? 'Deselect Pending'
                          : 'Select All To Slot'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="visibility" size={18} color="#059669" />
                    <Text style={[styles.selectAllText, { color: '#065F46' }]}>
                      Monitoring ({barangayReports.length} Reports)
                    </Text>
                  </View>
                )}

                <Text style={styles.selectedCountBadge}>
                  {isCoordinator
                    ? barangayReports.filter((r) => (r.status || '').toLowerCase().replace(/_/g, '-') !== 'in-progress' && !(r as any).assignedDriverId).length > 0
                      ? `${selectedReportIds.size} of ${barangayReports.filter((r) => (r.status || '').toLowerCase().replace(/_/g, '-') !== 'in-progress' && !(r as any).assignedDriverId).length} Pending Selected`
                      : `All ${barangayReports.length} Slotted (${inProgressInBarangayCount} in Route)`
                    : `${barangayReports.length} Reports in Brgy. ${selectedBarangay}`}
                </Text>
              </View>

              <View style={{ gap: 10 }}>
                {barangayReports.map((rep) => {
                  const isSelected = selectedReportIds.has(rep.id);
                  const isAlreadyDispatched =
                    (rep.status || '').toLowerCase().replace(/_/g, '-') === 'in-progress' ||
                    Boolean((rep as any).assignedDriverId);
                  const isAssignedToThisDriver =
                    (rep as any).assignedDriverId === selectedDriverId &&
                    ['in-progress', 'in_progress'].includes(String(rep.status || ''));
                  const isAssignedToOtherDriver =
                    isAlreadyDispatched && !isAssignedToThisDriver;

                  return (
                    <TouchableOpacity
                      key={rep.id}
                      style={[
                        styles.reportItemCard,
                        isSelected && isCoordinator && styles.reportItemCardSelected,
                        isAssignedToThisDriver && { borderColor: '#A7F3D0', backgroundColor: '#F0FDF4' },
                        isAssignedToOtherDriver && { borderColor: '#FDE68A', backgroundColor: '#FFFBEB' },
                      ]}
                      onPress={() => {
                        if (isAssignedToThisDriver) {
                          setViewingReport(rep);
                        } else if (isAssignedToOtherDriver) {
                          Alert.alert(
                            'Reassign Report?',
                            `This report is currently assigned to ${(rep as any).assignedDriverName || 'another driver'}. Do you want to select it to reassign to ${currentSelectedDriver?.displayName || 'this driver'}?`,
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Reassign to This Driver',
                                onPress: () => toggleReportSelection(rep.id),
                              },
                            ]
                          );
                        } else if (isCoordinator) {
                          toggleReportSelection(rep.id);
                        } else {
                          setViewingReport(rep);
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={styles.reportItemCheckbox}>
                        {isCoordinator ? (
                          isAssignedToThisDriver ? (
                            <MaterialIcons
                              name="check-circle"
                              size={22}
                              color="#059669"
                            />
                          ) : isAssignedToOtherDriver ? (
                            <MaterialIcons
                              name={isSelected ? 'check-box' : 'swap-horiz'}
                              size={22}
                              color={isSelected ? '#059669' : '#D97706'}
                            />
                          ) : (
                            <MaterialIcons
                              name={isSelected ? 'check-box' : 'check-box-outline-blank'}
                              size={22}
                              color={isSelected ? '#059669' : '#94A3B8'}
                            />
                          )
                        ) : (
                          <MaterialIcons
                            name="report-problem"
                            size={18}
                            color="#D97706"
                          />
                        )}
                      </View>

                      {rep.imageURL ? (
                        <Image source={{ uri: getOptimizedReportImageUrl(rep.imageURL) || rep.imageURL }} style={styles.reportThumb} resizeMode="cover" />
                      ) : (
                        <View style={styles.reportThumbPlaceholder}>
                          <MaterialIcons name="delete-outline" size={20} color="#94A3B8" />
                        </View>
                      )}

                      <View style={{ flex: 1 }}>
                        <Text style={styles.reportItemTitle}>{rep.title || 'Citizen Report'}</Text>
                        <Text style={styles.reportItemLocation}>
                          {rep.street ? `${rep.street}, ` : ''}Brgy. {rep.barangay}
                        </Text>
                        <View style={styles.reportItemMetaRow}>
                          <View style={styles.metaPill}>
                            <Text style={styles.metaPillText}>{rep.aiAnalysis?.wasteType || 'General Waste'}</Text>
                          </View>
                          <View style={styles.metaPill}>
                            <Text style={styles.metaPillText}>Est. {rep.aiAnalysis?.estimatedWeight || 'Standard'}</Text>
                          </View>
                          <View style={[
                            styles.statusBadgeSmall,
                            isAlreadyDispatched && {
                              backgroundColor: (rep as any).assignedDriverId === selectedDriverId ? '#D1FAE5' : '#FEF3C7'
                            }
                          ]}>
                            <Text style={[
                              styles.statusBadgeSmallText,
                              isAlreadyDispatched && {
                                color: (rep as any).assignedDriverId === selectedDriverId ? '#065F46' : '#92400E'
                              }
                            ]}>
                              {isAlreadyDispatched
                                ? (rep as any).assignedDriverId === selectedDriverId
                                  ? `ON ROUTE (This Driver)`
                                  : `ON ROUTE (${(rep as any).assignedDriverName || 'Other Driver'})`
                                : rep.status.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <TouchableOpacity
                        style={styles.viewDetailBtn}
                        onPress={() => setViewingReport(rep)}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons name="info" size={20} color="#64748B" />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Bottom Dispatch Command Banner (Always accessible) */}
      <View style={styles.bottomDispatchBanner}>
        <View style={{ flex: 1, minWidth: 240 }}>
          <Text style={styles.bottomDispatchTitle}>
            {isCoordinator
              ? activeDriverSchedule && selectedReportIds.size === 0
                ? 'Route Active on Driver Terminal'
                : selectedReportIds.size > 0
                  ? `Append ${selectedReportIds.size} New Stop(s) to Driver Route?`
                  : 'Ready to Dispatch to Driver Terminal?'
              : `CENRO Municipal Oversight • Brgy. ${selectedBarangay}`}
          </Text>
          <Text style={styles.bottomDispatchSubtitle}>
            {isCoordinator ? (
              <>
                Driver: <Text style={{ fontWeight: '700', color: currentSelectedDriver ? '#FFFFFF' : '#FCD34D' }}>{currentSelectedDriver?.displayName || 'No Driver Selected'}</Text> &bull;{' '}
                Stops: <Text style={{ fontWeight: '700', color: '#FFFFFF' }}>{optResult?.optimizedStops.length || 0} Total</Text> &bull;{' '}
                Est. Diesel: <Text style={{ fontWeight: '700', color: '#34D399' }}>{optResult?.optimizedFuelLiters || 0} L</Text>
                {activeDriverSchedule && selectedReportIds.size === 0 && (
                  <Text style={{ color: '#34D399', fontWeight: '700' }}> &bull; 🟢 Active & Dispatched</Text>
                )}
              </>
            ) : (
              'Route dispatch is delegated to Barangay Field Stewards to prevent duplicate output. CENRO monitors live corridors and reports in view-only mode.'
            )}
          </Text>
        </View>

        {isCoordinator ? (
          <TouchableOpacity
            style={[
              styles.dispatchPrimaryBtn,
              (!selectedDriverId || !optResult) && styles.dispatchPrimaryBtnDisabled,
              activeDriverSchedule && selectedReportIds.size === 0 && {
                backgroundColor: '#065F46',
                borderColor: '#34D399',
                borderWidth: 1,
              },
            ]}
            onPress={() => {
              if (!selectedDriverId) {
                Alert.alert(
                  'Select a Driver',
                  `Please select or deploy an on-duty driver in the Operational Command Deck above before dispatching.`
                );
                return;
              }
              if (activeDriverSchedule && selectedReportIds.size === 0) {
                Alert.alert(
                  'Route Already Dispatched 🚛',
                  `This collection route with ${optResult?.optimizedStops.length || 28} stopping points (including all ${reportsInRoute.length} citizen reports) is already live on ${currentSelectedDriver?.displayName || 'the driver'}'s terminal.\n\nTo add more stops, select pending citizen reports from the list above.`
                );
                return;
              }
              setShowDispatchConfirmModal(true);
            }}
            disabled={!optResult}
            activeOpacity={0.85}
          >
            <MaterialIcons
              name={activeDriverSchedule && selectedReportIds.size === 0 ? 'check-circle' : 'send'}
              size={17}
              color="#FFFFFF"
            />
            <Text style={styles.dispatchPrimaryBtnText}>
              {activeDriverSchedule && selectedReportIds.size === 0
                ? 'Route Active on Terminal'
                : selectedReportIds.size > 0
                  ? `Update Route (+${selectedReportIds.size} Stops)`
                  : 'Dispatch Route to Driver'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.dispatchPrimaryBtn, { backgroundColor: 'rgba(255, 255, 255, 0.15)', borderColor: 'rgba(255, 255, 255, 0.25)', borderWidth: 1 }]}>
            <MaterialIcons name="visibility" size={17} color="#A7F3D0" />
            <Text style={[styles.dispatchPrimaryBtnText, { color: '#ECFDF5' }]}>View-Only Oversight</Text>
          </View>
        )}
      </View>

      {/* MODAL: DISPATCH CONFIRMATION */}
      <Modal
        visible={showDispatchConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDispatchConfirmModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalBox}>
            <View style={styles.confirmModalIcon}>
              <MaterialIcons name="local-shipping" size={32} color="#059669" />
            </View>

            <Text style={styles.confirmModalTitle}>Confirm Route Dispatch</Text>
            <Text style={styles.confirmModalSubtitle}>
              You are dispatching an AI traffic-optimized collection route directly to the driver&apos;s mobile terminal.
            </Text>

            <View style={styles.confirmSummaryBox}>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>OPERATIONAL BARANGAY:</Text>
                <Text style={styles.confirmVal}>Brgy. {selectedBarangay}</Text>
              </View>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>ASSIGNED DRIVER:</Text>
                <Text style={[styles.confirmVal, { fontWeight: '800', color: '#0F172A' }]}>
                  {currentSelectedDriver?.displayName || 'Driver'}
                </Text>
              </View>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>ASSIGNED TRUCK:</Text>
                <Text style={styles.confirmVal}>
                  {currentSelectedDriver?.currentTruckPlate || trucksMap[currentSelectedDriver?.currentTruckId || ''] || 'CENRO Unit'}
                </Text>
              </View>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>TOTAL ROUTE STOPS:</Text>
                <Text style={[styles.confirmVal, { color: '#059669', fontWeight: '800' }]}>
                  {optResult?.optimizedStops.length || 0} Stopping Points
                </Text>
              </View>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>INSERTED CITIZEN REPORTS:</Text>
                <Text style={[styles.confirmVal, { color: '#D97706', fontWeight: '800' }]}>
                  {reportsInRoute.length} Verified Reports
                </Text>
              </View>
              <View style={[styles.confirmRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.confirmLabel}>FUEL TARGET:</Text>
                <Text style={[styles.confirmVal, { color: '#059669', fontWeight: '800' }]}>
                  {optResult?.optimizedFuelLiters} L Diesel Target
                </Text>
              </View>
            </View>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setShowDispatchConfirmModal(false)}
                disabled={isDispatching}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmSubmitBtn}
                onPress={handleDispatchToDriver}
                disabled={isDispatching}
              >
                {isDispatching ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialIcons name="check" size={18} color="#FFFFFF" />
                    <Text style={styles.confirmSubmitText}>Confirm & Transmit</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: REPORT DETAILS INSPECTOR */}
      <Modal
        visible={!!viewingReport}
        transparent
        animationType="fade"
        onRequestClose={() => setViewingReport(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.reportModalBox}>
            <View style={styles.reportModalHeader}>
              <View>
                <Text style={styles.reportModalTitle}>{viewingReport?.title || 'Citizen Report'}</Text>
                <Text style={styles.reportModalSubtitle}>
                  Brgy. {viewingReport?.barangay} &bull; {viewingReport?.street}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setViewingReport(null)}>
                <MaterialIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {viewingReport?.imageURL ? (
                <Image source={{ uri: getOptimizedReportImageUrl(viewingReport.imageURL) || viewingReport.imageURL }} style={styles.reportModalImg} resizeMode="cover" />
              ) : null}

              <Text style={styles.reportModalDesc}>{viewingReport?.description || 'No description provided.'}</Text>

              <View style={styles.aiBox}>
                <Text style={styles.aiBoxTitle}>AI Vision Waste Classification</Text>
                <Text style={styles.aiBoxText}>Type: {viewingReport?.aiAnalysis?.wasteType || 'Solid Waste'}</Text>
                <Text style={styles.aiBoxText}>
                  Estimated Weight: {viewingReport?.aiAnalysis?.estimatedWeight || 'Not specified'}
                </Text>
                {viewingReport?.aiAnalysis?.details ? (
                  <Text style={[styles.aiBoxText, { marginTop: 4, fontStyle: 'italic' }]}>
                    {viewingReport.aiAnalysis.details}
                  </Text>
                ) : null}
              </View>

              {/* Assignment Information */}
              <View style={{ marginTop: 12, padding: 12, backgroundColor: '#F1F5F9', borderRadius: 8, gap: 4 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>
                  Status: {viewingReport?.status?.toUpperCase()}
                </Text>
                <Text style={{ fontSize: 13, color: '#64748B' }}>
                  Assigned Driver: {(viewingReport as any)?.assignedDriverName
                    ? `${(viewingReport as any).assignedDriverName} (${(viewingReport as any).assignedTruckPlate || 'Assigned'})`
                    : 'Unassigned (Waiting in Queue)'}
                </Text>
              </View>

              {/* Coordinator Reassignment & Fallback Actions */}
              {isCoordinator && (
                <View style={{ marginTop: 14, gap: 10 }}>
                  {/* Action 1: Reassign to Current Driver */}
                  {selectedDriverId && (viewingReport as any)?.assignedDriverId !== selectedDriverId && (
                    <TouchableOpacity
                      style={{
                        backgroundColor: '#059669',
                        paddingVertical: 12,
                        paddingHorizontal: 16,
                        borderRadius: 8,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                      }}
                      onPress={async () => {
                        if (!viewingReport || !currentSelectedDriver) return;
                        try {
                          await reassignReportToDriver(viewingReport.id, {
                            id: currentSelectedDriver.id,
                            displayName: currentSelectedDriver.displayName || 'Assigned Driver',
                            currentTruckPlate: currentSelectedDriver.currentTruckPlate || null,
                          }, true);
                          Alert.alert('Transferred', `Report has been reassigned to ${currentSelectedDriver.displayName}. Previous driver's route was updated and resident notified.`);
                          setViewingReport(null);
                        } catch (e: any) {
                          Alert.alert('Error', e?.message || 'Could not reassign report.');
                        }
                      }}
                    >
                      <MaterialIcons name="swap-horiz" size={18} color="#FFFFFF" />
                      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>
                        Reassign to {currentSelectedDriver?.displayName || 'Selected Driver'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Action 2: Return to Queue (Shopee Fallback) */}
                  {((viewingReport?.status || '').toLowerCase().replace(/_/g, '-') === 'in-progress' || Boolean((viewingReport as any)?.assignedDriverId)) && (
                    <TouchableOpacity
                      style={{
                        backgroundColor: '#FFFBEB',
                        borderColor: '#F59E0B',
                        borderWidth: 1,
                        paddingVertical: 12,
                        paddingHorizontal: 16,
                        borderRadius: 8,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                      }}
                      onPress={() => {
                        if (!viewingReport) return;
                        Alert.alert(
                          'Return to Queue?',
                          'This will mark the pickup as not collected today, revoke it from the driver, and notify the resident that it has been safely returned to the dispatch queue.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Return to Queue',
                              style: 'destructive',
                              onPress: async () => {
                                try {
                                  await revertReportToQueue(viewingReport.id, 'Coordinator returned uncollected stop to dispatch queue. Rescheduled for next shift.', true);
                                  Alert.alert('Returned to Queue', 'Report has been reset to acknowledged queue and resident notified.');
                                  setViewingReport(null);
                                } catch (e: any) {
                                  Alert.alert('Error', e?.message || 'Could not revert report.');
                                }
                              },
                            },
                          ]
                        );
                      }}
                    >
                      <MaterialIcons name="replay" size={18} color="#D97706" />
                      <Text style={{ color: '#D97706', fontWeight: '700', fontSize: 13 }}>
                        Return to Queue (Reschedule Pickup)
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.modalCloseDoneBtn}
              onPress={() => setViewingReport(null)}
            >
              <Text style={styles.modalCloseDoneBtnText}>Close Details</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 16,
  },
  headerTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  headerTagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  headerTagText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  headerDescription: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    maxWidth: 760,
    lineHeight: 18,
  },

  // Segmented Switcher Tabs
  segmentedContainer: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 3,
    gap: 4,
    alignSelf: 'flex-start',
  },
  segmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    gap: 6,
  },
  segmentBtnActive: {
    backgroundColor: '#1B4D3E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 3,
  },
  segmentBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#475569',
  },
  segmentBtnTextActive: {
    color: '#FFFFFF',
  },

  // Auto Dispatch Header Bar
  autoDispatchHeaderBar: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  autoDispatchLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  autoDispatchIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoDispatchIconCircleActive: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  autoDispatchIconCirclePaused: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  autoDispatchTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  autoDispatchDesc: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 16,
  },
  autoDispatchStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  autoDispatchStatusBadgeActive: {
    backgroundColor: '#D1FAE5',
  },
  autoDispatchStatusBadgePaused: {
    backgroundColor: '#F1F5F9',
  },
  autoDispatchStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  autoDispatchStatusText: {
    fontSize: 10.5,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  autoDispatchRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  autoDispatchStatPill: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 90,
  },
  autoDispatchStatNum: {
    fontSize: 14,
    fontWeight: '900',
    color: '#065F46',
  },
  autoDispatchStatLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
    marginTop: 1,
  },
  autoDispatchToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  autoDispatchToggleBtnActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  autoDispatchToggleBtnPaused: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
  },
  autoDispatchToggleText: {
    fontSize: 12,
    fontWeight: '800',
  },

  // Operational Command Deck
  commandDeckCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    position: 'relative',
    zIndex: 10,
  },
  commandDeckGrid: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
  },
  selectorLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  selectorLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
  },
  deckDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  deckDropdownBtnActive: {
    borderColor: '#059669',
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  deckIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deckItemTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  deckItemSub: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 1,
  },
  deckDropdownMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#059669',
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 30,
    zIndex: 9999,
    overflow: 'hidden',
  },
  dropdownSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
  },
  dropdownSearchInput: {
    flex: 1,
    fontSize: 12.5,
    color: '#0F172A',
    padding: 0,
  },
  deckDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
    gap: 8,
  },
  deckDropdownItemSelected: {
    backgroundColor: '#ECFDF5',
  },
  deckDropdownItemText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
    flex: 1,
  },
  deckDropdownItemTextSelected: {
    color: '#047857',
    fontWeight: '800',
  },
  driverPresentBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  driverPresentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0369A1',
  },
  reportCountPill: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  reportCountPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  activeSelectedBadge: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activeSelectedBadgeText: {
    fontSize: 10,
    color: '#047857',
    fontWeight: '800',
  },

  // Driver Active Card
  driverActiveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  driverActiveLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  driverAvatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#0284C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAvatarInitial: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  driverActiveName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  driverActiveTruck: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  activeBadgeSmall: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  activeBadgeSmallText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#166534',
  },
  reassignedBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  reassignedBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
  },
  changeDriverBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  changeDriverBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#0369A1',
  },

  // No Driver Notice & Quick Deploy
  noDriverActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
    flexWrap: 'wrap',
  },
  noDriverNoticeTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#92400E',
  },
  noDriverNoticeSub: {
    fontSize: 10.5,
    color: '#B45309',
    marginTop: 1,
  },
  deployAvailableBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  deployAvailableBtnText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  driverDropdownMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#0284C7',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 30,
    zIndex: 9999,
    overflow: 'hidden',
    marginTop: 4,
  },
  driverDropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F0F9FF',
    borderBottomWidth: 1,
    borderBottomColor: '#BAE6FD',
  },
  driverDropdownHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0369A1',
  },
  assignedDirectBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  assignedDirectBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#166534',
  },
  reassignCandidateBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reassignCandidateBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#B45309',
  },

  // Hero Metrics Grid
  metricsGrid: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 16,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metricIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  metricMainValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#059669',
    letterSpacing: -0.5,
  },
  metricSubRow: {
    marginTop: 8,
    gap: 6,
  },
  metricSubText: {
    fontSize: 11.5,
    color: '#64748B',
  },
  savingsChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginTop: 4,
  },
  savingsChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },

  // Workspace Card (Used for Map and Sequence Table)
  workspaceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  mapCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    flexWrap: 'wrap',
    gap: 8,
  },
  mapCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  mapCardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  insertedReportsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  insertedReportsBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400E',
  },
  reoptimizeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  reoptimizeBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#065F46',
  },

  // Table Card
  tableCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    flexWrap: 'wrap',
    gap: 8,
  },
  tableCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  tableCardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  th: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  td: {
    justifyContent: 'center',
  },
  seqBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seqBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  stopNameText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  stopLocationText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  typeBadgeDepot: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  typeBadgeDepotText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
  },
  typeBadgeReturn: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  typeBadgeReturnText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#991B1B',
  },
  typeBadgeReport: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  typeBadgeReportText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#92400E',
  },
  typeBadgeRegular: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  typeBadgeRegularText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  trafficHighBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  trafficHighText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#991B1B',
  },
  trafficLowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  trafficLowText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#065F46',
  },
  timeWindowText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0F172A',
  },

  // Bottom Dispatch Banner
  bottomDispatchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  bottomDispatchTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  bottomDispatchSubtitle: {
    fontSize: 12.5,
    color: '#94A3B8',
    marginTop: 3,
  },
  dispatchPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  dispatchPrimaryBtnDisabled: {
    backgroundColor: '#475569',
    shadowOpacity: 0,
    elevation: 0,
  },
  dispatchPrimaryBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // Sub-View 3: Verified Reports Dispatch Queue
  reportDispatchIntroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 14,
    flexWrap: 'wrap',
  },
  reportDispatchIntroIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportDispatchIntroTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  reportDispatchIntroSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 16,
  },
  switchBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  switchBackBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  reportFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  reportSearchBox: {
    flex: 1,
    minWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  reportSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  statusFilterPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  statusFilterPillActive: {
    backgroundColor: '#1B4D3E',
    borderColor: '#1B4D3E',
  },
  statusFilterPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  statusFilterPillTextActive: {
    color: '#FFFFFF',
  },
  noReportsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  noReportsTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  noReportsSubtitle: {
    fontSize: 12.5,
    color: '#64748B',
    textAlign: 'center',
  },
  reportsTableCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
  },
  reportsTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  selectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectAllText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#059669',
  },
  selectedCountBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  reportItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  reportItemCardSelected: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  reportItemCheckbox: {
    justifyContent: 'center',
  },
  reportThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  reportThumbPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportItemTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  reportItemLocation: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  reportItemMetaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  metaPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metaPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  statusBadgeSmall: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeSmallText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0369A1',
  },
  viewDetailBtn: {
    padding: 6,
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  confirmModalBox: {
    width: 480,
    maxWidth: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  confirmModalIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  confirmModalTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
  },
  confirmModalSubtitle: {
    fontSize: 12.5,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  confirmSummaryBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginVertical: 16,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  confirmLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
  },
  confirmVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  confirmCancelBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  confirmSubmitBtn: {
    flex: 1.6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  confirmSubmitText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  reportModalBox: {
    width: 500,
    maxWidth: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  reportModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  reportModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  reportModalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  reportModalImg: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 14,
  },
  reportModalDesc: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
    marginBottom: 14,
  },
  aiBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 16,
  },
  aiBoxTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  aiBoxText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
  },
  modalCloseDoneBtn: {
    backgroundColor: '#1B4D3E',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCloseDoneBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});
