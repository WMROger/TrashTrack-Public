import { auth, db } from '@/config/firebase';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import CompletePickupModal from '@/components/driver/CompletePickupModal';
import ReportIssueModal from '@/components/driver/ReportIssueModal';
import { useTheme } from '@/hooks/useTheme';
import { handleDriverBarangayReassignment } from '@/services/autoDispatchService';

export interface ScheduleItem {
  id: string;
  street: string;
  barangay: string;
  wasteCategory: string;
  timeText: string;
  dateText: string;
  zone?: string;
  truckName?: string;
  status?: string;
  isRecurring?: boolean;
  isExclusiveAssignment?: boolean;
  assignedDriverId?: string;
  assignedDriverName?: string;
}

export interface WeeklyScheduleEntry {
  id: string;
  street: string;
  barangay: string;
  days: string[];
  wasteCategory: string;
  timeText: string;
  zone?: string;
  truckName?: string;
}

const DOW_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function isDayScheduled(daysList: string[] = [], dayIndex: number): boolean {
  if (!Array.isArray(daysList) || daysList.length === 0) return false;
  const shortName = DOW_SHORT[dayIndex]; // e.g. 'MON'
  const fullName = DOW_FULL[dayIndex].toLowerCase(); // e.g. 'monday'

  return daysList.some((d) => {
    const clean = String(d || '').trim().toUpperCase();
    return clean === shortName || clean.startsWith(shortName) || clean.toLowerCase() === fullName;
  });
}

function getTimeForDay(schedData: any, dayIndex: number): string {
  const shortName = DOW_SHORT[dayIndex];
  if (schedData.dayTimes && typeof schedData.dayTimes === 'object' && schedData.dayTimes[shortName]) {
    return schedData.dayTimes[shortName];
  }
  return (
    schedData.time ||
    schedData.timeText ||
    schedData.collectionTime ||
    schedData.modalTimeStr ||
    '06:00 AM'
  );
}

function isDateMatching(itemDate: any, targetDate: Date, itemFullDate?: any): boolean {
  if (!itemDate && !itemFullDate) return false;

  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth() + 1; // 1-12
  const targetDay = targetDate.getDate(); // 1-31

  const targetMMDD = `${String(targetMonth).padStart(2, '0')}/${String(targetDay).padStart(2, '0')}`;
  const targetYYYYMMDD = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
  const targetLongStr = targetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const cleanItemDate = String(itemDate || '').trim();
  const cleanFullDate = String(itemFullDate || '').trim();

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

  if (isTargetToday && (cleanItemDate.toLowerCase() === 'today' || cleanItemDate.toLowerCase() === "today's pickups")) return true;
  if (isTargetTomorrow && (cleanItemDate.toLowerCase() === 'tomorrow' || cleanItemDate.toLowerCase() === "tomorrow's pickups")) return true;

  if (cleanFullDate && cleanFullDate === targetYYYYMMDD) return true;
  if (cleanItemDate === targetMMDD) return true;
  if (cleanItemDate === targetYYYYMMDD) return true;
  if (cleanItemDate.toLowerCase() === targetLongStr.toLowerCase()) return true;

  const targetMMDDYYYY = `${String(targetMonth).padStart(2, '0')}/${String(targetDay).padStart(2, '0')}/${targetYear}`;
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
  const str = String(itemDate || '').trim().toLowerCase();
  if (str === 'today' || str === "today's pickups" || str === 'active sequence' || str === 'asap') return true;
  if (str === 'tomorrow' || str === "tomorrow's pickups") return false;
  return isDateMatching(itemDate, new Date(), itemFullDate);
}

export function isDateTomorrow(itemDate?: any, itemFullDate?: any): boolean {
  if (!itemDate && !itemFullDate) return false;
  const str = String(itemDate || '').trim().toLowerCase();
  if (str === 'tomorrow' || str === "tomorrow's pickups") return true;
  if (str === 'today' || str === "today's pickups") return false;
  const tmrw = new Date();
  tmrw.setDate(tmrw.getDate() + 1);
  return isDateMatching(itemDate, tmrw, itemFullDate);
}

export default function DriverSchedulePage() {
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [loading, setLoading] = useState(true);
  const [driverUid, setDriverUid] = useState<string>(auth?.currentUser?.uid || '');
  const [assignedBarangay, setAssignedBarangay] = useState<string>('');
  const [driverName, setDriverName] = useState<string>('');
  const [assignedTruckPlate, setAssignedTruckPlate] = useState<string>('');
  const [isShiftActive, setIsShiftActive] = useState<boolean>(false);

  const [rawBarangaySchedules, setRawBarangaySchedules] = useState<any[]>([]);
  const [rawDirectSchedules, setRawDirectSchedules] = useState<any[]>([]);
  const [completedItemIds, setCompletedItemIds] = useState<Set<string>>(new Set());

  // Modal states
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [selectedPickupId, setSelectedPickupId] = useState<string | null>(null);

  // 1. Fetch current driver profile (to know assignedBarangay and active shift)
  useEffect(() => {
    const currentUser = auth?.currentUser;
    if (!currentUser || !db) {
      setLoading(false);
      return;
    }

    setDriverUid(currentUser.uid);

    const unsubUser = onSnapshot(
      doc(db, 'users', currentUser.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const b = (data.assignedBarangay || data.barangay || '').trim();
          setAssignedBarangay(b);
          setDriverName(data.displayName || data.name || data.email || 'Driver');
          setAssignedTruckPlate(data.currentTruckPlate || '');
          const activeShift = Boolean(
            data.dutyStatus === 'on_duty' || data.status === 'on_duty' || data.currentTruckId
          );
          if (activeShift) {
            setIsShiftActive(true);
          }
        }
      },
      (err) => {
        if (err?.code !== 'permission-denied') {
          console.warn('DriverSchedulePage: user profile listener error:', err);
        }
      }
    );

    // Also sync shift and truck plate directly from assigned trucks
    const qTruck = query(
      collection(db, 'trucks'),
      where('assignedDriverId', '==', currentUser.uid)
    );
    const unsubTruck = onSnapshot(
      qTruck,
      (snap) => {
        if (!snap.empty) {
          const trDoc = snap.docs[0];
          const trData = trDoc.data();
          if (trData.plateNumber) {
            setAssignedTruckPlate(trData.plateNumber);
          }
          if (trData.shiftStartedAt || trData.dutyStatus === 'on_duty' || trData.status === 'active') {
            setIsShiftActive(true);
          }
        }
      },
      (err) => {
        if (err?.code !== 'permission-denied') {
          console.warn('DriverSchedulePage: trucks listener error:', err);
        }
      }
    );

    return () => {
      unsubUser();
      unsubTruck();
    };
  }, []);

  // 2. Fetch all collection schedules for the driver's barangay from 'barangay_schedules'
  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    const unsubBarangaySchedules = onSnapshot(
      collection(db, 'barangay_schedules'),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() });
        });
        setRawBarangaySchedules(list);
        setLoading(false);
      },
      (err) => {
        if (err?.code !== 'permission-denied') {
          console.warn('DriverSchedulePage: barangay_schedules listener error:', err);
        }
        setLoading(false);
      }
    );

    return () => unsubBarangaySchedules();
  }, []);

  // 3. Fetch direct driver-specific tasks from 'schedules'
  useEffect(() => {
    const currentUser = auth?.currentUser;
    if (!currentUser || !db) return;

    const directQuery = query(
      collection(db, 'schedules'),
      where('assignedDriverId', '==', currentUser.uid)
    );

    const unsubDirect = onSnapshot(
      directQuery,
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() });
        });
        setRawDirectSchedules(list);
      },
      (err) => {
        if (err?.code !== 'permission-denied') {
          console.warn('DriverSchedulePage: direct schedules listener error:', err);
        }
      }
    );

    return () => unsubDirect();
  }, []);

  // Proactively cleanup any out-of-barangay active schedules if driver's assigned barangay changed
  useEffect(() => {
    const currentUser = auth?.currentUser;
    if (!currentUser || !assignedBarangay) return;

    const normDriverBrgy = assignedBarangay.toLowerCase().replace(/^brgy\.?\s*/i, '').trim();
    if (!normDriverBrgy) return;

    const hasDirectMismatch = rawDirectSchedules.some((s) => {
      if (s.status === 'cancelled' || s.status === 'completed') return false;
      const schedBrgy = String(s.barangay || s.barangayName || '').toLowerCase().replace(/^brgy\.?\s*/i, '').trim();
      return Boolean(schedBrgy && schedBrgy !== normDriverBrgy);
    });

    const hasBarangaySchedMismatch = rawBarangaySchedules.some((s) => {
      if (s.assignedDriverId !== currentUser.uid) return false;
      const schedBrgy = String(s.barangay || s.barangayName || '').toLowerCase().replace(/^brgy\.?\s*/i, '').trim();
      return Boolean(schedBrgy && schedBrgy !== normDriverBrgy);
    });

    if (hasDirectMismatch || hasBarangaySchedMismatch) {
      handleDriverBarangayReassignment(currentUser.uid, assignedBarangay).catch((e) =>
        console.warn('DriverSchedulePage: Error executing proactive reassignment cleanup:', e)
      );
    }
  }, [rawDirectSchedules, rawBarangaySchedules, assignedBarangay]);


  // Compute Today, Tomorrow, and Weekly Schedules
  const { todayList, tomorrowList, upcomingList, weeklyList, hasExclusiveToday, hasExclusiveTomorrow } = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayDOW = today.getDay(); // 0 = Sun, 1 = Mon, ...
    const tomorrowDOW = tomorrow.getDay();

    const normalizedDriverBarangay = assignedBarangay.trim().toLowerCase();
    const currentUid = driverUid || auth?.currentUser?.uid || '';

    // Filter relevant barangay schedules (include if driver is assigned to a specific date or to the weekly schedule itself)
    const matchedBarangaySchedules = rawBarangaySchedules.filter((sched) => {
      // If the weekly schedule is assigned to someone else, this driver should NOT see it
      if (sched.assignedDriverId && currentUid && sched.assignedDriverId !== currentUid) {
        return false;
      }

      // Enforce barangay match when driver has an assigned barangay
      if (normalizedDriverBarangay) {
        const bName = String(sched.barangayName || sched.barangay || '').trim().toLowerCase().replace(/^brgy\.?\s*/i, '');
        const normDriver = normalizedDriverBarangay.replace(/^brgy\.?\s*/i, '');
        if (bName && normDriver && bName !== normDriver && !bName.includes(normDriver) && !normDriver.includes(bName)) {
          return false;
        }
      }

      if (sched.assignedDriverId && currentUid && sched.assignedDriverId === currentUid) return true;
      const hasDirectAssignment = (sched.specificSchedules || sched.pickups || []).some(
        (item: any) => currentUid && item.assignedDriverId === currentUid
      );
      if (hasDirectAssignment) return true;

      return true;
    });

    const completedTodayKeys = new Set<string>(completedItemIds);
    rawDirectSchedules.forEach((data) => {
      if (data.status === 'completed') {
        completedTodayKeys.add(data.id);
        if (data.scheduleId) completedTodayKeys.add(data.scheduleId);
        if (data.id.startsWith('bs_today_')) {
          const rawId = data.id.replace('bs_today_', '');
          completedTodayKeys.add(rawId);
          completedTodayKeys.add(`bs_${rawId}`);
        }
        if (data.street) completedTodayKeys.add(String(data.street).toLowerCase().trim());
      }
    });

    const recurringTodayItems: ScheduleItem[] = [];
    const recurringTomorrowItems: ScheduleItem[] = [];
    const assignedSpecialTodayItems: ScheduleItem[] = [];
    const assignedSpecialTomorrowItems: ScheduleItem[] = [];
    const assignedSpecialUpcomingItems: ScheduleItem[] = [];
    const unassignedSpecialTodayItems: ScheduleItem[] = [];
    const unassignedSpecialTomorrowItems: ScheduleItem[] = [];
    const weeklyItems: WeeklyScheduleEntry[] = [];

    // A. Expand from barangay_schedules
    matchedBarangaySchedules.forEach((sched) => {
      const days = Array.isArray(sched.days)
        ? sched.days
        : Array.isArray(sched.selectedDays)
        ? sched.selectedDays
        : [];
      const street = sched.streetName || sched.street || sched.route || 'Barangay Route';
      const bName = sched.barangayName || sched.barangay || assignedBarangay || 'Assigned Barangay';
      const category = sched.wasteCategory || sched.wasteType || 'BIODEGRADABLE';
      const zone = sched.zone || '';
      const truck = sched.truckName || '';

      const isAssignedToOtherWeeklyDriver = Boolean(
        sched.assignedDriverId && currentUid && sched.assignedDriverId !== currentUid
      );

      // Only add recurring/weekly entries if NOT assigned to a different driver
      if (!isAssignedToOtherWeeklyDriver) {
        // Weekly Entry
        weeklyItems.push({
          id: `weekly_${sched.id}`,
          street,
          barangay: bName,
          days: days.length > 0 ? days : ['Daily'],
          wasteCategory: category,
          timeText: getTimeForDay(sched, todayDOW),
          zone,
          truckName: truck,
        });

        // Check Today recurring
        if (isDayScheduled(days, todayDOW) || sched.isDaily === true) {
          const recId = `bs_today_${sched.id}`;
          const isDone =
            completedTodayKeys.has(recId) ||
            completedTodayKeys.has(`bs_${sched.id}`) ||
            completedTodayKeys.has(sched.id) ||
            completedTodayKeys.has(street.toLowerCase().trim());

          recurringTodayItems.push({
            id: recId,
            street,
            barangay: bName,
            wasteCategory: category,
            timeText: getTimeForDay(sched, todayDOW),
            dateText: 'Today',
            zone,
            truckName: truck,
            status: isDone ? 'completed' : 'pending',
            isRecurring: true,
          });
        }

        // Check Tomorrow recurring
        if (isDayScheduled(days, tomorrowDOW) || sched.isDaily === true) {
          recurringTomorrowItems.push({
            id: `bs_tmrw_${sched.id}`,
            street,
            barangay: bName,
            wasteCategory: category,
            timeText: getTimeForDay(sched, tomorrowDOW),
            dateText: 'Tomorrow',
            zone,
            truckName: truck,
            status: 'pending',
            isRecurring: true,
          });
        }
      }

      // Check specific one-off pickups inside specificSchedules / pickups array
      const specific = sched.specificSchedules || sched.pickups || [];
      if (Array.isArray(specific)) {
        specific.forEach((item: any, idx: number) => {
          // If assigned to a different driver (either specifically or via parent weekly schedule), current driver must NOT see it at all
          const effectiveDriverId = item.assignedDriverId || sched.assignedDriverId;
          if (effectiveDriverId && currentUid && effectiveDriverId !== currentUid) {
            return;
          }

          const isAssignedToCurrentDriver = Boolean(
            currentUid && (item.assignedDriverId === currentUid || (!item.assignedDriverId && sched.assignedDriverId === currentUid))
          );

          const itemStreet = item.street || street;
          const itemCategory = item.category || category;
          const itemTime = item.time || getTimeForDay(sched, todayDOW);

          // Check if matches Today
          if (isDateMatching(item.date, today, item.fullDate)) {
            const specId = `spec_today_${sched.id}_${idx}`;
            const isDone =
              item.status === 'completed' ||
              completedTodayKeys.has(specId) ||
              completedTodayKeys.has(`spec_${sched.id}_${idx}`);

            const specItem: ScheduleItem = {
              id: specId,
              street: itemStreet,
              barangay: bName,
              wasteCategory: itemCategory,
              timeText: itemTime,
              dateText: 'Today',
              zone,
              truckName: truck,
              status: isDone ? 'completed' : (item.status || 'pending'),
              isRecurring: false,
              isExclusiveAssignment: isAssignedToCurrentDriver,
              assignedDriverId: item.assignedDriverId,
              assignedDriverName: item.assignedDriverName,
            };

            if (isAssignedToCurrentDriver) {
              assignedSpecialTodayItems.push(specItem);
            } else {
              unassignedSpecialTodayItems.push(specItem);
            }
          }

          // Check if matches Tomorrow
          if (isDateMatching(item.date, tomorrow, item.fullDate)) {
            const specItem: ScheduleItem = {
              id: `spec_tmrw_${sched.id}_${idx}`,
              street: itemStreet,
              barangay: bName,
              wasteCategory: itemCategory,
              timeText: item.time || getTimeForDay(sched, tomorrowDOW),
              dateText: 'Tomorrow',
              zone,
              truckName: truck,
              status: item.status || 'pending',
              isRecurring: false,
              isExclusiveAssignment: isAssignedToCurrentDriver,
              assignedDriverId: item.assignedDriverId,
              assignedDriverName: item.assignedDriverName,
            };

            if (isAssignedToCurrentDriver) {
              assignedSpecialTomorrowItems.push(specItem);
            } else {
              unassignedSpecialTomorrowItems.push(specItem);
            }
          }

          // Check upcoming dates assigned exclusively to this driver
          const isTodayMatch = isDateMatching(item.date, today, item.fullDate);
          const isTmrwMatch = isDateMatching(item.date, tomorrow, item.fullDate);
          if (!isTodayMatch && !isTmrwMatch && isAssignedToCurrentDriver) {
            assignedSpecialUpcomingItems.push({
              id: `spec_upcoming_${sched.id}_${idx}`,
              street: itemStreet,
              barangay: bName,
              wasteCategory: itemCategory,
              timeText: item.time || 'Scheduled',
              dateText: item.fullDate || item.date || 'Upcoming',
              zone,
              truckName: truck,
              status: item.status || 'pending',
              isRecurring: false,
              isExclusiveAssignment: true,
              assignedDriverId: item.assignedDriverId,
              assignedDriverName: item.assignedDriverName,
            });
          }
        });
      }
    });

    // B. Merge direct schedules assigned to this driver
    const directTodayItems: ScheduleItem[] = [];
    const directTomorrowItems: ScheduleItem[] = [];

    rawDirectSchedules.forEach((data) => {
      if (data.status === 'cancelled') return;

      // Skip direct completion records for recurring barangay schedules to prevent duplicate keys
      if (data.id.startsWith('bs_today_') || data.id.startsWith('bs_tmrw_')) {
        return;
      }

      // Filter out any direct schedules that do not match driver's assigned barangay
      if (normalizedDriverBarangay && data.barangay) {
        const normScheduleBrgy = String(data.barangay).toLowerCase().replace(/^brgy\.?\s*/i, '').trim();
        const normDriver = normalizedDriverBarangay.replace(/^brgy\.?\s*/i, '').trim();
        if (normScheduleBrgy && normDriver && normScheduleBrgy !== normDriver) {
          return;
        }
      }

      const isCompleted = data.status === 'completed' || completedTodayKeys.has(data.id);

      const isToday = isDateToday(data.dateText, data.fullDate);
      const isTomorrow = isDateTomorrow(data.dateText, data.fullDate);

      const item: ScheduleItem = {
        id: data.id,
        street: data.street || 'Unknown Street',
        barangay: data.barangay || assignedBarangay || 'Assigned Barangay',
        wasteCategory: data.wasteCategory || data.wasteType || 'General',
        timeText: data.timeText || data.time || 'ASAP',
        dateText: isToday ? 'Today' : isTomorrow ? 'Tomorrow' : (data.dateText || 'Today'),
        status: isCompleted ? 'completed' : (data.status || 'pending'),
        isRecurring: false,
      };

      if (isToday) {
        directTodayItems.push(item);
      } else if (isTomorrow) {
        if (!isCompleted) {
          directTomorrowItems.push(item);
        }
      }
    });

    // EXCLUSIVITY LOGIC:
    // If CENRO assigned this driver to a specific date:
    // "thats the only schedule he will see in the driver app"
    let finalTodayItems: ScheduleItem[] = [];
    if (assignedSpecialTodayItems.length > 0) {
      // Driver was assigned specifically to this date:
      // Show ONLY the assigned special schedule(s) for today!
      finalTodayItems = [...assignedSpecialTodayItems];
    } else {
      // Default: show recurring + unassigned special + direct schedules
      finalTodayItems = [...recurringTodayItems, ...unassignedSpecialTodayItems, ...directTodayItems];
    }

    let finalTomorrowItems: ScheduleItem[] = [];
    if (assignedSpecialTomorrowItems.length > 0) {
      finalTomorrowItems = [...assignedSpecialTomorrowItems];
    } else {
      finalTomorrowItems = [...recurringTomorrowItems, ...unassignedSpecialTomorrowItems, ...directTomorrowItems];
    }

    finalTodayItems.sort((a, b) => a.timeText.localeCompare(b.timeText));
    finalTomorrowItems.sort((a, b) => a.timeText.localeCompare(b.timeText));

    const deduplicateById = (items: ScheduleItem[]): ScheduleItem[] => {
      const seen = new Set<string>();
      const result: ScheduleItem[] = [];
      for (const item of items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          result.push(item);
        } else {
          const existing = result.find(r => r.id === item.id);
          if (existing && item.status === 'completed') {
            existing.status = 'completed';
          }
        }
      }
      return result;
    };

    return {
      todayList: deduplicateById(finalTodayItems),
      tomorrowList: deduplicateById(finalTomorrowItems),
      upcomingList: deduplicateById(assignedSpecialUpcomingItems),
      weeklyList: weeklyItems,
      hasExclusiveToday: assignedSpecialTodayItems.length > 0,
      hasExclusiveTomorrow: assignedSpecialTomorrowItems.length > 0,
    };
  }, [rawBarangaySchedules, rawDirectSchedules, assignedBarangay, driverUid, completedItemIds]);

  const selectedScheduleItem = useMemo(() => {
    if (!selectedPickupId) return null;
    return [...todayList, ...tomorrowList, ...upcomingList].find((p) => p.id === selectedPickupId) || null;
  }, [selectedPickupId, todayList, tomorrowList, upcomingList]);

  const handleCompletePickup = (id: string) => {
    if (!isShiftActive) {
      Alert.alert(
        'Read-Only Mode (Off Duty)',
        'You cannot complete pickups while off duty or without an assigned truck in CENRO Fleet Inventory.',
        [{ text: 'OK', style: 'default' }]
      );
      return;
    }

    // Guard: Prevent completing general today schedule while route stops are pending
    const activeRoute = rawDirectSchedules.find(
      (s) =>
        s.isLiveDispatch &&
        !s.dieselClosedAt &&
        ['in_progress', 'in-progress', 'pending', 'active'].includes(String(s.status || ''))
    );
    if (activeRoute && Array.isArray(activeRoute.stops)) {
      const remainingStops = activeRoute.stops.filter((s: any) => !s.completed).length;
      if (remainingStops > 0 && (id.startsWith('bs_today_') || id.startsWith('bs_'))) {
        Alert.alert(
          'Route In Progress',
          `You have ${remainingStops} collection stop(s) remaining on your active route. You must complete all stops along your route on the Driver Cockpit before finishing today's collection schedule.`,
          [{ text: 'OK', style: 'default' }]
        );
        return;
      }
    }
    const targetItem = [...todayList, ...tomorrowList, ...upcomingList].find((p) => p.id === id);
    if (targetItem?.status === 'completed') {
      Alert.alert('Already Completed', 'This collection pickup has already been marked completed today.');
      return;
    }
    if (targetItem && !isDateToday(targetItem.dateText)) {
      Alert.alert(
        'Future Schedule',
        `This pickup is scheduled for ${targetItem.dateText.toLowerCase()}. You cannot complete collections before their scheduled date.`,
      );
      return;
    }
    setSelectedPickupId(id);
    setShowCompleteModal(true);
  };

  const handleIssuePickup = (id: string) => {
    if (!isShiftActive) {
      Alert.alert(
        'Read-Only Mode (Off Duty)',
        'You cannot report issues while off duty or without an assigned truck in CENRO Fleet Inventory.',
        [{ text: 'OK', style: 'default' }]
      );
      return;
    }
    const targetItem = [...todayList, ...tomorrowList, ...upcomingList].find((p) => p.id === id);
    if (targetItem && !isDateToday(targetItem.dateText)) {
      Alert.alert(
        'Future Schedule',
        `This pickup is scheduled for ${targetItem.dateText.toLowerCase()}. You cannot report issues on future schedules before their scheduled date.`,
      );
      return;
    }
    setSelectedPickupId(id);
    setShowIssueModal(true);
  };

  const getCategoryColor = (category: string) => {
    const c = category.toUpperCase();
    if (c.includes('BIO') && !c.includes('NON')) return '#10B981'; // Emerald Green
    if (c.includes('NON-BIO') || c.includes('NON BIO')) return '#3B82F6'; // Blue
    if (c.includes('RECYCL')) return '#F59E0B'; // Amber
    if (c.includes('RESIDUAL')) return '#64748B'; // Slate Gray
    if (c.includes('HAZARD')) return '#EF4444'; // Red
    return '#8B5CF6'; // Purple / Bulk
  };

  if (loading) {
    return (
      <View style={[styles.container, isDark && styles.containerDark, styles.center]}>
        <ActivityIndicator size="large" color={isDark ? '#86EFAC' : '#4E6C50'} />
      </View>
    );
  }

  const renderScheduleCard = (item: ScheduleItem, index?: number) => {
    const color = getCategoryColor(item.wasteCategory);
    return (
      <View
        key={index !== undefined ? `${item.id}_${index}` : item.id}
        style={[
          styles.pickupCard,
          isDark && styles.pickupCardDark,
          item.isExclusiveAssignment && styles.pickupCardExclusive,
        ]}
      >
        {item.isExclusiveAssignment && (
          <View style={styles.exclusiveBanner}>
            <MaterialIcons name="stars" size={14} color="#B45309" />
            <Text style={styles.exclusiveBannerText}>⭐ Assigned Specially to You for this Date</Text>
          </View>
        )}
        <View style={styles.cardTopRow}>
          <View style={styles.barangayTag}>
            <MaterialIcons name="location-on" size={13} color="#FFFFFF" />
            <Text style={styles.pickupBarangay}>Brgy. {item.barangay}</Text>
          </View>
          <View style={[styles.categoryBadge, { backgroundColor: color }]}>
            <Text style={styles.categoryBadgeText}>{item.wasteCategory}</Text>
          </View>
        </View>

        <View style={styles.pickupDetails}>
          <View style={styles.detailRow}>
            <View style={styles.dotGreen} />
            <Text style={styles.detailText}>
              <Text style={{ fontWeight: '700' }}>Street / Route:</Text> {item.street}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Feather name="clock" size={13} color="#E5E7EB" style={styles.detailIcon} />
            <Text style={styles.detailText}>
              <Text style={{ fontWeight: '700' }}>Collection Window:</Text> {item.timeText}
            </Text>
          </View>
          {item.zone ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="grid-view" size={13} color="#E5E7EB" style={styles.detailIcon} />
              <Text style={styles.detailText}>
                <Text style={{ fontWeight: '700' }}>Zone / Sector:</Text> {item.zone}
              </Text>
            </View>
          ) : null}
        </View>

        {item.status === 'completed' ? (
          <View style={styles.completedNoticeRow}>
            <Feather name="check-circle" size={14} color="#34D399" />
            <Text style={styles.completedNoticeText}>Completed Today</Text>
          </View>
        ) : isShiftActive && isDateToday(item.dateText) ? (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.completeBtn}
              onPress={() => handleCompletePickup(item.id)}
              activeOpacity={0.8}
            >
              <Feather name="check-circle" size={14} color="#FFFFFF" />
              <Text style={styles.completeBtnText}>Mark Done</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.issueBtn}
              onPress={() => handleIssuePickup(item.id)}
              activeOpacity={0.8}
            >
              <Feather name="alert-triangle" size={14} color="#FFFFFF" />
              <Text style={styles.issueBtnText}>Report Issue</Text>
            </TouchableOpacity>
          </View>
        ) : isDateTomorrow(item.dateText) ? (
          <View style={styles.offDutyNoticeRow}>
            <Feather name="calendar" size={13} color="#FDE047" />
            <Text style={[styles.offDutyNoticeText, { color: '#FDE047', fontWeight: '700' }]}>
              Scheduled for tomorrow &bull; Actions unlock on collection date
            </Text>
          </View>
        ) : !isDateToday(item.dateText) ? (
          <View style={styles.offDutyNoticeRow}>
            <Feather name="calendar" size={13} color="rgba(255, 255, 255, 0.7)" />
            <Text style={styles.offDutyNoticeText}>
              Upcoming collection &bull; Actions unlock on collection date
            </Text>
          </View>
        ) : (
          <View style={styles.offDutyNoticeRow}>
            <Feather name="eye" size={13} color="rgba(255, 255, 255, 0.8)" />
            <Text style={styles.offDutyNoticeText}>Viewing Mode &bull; Start shift to perform collection actions</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={[styles.container, isDark && styles.containerDark]} showsVerticalScrollIndicator={false}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={isDark ? '#111827' : '#F4FBF1'} />

      {/* Header Banner */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={[styles.title, isDark && styles.textLight]}>Driver Schedule</Text>
            <Text style={[styles.subtitle, isDark && styles.textMuted]}>
              Municipal collection timetable for your assigned area.
            </Text>
          </View>
        </View>

        {/* Assigned Barangay & Truck Pill Banner */}
        <View style={[styles.assignmentBanner, isDark && styles.assignmentBannerDark]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <View style={styles.assignmentPill}>
              <MaterialIcons name="holiday-village" size={16} color="#065F46" />
              <Text style={styles.assignmentPillText}>
                {assignedBarangay ? `Brgy. ${assignedBarangay}` : 'No Barangay Assigned'}
              </Text>
            </View>
            {assignedTruckPlate ? (
              <View style={styles.truckPill}>
                <MaterialIcons name="local-shipping" size={15} color="#1E40AF" />
                <Text style={styles.truckPillText}>{assignedTruckPlate}</Text>
              </View>
            ) : null}
          </View>
          {!assignedBarangay && (
            <Text style={styles.unassignedWarning}>
              ⚠️ No barangay currently linked to your driver account. Contact CENRO Admin to configure your operational area.
            </Text>
          )}
        </View>
      </View>

      {/* Today Section */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>Today&apos;s Pickups</Text>
          <View style={[styles.countBadge, todayList.length > 0 ? styles.countBadgeActive : styles.countBadgeMuted]}>
            <Text style={styles.countBadgeText}>{todayList.length} scheduled</Text>
          </View>
        </View>

        {hasExclusiveToday && (
          <View style={[styles.exclusiveNoticeBanner, isDark && styles.exclusiveNoticeBannerDark]}>
            <MaterialIcons name="stars" size={18} color="#D97706" />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={[styles.exclusiveNoticeTitle, isDark && styles.exclusiveNoticeTitleDark]}>
                Exclusive Special Assignment for Today
              </Text>
              <Text style={[styles.exclusiveNoticeSubtitle, isDark && styles.textMuted]}>
                CENRO designated you specifically for this pickup date. Normal recurring routes are filtered out for your shift today.
              </Text>
            </View>
          </View>
        )}

        {todayList.length > 0 ? (
          todayList.map((item, idx) => renderScheduleCard(item, idx))
        ) : (
          <View style={[styles.emptyCard, isDark && styles.emptyCardDark]}>
            <Feather name="calendar" size={32} color={isDark ? '#4B5563' : '#9CA3AF'} />
            <Text style={[styles.emptyText, isDark && styles.textLight]}>
              No scheduled collections for today in {assignedBarangay ? `Brgy. ${assignedBarangay}` : 'your area'}
            </Text>
            <Text style={[styles.emptySubText, isDark && styles.textMuted]}>
              Check the upcoming or weekly routine below for your next scheduled pickup date.
            </Text>
          </View>
        )}
      </View>

      {/* Tomorrow Section */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>Tomorrow&apos;s Pickups</Text>
          <View style={[styles.countBadge, tomorrowList.length > 0 ? styles.countBadgeActive : styles.countBadgeMuted]}>
            <Text style={styles.countBadgeText}>{tomorrowList.length} scheduled</Text>
          </View>
        </View>

        {hasExclusiveTomorrow && (
          <View style={[styles.exclusiveNoticeBanner, isDark && styles.exclusiveNoticeBannerDark]}>
            <MaterialIcons name="stars" size={18} color="#D97706" />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={[styles.exclusiveNoticeTitle, isDark && styles.exclusiveNoticeTitleDark]}>
                Exclusive Special Assignment for Tomorrow
              </Text>
              <Text style={[styles.exclusiveNoticeSubtitle, isDark && styles.textMuted]}>
                CENRO designated you specifically for this special pickup date tomorrow.
              </Text>
            </View>
          </View>
        )}

        {tomorrowList.length > 0 ? (
          tomorrowList.map((item, idx) => renderScheduleCard(item, idx))
        ) : (
          <View style={[styles.emptyCard, isDark && styles.emptyCardDark]}>
            <Feather name="calendar" size={32} color={isDark ? '#4B5563' : '#9CA3AF'} />
            <Text style={[styles.emptyText, isDark && styles.textLight]}>No scheduled collections for tomorrow</Text>
          </View>
        )}
      </View>

      {/* Upcoming Special Assignments Section */}
      {upcomingList && upcomingList.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              Upcoming Special Assignments
            </Text>
            <View style={[styles.countBadge, styles.countBadgeActive]}>
              <Text style={styles.countBadgeText}>{upcomingList.length} scheduled</Text>
            </View>
          </View>

          <View style={[styles.exclusiveNoticeBanner, isDark && styles.exclusiveNoticeBannerDark]}>
            <MaterialIcons name="stars" size={18} color="#D97706" />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={[styles.exclusiveNoticeTitle, isDark && styles.exclusiveNoticeTitleDark]}>
                Exclusive Special Assignments Ahead
              </Text>
              <Text style={[styles.exclusiveNoticeSubtitle, isDark && styles.textMuted]}>
                CENRO or your Coordinator specifically designated you for these upcoming collection dates.
              </Text>
            </View>
          </View>

          {upcomingList.map((item, idx) => renderScheduleCard(item, idx))}
        </View>
      )}

      {/* Weekly Route Routine Section */}
      {weeklyList.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              Weekly Collection Routine ({assignedBarangay ? `Brgy. ${assignedBarangay}` : 'Assigned Area'})
            </Text>
          </View>

          <View style={[styles.weeklyCard, isDark && styles.weeklyCardDark]}>
            {weeklyList.map((w, idx) => {
              const catColor = getCategoryColor(w.wasteCategory);
              return (
                <View
                  key={w.id}
                  style={[
                    styles.weeklyRow,
                    idx < weeklyList.length - 1 && styles.weeklyRowDivider,
                    idx % 2 === 1 && { backgroundColor: isDark ? '#1F2937' : '#F9FAFB' },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Text style={[styles.weeklyStreetText, isDark && styles.textLight]}>{w.street}</Text>
                      <View style={[styles.smallCategoryPill, { backgroundColor: catColor }]}>
                        <Text style={styles.smallCategoryPillText}>{w.wasteCategory}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <View style={styles.daysTag}>
                        <MaterialIcons name="event-repeat" size={12} color="#065F46" />
                        <Text style={styles.daysTagText}>{w.days.join(', ')}</Text>
                      </View>
                      <View style={styles.timeTag}>
                        <Feather name="clock" size={11} color="#475569" />
                        <Text style={styles.timeTagText}>{w.timeText}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <View style={{ height: 40 }} />

      {!!selectedPickupId && (
        <CompletePickupModal
          visible={showCompleteModal}
          scheduleId={selectedPickupId}
          location={selectedScheduleItem ? `${selectedScheduleItem.street}, ${selectedScheduleItem.barangay}` : 'Scheduled pickup'}
          wasteType={selectedScheduleItem ? selectedScheduleItem.wasteCategory : 'Not specified'}
          onClose={() => {
            setShowCompleteModal(false);
            setSelectedPickupId(null);
          }}
          onSubmit={() => {
            if (selectedPickupId) {
              setCompletedItemIds((prev) => {
                const nextSet = new Set(prev);
                nextSet.add(selectedPickupId);
                if (selectedPickupId.startsWith('bs_today_')) {
                  const rawId = selectedPickupId.replace('bs_today_', '');
                  nextSet.add(rawId);
                  nextSet.add(`bs_${rawId}`);
                }
                if (selectedScheduleItem?.street) {
                  nextSet.add(selectedScheduleItem.street.toLowerCase().trim());
                }
                return nextSet;
              });
            }
            setShowCompleteModal(false);
            setSelectedPickupId(null);
            Alert.alert(
              '✅ Pickup Completed',
              'Collection evidence and measurements have been recorded successfully.',
              [{ text: 'OK' }]
            );
          }}
        />
      )}

      {!!selectedPickupId && (
        <ReportIssueModal
          visible={showIssueModal}
          scheduleId={selectedPickupId}
          location={selectedScheduleItem ? `${selectedScheduleItem.street}, ${selectedScheduleItem.barangay}` : 'Scheduled pickup'}
          wasteType={selectedScheduleItem ? selectedScheduleItem.wasteCategory : 'Not specified'}
          onClose={() => {
            setShowIssueModal(false);
            setSelectedPickupId(null);
          }}
          onSubmit={() => {
            setShowIssueModal(false);
            setSelectedPickupId(null);
            Alert.alert(
              'Issue Reported',
              'The issue has been reported successfully.',
              [{ text: 'OK' }]
            );
          }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4FBF1',
    paddingHorizontal: 20,
  },
  containerDark: {
    backgroundColor: '#111827',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  textLight: {
    color: '#F9FAFB',
  },
  textMuted: {
    color: '#9CA3AF',
  },
  header: {
    marginTop: 50,
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1A3B2B',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#4B5563',
  },
  assignmentBanner: {
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  assignmentBannerDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  assignmentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  assignmentPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  truckPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  truckPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E40AF',
  },
  unassignedWarning: {
    marginTop: 8,
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F2937',
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  countBadgeActive: {
    backgroundColor: '#DCFCE7',
  },
  countBadgeMuted: {
    backgroundColor: '#E2E8F0',
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  pickupCard: {
    backgroundColor: '#2D4A3E',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  pickupCardDark: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  barangayTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pickupBarangay: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  pickupDetails: {
    gap: 6,
    marginBottom: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dotGreen: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  detailIcon: {
    marginLeft: -1,
  },
  detailText: {
    fontSize: 13,
    color: '#F1F5F9',
    flex: 1,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    paddingTop: 12,
  },
  completeBtn: {
    flex: 1,
    backgroundColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  completeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  issueBtn: {
    flex: 1,
    backgroundColor: '#D97706',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  issueBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyCardDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  emptyText: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    textAlign: 'center',
  },
  emptySubText: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  weeklyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  weeklyCardDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  weeklyRow: {
    padding: 12,
  },
  weeklyRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  weeklyStreetText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  smallCategoryPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  smallCategoryPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  daysTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  daysTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  timeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  timeTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  offDutyNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    paddingTop: 12,
    marginTop: 4,
  },
  offDutyNoticeText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  pickupCardExclusive: {
    borderColor: '#F59E0B',
    borderWidth: 2,
  },
  exclusiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  exclusiveBannerText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#92400E',
  },
  exclusiveNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  exclusiveNoticeBannerDark: {
    backgroundColor: 'rgba(120, 53, 15, 0.15)',
    borderColor: '#D97706',
  },
  exclusiveNoticeTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400E',
  },
  exclusiveNoticeTitleDark: {
    color: '#FBBF24',
  },
  exclusiveNoticeSubtitle: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
    lineHeight: 16,
  },
  completedNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.4)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(52, 211, 153, 0.4)',
    marginTop: 4,
  },
  completedNoticeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#34D399',
  },
});
