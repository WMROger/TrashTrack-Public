import { useAuthContext } from '@/components/AuthContext';
import PickupDetailsModal from '@/components/PickupDetailsModal';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { db } from '@/config/firebase';
import { Colors } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import { ScheduleData, ScheduleNotificationService } from '@/services/scheduleNotificationService';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import OpenStreetMap, { MapTruck, MapPolyline, MapStop, OpenStreetMapRef } from '@/components/OpenStreetMap';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { locationService } from '@/services/locationService';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { BARANGAY_ANCHORS, getBarangaySimulationRoute } from '@/constants/barangaySimulationRoutes';
import { getRoadPolylineForBarangay } from '@/services/osrmRoutingService';
import { calculateAiEtaMinutes, getBarangayCoordinates, haversineMeters, IncomingCollectionService, IncomingCollectionState, resolveTruckDisplayName } from '@/services/incomingCollectionService';
import { LinearGradient } from 'expo-linear-gradient';
import ResidentNotificationModal from '@/components/resident/ResidentNotificationModal';
import { residentNotificationService } from '@/services/residentNotificationService';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function ScheduleScreen() {
  const { theme } = useTheme();
  const colors = Colors[theme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();

  type RawSchedule = ScheduleData & {
    days?: string[];
    dayTimes?: Record<string, string>;
    specificSchedules?: { date?: string; dateText?: string; wasteCategory?: string; timeText?: string }[];
    streetName?: string;
    barangayName?: string;
    barangay?: string;
    time?: string;
    collectionTime?: string;
  };

  const [currentMonth, setCurrentMonth] = useState<Date>(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [rawSchedules, setRawSchedules] = useState<RawSchedule[]>([]);
  const [monthScheduleDates, setMonthScheduleDates] = useState<Record<string, RawSchedule[]>>({});
  const [showLegend, setShowLegend] = useState(false);
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [selectedPickup, setSelectedPickup] = useState<RawSchedule | null>(null);
  const [showMapZoom, setShowMapZoom] = useState(false);
  const fullscreenMapRef = useRef<OpenStreetMapRef>(null);
  const [truckLocations, setTruckLocations] = useState<any[]>([]);
  const [truckTrails, setTruckTrails] = useState<Record<string, Array<{ latitude: number; longitude: number }>>>({});
  const [pickupRemindersEnabled, setPickupRemindersEnabled] = useState(false);
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [barangayRouteCoords, setBarangayRouteCoords] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [trucksList, setTrucksList] = useState<any[]>([]);
  const [completedSchedules, setCompletedSchedules] = useState<any[]>([]);

  useEffect(() => {
    if (!db) return;
    const unsubTrucksList = onSnapshot(collection(db, 'trucks'), (snap) => {
      setTrucksList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubCompleted = onSnapshot(
      query(collection(db, 'schedules'), where('status', '==', 'completed')),
      (snap) => {
        setCompletedSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );
    return () => {
      unsubTrucksList();
      unsubCompleted();
    };
  }, []);

  useEffect(() => {
    setTracksViewChanges(true);
    const t = setTimeout(() => setTracksViewChanges(false), 1000);
    return () => clearTimeout(t);
  }, [truckLocations.length, showMapZoom]);

  const formatMonthYear = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const startOfWeekIndex = (d: Date) => {
    const day = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
    return day === 0 ? 6 : day - 1; // Monday start
  };
  const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const buildMonthDays = (d: Date): Array<Date | null> => {
    const leading = startOfWeekIndex(d);
    const total = daysInMonth(d);
    const cells: Array<Date | null> = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let i = 1; i <= total; i++) cells.push(new Date(d.getFullYear(), d.getMonth(), i));
    return cells;
  };
  const isSameDate = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const handlePickupPress = (pickup: RawSchedule) => {
    setSelectedPickup(pickup);
    setShowPickupModal(true);
  };

  const handleCloseModal = () => {
    setShowPickupModal(false);
    setSelectedPickup(null);
  };

  const CATEGORY_COLORS: Record<string, string> = useMemo(() => ({
    'Biodegradable': '#22C55E',
    'BIODEGRADABLE': '#22C55E',
    'Non-Biodegradable': '#2563EB',
    'NON-BIODEGRADABLE': '#2563EB',
    'Recyclable': '#EAB308',
    'RECYCLABLE': '#EAB308',
    'Residual': '#6B7280',
    'RESIDUAL': '#6B7280',
    'Hazardous': '#EF4444',
    'HAZARDOUS': '#EF4444',
    'Special/Bulk': '#A855F7',
    'SPECIAL/BULK': '#A855F7',
  }), []);

  const LEGEND_ITEMS = useMemo(() => [
    { name: 'Non-biodegradable', color: '#2563EB' },
    { name: 'Recyclable', color: '#EAB308' },
    { name: 'Residual', color: '#6B7280' },
    { name: 'Hazardous', color: '#EF4444' },
    { name: 'Biodegradable', color: '#22C55E' },
    { name: 'Special / Bulk Collection', color: '#A855F7' },
  ], []);

  // Robust US long-date parser (e.g., "September 4, 2025") for iOS JSC
  const MONTH_INDEX: Record<string, number> = useMemo(() => ({
    January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
    July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
  }), []);

  const parseUSLongDate = (text: string): Date | null => {
    if (!text || typeof text !== 'string') return null;
    
    // Clean up the input text
    const cleanText = text.trim();
    if (!cleanText) return null;
    
    // Try to handle different date formats
    try {
      // First try the US long format (e.g., "September 20, 2025")
      const match = cleanText.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
      if (match) {
        const monthName = match[1];
        const day = parseInt(match[2], 10);
        const year = parseInt(match[3], 10);
        
        // Case-insensitive month lookup
        const monthKey = Object.keys(MONTH_INDEX).find(key => 
          key.toLowerCase() === monthName.toLowerCase()
        );
        const month = monthKey ? MONTH_INDEX[monthKey] : undefined;
        
        // Validate parsed values
        if (month === undefined) {
          console.warn('Unknown month name:', monthName, 'in date:', text);
          // Try fallback parsing
          const fallback = new Date(cleanText);
          if (!isNaN(fallback.getTime())) {
            console.log('Fallback parsing succeeded for:', text);
            return fallback;
          }
          return null;
        }
        if (Number.isNaN(day) || day < 1 || day > 31) {
          console.warn('Invalid day:', day, 'in date:', text);
          return null;
        }
        if (Number.isNaN(year) || year < 1900 || year > 2100) {
          console.warn('Invalid year:', year, 'in date:', text);
          return null;
        }
        
        // Create date and validate it
        const date = new Date(year, month, day);
        if (isNaN(date.getTime())) {
          console.warn('Created invalid date object for:', text);
          return null;
        }
        
        // Double-check the date components match (e.g., February 30 would become March 2)
        if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
          console.warn('Date overflow detected for:', text, 'resulted in:', date.toDateString());
          return null;
        }
        
        return date;
      }
      
      // Fallback to standard Date constructor with better validation
      const fallback = new Date(cleanText);
      if (!isNaN(fallback.getTime()) && fallback.getFullYear() > 1900 && fallback.getFullYear() < 2100) {
        return fallback;
      }
      
      console.warn('Could not parse date:', text);
      return null;
    } catch (error) {
      console.error('Error parsing date:', text, error);
      return null;
    }
  };

  const [userBarangay, setUserBarangay] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('');

  // Danao City Hall default center coordinates (Poblacion, Danao City)
  const DANAO_CITY_HALL = useMemo(() => ({ latitude: 10.5218, longitude: 124.0285 }), []);

  const userAnchor = useMemo(() => {
    if (!userBarangay || typeof userBarangay !== 'string') return null;
    const clean = userBarangay.replace(/^(brgy\.?|barangay)\s*/i, '').trim().toLowerCase();
    if (!clean) return null;

    // Direct or lowercase match
    const matchKey = Object.keys(BARANGAY_ANCHORS).find(k => k.toLowerCase() === clean);
    if (matchKey) return BARANGAY_ANCHORS[matchKey];

    // Normalized match (ignoring hyphens and spaces, e.g. "Cogon Cruz" vs "Cogon-Cruz")
    const normalizedClean = clean.replace(/[-\s]+/g, '');
    const normalizedKey = Object.keys(BARANGAY_ANCHORS).find(
      k => k.toLowerCase().replace(/[-\s]+/g, '') === normalizedClean
    );
    if (normalizedKey) return BARANGAY_ANCHORS[normalizedKey];

    return BARANGAY_ANCHORS[userBarangay] || null;
  }, [userBarangay]);

  const userPinCoordinate = useMemo(() => {
    if (userAnchor && Number.isFinite(userAnchor.lat) && Number.isFinite(userAnchor.lng)) {
      return { latitude: userAnchor.lat, longitude: userAnchor.lng };
    }
    return null;
  }, [userAnchor]);

  const defaultMapCenter = useMemo(() => {
    if (userAnchor && Number.isFinite(userAnchor.lat) && Number.isFinite(userAnchor.lng)) {
      return { latitude: userAnchor.lat, longitude: userAnchor.lng };
    }
    return DANAO_CITY_HALL; // Center to Danao City Hall if unknown
  }, [userAnchor, DANAO_CITY_HALL]);

  // Subscribe to user profile to get realtime barangay updates
  useEffect(() => {
    if (!db || !user?.uid) return;
    const unsubUser = onSnapshot(doc(db, 'users', user.uid), (docSnap: any) => {
      if (docSnap.exists()) {
        const uData = docSnap.data();
        setUserBarangay(uData.barangay || '');
        const uRole = (uData.role || '').toLowerCase().trim();
        setUserRole(uRole);
        IncomingCollectionService.setUserRole(user.uid, uRole);
        residentNotificationService.setUserRole(uRole);
      }
    }, (error: any) => {
      console.error('Error listening to user profile:', error);
    });
    
    return () => unsubUser();
  }, [user]);

  useEffect(() => {
    if (!user?.uid || !db) return;
    getDoc(doc(db, 'user_settings', user.uid)).then(snapshot => {
      const preferences = snapshot.data()?.notificationPreferences;
      setPickupRemindersEnabled(preferences?.pushEnabled !== false && preferences?.pickupReminders !== false);
    }).catch(() => setPickupRemindersEnabled(false));
  }, [user?.uid]);

  // Citizen Notifications Modal & Unread Count State
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = residentNotificationService.subscribe(user.uid, (count) => {
      setUnreadNotifCount(count);
    });
    return () => unsub();
  }, [user?.uid]);

  // Realtime Incoming Collection Alert State
  const [incomingTruckState, setIncomingTruckState] = useState<IncomingCollectionState | null>(null);

  useEffect(() => {
    if (!user?.uid || !userBarangay) {
      setIncomingTruckState(null);
      return;
    }

    if (userRole === 'driver' || userRole === 'cenro' || userRole === 'cicto' || userRole === 'coordinator') {
      setIncomingTruckState(null);
      return;
    }

    const residentCoord = userPinCoordinate || (userBarangay ? getBarangayCoordinates(userBarangay) : undefined);

    const unsub = IncomingCollectionService.subscribeToResidentIncomingTruck(
      user.uid,
      userBarangay,
      (state) => {
        setIncomingTruckState(state);
      },
      residentCoord,
      userRole
    );

    return () => unsub();
  }, [user?.uid, userBarangay, userPinCoordinate, userRole]);

  useEffect(() => {
    if (!rawSchedules.length) return;
    if (pickupRemindersEnabled) rawSchedules.forEach(schedule => ScheduleNotificationService.upsertScheduleNotifications(schedule));
    else ScheduleNotificationService.cancelScheduleNotifications(rawSchedules.map(schedule => schedule.id));
  }, [pickupRemindersEnabled, rawSchedules]);

  // Subscribe to schedules based on user's current barangay
  useEffect(() => {
    if (!db) return;

    const unsub = onSnapshot(collection(db, 'barangay_schedules'), (snap) => {
      const rows: any[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        // Filter schedules matching the user's selected barangay (prefix- and case-tolerant)
        const cleanUser = (userBarangay || '').toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim();
        const cleanDoc = (data.barangayName || '').toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim();
        if (cleanUser && (cleanDoc === cleanUser || data.barangayName === userBarangay)) {
          rows.push({ id: doc.id, ...data });
        }
      });
      setRawSchedules(rows);
    });

    // Subscribe to live truck locations and record movement trails
    const unsubTrucks = onSnapshot(
      collection(db, 'truck_locations'),
      (snap) => {
        const trucks: any[] = [];
        setTruckTrails((prevTrails) => {
          const updatedTrails = { ...prevTrails };

          snap.forEach((docSnap) => {
            const data = docSnap.data();
            const latRaw =
              data.location?.latitude ??
              data.location?.lat ??
              data.lat ??
              data.latitude;
            const lngRaw =
              data.location?.longitude ??
              data.location?.lng ??
              data.lng ??
              data.longitude;
            const latitude = Number(latRaw);
            const longitude = Number(lngRaw);
            const lastUpdatedAt =
              data.lastUpdate?.toDate?.() || data.timestamp?.toDate?.() || null;

            const isInactive =
              data.status === 'inactive' ||
              data.status === 'completed' ||
              data.status === 'off_duty';

            if (
              !isInactive &&
              Number.isFinite(latitude) &&
              Number.isFinite(longitude) &&
              latitude !== 0 &&
              longitude !== 0
            ) {
              // Resident filter: Only show trucks serving user's registered barangay (prefix- and case-tolerant)
              const cleanName = (b?: string) => (b || '').toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').replace(/_(whole|original)/i, '').trim();
              const cleanUser = cleanName(userBarangay);
              if (cleanUser) {
                const assigned = cleanName(data.assignedBarangay);
                const target = cleanName(data.targetBarangay);
                const current = cleanName(data.barangay);
                const locationName = (data.locationName || '').toLowerCase();
                const routeName = (data.routeName || '').toLowerCase();

                const isServingUserBarangay =
                  assigned === cleanUser ||
                  target === cleanUser ||
                  current === cleanUser ||
                  (locationName.includes(cleanUser) && !locationName.includes(`from ${cleanUser}`)) ||
                  routeName.includes(cleanUser);

                if (!isServingUserBarangay) {
                  delete updatedTrails[docSnap.id];
                  return;
                }
              }

              const currentCoord = { latitude, longitude };
              const resolvedPlate = resolveTruckDisplayName(data, 'Collection Truck');
              trucks.push({
                id: docSnap.id,
                ...data,
                truckPlate: resolvedPlate,
                plateNumber: resolvedPlate,
                plate: resolvedPlate,
                location: currentCoord,
                lastUpdatedAt,
                isStale:
                  !lastUpdatedAt || Date.now() - lastUpdatedAt.getTime() > 180000,
              });

              // If the document has a backend recentTrail, use it
              if (Array.isArray(data.recentTrail) && data.recentTrail.length > 0) {
                updatedTrails[docSnap.id] = data.recentTrail.map((p: any) => ({
                  latitude: Number(p.latitude ?? p.lat),
                  longitude: Number(p.longitude ?? p.lng),
                }));
              } else {
                // Otherwise append locally
                const existing = updatedTrails[docSnap.id] || [];
                if (existing.length === 0) {
                  updatedTrails[docSnap.id] = [currentCoord];
                } else {
                  const last = existing[existing.length - 1];
                  const dist = Math.hypot(
                    last.latitude - currentCoord.latitude,
                    last.longitude - currentCoord.longitude
                  );
                  if (dist > 0.00005) {
                    updatedTrails[docSnap.id] = [
                      ...existing,
                      currentCoord,
                    ].slice(-40);
                  }
                }
              }
            } else {
              delete updatedTrails[docSnap.id];
            }
          });

          // Clean up trails for any trucks that are no longer active/valid for this resident
          const validIds = new Set(trucks.map((t) => t.id));
          Object.keys(updatedTrails).forEach((id) => {
            if (!validIds.has(id)) {
              delete updatedTrails[id];
            }
          });

          return updatedTrails;
        });

        const liveSim = locationService.getSimulationState();
        if (liveSim?.isActive && liveSim.currentCoordinate) {
          const simId = liveSim.driverId || 'active_sim_truck';
          const simBarangay = (liveSim.barangay || '').trim();
          const isServing = !userBarangay || !simBarangay || simBarangay.toLowerCase() === userBarangay.trim().toLowerCase();
          if (isServing) {
            const simPlate = resolveTruckDisplayName(liveSim, 'ABB-1235');
            const simTruck = {
              id: simId,
              driverId: liveSim.driverId,
              driverName: liveSim.driverId ? 'Assigned Driver' : 'Collection Truck',
              truckPlate: simPlate,
              plateNumber: simPlate,
              location: liveSim.currentCoordinate,
              lat: liveSim.currentCoordinate.latitude,
              lng: liveSim.currentCoordinate.longitude,
              speedKph: liveSim.currentSpeedKph,
              heading: 0,
              status: 'active',
              barangay: liveSim.barangay,
              locationName: liveSim.locationName,
              isSimulation: true,
              isSimulated: true,
              remainingDurationSeconds: liveSim.remainingDurationSeconds,
              isStale: false,
              lastUpdatedAt: new Date(),
            };
            const others = trucks.filter((t) => t.id !== simId && t.driverId !== liveSim.driverId);
            setTruckLocations([simTruck, ...others]);
            return;
          }
        }
        setTruckLocations(trucks);
      },
      (err) => {
        if (err?.code !== 'permission-denied') {
          console.warn('schedule.tsx truck_locations listener error:', err);
        }
      }
    );

    return () => {
      unsub();
      unsubTrucks();
    };
  }, [userBarangay]);

  // Fetch road-snapped route polyline for the resident's barangay
  useEffect(() => {
    let isCancelled = false;
    if (!userBarangay) {
      setBarangayRouteCoords([]);
      return;
    }
    getRoadPolylineForBarangay(userBarangay)
      .then((poly) => {
        if (!isCancelled && poly && poly.length > 1) {
          setBarangayRouteCoords(poly);
        }
      })
      .catch((err) => {
        console.warn('schedule.tsx: getRoadPolylineForBarangay error:', err);
      });
    return () => {
      isCancelled = true;
    };
  }, [userBarangay]);

  // Listen to live local simulation engine as well
  useEffect(() => {
    return locationService.onSimulationChange((simState) => {
      const simId = simState.driverId || 'active_sim_truck';

      if (!simState.isActive) {
        setTruckLocations((current) => current.filter((t) => !t.isSimulation && !t.isSimulated && t.id !== simId && t.driverId !== simState.driverId));
        setTruckTrails((prev) => {
          if (!prev[simId]) return prev;
          const updated = { ...prev };
          delete updated[simId];
          return updated;
        });
        return;
      }

      if (simState.isActive && simState.currentCoordinate) {
        const simCoord = simState.currentCoordinate;
        const simBarangay = (simState.barangay || '').trim();

        // If resident has a registered barangay, filter local simulation to match
        if (userBarangay && simBarangay && simBarangay.toLowerCase() !== userBarangay.trim().toLowerCase()) {
          setTruckLocations((current) => current.filter((t) => t.id !== simId && t.driverId !== simState.driverId));
          setTruckTrails((prev) => {
            if (!prev[simId]) return prev;
            const updated = { ...prev };
            delete updated[simId];
            return updated;
          });
          return;
        }

        setTruckLocations((current) => {
          const simPlate = resolveTruckDisplayName(simState, 'ABB-1235');
          const simTruck = {
            id: simId,
            driverId: simState.driverId,
            driverName: simState.driverId ? 'Assigned Driver' : 'Collection Truck',
            truckPlate: simPlate,
            plateNumber: simPlate,
            location: simCoord,
            lat: simCoord.latitude,
            lng: simCoord.longitude,
            speedKph: simState.currentSpeedKph,
            heading: 0,
            status: 'active',
            barangay: simState.barangay,
            locationName: simState.locationName,
            isSimulation: true,
            isSimulated: true,
            remainingDurationSeconds: simState.remainingDurationSeconds,
            isStale: false,
            lastUpdatedAt: new Date(),
          };
          const others = current.filter((t) => t.id !== simTruck.id && t.driverId !== simTruck.driverId);
          return [simTruck, ...others];
        });

        if (simCoord) {
          setTruckTrails((prev) => {
            const existing = prev[simId] || [];
            const last = existing[existing.length - 1];
            if (
              !last ||
              Math.hypot(
                last.latitude - simState.currentCoordinate!.latitude,
                last.longitude - simState.currentCoordinate!.longitude
              ) > 0.00005
            ) {
              return {
                ...prev,
                [simId]: [...existing, simState.currentCoordinate!].slice(-40),
              };
            }
            return prev;
          });
        }
      } else if (!simState.isActive) {
        setTruckLocations((current) => current.filter((t) => t.id !== simId));
        setTruckTrails((prev) => {
          if (!prev[simId]) return prev;
          const updated = { ...prev };
          delete updated[simId];
          return updated;
        });
      }
    });
  }, [userBarangay]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTruckLocations(current => current.map(truck => ({
        ...truck,
        isStale: !truck.lastUpdatedAt || Date.now() - truck.lastUpdatedAt.getTime() > 120000,
      })));
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Expand recurring schedules for current month
  useEffect(() => {
    const mapping: Record<string, any[]> = {};
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysIn = (new Date(year, month + 1, 0)).getDate();
    
    const DOW_MAP = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    for (let d = 1; d <= daysIn; d++) {
      const date = new Date(year, month, d);
      const dowStr = DOW_MAP[date.getDay()];
      const key = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`;
      
      const daySchedules: any[] = [];

      rawSchedules.forEach(s => {
        // 1. Check if recurring day matches
        let isMatch = s.days && s.days.includes(dowStr);
        let category = s.wasteCategory;
        let time = (s.dayTimes && s.dayTimes[dowStr]) || s.time || s.timeText || s.collectionTime || '06:00 AM';

        // 2. Check if a specific schedule was added for this date
        const specificMatches = (s.specificSchedules || []).filter((ss: any) => {
          if (!ss.date) return false;
          // Simplistic match: if ss.date is YYYY-MM-DD or MM/DD matching this date
          const mmdd = `${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getDate().toString().padStart(2,'0')}`;
          const yyyymmdd = key;
          
          // Also try to match "Month DD" e.g., "July 20"
          const monthNames = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"];
          const monthName = monthNames[date.getMonth()];
          const shortMonthName = monthName.substring(0, 3);
          const monthDD = `${monthName} ${date.getDate()}`;
          const shortMonthDD = `${shortMonthName} ${date.getDate()}`;

          const dText = ss.date.trim().toLowerCase();
          
          return dText === mmdd.toLowerCase() || 
                 dText === yyyymmdd.toLowerCase() || 
                 dText === monthDD.toLowerCase() || 
                 dText === shortMonthDD.toLowerCase();
        });

        const isDoneForDate = (s as any).status === 'completed' || completedSchedules.some((cs) => {
          const csNorm = (cs.barangay || cs.barangayName || '').toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim();
          const sNorm = (s.barangayName || s.barangay || '').toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim();
          if (csNorm !== sNorm) return false;
          const compDate = cs.completedAt?.toDate ? cs.completedAt.toDate() : cs.completedAt ? new Date(cs.completedAt) : null;
          if (compDate) {
            const compKey = `${compDate.getFullYear()}-${(compDate.getMonth() + 1).toString().padStart(2, '0')}-${compDate.getDate().toString().padStart(2, '0')}`;
            return compKey === key;
          }
          return false;
        });

        if (specificMatches.length > 0) {
          // Push every specific schedule that lands on this day
          specificMatches.forEach((match: any) => {
            daySchedules.push({
              ...s,
              status: isDoneForDate ? 'completed' : ((s as any).status || 'scheduled'),
              wasteCategory: match.category || category,
              timeText: match.time || time,
              dateText: date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            });
          });
        } else if (isMatch) {
          // Fallback to recurring schedule if it falls on this day
          daySchedules.push({
            ...s,
            status: isDoneForDate ? 'completed' : ((s as any).status || 'scheduled'),
            wasteCategory: category,
            timeText: time,
            dateText: date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
          });
        }
      });

      if (daySchedules.length > 0) {
        mapping[key] = daySchedules;
      }
    }
    setMonthScheduleDates(mapping);
  }, [currentMonth, rawSchedules]);

  const resolveTruckDisplay = (s: any) => {
    const isCompleted = (s as any).status && (s as any).status.toLowerCase() === 'completed';
    let truckName = (s.truck && s.truck.trim()) ? s.truck : '';
    if (!truckName && s.truckPlate) truckName = `Truck ${s.truckPlate}`;
    if (!truckName && s.assignedTruckPlate) truckName = `Truck ${s.assignedTruckPlate}`;
    
    // Check trucks list for this barangay
    if (!truckName) {
      const bNorm = (s.barangayName || s.barangay || '').toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim();
      const matchedTruck = trucksList.find(t => {
        const tBrgy = (t.assignedBarangay || t.barangay || '').toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim();
        return tBrgy === bNorm || (s.assignedDriverId && t.assignedDriverId === s.assignedDriverId);
      });
      if (matchedTruck?.plateNumber) {
        truckName = `Truck ${matchedTruck.plateNumber}`;
      }
    }

    if (!truckName && s.assignedDriverName) {
      truckName = `Driver: ${s.assignedDriverName}`;
    }

    if (!truckName) {
      truckName = isCompleted ? 'Completed' : 'Pending Truck';
    } else if (s.assignedDriverName && !truckName.includes(s.assignedDriverName)) {
      truckName = `${truckName} (${s.assignedDriverName})`;
    }

    if (isCompleted) {
      return `${truckName} • Collection Finished`;
    }
    return truckName;
  };

  const markedDates = useMemo(() => {
    const dates: any = {};
    
    // Add schedule markers
    Object.keys(monthScheduleDates).forEach(key => {
      const items = monthScheduleDates[key];
      if (items.length > 0) {
        const allCompleted = items.every((it: any) => (it.status || '').toLowerCase() === 'completed');
        
        // Get unique waste category colors for this day
        const uniqueCategories = [...new Set(items.map((it: any) => it.wasteCategory))];
        const categoryColors = uniqueCategories.map(cat => CATEGORY_COLORS[cat] || colors.primary);
        
        if (allCompleted) {
          dates[key] = {
            customStyles: {
              container: {
                backgroundColor: '#F1F5F9',
                borderWidth: 1,
                borderColor: '#E2E8F0',
                borderRadius: 8,
              },
              text: {
                color: '#94A3B8',
                fontWeight: '700'
              }
            }
          };
        } else if (categoryColors.length === 1) {
          // Single waste type — fill the cell
          dates[key] = {
            customStyles: {
              container: {
                backgroundColor: categoryColors[0],
                borderRadius: 8,
              },
              text: {
                color: '#FFFFFF',
                fontWeight: '700'
              }
            }
          };
        } else {
          // Multiple waste types — use native-compatible borders to show multiple colors
          // Base background is the first color, a thick bottom border is the second color.
          // If there's a third, we add a left border.
          const c1 = categoryColors[0];
          const c2 = categoryColors[1];
          const c3 = categoryColors[2] || categoryColors[1]; // fallback to c2 if only 2

          dates[key] = {
            customStyles: {
              container: {
                backgroundColor: c1,
                borderWidth: categoryColors.length >= 2 ? 3 : 0,
                borderColor: c2,
                borderRadius: 8,
              },
              text: {
                color: '#FFFFFF',
                fontWeight: '700'
              }
            }
          };
        }
      }
    });

    // Add selected date marker
    if (selectedDate) {
      const selKey = `${selectedDate.getFullYear()}-${(selectedDate.getMonth()+1).toString().padStart(2,'0')}-${selectedDate.getDate().toString().padStart(2,'0')}`;
      
      if (dates[selKey]) {
        // preserve the schedule color but add a border for selection
        dates[selKey] = {
          ...dates[selKey],
          customStyles: {
            ...dates[selKey].customStyles,
            container: {
              ...dates[selKey].customStyles?.container,
              borderWidth: 2,
              borderColor: colors.primary,
            },
            text: {
              ...dates[selKey].customStyles?.text,
              color: '#FFFFFF',
            }
          }
        };
      } else {
        // empty day selected
        dates[selKey] = {
          customStyles: {
            container: {
              borderWidth: 2,
              borderColor: colors.primary,
              backgroundColor: 'transparent',
              borderRadius: 8,
            },
            text: {
              color: colors.textPrimary,
              fontWeight: '700'
            }
          }
        };
      }
    }

    return dates;
  }, [monthScheduleDates, selectedDate, CATEGORY_COLORS, colors]);

  const isDark = theme === 'dark';

  const mappedTrucks: MapTruck[] = useMemo(() => {
    if (truckLocations.length === 0) {
      return [];
    }
    return truckLocations
      .map((truck) => {
        const lat = Number(truck.location?.latitude);
        const lng = Number(truck.location?.longitude);
        const isStale = Boolean(truck.isStale);
        const speed = truck.speedKph
          ? Math.round(truck.speedKph)
          : truck.speed
          ? Math.round(truck.speed * 3.6)
          : 0;

        return {
          id: truck.id,
          latitude: lat,
          longitude: lng,
          plateNumber:
            truck.plateNumber ||
            truck.truckPlate ||
            truck.currentTruckPlate ||
            truck.truckNumber ||
            truck.plate ||
            truck.truckId ||
            'Collection Truck',
          driverName: truck.driverName,
          speedKph: speed,
          isStale,
          locationName: truck.locationName,
        };
      })
      .filter((t) => Number.isFinite(t.latitude) && Number.isFinite(t.longitude) && t.latitude !== 0);
  }, [truckLocations]);

  const mappedPolylines: MapPolyline[] = useMemo(() => {
    const list: MapPolyline[] = [];

    // Official road collection route passing through pickup points
    if (barangayRouteCoords.length > 1) {
      list.push({
        id: `route_${userBarangay || 'sector'}`,
        coordinates: barangayRouteCoords,
        strokeColor: '#10B981',
        strokeWidth: 3.5,
        isDashed: false,
      });
    }

    // Live truck movement trails
    Object.entries(truckTrails).forEach(([truckId, trailCoords]) => {
      const validCoords = (trailCoords || []).filter(
        (c) => c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
      );
      if (validCoords.length > 1) {
        list.push({
          id: truckId,
          coordinates: validCoords,
          strokeColor: '#059669',
          strokeWidth: 4,
          isDashed: true,
        });
      }
    });

    return list;
  }, [truckTrails, barangayRouteCoords, userBarangay]);

  // Designated Garbage Collection Pickup Points for resident's barangay
  const residentPickupStops: MapStop[] = useMemo(() => {
    if (!userBarangay) return [];

    // 1. Check if raw schedules have custom defined stops
    const explicitStops: MapStop[] = [];
    rawSchedules.forEach((s) => {
      if (Array.isArray((s as any).stops) && (s as any).stops.length > 0) {
        (s as any).stops.forEach((st: any, idx: number) => {
          const lat = Number(st.latitude ?? st.lat);
          const lng = Number(st.longitude ?? st.lng);
          if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
            explicitStops.push({
              id: st.id || `${s.id}_stop_${idx + 1}`,
              latitude: lat,
              longitude: lng,
              title: st.name || st.title || `Pickup Point ${idx + 1}`,
              subtitle: `${s.wasteCategory || 'Collection'} • ${s.time || s.collectionTime || 'Scheduled'}`,
              orderNumber: idx + 1,
              selected: selectedStopId === (st.id || `${s.id}_stop_${idx + 1}`),
            });
          }
        });
      }
    });

    if (explicitStops.length > 0) {
      return explicitStops;
    }

    // 2. Curated Danao City barangay route waypoints & pickup points
    const waypoints = getBarangaySimulationRoute(userBarangay);
    return waypoints
      .filter((w) => !w.name?.includes('CENRO Municipal') && !w.name?.includes('Transfer Station'))
      .map((w, idx) => {
        const stopId = `pickup_${userBarangay}_${idx + 1}`;
        const matchedSched = rawSchedules[idx % Math.max(1, rawSchedules.length)];
        const category = matchedSched?.wasteCategory || 'Scheduled Waste';
        const time = matchedSched?.time || matchedSched?.collectionTime || '06:00 AM';
        return {
          id: stopId,
          latitude: w.latitude,
          longitude: w.longitude,
          title: w.name || `Pickup Point #${idx + 1}`,
          subtitle: `${category} • ${time}`,
          orderNumber: idx + 1,
          selected: selectedStopId === stopId,
        };
      });
  }, [userBarangay, rawSchedules, selectedStopId]);

  const selectedStop = useMemo(() => {
    if (!selectedStopId) return null;
    return residentPickupStops.find((s) => s.id === selectedStopId) || null;
  }, [selectedStopId, residentPickupStops]);

  // AI Arrival Prediction & ETA for resident's barangay
  const activeIncomingEta = useMemo(() => {
    if (!userBarangay || truckLocations.length === 0) return null;
    const targetCoord = userPinCoordinate || getBarangayCoordinates(userBarangay);

    // Pick the truck closest to the resident / barangay that is not stale
    let primaryTruck: any = null;
    let closestDist = Infinity;
    truckLocations.forEach((t) => {
      const lat = Number(t.lat ?? t.latitude ?? t.location?.latitude ?? t.location?.lat);
      const lng = Number(t.lng ?? t.longitude ?? t.location?.longitude ?? t.location?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
        const d = haversineMeters({ latitude: lat, longitude: lng }, targetCoord);
        if (d < closestDist) {
          closestDist = d;
          primaryTruck = t;
        }
      }
    });

    if (!primaryTruck) return null;

    const lat = Number(primaryTruck.lat ?? primaryTruck.latitude ?? primaryTruck.location?.latitude ?? primaryTruck.location?.lat);
    const lng = Number(primaryTruck.lng ?? primaryTruck.longitude ?? primaryTruck.location?.longitude ?? primaryTruck.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;

    const { distanceMeters, aiEtaMinutes } = calculateAiEtaMinutes(
      { latitude: lat, longitude: lng },
      targetCoord,
      primaryTruck.speedKph || (primaryTruck.speed ? primaryTruck.speed * 3.6 : undefined),
      primaryTruck.remainingDurationSeconds
    );

    const isNearby = distanceMeters <= 600 || aiEtaMinutes <= 8;
    return {
      aiEtaMinutes,
      distanceMeters,
      isNearby,
      plate: primaryTruck.plateNumber || primaryTruck.plate || (primaryTruck as any).truckPlate || 'ABB-1235',
      speedKph: primaryTruck.speedKph || (primaryTruck.speed ? primaryTruck.speed * 3.6 : undefined),
    };
  }, [truckLocations, userBarangay, userPinCoordinate]);

  const activeTruckAlert = useMemo(() => {
    // If activeIncomingEta is computed from live truck locations, use it directly so top card & map tracker are 100% in sync
    if (activeIncomingEta) {
      return {
        isNearby: activeIncomingEta.isNearby,
        aiEtaMinutes: activeIncomingEta.aiEtaMinutes,
        plate: activeIncomingEta.plate,
        speedKph: activeIncomingEta.speedKph,
        distanceMeters: activeIncomingEta.distanceMeters,
      };
    }

    if (incomingTruckState?.hasActiveTruck && incomingTruckState.activeTruck) {
      return {
        isNearby: incomingTruckState.isNearby,
        aiEtaMinutes: incomingTruckState.aiEtaMinutes,
        plate: incomingTruckState.activeTruck.plate,
        speedKph: incomingTruckState.activeTruck.speedKph,
        distanceMeters: incomingTruckState.distanceMeters,
      };
    }

    return null;
  }, [incomingTruckState, activeIncomingEta]);

  // Proactively dispatch proximity notification whenever truck is nearby
  useEffect(() => {
    if (!user?.uid || !userBarangay) return;
    // Guard against driver or staff roles receiving citizen arrival notifications
    if (userRole === 'driver' || userRole === 'cenro' || userRole === 'cicto' || userRole === 'coordinator') return;

    const isNearby = Boolean(activeTruckAlert?.isNearby);
    if (!isNearby) return;

    const primaryTruck = truckLocations.find((t) => !t.isStale) || truckLocations[0];
    if (!primaryTruck && !incomingTruckState?.activeTruck) return;

    const truckToEvaluate = primaryTruck || {
      id: incomingTruckState?.activeTruck?.id || 'truck_1',
      plate: incomingTruckState?.activeTruck?.plate,
      plateNumber: incomingTruckState?.activeTruck?.plate,
      driverId: incomingTruckState?.activeTruck?.driverId,
      lat: incomingTruckState?.activeTruck?.currentCoord?.latitude,
      lng: incomingTruckState?.activeTruck?.currentCoord?.longitude,
      speedKph: incomingTruckState?.activeTruck?.speedKph,
    };

    if (truckToEvaluate.driverId === user.uid) return;

    const residentCoord = userPinCoordinate || getBarangayCoordinates(userBarangay);
    IncomingCollectionService.evaluateAndAlertResident({
      userId: user.uid,
      userBarangay,
      userRole,
      truck: truckToEvaluate,
      customResidentCoord: residentCoord,
    }).catch((err) => {
      console.warn('schedule.tsx proximity alert evaluation error:', err);
    });
  }, [user?.uid, userBarangay, userRole, activeTruckAlert?.isNearby, truckLocations, userPinCoordinate]);

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.contentContainer, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}
    >
      {/* Header */}
      <View style={[
        styles.header, 
        { 
          backgroundColor: colors.primary, 
          paddingTop: Math.max(insets.top, 20),
          height: undefined,
          minHeight: 90
        }
      ]}> 
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Schedule Pickups</Text>
          <TouchableOpacity
            style={styles.headerBellBtn}
            onPress={() => setShowNotificationsModal(true)}
            activeOpacity={0.8}
            accessibilityLabel="Notifications"
          >
            <MaterialIcons name="notifications-none" size={24} color="#2E7D32" />
            {unreadNotifCount > 0 && (
              <View style={styles.headerBellBadge}>
                <Text style={styles.headerBellBadgeText}>
                  {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Real-Time AI Incoming Truck Collection Alert */}
      {activeTruckAlert && (
        <View style={styles.incomingTruckCardContainer}>
          <TouchableOpacity
            style={styles.incomingTruckCard}
            activeOpacity={0.88}
            onPress={() => setShowMapZoom(true)}
          >
            <LinearGradient
              colors={activeTruckAlert.isNearby ? ['#047857', '#059669', '#10B981'] : ['#0F766E', '#0D9488', '#14B8A6']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.incomingTruckGradient}
            >
              <View style={styles.incomingTruckHeader}>
                <View style={styles.incomingTruckBadgeRow}>
                  <View style={styles.livePulseDot} />
                  <Text style={styles.incomingTruckBadgeText}>
                    {activeTruckAlert.isNearby ? 'COLLECTION NEARBY' : 'AI ARRIVAL PREDICTION'}
                  </Text>
                </View>
                <View style={styles.incomingEtaPill}>
                  <MaterialIcons name="schedule" size={13} color="#FFFFFF" />
                  <Text style={styles.incomingEtaPillText}>
                    ~{activeTruckAlert.aiEtaMinutes} MINS
                  </Text>
                </View>
              </View>

              <Text style={styles.incomingTruckMainText}>
                {activeTruckAlert.isNearby
                  ? `Garbage truck is nearby in your sector!`
                  : `Approaching Brgy. ${userBarangay || 'your area'} in ~${activeTruckAlert.aiEtaMinutes} mins`}
              </Text>

              <Text style={styles.incomingTruckSubText}>
                {activeTruckAlert.isNearby
                  ? `Truck ${activeTruckAlert.plate} is now collecting within your immediate sector (~${Math.round(activeTruckAlert.distanceMeters || 100)}m away). Please bring out your segregated bins now!`
                  : `Truck ${activeTruckAlert.plate} is en route${activeTruckAlert.speedKph ? ` (${Math.round(activeTruckAlert.speedKph)} km/h)` : ''}. Estimated distance: ~${Math.max(0.1, Math.round((activeTruckAlert.distanceMeters || 0) / 100) / 10)} km. Please prepare segregated bins!`}
              </Text>

              <View style={styles.incomingTruckActionRow}>
                <Text style={styles.incomingTruckActionText}>Track Live Location</Text>
                <MaterialIcons name="arrow-forward" size={16} color="#FFFFFF" />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Map Tracker (Moved to Top) */}
      <View style={[styles.mapCard, { backgroundColor: colors.surface }]}>
        <View style={styles.mapHeader}>
          <IconSymbol name="map" size={20} color={colors.primary} />
          <Text style={[styles.mapTitle, { color: colors.textPrimary }]}>
            Live Tracker{userBarangay ? ` • Brgy. ${userBarangay}` : ' (API)'}
          </Text>
        </View>
        <Text style={[styles.mapSubtitle, { color: colors.textSecondary }]}>
          {userBarangay
            ? `Tracking active collection trucks servicing Barangay ${userBarangay}.`
            : 'Track the current location of the trash collector in real-time.'}
        </Text>
        <TouchableOpacity style={styles.mapImageContainer} activeOpacity={0.9} onPress={() => setShowMapZoom(true)}>
          <ErrorBoundary
            fallback={
              <View style={[styles.mapImage, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#F3F4F6' }]}>
                <MaterialIcons name="map" size={32} color="#9CA3AF" />
                <Text style={{ color: '#6B7280', marginTop: 6, fontSize: 13, fontWeight: '500' }}>Live tracker unavailable</Text>
              </View>
            }
          >
            <OpenStreetMap
              key={`card_map_${userBarangay || 'hub'}`}
              style={styles.mapImage}
              initialCenter={defaultMapCenter}
              zoom={userAnchor ? 14 : 15}
              polylines={mappedPolylines}
              trucks={mappedTrucks}
              userCoordinate={userPinCoordinate}
              stops={residentPickupStops}
              isDark={isDark}
              interactive={false}
            />
          </ErrorBoundary>
          <View style={styles.mapOverlay} pointerEvents="none">
            {truckLocations.length > 0 ? (
              <>
                <View style={styles.liveIndicator}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
                {activeTruckAlert ? (
                  <View style={[styles.etaContainer, { backgroundColor: activeTruckAlert.isNearby ? '#ECFDF5' : '#FEF3C7', borderColor: activeTruckAlert.isNearby ? '#10B981' : '#F59E0B', borderWidth: 1 }]}>
                    <Text style={[styles.mapEtaText, { color: activeTruckAlert.isNearby ? '#065F46' : '#92400E', fontWeight: '800' }]}>
                      {activeTruckAlert.isNearby
                        ? `🔔 Truck Nearby (~${Math.max(50, Math.round((activeTruckAlert.distanceMeters || 100) / 50) * 50)}m)`
                        : `AI ETA: ~${activeTruckAlert.aiEtaMinutes} mins to Brgy. ${userBarangay}`}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.etaContainer}>
                    <Text style={styles.mapEtaText}>{truckLocations.filter(truck => !truck.isStale).length} live · {truckLocations.filter(truck => truck.isStale).length} stale</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={[styles.etaContainer, { backgroundColor: '#F3F4F6', opacity: 0.9 }]}>
                <Text style={[styles.mapEtaText, { color: '#4B5563' }]}>
                  {userBarangay ? `Standby for Brgy. ${userBarangay}` : 'Standby at Danao City Hall'}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Resident Pickup Points Bar */}
        {residentPickupStops.length > 0 && (
          <TouchableOpacity
            style={styles.mapPickupPointsBar}
            activeOpacity={0.8}
            onPress={() => setShowMapZoom(true)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="room" size={16} color="#059669" />
              <Text style={styles.mapPickupPointsText}>
                {residentPickupStops.length} Pickup Points in Brgy. {userBarangay}
              </Text>
            </View>
            <View style={styles.mapPickupPointsAction}>
              <Text style={styles.mapPickupPointsActionText}>View on Map</Text>
              <MaterialIcons name="chevron-right" size={16} color="#059669" />
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* API-backed calendar */}
      <View style={[styles.calendarCard, { backgroundColor: colors.surface, padding: 0, overflow: 'hidden' }]}> 
        <Calendar
          markingType={'custom'}
          markedDates={markedDates}
          onDayPress={(day: any) => {
            const parts = day.dateString.split('-');
            setSelectedDate(new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
          }}
          onMonthChange={(month: any) => {
            setCurrentMonth(new Date(month.year, month.month - 1, 1));
          }}
          theme={{
            backgroundColor: colors.surface,
            calendarBackground: colors.surface,
            textSectionTitleColor: colors.textSecondary,
            todayTextColor: colors.primary,
            dayTextColor: colors.textPrimary,
            textDisabledColor: '#d9e1e8',
            arrowColor: colors.primary,
            monthTextColor: colors.textPrimary,
            indicatorColor: colors.primary,
            textDayFontWeight: '500',
            textMonthFontWeight: 'bold',
            textDayHeaderFontWeight: '600',
            textDayFontSize: 14,
            textMonthFontSize: 16,
            textDayHeaderFontSize: 12
          }}
        />
      </View>

      {/* Legend Dropdown */}
      <View style={[styles.legendCard, { backgroundColor: colors.surface }]}>
        <TouchableOpacity 
          style={styles.legendHeader}
          onPress={() => setShowLegend(!showLegend)}
        >
          <Text style={[styles.legendTitle, { color: colors.textPrimary }]}>
            Waste Category Legend
          </Text>
          <IconSymbol 
            name={showLegend ? "chevron.up" : "chevron.down"} 
            size={20} 
            color={colors.textSecondary} 
          />
        </TouchableOpacity>
        
        {showLegend && (
          <View style={styles.legendContent}>
            {LEGEND_ITEMS.map((item, index) => (
              <View key={index} style={styles.legendItem}>
                <View style={[styles.legendColorBox, { backgroundColor: item.color }]} />
                <Text style={[styles.legendText, { color: colors.textPrimary }]}>
                  {item.name}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Pickup location info (API-backed) */}
      <View style={styles.infoSection}>
        <Text style={[styles.infoTitle, { color: colors.textSecondary }]}>Pickup Location Info</Text>

        {rawSchedules.length === 0 && userBarangay ? (
          <View
            style={[
              styles.noBarangayScheduleCard,
              {
                backgroundColor: isDark ? '#1E293B' : '#FEF3C7',
                borderColor: isDark ? '#334155' : '#FCD34D',
              },
            ]}
          >
            <MaterialIcons
              name="event-busy"
              size={24}
              color={isDark ? '#FBBF24' : '#D97706'}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.noBarangayScheduleTitle,
                  { color: isDark ? '#F8FAFC' : '#92400E' },
                ]}
              >
                Awaiting Schedule for Brgy. {userBarangay}
              </Text>
              <Text
                style={[
                  styles.noBarangayScheduleSubtitle,
                  { color: isDark ? '#CBD5E1' : '#B45309' },
                ]}
              >
                CENRO Danao has not yet published regular collection schedules
                for your barangay. Check back soon or contact CENRO for updates.
              </Text>
            </View>
          </View>
        ) : null}

        {selectedDate ? (
          (monthScheduleDates[`${selectedDate.getFullYear()}-${(selectedDate.getMonth()+1).toString().padStart(2,'0')}-${selectedDate.getDate().toString().padStart(2,'0')}`] || []).length > 0 ? (
            <>
              {(monthScheduleDates[`${selectedDate.getFullYear()}-${(selectedDate.getMonth()+1).toString().padStart(2,'0')}-${selectedDate.getDate().toString().padStart(2,'0')}`] || []).map((s, index) => {
                const wasteColor = s.wasteCategory ? (CATEGORY_COLORS[s.wasteCategory] || CATEGORY_COLORS[s.wasteCategory.toUpperCase()] || colors.primary) : colors.primary;
                return (
                  <TouchableOpacity 
                    key={`${s.id}-${index}`} 
                    style={[styles.pickupCard, { backgroundColor: colors.surface }, (s as any).status && (s as any).status.toLowerCase() === 'completed' ? { opacity: 0.55 } : null]}
                    onPress={() => handlePickupPress(s)}
                    activeOpacity={0.7}
                  > 
                    <View style={[styles.pickupColorBar, { backgroundColor: wasteColor }]} />
                    <View style={styles.pickupContent}>
                      <View style={styles.pickupHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.pickupCategory}>{s.wasteCategory || 'General Waste'}</Text>
                          {(s as any).status && (s as any).status.toLowerCase() === 'completed' && (
                            <View style={{ backgroundColor: '#DCFCE7', borderColor: '#86EFAC', borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                              <Text style={{ fontSize: 10, fontWeight: '800', color: '#166534' }}>✓ COMPLETED</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.pickupTime}>{s.timeText}</Text>
                      </View>
                      <View style={styles.pickupDetailsRow}>
                        <IconSymbol name="mappin.circle.fill" size={14} color="#6B7280" />
                        <Text style={styles.pickupLocationText}>
                          {s.streetName && s.streetName.toLowerCase() !== 'whole barangay' 
                            ? `${s.streetName}, ${s.barangayName}` 
                            : s.barangayName || 'Barangay'}
                        </Text>
                      </View>
                      <View style={styles.pickupDetailsRow}>
                        <IconSymbol name="car.fill" size={14} color={(s as any).status === 'completed' ? '#059669' : '#6B7280'} />
                        <Text style={[styles.pickupTruckText, (s as any).status === 'completed' ? { color: '#047857', fontWeight: '600' } : null]}>
                          {resolveTruckDisplay(s)}
                        </Text>
                      </View>
                    </View>
                    <View style={{ paddingRight: 16 }}>
                      <IconSymbol name="chevron.right" size={20} color="#9CA3AF" />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          ) : (
            <View style={[styles.emptyPickupCard, { backgroundColor: colors.surface }]}> 
              <IconSymbol name="info.circle" size={20} color="#9CA3AF" />
              <Text style={styles.infoText}>No pickups on {formatDate(selectedDate)}</Text>
            </View>
          )
        ) : (
          <View style={[styles.emptyPickupCard, { backgroundColor: colors.surface }]}> 
            <IconSymbol name="info.circle" size={20} color="#9CA3AF" />
            <Text style={styles.infoText}>Select a date to view pickups</Text>
          </View>
        )}
      </View>

      {/* Pickup Details Modal */}
      <PickupDetailsModal
        visible={showPickupModal}
        onClose={handleCloseModal}
        pickupData={selectedPickup}
      />

      {/* Fullscreen Map Modal */}
      <Modal visible={showMapZoom} transparent animationType="slide" onRequestClose={() => setShowMapZoom(false)}>
        <View style={styles.fullscreenMapContainer}>
          <ErrorBoundary
            fallback={
              <View style={[styles.fullscreenMapImage, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#F3F4F6' }]}>
                <MaterialIcons name="map" size={48} color="#9CA3AF" />
                <Text style={{ color: '#6B7280', marginTop: 12, fontSize: 15, fontWeight: '600' }}>Map tracker could not be loaded</Text>
              </View>
            }
          >
            <OpenStreetMap
              ref={fullscreenMapRef}
              key={`modal_map_${userBarangay || 'hub'}`}
              style={styles.fullscreenMapImage}
              initialCenter={defaultMapCenter}
              zoom={userAnchor ? 15 : 16}
              polylines={mappedPolylines}
              trucks={mappedTrucks}
              userCoordinate={userPinCoordinate}
              stops={residentPickupStops}
              onSelectStop={(id) => setSelectedStopId(id)}
              isDark={isDark}
              interactive={true}
              showZoomControl={false}
            />
          </ErrorBoundary>
          
          <TouchableOpacity 
            style={[styles.fullscreenMapClose, { top: Math.max(insets.top + 10, 48) }]} 
            onPress={() => setShowMapZoom(false)}
            activeOpacity={0.8}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <IconSymbol name="xmark.circle.fill" size={38} color="#1F2937" />
          </TouchableOpacity>
          
          <View style={[styles.fullscreenMapOverlay, { top: Math.max(insets.top + 10, 48) }]} pointerEvents="none">
            {truckLocations.length > 0 ? (
              <>
                <View style={styles.liveIndicator}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
                {activeTruckAlert ? (
                  <View style={[styles.etaContainer, { backgroundColor: activeTruckAlert.isNearby ? '#ECFDF5' : '#FEF3C7', borderColor: activeTruckAlert.isNearby ? '#10B981' : '#F59E0B', borderWidth: 1 }]}>
                    <Text style={[styles.mapEtaText, { color: activeTruckAlert.isNearby ? '#065F46' : '#92400E', fontWeight: '800' }]}>
                      {activeTruckAlert.isNearby
                        ? `🔔 Truck Nearby (~${Math.max(50, Math.round((activeTruckAlert.distanceMeters || 100) / 50) * 50)}m)`
                        : `AI ETA: ~${activeTruckAlert.aiEtaMinutes} mins to Brgy. ${userBarangay}`}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.etaContainer}>
                    <Text style={styles.mapEtaText}>{truckLocations.filter(truck => !truck.isStale).length} live · {truckLocations.filter(truck => truck.isStale).length} stale</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={[styles.etaContainer, { backgroundColor: '#F3F4F6', opacity: 0.9 }]}>
                <Text style={[styles.mapEtaText, { color: '#4B5563' }]}>
                  {userBarangay ? `Standby for Brgy. ${userBarangay}` : 'Standby at Danao City Hall'}
                </Text>
              </View>
            )}
          </View>

          {/* Floating Native Zoom Controls (+ / -) */}
          <View
            style={[
              styles.fullscreenZoomControls,
              {
                bottom: residentPickupStops.length > 0
                  ? (selectedStop ? 220 : 155)
                  : Math.max(insets.bottom, 14) + 25,
              },
            ]}
          >
            <TouchableOpacity
              style={styles.fullscreenZoomBtn}
              onPress={() => fullscreenMapRef.current?.zoomIn?.()}
              activeOpacity={0.7}
              accessibilityLabel="Zoom In"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <MaterialIcons name="add" size={24} color="#1F2937" />
            </TouchableOpacity>
            <View style={styles.fullscreenZoomDivider} />
            <TouchableOpacity
              style={styles.fullscreenZoomBtn}
              onPress={() => fullscreenMapRef.current?.zoomOut?.()}
              activeOpacity={0.7}
              accessibilityLabel="Zoom Out"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <MaterialIcons name="remove" size={24} color="#1F2937" />
            </TouchableOpacity>
          </View>

          {/* Fullscreen Map Pickup Points Bottom Sheet */}
          {residentPickupStops.length > 0 && (
            <View style={[styles.fullscreenPickupDrawer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
              <View style={styles.fullscreenPickupDrawerHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialIcons name="room" size={18} color="#059669" />
                  <Text style={styles.fullscreenPickupDrawerTitle}>
                    Pickup Points in Brgy. {userBarangay || 'Zone'} ({residentPickupStops.length})
                  </Text>
                </View>
                {selectedStop && (
                  <TouchableOpacity onPress={() => setSelectedStopId(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.fullscreenPickupClearText}>Deselect</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Stop Chips Carousel */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fullscreenPickupStrip}>
                {residentPickupStops.map((stop) => {
                  const isSel = selectedStopId === stop.id;
                  return (
                    <TouchableOpacity
                      key={stop.id}
                      style={[
                        styles.fullscreenStopChip,
                        isSel && styles.fullscreenStopChipActive,
                      ]}
                      onPress={() => setSelectedStopId(isSel ? null : stop.id)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.fullscreenStopChipBadge, isSel && styles.fullscreenStopChipBadgeActive]}>
                        <Text style={[styles.fullscreenStopChipBadgeText, isSel && styles.fullscreenStopChipBadgeTextActive]}>
                          #{stop.orderNumber}
                        </Text>
                      </View>
                      <Text style={[styles.fullscreenStopChipText, isSel && styles.fullscreenStopChipTextActive]} numberOfLines={1}>
                        {stop.title}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Selected Stop Details Card */}
              {selectedStop && (
                <View style={styles.fullscreenSelectedStopCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fullscreenSelectedStopTitle}>
                      #{selectedStop.orderNumber}. {selectedStop.title}
                    </Text>
                    <Text style={styles.fullscreenSelectedStopSubtitle}>
                      {selectedStop.subtitle}
                    </Text>
                  </View>
                  <View style={styles.fullscreenSelectedStopTag}>
                    <MaterialIcons name="check-circle" size={14} color="#059669" />
                    <Text style={styles.fullscreenSelectedStopTagText}>Designated Stop</Text>
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      </Modal>

      {/* Citizen In-App Notifications Modal with Driver Photo Proof */}
      <ResidentNotificationModal
        visible={showNotificationsModal}
        onClose={() => setShowNotificationsModal(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8F5E9',
  },
  contentContainer: {
    paddingBottom: 28,
  },
  header: {
    height: 90,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  headerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  heroCard: {
    marginTop: 16,
    marginHorizontal: 16,
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  calendarCard: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  calendarHeader: {
    marginBottom: 12,
  },
  calendarMonth: {
    fontWeight: '600',
  },
  weekdaysRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayCell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 4,
  },
  weekdayText: {
    fontSize: 12,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: `${100 / 7}%`,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDay: {
    color: '#333',
  },
  legendCard: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  legendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  legendTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  legendContent: {
    marginTop: 12,
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  legendColorBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 14,
    flex: 1,
  },
  fabAIBadge: {
    position: 'absolute',
    bottom: -18,
    left: 60,
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: 'white',
    fontWeight: '700',
  },
  infoSection: {
    marginTop: 32,
    marginHorizontal: 16,
    marginBottom: 40,
    gap: 12,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  pickupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 10,
  },
  pickupColorBar: {
    width: 8,
    alignSelf: 'stretch',
  },
  pickupContent: {
    flex: 1,
    padding: 14,
    gap: 6,
  },
  pickupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  pickupCategory: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
  },
  pickupTime: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2E8B57',
    backgroundColor: '#EAF6E8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  pickupDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pickupLocationText: {
    fontSize: 13,
    color: '#4B5563',
  },
  pickupTruckText: {
    fontSize: 13,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  emptyPickupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
  },
  infoText: {
    flex: 1,
    color: '#6B7280',
    fontSize: 14,
  },
  mapCard: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  mapTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  mapSubtitle: {
    fontSize: 14,
    marginBottom: 12,
  },
  mapImageContainer: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E2E8F0', // fallback color
  },
  mapImage: {
    width: '100%',
    height: '100%',
  },
  mapOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.9)', // Red background
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
  },
  liveText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  etaContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  mapEtaText: {
    color: '#333',
    fontSize: 13,
    fontWeight: '600',
  },
  zoomModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomModalClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  zoomScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomMapImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  fullscreenMapContainer: {
    flex: 1,
    backgroundColor: 'white',
    position: 'relative',
  },
  fullscreenMapImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  fullscreenMapClose: {
    position: 'absolute',
    right: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 2,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 6,
    zIndex: 20,
  },
  fullscreenMapOverlay: {
    position: 'absolute',
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  truckMarkerOuter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  truckMarkerHalo: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    opacity: 0.9,
  },
  truckMarkerShield: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 6,
  },
  truckMarkerPointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
  truckMarkerLabelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxWidth: 150,
  },
  truckMarkerLabelPillDark: {
    backgroundColor: 'rgba(30, 41, 59, 0.96)',
    borderColor: '#475569',
  },
  truckMarkerStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  truckMarkerLabelText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0F172A',
  },
  truckMarkerLabelTextDark: {
    color: '#F8FAFC',
  },
  hubMarker: {
    backgroundColor: '#4B5563',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  noBarangayScheduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  noBarangayScheduleTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    marginBottom: 2,
  },
  noBarangayScheduleSubtitle: {
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '500',
  },
  mapPickupPointsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  mapPickupPointsText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#065F46',
  },
  mapPickupPointsAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  mapPickupPointsActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  fullscreenPickupDrawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 10,
  },
  fullscreenPickupDrawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  fullscreenPickupDrawerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  fullscreenPickupClearText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
  },
  fullscreenPickupStrip: {
    gap: 8,
    paddingVertical: 4,
  },
  fullscreenStopChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxWidth: 220,
  },
  fullscreenStopChipActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  fullscreenStopChipBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenStopChipBadgeActive: {
    backgroundColor: '#FFFFFF',
  },
  fullscreenStopChipBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
  },
  fullscreenStopChipBadgeTextActive: {
    color: '#059669',
  },
  fullscreenStopChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  fullscreenStopChipTextActive: {
    color: '#FFFFFF',
  },
  fullscreenSelectedStopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#059669',
  },
  fullscreenSelectedStopTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  fullscreenSelectedStopSubtitle: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  fullscreenSelectedStopTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  fullscreenSelectedStopTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  fullscreenZoomControls: {
    position: 'absolute',
    right: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 25,
    overflow: 'hidden',
  },
  fullscreenZoomBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  fullscreenZoomDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  headerBellBtn: {
    position: 'relative',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  headerBellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#DC2626',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  headerBellBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },

  // Realtime Incoming Truck AI Prediction Card Styles
  incomingTruckCardContainer: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  incomingTruckCard: {
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  incomingTruckGradient: {
    padding: 16,
    borderRadius: 16,
  },
  incomingTruckHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  incomingTruckBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#A7F3D0',
  },
  incomingTruckBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  incomingEtaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  incomingEtaPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  incomingTruckMainText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 22,
    marginBottom: 4,
  },
  incomingTruckSubText: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  incomingTruckActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  incomingTruckActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});


