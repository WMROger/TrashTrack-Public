import { useAuthContext } from "@/components/AuthContext";
import { auth, db } from "@/config/firebase";
import { useTheme } from "@/hooks/useTheme";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CompletePickupModal from "@/components/driver/CompletePickupModal";
import DriveModeSelectModal from "@/components/driver/DriveModeSelectModal";
import EndShiftQrScannerModal from "@/components/driver/EndShiftQrScannerModal";
import ReportIssueModal from "@/components/driver/ReportIssueModal";
import StartShiftQrScannerModal from "@/components/driver/StartShiftQrScannerModal";
import StationaryCollectionPromptModal from "@/components/driver/StationaryCollectionPromptModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import OpenStreetMap, { OpenStreetMapRef } from "@/components/OpenStreetMap";
import { getBarangaySimulationRoute } from "@/constants/barangaySimulationRoutes";
import {
  autoAssignQueuedReportsOnDriverShiftStart,
  revertUncollectedReportsOnDriverShiftEnd,
} from "@/services/autoDispatchService";
import {
  getDriverShiftDieselRecommendation,
  ShiftDieselRecommendation,
} from "@/services/dieselRecommendationService";
import {
  clearDriverSessionOrigin,
  DriverSessionOrigin,
  getDriverSessionOrigin,
} from "@/services/driverQrService";
import { calculateShiftTiming } from "@/services/fleetInventoryQrService";
import {
  haversineMeters,
  IncomingCollectionService,
  isRawFirestoreIdOrUuid,
} from "@/services/incomingCollectionService";
import { locationService, SimulationState } from "@/services/locationService";
import { NotificationService } from "@/services/notificationService";
import { getRoadPolylineForBarangay } from "@/services/osrmRoutingService";
import { residentNotificationService } from "@/services/residentNotificationService";
import {
  DEFAULT_OVERRIDES,
  subscribeToSystemOverrides,
  SystemOverridesData,
} from "@/services/systemOverridesService";
import { announceEmergencyBroadcast } from "@/services/voiceAnnouncementService";


interface NextPickup {
  id: string;
  street: string;
  wasteCategory: string;
  timeText: string;
  dateText: string;
  status: string;
  isLiveDispatch?: boolean;
  routeOrder?: number;
  reportId?: string | null;
  scheduleId?: string;
  isExclusiveAssignment?: boolean;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
  latitude?: number;
  longitude?: number;
}

interface HistoryItem {
  id: string;
  street: string;
  wasteCategory: string;
  completedAt: any;
  status: string;
  completionImage?: string;
}

function formatMinutesSeconds(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.floor(Math.max(0, sec) % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function isDateMatching(
  itemDate: any,
  targetDate: Date,
  itemFullDate?: any,
): boolean {
  if (!itemDate && !itemFullDate) return false;

  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth() + 1; // 1-12
  const targetDay = targetDate.getDate(); // 1-31

  const targetMMDD = `${String(targetMonth).padStart(2, "0")}/${String(targetDay).padStart(2, "0")}`;
  const targetYYYYMMDD = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
  const targetLongStr = targetDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const cleanItemDate = String(itemDate || "").trim();
  const cleanFullDate = String(itemFullDate || "").trim();

  const now = new Date();
  const isTargetToday =
    targetDate.getDate() === now.getDate() &&
    targetDate.getMonth() === now.getMonth() &&
    targetDate.getFullYear() === now.getFullYear();

  const tmrw = new Date();
  tmrw.setDate(tmrw.getDate() + 1);
  const isTargetTomorrow =
    targetDate.getDate() === tmrw.getDate() &&
    targetDate.getMonth() === tmrw.getMonth() &&
    targetDate.getFullYear() === tmrw.getFullYear();

  if (
    isTargetToday &&
    (cleanItemDate.toLowerCase() === "today" ||
      cleanItemDate.toLowerCase() === "today's pickups")
  )
    return true;
  if (
    isTargetTomorrow &&
    (cleanItemDate.toLowerCase() === "tomorrow" ||
      cleanItemDate.toLowerCase() === "tomorrow's pickups")
  )
    return true;

  if (cleanFullDate && cleanFullDate === targetYYYYMMDD) return true;
  if (cleanItemDate === targetMMDD) return true;
  if (cleanItemDate === targetYYYYMMDD) return true;
  if (cleanItemDate.toLowerCase() === targetLongStr.toLowerCase()) return true;

  const targetMMDDYYYY = `${String(targetMonth).padStart(2, "0")}/${String(targetDay).padStart(2, "0")}/${targetYear}`;
  if (cleanItemDate === targetMMDDYYYY) return true;

  const normalizedItemDate = cleanItemDate.replace(/(\d+)(st|nd|rd|th)/i, '$1');
  const parsed = new Date(cleanFullDate || normalizedItemDate);
  if (!isNaN(parsed.getTime())) {
    if (
      parsed.getFullYear() === targetYear &&
      parsed.getMonth() + 1 === targetMonth &&
      parsed.getDate() === targetDay
    ) {
      return true;
    }
  }

  return false;
}

export function isDateToday(itemDate?: any, itemFullDate?: any): boolean {
  if (!itemDate && !itemFullDate) return true;
  const str = String(itemDate || "").trim().toLowerCase();
  if (str === "today" || str === "today's pickups" || str === "active sequence" || str === "asap") return true;
  if (str === "tomorrow" || str === "tomorrow's pickups") return false;
  return isDateMatching(itemDate, new Date(), itemFullDate);
}

export function isDateTomorrow(itemDate?: any, itemFullDate?: any): boolean {
  if (!itemDate && !itemFullDate) return false;
  const str = String(itemDate || "").trim().toLowerCase();
  if (str === "tomorrow" || str === "tomorrow's pickups") return true;
  if (str === "today" || str === "today's pickups") return false;
  const tmrw = new Date();
  tmrw.setDate(tmrw.getDate() + 1);
  return isDateMatching(itemDate, tmrw, itemFullDate);
}

const DOW_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DOW_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function isDayScheduled(daysList: string[] = [], dayIndex: number): boolean {
  if (!Array.isArray(daysList) || daysList.length === 0) return false;
  const shortName = DOW_SHORT[dayIndex];
  const fullName = DOW_FULL[dayIndex].toLowerCase();

  return daysList.some((d) => {
    const clean = String(d || "").trim().toUpperCase();
    return (
      clean === shortName ||
      clean.startsWith(shortName) ||
      clean.toLowerCase() === fullName
    );
  });
}

function getTimeForDay(schedData: any, dayIndex: number): string {
  const shortName = DOW_SHORT[dayIndex];
  if (
    schedData.dayTimes &&
    typeof schedData.dayTimes === "object" &&
    schedData.dayTimes[shortName]
  ) {
    return schedData.dayTimes[shortName];
  }
  return (
    schedData.time ||
    schedData.timeText ||
    schedData.collectionTime ||
    schedData.modalTimeStr ||
    "06:00 AM"
  );
}

export default function DriverIndex() {
  const router = useRouter();
  const { user } = useAuthContext();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const insets = useSafeAreaInsets();

  const [nextPickup, setNextPickup] = useState<NextPickup | null>(null);
  const [liveDispatches, setLiveDispatches] = useState<NextPickup[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isShiftActive, setIsShiftActive] = useState(false);
  const completedScheduleIdsRef = useRef<Set<string>>(new Set());
  const recomputePickupsRef = useRef<(() => void) | null>(null);
  const todayScheduleIdsRef = useRef<string[]>([]);

  // Modal states
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showEndShiftModal, setShowEndShiftModal] = useState(false);
  const [showEndShiftScannerModal, setShowEndShiftScannerModal] =
    useState(false);
  const [showStartShiftScannerModal, setShowStartShiftScannerModal] =
    useState(false);
  const [isStartingShift, setIsStartingShift] = useState(false);
  const [completedShiftSummary, setCompletedShiftSummary] = useState<{
    truckPlate: string;
    driverName: string;
    timeInFormatted: string;
    timeOutFormatted: string;
    durationFormatted: string;
  } | null>(null);
  const [isEndingShift, setIsEndingShift] = useState(false);
  const [showActiveShiftModal, setShowActiveShiftModal] = useState(false);
  const [selectedPickupId, setSelectedPickupId] = useState<string | null>(null);
  const [activeToastAlert, setActiveToastAlert] = useState<{
    id: string;
    title: string;
    message: string;
    type?: string;
    routeId?: string;
  } | null>(null);

  // Dwell / Stationary Stop Detection states (5-minute stop detection)
  const [showStationaryPrompt, setShowStationaryPrompt] = useState(false);
  const [stationaryPromptData, setStationaryPromptData] = useState<{
    latitude: number;
    longitude: number;
    locationName: string;
    nearestStop?: NextPickup | null;
    elapsedMinutes: number;
  } | null>(null);
  const [isMandatoryStopComplete, setIsMandatoryStopComplete] = useState(false);

  const stationaryAnchorRef = useRef<{
    latitude: number;
    longitude: number;
    startTime: number;
  } | null>(null);
  const trafficSnoozedUntilRef = useRef<number>(0);
  const hasPromptedForCurrentStopRef = useRef<boolean>(false);

  // Current truck assignment
  const [currentTruck, setCurrentTruck] = useState<{
    id: string;
    plateNumber: string;
    type: string;
    shiftStartedAt?: any;
    assignedDriverName?: string;
    driverName?: string;
  } | null>(null);

  const shiftTimingInfo = useMemo(() => {
    if (!currentTruck?.shiftStartedAt) return null;
    return calculateShiftTiming(currentTruck.shiftStartedAt);
  }, [currentTruck?.shiftStartedAt]);

  // Driver assigned barangay from Firestore
  const [assignedBarangay, setAssignedBarangay] = useState<string>("Poblacion");

  // GPS Simulation & Actual Driving state
  const [simulationState, setSimulationState] = useState<SimulationState>(
    locationService.getSimulationState(),
  );
  const [isActualDriving, setIsActualDriving] = useState<boolean>(
    locationService.isGpsTracking(),
  );
  const [actualTruckCoord, setActualTruckCoord] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [showDriveModeModal, setShowDriveModeModal] = useState<boolean>(false);
  const miniMapRef = useRef<OpenStreetMapRef>(null);

  // Shift AI Fuel Recommendation & Deferred Reports State
  const [shiftFuelRec, setShiftFuelRec] =
    useState<ShiftDieselRecommendation | null>(null);
  const [deferredReportsCount, setDeferredReportsCount] = useState(0);

  // Real-time CENRO System Overrides State
  const [systemOverrides, setSystemOverrides] =
    useState<SystemOverridesData>(DEFAULT_OVERRIDES);
  const [sessionOrigin, setSessionOrigin] =
    useState<DriverSessionOrigin>("login");

  useEffect(() => {
    getDriverSessionOrigin().then((o) => setSessionOrigin(o ?? "login"));
  }, []);

  useFocusEffect(
    useCallback(() => {
      getDriverSessionOrigin().then((o) => setSessionOrigin(o ?? "login"));
    }, [])
  );

  useEffect(() => {
    return subscribeToSystemOverrides((data) => {
      setSystemOverrides(data);
    });
  }, []);

  // Ensure driver role is registered to notification engines and dismiss any residual resident arrival alerts
  useEffect(() => {
    const activeUid = user?.uid || auth?.currentUser?.uid;
    if (activeUid) {
      IncomingCollectionService.setUserRole(activeUid, "driver");
      residentNotificationService.setUserRole("driver");
      NotificationService.dismissDriverProximityAlerts();
    }
  }, [user?.uid]);

  // Real-time listener for newly injected route waypoints and emergency CENRO directives
  useEffect(() => {
    const activeUid = user?.uid || auth?.currentUser?.uid;
    if (!activeUid || !db) return;

    const notifsRef = collection(db, "notifications");
    const qNotifs = query(
      notifsRef,
      where("userId", "==", activeUid),
      where("read", "==", false),
    );

    const unsub = onSnapshot(
      qNotifs,
      (snap) => {
        if (!snap.empty) {
          const relevantDoc = snap.docs.find((d) => {
            const t = d.data().type;
            return [
              "route_waypoint_added",
              "pickup_assigned",
              "emergency_override",
              "weather_warning",
              "weather_normal",
              "system_override",
              "fleet_backup",
              "fleet_standby",
              "surge_priority",
              "surge_normal",
            ].includes(t);
          });
          if (relevantDoc) {
            const data = relevantDoc.data();
            setActiveToastAlert({
              id: relevantDoc.id,
              title: data.title || "🚨 CENRO Dispatch Directive",
              message: data.message || "New directive from CENRO operations.",
              type: data.type || "system_override",
              routeId: data.routeId,
            });

            // Trigger vibration & audio notification for driver on shift
            try {
              if (Platform.OS !== "web") {
                Vibration.vibrate([0, 500, 200, 500]);
                Notifications.scheduleNotificationAsync({
                  content: {
                    title: data.title || "🚨 New Pickup Added to Route",
                    body: data.message || "A new collection report has been assigned to your route.",
                    sound: "default",
                    data: { ...data },
                  },
                  trigger: null,
                }).catch(() => {});
              }
            } catch (notifyErr) {
              console.warn("Driver alert trigger error:", notifyErr);
            }
          }
        }
      },
      (error) => {
        if (error?.code !== "permission-denied") {
          console.warn("DriverIndex: notifs listener error:", error);
        }
      },
    );

    return () => unsub();
  }, [user?.uid]);

  // Auto-dismiss transient toast alerts after 6 seconds
  useEffect(() => {
    if (!activeToastAlert) return;
    const timer = setTimeout(() => {
      if (db && activeToastAlert.id) {
        updateDoc(doc(db, "notifications", activeToastAlert.id), {
          read: true,
        }).catch(() => {});
      }
      setActiveToastAlert(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [activeToastAlert?.id]);

  // Listen for shift fuel recommendation
  useEffect(() => {
    const activeUid = user?.uid || auth?.currentUser?.uid;
    if (!activeUid || !currentTruck?.id || !assignedBarangay) {
      setShiftFuelRec(null);
      return;
    }

    let isMounted = true;
    getDriverShiftDieselRecommendation(
      activeUid,
      currentTruck.id,
      assignedBarangay,
    )
      .then((rec) => {
        if (isMounted) setShiftFuelRec(rec);
      })
      .catch((err) =>
        console.warn("DriverIndex: diesel recommendation fetch error:", err),
      );

    return () => {
      isMounted = false;
    };
  }, [user?.uid, currentTruck?.id, assignedBarangay]);

  // Real-time listener for reports deferred to next shift in this barangay
  useEffect(() => {
    if (!db || !assignedBarangay) return;
    const qDeferred = query(
      collection(db, "reports"),
      where("barangay", "==", assignedBarangay),
      where("queuedForNextShift", "==", true),
    );
    const unsub = onSnapshot(
      qDeferred,
      (snap) => {
        setDeferredReportsCount(snap.size);
      },
      () => {},
    );
    return () => unsub();
  }, [assignedBarangay]);

  // Barangay Simulation Route Points for Mini-Map
  const barangayRoutePoints = React.useMemo(() => {
    return getBarangaySimulationRoute(assignedBarangay).map((pt) => ({
      latitude: pt.latitude,
      longitude: pt.longitude,
    }));
  }, [assignedBarangay]);

  // Road-snapped geometry fetched from OSRM to curve realistically along Danao City streets
  const [roadSnappedPolyline, setRoadSnappedPolyline] = React.useState<
    { latitude: number; longitude: number }[]
  >([]);

  useEffect(() => {
    let isCancelled = false;
    getRoadPolylineForBarangay(assignedBarangay)
      .then((poly) => {
        if (!isCancelled && poly && poly.length > 1) {
          setRoadSnappedPolyline(poly);
        }
      })
      .catch((err) => {
        console.warn("DriverIndex: road polyline fetch error:", err);
      });
    return () => {
      isCancelled = true;
    };
  }, [assignedBarangay]);

  const activeMiniMapPolyline = React.useMemo(() => {
    if (
      simulationState.routePolyline &&
      simulationState.routePolyline.length > 1
    ) {
      return simulationState.routePolyline;
    }
    if (roadSnappedPolyline.length > 1) {
      return roadSnappedPolyline;
    }
    return [];
  }, [simulationState.routePolyline, roadSnappedPolyline]);

  // Fetch real phone GPS position on mount so current GPS location is immediately known
  useEffect(() => {
    let isCancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (
            !isCancelled &&
            loc?.coords &&
            Number.isFinite(loc.coords.latitude) &&
            Number.isFinite(loc.coords.longitude)
          ) {
            setActualTruckCoord(
              (prev) =>
                prev || {
                  latitude: loc.coords.latitude,
                  longitude: loc.coords.longitude,
                },
            );
          }
        }
      } catch (err) {
        // Fallback gracefully
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, []);

  // Real-time listener for physical GPS truck location when actual driving
  useEffect(() => {
    const activeUid = user?.uid || auth?.currentUser?.uid;
    if (!activeUid || !db) return;
    return onSnapshot(
      doc(db, "truck_locations", activeUid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (simulationState.isActive) {
            return;
          }
          if (data.status === "inactive" || data.status === "completed") {
            setActualTruckCoord(null);
            setIsActualDriving(false);
            return;
          }
          const lat = data.lat ?? data.location?.latitude;
          const lng = data.lng ?? data.location?.longitude;
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            setActualTruckCoord({
              latitude: Number(lat),
              longitude: Number(lng),
            });
          }
          const isSim = Boolean(data.isSimulation || data.isSimulated);
          const isLocalGpsTracking = locationService.isGpsTracking();
          if (data.status === "active" && !isSim && isLocalGpsTracking) {
            setIsActualDriving(true);
          } else {
            setIsActualDriving(false);
            if (
              data.status === "active" &&
              !isSim &&
              !isLocalGpsTracking &&
              !locationService.getSimulationState().isActive
            ) {
              setDoc(
                doc(db, "truck_locations", activeUid),
                {
                  status: "standby",
                  isBroadcasting: false,
                  lastUpdate: serverTimestamp(),
                },
                { merge: true },
              ).catch(() => {});
            }
          }
        } else {
          setActualTruckCoord(null);
          setIsActualDriving(false);
        }
      },
      (err) => {
        if (err?.code !== "permission-denied") {
          console.warn("DriverIndex: truck_locations listener error:", err);
        }
      },
    );
  }, [user?.uid, simulationState.isActive]);

  // Current coordinate for the truck marker on the mini-map
  const currentTruckCoord = useMemo(() => {
    if (
      simulationState.isActive &&
      simulationState.currentCoordinate &&
      Number.isFinite(simulationState.currentCoordinate.latitude) &&
      Number.isFinite(simulationState.currentCoordinate.longitude)
    ) {
      return simulationState.currentCoordinate;
    }
    if (
      actualTruckCoord &&
      Number.isFinite(actualTruckCoord.latitude) &&
      Number.isFinite(actualTruckCoord.longitude)
    ) {
      return actualTruckCoord;
    }
    return null;
  }, [
    simulationState.isActive,
    simulationState.currentCoordinate,
    actualTruckCoord,
  ]);

  // Mini-map center: centered on current truck if available, or first waypoint / Danao center
  const miniMapInitialCenter = useMemo(() => {
    if (
      currentTruckCoord &&
      Number.isFinite(currentTruckCoord.latitude) &&
      Number.isFinite(currentTruckCoord.longitude)
    ) {
      return {
        latitude: currentTruckCoord.latitude,
        longitude: currentTruckCoord.longitude,
      };
    }
    if (
      barangayRoutePoints &&
      barangayRoutePoints.length > 0 &&
      Number.isFinite(barangayRoutePoints[0].latitude)
    ) {
      return barangayRoutePoints[0];
    }
    return { latitude: 10.5218, longitude: 124.0285 };
  }, [
    currentTruckCoord?.latitude,
    currentTruckCoord?.longitude,
    barangayRoutePoints,
  ]);

  // Automatically keep mini-map camera centered on current GPS / truck location
  useEffect(() => {
    if (currentTruckCoord && miniMapRef.current) {
      miniMapRef.current.setCenter(
        currentTruckCoord.latitude,
        currentTruckCoord.longitude,
      );
    }
  }, [currentTruckCoord?.latitude, currentTruckCoord?.longitude]);

  useEffect(() => {
    return locationService.onSimulationChange((state) => {
      setSimulationState({ ...state });
    });
  }, []);

  // -------------------------------------------------------------
  // DWELL / STATIONARY PICKUP DETECTION (5-10 MIN STOP)
  // When truck is stationary for 5+ mins, prompt driver if collecting waste.
  // -------------------------------------------------------------
  useEffect(() => {
    const isDrivingActive = Boolean(simulationState.isActive || isActualDriving);

    if (!isShiftActive || !isDrivingActive || !currentTruckCoord) {
      stationaryAnchorRef.current = null;
      hasPromptedForCurrentStopRef.current = false;
      return;
    }

    const checkInterval = setInterval(() => {
      if (!currentTruckCoord) return;

      const now = Date.now();

      // Check if driver snoozed for traffic
      if (now < trafficSnoozedUntilRef.current) {
        if (stationaryAnchorRef.current) {
          const distFromAnchor = haversineMeters(currentTruckCoord, {
            latitude: stationaryAnchorRef.current.latitude,
            longitude: stationaryAnchorRef.current.longitude,
          });
          // If truck moved significantly (> 60m), vehicle cleared traffic jam!
          if (distFromAnchor > 60) {
            trafficSnoozedUntilRef.current = 0;
            stationaryAnchorRef.current = {
              latitude: currentTruckCoord.latitude,
              longitude: currentTruckCoord.longitude,
              startTime: now,
            };
            hasPromptedForCurrentStopRef.current = false;
          }
        }
        return;
      }

      if (!stationaryAnchorRef.current) {
        stationaryAnchorRef.current = {
          latitude: currentTruckCoord.latitude,
          longitude: currentTruckCoord.longitude,
          startTime: now,
        };
        hasPromptedForCurrentStopRef.current = false;
        return;
      }

      const dist = haversineMeters(currentTruckCoord, {
        latitude: stationaryAnchorRef.current.latitude,
        longitude: stationaryAnchorRef.current.longitude,
      });

      // 35 meters threshold accounts for GPS drift while parked
      if (dist > 35) {
        // Truck has moved: reset stationary anchor to new location
        stationaryAnchorRef.current = {
          latitude: currentTruckCoord.latitude,
          longitude: currentTruckCoord.longitude,
          startTime: now,
        };
        hasPromptedForCurrentStopRef.current = false;
        trafficSnoozedUntilRef.current = 0;
      } else {
        // Truck is stationary within 35 meters
        const elapsedMs = now - stationaryAnchorRef.current.startTime;
        const DWELL_TIME_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

        if (
          elapsedMs >= DWELL_TIME_THRESHOLD_MS &&
          !hasPromptedForCurrentStopRef.current &&
          !showStationaryPrompt &&
          !showCompleteModal
        ) {
          hasPromptedForCurrentStopRef.current = true;

          // Find nearest stop from liveDispatches or nextPickup within 250m
          let nearest: NextPickup | null = null;
          let minDistance = 250;
          for (const stop of liveDispatches) {
            if (stop.latitude && stop.longitude) {
              const d = haversineMeters(currentTruckCoord, {
                latitude: stop.latitude,
                longitude: stop.longitude,
              });
              if (d < minDistance) {
                minDistance = d;
                nearest = stop;
              }
            }
          }
          if (!nearest && nextPickup?.latitude && nextPickup?.longitude) {
            const d = haversineMeters(currentTruckCoord, {
              latitude: nextPickup.latitude,
              longitude: nextPickup.longitude,
            });
            if (d < minDistance) {
              nearest = nextPickup;
            }
          }

          const locName =
            nearest?.street ||
            `Checkpoint near Brgy. ${assignedBarangay} (${currentTruckCoord.latitude.toFixed(4)}, ${currentTruckCoord.longitude.toFixed(4)})`;

          setStationaryPromptData({
            latitude: currentTruckCoord.latitude,
            longitude: currentTruckCoord.longitude,
            locationName: locName,
            nearestStop: nearest,
            elapsedMinutes: Math.max(5, Math.floor(elapsedMs / 60000)),
          });
          setShowStationaryPrompt(true);
        }
      }
    }, 6000); // Check every 6 seconds

    return () => clearInterval(checkInterval);
  }, [
    isShiftActive,
    simulationState.isActive,
    isActualDriving,
    currentTruckCoord?.latitude,
    currentTruckCoord?.longitude,
    liveDispatches,
    nextPickup,
    showStationaryPrompt,
    showCompleteModal,
    assignedBarangay,
  ]);

  const handleConfirmStationaryCollection = () => {
    setShowStationaryPrompt(false);
    const targetStop = stationaryPromptData?.nearestStop;
    if (targetStop) {
      setSelectedPickupId(targetStop.id);
    } else {
      setSelectedPickupId(`adhoc_${Date.now()}`);
    }
    setIsMandatoryStopComplete(true);
    setShowCompleteModal(true);
  };

  const handleStuckInTraffic = () => {
    setShowStationaryPrompt(false);
    trafficSnoozedUntilRef.current = Date.now() + 5 * 60 * 1000; // Snooze 5 mins
    if (stationaryAnchorRef.current) {
      stationaryAnchorRef.current.startTime = Date.now();
    }
    setActiveToastAlert({
      id: `traffic_${Date.now()}`,
      title: "Traffic Delay Noted",
      message: "Dwell pickup detection paused for 5 minutes while in traffic.",
      type: "info",
    });
  };

  const handleTriggerTestStationaryPrompt = () => {
    if (!currentTruckCoord) {
      Alert.alert(
        "GPS Location Required",
        "No truck coordinate available yet. Please start driving or GPS navigation first.",
      );
      return;
    }
    let nearest: NextPickup | null = null;
    let minDistance = 500;
    for (const stop of liveDispatches) {
      if (stop.latitude && stop.longitude) {
        const d = haversineMeters(currentTruckCoord, {
          latitude: stop.latitude,
          longitude: stop.longitude,
        });
        if (d < minDistance) {
          minDistance = d;
          nearest = stop;
        }
      }
    }
    if (!nearest && nextPickup?.latitude && nextPickup?.longitude) {
      nearest = nextPickup;
    }
    setStationaryPromptData({
      latitude: currentTruckCoord.latitude,
      longitude: currentTruckCoord.longitude,
      locationName: nearest?.street || `Checkpoint near Brgy. ${assignedBarangay}`,
      nearestStop: nearest,
      elapsedMinutes: 5,
    });
    setShowStationaryPrompt(true);
  };

  const handleStopDrive = async () => {
    const activeUser = user || auth?.currentUser;
    if (!activeUser) return;

    stationaryAnchorRef.current = null;
    hasPromptedForCurrentStopRef.current = false;
    trafficSnoozedUntilRef.current = 0;
    setShowStationaryPrompt(false);
    setIsActualDriving(false);
    setActualTruckCoord(null);
    await locationService.stopSimulation(activeUser.uid);
    await locationService.stopTracking(activeUser.uid);
    try {
      if (db) {
        await setDoc(
          doc(db, "truck_locations", activeUser.uid),
          {
            status: "inactive",
            isSimulation: false,
            isSimulated: false,
            speedKph: 0,
            speed: 0,
            lastUpdate: serverTimestamp(),
          },
          { merge: true },
        );
      }
    } catch (err) {
      console.warn("Could not reset truck_locations on stop drive:", err);
    }
    Alert.alert(
      "Drive Stopped",
      "Location tracking is paused. Your scheduled pickups and route remain active.",
    );
  };

  const performRouteCompletion = async () => {
    const activeUser = user || auth?.currentUser;
    if (!activeUser || !db) return;

    const elapsedSec = simulationState.elapsedDurationSeconds || 0;
    const distTraveled = simulationState.distanceTraveledKm || 0;
    const fuelLiters = simulationState.fuelBurnedLiters || 0;
    const fuelCost = simulationState.fuelCostBurnedPhp || 0;
    const progressPct = simulationState.progressPercent || 100;
    const elapsedMins = Math.max(1, Math.round(elapsedSec / 60));
    const pickupsCount = Math.max(1, Math.round((progressPct / 100) * 10));

    // 1. Stop simulation and GPS
    setIsActualDriving(false);
    setActualTruckCoord(null);
    await locationService.stopSimulation(activeUser.uid);
    await locationService.stopTracking(activeUser.uid);

    // 2. Reset truck_locations
    try {
      await setDoc(
        doc(db, "truck_locations", activeUser.uid),
        {
          status: "inactive",
          isSimulation: false,
          isSimulated: false,
          speedKph: 0,
          speed: 0,
          lastUpdate: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (locErr) {
      console.warn(
        "Could not reset truck_locations on complete route:",
        locErr,
      );
    }

    // 3. Mark active nextPickup and liveDispatches completed
    try {
      if (nextPickup && isDateToday(nextPickup.dateText)) {
        await setDoc(
          doc(db, "schedules", nextPickup.id),
          {
            status: "completed",
            completedAt: serverTimestamp(),
            dieselClosedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            completedByUid: activeUser.uid,
            assignedDriverId: activeUser.uid,
          },
          { merge: true },
        );
      }

      for (const ld of liveDispatches) {
        const cleanId = ld.id.startsWith("rep_")
          ? ld.id.replace("rep_", "")
          : ld.id;
        if (ld.id.startsWith("rep_")) {
          await setDoc(
            doc(db, "reports", cleanId),
            {
              status: "resolved",
              collectedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              resolvedByUid: activeUser.uid,
              assignedDriverId: activeUser.uid,
            },
            { merge: true },
          );
        } else {
          await setDoc(
            doc(db, "schedules", cleanId),
            {
              status: "completed",
              completedAt: serverTimestamp(),
              dieselClosedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              completedByUid: activeUser.uid,
              assignedDriverId: activeUser.uid,
            },
            { merge: true },
          );
        }
      }
    } catch (schedErr) {
      console.warn("Could not mark schedules completed:", schedErr);
    }

    // 4. Record in driver_route_history and sync master schedule for CENRO audit
    try {
      const histRef = await addDoc(collection(db, "driver_route_history"), {
        driverId: activeUser.uid,
        driverName: activeUser.displayName || "Driver",
        truckPlate: currentTruck?.plateNumber || "TRUCK-01",
        barangay: assignedBarangay,
        routeName: `Brgy. ${assignedBarangay} Collection Route`,
        durationMinutes: elapsedMins,
        pickupsCompleted: pickupsCount,
        totalDistanceKm: distTraveled,
        fuelBurnedLiters: fuelLiters,
        fuelCostPhp: fuelCost,
        status: "completed",
        completedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        summaryText: `Completed collection route in Brgy. ${assignedBarangay} (${elapsedMins} mins, ${pickupsCount} pickups).`,
      });

      // Synchronize into schedules so CENRO / Coordinator immediately sees
      // this driver-completed trip in the Web Admin "Assigned collection trip" dropdown
      const dateText = new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "Asia/Manila",
      });
      await setDoc(
        doc(db, "schedules", histRef.id),
        {
          barangay: assignedBarangay,
          truckId: currentTruck?.id || currentTruck?.plateNumber || "TRUCK-01",
          truckPlate: currentTruck?.plateNumber || "TRUCK-01",
          assignedDriverId: activeUser.uid,
          assignedDriverName: activeUser.displayName || "Driver",
          driver: activeUser.displayName || "Driver",
          driverName: activeUser.displayName || "Driver",
          dateText,
          timeText: "Shift Master Route",
          street: `Brgy. ${assignedBarangay} Collection Route`,
          status: "completed",
          isLiveDispatch: true,
          completedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          dieselClosedAt: serverTimestamp(),
          completedByUid: activeUser.uid,
          createdByUid: activeUser.uid,
          actualDistanceKm: distTraveled,
          actualFuelLiters: fuelLiters,
          durationMinutes: elapsedMins,
          pickupsCompleted: pickupsCount,
          routeOptimization: {
            baselineDistanceKm: Math.round(distTraveled * 1.15 * 100) / 100,
            optimizedDistanceKm: Math.round(distTraveled * 100) / 100,
            stopCount: pickupsCount,
            method: "driver-telemetry",
          },
        },
        { merge: true },
      );
    } catch (histErr) {
      console.warn(
        "Could not record driver_route_history/schedule on complete route:",
        histErr,
      );
    }

    Alert.alert(
      "🎉 Route Completed!",
      `Route for Brgy. ${assignedBarangay} has been completed and submitted to CENRO.\n\n• Duration: ${elapsedMins} mins\n• Distance: ${distTraveled.toFixed(2)} km\n• Fuel: ${fuelLiters.toFixed(2)} L (≈ ₱${fuelCost.toFixed(0)})\n• Pickups: ${pickupsCount}\n\nWould you like to conclude your shift now?`,
      [
        { text: "Stay On Standby", style: "cancel" },
        {
          text: "End Shift Now",
          onPress: () => {
            setShowEndShiftModal(true);
          },
        },
      ],
    );
  };

  const handleCompleteRoute = () => {
    const activeUser = user || auth?.currentUser;
    if (!activeUser) {
      Alert.alert(
        "Authentication Required",
        "Please sign in to complete route.",
      );
      return;
    }

    Alert.alert(
      "Complete Collection Route",
      `Are you sure you want to finish your collection route for Brgy. ${assignedBarangay}?`,
      [
        { text: "Cancel", style: "cancel" },
        ...(nextPickup && (nextPickup.dateText === "Today" || !nextPickup.dateText)
          ? [
              {
                text: "Submit Photo Evidence",
                onPress: () => {
                  setSelectedPickupId(nextPickup.id);
                  setShowCompleteModal(true);
                },
              },
            ]
          : []),
        {
          text: "Complete Route",
          style: "default",
          onPress: async () => {
            await performRouteCompletion();
          },
        },
      ],
    );
  };

  const handleToggleSimulation = async () => {
    const activeUser = user || auth?.currentUser;
    if (!activeUser) {
      Alert.alert(
        "Authentication Required",
        "Please sign in to run drive navigation.",
      );
      return;
    }

    if (simulationState.isActive || isActualDriving) {
      await handleStopDrive();
    } else {
      if (systemOverrides.forcePauseCollection) {
        Alert.alert(
          "🚨 Dispatch Paused by CENRO",
          `Municipal truck dispatch is currently paused by CENRO due to an emergency directive:\n\n"${systemOverrides.forcePauseReason || "Emergency Standby Directive"}"\n\nPlease safely park on standby until CENRO authorizes resumption.`,
        );
        return;
      }
      setShowDriveModeModal(true);
    }
  };

  const handleSelectDriveMode = async (
    mode:
      | "sim_baliang_direct"
      | "sim_baliang_whole"
      | "sim_baliang_orig"
      | "sim_sector"
      | "actual_gps",
  ) => {
    setShowDriveModeModal(false);
    const activeUser = user || auth?.currentUser;
    if (!activeUser) {
      Alert.alert(
        "Authentication Required",
        "Please sign in to run drive navigation.",
      );
      return;
    }
    const truckId =
      currentTruck?.id || currentTruck?.plateNumber || "TRUCK-DANAO-01";
    const resolvedDriverName =
      currentTruck?.assignedDriverName ||
      activeUser.displayName ||
      activeUser.email?.split("@")[0] ||
      "Driver";
    const resolvedPlate =
      currentTruck?.plateNumber ||
      (!isRawFirestoreIdOrUuid(truckId) ? truckId : "ABC-1111");

    if (mode === "sim_baliang_direct") {
      await locationService.stopTracking(activeUser.uid);
      setIsActualDriving(false);
      await locationService.startSimulation(
        activeUser.uid,
        resolvedPlate,
        "Baliang_Direct",
        {
          barangay: "Baliang",
          assignedBarangay: "Baliang",
          driverName: resolvedDriverName,
          assignedDriverName: resolvedDriverName,
          plateNumber: resolvedPlate,
          truckPlate: resolvedPlate,
        },
        1,
      );
      router.push(
        `/(driver)/route-map?autoDrive=true&driveMode=sim&targetBarangay=Baliang&routeVariant=direct`,
      );
    } else if (mode === "sim_baliang_whole") {
      await locationService.stopTracking(activeUser.uid);
      setIsActualDriving(false);
      await locationService.startSimulation(
        activeUser.uid,
        resolvedPlate,
        "Baliang_Whole",
        {
          barangay: "Baliang",
          assignedBarangay: "Baliang",
          driverName: resolvedDriverName,
          assignedDriverName: resolvedDriverName,
          plateNumber: resolvedPlate,
          truckPlate: resolvedPlate,
        },
        1,
      );
      router.push(
        `/(driver)/route-map?autoDrive=true&driveMode=sim&targetBarangay=Baliang&routeVariant=whole`,
      );
    } else if (mode === "sim_baliang_orig") {
      await locationService.stopTracking(activeUser.uid);
      setIsActualDriving(false);
      await locationService.startSimulation(
        activeUser.uid,
        resolvedPlate,
        "Baliang_Original",
        {
          barangay: "Baliang",
          assignedBarangay: "Baliang",
          driverName: resolvedDriverName,
          assignedDriverName: resolvedDriverName,
          plateNumber: resolvedPlate,
          truckPlate: resolvedPlate,
        },
        1,
      );
      router.push(
        `/(driver)/route-map?autoDrive=true&driveMode=sim&targetBarangay=Baliang&routeVariant=original`,
      );
    } else if (mode === "sim_sector") {
      await locationService.stopTracking(activeUser.uid);
      setIsActualDriving(false);
      await locationService.startSimulation(
        activeUser.uid,
        resolvedPlate,
        assignedBarangay,
        {
          barangay: assignedBarangay,
          assignedBarangay,
          driverName: resolvedDriverName,
          assignedDriverName: resolvedDriverName,
          plateNumber: resolvedPlate,
          truckPlate: resolvedPlate,
        },
        1,
      );
      router.push(
        `/(driver)/route-map?autoDrive=true&driveMode=sim&targetBarangay=${encodeURIComponent(assignedBarangay)}`,
      );
    } else if (mode === "actual_gps") {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Permission Denied",
            "Location permission is required to use your phone GPS.",
          );
          return;
        }
        await locationService.stopSimulation(activeUser.uid);
        await locationService.startTracking(activeUser.uid, resolvedPlate, {
          barangay: assignedBarangay,
          plateNumber: resolvedPlate,
          truckPlate: resolvedPlate,
          driverName: resolvedDriverName,
        });
        setIsActualDriving(true);
        router.push(
          `/(driver)/route-map?driveMode=actual&targetBarangay=${encodeURIComponent(assignedBarangay)}`,
        );
      } catch (e) {
        console.error("Failed to start actual GPS tracking:", e);
      }
    }
  };

  useEffect(() => {
    if (!db || !auth?.currentUser) {
      setLoading(false);
      return;
    }

    const currentUser = auth.currentUser;
    // Fetch Next Pickup & Live Dispatches from 'schedules' & 'barangay_schedules'
    const nextPickupQuery = query(
      collection(db, "schedules"),
      where("assignedDriverId", "==", currentUser.uid),
    );

    let rawDirectPickupsToday: NextPickup[] = [];
    let rawDirectPickupsTomorrow: NextPickup[] = [];
    let rawDirectDispatches: NextPickup[] = [];
    let rawDirectReports: NextPickup[] = [];

    let assignedSpecialPickupsToday: NextPickup[] = [];
    let normalPickupsToday: NextPickup[] = [];
    let assignedSpecialPickupsTomorrow: NextPickup[] = [];
    let normalPickupsTomorrow: NextPickup[] = [];
    let upcomingPickups: NextPickup[] = [];

    const completedTodayScheduleKeys = new Set<string>();

    const today = new Date();
    const todayDOW = today.getDay();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDOW = tomorrow.getDay();

    const isPickupDone = (p: NextPickup): boolean => {
      if (p.status === "completed") return true;
      if (completedTodayScheduleKeys.has(p.id) || completedScheduleIdsRef.current.has(p.id)) return true;
      if (p.id.startsWith("bs_today_")) {
        const rawId = p.id.replace("bs_today_", "");
        if (completedTodayScheduleKeys.has(rawId) || completedScheduleIdsRef.current.has(rawId)) return true;
        if (completedTodayScheduleKeys.has(`bs_${rawId}`) || completedScheduleIdsRef.current.has(`bs_${rawId}`)) return true;
      }
      if (p.street) {
        const sKey = String(p.street).toLowerCase().trim();
        if (completedTodayScheduleKeys.has(sKey) || completedScheduleIdsRef.current.has(sKey)) return true;
      }
      return false;
    };

    const recomputePickups = () => {
      // Deduplicate citizen reports that are already included as a waypoint in the master live route
      const embeddedReportIds = new Set<string>();
      for (const item of rawDirectDispatches) {
        if (item.reportId) embeddedReportIds.add(String(item.reportId));
      }
      const uniqueDirectReports = rawDirectReports.filter((r) => {
        const rawId = r.id.startsWith("rep_") ? r.id.replace("rep_", "") : r.id;
        const reportId = r.reportId ? String(r.reportId) : rawId;
        return !embeddedReportIds.has(rawId) && !embeddedReportIds.has(reportId);
      });

      const activeDirectReports = uniqueDirectReports.filter(
        (r) => !isPickupDone(r) && r.status !== "completed"
      );
      const allDispatches = [...rawDirectDispatches, ...activeDirectReports];
      // Deduplicate live dispatches so the driver does not see duplicate active master routes
      const seenDispatches = new Set<string>();
      const uniqueDispatches: NextPickup[] = [];
      for (const item of allDispatches) {
        const key = item.id;
        if (!seenDispatches.has(key)) {
          seenDispatches.add(key);
          uniqueDispatches.push(item);
        }
      }
      setLiveDispatches(uniqueDispatches);

      // Record today's parent/general schedule IDs
      todayScheduleIdsRef.current = [
        ...assignedSpecialPickupsToday.map((p) => p.id),
        ...normalPickupsToday.map((p) => p.id),
        ...rawDirectPickupsToday.map((p) => p.id),
      ];

      // 1. Pick Today's Candidates
      // CRITICAL: When the driver has an active live route with stops (e.g. 15 stops),
      // the Next Scheduled Pickup MUST be the current stop in the route sequence (uniqueDispatches[0])!
      // The driver cannot skip ahead or finish today's collection without completing the needed route stops.
      let allTodayCandidates: NextPickup[] = [];
      if (uniqueDispatches.length > 0) {
        allTodayCandidates = [uniqueDispatches[0]];
      } else {
        if (assignedSpecialPickupsToday.length > 0) {
          allTodayCandidates = [...assignedSpecialPickupsToday];
        } else {
          allTodayCandidates = [
            ...assignedSpecialPickupsToday,
            ...normalPickupsToday,
            ...rawDirectPickupsToday,
          ];
        }
      }
      const todayCandidates =
        uniqueDispatches.length > 0
          ? [uniqueDispatches[0]]
          : allTodayCandidates.filter((p) => !isPickupDone(p));
      todayCandidates.sort((a, b) => a.timeText.localeCompare(b.timeText));

      // 2. Pick Tomorrow's Candidates
      let allTomorrowCandidates: NextPickup[] = [];
      if (assignedSpecialPickupsTomorrow.length > 0) {
        allTomorrowCandidates = [...assignedSpecialPickupsTomorrow];
      } else {
        allTomorrowCandidates = [...assignedSpecialPickupsTomorrow, ...normalPickupsTomorrow, ...rawDirectPickupsTomorrow];
      }
      const tomorrowCandidates = allTomorrowCandidates.filter((p) => !isPickupDone(p));
      tomorrowCandidates.sort((a, b) => a.timeText.localeCompare(b.timeText));

      // 3. Upcoming Candidates
      const upcomingCandidates = upcomingPickups.filter((p) => !isPickupDone(p));
      upcomingCandidates.sort((a, b) => a.timeText.localeCompare(b.timeText));

      // Priority: Today > Tomorrow > Upcoming
      if (todayCandidates.length > 0) {
        setNextPickup(todayCandidates[0]);
      } else if (tomorrowCandidates.length > 0) {
        setNextPickup(tomorrowCandidates[0]);
      } else if (upcomingCandidates.length > 0) {
        setNextPickup(upcomingCandidates[0]);
      } else {
        setNextPickup(null);
      }
    };

    recomputePickupsRef.current = recomputePickups;

    const unsubscribeNextPickup = onSnapshot(
      nextPickupQuery,
      (snapshot) => {
        let todayPickups: NextPickup[] = [];
        let tomorrowPickups: NextPickup[] = [];
        let liveDispatchesData: NextPickup[] = [];
        const todayString = new Date().toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        });

        completedTodayScheduleKeys.clear();

        // Identify the single active live dispatch schedule for this driver's current shift
        const activeLiveDocs = snapshot.docs.filter((d) => {
          const dData = d.data();
          return (
            dData.isLiveDispatch === true &&
            !dData.dieselClosedAt &&
            ["pending", "in_progress", "in-progress"].includes(String(dData.status || ""))
          );
        });
        const targetMasterDocId = activeLiveDocs.length > 0 ? activeLiveDocs[activeLiveDocs.length - 1].id : null;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();

          if (data.status === "completed") {
            completedTodayScheduleKeys.add(docSnap.id);
            if (data.scheduleId) {
              completedTodayScheduleKeys.add(data.scheduleId);
            }
            if (docSnap.id.startsWith("bs_today_")) {
              const rawId = docSnap.id.replace("bs_today_", "");
              completedTodayScheduleKeys.add(rawId);
              completedTodayScheduleKeys.add(`bs_${rawId}`);
            }
            if (data.street)
              completedTodayScheduleKeys.add(
                String(data.street).toLowerCase().trim(),
              );
            return;
          }

          if (
            data.status === "pending" ||
            data.status === "in_progress" ||
            !data.status
          ) {
            if (
              data.barangay &&
              typeof data.barangay === "string" &&
              data.barangay.trim()
            ) {
              setAssignedBarangay(data.barangay.trim());
            }
            if (data.isLiveDispatch) {
              // Only process stops from the active master live route for this shift
              if (targetMasterDocId && docSnap.id !== targetMasterDocId) {
                return;
              }
              if (Array.isArray(data.stops) && data.stops.length > 0) {
                data.stops.forEach((s: any, idx: number) => {
                  if (s.completed) return;
                  liveDispatchesData.push({
                    id: `${docSnap.id}_stop_${s.order || idx + 1}`,
                    scheduleId: docSnap.id,
                    reportId: s.reportId || null,
                    street:
                      s.name || s.street || data.street || `Stop ${idx + 1}`,
                    wasteCategory:
                      s.type === "citizen_report"
                        ? "Verified Citizen Report"
                        : data.wasteCategory || "Collection Stop",
                    timeText: s.time || data.timeText || "Active Sequence",
                    dateText: "Today",
                    status: data.status || "in_progress",
                    isLiveDispatch: true,
                    routeOrder: Number(s.order) || idx + 1,
                    latitude: Number.isFinite(s.latitude)
                      ? Number(s.latitude)
                      : Number.isFinite(data.latitude)
                        ? Number(data.latitude)
                        : undefined,
                    longitude: Number.isFinite(s.longitude)
                      ? Number(s.longitude)
                      : Number.isFinite(data.longitude)
                        ? Number(data.longitude)
                        : undefined,
                  });
                });
              } else {
                liveDispatchesData.push({
                  id: docSnap.id,
                  scheduleId: docSnap.id,
                  street: data.street || "Unknown Street",
                  wasteCategory: data.wasteCategory || "General",
                  timeText: data.timeText || "ASAP",
                  dateText: "Today",
                  status: data.status || "pending",
                  isLiveDispatch: true,
                  routeOrder: data.routeOrder || 0,
                  latitude: Number.isFinite(data.latitude)
                    ? Number(data.latitude)
                    : undefined,
                  longitude: Number.isFinite(data.longitude)
                    ? Number(data.longitude)
                    : undefined,
                });
              }
            } else if (
              isDateMatching(data.dateText, today, data.fullDate) ||
              data.dateText === todayString ||
              data.dateText === "Today" ||
              !data.dateText
            ) {
              todayPickups.push({
                id: docSnap.id,
                street: data.street || "Unknown Street",
                wasteCategory: data.wasteCategory || "General",
                timeText: data.timeText || "Unknown Time",
                dateText: "Today",
                status: data.status || "pending",
                isLiveDispatch: false,
              });
            } else if (
              isDateMatching(data.dateText, tomorrow, data.fullDate) ||
              data.dateText === "Tomorrow"
            ) {
              tomorrowPickups.push({
                id: docSnap.id,
                street: data.street || "Unknown Street",
                wasteCategory: data.wasteCategory || "General",
                timeText: data.timeText || "Unknown Time",
                dateText: "Tomorrow",
                status: data.status || "pending",
                isLiveDispatch: false,
              });
            }
          }
        });

        todayPickups.sort((a, b) => a.timeText.localeCompare(b.timeText));
        tomorrowPickups.sort((a, b) => a.timeText.localeCompare(b.timeText));
        liveDispatchesData.sort(
          (a, b) => (a.routeOrder || 0) - (b.routeOrder || 0),
        );

        rawDirectPickupsToday = todayPickups;
        rawDirectPickupsTomorrow = tomorrowPickups;
        rawDirectDispatches = liveDispatchesData;
        recomputePickups();
      },
      (error) => {
        if (error?.code !== "permission-denied") {
          console.warn("DriverIndex: next pickup listener error:", error);
        }
      },
    );

    // Real-time listener for citizen reports assigned to this driver
    const reportsQuery = query(
      collection(db, "reports"),
      where("assignedDriverId", "==", currentUser.uid),
    );

    const unsubReports = onSnapshot(
      reportsQuery,
      (snapshot) => {
        const liveReportDispatches: NextPickup[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const normStatus = (data.status || "")
            .toLowerCase()
            .replace(/_/g, "-");
          if (
            normStatus === "in-progress" ||
            normStatus === "acknowledged" ||
            normStatus === "pending"
          ) {
            liveReportDispatches.push({
              id: `rep_${docSnap.id}`,
              reportId: docSnap.id,
              street:
                data.street ||
                data.address ||
                data.locationDescription ||
                `Report: ${data.title || "Trash Pickup"}`,
              wasteCategory: `Citizen Report • ${data.aiAnalysis?.wasteType || data.wasteType || "General"}`,
              timeText: "ASAP",
              dateText: "Today",
              status: data.status || "in_progress",
              isLiveDispatch: true,
              routeOrder: 1,
              latitude: Number(data.location?.lat ?? data.location?.latitude ?? data.latitude) || undefined,
              longitude: Number(data.location?.lng ?? data.location?.longitude ?? data.longitude) || undefined,
            });
          }
        });
        rawDirectReports = liveReportDispatches;
        recomputePickups();
      },
      (err) => {
        if (err?.code !== "permission-denied") {
          console.warn("DriverIndex: reports listener error:", err);
        }
      },
    );

    // Also listen to 'barangay_schedules'
    const unsubBarangaySchedules = onSnapshot(
      collection(db, "barangay_schedules"),
      (snapshot) => {
        const specialToday: NextPickup[] = [];
        const normalToday: NextPickup[] = [];
        const specialTomorrow: NextPickup[] = [];
        const normalTomorrow: NextPickup[] = [];
        const upcoming: NextPickup[] = [];

        const normalizedDriverBarangay = (assignedBarangay || "").trim().toLowerCase();

        snapshot.forEach((d) => {
          const data = d.data();
          const streetName = data.streetName || data.street || data.route || "Barangay Route";
          const streetKey = String(streetName).toLowerCase().trim();
          const bName = String(data.barangayName || data.barangay || assignedBarangay || "").trim();
          const bLower = bName.toLowerCase();
          const category = data.wasteCategory || data.wasteType || "BIODEGRADABLE";

          const isAssignedToOtherWeeklyDriver = Boolean(
            data.assignedDriverId &&
            currentUser.uid &&
            data.assignedDriverId !== currentUser.uid,
          );
          if (isAssignedToOtherWeeklyDriver) {
            return;
          }

          const isDriverAssignedToWeekly = Boolean(
            data.assignedDriverId &&
            currentUser.uid &&
            data.assignedDriverId === currentUser.uid,
          );

          const isBarangayMatch = !normalizedDriverBarangay ||
            bLower === normalizedDriverBarangay ||
            normalizedDriverBarangay.includes(bLower) ||
            bLower.includes(normalizedDriverBarangay);

          // If driver has an assigned barangay, strictly skip schedules belonging to other barangays
          if (normalizedDriverBarangay && !isBarangayMatch) {
            return;
          }

          if (isDriverAssignedToWeekly && bName && !normalizedDriverBarangay) {
            setAssignedBarangay(bName);
          }


          // 1. Specific Schedules (one-off pickups)
          const specific = data.specificSchedules || data.pickups || [];
          if (Array.isArray(specific)) {
            specific.forEach((item: any, idx: number) => {
              const effectiveDriverId = item.assignedDriverId || data.assignedDriverId;
              if (effectiveDriverId && currentUser.uid && effectiveDriverId !== currentUser.uid) {
                return;
              }

              const isAssignedToCurrentDriver = Boolean(
                currentUser.uid &&
                (item.assignedDriverId === currentUser.uid ||
                  (!item.assignedDriverId && data.assignedDriverId === currentUser.uid))
              );

              const specId = `spec_${d.id}_${idx}`;
              if (completedTodayScheduleKeys.has(specId)) {
                return;
              }

              const itemStreet = item.street || streetName;
              const itemCategory = item.category || category;

              // Today
              if (isDateMatching(item.date, today, item.fullDate)) {
                const time = item.time || getTimeForDay(data, todayDOW);
                const pickupItem: NextPickup = {
                  id: specId,
                  street: itemStreet,
                  wasteCategory: itemCategory,
                  timeText: time,
                  dateText: "Today",
                  status: item.status || "pending",
                  isLiveDispatch: false,
                  isExclusiveAssignment: isAssignedToCurrentDriver,
                  assignedDriverId: item.assignedDriverId || data.assignedDriverId || null,
                  assignedDriverName: item.assignedDriverName || data.assignedDriverName || null,
                };
                if (isAssignedToCurrentDriver) {
                  specialToday.push(pickupItem);
                  if (bName) setAssignedBarangay(bName);
                } else if (!effectiveDriverId && isBarangayMatch) {
                  normalToday.push(pickupItem);
                }
              }

              // Tomorrow
              if (isDateMatching(item.date, tomorrow, item.fullDate)) {
                const time = item.time || getTimeForDay(data, tomorrowDOW);
                const pickupItem: NextPickup = {
                  id: specId,
                  street: itemStreet,
                  wasteCategory: itemCategory,
                  timeText: time,
                  dateText: "Tomorrow",
                  status: item.status || "pending",
                  isLiveDispatch: false,
                  isExclusiveAssignment: isAssignedToCurrentDriver,
                  assignedDriverId: item.assignedDriverId || data.assignedDriverId || null,
                  assignedDriverName: item.assignedDriverName || data.assignedDriverName || null,
                };
                if (isAssignedToCurrentDriver) {
                  specialTomorrow.push(pickupItem);
                } else if (!effectiveDriverId && isBarangayMatch) {
                  normalTomorrow.push(pickupItem);
                }
              }

              // Upcoming exclusive assignment
              const isTodayMatch = isDateMatching(item.date, today, item.fullDate);
              const isTmrwMatch = isDateMatching(item.date, tomorrow, item.fullDate);
              if (!isTodayMatch && !isTmrwMatch && isAssignedToCurrentDriver) {
                upcoming.push({
                  id: specId,
                  street: itemStreet,
                  wasteCategory: itemCategory,
                  timeText: item.time || "Scheduled",
                  dateText: item.fullDate || item.date || "Upcoming",
                  status: item.status || "pending",
                  isLiveDispatch: false,
                  isExclusiveAssignment: true,
                  assignedDriverId: item.assignedDriverId || data.assignedDriverId || null,
                  assignedDriverName: item.assignedDriverName || data.assignedDriverName || null,
                });
              }
            });
          }

          // 2. Regular recurring day collection
          const days = Array.isArray(data.days)
            ? data.days
            : Array.isArray(data.selectedDays)
              ? data.selectedDays
              : [];

          const isToday = isDayScheduled(days, todayDOW) || data.isDaily === true;
          const isTomorrow = isDayScheduled(days, tomorrowDOW) || data.isDaily === true;

          // Check if today was already marked completed
          const isTodayCompleted =
            completedTodayScheduleKeys.has(`bs_${d.id}`) ||
            completedTodayScheduleKeys.has(`bs_today_${d.id}`) ||
            completedTodayScheduleKeys.has(d.id) ||
            completedTodayScheduleKeys.has(streetKey);

          if (isToday && !isTodayCompleted) {
            const time = getTimeForDay(data, todayDOW);
            const pickupItem: NextPickup = {
              id: `bs_today_${d.id}`,
              street: streetName,
              wasteCategory: category,
              timeText: time,
              dateText: "Today",
              status: "pending",
              isLiveDispatch: false,
              isExclusiveAssignment: isDriverAssignedToWeekly,
              assignedDriverId: data.assignedDriverId || null,
              assignedDriverName: data.assignedDriverName || null,
            };
            if (isDriverAssignedToWeekly) {
              specialToday.push(pickupItem);
            } else if (isBarangayMatch) {
              normalToday.push(pickupItem);
            }
          }

          // Tomorrow recurring
          if (isTomorrow) {
            const time = getTimeForDay(data, tomorrowDOW);
            const pickupItem: NextPickup = {
              id: `bs_tmrw_${d.id}`,
              street: streetName,
              wasteCategory: category,
              timeText: time,
              dateText: "Tomorrow",
              status: "pending",
              isLiveDispatch: false,
              isExclusiveAssignment: isDriverAssignedToWeekly,
              assignedDriverId: data.assignedDriverId || null,
              assignedDriverName: data.assignedDriverName || null,
            };
            if (isDriverAssignedToWeekly) {
              specialTomorrow.push(pickupItem);
            } else if (isBarangayMatch) {
              normalTomorrow.push(pickupItem);
            }
          }

          // Upcoming recurring day if neither today nor tomorrow matches
          if (!isToday && !isTomorrow && (isDriverAssignedToWeekly || isBarangayMatch) && days.length > 0) {
            let closestNextDay = days[0] || "MON";
            let minDiff = 8;
            days.forEach((dayStr: string) => {
              const dUpper = String(dayStr).toUpperCase().slice(0, 3);
              const dayIdx = DOW_SHORT.indexOf(dUpper);
              if (dayIdx >= 0) {
                const diff = (dayIdx - todayDOW + 7) % 7 || 7;
                if (diff < minDiff) {
                  minDiff = diff;
                  closestNextDay = dUpper;
                }
              }
            });
            const nextDayIdx = DOW_SHORT.indexOf(closestNextDay);
            const nextDayName = nextDayIdx >= 0 ? DOW_FULL[nextDayIdx] : closestNextDay;
            const time = getTimeForDay(data, nextDayIdx >= 0 ? nextDayIdx : todayDOW);

            upcoming.push({
              id: `bs_upcoming_${d.id}`,
              street: streetName,
              wasteCategory: category,
              timeText: time,
              dateText: nextDayName,
              status: "pending",
              isLiveDispatch: false,
              isExclusiveAssignment: isDriverAssignedToWeekly,
              assignedDriverId: data.assignedDriverId || null,
              assignedDriverName: data.assignedDriverName || null,
            });
          }
        });

        assignedSpecialPickupsToday = specialToday;
        normalPickupsToday = normalToday;
        assignedSpecialPickupsTomorrow = specialTomorrow;
        normalPickupsTomorrow = normalTomorrow;
        upcomingPickups = upcoming;

        recomputePickups();
      },
      (error) => {
        if (error?.code !== "permission-denied") {
          console.warn(
            "DriverIndex: barangay_schedules listener error:",
            error,
          );
        }
      },
    );

    // Fetch History: door-to-door schedule items, embedded stops, resolved reports, and completed routes
    let schedHistoryList: HistoryItem[] = [];
    let repHistoryList: HistoryItem[] = [];
    let routeHistoryList: HistoryItem[] = [];

    const recomputeHistory = () => {
      const combined = [
        ...schedHistoryList,
        ...repHistoryList,
        ...routeHistoryList,
      ];
      const seenIds = new Set<string>();
      const uniqueCombined: HistoryItem[] = [];
      for (const item of combined) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          uniqueCombined.push(item);
        }
      }
      const toMillis = (ts: any) =>
        ts?.toMillis ? ts.toMillis() : new Date(ts).getTime();
      uniqueCombined.sort(
        (a, b) => toMillis(b.completedAt) - toMillis(a.completedAt),
      );
      setHistoryItems(uniqueCombined.slice(0, 5));
      setLoading(false);
    };

    const historyQuery = query(
      collection(db, "schedules"),
      where("assignedDriverId", "==", currentUser.uid),
    );

    const unsubscribeHistory = onSnapshot(
      historyQuery,
      (snapshot) => {
        const list: HistoryItem[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (Array.isArray(data.stops) && data.stops.length > 0) {
            data.stops.forEach((s: any, idx: number) => {
              if (s.completed) {
                const combinedTimestamp =
                  s.completedAt ||
                  data.completedAt ||
                  data.updatedAt ||
                  new Date();
                list.push({
                  id: `${docSnap.id}_stop_${s.order || idx + 1}`,
                  street:
                    s.name || s.street || data.street || `Stop ${idx + 1}`,
                  wasteCategory:
                    s.type === "citizen_report"
                      ? "Verified Citizen Report"
                      : data.wasteCategory || "Collection Stop",
                  completedAt: combinedTimestamp,
                  status: "completed",
                  completionImage:
                    s.completionImage || data.completionImage || null,
                });
              }
            });
          } else if (data.status === "completed" || data.status === "issue") {
            const isIssue = data.status === "issue";
            const combinedTimestamp =
              data.completedAt || data.issueReportedAt || new Date();
            list.push({
              id: docSnap.id,
              street:
                data.street ||
                data.locationName ||
                "Scheduled Collection Point",
              wasteCategory: data.wasteCategory || "General Waste",
              completedAt: combinedTimestamp,
              status: isIssue ? "issue" : "completed",
              completionImage:
                (isIssue ? data.issueImage : data.completionImage) || null,
            });
          }
        });
        schedHistoryList = list;
        recomputeHistory();
      },
      (error) => {
        if (error?.code !== "permission-denied") {
          console.warn("DriverIndex: schedules history listener error:", error);
        }
        setLoading(false);
      },
    );

    const repHistoryQuery = query(
      collection(db, "reports"),
      where("assignedDriverId", "==", currentUser.uid),
    );

    const unsubRepHistory = onSnapshot(
      repHistoryQuery,
      (snapshot) => {
        const list: HistoryItem[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const normStatus = (data.status || "")
            .toLowerCase()
            .replace(/_/g, "-");
          if (normStatus === "resolved" || normStatus === "completed") {
            const timestamp =
              data.collectedAt ||
              data.resolvedAt ||
              data.updatedAt ||
              new Date();
            list.push({
              id: `rep_${docSnap.id}`,
              street:
                data.street ||
                data.address ||
                data.locationDescription ||
                data.title ||
                "Citizen Report",
              wasteCategory: `Citizen Report • ${data.aiAnalysis?.wasteType || data.wasteType || "General"}`,
              completedAt: timestamp,
              status: "completed",
              completionImage: data.completionImage || null,
            });
          }
        });
        repHistoryList = list;
        recomputeHistory();
      },
      (err) => {
        if (err?.code !== "permission-denied") {
          console.warn("DriverIndex: report history listener error:", err);
        }
      },
    );

    const routeHistoryQuery = query(
      collection(db, "driver_route_history"),
      where("driverId", "==", currentUser.uid),
    );

    const unsubscribeRouteHistory = onSnapshot(
      routeHistoryQuery,
      (snapshot) => {
        const list: HistoryItem[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const timestamp = data.completedAt || data.createdAt || new Date();
          list.push({
            id: docSnap.id,
            street:
              data.routeName || `Brgy. ${data.barangay || "Danao City"} Route`,
            wasteCategory: `${Number(data.totalDistanceKm || 0).toFixed(1)} km · ${Number(data.durationMinutes || 0)} mins`,
            completedAt: timestamp,
            status: data.status || "completed",
            completionImage: undefined,
          });
        });
        routeHistoryList = list;
        recomputeHistory();
      },
      (error) => {
        if (error?.code !== "permission-denied") {
          console.warn("DriverIndex: route history listener error:", error);
        }
      },
    );

    return () => {
      unsubscribeNextPickup();
      unsubReports();
      unsubBarangaySchedules();
      unsubscribeHistory();
      unsubRepHistory();
      unsubscribeRouteHistory();
    };
  }, [user?.uid, assignedBarangay]);

  // Listen for current user profile & truck assignment
  useEffect(() => {
    const currentUid = auth?.currentUser?.uid || user?.uid;
    if (!db || !currentUid) return;

    const unsubUser = onSnapshot(
      doc(db, "users", currentUid),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const b = (data.assignedBarangay || data.barangay || "").trim();
          if (b) {
            setAssignedBarangay(b);
          }
          if (
            data.unassignedNotice &&
            data.unassignedNotice.acknowledged === false
          ) {
            setActiveToastAlert({
              id: "unassigned_notice",
              title: "🚛 Shift Ended",
              message: `Your shift on truck ${data.unassignedNotice.truckPlate || ""} has been ended by ${data.unassignedNotice.unassignedBy || "CENRO Fleet Management"}.`,
            });
          }
          if (data.currentTruckId) {
            // Listen to the truck document for real-time info
            const unsubTruck = onSnapshot(
              doc(db, "trucks", data.currentTruckId),
              (truckSnap) => {
                if (truckSnap.exists()) {
                  const truckData = truckSnap.data();
                  const isOnDuty =
                    (data.dutyStatus === "on_duty" ||
                      data.status === "on_duty") &&
                    Boolean(truckData.shiftStartedAt || data.shiftStartedAt);
                  setCurrentTruck({
                    id: truckSnap.id,
                    plateNumber: truckData.plateNumber || "Unknown",
                    type: truckData.type || "Truck",
                    shiftStartedAt: truckData.shiftStartedAt || data.shiftStartedAt || null,
                    assignedDriverName: truckData.assignedDriverName || truckData.driverName || undefined,
                  });
                  setIsShiftActive(isOnDuty);
                } else {
                  setCurrentTruck(null);
                  setIsShiftActive(false);
                }
              },
              (truckErr) => {
                if (truckErr?.code !== "permission-denied") {
                  console.warn("DriverIndex: truck listener error:", truckErr);
                }
              },
            );
            return () => unsubTruck();
          } else {
            setCurrentTruck(null);
            setIsShiftActive(false);
          }
        }
      },
      (userErr) => {
        if (userErr?.code !== "permission-denied") {
          console.warn("DriverIndex: user doc listener error:", userErr);
        }
      },
    );

    return () => unsubUser();
  }, [user?.uid, auth?.currentUser?.uid]);

  // Also listen directly to trucks where assignedDriverId == currentUid so CENRO Fleet Inventory assignments sync in real time
  useEffect(() => {
    const currentUid = auth?.currentUser?.uid || user?.uid;
    if (!db || !currentUid) return;

    const qAssignedTruck = query(
      collection(db, "trucks"),
      where("assignedDriverId", "==", currentUid),
    );
    const unsubAssigned = onSnapshot(
      qAssignedTruck,
      (snap) => {
        if (!snap.empty) {
          const trDoc = snap.docs[0];
          const trData = trDoc.data();
          setCurrentTruck({
            id: trDoc.id,
            plateNumber: trData.plateNumber || "Unknown",
            type: trData.type || "Truck",
            shiftStartedAt: trData.shiftStartedAt || null,
            assignedDriverName:
              trData.assignedDriverName || trData.driverName || undefined,
          });
          if (trData.shiftStartedAt) {
            setIsShiftActive(true);
          }
        }
      },
      () => {},
    );

    return () => unsubAssigned();
  }, [user?.uid, auth?.currentUser?.uid]);

  const handleCompletePickup = (id: string) => {
    if (!isShiftActive) {
      Alert.alert(
        "Read-Only Mode (Off Duty)",
        currentTruck
          ? "Please start your shift on your assigned truck before completing pickups."
          : "No truck is assigned to your account in CENRO Fleet Inventory. You can only view schedules and records until CENRO assigns you a truck.",
        [{ text: "OK", style: "default" }],
      );
      return;
    }
    // Guard: Driver cannot complete today's general schedule while route stops are still pending
    if (liveDispatches.length > 0 && (id.startsWith("bs_today_") || id.startsWith("bs_"))) {
      Alert.alert(
        "Route In Progress",
        `You have ${liveDispatches.length} collection stop(s) remaining on your active route. You must complete all stops along your route first before completing today's collection.`,
        [{ text: "OK", style: "default" }]
      );
      return;
    }
    if (nextPickup?.id === id && nextPickup.dateText && !isDateToday(nextPickup.dateText)) {
      Alert.alert(
        "Future Schedule",
        `This pickup is scheduled for ${nextPickup.dateText.toLowerCase()}. You cannot complete collections before their scheduled date.`,
      );
      return;
    }
    setSelectedPickupId(id);
    setShowCompleteModal(true);
  };

  const handleIssuePickup = (id: string) => {
    if (!isShiftActive) {
      Alert.alert(
        "Read-Only Mode (Off Duty)",
        currentTruck
          ? "Please start your shift on your assigned truck before reporting issues."
          : "No truck is assigned to your account in CENRO Fleet Inventory. You can only view schedules and records until CENRO assigns you a truck.",
        [{ text: "OK", style: "default" }],
      );
      return;
    }
    if (nextPickup?.id === id && nextPickup.dateText && !isDateToday(nextPickup.dateText)) {
      Alert.alert(
        "Future Schedule",
        `This pickup is scheduled for ${nextPickup.dateText.toLowerCase()}. You cannot report issues on future schedules before their scheduled date.`,
      );
      return;
    }
    setSelectedPickupId(id);
    setShowIssueModal(true);
  };

  const handleNavigate = (scheduleId: string) => {
    if (!isShiftActive) {
      Alert.alert(
        "Read-Only Mode (Off Duty)",
        currentTruck
          ? "Please start your shift on your assigned truck to start live route navigation."
          : "No truck is assigned to your account in CENRO Fleet Inventory. Route navigation is disabled until CENRO assigns you a truck.",
        [{ text: "OK", style: "default" }],
      );
      return;
    }
    router.push(
      `/(driver)/route-map?scheduleId=${encodeURIComponent(scheduleId)}&targetBarangay=${encodeURIComponent(assignedBarangay)}`,
    );
  };

  const handleSeeAllSchedule = () => {
    router.push("/(driver)/pages/DriverSchedulePage");
  };

  const handleSeeAllHistory = () => {
    router.push("/(driver)/pages/DriverHistoryPage");
  };

  const handleEndShift = () => {
    setShowEndShiftModal(true);
  };

  const handleVerifiedStartShift = async (
    _scannedQrData: string,
    truckInfo?: any,
  ) => {
    if (isStartingShift) return;
    const activeUid = user?.uid || auth?.currentUser?.uid;
    if (!activeUid || !db) return;

    setIsStartingShift(true);
    try {
      const truckIdToStart = currentTruck?.id || truckInfo?.truckId;
      const truckPlateToStart =
        currentTruck?.plateNumber || truckInfo?.plateNumber;
      if (!truckIdToStart) {
        Alert.alert("Error", "No vehicle identified to start duty.");
        return;
      }

      const driverName = user?.displayName || user?.email || "Driver";

      // 1. Update truck document
      await updateDoc(doc(db, "trucks", truckIdToStart), {
        assignedDriverId: activeUid,
        assignedDriverName: driverName,
        shiftStartedAt: serverTimestamp(),
        lastDriverId: activeUid,
        lastDriverName: driverName,
        lastUsedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 2. Update user document
      await updateDoc(doc(db, "users", activeUid), {
        currentTruckId: truckIdToStart,
        currentTruckPlate: truckPlateToStart || null,
        dutyStatus: "on_duty",
        status: "on_duty",
        updatedAt: serverTimestamp(),
      });

      // 3. Log usage history
      try {
        await addDoc(collection(db, "truck_usage_history"), {
          truckId: truckIdToStart,
          truckPlate: truckPlateToStart || "",
          driverId: activeUid,
          driverName: driverName,
          barangay: assignedBarangay || "Poblacion",
          action: "shift_started_qr_scan",
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
          status: "active",
        });
      } catch (e) {
        console.warn("Could not log shift start history:", e);
      }

      // 4. Trigger auto-assign queued reports
      try {
        autoAssignQueuedReportsOnDriverShiftStart(
          activeUid,
          assignedBarangay || "Poblacion",
          truckIdToStart,
          truckPlateToStart,
        ).catch(() => {});
      } catch {}

      setShowStartShiftScannerModal(false);
      setIsShiftActive(true);
      Alert.alert(
        "On Duty Active",
        `Successfully verified QR for truck ${truckPlateToStart || ""}. You are now On Duty!`,
      );
    } catch (err: any) {
      console.error("Failed to start shift via QR:", err);
      Alert.alert("Error", err.message || "Failed to start shift.");
    } finally {
      setIsStartingShift(false);
    }
  };

  const handleManualStartDuty = () => {
    if (!currentTruck) {
      Alert.alert(
        "Pending Truck Assignment",
        "No truck is currently assigned to your account in CENRO Fleet Inventory. Please wait for CENRO to assign a truck.",
      );
      return;
    }
    Alert.alert(
      "Start Duty Confirmation",
      `Begin your municipal collection shift on truck ${currentTruck.plateNumber}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Start Duty",
          onPress: () => handleVerifiedStartShift("manual_confirmation"),
        },
      ],
    );
  };

  const handleVerifiedEndShift = async (_scannedQrData: string) => {
    if (isEndingShift) return;
    setIsEndingShift(true);

    try {
      const activeUid = user?.uid || auth?.currentUser?.uid;
      if (activeUid && db) {
        // 1. Calculate shift attendance timings
        const timing = calculateShiftTiming(currentTruck?.shiftStartedAt);
        const driverName = user?.displayName || user?.email || "Driver";

        // 2. Stop location simulation and tracking
        try {
          if (simulationState.isActive) {
            await locationService.stopSimulation(activeUid);
          }
          await locationService.stopTracking(activeUid);
        } catch (locErr) {
          console.warn(
            "Error stopping location tracking on end shift:",
            locErr,
          );
        }

        // 3. Identify truck to release
        let targetTruckId = currentTruck?.id;
        if (!targetTruckId) {
          try {
            const userSnap = await getDoc(doc(db, "users", activeUid));
            targetTruckId = userSnap.data()?.currentTruckId;
          } catch {}
        }

        // 4. Release truck document in /trucks & record last driver (strictly rules-compliant)
        if (targetTruckId) {
          try {
            await updateDoc(doc(db, "trucks", targetTruckId), {
              assignedDriverId: null,
              assignedDriverName: null,
              shiftStartedAt: null,
              lastDriverId: activeUid,
              lastDriverName: driverName,
              lastUsedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (truckErr) {
            console.warn(
              "Could not release truck document on end shift:",
              truckErr,
            );
          }

          // 5. Log shift completion with Time In & Time Out in truck_usage_history
          try {
            await addDoc(collection(db, "truck_usage_history"), {
              truckId: targetTruckId,
              truckPlate: currentTruck?.plateNumber || "",
              driverId: activeUid,
              driverName: driverName,
              driverEmail: user?.email || "",
              barangay:
                assignedBarangay ||
                (user as any)?.assignedBarangay ||
                "Poblacion",
              action: "shift_ended",
              verifiedVia: "fleet_inventory_qr",
              timeIn: timing.timeIn,
              timeOut: serverTimestamp(),
              durationMinutes: timing.durationMinutes,
              durationFormatted: timing.durationFormatted,
              timestamp: serverTimestamp(),
              createdAt: serverTimestamp(),
              status: "completed",
            });
          } catch (histErr) {
            console.warn(
              "Could not log shift end to truck_usage_history:",
              histErr,
            );
          }
        }

        // 5.5. Revert any uncollected in-progress reports back to queue (Shopee Fallback)
        try {
          await revertUncollectedReportsOnDriverShiftEnd(activeUid);
        } catch (revErr) {
          console.warn("Could not revert uncollected reports on end shift:", revErr);
        }

        // 6. Update driver profile in /users to off-duty (rules-compliant)
        try {
          await updateDoc(doc(db, "users", activeUid), {
            currentTruckId: null,
            currentTruckPlate: null,
            assignedTruck: null,
            status: "off_duty",
            dutyStatus: "off_duty",
            unassignedNotice: {
              acknowledged: true,
              truckPlate: currentTruck?.plateNumber || null,
              unassignedBy: "Driver QR Scan",
              unassignedAt: new Date().toISOString(),
            },
            updatedAt: serverTimestamp(),
          });
        } catch (userErr) {
          console.warn("Could not update user profile on end shift:", userErr);
        }

        // 7. Update /truck_locations status
        try {
          await setDoc(
            doc(db, "truck_locations", activeUid),
            {
              status: "inactive",
              isBroadcasting: false,
              lastUpdate: serverTimestamp(),
            },
            { merge: true },
          );
        } catch (locErr) {
          console.warn(
            "Could not update truck_locations on end shift:",
            locErr,
          );
        }

        // 8. Close scanner and display Shift Attendance Summary Modal
        setShowEndShiftScannerModal(false);
        setCompletedShiftSummary({
          truckPlate: currentTruck?.plateNumber || "Truck",
          driverName: driverName,
          timeInFormatted: timing.timeInFormatted,
          timeOutFormatted: timing.timeOutFormatted,
          durationFormatted: timing.durationFormatted,
        });
      }
    } catch (e: any) {
      console.error("End shift verification error:", e);
      Alert.alert(
        "Error",
        e.message ||
          "Failed to complete end shift verification. Please try again.",
      );
    } finally {
      setIsEndingShift(false);
    }
  };

  const handleFinishShiftSummary = async () => {
    setIsShiftActive(false);
    setCurrentTruck(null);
    setCompletedShiftSummary(null);
    setShowEndShiftModal(false);

    const origin = await getDriverSessionOrigin();
    if (origin === "resident") {
      // Came from resident portal -> return to resident portal without logging out
      router.replace("/(tabs)/home");
    } else {
      // Came from login screen -> sign out completely to login screen
      try {
        await auth.signOut();
      } catch (err) {
        console.warn("Sign out error on end shift:", err);
      }
      await clearDriverSessionOrigin();
      router.replace("/auth");
    }
  };

  if (loading) {
    return (
      <View
        style={[
          styles.container,
          isDark && styles.containerDark,
          styles.center,
        ]}
      >
        <ActivityIndicator
          size="large"
          color={isDark ? "#86EFAC" : "#4E6C50"}
        />
      </View>
    );
  }

  return (
    <View style={[styles.screenWrapper, isDark && styles.containerDark]}>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor={isDark ? "#111827" : "#F4FBF1"}
      />

      {/* Persistent Header - Safe from notch and status bar */}
      <View
        style={[
          styles.header,
          isDark && styles.headerDark,
          {
            paddingTop: Math.max(insets.top, StatusBar.currentHeight || 0) + 12,
          },
        ]}
      >
        <View style={styles.logoContainer}>
          <Image
            source={require("@/assets/images/trashtrack_logo_driver.png")}
            style={styles.logoIcon}
            resizeMode="contain"
          />
          <Text style={[styles.logoText, isDark && styles.textLight]}>
            TrashTrack
          </Text>
        </View>

        <View style={styles.headerRight}>
          {sessionOrigin === "login" ? (
            <TouchableOpacity
              onPress={async () => {
                if (isShiftActive) {
                  setShowActiveShiftModal(true);
                  return;
                }
                Alert.alert(
                  "Driver Sign Out",
                  "Are you sure you want to sign out of the Driver Cockpit?",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Sign Out",
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await auth.signOut();
                        } catch {}
                        await clearDriverSessionOrigin();
                        router.replace("/auth");
                      },
                    },
                  ],
                );
              }}
              style={[
                styles.backToPortalBtn,
                {
                  backgroundColor: isDark
                    ? "rgba(239, 68, 68, 0.15)"
                    : "#FEE2E2",
                  borderColor: isDark ? "rgba(239, 68, 68, 0.3)" : "#FECACA",
                  borderWidth: 1,
                },
              ]}
              activeOpacity={0.75}
              accessibilityLabel="Sign Out of Driver Cockpit"
            >
              <Feather
                name="log-out"
                size={14}
                color={isDark ? "#FCA5A5" : "#DC2626"}
              />
              <Text
                style={[
                  styles.backToPortalText,
                  { color: isDark ? "#FCA5A5" : "#DC2626", fontWeight: "700" },
                ]}
              >
                Log Out
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => {
                if (isShiftActive) {
                  setShowActiveShiftModal(true);
                  return;
                }
                router.replace("/(tabs)/home");
              }}
              style={[
                styles.backToPortalBtn,
                {
                  backgroundColor: isDark
                    ? "rgba(16, 185, 129, 0.15)"
                    : "#ECFDF5",
                  borderColor: isDark ? "rgba(16, 185, 129, 0.3)" : "#A7F3D0",
                  borderWidth: 1,
                  borderRadius: 8,
                },
              ]}
              activeOpacity={0.75}
              accessibilityLabel="Switch to Resident Portal"
            >
              <MaterialIcons
                name="home"
                size={14}
                color={isDark ? "#86EFAC" : "#059669"}
              />
              <Text
                style={[
                  styles.backToPortalText,
                  { color: isDark ? "#86EFAC" : "#059669", fontWeight: "700" },
                ]}
              >
                Resident App
              </Text>
            </TouchableOpacity>
          )}
          <View
            style={[
              styles.driverStatusBadge,
              isShiftActive
                ? styles.driverStatusOnDuty
                : styles.driverStatusOffDuty,
              isDark &&
                (isShiftActive
                  ? styles.driverStatusOnDutyDark
                  : styles.driverStatusOffDutyDark),
            ]}
          >
            <View
              style={[
                styles.driverStatusDot,
                { backgroundColor: isShiftActive ? "#22C55E" : "#9CA3AF" },
              ]}
            />
            <Text
              style={[
                styles.driverStatusBadgeText,
                {
                  color: isShiftActive
                    ? isDark
                      ? "#86EFAC"
                      : "#15803D"
                    : isDark
                      ? "#D1D5DB"
                      : "#6B7280",
                },
              ]}
            >
              {isShiftActive ? "ON DUTY" : "OFF DUTY"}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={[styles.container, isDark && styles.containerDark]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Real-Time AI Route Waypoint Alert Banner */}
        {activeToastAlert && (
          <View
            style={[styles.toastAlertCard, isDark && styles.toastAlertCardDark]}
          >
            <View style={styles.toastAlertIconWrapper}>
              <MaterialIcons
                name={
                  activeToastAlert.type === "route_waypoint_added"
                    ? "navigation"
                    : "notifications-active"
                }
                size={20}
                color="#FFFFFF"
              />
            </View>
            <View style={styles.toastAlertTextWrapper}>
              <Text style={styles.toastAlertTitleText}>
                {activeToastAlert.title}
              </Text>
              <Text
                style={[
                  styles.toastAlertMessageText,
                  isDark && styles.textLight,
                ]}
                numberOfLines={2}
              >
                {activeToastAlert.message}
              </Text>
            </View>
            <View style={styles.toastAlertActionsRow}>
              {activeToastAlert.type === "route_waypoint_added" ? (
                <TouchableOpacity
                  style={styles.toastAlertViewBtn}
                  onPress={() => {
                    if (db && activeToastAlert.id) {
                      updateDoc(doc(db, "notifications", activeToastAlert.id), {
                        read: true,
                      }).catch(() => {});
                    }
                    setActiveToastAlert(null);
                    router.push(
                      `/(driver)/route-map?targetBarangay=${encodeURIComponent(assignedBarangay)}`,
                    );
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.toastAlertViewBtnText}>View Route</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.toastAlertAckBtn}
                  onPress={() => {
                    if (db && activeToastAlert.id) {
                      updateDoc(doc(db, "notifications", activeToastAlert.id), {
                        read: true,
                      }).catch(() => {});
                    }
                    setActiveToastAlert(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.toastAlertAckBtnText}>Dismiss</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.toastAlertDismissBtn}
                onPress={() => {
                  if (db && activeToastAlert.id) {
                    updateDoc(doc(db, "notifications", activeToastAlert.id), {
                      read: true,
                    }).catch(() => {});
                  }
                  setActiveToastAlert(null);
                }}
                activeOpacity={0.7}
              >
                <MaterialIcons name="close" size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 📢 CENRO Active Emergency Broadcast Cockpit Card */}
        {systemOverrides.activeEmergencyBroadcast?.active && (
          <View style={[styles.emergencyDashboardCard, { backgroundColor: '#FEF2F2', borderColor: '#F87171' }]}>
            <View style={styles.emergencyDashboardLeft}>
              <View style={[styles.emergencyDashboardIconWrap, { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}>
                <MaterialIcons
                  name="campaign"
                  size={24}
                  color="#DC2626"
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={[styles.emergencyTagRow, { justifyContent: 'space-between' }]}>
                  <View style={[styles.emergencyTagPill, { backgroundColor: 'rgba(220, 38, 38, 0.12)' }]}>
                    <Text style={[styles.emergencyTagText, { color: '#DC2626' }]}>
                      {systemOverrides.activeEmergencyBroadcast.priority === 'urgent'
                        ? '🚨 URGENT CALAMITY ALERT'
                        : '⚡ CENRO BROADCAST'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DC2626', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}
                    onPress={() => {
                      if (systemOverrides.activeEmergencyBroadcast) {
                        announceEmergencyBroadcast(
                          systemOverrides.activeEmergencyBroadcast.subject,
                          systemOverrides.activeEmergencyBroadcast.message
                        );
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="volume-up" size={14} color="#FFFFFF" />
                    <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>Listen</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.emergencyTitleText}>
                  {systemOverrides.activeEmergencyBroadcast.subject}
                </Text>
                <Text style={styles.emergencyDescText}>
                  {systemOverrides.activeEmergencyBroadcast.message}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* 🚨 CENRO Emergency Override Dashboard Banner */}
        {systemOverrides.forcePauseCollection ? (

          <View style={styles.emergencyDashboardCard}>
            <View style={styles.emergencyDashboardLeft}>
              <View style={styles.emergencyDashboardIconWrap}>
                <MaterialIcons
                  name="pause-circle-filled"
                  size={24}
                  color="#DC2626"
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.emergencyTagRow}>
                  <View style={styles.emergencyTagPill}>
                    <Text style={styles.emergencyTagText}>CENRO DIRECTIVE</Text>
                  </View>
                  <View style={styles.emergencyStatusPill}>
                    <View style={styles.emergencyDot} />
                    <Text style={styles.emergencyStatusText}>FLEET PAUSED</Text>
                  </View>
                </View>
                <Text style={styles.emergencyTitleText}>
                  Collection Operations Halted
                </Text>
                <Text style={styles.emergencyDescText}>
                  {systemOverrides.forcePauseReason ||
                    "Immediate municipal halt due to emergency conditions (e.g. severe flooding / calamity). Safely pull over and standby at depot or safe zone."}
                </Text>
              </View>
            </View>
          </View>
        ) : systemOverrides.severeWeatherProtocol ? (
          <View style={styles.weatherDashboardCard}>
            <View style={styles.emergencyDashboardLeft}>
              <View
                style={[
                  styles.emergencyDashboardIconWrap,
                  { backgroundColor: "#E0F2FE", borderColor: "#7DD3FC" },
                ]}
              >
                <MaterialIcons name="thunderstorm" size={24} color="#0284C7" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.weatherTagRow}>
                  <View style={styles.weatherTagPill}>
                    <Text style={styles.weatherTagText}>
                      CALAMITY & FLOOD DEFENSE
                    </Text>
                  </View>
                  <View style={styles.weatherStatusPill}>
                    <View
                      style={[
                        styles.emergencyDot,
                        { backgroundColor: "#0284C7" },
                      ]}
                    />
                    <Text style={styles.weatherStatusText}>REROUTE ACTIVE</Text>
                  </View>
                </View>
                <Text style={styles.weatherTitleText}>
                  Severe Weather Warning
                </Text>
                <Text style={styles.weatherDescText}>
                  PAGASA heavy rainfall alert active. Drivers must bypass
                  low-elevation riverbanks and flood basins, rerouting through
                  elevated arterial roads.
                </Text>
              </View>
            </View>
          </View>
        ) : systemOverrides.surgePriorityMode ? (
          <View style={styles.surgeDashboardCard}>
            <View style={styles.emergencyDashboardLeft}>
              <View
                style={[
                  styles.emergencyDashboardIconWrap,
                  { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" },
                ]}
              >
                <MaterialIcons name="speed" size={24} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.surgeTagRow}>
                  <View style={styles.surgeTagPill}>
                    <Text style={styles.surgeTagText}>LOGISTICS OVERRIDE</Text>
                  </View>
                  <View style={styles.surgeStatusPill}>
                    <View
                      style={[
                        styles.emergencyDot,
                        { backgroundColor: "#D97706" },
                      ]}
                    />
                    <Text style={styles.surgeStatusText}>SURGE PRIORITY</Text>
                  </View>
                </View>
                <Text style={styles.surgeTitleText}>
                  Overload Surge Priority Mode
                </Text>
                <Text style={styles.surgeDescText}>
                  Fast-track commercial hubs (Public Market, Commercial Port,
                  Poblacion). Express turnaround dumping at MRF is authorized to
                  clear overflow build-up.
                </Text>
                <View style={styles.surgeChipsRow}>
                  <View style={styles.surgeChip}>
                    <MaterialIcons name="flash-on" size={13} color="#B45309" />
                    <Text style={styles.surgeChipText}>MRF Fast-Track</Text>
                  </View>
                  <View style={styles.surgeChip}>
                    <MaterialIcons
                      name="storefront"
                      size={13}
                      color="#B45309"
                    />
                    <Text style={styles.surgeChipText}>Hub Priority</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* Welcome & Shift Section */}
        <View style={[styles.welcomeSection, isDark && styles.cardDark]}>
          <View style={styles.welcomeLeft}>
            <Text style={[styles.welcomeText, isDark && styles.textMuted]}>
              Welcome back, {user?.displayName || "Driver"}
            </Text>
            <Text
              style={[
                styles.statusText,
                {
                  color: isShiftActive
                    ? isDark
                      ? "#86EFAC"
                      : "#2E8B57"
                    : isDark
                      ? "#6B7280"
                      : "#9CA3AF",
                },
              ]}
            >
              {isShiftActive
                ? "Active Shift"
                : currentTruck
                  ? "Assigned • Off Duty"
                  : "Unassigned • Read-Only"}
            </Text>
            {currentTruck && (
              <View style={styles.truckBadgeRow}>
                <MaterialIcons
                  name="local-shipping"
                  size={14}
                  color={isDark ? "#86EFAC" : "#2E8B57"}
                />
                <Text
                  style={[
                    styles.truckBadgeText,
                    isDark && { color: "#86EFAC" },
                  ]}
                >
                  {currentTruck.plateNumber} • {currentTruck.type}
                </Text>
              </View>
            )}
            {currentTruck && shiftTimingInfo && isShiftActive && (
              <View style={[styles.truckBadgeRow, { marginTop: 3 }]}>
                <MaterialIcons
                  name="access-time"
                  size={13}
                  color={isDark ? "#86EFAC" : "#059669"}
                />
                <Text
                  style={[
                    styles.truckBadgeText,
                    { color: isDark ? "#86EFAC" : "#059669", fontSize: 11 },
                  ]}
                >
                  Time In: {shiftTimingInfo.timeInFormatted}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.shiftActions}>
            {isShiftActive ? (
              <TouchableOpacity
                onPress={handleEndShift}
                style={styles.endShiftBtn}
              >
                <MaterialIcons
                  name="power-settings-new"
                  size={18}
                  color="#DC2626"
                />
                <Text style={styles.endShiftText}>End Shift</Text>
              </TouchableOpacity>
            ) : currentTruck ? (
              <TouchableOpacity
                onPress={() => setShowStartShiftScannerModal(true)}
                style={[
                  styles.endShiftBtn,
                  { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
                ]}
              >
                <MaterialIcons
                  name="qr-code-scanner"
                  size={18}
                  color="#059669"
                />
                <Text style={[styles.endShiftText, { color: "#059669" }]}>
                  Scan Truck
                </Text>
              </TouchableOpacity>
            ) : (
              <View
                style={[
                  styles.endShiftBtn,
                  {
                    backgroundColor: isDark ? "rgba(148, 163, 184, 0.12)" : "#F1F5F9",
                    borderColor: isDark ? "#334155" : "#CBD5E1",
                  },
                ]}
              >
                <MaterialIcons
                  name="lock-outline"
                  size={16}
                  color={isDark ? "#94A3B8" : "#64748B"}
                />
                <Text
                  style={[
                    styles.endShiftText,
                    { color: isDark ? "#94A3B8" : "#64748B" },
                  ]}
                >
                  No Truck Assigned
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Pending Duty Card: Assigned by CENRO, awaiting QR scan or manual confirmation to go On Duty ── */}
        {!isShiftActive && currentTruck && (
          <View
            style={[
              styles.pendingDutyBanner,
              isDark && styles.pendingDutyBannerDark,
            ]}
          >
            <View style={styles.pendingDutyLeft}>
              <View style={styles.pendingDutyIconCircle}>
                <MaterialIcons
                  name="qr-code-scanner"
                  size={24}
                  color="#059669"
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.pendingDutyTagRow}>
                  <View style={styles.pendingDutyTag}>
                    <Text style={styles.pendingDutyTagText}>
                      ASSIGNED • OFF DUTY
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.pendingDutyPlateText,
                      isDark && styles.textLight,
                    ]}
                  >
                    {currentTruck.plateNumber}
                  </Text>
                </View>
                <Text
                  style={[styles.pendingDutyDesc, isDark && styles.textMuted]}
                >
                  Assigned by Fleet Management. Scan the Fleet QR badge to go On
                  Duty and initiate route navigation.
                </Text>
              </View>
            </View>
            <View style={styles.pendingDutyActionsRow}>
              <TouchableOpacity
                style={styles.pendingDutyScanBtn}
                onPress={() => setShowStartShiftScannerModal(true)}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name="qr-code-scanner"
                  size={16}
                  color="#FFFFFF"
                />
                <Text style={styles.pendingDutyScanBtnText}>Scan Truck QR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pendingDutyManualBtn,
                  isDark && styles.pendingDutyManualBtnDark,
                ]}
                onPress={handleManualStartDuty}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name="play-arrow"
                  size={16}
                  color={isDark ? "#86EFAC" : "#059669"}
                />
                <Text
                  style={[
                    styles.pendingDutyManualBtnText,
                    isDark && { color: "#86EFAC" },
                  ]}
                >
                  Start Duty
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* AI Shift Fuel Advisor Card */}
        {isShiftActive && !!currentTruck && shiftFuelRec && (
          <View
            style={[
              styles.fuelAdvisorCard,
              isDark && styles.fuelAdvisorCardDark,
            ]}
          >
            <View style={styles.fuelAdvisorHeader}>
              <View style={styles.fuelAdvisorHeaderLeft}>
                <View style={styles.fuelAdvisorIconCircle}>
                  <MaterialIcons
                    name="local-gas-station"
                    size={18}
                    color="#FFFFFF"
                  />
                </View>
                <View>
                  <Text
                    style={[
                      styles.fuelAdvisorTitle,
                      isDark && styles.textLight,
                    ]}
                  >
                    {shiftFuelRec.isAiLearned
                      ? "Shift Refueling Target"
                      : "Route Baseline Target"}
                  </Text>
                  <Text
                    style={[
                      styles.fuelAdvisorSubtitle,
                      isDark && styles.textMuted,
                    ]}
                  >
                    {shiftFuelRec.isAiLearned
                      ? `AI Calibrated • ${shiftFuelRec.eligibleTripsCount} verified shifts`
                      : `Road Baseline • ${shiftFuelRec.eligibleTripsCount}/${shiftFuelRec.learningThreshold} shifts (Calibrating)`}
                  </Text>
                </View>
              </View>

              <View style={styles.fuelAdvisorTargetPill}>
                <Text style={styles.fuelAdvisorTargetNumber}>
                  {shiftFuelRec.totalRecommendedLiters.toFixed(1)} L
                </Text>
                {shiftFuelRec.estimatedCostPhp !== null && (
                  <Text style={styles.fuelAdvisorTargetCost}>
                    ≈ ₱{shiftFuelRec.estimatedCostPhp.toFixed(0)}
                  </Text>
                )}
              </View>
            </View>

            {/* Quick Metrics Strip */}
            <View
              style={[
                styles.fuelAdvisorMetricsRow,
                isDark && { backgroundColor: "#1F2937" },
              ]}
            >
              <View style={styles.fuelAdvisorMetricCol}>
                <Text style={styles.fuelAdvisorMetricLabel}>Route Base</Text>
                <Text
                  style={[
                    styles.fuelAdvisorMetricValue,
                    isDark && styles.textLight,
                  ]}
                >
                  {shiftFuelRec.usualBaselineLiters.toFixed(1)} L
                </Text>
              </View>

              <View style={styles.fuelAdvisorMetricDivider} />

              <View style={styles.fuelAdvisorMetricCol}>
                <Text style={styles.fuelAdvisorMetricLabel}>
                  Report Detours
                </Text>
                <Text
                  style={[
                    styles.fuelAdvisorMetricValue,
                    {
                      color:
                        shiftFuelRec.reportExtraLiters > 0
                          ? "#D97706"
                          : isDark
                            ? "#9CA3AF"
                            : "#6B7280",
                    },
                  ]}
                >
                  {shiftFuelRec.reportExtraLiters > 0
                    ? `+${shiftFuelRec.reportExtraLiters.toFixed(1)} L`
                    : "0.0 L"}
                </Text>
              </View>

              <View style={styles.fuelAdvisorMetricDivider} />

              <View style={styles.fuelAdvisorMetricCol}>
                <Text style={styles.fuelAdvisorMetricLabel}>Reserve (10%)</Text>
                <Text
                  style={[styles.fuelAdvisorMetricValue, { color: "#2563EB" }]}
                >
                  +{shiftFuelRec.safetyReserveLiters.toFixed(1)} L
                </Text>
              </View>
            </View>

            {/* Notice if any citizen reports were deferred to next shift */}
            {deferredReportsCount > 0 && (
              <View style={styles.fuelAdvisorDeferredNotice}>
                <MaterialIcons name="schedule" size={14} color="#D97706" />
                <Text style={styles.fuelAdvisorDeferredText}>
                  {deferredReportsCount} report(s) scheduled for next shift to
                  protect your safe fuel capacity limit.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Interactive Live Route Mini-Map Card - Active when Driver is ON DUTY with assigned truck */}
        {isShiftActive && !!currentTruck && (
          <View
            style={[
              styles.miniMapCard,
              isDark && styles.miniMapCardDark,
              simulationState.isActive && styles.miniMapCardActive,
            ]}
          >
            {/* Mini-Map Header Bar */}
            <View style={styles.miniMapHeader}>
              <View style={styles.miniMapHeaderLeft}>
                <View
                  style={[
                    styles.miniMapLivePill,
                    isDark && styles.miniMapLivePillDark,
                  ]}
                >
                  <View
                    style={[
                      styles.miniMapLiveDot,
                      simulationState.isActive && {
                        backgroundColor: "#16A34A",
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.miniMapLiveText,
                      isDark && { color: "#86EFAC" },
                    ]}
                  >
                    {simulationState.isActive ? "LIVE TELEMETRY" : "ROUTE MAP"}
                  </Text>
                </View>
                <Text
                  style={[styles.miniMapTitle, isDark && styles.textLight]}
                  numberOfLines={1}
                >
                  Brgy. {assignedBarangay} Path
                </Text>
              </View>

              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <TouchableOpacity
                  style={[
                    styles.recenterMiniMapBtn,
                    isDark && styles.recenterMiniMapBtnDark,
                  ]}
                  onPress={() => {
                    if (currentTruckCoord && miniMapRef.current) {
                      miniMapRef.current.setCenter(
                        currentTruckCoord.latitude,
                        currentTruckCoord.longitude,
                        16,
                      );
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name="my-location"
                    size={13}
                    color={isDark ? "#86EFAC" : "#166534"}
                  />
                  <Text
                    style={[
                      styles.recenterMiniMapBtnText,
                      isDark && { color: "#86EFAC" },
                    ]}
                  >
                    Center
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.expandMapBtn,
                    isDark && styles.expandMapBtnDark,
                  ]}
                  onPress={() =>
                    router.push(
                      `/(driver)/route-map?targetBarangay=${encodeURIComponent(assignedBarangay)}`,
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Feather
                    name="maximize-2"
                    size={13}
                    color={isDark ? "#86EFAC" : "#166534"}
                  />
                  <Text
                    style={[
                      styles.expandMapBtnText,
                      isDark && { color: "#86EFAC" },
                    ]}
                  >
                    Full Map
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Interactive Mini-Map Canvas */}
            <View
              style={[
                styles.mapCanvasContainer,
                isDark && styles.mapCanvasContainerDark,
              ]}
            >
              <ErrorBoundary
                resetOnPropChange={
                  assignedBarangay + "_" + (isDark ? "dark" : "light")
                }
                fallback={
                  <View
                    style={[
                      styles.miniMapCanvas,
                      {
                        justifyContent: "center",
                        alignItems: "center",
                        backgroundColor: isDark ? "#1F2937" : "#F3F4F6",
                        padding: 16,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="map"
                      size={32}
                      color={isDark ? "#9CA3AF" : "#6B7280"}
                    />
                    <Text
                      style={{
                        color: isDark ? "#E5E7EB" : "#374151",
                        marginTop: 8,
                        fontSize: 13,
                        fontWeight: "600",
                      }}
                    >
                      Route Map: Brgy. {assignedBarangay}
                    </Text>
                    <Text
                      style={{
                        color: isDark ? "#9CA3AF" : "#6B7280",
                        marginTop: 4,
                        fontSize: 11,
                        textAlign: "center",
                      }}
                    >
                      Live map preview standby. Tap &quot;Full Map&quot; above
                      for navigation.
                    </Text>
                  </View>
                }
              >
                <OpenStreetMap
                  ref={miniMapRef}
                  style={styles.miniMapCanvas}
                  initialCenter={miniMapInitialCenter}
                  zoom={16}
                  polyline={activeMiniMapPolyline}
                  polylineColor="#2E8B57"
                  truckCoordinate={currentTruckCoord}
                  centerOnTruck={true}
                  isDark={isDark}
                  interactive={false}
                />
              </ErrorBoundary>

              {/* Floating Re-center FAB directly on map */}
              <TouchableOpacity
                style={[
                  styles.floatingRecenterFab,
                  isDark && styles.floatingRecenterFabDark,
                ]}
                onPress={() => {
                  if (currentTruckCoord && miniMapRef.current) {
                    miniMapRef.current.setCenter(
                      currentTruckCoord.latitude,
                      currentTruckCoord.longitude,
                      16,
                    );
                  }
                }}
                activeOpacity={0.8}
                accessibilityLabel="Center on GPS location"
              >
                <MaterialIcons
                  name="gps-fixed"
                  size={16}
                  color={isDark ? "#86EFAC" : "#166534"}
                />
              </TouchableOpacity>

              {/* Floating Live Telemetry Bar */}
              <View
                style={[
                  styles.telemetryOverlay,
                  isDark && styles.telemetryOverlayDark,
                ]}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <MaterialIcons
                    name={
                      simulationState.isActive || isActualDriving
                        ? "navigation"
                        : "location-on"
                    }
                    size={15}
                    color={isDark ? "#86EFAC" : "#16A34A"}
                  />
                  <Text
                    style={[
                      styles.telemetryStreetText,
                      isDark && styles.textLight,
                    ]}
                    numberOfLines={1}
                  >
                    {simulationState.isActive
                      ? simulationState.locationName
                      : isActualDriving
                        ? `Live Physical GPS · Brgy. ${assignedBarangay}`
                        : `Sector: Brgy. ${assignedBarangay}`}
                  </Text>
                </View>
                <View
                  style={[
                    styles.telemetrySpeedBox,
                    isDark && styles.telemetrySpeedBoxDark,
                  ]}
                >
                  <Text
                    style={[
                      styles.telemetrySpeedVal,
                      {
                        color:
                          simulationState.isActive || isActualDriving
                            ? simulationState.currentSpeedKph >= 60
                              ? "#DC2626"
                              : "#16A34A"
                            : isDark
                              ? "#9CA3AF"
                              : "#6B7280",
                      },
                    ]}
                  >
                    {simulationState.isActive
                      ? `${simulationState.currentSpeedKph} km/h`
                      : isActualDriving
                        ? "GPS Live"
                        : "Standby"}
                  </Text>
                </View>
              </View>
            </View>

            {/* Speed Selector Pills when Simulation is Active */}
            {simulationState.isActive && (
              <View
                style={[
                  styles.miniMapSpeedStrip,
                  isDark && {
                    backgroundColor: "#111827",
                    borderColor: "#374151",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.miniMapSpeedStripLabel,
                    isDark && styles.textMuted,
                  ]}
                >
                  Speed Ratio:
                </Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {[
                    { label: "1x (1:1)", val: 1 },
                    { label: "2x", val: 2 },
                    { label: "5x", val: 5 },
                    { label: "10x", val: 10 },
                  ].map((s) => {
                    const isSel =
                      (simulationState.speedMultiplier || 1) === s.val;
                    return (
                      <TouchableOpacity
                        key={s.val}
                        onPress={() =>
                          locationService.setSimulationSpeed(s.val)
                        }
                        style={[
                          styles.miniMapSpeedPill,
                          isSel && styles.miniMapSpeedPillActive,
                          isDark && { backgroundColor: "#1F2937" },
                          isSel && isDark && { backgroundColor: "#16A34A" },
                        ]}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.miniMapSpeedPillText,
                            isSel && { color: "#FFFFFF", fontWeight: "800" },
                          ]}
                        >
                          {s.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Mini-Map Simulator & Telemetry Controls */}
            <View style={styles.miniMapFooter}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={[
                    styles.miniMapFooterLabel,
                    isDark && styles.textMuted,
                  ]}
                  numberOfLines={1}
                >
                  {simulationState.isActive
                    ? `⏱️ ${formatMinutesSeconds(simulationState.elapsedDurationSeconds || 0)} / ${formatMinutesSeconds(simulationState.totalDurationSeconds || 600)} (${simulationState.speedMultiplier}x)`
                    : isActualDriving
                      ? `📍 Live Physical GPS Active (Brgy. ${assignedBarangay})`
                      : `Truck: ${currentTruck.plateNumber}`}
                </Text>
                <Text
                  style={[styles.miniMapFooterSub, isDark && styles.textLight]}
                  numberOfLines={1}
                >
                  {simulationState.isActive
                    ? `⛽ ${(simulationState.fuelBurnedLiters || 0).toFixed(2)} L of ${(simulationState.totalEstimatedFuelLiters || 0).toFixed(1)} L (≈ ₱${(simulationState.fuelCostBurnedPhp || 0).toFixed(0)})`
                    : isActualDriving
                      ? "Broadcasting live phone movement"
                      : "GPS navigation active"}
                </Text>
              </View>

              {!(simulationState.isActive || isActualDriving) ? (
                <TouchableOpacity
                  style={[styles.simDriveBtn, styles.simDriveBtnStart]}
                  onPress={handleToggleSimulation}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="play-arrow" size={16} color="#FFFFFF" />
                  <Text style={styles.simDriveBtnText}>Start Drive</Text>
                </TouchableOpacity>
              ) : (
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <TouchableOpacity
                    style={[styles.simDriveBtn, styles.simDriveBtnStop]}
                    onPress={handleStopDrive}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="stop" size={16} color="#FFFFFF" />
                    <Text style={styles.simDriveBtnText}>Stop</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.simDriveBtn, styles.simDriveBtnComplete]}
                    onPress={handleCompleteRoute}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons
                      name="check-circle"
                      size={16}
                      color="#FFFFFF"
                    />
                    <Text style={styles.simDriveBtnText}>Complete</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.simDriveBtn, { backgroundColor: "#D97706" }]}
                    onPress={handleTriggerTestStationaryPrompt}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="timer" size={16} color="#FFFFFF" />
                    <Text style={styles.simDriveBtnText}>5m Stop</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Live Dispatches (AI Optimized Routes) */}
        {isShiftActive && liveDispatches.length > 0 && (
          <View
            style={[
              styles.alertsContainer,
              isDark && styles.alertsContainerDark,
            ]}
          >
            <View style={styles.alertHeader}>
              <View style={styles.liveIndicator}>
                <View style={styles.pulsingDot} />
                <Text
                  style={[styles.alertTitle, isDark && { color: "#C4B5FD" }]}
                >
                  LIVE COLLECTION ROUTE ({liveDispatches.length}{" "}
                  {liveDispatches.length === 1 ? "STOP" : "STOPS"})
                </Text>
              </View>
              <Text
                style={[styles.alertSubtitle, isDark && { color: "#A78BFA" }]}
              >
                AI Optimized Collection Sequence
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.alertsScroll}
              contentContainerStyle={{ paddingRight: 32 }}
            >
              {liveDispatches.map((dispatch, index) => (
                <View
                  key={dispatch.id}
                  style={[styles.alertCard, isDark && styles.alertCardDark]}
                >
                  <View style={styles.alertRouteBadge}>
                    <Text style={styles.alertRouteNumber}>{index + 1}</Text>
                  </View>
                  <View style={styles.alertCardContent}>
                    <Text
                      style={[styles.alertStreet, isDark && styles.textLight]}
                      numberOfLines={1}
                    >
                      {dispatch.street}
                    </Text>
                    <Text
                      style={[styles.alertType, isDark && styles.textMuted]}
                    >
                      {dispatch.wasteCategory}
                    </Text>

                    <View style={styles.alertActions}>
                      <TouchableOpacity
                        style={styles.navigateBtn}
                        onPress={() => handleNavigate(dispatch.id)}
                      >
                        <MaterialIcons
                          name="navigation"
                          size={14}
                          color="#FFF"
                        />
                        <Text style={styles.navigateBtnText}>Navigate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.completeIconBtn}
                        onPress={() => handleCompletePickup(dispatch.id)}
                      >
                        <MaterialIcons name="check" size={16} color="#FFF" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {isShiftActive && liveDispatches.length === 0 && (
          <View
            style={[styles.emptyAlertsCard, isDark && styles.emptyDashedDark]}
          >
            <MaterialIcons
              name="radar"
              size={24}
              color={isDark ? "#6B7280" : "#9CA3AF"}
            />
            <Text style={[styles.emptyAlertsText, isDark && styles.textMuted]}>
              Waiting for CENRO dispatch...
            </Text>
          </View>
        )}

        {!isShiftActive && !currentTruck && (
          <View style={[styles.offlineCard, isDark && styles.emptyDashedDark]}>
            <View style={styles.offlineCardContent}>
              <Feather
                name="lock"
                size={24}
                color={isDark ? "#94A3B8" : "#64748B"}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.offlineTitle, isDark && styles.textLight]}>
                  Pending Truck Assignment (Read-Only Mode)
                </Text>
                <Text style={[styles.offlineText, isDark && styles.textMuted]}>
                  No vehicle is currently assigned to your account in CENRO Fleet
                  Inventory. You can view your schedules, history, inbox, and
                  profile, but route start and truck selection are disabled until
                  CENRO assigns you a truck.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Next Scheduled Pickup */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
            Next Scheduled Pickup
          </Text>
          <TouchableOpacity onPress={handleSeeAllSchedule}>
            <Text style={[styles.seeAllText, isDark && { color: "#86EFAC" }]}>
              See all
            </Text>
          </TouchableOpacity>
        </View>

        {nextPickup ? (
          <View
            style={[
              styles.pickupCard,
              isDark && styles.pickupCardDark,
              nextPickup.isExclusiveAssignment && styles.pickupCardExclusive,
            ]}
          >
            {nextPickup.isExclusiveAssignment && (
              <View style={styles.exclusiveBadge}>
                <MaterialIcons name="stars" size={14} color="#B45309" />
                <Text style={styles.exclusiveBadgeText}>
                  {isDateTomorrow(nextPickup.dateText)
                    ? "⭐ Exclusive Special Assignment For Tomorrow"
                    : !isDateToday(nextPickup.dateText)
                    ? `⭐ Exclusive Special Assignment • ${nextPickup.dateText}`
                    : "⭐ Exclusive Special Assignment For Today"}
                </Text>
              </View>
            )}
            <View style={styles.pickupCardHeader}>
              <Text style={styles.pickupBarangay}>
                {nextPickup.isLiveDispatch
                  ? `Active Route • Stop ${nextPickup.routeOrder || 1} (${liveDispatches.length} ${liveDispatches.length === 1 ? "Stop" : "Stops"} Left)`
                  : isDateTomorrow(nextPickup.dateText)
                  ? "Tomorrow's Scheduled Collection"
                  : !isDateToday(nextPickup.dateText)
                  ? `Upcoming Collection • ${nextPickup.dateText}`
                  : "Scheduled Collection"}
              </Text>
              <TouchableOpacity
                style={styles.navOutlineBtn}
                onPress={() => handleNavigate(nextPickup.id)}
              >
                <MaterialIcons name="directions" size={16} color="#FFF" />
              </TouchableOpacity>
            </View>

            <View style={styles.pickupDetails}>
              <View style={styles.detailRow}>
                <View style={styles.dotRed} />
                <Text style={styles.detailText}>
                  Location: {nextPickup.street}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Feather
                  name="clock"
                  size={12}
                  color="#E5E7EB"
                  style={styles.detailIcon}
                />
                <Text style={styles.detailText}>
                  Time: {nextPickup.timeText}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailTextType}>
                  Type: {nextPickup.wasteCategory}
                </Text>
              </View>
              {Boolean(nextPickup.dateText) && (
                <View style={styles.detailRow}>
                  <MaterialIcons
                    name="event"
                    size={12}
                    color={nextPickup.dateText === "Tomorrow" ? "#FDE047" : "#A7F3D0"}
                    style={styles.detailIcon}
                  />
                  <Text
                    style={[
                      styles.detailText,
                      {
                        color:
                          nextPickup.dateText === "Tomorrow"
                            ? "#FDE047"
                            : "#A7F3D0",
                        fontWeight: "700",
                      },
                    ]}
                  >
                    Date: {nextPickup.dateText}
                  </Text>
                </View>
              )}
            </View>

            {isShiftActive && isDateToday(nextPickup.dateText) ? (
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.completeBtn}
                  onPress={() => handleCompletePickup(nextPickup.id)}
                >
                  <Text style={styles.completeBtnText}>Complete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.issueBtn}
                  onPress={() => handleIssuePickup(nextPickup.id)}
                >
                  <Text style={styles.issueBtnText}>Issue</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.offDutyNoticeRow}>
                <Feather
                  name="eye"
                  size={13}
                  color="rgba(255, 255, 255, 0.8)"
                />
                <Text style={styles.offDutyNoticeText}>
                  {isDateTomorrow(nextPickup.dateText)
                    ? "Scheduled for tomorrow • Preview Mode"
                    : !isDateToday(nextPickup.dateText)
                    ? `Scheduled for ${nextPickup.dateText} • Preview Mode`
                    : "Viewing Mode • Start shift to perform collection actions"}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.emptyCard, isDark && styles.emptyDashedDark]}>
            <Feather
              name="check-circle"
              size={48}
              color={isDark ? "#4B5563" : "#9CA3AF"}
            />
            <Text style={[styles.emptyText, isDark && styles.textLight]}>
              No upcoming schedules
            </Text>
            <Text style={[styles.emptySubtext, isDark && styles.textMuted]}>
              You are all caught up! No scheduled pickups today or tomorrow.
            </Text>
          </View>
        )}

        {/* Your History */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
            Recent Activity
          </Text>
          <TouchableOpacity onPress={handleSeeAllHistory}>
            <Text style={[styles.seeAllText, isDark && { color: "#86EFAC" }]}>
              See all
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.historyContainer}>
          {historyItems.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.historyScroll}
            >
              {historyItems.map((item) => (
                <View
                  key={item.id}
                  style={[styles.historyCard, isDark && styles.cardDark]}
                >
                  {item.completionImage ? (
                    <Image
                      source={{ uri: item.completionImage }}
                      style={styles.historyImage}
                    />
                  ) : (
                    <View
                      style={[
                        styles.historyImage,
                        {
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "#E5E7EB",
                        },
                      ]}
                    >
                      <Feather name="image" size={24} color="#9CA3AF" />
                    </View>
                  )}
                  <View style={styles.historyContent}>
                    <Text
                      style={[styles.historyStreet, isDark && styles.textLight]}
                      numberOfLines={1}
                    >
                      {item.street}
                    </Text>
                    <Text
                      style={[styles.historyType, isDark && styles.textMuted]}
                    >
                      {item.wasteCategory}
                    </Text>
                    <View
                      style={[
                        styles.completedBadge,
                        isDark && { backgroundColor: "#374151" },
                      ]}
                    >
                      <Text
                        style={[
                          styles.completedBadgeText,
                          isDark && { color: "#D1D5DB" },
                        ]}
                      >
                        {item.status === "issue"
                          ? "Issue Reported"
                          : "Completed"}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View
              style={[
                styles.emptyHistoryCard,
                isDark && styles.emptyDashedDark,
              ]}
            >
              <Feather
                name="clock"
                size={32}
                color={isDark ? "#4B5563" : "#D1D5DB"}
              />
              <Text style={[styles.emptyText, isDark && styles.textLight]}>
                No recent history
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />

        {!!selectedPickupId &&
          (() => {
            const selectedDispatch = liveDispatches.find(
              (d) => d.id === selectedPickupId,
            );
            return (
              <CompletePickupModal
                visible={showCompleteModal}
                scheduleId={selectedPickupId}
                reportId={
                  selectedPickupId.startsWith("rep_")
                    ? selectedPickupId.replace("rep_", "")
                    : selectedDispatch?.reportId || undefined
                }
                location={
                  selectedDispatch
                    ? selectedDispatch.street
                    : nextPickup?.id === selectedPickupId
                      ? nextPickup.street
                      : stationaryPromptData?.locationName || "Collection Point"
                }
                wasteType={
                  selectedDispatch
                    ? selectedDispatch.wasteCategory
                    : nextPickup?.id === selectedPickupId
                      ? nextPickup.wasteCategory
                      : "General Waste"
                }
                isMandatory={isMandatoryStopComplete}
                onClose={() => {
                  setShowCompleteModal(false);
                  setIsMandatoryStopComplete(false);
                  setSelectedPickupId(null);
                }}
                onSubmit={() => {
                  if (selectedPickupId) {
                    completedScheduleIdsRef.current.add(selectedPickupId);
                    if (selectedPickupId.startsWith("bs_today_")) {
                      const rawId = selectedPickupId.replace("bs_today_", "");
                      completedScheduleIdsRef.current.add(rawId);
                      completedScheduleIdsRef.current.add(`bs_${rawId}`);
                    }
                    const targetItem = liveDispatches.find(d => d.id === selectedPickupId) || (nextPickup?.id === selectedPickupId ? nextPickup : null);
                    if (targetItem?.street) {
                      completedScheduleIdsRef.current.add(targetItem.street.toLowerCase().trim());
                    }
                    if (targetItem?.scheduleId) {
                      completedScheduleIdsRef.current.add(targetItem.scheduleId);
                    }
                    if (targetItem?.reportId) {
                      completedScheduleIdsRef.current.add(targetItem.reportId);
                      completedScheduleIdsRef.current.add(`rep_${targetItem.reportId}`);
                    }

                    // Remaining stops count after completing this stop
                    const remainingStopsCount = liveDispatches.filter(
                      (d) => d.id !== selectedPickupId,
                    ).length;

                    // If this was the last stop of the active route, mark today's parent route finished!
                    if (targetItem?.isLiveDispatch && remainingStopsCount === 0) {
                      todayScheduleIdsRef.current.forEach((id) => {
                        completedScheduleIdsRef.current.add(id);
                        if (id.startsWith("bs_today_")) {
                          const raw = id.replace("bs_today_", "");
                          completedScheduleIdsRef.current.add(raw);
                          completedScheduleIdsRef.current.add(`bs_${raw}`);
                        }
                      });
                    }

                    recomputePickupsRef.current?.();

                    Alert.alert(
                      remainingStopsCount === 0 && targetItem?.isLiveDispatch
                        ? "🎉 Collection Route Finished!"
                        : "✅ Stop Completed",
                      remainingStopsCount === 0 && targetItem?.isLiveDispatch
                        ? "All collection stops along your route have been completed! Great work."
                        : remainingStopsCount > 0 && targetItem?.isLiveDispatch
                        ? `Collection evidence recorded. ${remainingStopsCount} stop(s) remaining in today's collection route.`
                        : "Collection evidence successfully recorded. You may now proceed along your route.",
                    );
                  }
                  setShowCompleteModal(false);
                  setIsMandatoryStopComplete(false);
                  setSelectedPickupId(null);
                  stationaryAnchorRef.current = null;
                  hasPromptedForCurrentStopRef.current = false;
                }}
              />
            );
          })()}

        <StationaryCollectionPromptModal
          visible={showStationaryPrompt}
          locationName={
            stationaryPromptData?.locationName || "Detected Location"
          }
          coordinates={
            stationaryPromptData
              ? {
                  latitude: stationaryPromptData.latitude,
                  longitude: stationaryPromptData.longitude,
                }
              : null
          }
          matchedStopName={stationaryPromptData?.nearestStop?.street}
          matchedStopType={stationaryPromptData?.nearestStop?.wasteCategory}
          elapsedMinutes={stationaryPromptData?.elapsedMinutes || 5}
          onConfirmCollection={handleConfirmStationaryCollection}
          onStuckInTraffic={handleStuckInTraffic}
          onClose={() => setShowStationaryPrompt(false)}
        />

        {!!selectedPickupId && (
          <ReportIssueModal
            visible={showIssueModal}
            scheduleId={selectedPickupId}
            onClose={() => setShowIssueModal(false)}
            onSubmit={() => {
              setShowIssueModal(false);
              console.log("Submit issue action for", selectedPickupId);
            }}
          />
        )}

        {/* ── End Shift Requirement Modal (Requires Fleet Inventory QR Scan) ── */}
        <Modal
          visible={showEndShiftModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowEndShiftModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, isDark && styles.modalCardDark]}>
              <View
                style={[
                  styles.modalIconCircle,
                  { backgroundColor: "#ECFDF5", shadowColor: "#10B981" },
                ]}
              >
                <MaterialIcons
                  name="qr-code-scanner"
                  size={36}
                  color="#059669"
                />
              </View>

              <Text style={[styles.modalTitle, isDark && styles.textLight]}>
                End Shift Verification
              </Text>
              <Text style={[styles.modalSubtitle, isDark && styles.textMuted]}>
                Drivers cannot end shifts manually. You must scan the
                official Fleet Inventory QR code at the CENRO Dispatch station
                to verify Time Out, or have your Barangay Coordinator / CENRO
                conclude it from their management panel.
              </Text>

              {currentTruck && (
                <View
                  style={[
                    styles.endShiftTruckBox,
                    isDark && styles.endShiftTruckBoxDark,
                  ]}
                >
                  <View style={styles.endShiftTruckRow}>
                    <MaterialIcons
                      name="local-shipping"
                      size={18}
                      color="#059669"
                    />
                    <Text
                      style={[
                        styles.endShiftTruckPlate,
                        isDark && styles.textLight,
                      ]}
                    >
                      {currentTruck.plateNumber}
                    </Text>
                    <Text style={styles.endShiftTruckType}>
                      • {currentTruck.type}
                    </Text>
                  </View>

                  {shiftTimingInfo && (
                    <View style={styles.endShiftTimingRow}>
                      <Text style={styles.endShiftTimingLabel}>Time In:</Text>
                      <Text
                        style={[
                          styles.endShiftTimingVal,
                          isDark && styles.textLight,
                        ]}
                      >
                        {shiftTimingInfo.timeInFormatted}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[
                    styles.modalCancelBtn,
                    { flex: 1 },
                    isDark && {
                      backgroundColor: "#374151",
                      borderColor: "#4B5563",
                    },
                  ]}
                  onPress={() => setShowEndShiftModal(false)}
                  disabled={isEndingShift}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.modalCancelText,
                      isDark && { color: "#D1D5DB" },
                    ]}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalConfirmBtn,
                    {
                      flex: 1,
                      backgroundColor: "#059669",
                      shadowColor: "#059669",
                    },
                  ]}
                  onPress={() => {
                    setShowEndShiftModal(false);
                    setShowEndShiftScannerModal(true);
                  }}
                  disabled={isEndingShift}
                  activeOpacity={0.85}
                >
                  <MaterialIcons
                    name="qr-code-scanner"
                    size={18}
                    color="#FFF"
                  />
                  <Text style={styles.modalConfirmText}>Scan Fleet QR</Text>
                </TouchableOpacity>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  marginTop: 14,
                  paddingHorizontal: 8,
                }}
              >
                <MaterialIcons
                  name="info-outline"
                  size={14}
                  color={isDark ? "#9CA3AF" : "#6B7280"}
                />
                <Text
                  style={{
                    fontSize: 12,
                    color: isDark ? "#9CA3AF" : "#6B7280",
                    textAlign: "center",
                  }}
                >
                  Alternatively, your Coordinator or CENRO can end your shift remotely on their end.
                </Text>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── End Shift Scanner Modal ── */}
        <EndShiftQrScannerModal
          visible={showEndShiftScannerModal}
          onClose={() => setShowEndShiftScannerModal(false)}
          currentTruck={currentTruck}
          driverUid={user?.uid || auth?.currentUser?.uid}
          onVerified={handleVerifiedEndShift}
          isEndingShift={isEndingShift}
        />

        {/* ── Start Shift Scanner Modal ── */}
        <StartShiftQrScannerModal
          visible={showStartShiftScannerModal}
          onClose={() => setShowStartShiftScannerModal(false)}
          targetTruck={currentTruck}
          driverUid={user?.uid || auth?.currentUser?.uid}
          onVerified={handleVerifiedStartShift}
          isStartingShift={isStartingShift}
        />

        {/* ── Shift Completed & Attendance Summary Modal ── */}
        <Modal
          visible={completedShiftSummary !== null}
          transparent
          animationType="fade"
          onRequestClose={handleFinishShiftSummary}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, isDark && styles.modalCardDark]}>
              <View
                style={[
                  styles.modalIconCircle,
                  { backgroundColor: "#ECFDF5", shadowColor: "#10B981" },
                ]}
              >
                <MaterialIcons name="check-circle" size={42} color="#059669" />
              </View>

              <Text style={[styles.modalTitle, isDark && styles.textLight]}>
                Shift Completed!
              </Text>
              <Text style={[styles.modalSubtitle, isDark && styles.textMuted]}>
                Verified at CENRO Fleet Inventory Station. Your official shift
                attendance has been recorded.
              </Text>

              {completedShiftSummary && (
                <View
                  style={[styles.summaryCard, isDark && styles.summaryCardDark]}
                >
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Truck</Text>
                    <Text
                      style={[styles.summaryValue, isDark && styles.textLight]}
                    >
                      {completedShiftSummary.truckPlate}
                    </Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Driver</Text>
                    <Text
                      style={[styles.summaryValue, isDark && styles.textLight]}
                    >
                      {completedShiftSummary.driverName}
                    </Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Time In</Text>
                    <Text
                      style={[styles.summaryValue, isDark && styles.textLight]}
                    >
                      {completedShiftSummary.timeInFormatted}
                    </Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Time Out</Text>
                    <Text
                      style={[styles.summaryValue, isDark && styles.textLight]}
                    >
                      {completedShiftSummary.timeOutFormatted}
                    </Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Total Duration</Text>
                    <Text
                      style={[
                        styles.summaryValue,
                        { color: "#059669", fontWeight: "800" },
                      ]}
                    >
                      {completedShiftSummary.durationFormatted}
                    </Text>
                  </View>
                </View>
              )}

              <View style={{ width: "100%", marginTop: 20, gap: 10 }}>
                <TouchableOpacity
                  style={{
                    width: "100%",
                    backgroundColor: "#0F172A",
                    paddingVertical: 15,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onPress={handleFinishShiftSummary}
                  activeOpacity={0.85}
                >
                  <Text
                    style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}
                  >
                    {sessionOrigin === "resident"
                      ? "Done (Return to Resident App)"
                      : "Done (Sign Out & Return to Login)"}
                  </Text>
                </TouchableOpacity>

                {sessionOrigin === "resident" && (
                  <TouchableOpacity
                    style={{
                      width: "100%",
                      paddingVertical: 12,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    onPress={async () => {
                      setIsShiftActive(false);
                      setCurrentTruck(null);
                      setCompletedShiftSummary(null);
                      setShowEndShiftModal(false);
                      try {
                        await auth.signOut();
                      } catch {}
                      await clearDriverSessionOrigin();
                      router.replace("/auth");
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={{
                        color: isDark ? "#F87171" : "#DC2626",
                        fontSize: 14,
                        fontWeight: "600",
                      }}
                    >
                      Sign Out Completely
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Active Shift Warning Modal ── */}
        <Modal
          visible={showActiveShiftModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowActiveShiftModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, isDark && styles.modalCardDark]}>
              <View
                style={[
                  styles.modalIconCircle,
                  { backgroundColor: "#FEF3C7", shadowColor: "#F59E0B" },
                ]}
              >
                <MaterialIcons name="warning" size={36} color="#D97706" />
              </View>

              <Text style={[styles.modalTitle, isDark && styles.textLight]}>
                Active Shift
              </Text>
              <Text style={[styles.modalSubtitle, isDark && styles.textMuted]}>
                {sessionOrigin === "login"
                  ? "You need to end your shift before signing out. End your shift now to record your attendance and release the vehicle."
                  : "You need to end your shift before switching to the resident app. End your shift now to record attendance and release the truck."}
              </Text>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[
                    styles.modalCancelBtn,
                    isDark && {
                      backgroundColor: "#374151",
                      borderColor: "#4B5563",
                    },
                  ]}
                  onPress={() => setShowActiveShiftModal(false)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.modalCancelText,
                      isDark && { color: "#D1D5DB" },
                    ]}
                  >
                    Keep Working
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalConfirmBtn,
                    { backgroundColor: "#DC2626", shadowColor: "#DC2626" },
                  ]}
                  onPress={() => {
                    setShowActiveShiftModal(false);
                    setShowEndShiftModal(true);
                  }}
                  activeOpacity={0.85}
                >
                  <MaterialIcons
                    name="power-settings-new"
                    size={18}
                    color="#FFF"
                  />
                  <Text style={styles.modalConfirmText}>End Shift Now</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Choose Drive Navigation Mode Modal ── */}
        <DriveModeSelectModal
          visible={showDriveModeModal}
          onClose={() => setShowDriveModeModal(false)}
          assignedBarangay={assignedBarangay}
          truckPlate={currentTruck?.plateNumber}
          isDark={isDark}
          onSelectMode={handleSelectDriveMode}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: "#F4FBF1",
  },
  container: {
    flex: 1,
    backgroundColor: "#F4FBF1",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  containerDark: {
    backgroundColor: "#111827",
  },
  textLight: {
    color: "#F9FAFB",
  },
  textMuted: {
    color: "#9CA3AF",
  },
  cardDark: {
    backgroundColor: "#1F2937",
    borderColor: "#374151",
  },
  emptyDashedDark: {
    backgroundColor: "#1F2937",
    borderColor: "#374151",
  },
  pickupCardDark: {
    backgroundColor: "#1C2920",
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 10,
    backgroundColor: "#F4FBF1",
  },
  headerDark: {
    backgroundColor: "#111827",
  },
  logoContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoIcon: {
    width: 32,
    height: 32,
    marginRight: 8,
  },
  logoText: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1A3B2B",
    letterSpacing: -0.5,
  },
  driverModePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  blueLiveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#2563EB",
  },
  driverModePillText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#1D4ED8",
    letterSpacing: 0.3,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  residentSwitchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#DCFCE7",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
  },
  residentSwitchBtnText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#065F46",
  },
  driverStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  driverStatusOnDuty: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
  },
  driverStatusOnDutyDark: {
    backgroundColor: "#064E3B",
    borderColor: "#059669",
  },
  driverStatusOffDuty: {
    backgroundColor: "#F3F4F6",
    borderColor: "#E5E7EB",
  },
  driverStatusOffDutyDark: {
    backgroundColor: "#374151",
    borderColor: "#4B5563",
  },
  driverStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  driverStatusBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  welcomeSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  pendingDutyBanner: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    gap: 12,
  },
  pendingDutyBannerDark: {
    backgroundColor: "#064E3B",
    borderColor: "#059669",
  },
  pendingDutyLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pendingDutyIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#D1FAE5",
    justifyContent: "center",
    alignItems: "center",
  },
  pendingDutyTagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  pendingDutyTag: {
    backgroundColor: "#059669",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pendingDutyTagText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  pendingDutyPlateText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#065F46",
  },
  pendingDutyDesc: {
    fontSize: 12,
    color: "#047857",
    lineHeight: 16,
    marginTop: 2,
  },
  pendingDutyActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  pendingDutyScanBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#059669",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  pendingDutyScanBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  pendingDutyManualBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  pendingDutyManualBtnDark: {
    backgroundColor: "#1E293B",
    borderColor: "#059669",
  },
  pendingDutyManualBtnText: {
    color: "#059669",
    fontWeight: "700",
    fontSize: 13,
  },
  welcomeLeft: {
    flex: 1,
  },
  welcomeText: {
    fontSize: 13,
    color: "#6B7280",
    marginBottom: 2,
  },
  statusText: {
    fontSize: 22,
    fontWeight: "800",
  },
  shiftToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  shiftToggleText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4B5563",
  },
  truckBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  truckBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2E8B57",
  },
  shiftActions: {
    alignItems: "flex-end",
    gap: 8,
  },
  endShiftBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  endShiftText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#DC2626",
  },
  backToPortalBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  backToPortalText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6B7280",
  },

  // Alerts
  alertsContainer: {
    marginBottom: 24,
    backgroundColor: "#F5F3FF",
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "#DDD6FE",
  },
  alertsContainerDark: {
    backgroundColor: "#1E1B4B", // Dark deep purple
    borderColor: "#4C1D95",
  },
  alertHeader: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  liveIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#8B5CF6",
  },
  alertTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#6D28D9",
    letterSpacing: 0.5,
  },
  alertSubtitle: {
    fontSize: 11,
    color: "#7C3AED",
    marginTop: 2,
    marginLeft: 16,
  },
  alertsScroll: {
    paddingLeft: 16,
  },
  alertCard: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    width: 240,
    marginRight: 12,
    flexDirection: "row",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#C4B5FD",
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  alertCardDark: {
    backgroundColor: "#2E1065",
    borderColor: "#5B21B6",
  },
  alertRouteBadge: {
    backgroundColor: "#8B5CF6",
    width: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  alertRouteNumber: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
  },
  alertCardContent: {
    flex: 1,
    padding: 12,
  },
  alertStreet: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  alertType: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 12,
  },
  alertActions: {
    flexDirection: "row",
    gap: 8,
  },
  navigateBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  navigateBtnText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
  },
  completeIconBtn: {
    width: 32,
    backgroundColor: "#059669",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 6,
  },
  emptyAlertsCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F3F4F6",
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderStyle: "dashed",
  },
  emptyAlertsText: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
  },
  offlineCard: {
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 16,
  },
  offlineCardContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  offlineTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1F2937",
    marginBottom: 2,
  },
  offlineText: {
    fontSize: 13,
    color: "#4B5563",
    lineHeight: 18,
  },
  offlineStartShiftBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4E6C50",
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
    shadowColor: "#4E6C50",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  offlineStartShiftBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1F2937",
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#4E6C50",
  },
  pickupCard: {
    backgroundColor: "#58715B",
    borderRadius: 20,
    padding: 20,
    marginBottom: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  pickupCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  pickupBarangay: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  navOutlineBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  pickupDetails: {
    marginBottom: 20,
    gap: 6,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  dotRed: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#EF4444",
    marginRight: 8,
    marginLeft: 3,
  },
  detailIcon: {
    marginRight: 8,
  },
  detailText: {
    fontSize: 13,
    color: "#E5E7EB",
  },
  detailTextType: {
    fontSize: 13,
    color: "#E5E7EB",
    marginLeft: 14,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 12,
  },
  completeBtn: {
    backgroundColor: "#95C596",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  completeBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  issueBtn: {
    backgroundColor: "#F59E0B",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  issueBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  historyContainer: {
    marginHorizontal: -20,
  },
  historyScroll: {
    paddingHorizontal: 20,
    gap: 16,
  },
  historyCard: {
    width: 240,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  historyImage: {
    width: "100%",
    height: 120,
  },
  historyContent: {
    padding: 16,
  },
  historyStreet: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1F2937",
    marginBottom: 4,
  },
  historyType: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 12,
  },
  completedBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  completedBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#6B7280",
  },
  emptyCard: {
    backgroundColor: "#F9FAFB",
    borderRadius: 20,
    padding: 32,
    marginBottom: 30,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderStyle: "dashed",
  },
  emptyHistoryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderStyle: "dashed",
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4B5563",
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#9CA3AF",
    marginTop: 4,
    textAlign: "center",
  },

  // ── Modal Styles ──
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 28,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 15,
  },
  modalCardDark: {
    backgroundColor: "#111827",
  },
  modalIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: "row",
    width: "100%",
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#4B5563",
  },
  modalConfirmBtn: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  endShiftTruckBox: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 20,
  },
  endShiftTruckBoxDark: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
  },
  endShiftTruckRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  endShiftTruckPlate: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
  },
  endShiftTruckType: {
    fontSize: 13,
    color: "#64748B",
  },
  endShiftTimingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  endShiftTimingLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  endShiftTimingVal: {
    fontSize: 12,
    fontWeight: "700",
    color: "#059669",
  },
  summaryCard: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginVertical: 12,
  },
  summaryCardDark: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  summaryLabel: {
    fontSize: 13,
    color: "#64748B",
    fontWeight: "500",
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  summaryDivider: {
    height: 1,
    backgroundColor: "#E2E8F0",
    marginVertical: 4,
  },
  simCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    overflow: "hidden",
  },
  simCardDark: {
    backgroundColor: "#1F2937",
    borderColor: "#374151",
  },
  simCardActive: {
    borderColor: "#86EFAC",
    backgroundColor: "#F0FDF4",
  },
  simHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  simIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
  },
  simIconBoxDark: {
    backgroundColor: "#064E3B",
  },
  simIconBoxActive: {
    backgroundColor: "#16A34A",
  },
  simTitle: {
    fontSize: 13.5,
    fontWeight: "800",
    color: "#0F172A",
    flexShrink: 1,
  },
  simSubtitle: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
    flexShrink: 1,
  },
  simLiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 12,
  },
  simPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#16A34A",
  },
  simLiveText: {
    fontSize: 9,
    fontWeight: "900",
    color: "#15803D",
    letterSpacing: 0.5,
  },
  simBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  simBtnStart: {
    backgroundColor: "#2E8B57",
  },
  simBtnStop: {
    backgroundColor: "#DC2626",
  },
  simBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  simSectorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(226, 232, 240, 0.7)",
    flexWrap: "wrap",
  },
  simSectorLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
  },
  simSectorBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    flexShrink: 1,
    maxWidth: "100%",
  },
  simSectorBtnDark: {
    backgroundColor: "#374151",
    borderColor: "#4B5563",
  },
  simSectorBtnDisabled: {
    opacity: 0.85,
  },
  simSectorBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#0F172A",
    flexShrink: 1,
  },
  simProgressSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  simMetricsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  simMetricText: {
    fontSize: 11,
    color: "#64748B",
  },
  simMetricVal: {
    fontWeight: "800",
    color: "#0F172A",
  },
  simProgressBarTrack: {
    height: 5,
    backgroundColor: "#E2E8F0",
    borderRadius: 3,
    overflow: "hidden",
  },
  simProgressBarFill: {
    height: "100%",
    backgroundColor: "#16A34A",
    borderRadius: 3,
  },
  miniMapCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  miniMapCardDark: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
  },
  miniMapCardActive: {
    borderColor: "#2E8B57",
  },
  miniMapHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  miniMapHeaderLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    marginRight: 10,
  },
  miniMapLivePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
  },
  miniMapLivePillDark: {
    backgroundColor: "#064E3B",
  },
  miniMapLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10B981",
  },
  miniMapLiveText: {
    fontSize: 9,
    fontWeight: "900",
    color: "#059669",
    letterSpacing: 0.5,
  },
  miniMapTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#1E293B",
    flexShrink: 1,
  },
  recenterMiniMapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F0FDF4",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  recenterMiniMapBtnDark: {
    backgroundColor: "#064E3B",
    borderColor: "#059669",
  },
  recenterMiniMapBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#166534",
  },
  expandMapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  expandMapBtnDark: {
    backgroundColor: "#064E3B",
    borderColor: "#059669",
  },
  expandMapBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#166534",
  },
  floatingRecenterFab: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 4,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    zIndex: 10,
  },
  floatingRecenterFabDark: {
    backgroundColor: "rgba(30, 41, 59, 0.95)",
    borderColor: "#334155",
  },
  mapCanvasContainer: {
    height: 190,
    width: "100%",
    position: "relative",
    backgroundColor: "#E2E8F0",
  },
  mapCanvasContainerDark: {
    backgroundColor: "#0F172A",
  },
  miniMapCanvas: {
    ...StyleSheet.absoluteFillObject,
  },
  truckMarkerContainer: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#2E8B57",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  telemetryOverlay: {
    position: "absolute",
    bottom: 8,
    left: 8,
    right: 8,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  telemetryOverlayDark: {
    backgroundColor: "rgba(30, 41, 59, 0.94)",
    borderColor: "rgba(51, 65, 85, 0.8)",
  },
  telemetryStreetText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1E293B",
    flexShrink: 1,
  },
  telemetrySpeedBox: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(241, 245, 249, 0.8)",
  },
  telemetrySpeedBoxDark: {
    backgroundColor: "rgba(15, 23, 42, 0.8)",
  },
  telemetrySpeedVal: {
    fontSize: 11,
    fontWeight: "900",
  },
  miniMapSpeedStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: "#F8FAFC",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E2E8F0",
  },
  miniMapSpeedStripLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
  },
  miniMapSpeedPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "#E2E8F0",
  },
  miniMapSpeedPillActive: {
    backgroundColor: "#16A34A",
  },
  miniMapSpeedPillText: {
    fontSize: 9.5,
    fontWeight: "600",
    color: "#475569",
  },
  miniMapFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  miniMapFooterLabel: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#64748B",
  },
  miniMapFooterSub: {
    fontSize: 12,
    fontWeight: "800",
    color: "#1E293B",
    marginTop: 1,
  },
  simDriveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  simDriveBtnStart: {
    backgroundColor: "#2E8B57",
  },
  simDriveBtnStop: {
    backgroundColor: "#DC2626",
  },
  simDriveBtnComplete: {
    backgroundColor: "#059669",
  },
  simDriveBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  toastAlertCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0F766E",
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    shadowColor: "#0F766E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: "#14B8A6",
  },
  toastAlertCardDark: {
    backgroundColor: "#134E4A",
    borderColor: "#2DD4BF",
  },
  toastAlertIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#0D9488",
    alignItems: "center",
    justifyContent: "center",
  },
  toastAlertTextWrapper: {
    flex: 1,
  },
  toastAlertTitleText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  toastAlertMessageText: {
    fontSize: 11.5,
    color: "#CCFBF1",
    marginTop: 2,
    lineHeight: 15,
  },
  toastAlertActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  toastAlertViewBtn: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  toastAlertViewBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#0F766E",
  },
  toastAlertAckBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  toastAlertAckBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  toastAlertDismissBtn: {
    padding: 6,
  },
  offDutyNoticeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.15)",
    paddingTop: 12,
    marginTop: 4,
  },
  offDutyNoticeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.8)",
  },

  // Shift Fuel Advisor Card Styles
  fuelAdvisorCard: {
    backgroundColor: "#F0FDF4",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#86EFAC",
    marginBottom: 16,
  },
  fuelAdvisorCardDark: {
    backgroundColor: "#062B1D",
    borderColor: "#166534",
  },
  fuelAdvisorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  fuelAdvisorHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  fuelAdvisorIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#16A34A",
    justifyContent: "center",
    alignItems: "center",
  },
  fuelAdvisorTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#14532D",
  },
  fuelAdvisorSubtitle: {
    fontSize: 11,
    color: "#15803D",
    marginTop: 1,
  },
  fuelAdvisorTargetPill: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: "flex-end",
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  fuelAdvisorTargetNumber: {
    fontSize: 16,
    fontWeight: "900",
    color: "#15803D",
  },
  fuelAdvisorTargetCost: {
    fontSize: 10,
    fontWeight: "700",
    color: "#166534",
  },
  fuelAdvisorMetricsRow: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
    justifyContent: "space-around",
    borderWidth: 1,
    borderColor: "#DCFCE7",
  },
  fuelAdvisorMetricCol: {
    alignItems: "center",
    flex: 1,
  },
  fuelAdvisorMetricLabel: {
    fontSize: 10,
    color: "#6B7280",
    fontWeight: "600",
    marginBottom: 2,
  },
  fuelAdvisorMetricValue: {
    fontSize: 13,
    fontWeight: "800",
    color: "#111827",
  },
  fuelAdvisorMetricDivider: {
    width: 1,
    height: 20,
    backgroundColor: "#E5E7EB",
  },
  fuelAdvisorDeferredNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEF3C7",
    padding: 8,
    borderRadius: 8,
    marginTop: 10,
  },
  fuelAdvisorDeferredText: {
    fontSize: 11,
    color: "#92400E",
    fontWeight: "600",
    flex: 1,
  },
  emergencyDashboardCard: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1.5,
    borderColor: "#FCA5A5",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    overflow: "hidden",
    shadowColor: "#DC2626",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  emergencyDashboardLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  emergencyDashboardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FEE2E2",
    borderWidth: 1.5,
    borderColor: "#FCA5A5",
    alignItems: "center",
    justifyContent: "center",
  },
  emergencyTagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  emergencyTagPill: {
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  emergencyTagText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#991B1B",
    letterSpacing: 0.5,
  },
  emergencyStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FECACA",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  emergencyDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#DC2626",
  },
  emergencyStatusText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#DC2626",
    letterSpacing: 0.3,
  },
  emergencyTitleText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#991B1B",
    marginBottom: 4,
  },
  emergencyDescText: {
    fontSize: 12,
    color: "#7F1D1D",
    fontWeight: "500",
    lineHeight: 17,
  },
  weatherDashboardCard: {
    backgroundColor: "#F0F9FF",
    borderWidth: 1.5,
    borderColor: "#7DD3FC",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    overflow: "hidden",
    shadowColor: "#0284C7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  weatherTagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  weatherTagPill: {
    backgroundColor: "#E0F2FE",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  weatherTagText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#075985",
    letterSpacing: 0.5,
  },
  weatherStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#BAE6FD",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  weatherStatusText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#0284C7",
    letterSpacing: 0.3,
  },
  weatherTitleText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0369A1",
    marginBottom: 4,
  },
  weatherDescText: {
    fontSize: 12,
    color: "#0C4A6E",
    fontWeight: "500",
    lineHeight: 17,
  },
  surgeDashboardCard: {
    backgroundColor: "#FFFBEB",
    borderWidth: 1.5,
    borderColor: "#FCD34D",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    overflow: "hidden",
    shadowColor: "#D97706",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  surgeTagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  surgeTagPill: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  surgeTagText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#B45309",
    letterSpacing: 0.5,
  },
  surgeStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FDE68A",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  surgeStatusText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#D97706",
    letterSpacing: 0.3,
  },
  surgeTitleText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#92400E",
    marginBottom: 4,
  },
  surgeDescText: {
    fontSize: 12,
    color: "#78350F",
    fontWeight: "500",
    lineHeight: 17,
    marginBottom: 8,
  },
  surgeChipsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  surgeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  surgeChipText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#B45309",
  },
  pickupCardExclusive: {
    borderColor: "#F59E0B",
    borderWidth: 2,
  },
  exclusiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginBottom: 10,
    alignSelf: "flex-start",
  },
  exclusiveBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#92400E",
  },
});
