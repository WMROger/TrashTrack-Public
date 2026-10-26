import { MaterialIcons } from '@expo/vector-icons';
import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useState, createElement } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import { db } from '@/config/firebase';
import FleetReplayMap, { ReplayPoint } from './FleetReplayMap';
import LiveFleetMap, { LiveTruck } from './LiveFleetMap';
import { DANAO_CITY_BARANGAYS, resolveScheduleBarangays } from '@/constants/danaoBarangays';
import { getBarangaySimulationRoute } from '@/constants/barangaySimulationRoutes';
import ExportModal from './ExportModal';
import { exportReport, ExportFormat } from '@/services/reportExportService';

type FleetEvent = {
  id: string;
  event: 'fleet.location' | 'fleet.alert' | 'fleet.trip_completed' | 'fleet.trip_interrupted' | string;
  driverId: string;
  truckId: string;
  tripId: string;
  location?: { lat?: number; lng?: number };
  speedKph?: number;
  alertType?: string;
  severity?: string;
  metadata?: Record<string, any>;
  recordedAtClient?: string;
  createdAt?: any;
};

const eventTime = (event: any) => {
  if (!event) return 0;
  if (event.recordedAtClient) {
    const t = new Date(event.recordedAtClient).getTime();
    if (!Number.isNaN(t) && t > 0) return t;
  }
  if (event.createdAt?.toMillis) return event.createdAt.toMillis();
  if (event.createdAt?.seconds) return event.createdAt.seconds * 1000;
  if (typeof event.createdAt === 'string') {
    const t = new Date(event.createdAt).getTime();
    if (!Number.isNaN(t) && t > 0) return t;
  }
  if (typeof event.timestamp === 'number') return event.timestamp;
  if (event.lastUpdate?.toMillis) return event.lastUpdate.toMillis();
  return 0;
};

interface FleetMonitoringTabProps {
  oversightLabel?: string;
  userRole?: string;
  assignedBarangay?: string;
}

export default function FleetMonitoringTab({
  oversightLabel,
  userRole = 'admin',
  assignedBarangay = '',
}: FleetMonitoringTabProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const isCoordinator = userRole === 'coordinator';
  const effectiveBarangay = assignedBarangay?.trim() || '';
  const lockedBarangay = isCoordinator && effectiveBarangay ? effectiveBarangay : null;
  const effectiveOversight =
    oversightLabel ||
    (isCoordinator && effectiveBarangay
      ? `BRGY. ${effectiveBarangay.toUpperCase()} FIELD STEWARD`
      : 'CENRO FLEET CONTROL');

  // Display Mode: 'live' (Real-time moving map) or 'replay' (Historical trip replay)
  const [activeMode, setActiveMode] = useState<'live' | 'replay'>('live');

  // Real-time live trucks state from /truck_locations
  const [liveTrucks, setLiveTrucks] = useState<LiveTruck[]>([]);
  const [selectedLiveTruckId, setSelectedLiveTruckId] = useState<string | null>(null);

  // Historical events state from /client_activity
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrip, setSelectedTrip] = useState('');
  const [replayIndex, setReplayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 2 | 3>(1);
  const [selectedBarangay, setSelectedBarangay] = useState(lockedBarangay || 'all');
  const [selectedDateFilter, setSelectedDateFilter] = useState('all');
  const [selectedTruckFilter, setSelectedTruckFilter] = useState('all');

  useEffect(() => {
    if (lockedBarangay) {
      setSelectedBarangay(lockedBarangay);
    }
  }, [lockedBarangay]);

  const activeBarangayFilter = lockedBarangay || selectedBarangay;
  const [availableBarangays, setAvailableBarangays] = useState<string[]>([...DANAO_CITY_BARANGAYS]);
  const [driverBarangays, setDriverBarangays] = useState<Record<string, string>>({});
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [truckPlates, setTruckPlates] = useState<Record<string, string>>({});
  const [truckBarangays, setTruckBarangays] = useState<Record<string, string>>({});
  const [driverTruckPlates, setDriverTruckPlates] = useState<Record<string, string>>({});
  const [truckDriverMap, setTruckDriverMap] = useState<Record<string, string>>({});
  const [scheduleDriverMap, setScheduleDriverMap] = useState<Record<string, string>>({});

  const getTruckPlate = (truckId?: string, driverId?: string) => {
    if (truckId && truckPlates[truckId]) return truckPlates[truckId];
    if (truckId && driverTruckPlates[truckId]) return driverTruckPlates[truckId];
    if (driverId && driverTruckPlates[driverId]) return driverTruckPlates[driverId];
    return truckId || 'Unknown Truck';
  };

  const [registeredFleet, setRegisteredFleet] = useState<any[]>([]);

  // 1. Fetch Users, Trucks, Schedules Metadata
  useEffect(() => {
    if (!db) return;
    const unsubUsers = onSnapshot(collection(db, 'users'), snap => {
      const map: Record<string, string> = {};
      const plates: Record<string, string> = {};
      const names: Record<string, string> = {};
      snap.forEach(d => {
        const data = d.data();
        if (data.disabled === true || data.status === 'disabled') {
          return;
        }
        const fullName = (data.displayName || data.name || `${data.firstName || ''} ${data.lastName || ''}`).trim();
        if (fullName) {
          names[d.id] = fullName;
          if (data.uid) names[data.uid] = fullName;
          if (data.employeeId) names[data.employeeId] = fullName;
          if (data.email) names[data.email] = fullName;
          if (data.currentTruckPlate) names[data.currentTruckPlate] = fullName;
          if (data.currentTruckId) names[data.currentTruckId] = fullName;
        }
        if (data.role === 'driver') {
          if (data.assignedBarangay || data.barangay) {
            map[d.id] = data.assignedBarangay || data.barangay;
          }
          if (data.currentTruckPlate) {
            plates[d.id] = data.currentTruckPlate;
            if (data.currentTruckId) {
              plates[data.currentTruckId] = data.currentTruckPlate;
            }
          }
        }
      });
      setDriverBarangays(map);
      setDriverTruckPlates(plates);
      setDriverNames(names);
    });

    const unsubTrucks = onSnapshot(collection(db, 'trucks'), snap => {
      const map: Record<string, string> = {};
      const bMap: Record<string, string> = {};
      const dMap: Record<string, string> = {};
      const fleetList: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        fleetList.push({ id: d.id, ...data });
        const plate = data.plateNumber || d.id;
        if (data.plateNumber) {
          map[d.id] = data.plateNumber;
        }
        const b = (data.assignedBarangay || data.barangay || '').trim();
        if (b) {
          bMap[d.id] = b;
          if (plate) bMap[plate] = b;
        }
        const dName = (data.assignedDriverName || data.lastDriverName || data.driverName || '').trim();
        if (dName && dName.toLowerCase() !== 'assigned driver') {
          dMap[d.id] = dName;
          if (plate) dMap[plate] = dName;
          if (data.truckId) dMap[data.truckId] = dName;
        }
      });
      setTruckPlates(map);
      setTruckBarangays(bMap);
      setTruckDriverMap(dMap);
      setRegisteredFleet(fleetList);
    });

    const unsubSchedules = onSnapshot(collection(db, 'barangay_schedules'), snap => {
      const scheduleNames = new Set<string>();
      const sDriverMap: Record<string, string> = {};
      snap.forEach(d => {
        const data = d.data();
        if (data.barangayName && typeof data.barangayName === 'string' && data.barangayName.trim()) {
          const bRaw = data.barangayName.trim();
          scheduleNames.add(bRaw);
          const bKey = bRaw.replace(/^Brgy\.?\s+/i, '').trim().toLowerCase();
          const sDriver = (data.assignedDriverName || data.driverName || data.driver || '').trim();
          if (sDriver && sDriver.toLowerCase() !== 'assigned driver') {
            sDriverMap[bKey] = sDriver;
          }
        }
      });
      setAvailableBarangays(resolveScheduleBarangays(Array.from(scheduleNames)));
      setScheduleDriverMap(sDriverMap);
    });

    return () => {
      unsubUsers();
      unsubTrucks();
      unsubSchedules();
    };
  }, []);

  // Multi-tier resolver to guarantee the real driver's name is exported (never placeholder "Assigned Driver")
  const resolveTripDriverName = useCallback((item?: {
    driverId?: string;
    driverName?: string;
    assignedDriverName?: string;
    plateNumber?: string;
    truckId?: string;
    barangay?: string;
  }) => {
    if (!item) return 'Unassigned';

    const isValidName = (name?: string) => {
      if (!name || typeof name !== 'string') return false;
      const clean = name.trim();
      return (
        clean.length > 0 &&
        clean.toLowerCase() !== 'assigned driver' &&
        clean.toLowerCase() !== 'unknown driver' &&
        clean.toLowerCase() !== 'n/a' &&
        clean.toLowerCase() !== 'none' &&
        clean.toLowerCase() !== 'unassigned'
      );
    };

    // 1. Direct explicit driver name on the trip item
    if (isValidName(item.driverName)) return (item.driverName as string).trim();
    if (isValidName(item.assignedDriverName)) return (item.assignedDriverName as string).trim();

    // 2. Lookup in driverNames (indexed by uid, doc id, employeeId, email, plate)
    if (item.driverId && isValidName(driverNames[item.driverId])) {
      return driverNames[item.driverId];
    }

    const plate = (item.plateNumber || getTruckPlate(item.truckId, item.driverId) || '').trim();
    const truckId = (item.truckId || '').trim();

    // 3. Lookup by plate or truckId in truckDriverMap
    if (plate && isValidName(truckDriverMap[plate])) return truckDriverMap[plate];
    if (truckId && isValidName(truckDriverMap[truckId])) return truckDriverMap[truckId];

    // 4. Lookup in registeredFleet list
    if (registeredFleet && registeredFleet.length > 0) {
      const matchedTruck = registeredFleet.find(t => {
        const tPlate = (t.plateNumber || t.id || '').trim().toLowerCase();
        const tId = (t.truckId || t.id || '').trim().toLowerCase();
        return (
          (plate && tPlate === plate.toLowerCase()) ||
          (truckId && tId === truckId.toLowerCase())
        );
      });

      if (matchedTruck) {
        if (matchedTruck.assignedDriverId) {
          if (isValidName(driverNames[matchedTruck.assignedDriverId])) {
            return driverNames[matchedTruck.assignedDriverId];
          }
          // Driver ID is assigned but invalid or deleted -> do not display stale assignedDriverName
        } else if (isValidName(matchedTruck.assignedDriverName)) {
          return matchedTruck.assignedDriverName.trim();
        }
        if (isValidName(matchedTruck.lastDriverName)) return matchedTruck.lastDriverName.trim();
        if (isValidName(matchedTruck.driverName)) return matchedTruck.driverName.trim();
      }
    }

    // 5. Lookup in scheduleDriverMap by barangay
    if (item.barangay) {
      const bKey = item.barangay.replace(/^Brgy\.?\s+/i, '').trim().toLowerCase();
      if (isValidName(scheduleDriverMap[bKey])) {
        return scheduleDriverMap[bKey];
      }
    }

    // 6. Check if driverNames maps plate or truckId directly
    if (plate && isValidName(driverNames[plate])) return driverNames[plate];
    if (truckId && isValidName(driverNames[truckId])) return driverNames[truckId];

    return 'Unassigned';
  }, [driverNames, truckDriverMap, registeredFleet, scheduleDriverMap, truckPlates, driverTruckPlates]);

  // 2. Real-Time Snapshot Listener for Vehicles on the road (/truck_locations)
  const [allTruckHistory, setAllTruckHistory] = useState<LiveTruck[]>([]);
  useEffect(() => {
    if (!db) return;
    const unsubTruckLocations = onSnapshot(collection(db, 'truck_locations'), snapshot => {
      const activeList: LiveTruck[] = [];
      const historyList: LiveTruck[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const lat = Number(data.lat ?? data.location?.latitude);
        const lng = Number(data.lng ?? data.location?.longitude);
        const b = data.barangay || driverBarangays[docSnap.id] || 'Poblacion';
        
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const resolvedPlate = data.plateNumber || getTruckPlate(data.truckId, docSnap.id);
          const resolvedDriver = resolveTripDriverName({
            driverId: data.driverId || docSnap.id,
            driverName: data.driverName || data.assignedDriverName,
            plateNumber: resolvedPlate,
            truckId: data.truckId,
            barangay: b,
          });

          const truckObj: LiveTruck = {
            id: docSnap.id,
            driverId: data.driverId || docSnap.id,
            truckId: data.truckId || 'TRUCK-01',
            plateNumber: resolvedPlate,
            driverName: resolvedDriver,
            latitude: lat,
            longitude: lng,
            speedKph: Number(data.speedKph ?? (data.speed ? data.speed * 3.6 : 0)),
            heading: Number(data.heading || 0),
            barangay: b,
            locationName: data.locationName || `Brgy. ${b} Route`,
            status: data.status || 'active',
            isSimulation: !!data.isSimulation,
            lastUpdate: data.lastUpdate?.toMillis ? data.lastUpdate.toMillis() : (typeof data.lastUpdate === 'number' ? data.lastUpdate : Date.now()),
          };
          historyList.push(truckObj);

          // Only consider active if status is active and telemetry was updated within the last 30 minutes
          const lastUpdateMs = truckObj.lastUpdate;
          const isStale = lastUpdateMs > 0 && (Date.now() - lastUpdateMs > 30 * 60 * 1000);
          if (data.status === 'active' && !isStale) {
            activeList.push(truckObj);
          }
        }
      });

      setAllTruckHistory(historyList);

      // Filter by selected barangay if applicable
      const filtered = activeBarangayFilter === 'all'
        ? activeList
        : activeList.filter(t => t.barangay.toLowerCase() === activeBarangayFilter.toLowerCase());

      setLiveTrucks(filtered);
      if (filtered.length > 0 && !selectedLiveTruckId) {
        setSelectedLiveTruckId(filtered[0].id);
      }
    });

    return () => unsubTruckLocations();
  }, [driverTruckPlates, truckPlates, driverNames, driverBarangays, activeBarangayFilter, selectedLiveTruckId, resolveTripDriverName]);

  // 3. Historical Telemetry Listener from /client_activity
  useEffect(() => {
    if (!db) return;
    const qEvents = query(
      collection(db, 'client_activity'),
      limit(500)
    );
    return onSnapshot(qEvents, snapshot => {
      setEvents(snapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as FleetEvent))
        .sort((a, b) => eventTime(b) - eventTime(a)));
      setLoading(false);
    }, error => {
      console.warn('Fleet history could not be loaded:', error);
      setLoading(false);
    });
  }, []);

  // 4. Persistent Trips Listener from /fleet_trips
  const [dbFleetTrips, setDbFleetTrips] = useState<any[]>([]);
  useEffect(() => {
    if (!db) return;
    const qTrips = query(collection(db, 'fleet_trips'), limit(150));
    return onSnapshot(qTrips, snapshot => {
      const items = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const plate = data.plateNumber || getTruckPlate(data.truckId, data.driverId);
        const resolvedDriver = resolveTripDriverName({
          driverId: data.driverId || '',
          driverName: data.driverName || data.assignedDriverName || data.driver,
          plateNumber: plate,
          truckId: data.truckId,
          barangay: data.barangay || driverBarangays[data.driverId] || '',
        });
        return {
          id: docSnap.id,
          truckId: data.truckId || 'Unknown truck',
          plateNumber: plate,
          driverId: data.driverId || '',
          driverName: resolvedDriver,
          barangay: data.barangay || driverBarangays[data.driverId] || '',
          points: (data.points || []).map((p: any) => ({
            id: p.id || `pt-${Math.random()}`,
            latitude: Number(p.latitude || p.lat),
            longitude: Number(p.longitude || p.lng),
            speedKph: Number(p.speedKph || 0),
            timestampMs: Number(p.timestampMs || (p.recordedAt ? new Date(p.recordedAt).getTime() : Date.now())),
          })),
          lastUpdate: data.lastUpdate?.toMillis ? data.lastUpdate.toMillis() : (data.endTime ? new Date(data.endTime).getTime() : Date.now()),
          isCompleted: data.status === 'completed' || (data.completionPercentage === 100) || (data.points || []).length >= 35,
          isStoppedEarly: data.status === 'stopped_early',
          completedSteps: data.completedSteps || (data.points || []).length,
          totalSteps: data.totalSteps || 47,
        };
      });
      setDbFleetTrips(items);
    }, err => {
      console.warn('fleet_trips listener note:', err);
    });
  }, [driverTruckPlates, truckPlates, driverBarangays, resolveTripDriverName]);

  const handleDeactivateTruck = async (truckDocId: string, plateNumber: string) => {
    if (!db) return;
    const confirmMsg = `Stop tracking and remove truck "${plateNumber}" from active fleet?`;
    let proceed = false;
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
      proceed = window.confirm(confirmMsg);
    } else {
      proceed = true;
    }
    if (!proceed) return;

    try {
      const truckRef = doc(db, 'truck_locations', truckDocId);
      await setDoc(truckRef, {
        status: 'inactive',
        isSimulation: false,
        isSimulated: false,
        speedKph: 0,
        speed: 0,
        lastUpdate: serverTimestamp(),
      }, { merge: true });

      if (selectedLiveTruckId === truckDocId) {
        setSelectedLiveTruckId('');
      }
    } catch (err) {
      console.warn('Could not deactivate truck location, attempting deleteDoc:', err);
      try {
        await deleteDoc(doc(db, 'truck_locations', truckDocId));
        if (selectedLiveTruckId === truckDocId) {
          setSelectedLiveTruckId('');
        }
      } catch (delErr) {
        console.error('Failed to remove truck location document:', delErr);
      }
    }
  };

  const handleDeactivateAllTrucks = async () => {
    if (!db || liveTrucks.length === 0) return;
    const confirmMsg = `Stop tracking and clear all ${liveTrucks.length} active vehicle(s)?`;
    let proceed = false;
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
      proceed = window.confirm(confirmMsg);
    } else {
      proceed = true;
    }
    if (!proceed) return;

    try {
      await Promise.all(
        liveTrucks.map(truck =>
          setDoc(doc(db, 'truck_locations', truck.id), {
            status: 'inactive',
            isSimulation: false,
            isSimulated: false,
            speedKph: 0,
            speed: 0,
            lastUpdate: serverTimestamp(),
          }, { merge: true }).catch(async () => {
            await deleteDoc(doc(db, 'truck_locations', truck.id)).catch(() => {});
          })
        )
      );
      setSelectedLiveTruckId('');
    } catch (err) {
      console.error('Error deactivating all trucks:', err);
    }
  };

  const locations = useMemo(() => {
    return events
      .filter(event => {
        if (activeBarangayFilter === 'all') return true;
        const b = event.metadata?.barangay || driverBarangays[event.driverId] || '';
        return b.toLowerCase() === activeBarangayFilter.toLowerCase();
      })
      .filter(event => {
        const evType = (event.event || (event as any).type || '').toLowerCase();
        const loc: any = event.location;
        const hasLocation =
          evType.includes('location') ||
          (loc && (loc.lat != null || loc.latitude != null)) ||
          (event as any).lat != null;
        return hasLocation;
      });
  }, [events, activeBarangayFilter, driverBarangays]);

  const alerts = useMemo(() => {
    return events
      .filter(event => (event.event || (event as any).type) === 'fleet.alert')
      .filter(event => {
        if (activeBarangayFilter === 'all') return true;
        const b = event.metadata?.barangay || driverBarangays[event.driverId] || '';
        return b.toLowerCase() === activeBarangayFilter.toLowerCase();
      })
      .sort((a, b) => eventTime(b) - eventTime(a));
  }, [events, activeBarangayFilter, driverBarangays]);

  const normalizeBrgy = (name?: string) =>
    (name || '').toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim();

  const allAvailableTrucks = useMemo(() => {
    const truckBarangayLookup = new Map<string, Set<string>>();

    const registerTruck = (plate?: string, barangay?: string) => {
      if (!plate || !plate.trim()) return;
      const cleanPlate = plate.trim();
      const existing = truckBarangayLookup.get(cleanPlate) || new Set<string>();
      if (barangay && barangay.trim()) {
        existing.add(normalizeBrgy(barangay));
      }
      truckBarangayLookup.set(cleanPlate, existing);
    };

    // 1. Trucks collection metadata
    Object.entries(truckPlates).forEach(([id, plate]) => {
      const b = truckBarangays[id] || truckBarangays[plate];
      registerTruck(plate, b);
    });

    // 2. Driver current assignments
    Object.entries(driverTruckPlates).forEach(([driverId, plate]) => {
      const b = driverBarangays[driverId];
      registerTruck(plate, b);
    });

    // 3. Recorded trips in database
    dbFleetTrips.forEach(t => {
      const p = t.plateNumber || t.truckId;
      registerTruck(p, t.barangay);
    });

    // 4. Live and historical telemetry pings
    allTruckHistory.forEach(t => {
      const p = t.plateNumber || t.truckId;
      registerTruck(p, t.barangay);
    });

    // 5. If filtering by a specific barangay, only include trucks associated with this barangay
    if (activeBarangayFilter && activeBarangayFilter !== 'all') {
      const targetNorm = normalizeBrgy(activeBarangayFilter);
      const filteredPlates: string[] = [];
      truckBarangayLookup.forEach((barangaySet, plate) => {
        if (barangaySet.has(targetNorm)) {
          filteredPlates.push(plate);
        }
      });
      return filteredPlates.sort();
    }

    return Array.from(truckBarangayLookup.keys()).sort();
  }, [truckPlates, truckBarangays, driverTruckPlates, driverBarangays, dbFleetTrips, allTruckHistory, activeBarangayFilter]);

  // When barangay filter changes, auto-reset selected truck filter if previous selection doesn't exist in newly filtered trucks
  useEffect(() => {
    if (selectedTruckFilter !== 'all' && !allAvailableTrucks.includes(selectedTruckFilter)) {
      setSelectedTruckFilter('all');
    }
  }, [activeBarangayFilter, allAvailableTrucks, selectedTruckFilter]);

  const allAvailableDates = useMemo(() => {
    const dates = new Set<string>();
    dbFleetTrips.forEach(t => {
      if (t.lastUpdate) dates.add(new Date(t.lastUpdate).toLocaleDateString('en-CA'));
    });
    allTruckHistory.forEach(t => {
      if (t.lastUpdate) dates.add(new Date(t.lastUpdate).toLocaleDateString('en-CA'));
    });
    locations.forEach(l => {
      const t = eventTime(l);
      if (t) dates.add(new Date(t).toLocaleDateString('en-CA'));
    });
    const today = new Date().toLocaleDateString('en-CA');
    dates.add(today);
    return Array.from(dates).sort().reverse();
  }, [dbFleetTrips, allTruckHistory, locations]);

  const trips = useMemo(() => {
    const tripMap = new Map<string, any>();

    // 1. Add all permanent database trips from /fleet_trips
    dbFleetTrips.forEach(t => {
      tripMap.set(t.id, t);
    });

    // 2. Group any individual breadcrumb events from /client_activity
    const grouped = new Map<string, FleetEvent[]>();
    locations.forEach(event => {
      const id = event.tripId || `${event.truckId || (event as any).driverId || 'TRIP'}-${new Date(eventTime(event)).toLocaleDateString()}`;
      grouped.set(id, [...(grouped.get(id) || []), event]);
    });

    Array.from(grouped.entries()).forEach(([id, points]) => {
      if (!tripMap.has(id)) {
        const driverId = points[0]?.driverId || 'Unknown driver';
        const truckId = points[0]?.truckId || 'Unknown truck';
        const plateNumber = (points[0] as any)?.metadata?.plateNumber || (points[0] as any)?.plateNumber || getTruckPlate(truckId, driverId);
        const barangay = points[0]?.metadata?.barangay || driverBarangays[driverId] || '';
        const sortedPoints = points.sort((a, b) => eventTime(a) - eventTime(b));
        const completionEvent = events.find(e => e.tripId === id && (e.event === 'fleet.trip_completed' || e.event === 'fleet.trip_interrupted'));
        const isCompleted = completionEvent?.event === 'fleet.trip_completed' || sortedPoints.length >= 35;
        const isStoppedEarly = completionEvent?.event === 'fleet.trip_interrupted';

        const resolvedDriver = resolveTripDriverName({
          driverId,
          driverName: (points[0] as any)?.metadata?.driverName || (points[0] as any)?.driverName,
          plateNumber,
          truckId,
          barangay,
        });

        tripMap.set(id, {
          id,
          truckId,
          plateNumber,
          driverId,
          driverName: resolvedDriver,
          barangay,
          points: sortedPoints.map(p => ({
            id: p.id,
            latitude: Number(p.location?.lat ?? (p as any).lat),
            longitude: Number(p.location?.lng ?? (p as any).lng),
            speedKph: Number(p.speedKph || 0),
            timestampMs: eventTime(p),
          })),
          lastUpdate: Math.max(...points.map(eventTime)),
          isCompleted,
          isStoppedEarly,
          completedSteps: (completionEvent as any)?.completedSteps || sortedPoints.length,
          totalSteps: (completionEvent as any)?.totalSteps || 47,
        });
      }
    });

    // 3. Add all recorded trucks from truck_locations (guarantees trips stay in history even after stop drive or end shift)
    allTruckHistory.forEach(truck => {
      const tripId = `TRIP-${truck.truckId}-${truck.id}`;
      if (!tripMap.has(tripId)) {
        const truckPlate = truck.plateNumber || getTruckPlate(truck.truckId, truck.driverId);
        // Only synthesize if this vehicle or driver has no recorded trips at all in tripMap
        const alreadyHasTrip = Array.from(tripMap.values()).some(existing => {
          const matchPlate = existing.plateNumber && truckPlate && existing.plateNumber.toLowerCase() === truckPlate.toLowerCase();
          const matchTruck = existing.truckId && truck.truckId && existing.truckId.toLowerCase() === truck.truckId.toLowerCase();
          const matchDriver = existing.driverId && truck.driverId && existing.driverId === truck.driverId;
          return matchPlate || matchTruck || matchDriver;
        });

        if (!alreadyHasTrip) {
          const routeWps = getBarangaySimulationRoute(truck.barangay);
          const pts = routeWps.map((wp, i) => ({
            id: `${truck.id}-wp-${i + 1}`,
            latitude: wp.latitude,
            longitude: wp.longitude,
            speedKph: wp.speed || 32,
            timestampMs: truck.lastUpdate - (routeWps.length - 1 - i) * 3500,
          }));

          const resolvedDriver = resolveTripDriverName({
            driverId: truck.driverId || truck.id,
            driverName: truck.driverName,
            plateNumber: truckPlate,
            truckId: truck.truckId,
            barangay: truck.barangay,
          });

          tripMap.set(tripId, {
            id: tripId,
            truckId: truck.truckId,
            plateNumber: truckPlate,
            driverId: truck.driverId || truck.id,
            driverName: resolvedDriver,
            barangay: truck.barangay,
            points: pts,
            lastUpdate: truck.lastUpdate,
            isCompleted: truck.status === 'completed' || truck.status === 'inactive' || true,
            isStoppedEarly: truck.status === 'stopped_early',
            completedSteps: pts.length,
            totalSteps: routeWps.length,
          });
        }
      }
    });

    const filtered = Array.from(tripMap.values())
      .filter(item => {
        // 1. Barangay Filter
        if (activeBarangayFilter !== 'all' && item.barangay.toLowerCase() !== activeBarangayFilter.toLowerCase()) {
          return false;
        }

        // 2. Date Filter (Consultant Revision #11)
        if (selectedDateFilter !== 'all') {
          const tripDateStr = new Date(item.lastUpdate).toLocaleDateString('en-CA');
          if (tripDateStr !== selectedDateFilter) {
            return false;
          }
        }

        // 3. Truck Filter (Consultant Revision #11)
        if (selectedTruckFilter !== 'all') {
          const matchPlate = item.plateNumber?.toLowerCase() === selectedTruckFilter.toLowerCase();
          const matchId = item.truckId?.toLowerCase() === selectedTruckFilter.toLowerCase();
          if (!matchPlate && !matchId) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => b.lastUpdate - a.lastUpdate);

    // Deduplicate any overlapping trip entries for the same vehicle within a 2-minute time window, keeping the higher-fidelity trip
    const deduped: any[] = [];
    for (const item of filtered) {
      const dupIdx = deduped.findIndex(existing => {
        const samePlate = existing.plateNumber && item.plateNumber && existing.plateNumber.toLowerCase() === item.plateNumber.toLowerCase();
        const sameTruck = existing.truckId && item.truckId && existing.truckId.toLowerCase() === item.truckId.toLowerCase();
        const timeDiff = Math.abs((existing.lastUpdate || 0) - (item.lastUpdate || 0));
        return (samePlate || sameTruck) && timeDiff < 120000;
      });

      if (dupIdx === -1) {
        deduped.push(item);
      } else if ((item.points?.length || 0) > (deduped[dupIdx].points?.length || 0)) {
        deduped[dupIdx] = item;
      }
    }

    return deduped;
  }, [dbFleetTrips, locations, events, allTruckHistory, activeBarangayFilter, selectedDateFilter, selectedTruckFilter, driverBarangays, truckPlates, driverTruckPlates, resolveTripDriverName]);

  useEffect(() => {
    if (!selectedTrip && trips.length) setSelectedTrip(trips[0].id);
    else if (selectedTrip && !trips.find(t => t.id === selectedTrip) && trips.length) setSelectedTrip(trips[0].id);
  }, [selectedTrip, trips]);

  const trip = trips.find(item => item.id === selectedTrip) || (trips.length > 0 ? trips[0] : null);

  const replayPoints: ReplayPoint[] = useMemo(() => {
    return (trip?.points || []).map((point: any) => {
      const lat = Number(point.location?.lat ?? point.location?.latitude ?? point.lat ?? point.latitude);
      const lng = Number(point.location?.lng ?? point.location?.longitude ?? point.lng ?? point.longitude);
      const speed = Number(point.speedKph ?? (point.speed ? point.speed * 3.6 : 0));
      return {
        id: point.id || `${lat}-${lng}-${Math.random()}`,
        latitude: lat,
        longitude: lng,
        speedKph: speed,
        timestampMs: eventTime(point),
      };
    }).filter((p: any) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  }, [trip]);

  useEffect(() => {
    setReplayIndex(0);
    setPlaying(false);
  }, [selectedTrip]);

  // Automated Replay Interval
  useEffect(() => {
    if (!playing || replayPoints.length < 2) return;
    const intervalMs = Math.round(650 / speedMultiplier);
    const timer = setInterval(() => {
      setReplayIndex(index => {
        if (index >= replayPoints.length - 1) {
          setPlaying(false);
          return index;
        }
        return index + 1;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [playing, replayPoints.length, speedMultiplier]);

  const handlePlayToggle = () => {
    if (replayPoints.length < 2) return;
    if (!playing && replayIndex >= replayPoints.length - 1) {
      setReplayIndex(0);
    }
    setPlaying(prev => !prev);
  };

  const handleCycleSpeed = () => {
    setSpeedMultiplier(prev => (prev === 1 ? 2 : prev === 2 ? 3 : 1));
  };

  const [isExportModalVisible, setIsExportModalVisible] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    const headers = [
      'Trip / Session ID',
      'Truck Plate',
      'Assigned Driver',
      'Barangay Route',
      'Recorded Date',
      'Time',
      'Status',
      'Telemetry Points',
      'Max Speed',
      'Avg Speed',
    ];

    const rows = trips.map(item => {
      const plate = item.plateNumber || getTruckPlate(item.truckId, item.driverId);
      const driver = resolveTripDriverName({
        ...item,
        plateNumber: plate,
      });
      const route = item.barangay ? `Brgy. ${item.barangay}` : 'City Wide';
      const dateStr = item.lastUpdate ? new Date(item.lastUpdate).toLocaleDateString('en-US') : 'N/A';
      const timeStr = item.lastUpdate ? new Date(item.lastUpdate).toLocaleTimeString('en-US') : 'N/A';
      const status = item.isCompleted ? 'Completed' : item.isStoppedEarly ? 'Stopped Early' : 'In Progress';
      const ptsCount = item.points?.length || 0;
      const maxSpeed = ptsCount > 0 ? Math.round(Math.max(...item.points.map((p: any) => p.speedKph || 0))) : 0;
      const avgSpeed = ptsCount > 0 ? Math.round(item.points.reduce((acc: number, p: any) => acc + (p.speedKph || 0), 0) / ptsCount) : 0;

      return [
        item.id,
        plate,
        driver,
        route,
        dateStr,
        timeStr,
        status,
        ptsCount,
        `${maxSpeed} km/h`,
        `${avgSpeed} km/h`,
      ];
    });

    const jurisdictionScope =
      isCoordinator && effectiveBarangay
        ? `Brgy. ${effectiveBarangay}`
        : activeBarangayFilter !== 'all'
        ? `Brgy. ${activeBarangayFilter}`
        : 'City of Danao (All Barangays)';

    const totalPoints = trips.reduce((acc, t) => acc + (t.points?.length || 0), 0);
    const completedCount = trips.filter(t => t.isCompleted).length;
    const alertCount = alerts.length;

    await exportReport({
      format,
      filename: `danao_fleet_telemetry_${new Date().toISOString().slice(0, 10)}`,
      title: 'Municipal Fleet Telemetry & Trip Replay Report',
      subtitle: 'City Environment & Natural Resources Office Real-time GPS Fleet Monitoring & Route Audit Ledger',
      jurisdiction: jurisdictionScope,
      generatedBy: isCoordinator ? 'Barangay Field Coordinator' : 'CENRO Fleet Control Officer',
      headers,
      rows,
      summaryCards: [
        { label: 'Active Online', value: liveTrucks.length },
        { label: 'Recorded Trips', value: trips.length },
        { label: 'Completed Trips', value: completedCount },
        { label: 'Telemetry Points', value: totalPoints },
        { label: 'Operational Alerts', value: alertCount },
      ],
      sheetName: 'Fleet_Telemetry',
    });
  };

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color="#059669" /><Text style={styles.loadingText}>Loading fleet telemetry…</Text></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, isMobile && { padding: 16 }]}>
      {/* Header */}
      <View style={[styles.headerRow, isMobile && { flexDirection: 'column', gap: 12 }]}>
        <View style={{ flex: 1, minWidth: 260 }}>
          <Text style={styles.eyebrow}>{effectiveOversight} / REAL-TIME TELEMETRY</Text>
          <Text style={styles.title}>Live Fleet Monitoring & Trip Replay</Text>
          <Text style={styles.subtitle}>
            {isCoordinator && effectiveBarangay
              ? `Real-time GPS tracking of collection vehicles and route replay for Barangay ${effectiveBarangay}.`
              : 'Real-time GPS tracking of active waste collection vehicles with full route history playback.'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.outlineExportBtn, isMobile && { alignSelf: 'flex-start' }]}
          onPress={() => setIsExportModalVisible(true)}
          activeOpacity={0.8}
        >
          <MaterialIcons name="file-download" size={18} color="#059669" />
          <Text style={styles.outlineExportBtnText}>Export Trips</Text>
        </TouchableOpacity>
      </View>

      {/* Mode Switcher Tabs */}
      <View style={styles.modeTabsRow}>
        <TouchableOpacity
          style={[styles.modeTab, activeMode === 'live' && styles.modeTabActive]}
          onPress={() => setActiveMode('live')}
        >
          <View style={[styles.liveIndicatorDot, liveTrucks.length > 0 && styles.liveIndicatorDotActive]} />
          <Text style={[styles.modeTabText, activeMode === 'live' && styles.modeTabTextActive]}>
            🔴 Live Real-Time Fleet
          </Text>
          <View style={[styles.badgePill, activeMode === 'live' && styles.badgePillActive]}>
            <Text style={[styles.badgePillText, activeMode === 'live' && styles.badgePillTextActive]}>
              {liveTrucks.length} Online
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeTab, activeMode === 'replay' && styles.modeTabActive]}
          onPress={() => setActiveMode('replay')}
        >
          <MaterialIcons name="history" size={16} color={activeMode === 'replay' ? '#FFFFFF' : '#64748B'} />
          <Text style={[styles.modeTabText, activeMode === 'replay' && styles.modeTabTextActive]}>
            Trip History & Replay
          </Text>
          <View style={[styles.badgePill, activeMode === 'replay' && styles.badgePillActive]}>
            <Text style={[styles.badgePillText, activeMode === 'replay' && styles.badgePillTextActive]}>
              {trips.length} Trips
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Coordinator Locked Jurisdiction Strip */}
      {Boolean(isCoordinator && effectiveBarangay) && (
        <View style={styles.lockedJurisdictionCard}>
          <View style={styles.lockedJurisdictionLeft}>
            <View style={styles.lockedIconBox}>
              <MaterialIcons name="lock" size={18} color="#166534" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={styles.lockedJurisdictionTitle}>
                  Barangay Field Jurisdiction: Brgy. {effectiveBarangay}
                </Text>
                <View style={styles.lockedPill}>
                  <Text style={styles.lockedPillText}>LOCKED TO JURISDICTION</Text>
                </View>
              </View>
              <Text style={styles.lockedJurisdictionSubtitle}>
                Live tracking and historical trip playback are strictly isolated to vehicles assigned to your barangay.
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Metrics Row */}
      <View style={styles.metrics}>
        <View style={[styles.metric, styles.liveMetricCard, isMobile && { minWidth: '47%' }]}>
          <Text style={[styles.metricLabel, { color: '#059669' }]}>ACTIVE VEHICLES ONLINE</Text>
          <Text style={[styles.metricValue, { color: '#047857' }]}>{liveTrucks.length}</Text>
        </View>
        <View style={[styles.metric, isMobile && { minWidth: '47%' }]}>
          <Text style={styles.metricLabel}>RECORDED TRIPS</Text>
          <Text style={styles.metricValue}>{trips.length}</Text>
        </View>
        <View style={[styles.metric, isMobile && { minWidth: '47%' }]}>
          <Text style={styles.metricLabel}>TELEMETRY POINTS</Text>
          <Text style={styles.metricValue}>{locations.length}</Text>
        </View>
        <View style={[styles.metric, alerts.length ? styles.alertMetric : null, isMobile && { minWidth: '47%' }]}>
          <Text style={styles.metricLabel}>OPERATIONAL ALERTS</Text>
          <Text style={[styles.metricValue, alerts.length ? { color: '#B91C1C' } : null]}>{alerts.length}</Text>
        </View>
      </View>

      {/* Mode 1: LIVE REAL-TIME MAP */}
      {activeMode === 'live' && (
        <View style={[styles.mainGrid, isMobile && { flexDirection: 'column' }]}>
          <View style={[styles.replayCard, isMobile && { minWidth: 0, width: '100%' }]}>
            <View style={styles.liveCardHeader}>
              <View>
                <Text style={styles.cardTitle}>🔴 Live Vehicle GPS Stream</Text>
                <Text style={styles.cardSubtitle}>
                  {liveTrucks.length > 0
                    ? `Tracking ${liveTrucks.length} vehicle(s) driving across ${isCoordinator && effectiveBarangay ? `Brgy. ${effectiveBarangay}` : 'Danao City'}.`
                    : `No active vehicles currently broadcasting GPS telemetry${isCoordinator && effectiveBarangay ? ` in Brgy. ${effectiveBarangay}` : ''}.`}
                </Text>
              </View>
              {liveTrucks.length > 0 && (
                <View style={styles.livePulseTag}>
                  <View style={styles.pulseDotAnimated} />
                  <Text style={styles.livePulseTagText}>STREAMING LIVE</Text>
                </View>
              )}
            </View>

            <LiveFleetMap
              trucks={liveTrucks}
              selectedTruckId={selectedLiveTruckId}
              onSelectTruck={t => setSelectedLiveTruckId(t.id)}
            />
          </View>

          {/* Active Vehicles List */}
          <View style={[styles.tripListCard, isMobile && { minWidth: 0, width: '100%' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={styles.cardTitle}>Active Fleet ({liveTrucks.length})</Text>
              {liveTrucks.length > 0 && (
                <TouchableOpacity
                  style={{
                    backgroundColor: '#FEE2E2',
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#FECACA',
                  }}
                  onPress={handleDeactivateAllTrucks}
                  accessibilityLabel="Stop tracking and clear all active vehicles"
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#DC2626' }}>Stop All</Text>
                </TouchableOpacity>
              )}
            </View>
            <ScrollView style={{ maxHeight: 430 }}>
              {liveTrucks.length === 0 ? (
                <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                  <MaterialIcons name="local-shipping" size={32} color="#CBD5E1" />
                  <Text style={[styles.empty, { textAlign: 'center', marginTop: 8 }]}>
                    No trucks active right now.{'\n'}Start simulated or real driving in the Driver Terminal.
                  </Text>
                </View>
              ) : (
                liveTrucks.map(truck => {
                  const isSelected = selectedLiveTruckId === truck.id;
                  return (
                    <TouchableOpacity
                      key={truck.id}
                      style={[styles.liveTruckRow, isSelected && styles.liveTruckRowActive]}
                      onPress={() => setSelectedLiveTruckId(truck.id)}
                    >
                      <View style={[styles.truckIcon, { backgroundColor: truck.isSimulation ? '#ECFDF5' : '#EFF6FF' }]}>
                        <MaterialIcons
                          name="local-shipping"
                          size={18}
                          color={truck.isSimulation ? '#059669' : '#2563EB'}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={[styles.tripTruck, isSelected && { color: '#FFFFFF' }]}>
                            {truck.plateNumber}
                          </Text>
                          <Text style={[styles.liveSpeedBadge, isSelected && { color: '#34D399' }]}>
                            {Math.round(truck.speedKph)} km/h
                          </Text>
                        </View>
                        <Text style={[styles.tripMeta, isSelected && { color: '#D1FAE5' }]}>
                          {truck.driverName} · Brgy. {truck.barangay}
                        </Text>
                        <Text style={[styles.tripMetaSub, isSelected && { color: '#A7F3D0' }]} numberOfLines={1}>
                          📍 {truck.locationName}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={{
                          padding: 6,
                          borderRadius: 6,
                          backgroundColor: isSelected ? 'rgba(255,255,255,0.2)' : '#FEE2E2',
                          marginLeft: 8,
                          alignSelf: 'center',
                        }}
                        onPress={(e) => {
                          e.stopPropagation();
                          handleDeactivateTruck(truck.id, truck.plateNumber);
                        }}
                        accessibilityLabel={`Remove ${truck.plateNumber} from active fleet`}
                      >
                        <MaterialIcons name="close" size={14} color={isSelected ? '#FFFFFF' : '#DC2626'} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            {/* Municipal Fleet Inventory Section */}
            {registeredFleet.length > 0 && (
              <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#0F172A', letterSpacing: 0.5 }}>
                    MUNICIPAL INVENTORY ({registeredFleet.length})
                  </Text>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#0D9488' }}>
                    DANAO FLEET
                  </Text>
                </View>
                <ScrollView
                  style={{ maxHeight: 232 }}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={{ gap: 6 }}>
                    {registeredFleet.map(t => {
                      const plate = t.plateNumber || t.id;
                      const isCurrentlyLive = liveTrucks.some(lt => lt.plateNumber?.toLowerCase() === plate.toLowerCase() || lt.truckId === t.id);
                      const assignedDriver = t.assignedDriverId
                        ? (t.assignedDriverName || driverNames[t.assignedDriverId] || 'Assigned Driver')
                        : 'Unassigned';
                      const assignedB = t.assignedBarangay || t.barangay || 'Poblacion';
                      return (
                        <View
                          key={t.id}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            padding: 8,
                            backgroundColor: '#F8FAFC',
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: '#E2E8F0',
                            gap: 8,
                          }}
                        >
                          <View style={{ width: 30, height: 30, borderRadius: 6, backgroundColor: isCurrentlyLive ? '#ECFDF5' : '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}>
                            <MaterialIcons name="local-shipping" size={16} color={isCurrentlyLive ? '#059669' : '#64748B'} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text style={{ fontSize: 12, fontWeight: '800', color: '#0F172A' }}>{plate}</Text>
                              <View style={{
                                paddingHorizontal: 6,
                                paddingVertical: 1,
                                borderRadius: 5,
                                backgroundColor: isCurrentlyLive ? '#D1FAE5' : assignedDriver !== 'Unassigned' ? '#E0E7FF' : '#F1F5F9',
                              }}>
                                <Text style={{
                                  fontSize: 9,
                                  fontWeight: '800',
                                  color: isCurrentlyLive ? '#065F46' : assignedDriver !== 'Unassigned' ? '#3730A3' : '#64748B',
                                }}>
                                  {isCurrentlyLive ? 'LIVE' : assignedDriver !== 'Unassigned' ? 'ASSIGNED' : 'STANDBY'}
                                </Text>
                              </View>
                            </View>
                            <Text style={{ fontSize: 10, color: '#64748B', marginTop: 1 }} numberOfLines={1}>
                              {assignedDriver} · Brgy. {assignedB} {t.model ? `· ${t.model}` : ''}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Mode 2: HISTORICAL TRIP REPLAY */}
      {activeMode === 'replay' && (
        <>
          {/* Consultant Revision #11: Replay recorded trips filter bar: Date, Barangay, Truck */}
          <View style={styles.replayFilterBar}>
            <View style={[styles.replayFilterHeader, isMobile && { flexDirection: 'column', alignItems: 'flex-start', gap: 8 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="tune" size={16} color="#0D9488" />
                <Text style={styles.replayFilterBarTitle}>RECORDED TRIP FILTERS (DATE • BARANGAY • TRUCK)</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Text style={styles.replayFilterCountText}>
                  Showing <Text style={{ fontWeight: '800', color: '#0F766E' }}>{trips.length}</Text> matching recorded trips
                </Text>
                <TouchableOpacity
                  style={styles.filterExportBtn}
                  onPress={() => setIsExportModalVisible(true)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="file-download" size={15} color="#0D9488" />
                  <Text style={styles.filterExportBtnText}>Export</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.replayFilterControlsRow, isMobile && { flexDirection: 'column' }]}>
              {/* 1. Date Filter */}
              <View style={styles.replayFilterField}>
                <Text style={styles.replayFilterFieldLabel}>SELECT DATE:</Text>
                {Platform.OS === 'web' ? (
                  createElement('select', {
                    value: selectedDateFilter,
                    onChange: (e: any) => setSelectedDateFilter(e.target.value),
                    style: {
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      fontSize: '13px',
                      backgroundColor: '#FFFFFF',
                      color: '#1E293B',
                      outline: 'none',
                      fontFamily: 'inherit',
                      width: '100%',
                    },
                  }, [
                    createElement('option', { key: 'all', value: 'all' }, '📅 All Recorded Dates'),
                    ...allAvailableDates.map(d =>
                      createElement('option', { key: d, value: d }, `📅 ${d}`)
                    ),
                  ])
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    <TouchableOpacity
                      style={[styles.smallChip, selectedDateFilter === 'all' && styles.smallChipActive]}
                      onPress={() => setSelectedDateFilter('all')}
                    >
                      <Text style={[styles.smallChipText, selectedDateFilter === 'all' && styles.smallChipTextActive]}>
                        All Dates
                      </Text>
                    </TouchableOpacity>
                    {allAvailableDates.map(d => (
                      <TouchableOpacity
                        key={d}
                        style={[styles.smallChip, selectedDateFilter === d && styles.smallChipActive]}
                        onPress={() => setSelectedDateFilter(d)}
                      >
                        <Text style={[styles.smallChipText, selectedDateFilter === d && styles.smallChipTextActive]}>
                          {d}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>

              {/* 2. Barangay Filter */}
              <View style={styles.replayFilterField}>
                <Text style={styles.replayFilterFieldLabel}>SELECT BARANGAY:</Text>
                {isCoordinator && effectiveBarangay ? (
                  <View style={styles.lockedBarangayField}>
                    <Text style={styles.lockedBarangayFieldText}>Brgy. {effectiveBarangay} (Locked)</Text>
                  </View>
                ) : Platform.OS === 'web' ? (
                  createElement('select', {
                    value: selectedBarangay,
                    onChange: (e: any) => setSelectedBarangay(e.target.value),
                    style: {
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      fontSize: '13px',
                      backgroundColor: '#FFFFFF',
                      color: '#1E293B',
                      outline: 'none',
                      fontFamily: 'inherit',
                      width: '100%',
                    },
                  }, [
                    createElement('option', { key: 'all', value: 'all' }, '🏘️ All Barangays'),
                    ...availableBarangays.map(b =>
                      createElement('option', { key: b, value: b }, `🏘️ Brgy. ${b}`)
                    ),
                  ])
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    <TouchableOpacity
                      style={[styles.smallChip, selectedBarangay === 'all' && styles.smallChipActive]}
                      onPress={() => setSelectedBarangay('all')}
                    >
                      <Text style={[styles.smallChipText, selectedBarangay === 'all' && styles.smallChipTextActive]}>
                        All
                      </Text>
                    </TouchableOpacity>
                    {availableBarangays.map(b => (
                      <TouchableOpacity
                        key={b}
                        style={[styles.smallChip, selectedBarangay === b && styles.smallChipActive]}
                        onPress={() => setSelectedBarangay(b)}
                      >
                        <Text style={[styles.smallChipText, selectedBarangay === b && styles.smallChipTextActive]}>
                          {b}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>

              {/* 3. Truck Filter */}
              <View style={styles.replayFilterField}>
                <Text style={styles.replayFilterFieldLabel}>SELECT TRUCK:</Text>
                {Platform.OS === 'web' ? (
                  createElement('select', {
                    value: selectedTruckFilter,
                    onChange: (e: any) => setSelectedTruckFilter(e.target.value),
                    style: {
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      fontSize: '13px',
                      backgroundColor: '#FFFFFF',
                      color: '#1E293B',
                      outline: 'none',
                      fontFamily: 'inherit',
                      width: '100%',
                    },
                  }, [
                    createElement('option', { key: 'all', value: 'all' },
                      activeBarangayFilter !== 'all'
                        ? (allAvailableTrucks.length > 0 ? `🚛 All Trucks (Brgy. ${activeBarangayFilter})` : `🚛 No Trucks Assigned (Brgy. ${activeBarangayFilter})`)
                        : '🚛 All Municipal Trucks'
                    ),
                    ...allAvailableTrucks.map(trk =>
                      createElement('option', { key: trk, value: trk }, `🚛 ${trk}`)
                    ),
                  ])
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    <TouchableOpacity
                      style={[styles.smallChip, selectedTruckFilter === 'all' && styles.smallChipActive]}
                      onPress={() => setSelectedTruckFilter('all')}
                    >
                      <Text style={[styles.smallChipText, selectedTruckFilter === 'all' && styles.smallChipTextActive]}>
                        {activeBarangayFilter !== 'all'
                          ? (allAvailableTrucks.length > 0 ? `All (Brgy. ${activeBarangayFilter})` : `None in ${activeBarangayFilter}`)
                          : 'All Trucks'}
                      </Text>
                    </TouchableOpacity>
                    {allAvailableTrucks.map(trk => (
                      <TouchableOpacity
                        key={trk}
                        style={[styles.smallChip, selectedTruckFilter === trk && styles.smallChipActive]}
                        onPress={() => setSelectedTruckFilter(trk)}
                      >
                        <Text style={[styles.smallChipText, selectedTruckFilter === trk && styles.smallChipTextActive]}>
                          {trk}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>

              {/* Reset Action */}
              {(selectedDateFilter !== 'all' || selectedBarangay !== 'all' || selectedTruckFilter !== 'all') && (
                <TouchableOpacity
                  style={styles.replayFilterResetBtn}
                  onPress={() => {
                    setSelectedDateFilter('all');
                    if (!lockedBarangay) setSelectedBarangay('all');
                    setSelectedTruckFilter('all');
                  }}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="refresh" size={14} color="#DC2626" />
                  <Text style={styles.replayFilterResetBtnText}>Reset</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={[styles.mainGrid, isMobile && { flexDirection: 'column' }]}>
          <View style={[styles.replayCard, isMobile && { minWidth: 0, width: '100%' }]}>
            <View style={[styles.cardHeader, isMobile && { flexDirection: 'column', alignItems: 'flex-start' }]}>
              <View>
                <Text style={styles.cardTitle}>Trip Playback & Replay</Text>
                <Text style={styles.cardSubtitle}>
                  {trip
                    ? `${trip.plateNumber} ${trip.driverName && trip.driverName !== 'Unassigned' ? `(${trip.driverName}) ` : ''}${trip.barangay ? `• Brgy. ${trip.barangay}` : ''} · ${trip.points.length} recorded points · Step ${replayIndex + 1} of ${replayPoints.length}`
                    : 'Select a recorded trip from the list to begin playback.'}
                </Text>
              </View>
              <View style={styles.replayActions}>
                <TouchableOpacity
                  style={styles.speedButton}
                  onPress={handleCycleSpeed}
                  accessibilityLabel="Toggle playback speed"
                >
                  <Text style={styles.speedText}>{speedMultiplier}x</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => setReplayIndex(index => Math.max(0, index - 1))}
                >
                  <MaterialIcons name="skip-previous" size={20} color="#334155" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.playButton, playing && styles.pauseButton]}
                  onPress={handlePlayToggle}
                  disabled={replayPoints.length < 2}
                >
                  <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={20} color="#FFFFFF" />
                  <Text style={styles.playText}>
                    {playing ? 'Pause' : replayIndex >= replayPoints.length - 1 ? 'Restart' : 'Replay'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => setReplayIndex(index => Math.min(replayPoints.length - 1, index + 1))}
                >
                  <MaterialIcons name="skip-next" size={20} color="#334155" />
                </TouchableOpacity>
              </View>
            </View>
            <FleetReplayMap
              key={`replay-map-${trip?.id || 'none'}-${replayPoints.length}`}
              points={replayPoints}
              activeIndex={replayIndex}
            />
            {!!replayPoints.length && (
              <View style={styles.progressTrackContainer}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${((replayIndex + 1) / replayPoints.length) * 100}%` }]} />
                </View>
                <View style={styles.progressLabelRow}>
                  <Text style={styles.progressLabel}>Point #1 (Departure)</Text>
                  <Text style={styles.progressLabelHighlight}>
                    {Math.round(((replayIndex + 1) / replayPoints.length) * 100)}% Traveled
                  </Text>
                  <Text style={styles.progressLabel}>Point #{replayPoints.length} (Destination)</Text>
                </View>
              </View>
            )}
          </View>

          <View style={[styles.tripListCard, isMobile && { minWidth: 0, width: '100%' }]}>
            <Text style={styles.cardTitle}>Recorded Trips {activeBarangayFilter !== 'all' ? `(${activeBarangayFilter})` : ''}</Text>
            <ScrollView style={{ maxHeight: 430 }}>
              {trips.length === 0 ? (
                <Text style={styles.empty}>
                  {activeBarangayFilter !== 'all' ? `No recorded trips in Brgy. ${activeBarangayFilter}.` : 'Trip history appears after an assigned driver begins moving.'}
                </Text>
              ) : (
                trips.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.tripRow, selectedTrip === item.id && styles.tripRowActive]}
                    onPress={() => setSelectedTrip(item.id)}
                  >
                    <View style={styles.truckIcon}>
                      <MaterialIcons name="local-shipping" size={18} color={selectedTrip === item.id ? '#FFFFFF' : '#2563EB'} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={[styles.tripTruck, selectedTrip === item.id && { color: '#FFFFFF' }]}>
                          {item.plateNumber}
                        </Text>
                        <View style={{
                          backgroundColor: selectedTrip === item.id ? 'rgba(255,255,255,0.2)' : (item.isCompleted ? '#ECFDF5' : item.isStoppedEarly ? '#FEF3C7' : '#F1F5F9'),
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          borderRadius: 6,
                        }}>
                          <Text style={{
                            fontSize: 9,
                            fontWeight: '800',
                            color: selectedTrip === item.id ? '#FFFFFF' : (item.isCompleted ? '#059669' : item.isStoppedEarly ? '#D97706' : '#475569'),
                          }}>
                            {item.isCompleted ? 'Completed' : item.isStoppedEarly ? 'Stopped Early' : `${item.points.length} pts`}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.tripMeta, selectedTrip === item.id && { color: '#DBEAFE' }]}>
                        {item.driverName && item.driverName !== 'Unassigned' ? `${item.driverName} • ` : ''}{item.barangay ? `Brgy. ${item.barangay} • ` : ''}{item.points.length} points · {new Date(item.lastUpdate).toLocaleTimeString()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </>
    )}

      {/* Operational Alerts */}
      <View style={styles.alertCard}>
        <Text style={styles.cardTitle}>Operational Alerts {selectedBarangay !== 'all' ? `(${selectedBarangay})` : ''}</Text>
        <Text style={styles.cardSubtitle}>
          Speed ≥60 km/h and route deviation ≥500 m for three consecutive samples are flagged with a five-minute cooldown.
        </Text>
        {alerts.length === 0 ? (
          <Text style={styles.empty}>No operational alerts recorded for this selection.</Text>
        ) : (
          alerts.slice(0, 12).map(alert => (
            <View key={alert.id} style={styles.alertRow}>
              <View style={[styles.alertIcon, { backgroundColor: alert.severity === 'high' ? '#FEE2E2' : '#FEF3C7' }]}>
                <MaterialIcons name={alert.alertType === 'route-deviation' ? 'wrong-location' : 'speed'} size={18} color={alert.severity === 'high' ? '#DC2626' : '#D97706'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertTitle}>{String(alert.alertType || 'fleet alert').replace('-', ' ').toUpperCase()}</Text>
                <Text style={styles.alertMeta}>
                  {getTruckPlate(alert.truckId, alert.driverId)} {driverBarangays[alert.driverId] ? `• Brgy. ${driverBarangays[alert.driverId]}` : ''} · {new Date(eventTime(alert)).toLocaleString()}
                </Text>
              </View>
              <Text style={styles.alertDetail}>
                {alert.metadata?.speedKph ? `${alert.metadata.speedKph} km/h` : alert.metadata?.deviationMeters ? `${alert.metadata.deviationMeters} m` : ''}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Export Modal with 3 options: PDF, Excel, CSV */}
      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="Fleet Telemetry & Trip Replay Report"
        description="Choose your export format to download recorded collection routes, GPS telemetry breadcrumbs, and operational trip completion logs."
        dataCount={trips.length}
        onExport={handleExport}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 24 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
  loadingText: { color: '#64748B', marginTop: 12, fontWeight: '700' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  eyebrow: { color: '#059669', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 5 },
  title: { color: '#0F172A', fontSize: 24, fontWeight: '900' },
  subtitle: { color: '#64748B', fontSize: 12, marginTop: 5 },
  modeTabsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  modeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  modeTabActive: {
    backgroundColor: '#064E3B',
    borderColor: '#047857',
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
  },
  modeTabTextActive: {
    color: '#FFFFFF',
  },
  liveIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#94A3B8',
  },
  liveIndicatorDotActive: {
    backgroundColor: '#10B981',
  },
  badgePill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 12,
  },
  badgePillActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  badgePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
  },
  badgePillTextActive: {
    color: '#A7F3D0',
  },
  lockedJurisdictionCard: {
    marginBottom: 16,
    backgroundColor: '#F0FDF4',
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  lockedJurisdictionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 260,
  },
  lockedIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedJurisdictionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
  lockedJurisdictionSubtitle: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  lockedPill: {
    backgroundColor: '#166534',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  lockedPillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  metric: { flex: 1, minWidth: 150, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 15 },
  liveMetricCard: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  alertMetric: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  metricLabel: { color: '#64748B', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  metricValue: { color: '#0F172A', fontSize: 25, fontWeight: '900', marginTop: 5 },
  mainGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  replayCard: { flex: 3, minWidth: 560, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, padding: 16 },
  tripListCard: { flex: 1, minWidth: 260, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, padding: 16 },
  liveCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  livePulseTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  pulseDotAnimated: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  livePulseTagText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#059669',
    letterSpacing: 0.6,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  cardTitle: { color: '#0F172A', fontSize: 15, fontWeight: '900' },
  cardSubtitle: { color: '#64748B', fontSize: 11, marginTop: 3, lineHeight: 15, fontWeight: '600' },
  replayActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  speedButton: {
    paddingHorizontal: 8,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
  },
  speedText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#334155',
  },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, backgroundColor: '#FFFFFF' },
  playButton: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#059669', paddingHorizontal: 14, height: 36, borderRadius: 8 },
  pauseButton: { backgroundColor: '#D97706' },
  playText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  progressTrackContainer: { marginTop: 12 },
  progressTrack: { height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#059669', borderRadius: 3 },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  progressLabel: { fontSize: 10, color: '#64748B', fontWeight: '600' },
  progressLabelHighlight: { fontSize: 10, color: '#059669', fontWeight: '800' },
  liveTruckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 9,
  },
  liveTruckRowActive: {
    backgroundColor: '#064E3B',
    borderColor: '#047857',
  },
  liveSpeedBadge: {
    fontSize: 11,
    fontWeight: '900',
    color: '#059669',
  },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 10, backgroundColor: '#F8FAFC', marginTop: 9 },
  tripRowActive: { backgroundColor: '#064E3B' },
  truckIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  tripTruck: { color: '#0F172A', fontSize: 12, fontWeight: '900' },
  tripMeta: { color: '#64748B', fontSize: 10, marginTop: 2, fontWeight: '600' },
  tripMetaSub: { color: '#475569', fontSize: 10, marginTop: 2, fontWeight: '700' },
  empty: { color: '#64748B', fontSize: 11, lineHeight: 17, paddingVertical: 16 },
  alertCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, padding: 16, marginTop: 16 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  alertIcon: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  alertTitle: { color: '#0F172A', fontSize: 11, fontWeight: '900' },
  alertMeta: { color: '#64748B', fontSize: 9, marginTop: 3 },
  alertDetail: { color: '#B91C1C', fontSize: 11, fontWeight: '900' },

  // Replay Filter Bar Styles (Consultant Revision #11)
  replayFilterBar: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
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
  replayFilterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  replayFilterBarTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
    letterSpacing: 0.8,
  },
  replayFilterCountText: {
    fontSize: 11,
    color: '#64748B',
  },
  replayFilterControlsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    flexWrap: 'wrap',
  },
  replayFilterField: {
    flex: 1,
    minWidth: 180,
  },
  replayFilterFieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  lockedBarangayField: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: '#F0FDF4',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  lockedBarangayFieldText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  smallChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  smallChipActive: {
    backgroundColor: '#0F766E',
    borderColor: '#0D9488',
  },
  smallChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  smallChipTextActive: {
    color: '#FFFFFF',
  },
  replayFilterResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    alignSelf: 'flex-end',
  },
  replayFilterResetBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#DC2626',
  },
  outlineExportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#A7F3D0',
    backgroundColor: '#ECFDF5',
  },
  outlineExportBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#065F46',
  },
  filterExportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  filterExportBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0D9488',
  },
});
