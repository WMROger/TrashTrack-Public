import React, { useState, useEffect, createElement, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  doc,
  updateDoc,
  arrayUnion,
  deleteDoc,
  where,
  getDocs,
} from 'firebase/firestore';

import { db } from '../../../config/firebase';
import { DANAO_CITY_BARANGAYS } from '@/constants/danaoBarangays';
import { BARANGAY_COLLECTION_ROUTES } from '@/constants/barangaySimulationRoutes';
import AnalogTimePicker from './AnalogTimePicker';
import SchedulerCalendarView from './SchedulerCalendarView';
import * as XLSX from 'xlsx';
import { exportReport } from '@/services/reportExportService';
import { handleDriverBarangayReassignment } from '@/services/autoDispatchService';


const WebDatePicker = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) => {
  if (Platform.OS !== 'web') return null;

  return createElement('input', {
    type: 'date',
    value: value || new Date().toLocaleDateString('en-CA'),
    onChange: (e: any) => onChange(e.target.value),
    style: {
      padding: '12px 16px',
      borderRadius: '8px',
      border: '1px solid #CBD5E1',
      width: '100%',
      fontSize: '14px',
      height: '48px',
      backgroundColor: '#FFFFFF',
      color: '#111827',
      outline: 'none',
      fontFamily: 'inherit',
      boxSizing: 'border-box',
    },
  }) as any;
};

const COMMON_PICKUP_TIMES = [
  '05:00 AM',
  '05:30 AM',
  '06:00 AM',
  '06:30 AM',
  '07:00 AM',
  '07:30 AM',
  '08:00 AM',
  '08:30 AM',
  '09:00 AM',
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '01:00 PM',
  '02:00 PM',
  '03:00 PM',
  '04:00 PM',
  '05:00 PM',
  '06:00 PM',
];

const WebTimeSelect = ({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) => {
  if (Platform.OS !== 'web') return null;

  const normalizedValue = value || '06:00 AM';
  const options = COMMON_PICKUP_TIMES.includes(normalizedValue)
    ? COMMON_PICKUP_TIMES
    : [normalizedValue, ...COMMON_PICKUP_TIMES];

  return createElement(
    'select',
    {
      value: normalizedValue,
      disabled: disabled,
      onChange: (e: any) => onChange(e.target.value),
      style: {
        padding: '6px 12px',
        borderRadius: '8px',
        border: '1.5px solid #CBD5E1',
        fontSize: '13.5px',
        fontWeight: '700',
        color: '#0F172A',
        backgroundColor: '#FFFFFF',
        height: '38px',
        outline: 'none',
        fontFamily: 'inherit',
        cursor: 'pointer',
        boxSizing: 'border-box',
        minWidth: '150px',
      },
    },
    options.map((t) =>
      createElement(
        'option',
        { key: t, value: t },
        t === '06:00 AM'
          ? `${t} (Standard)`
          : t === '05:00 AM'
          ? `${t} (Early)`
          : t === '01:00 PM'
          ? `${t} (Afternoon)`
          : t === normalizedValue && !COMMON_PICKUP_TIMES.includes(t)
          ? `${t} (Custom)`
          : t
      )
    )
  ) as any;
};

const DAYS_OF_WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const DAY_ORDER_MAP: Record<string, number> = {
  MON: 0,
  MONDAY: 0,
  TUE: 1,
  TUESDAY: 1,
  WED: 2,
  WEDNESDAY: 2,
  THU: 3,
  THURSDAY: 3,
  FRI: 4,
  FRIDAY: 4,
  SAT: 5,
  SATURDAY: 5,
  SUN: 6,
  SUNDAY: 6,
};

export const sortDaysInOrder = (days: string[] = []): string[] => {
  if (!Array.isArray(days)) return [];
  return [...days].sort((a, b) => {
    const keyA = String(a || '').trim().toUpperCase();
    const keyB = String(b || '').trim().toUpperCase();
    const valA = DAY_ORDER_MAP[keyA] !== undefined ? DAY_ORDER_MAP[keyA] : 99;
    const valB = DAY_ORDER_MAP[keyB] !== undefined ? DAY_ORDER_MAP[keyB] : 99;
    return valA - valB;
  });
};

const CATEGORIES = [
  { name: 'BIODEGRADABLE', color: '#22C55E', icon: 'eco' },
  { name: 'NON-BIODEGRADABLE', color: '#2563EB', icon: 'delete-outline' },
  { name: 'RECYCLABLE', color: '#EAB308', icon: 'autorenew' },
  { name: 'RESIDUAL', color: '#6B7280', icon: 'restore-from-trash' },
  { name: 'HAZARDOUS', color: '#EF4444', icon: 'warning' },
  { name: 'SPECIAL/BULK', color: '#A855F7', icon: 'inventory-2' },
];


const SORT_OPTIONS = [
  { id: 'name_asc', label: 'Barangay (A - Z)' },
  { id: 'name_desc', label: 'Barangay (Z - A)' },
  { id: 'routes_count', label: 'Most Routes / Streets' },
  { id: 'newest', label: 'Recently Added' },
  { id: 'oldest', label: 'Oldest Added' },
];

export default function CollectionSchedulerTab({
  userRole,
  assignedBarangay,
  isReadOnly = false,
}: {
  userRole?: string;
  assignedBarangay?: string;
  isReadOnly?: boolean;
} = {}) {
  const isCoordinator = userRole === 'coordinator';
  const { width, height } = useWindowDimensions();
  const isMobile = width < 768;
  const isNarrow = width < 1024;

  const [schedules, setSchedules] = useState<any[]>([]);
  const [trucksList, setTrucksList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // View Mode: 'list' (accordion/cards) vs 'calendar' (interactive monthly calendar grid)
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

  // Filter & Search State
  const [selectedBarangayFilter, setSelectedBarangayFilter] = useState(
    isCoordinator && assignedBarangay ? assignedBarangay : 'ALL'
  );
  const [selectedDayFilter, setSelectedDayFilter] = useState('ALL');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name_asc');

  // Dropdown Open States
  const [isBarangayFilterOpen, setIsBarangayFilterOpen] = useState(false);
  const [isDayFilterOpen, setIsDayFilterOpen] = useState(false);
  const [isCategoryFilterOpen, setIsCategoryFilterOpen] = useState(false);
  const [isSortFilterOpen, setIsSortFilterOpen] = useState(false);

  const [barangaySearchFilterText, setBarangaySearchFilterText] = useState('');

  // Add / Edit Schedule Modal State
  const [isModalVisible, setModalVisible] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editingOriginalSchedule, setEditingOriginalSchedule] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

  // Form Fields
  const [barangayName, setBarangayName] = useState('');
  const [zone, setZone] = useState('');
  const [streetName, setStreetName] = useState('');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [truckName, setTruckName] = useState('');
  const [wasteCategory, setWasteCategory] = useState('BIODEGRADABLE');
  const [modalTimeStr, setModalTimeStr] = useState('06:00 AM');
  const [dayTimes, setDayTimes] = useState<{ [day: string]: string }>({});
  const [useCustomDayTimes, setUseCustomDayTimes] = useState(false);
  const [timePickerTargetDay, setTimePickerTargetDay] = useState<string | null>(null);
  const [showModalAnalogTimePicker, setShowModalAnalogTimePicker] = useState(false);
  const [barangaySuggestionsOpen, setBarangaySuggestionsOpen] = useState(false);
  const [streetSuggestionsOpen, setStreetSuggestionsOpen] = useState(false);
  const [truckPickerOpen, setTruckPickerOpen] = useState(false);
  const [truckPickerSearch, setTruckPickerSearch] = useState('');
  const [scheduleDriverId, setScheduleDriverId] = useState('');
  const [scheduleDriverName, setScheduleDriverName] = useState('');

  // Details Modal State (for specific date/time pickups)
  const [selectedBarangay, setSelectedBarangay] = useState<any>(null);
  const [isDetailsModalVisible, setDetailsModalVisible] = useState(false);
  const [isSavingDetail, setIsSavingDetail] = useState(false);
  const [specificCategory, setSpecificCategory] = useState('BIODEGRADABLE');
  const [isDeleting, setIsDeleting] = useState(false);
  const [specificDriverId, setSpecificDriverId] = useState('');
  const [specificDriverName, setSpecificDriverName] = useState('');
  const [isDriverPickerOpen, setIsDriverPickerOpen] = useState(false);

  // Export Modal State
  const [isExportModalVisible, setIsExportModalVisible] = useState(false);
  const [exportBarangay, setExportBarangay] = useState(
    isCoordinator && assignedBarangay ? assignedBarangay : 'ALL'
  );
  const [exportDays, setExportDays] = useState<string[]>([]);
  const [exportCategory, setExportCategory] = useState('ALL');
  const [includeSpecificInExport, setIncludeSpecificInExport] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportBarangayDropdownOpen, setIsExportBarangayDropdownOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv' | 'pdf'>('xlsx');

  // Accordion State
  const [expandedBarangay, setExpandedBarangay] = useState<string | null>(null);
  const [expandedStreet, setExpandedStreet] = useState<string | null>(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Web-friendly date/time states for specific pickups
  const [webDateStr, setWebDateStr] = useState(() => {
    if (Platform.OS === 'web') {
      return new Date().toLocaleDateString('en-CA');
    }
    return '';
  });
  const [webTimeStr, setWebTimeStr] = useState('06:00');
  const [detailModalFeedback, setDetailModalFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [dateObj, setDateObj] = useState(() => {
    const d = new Date();
    d.setHours(6, 0, 0, 0);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showAnalogTimePicker, setShowAnalogTimePicker] = useState(false);

  // 1. Subscribe to 'barangay_schedules' in Firestore
  useEffect(() => {
    const q = query(
      collection(db, 'barangay_schedules'),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setSchedules(docs);

        // Keep selected schedule in sync if modal is currently open
        if (selectedBarangay) {
          const updated = docs.find((d) => d.id === selectedBarangay.id);
          if (updated) setSelectedBarangay(updated);
        }
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching schedules:', err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [selectedBarangay?.id]);

  // 2. Subscribe to active trucks in Firestore
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'trucks'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setTrucksList(list);
      },
      (e) => console.log('Truck fetch warning:', e)
    );
    return () => unsub();
  }, []);

  // 2b. Subscribe to official drivers in Firestore
  const [driversList, setDriversList] = useState<any[]>([]);
  const [driversLoaded, setDriversLoaded] = useState(false);
  useEffect(() => {
    if (!db) return;
    const qDrivers = query(collection(db, 'users'), where('role', '==', 'driver'));
    const unsub = onSnapshot(
      qDrivers,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setDriversList(list);
        setDriversLoaded(true);
      },
      (e) => {
        console.log('Drivers fetch note:', e);
        setDriversLoaded(true);
      }
    );
    return () => unsub();
  }, []);

  // 2c. Subscribe to completed live collection records in 'schedules' to verify completions
  const [completedSchedulesList, setCompletedSchedulesList] = useState<any[]>([]);
  useEffect(() => {
    if (!db) return;
    const qSchedules = query(
      collection(db, 'schedules'),
      where('status', '==', 'completed')
    );
    const unsub = onSnapshot(
      qSchedules,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCompletedSchedulesList(list);
      },
      (e) => console.log('Completed schedules fetch note:', e)
    );
    return () => unsub();
  }, []);

  const isBarangayCompletedThisWeek = (bName: string, allSchedsInBarangay: any[]): boolean => {
    const norm = normalizeBrgy(bName);
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);

    // 1. Check if any schedule doc in barangay_schedules is marked completed this week
    const hasDocCompleted = allSchedsInBarangay.some((s) => {
      if (s.status === 'completed') {
        if (s.lastCompletedDate) {
          const lDate = new Date(s.lastCompletedDate);
          if (!isNaN(lDate.getTime()) && lDate >= startOfWeek) return true;
        }
        if (s.lastCompletedAt) {
          const lDate = s.lastCompletedAt?.toDate ? s.lastCompletedAt.toDate() : new Date(s.lastCompletedAt);
          if (lDate && !isNaN(lDate.getTime()) && lDate >= startOfWeek) return true;
        }
        return true;
      }
      return false;
    });

    if (hasDocCompleted) return true;

    // 2. Check in 'schedules' collection
    return completedSchedulesList.some((s) => {
      const sNorm = normalizeBrgy(s.barangay || s.barangayName || '');
      if (sNorm !== norm) return false;
      const compDate = s.completedAt?.toDate ? s.completedAt.toDate() : s.completedAt ? new Date(s.completedAt) : null;
      if (!compDate || isNaN(compDate.getTime())) return false;
      return compDate >= startOfWeek;
    });
  };

  const isBarangayDayFinished = (bName: string, day: string, allSchedsInBarangay: any[]): boolean => {
    const norm = normalizeBrgy(bName);
    const DOW_MAP = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    let phtNow = new Date();
    try {
      phtNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    } catch {
      phtNow = new Date(Date.now() + 8 * 3600000);
    }
    const todayPhtDateStr = phtNow.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const todayDow = DOW_MAP[phtNow.getDay()];

    const parseToDate = (raw: any): Date | null => {
      if (!raw) return null;
      if (typeof raw === 'object' && typeof raw.toDate === 'function') return raw.toDate();
      if (typeof raw === 'object' && typeof raw.seconds === 'number') return new Date(raw.seconds * 1000);
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    };

    // 1. If day is today's day of week: check if completed today
    if (day === todayDow) {
      const hasSchedDoneToday = allSchedsInBarangay.some((s) => {
        if (s.status !== 'completed') return false;
        if (s.lastCompletedDate === todayPhtDateStr) return true;
        const d = parseToDate(s.lastCompletedAt);
        return d && d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) === todayPhtDateStr;
      });
      if (hasSchedDoneToday) return true;

      const hasCompletedRunToday = completedSchedulesList.some((s) => {
        const sNorm = normalizeBrgy(s.barangay || s.barangayName || '');
        if (sNorm !== norm) {
          const matchStops = Array.isArray(s.stops) && s.stops.some((st: any) => {
            const stName = normalizeBrgy(st.name || st.street || st.barangay || '');
            return stName.includes(norm);
          });
          if (!matchStops) return false;
        }
        const d = parseToDate(s.completedAt) || parseToDate(s.updatedAt);
        return d && d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) === todayPhtDateStr;
      });
      if (hasCompletedRunToday) return true;
    }

    // 2. Check if completed earlier this week
    const dayOfWeekIdx = phtNow.getDay();
    const startOfWeek = new Date(phtNow);
    startOfWeek.setDate(phtNow.getDate() - dayOfWeekIdx);
    startOfWeek.setHours(0, 0, 0, 0);

    const hasCompletedRunThisWeek = completedSchedulesList.some((s) => {
      const sNorm = normalizeBrgy(s.barangay || s.barangayName || '');
      if (sNorm !== norm) {
        const matchStops = Array.isArray(s.stops) && s.stops.some((st: any) => {
          const stName = normalizeBrgy(st.name || st.street || st.barangay || '');
          return stName.includes(norm);
        });
        if (!matchStops) return false;
      }
      const d = parseToDate(s.completedAt) || parseToDate(s.updatedAt);
      if (!d || d < startOfWeek || d > phtNow) return false;
      const runDow = DOW_MAP[d.getDay()];
      return runDow === day;
    });

    return hasCompletedRunThisWeek;
  };

  const normalizeBrgy = (str?: string) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/^brgy\.?\s*/i, '')
      .replace(/^barangay\s*/i, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  };

  const getTruckBarangay = (t: any): string => {
    if (t.assignedBarangay && typeof t.assignedBarangay === 'string') return t.assignedBarangay.trim();
    if (t.barangay && typeof t.barangay === 'string') return t.barangay.trim();
    return '';
  };

  const getDriverBarangay = (drv: any): string => {
    if (!drv) return '';
    if (drv.assignedBarangay && typeof drv.assignedBarangay === 'string' && drv.assignedBarangay.trim()) {
      return drv.assignedBarangay.trim();
    }
    if (drv.barangay && typeof drv.barangay === 'string' && drv.barangay.trim()) {
      return drv.barangay.trim();
    }
    if (trucksList && trucksList.length > 0) {
      const driverTruck = trucksList.find(
        (t) => t.assignedDriverId === drv.id || (drv.currentTruckPlate && t.plateNumber === drv.currentTruckPlate)
      );
      if (driverTruck) {
        const truckB = getTruckBarangay(driverTruck);
        if (truckB) return truckB;
      }
    }
    return '';
  };

  // Helper to verify driver actually exists, is active, and is valid for this specific schedule barangay
  const getValidDriverName = (driverId?: string, driverName?: string, scheduleBarangay?: string): string | null => {
    if (!driverId && !driverName) return null;
    if (!driversLoaded) return null;
    if (!driversList.length) return null;

    const targetName = (driverName || '').trim().toLowerCase();
    const targetId = (driverId || '').trim();

    const found = driversList.find((d) => {
      if (d.disabled || d.status === 'disabled') return false;
      if (targetId && d.id === targetId) return true;
      if (targetName) {
        const dName = (d.displayName || d.fullName || d.name || '').trim().toLowerCase();
        if (dName && dName === targetName) return true;
      }
      return false;
    });

    if (found) {
      if (scheduleBarangay) {
        const dBarangay = getDriverBarangay(found);
        if (dBarangay && normalizeBrgy(dBarangay) !== normalizeBrgy(scheduleBarangay)) {
          return null; // Driver has been reassigned to a different barangay
        }
      }
      return found.displayName || found.fullName || found.name || driverName || 'Driver';
    }
    return null;
  };

  // 2c. Auto-cleanup orphaned/deleted/reassigned drivers from barangay_schedules
  useEffect(() => {
    if (!db || loading || !driversLoaded || !schedules.length) return;

    const schedulesToClean = schedules.filter((s) => {
      const sBrgy = s.barangayName || s.barangay || '';
      const hasWeeklyDriver = s.assignedDriverId || s.assignedDriverName;
      const weeklyInvalid = hasWeeklyDriver && !getValidDriverName(s.assignedDriverId, s.assignedDriverName, sBrgy);

      let specificInvalid = false;
      if (Array.isArray(s.specificSchedules) && s.specificSchedules.length > 0) {
        specificInvalid = s.specificSchedules.some(
          (ss: any) => (ss.assignedDriverId || ss.assignedDriverName) && !getValidDriverName(ss.assignedDriverId, ss.assignedDriverName, sBrgy)
        );
      }

      return weeklyInvalid || specificInvalid;
    });

    if (schedulesToClean.length > 0) {
      import('firebase/firestore').then(({ writeBatch, doc: firestoreDoc, serverTimestamp: firestoreServerTimestamp }) => {
        const batch = writeBatch(db);
        schedulesToClean.forEach((s) => {
          const sRef = firestoreDoc(db, 'barangay_schedules', s.id);
          const sBrgy = s.barangayName || s.barangay || '';
          const updates: any = {};

          if (s.assignedDriverId || s.assignedDriverName) {
            const valid = getValidDriverName(s.assignedDriverId, s.assignedDriverName, sBrgy);
            if (!valid) {
              updates.assignedDriverId = null;
              updates.assignedDriverName = null;
              updates.assignedDriverEmail = null;
            }
          }

          if (Array.isArray(s.specificSchedules) && s.specificSchedules.length > 0) {
            updates.specificSchedules = s.specificSchedules.map((ss: any) => {
              if (!ss.assignedDriverId && !ss.assignedDriverName) return ss;
              const valid = getValidDriverName(ss.assignedDriverId, ss.assignedDriverName, sBrgy);
              if (!valid) {
                return { ...ss, assignedDriverId: null, assignedDriverName: null, assignedDriverEmail: null };
              }
              return ss;
            });
          }

          updates.updatedAt = firestoreServerTimestamp();
          batch.update(sRef, updates);
        });

        batch.commit().catch((err) => console.warn('Cleaned orphaned/reassigned schedule drivers:', err));
      });
    }
  }, [schedules, driversList, driversLoaded, loading]);

  const filteredFleetTrucks = useMemo(() => {
    const q = truckPickerSearch.trim().toLowerCase();
    if (!q) return trucksList;
    return trucksList.filter((t) => {
      const plate = String(t.plateNumber || '').toLowerCase();
      const type = String(t.type || '').toLowerCase();
      const brgy = String(getTruckBarangay(t) || '').toLowerCase();
      const driver = String(t.assignedDriverName || '').toLowerCase();
      return plate.includes(q) || type.includes(q) || brgy.includes(q) || driver.includes(q);
    });
  }, [trucksList, truckPickerSearch]);

  const matchingBarangayTrucks = useMemo(() => {
    const targetNorm = normalizeBrgy(barangayName);
    if (!targetNorm) return [];
    return filteredFleetTrucks.filter((t) => {
      const truckNorm = normalizeBrgy(getTruckBarangay(t));
      return truckNorm === targetNorm;
    });
  }, [filteredFleetTrucks, barangayName]);

  const availableTrucksForBarangay = matchingBarangayTrucks;

  const isDriverInBarangay = (drv: any, targetBarangay?: string): boolean => {
    if (!targetBarangay || targetBarangay === 'ALL') return true;
    const targetNorm = normalizeBrgy(targetBarangay);
    if (!targetNorm) return true;
    const driverNorm = normalizeBrgy(getDriverBarangay(drv));
    return driverNorm === targetNorm;
  };

  // Details Modal (Special Pickups) Driver Lists
  const detailsModalBarangay = useMemo(() => {
    if (isCoordinator && assignedBarangay) return assignedBarangay.trim();
    return (selectedBarangay?.barangayName || selectedBarangay?.barangay || '').trim();
  }, [isCoordinator, assignedBarangay, selectedBarangay]);

  const { matchingDetailsDrivers, otherDetailsDrivers } = useMemo(() => {
    const activeDrivers = driversList.filter((d) => !d.disabled && d.status !== 'disabled');
    const targetNorm = normalizeBrgy(detailsModalBarangay);

    if (!targetNorm) {
      return { matchingDetailsDrivers: activeDrivers, otherDetailsDrivers: [] };
    }

    const matching: any[] = [];
    const others: any[] = [];

    activeDrivers.forEach((d) => {
      const dBrgyNorm = normalizeBrgy(getDriverBarangay(d));
      if (dBrgyNorm === targetNorm) {
        matching.push(d);
      } else {
        others.push(d);
      }
    });

    return { matchingDetailsDrivers: matching, otherDetailsDrivers: others };
  }, [driversList, detailsModalBarangay, trucksList]);

  const coordinatorDetailsDrivers = useMemo(() => {
    const currentId = selectedBarangay?.assignedDriverId;
    if (currentId && !matchingDetailsDrivers.some((d) => d.id === currentId)) {
      const existing = driversList.find((d) => d.id === currentId);
      if (existing) return [existing, ...matchingDetailsDrivers];
    }
    return matchingDetailsDrivers;
  }, [matchingDetailsDrivers, selectedBarangay?.assignedDriverId, driversList]);

  // Add / Edit Schedule Modal Driver Lists
  const scheduleModalTargetBarangay = useMemo(() => {
    if (isCoordinator && assignedBarangay) return assignedBarangay.trim();
    return barangayName.trim();
  }, [isCoordinator, assignedBarangay, barangayName]);

  const { matchingScheduleDrivers, otherScheduleDrivers } = useMemo(() => {
    const activeDrivers = driversList.filter((d) => !d.disabled && d.status !== 'disabled');
    const targetNorm = normalizeBrgy(scheduleModalTargetBarangay);

    if (!targetNorm) {
      return { matchingScheduleDrivers: activeDrivers, otherScheduleDrivers: [] };
    }

    const matching: any[] = [];
    const others: any[] = [];

    activeDrivers.forEach((d) => {
      const dBrgyNorm = normalizeBrgy(getDriverBarangay(d));
      if (dBrgyNorm === targetNorm) {
        matching.push(d);
      } else {
        others.push(d);
      }
    });

    return { matchingScheduleDrivers: matching, otherScheduleDrivers: others };
  }, [driversList, scheduleModalTargetBarangay, trucksList]);

  const coordinatorScheduleDrivers = useMemo(() => {
    if (scheduleDriverId && !matchingScheduleDrivers.some((d) => d.id === scheduleDriverId)) {
      const existing = driversList.find((d) => d.id === scheduleDriverId);
      if (existing) return [existing, ...matchingScheduleDrivers];
    }
    return matchingScheduleDrivers;
  }, [matchingScheduleDrivers, scheduleDriverId, driversList]);

  // 3. Extract unique dynamic barangays purely from 'barangay_schedules'
  const dynamicBarangays = useMemo(() => {
    const set = new Set<string>();
    schedules.forEach((s) => {
      if (s.barangayName && typeof s.barangayName === 'string' && s.barangayName.trim()) {
        set.add(s.barangayName.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [schedules]);

  // List of hardcoded Danao City barangays that DO NOT exist in backend 'barangay_schedules' yet
  const availableUnregisteredDanaoBarangays: string[] = useMemo(() => {
    const existingLower = new Set(
      dynamicBarangays.map((b) => b.trim().toLowerCase())
    );
    // If editing, allow the current barangay being edited
    const editingLower = editingScheduleId
      ? (schedules.find((s) => s.id === editingScheduleId)?.barangayName || '').trim().toLowerCase()
      : null;
    return DANAO_CITY_BARANGAYS.filter((b) => {
      const lower = b.trim().toLowerCase();
      if (editingLower && lower === editingLower) return true;
      return !existingLower.has(lower);
    });
  }, [dynamicBarangays, editingScheduleId, schedules]);

  // Matching Danao City barangays (all 42), with unassigned ones sorted first
  const matchingDanaoBarangays = useMemo(() => {
    const queryText = barangayName.trim().toLowerCase();
    const existingSet = new Set(dynamicBarangays.map((b) => b.trim().toLowerCase()));
    
    let list: string[] = [...DANAO_CITY_BARANGAYS];
    if (queryText) {
      list = list.filter((b) => b.toLowerCase().includes(queryText));
    }
    
    // Sort: unassigned first, then alphabetical
    return list.sort((a, b) => {
      const aRegistered = existingSet.has(a.toLowerCase());
      const bRegistered = existingSet.has(b.toLowerCase());
      if (aRegistered === bRegistered) return a.localeCompare(b);
      return aRegistered ? 1 : -1;
    });
  }, [barangayName, dynamicBarangays]);

  // Check if typed barangay name exists exactly in Danao City list
  const isExactDanaoMatch = useMemo(() => {
    const queryText = barangayName.trim().toLowerCase();
    if (!queryText) return true;
    return DANAO_CITY_BARANGAYS.some((b) => b.toLowerCase() === queryText);
  }, [barangayName]);

  // Check if current typed barangay name is already registered, and count its existing routes
  const existingRoutesCount = useMemo(() => {
    const name = barangayName.trim().toLowerCase();
    if (!name) return 0;
    return schedules.filter((s) => (s.barangayName || '').trim().toLowerCase() === name).length;
  }, [barangayName, schedules]);

  const isAlreadyRegistered = useMemo(() => {
    if (editingScheduleId) return false;
    return existingRoutesCount > 0;
  }, [existingRoutesCount, editingScheduleId]);

  // Suggested streets / route sectors for the chosen barangay
  const suggestedStreetsForBarangay = useMemo(() => {
    const bName = barangayName.trim();
    const knownWaypoints = BARANGAY_COLLECTION_ROUTES[bName] || [];
    const set = new Set<string>();
    set.add('Whole Barangay');
    knownWaypoints.forEach((w) => {
      if (w.name && !w.name.includes('Depot') && !w.name.includes('Transfer Station')) {
        set.add(w.name);
      }
    });
    set.add('Purok 1');
    set.add('Purok 2');
    set.add('Purok 3');
    set.add('Main Highway Sector');
    const all = Array.from(set);
    const q = streetName.trim().toLowerCase();
    if (!q) return all.slice(0, 8);
    return all.filter((s) => s.toLowerCase().includes(q));
  }, [barangayName, streetName]);

  // Filtered list of barangays for the filter dropdown
  const filteredBarangayDropdownList = useMemo(() => {
    if (!barangaySearchFilterText.trim()) return dynamicBarangays;
    const q = barangaySearchFilterText.toLowerCase().trim();
    return dynamicBarangays.filter((b) => b.toLowerCase().includes(q));
  }, [dynamicBarangays, barangaySearchFilterText]);

  // 4. Filtering and Sorting Pipeline
  const { filteredGroups, sortedBarangayKeys, totalFilteredSchedules } = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    const filtered = schedules.filter((s) => {
      // Barangay filter - coordinator is strictly locked to their assigned barangay
      const targetBarangay = isCoordinator && assignedBarangay ? assignedBarangay : selectedBarangayFilter;
      if (targetBarangay !== 'ALL' && s.barangayName?.toLowerCase() !== targetBarangay.toLowerCase()) {
        return false;
      }

      // Day filter
      if (selectedDayFilter !== 'ALL') {
        const days = Array.isArray(s.days) ? s.days : [];
        const hasDay = days.some(
          (d: string) =>
            d.toUpperCase().includes(selectedDayFilter.toUpperCase()) ||
            selectedDayFilter.toUpperCase().includes(d.toUpperCase())
        );
        if (!hasDay) return false;
      }

      // Category filter
      if (selectedCategoryFilter !== 'ALL' && s.wasteCategory !== selectedCategoryFilter) {
        return false;
      }

      // Free-text Search Query
      if (q) {
        const bName = (s.barangayName || '').toLowerCase();
        const street = (s.streetName || '').toLowerCase();
        const trk = (s.truck || '').toLowerCase();
        const cat = (s.wasteCategory || '').toLowerCase();
        const zoneText = (s.zone || '').toLowerCase();
        const daysStr = (s.days || []).join(' ').toLowerCase();

        if (
          !bName.includes(q) &&
          !street.includes(q) &&
          !trk.includes(q) &&
          !cat.includes(q) &&
          !zoneText.includes(q) &&
          !daysStr.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });

    // Group by Barangay -> Street
    const groups: Record<string, Record<string, any[]>> = {};
    filtered.forEach((s) => {
      const b = s.barangayName || 'Unassigned Barangay';
      const street = s.streetName || 'Whole Barangay';
      if (!groups[b]) groups[b] = {};
      if (!groups[b][street]) groups[b][street] = [];
      groups[b][street].push(s);
    });

    // Sort Barangay Groups
    let bKeys = Object.keys(groups);
    if (sortBy === 'name_asc') {
      bKeys.sort((a, b) => a.localeCompare(b));
    } else if (sortBy === 'name_desc') {
      bKeys.sort((a, b) => b.localeCompare(a));
    } else if (sortBy === 'routes_count') {
      bKeys.sort(
        (a, b) =>
          Object.keys(groups[b]).length - Object.keys(groups[a]).length ||
          a.localeCompare(b)
      );
    } else if (sortBy === 'newest' || sortBy === 'oldest') {
      bKeys.sort((a, b) => {
        const aScheds = Object.values(groups[a]).flat();
        const bScheds = Object.values(groups[b]).flat();
        const aTime = Math.max(...aScheds.map((s) => s.createdAt?.seconds || 0));
        const bTime = Math.max(...bScheds.map((s) => s.createdAt?.seconds || 0));
        return sortBy === 'newest' ? bTime - aTime : aTime - bTime;
      });
    }

    return {
      filteredGroups: groups,
      sortedBarangayKeys: bKeys,
      totalFilteredSchedules: filtered.length,
    };
  }, [
    schedules,
    selectedBarangayFilter,
    selectedDayFilter,
    selectedCategoryFilter,
    searchQuery,
    sortBy,
  ]);

  // Paginated Barangay Keys
  const totalPages = Math.max(1, Math.ceil(sortedBarangayKeys.length / itemsPerPage));
  const paginatedBarangayKeys = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedBarangayKeys.slice(start, start + itemsPerPage);
  }, [sortedBarangayKeys, currentPage, itemsPerPage]);

  const toggleDay = (day: string) => {
    const isAlreadySelected = selectedDays.includes(day);
    const updated = isAlreadySelected
      ? selectedDays.filter((d) => d !== day)
      : [...selectedDays, day];
    const sorted = sortDaysInOrder(updated);
    setSelectedDays(sorted);

    if (!isAlreadySelected) {
      setDayTimes((prev) => ({
        ...prev,
        [day]: prev[day] || modalTimeStr || '06:00 AM',
      }));
    }
    if (formErrors.selectedDays) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next.selectedDays;
        return next;
      });
    }
  };

  const handleSelectAllDays = () => {
    if (selectedDays.length === DAYS_OF_WEEK.length) {
      setSelectedDays([]);
    } else {
      setSelectedDays([...DAYS_OF_WEEK]);
      setDayTimes((prev) => {
        const next = { ...prev };
        DAYS_OF_WEEK.forEach((d) => {
          if (!next[d]) next[d] = modalTimeStr || '06:00 AM';
        });
        return next;
      });
    }
    if (formErrors.selectedDays) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next.selectedDays;
        return next;
      });
    }
  };

  // Open modal for Create New Barangay & Schedule
  const handleOpenAddModal = (presetBarangayName?: string) => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Creating collection schedules is restricted in Read-Only Mode.');
      return;
    }
    setEditingScheduleId(null);
    setBarangayName(isCoordinator && assignedBarangay ? assignedBarangay : (presetBarangayName || ''));
    setZone('');
    setStreetName('');
    const defaultDays = sortDaysInOrder(['MON', 'WED', 'FRI']);
    setSelectedDays(defaultDays);
    setTruckName('');
    setScheduleDriverId('');
    setScheduleDriverName('');
    setWasteCategory('BIODEGRADABLE');
    setModalTimeStr('06:00 AM');
    setDayTimes({
      MON: '06:00 AM',
      WED: '06:00 AM',
      FRI: '06:00 AM',
    });
    setUseCustomDayTimes(false);
    setTimePickerTargetDay(null);
    setShowModalAnalogTimePicker(false);
    setFormErrors({});
    setBarangaySuggestionsOpen(false);
    setStreetSuggestionsOpen(false);
    setTruckPickerOpen(false);
    setTruckPickerSearch('');
    setModalVisible(true);
  };

  // Open modal for Editing an existing schedule
  const handleOpenEditModal = (schedule: any) => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Modifying collection schedules is restricted in Read-Only Mode.');
      return;
    }
    if (isCoordinator && assignedBarangay && schedule.barangayName?.toLowerCase() !== assignedBarangay.toLowerCase()) {
      Alert.alert(
        'Permission Scoped',
        `As Barangay Environmental Coordinator, you can only modify schedules for your assigned barangay (Brgy. ${assignedBarangay}).`
      );
      return;
    }
    setEditingScheduleId(schedule.id);
    setEditingOriginalSchedule(schedule);
    setBarangayName(schedule.barangayName || '');

    setZone(schedule.zone || '');
    setStreetName(schedule.streetName || '');
    const currentDays = sortDaysInOrder(schedule.days || []);
    setSelectedDays(currentDays);
    setTruckName(schedule.truck || '');
    const validDriver = getValidDriverName(schedule.assignedDriverId, schedule.assignedDriverName, schedule.barangayName || schedule.barangay);
    setScheduleDriverId(validDriver ? (schedule.assignedDriverId || '') : '');
    setScheduleDriverName(validDriver || '');
    setWasteCategory(schedule.wasteCategory || 'BIODEGRADABLE');
    const defaultTime = schedule.time || schedule.timeText || schedule.collectionTime || '06:00 AM';
    setModalTimeStr(defaultTime);
    const dt: { [day: string]: string } = {};
    let hasCustomTimes = false;
    currentDays.forEach((d: string) => {
      const dayT = (schedule.dayTimes && schedule.dayTimes[d]) || defaultTime;
      dt[d] = dayT;
      if (dayT !== defaultTime) {
        hasCustomTimes = true;
      }
    });
    setDayTimes(dt);
    setUseCustomDayTimes(hasCustomTimes);
    setTimePickerTargetDay(null);
    setShowModalAnalogTimePicker(false);
    setFormErrors({});
    setBarangaySuggestionsOpen(false);
    setStreetSuggestionsOpen(false);
    setTruckPickerOpen(false);
    setTruckPickerSearch('');
    setModalVisible(true);
  };

  // Save or Update Schedule
  const handleSaveSchedule = async () => {
    const errors: { [key: string]: string } = {};

    if (!barangayName.trim()) {
      errors.barangayName = 'Barangay name is required.';
    }
    if (!streetName.trim()) {
      errors.streetName = 'Street or route sector is required (e.g., Whole Barangay).';
    }
    if (selectedDays.length === 0) {
      errors.selectedDays = 'Select at least one regular collection day.';
    }

    // Duplicate schedule validation:
    // Check if another schedule already exists for the same Barangay, same Route/Sector,
    // same Waste Category, and overlapping collection days.
    const normTargetB = normalizeBrgy(barangayName);
    const normTargetStreet = streetName.trim().toLowerCase();
    const checkDays = sortDaysInOrder(selectedDays);

    const duplicateSchedule = schedules.find((s) => {
      // Ignore current schedule doc if editing
      if (editingScheduleId && s.id === editingScheduleId) return false;

      const normSBrgy = normalizeBrgy(s.barangayName || s.barangay);
      if (normSBrgy !== normTargetB) return false;

      const normSStreet = (s.streetName || s.street || '').trim().toLowerCase();
      if (normSStreet !== normTargetStreet) return false;

      const sCategory = (s.wasteCategory || '').trim().toUpperCase();
      const targetCategory = (wasteCategory || '').trim().toUpperCase();

      // Check for day overlaps
      const sDays: string[] = s.days || [];
      const overlappingDays = sDays.filter((d) => checkDays.includes(d));

      if (overlappingDays.length > 0) {
        // Duplicate if same waste category on any of the same days OR exact same time
        if (sCategory === targetCategory) return true;

        const chosenTime = modalTimeStr || '06:00 AM';
        const sTime = s.time || s.timeText || s.collectionTime || '';
        if (sTime && sTime === chosenTime) return true;
      }

      return false;
    });

    if (duplicateSchedule) {
      const sDays: string[] = duplicateSchedule.days || [];
      const overlappingDays = sDays.filter((d: string) => checkDays.includes(d));
      const overlapText = overlappingDays.length > 0 ? overlappingDays.join(', ') : checkDays.join(', ');
      const dupMsg = `A schedule for ${barangayName.trim()} — "${streetName.trim()}" on ${overlapText} (${wasteCategory}) already exists.`;
      
      errors.streetName = dupMsg;
      setFormErrors(errors);
      if (typeof window !== 'undefined' && (window as any).alert) {
        (window as any).alert(`Duplicate Schedule Detected:\n${dupMsg}\n\nPlease choose a different day, route sector, or waste category.`);
      } else {
        Alert.alert(
          'Duplicate Schedule Detected',
          `${dupMsg}\n\nPlease choose a different day, route sector, or waste category.`,
          [{ text: 'OK' }]
        );
      }
      return;
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const chosenTime = modalTimeStr || '06:00 AM';
      const sortedDays = sortDaysInOrder(selectedDays);
      const cleanedDayTimes: { [day: string]: string } = {};
      sortedDays.forEach((d) => {
        cleanedDayTimes[d] = useCustomDayTimes ? (dayTimes[d] || chosenTime) : chosenTime;
      });

      const selectedDriverObj = driversList.find((d) => d.id === scheduleDriverId);
      const resolvedDriverName = scheduleDriverName || (selectedDriverObj ? (selectedDriverObj.displayName || selectedDriverObj.name || selectedDriverObj.email) : null);
      const schedulePayload = {
        barangayName: barangayName.trim(),
        zone: zone.trim(),
        streetName: streetName.trim(),
        days: sortedDays,
        dayTimes: cleanedDayTimes,
        truck: truckName.trim(),
        assignedDriverId: scheduleDriverId || null,
        assignedDriverName: resolvedDriverName || null,
        assignedDriverEmail: selectedDriverObj?.email || null,
        wasteCategory: wasteCategory,
        time: chosenTime,
        timeText: chosenTime,
        collectionTime: chosenTime,
        updatedAt: serverTimestamp(),
      };

      let savedScheduleId = editingScheduleId;
      if (editingScheduleId) {
        // Update existing schedule doc
        const docRef = doc(db, 'barangay_schedules', editingScheduleId);
        await updateDoc(docRef, schedulePayload);
      } else {
        // Create new schedule doc
        const newDocRef = await addDoc(collection(db, 'barangay_schedules'), {
          ...schedulePayload,
          createdAt: serverTimestamp(),
        });
        savedScheduleId = newDocRef.id;
      }

      // If a driver was assigned to this schedule, unassign them from all other barangay schedules!
      if (scheduleDriverId) {
        const targetBarangayNorm = normalizeBrgy(barangayName);

        // 1. Unassign this driver from all other barangay schedules directly in Firestore
        try {
          const allBSchedSnap = await getDocs(collection(db, 'barangay_schedules'));
          for (const sDoc of allBSchedSnap.docs) {
            if (sDoc.id === savedScheduleId) continue;
            const sData = sDoc.data();
            const sBrgyNorm = normalizeBrgy(sData.barangayName || sData.barangay);

            let needsUpdate = false;
            const updates: any = {};

            const isWeeklyMatch =
              sData.assignedDriverId === scheduleDriverId ||
              (resolvedDriverName && String(sData.assignedDriverName || '').trim().toLowerCase() === resolvedDriverName.trim().toLowerCase()) ||
              (selectedDriverObj?.email && String(sData.assignedDriverEmail || '').trim().toLowerCase() === selectedDriverObj.email.trim().toLowerCase());

            if (isWeeklyMatch && sBrgyNorm !== targetBarangayNorm) {
              updates.assignedDriverId = null;
              updates.assignedDriverName = null;
              updates.assignedDriverEmail = null;
              needsUpdate = true;
            }

            if (Array.isArray(sData.specificSchedules) && sData.specificSchedules.length > 0) {
              const hasDriverInSpecific = sData.specificSchedules.some(
                (ss: any) =>
                  ss.assignedDriverId === scheduleDriverId ||
                  (resolvedDriverName && String(ss.assignedDriverName || '').trim().toLowerCase() === resolvedDriverName.trim().toLowerCase()) ||
                  (selectedDriverObj?.email && String(ss.assignedDriverEmail || '').trim().toLowerCase() === selectedDriverObj.email.trim().toLowerCase())
              );
              if (hasDriverInSpecific && sBrgyNorm !== targetBarangayNorm) {
                updates.specificSchedules = sData.specificSchedules.map((ss: any) => {
                  const ssMatch =
                    ss.assignedDriverId === scheduleDriverId ||
                    (resolvedDriverName && String(ss.assignedDriverName || '').trim().toLowerCase() === resolvedDriverName.trim().toLowerCase()) ||
                    (selectedDriverObj?.email && String(ss.assignedDriverEmail || '').trim().toLowerCase() === selectedDriverObj.email.trim().toLowerCase());
                  if (ssMatch) {
                    return { ...ss, assignedDriverId: null, assignedDriverName: null, assignedDriverEmail: null };
                  }
                  return ss;
                });
                needsUpdate = true;
              }
            }

            if (needsUpdate) {
              updates.updatedAt = serverTimestamp();
              await updateDoc(sDoc.ref, updates);
            }
          }
        } catch (uErr) {
          console.warn('Could not unassign driver from previous barangay schedules:', uErr);
        }

        // 2. Proactively cancel previous active dispatches and re-queue reports
        try {
          await handleDriverBarangayReassignment(scheduleDriverId, barangayName.trim());
        } catch (reassignErr) {
          console.warn('Could not run handleDriverBarangayReassignment:', reassignErr);
        }
      }


      // Find the selected truck from trucksList (by plateNumber or id)
      const targetTruckPlate = truckName.trim().toLowerCase();
      const selectedTruck = targetTruckPlate
        ? trucksList.find(
            (t) =>
              (t.plateNumber && String(t.plateNumber).trim().toLowerCase() === targetTruckPlate) ||
              (t.id && String(t.id).trim().toLowerCase() === targetTruckPlate)
          )
        : null;

      // Synchronize driver and fleet truck assignments
      if (scheduleDriverId) {
        // Find if this driver was previously assigned to another truck in the fleet
        const prevTruck = trucksList.find(
          (t) =>
            t.assignedDriverId === scheduleDriverId &&
            (!selectedTruck || t.id !== selectedTruck.id)
        );

        const prevTruckId =
          prevTruck?.id ||
          (selectedDriverObj?.currentTruckId && (!selectedTruck || selectedDriverObj.currentTruckId !== selectedTruck.id)
            ? selectedDriverObj.currentTruckId
            : null);

        // If driver had a previous truck and it differs from the newly selected truck:
        // Automatically unassign the driver from their previous truck in trucks and truck_usage_history
        if (prevTruckId) {
          const oldTruckDoc = trucksList.find((t) => t.id === prevTruckId);
          try {
            await updateDoc(doc(db, 'trucks', prevTruckId), {
              assignedDriverId: null,
              assignedDriverName: null,
              shiftStartedAt: null,
              lastDriverId: scheduleDriverId,
              lastDriverName: resolvedDriverName,
              lastUsedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            await addDoc(collection(db, 'truck_usage_history'), {
              truckId: prevTruckId,
              truckPlate: oldTruckDoc?.plateNumber || '',
              driverId: scheduleDriverId,
              driverName: resolvedDriverName || 'Driver',
              action: 'reassigned_by_schedule_update',
              timestamp: serverTimestamp(),
              createdAt: serverTimestamp(),
              status: 'unassigned',
            });
          } catch (unassignErr) {
            console.warn('Could not unassign driver from previous truck:', unassignErr);
          }
        }

        // If a fleet truck is selected for this schedule:
        if (selectedTruck) {
          // If this selected truck was previously assigned to a different driver, unassign that driver
          if (selectedTruck.assignedDriverId && selectedTruck.assignedDriverId !== scheduleDriverId) {
            const previousTruckDriverId = selectedTruck.assignedDriverId;
            try {
              await updateDoc(doc(db, 'users', previousTruckDriverId), {
                currentTruckId: null,
                currentTruckPlate: null,
                assignedTruck: null,
                status: 'off_duty',
                dutyStatus: 'off_duty',
                unassignedNotice: {
                  truckPlate: selectedTruck.plateNumber || 'Assigned Truck',
                  truckId: selectedTruck.id,
                  unassignedAt: new Date().toISOString(),
                  unassignedBy: isCoordinator ? `Brgy. ${assignedBarangay} Coordinator` : 'CENRO Fleet Admin',
                  acknowledged: false,
                },
                updatedAt: serverTimestamp(),
              });

              await addDoc(collection(db, 'notifications'), {
                userId: previousTruckDriverId,
                title: '🚛 Truck Reassigned',
                message: `Your previous truck ${selectedTruck.plateNumber || ''} has been reassigned to ${resolvedDriverName || 'another driver'} via schedule update.`,
                type: 'truck_unassigned',
                read: false,
                createdAt: serverTimestamp(),
              });
            } catch (pErr) {
              console.warn('Could not unassign previous driver of selected truck:', pErr);
            }
          }

          // Assign driver to this truck in trucks collection
          try {
            await updateDoc(doc(db, 'trucks', selectedTruck.id), {
              assignedDriverId: scheduleDriverId,
              assignedDriverName: resolvedDriverName,
              assignedBarangay: barangayName.trim(),
              barangay: barangayName.trim(),
              shiftStartedAt: null,
              lastDriverId: scheduleDriverId,
              lastDriverName: resolvedDriverName,
              lastUsedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (tErr) {
            console.warn('Could not assign driver to selected truck:', tErr);
          }

          // Update driver's user document with new truck and barangay
          try {
            await updateDoc(doc(db, 'users', scheduleDriverId), {
              assignedBarangay: barangayName.trim(),
              barangay: barangayName.trim(),
              currentTruckId: selectedTruck.id,
              currentTruckPlate: selectedTruck.plateNumber || truckName.trim(),
              assignedTruck: selectedTruck.plateNumber || truckName.trim(),
              unassignedNotice: null,
              updatedAt: serverTimestamp(),
            });
          } catch (uErr) {
            console.warn('Could not update driver profile with new truck:', uErr);
          }

          // Update employee_ids if existing
          try {
            const empQ = query(collection(db, 'employee_ids'), where('userId', '==', scheduleDriverId));
            const empSnap = await getDocs(empQ);
            empSnap.forEach(async (d) => {
              await updateDoc(d.ref, {
                assignedTruckId: selectedTruck.id,
                assignedTruckPlate: selectedTruck.plateNumber || truckName.trim(),
                updatedAt: serverTimestamp(),
              });
            });
          } catch (empErr) {
            console.warn('Could not update employee_ids for reassigned driver:', empErr);
          }
        } else {
          // No fleet truck selected (custom unit name or unassigned), just update driver's barangay and clear old truck if reassigned
          try {
            await updateDoc(doc(db, 'users', scheduleDriverId), {
              assignedBarangay: barangayName.trim(),
              barangay: barangayName.trim(),
              ...(prevTruckId
                ? {
                    currentTruckId: null,
                    currentTruckPlate: null,
                    assignedTruck: null,
                  }
                : {}),
              updatedAt: serverTimestamp(),
            });
          } catch (uErr) {
            console.warn('Could not update driver profile assignedBarangay:', uErr);
          }
        }
      } else {
        // Driver was cleared/removed in this schedule
        if (editingOriginalSchedule?.assignedDriverId && selectedTruck) {
          if (selectedTruck.assignedDriverId === editingOriginalSchedule.assignedDriverId) {
            const oldDriverId = editingOriginalSchedule.assignedDriverId;
            try {
              await updateDoc(doc(db, 'trucks', selectedTruck.id), {
                assignedDriverId: null,
                assignedDriverName: null,
                shiftStartedAt: null,
                updatedAt: serverTimestamp(),
              });
              await updateDoc(doc(db, 'users', oldDriverId), {
                currentTruckId: null,
                currentTruckPlate: null,
                assignedTruck: null,
                status: 'off_duty',
                dutyStatus: 'off_duty',
                updatedAt: serverTimestamp(),
              });
            } catch (e) {
              console.warn('Could not unassign previous driver from truck:', e);
            }
          }
        }
      }

      const savedBarangay = barangayName.trim();
      const savedStreet = streetName.trim();
      const schedAction = editingScheduleId ? 'Updated' : 'Created';

      setModalVisible(false);
      setEditingScheduleId(null);
      setEditingOriginalSchedule(null);
      setBarangayName('');

      setZone('');
      setStreetName('');
      setSelectedDays([]);
      setDayTimes({});
      setTimePickerTargetDay(null);
      setTruckName('');
      setScheduleDriverId('');
      setScheduleDriverName('');
      setWasteCategory('BIODEGRADABLE');
      setFormErrors({});

      const successTitle = `Route Schedule ${schedAction}!`;
      const successMsg = `Collection route schedule for Brgy. ${savedBarangay} (${savedStreet}) has been ${schedAction.toLowerCase()} successfully.`;
      if (Platform.OS === 'web') {
        window.alert(`✓ ${successTitle}\n\n${successMsg}`);
      } else {
        Alert.alert(successTitle, successMsg);
      }
    } catch (error: any) {
      console.error('Error saving schedule:', error);
      Alert.alert('Error', error.message || 'Could not save the schedule.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick 1-tap assign driver to active weekly schedule
  const handleAssignWeeklyDriver = async (
    scheduleId: string,
    driverId: string,
    driverName: string,
    driverEmail: string,
    bName: string
  ) => {
    if (!db || !scheduleId) return;
    try {
      await updateDoc(doc(db, 'barangay_schedules', scheduleId), {
        assignedDriverId: driverId || null,
        assignedDriverName: driverName || null,
        assignedDriverEmail: driverEmail || null,
        updatedAt: serverTimestamp(),
      });

      if (driverId && bName) {
        try {
          await updateDoc(doc(db, 'users', driverId), {
            assignedBarangay: bName.trim(),
            barangay: bName.trim(),
            updatedAt: serverTimestamp(),
          });
        } catch (uErr) {
          console.warn('Could not update driver profile assignedBarangay:', uErr);
        }

        try {
          await handleDriverBarangayReassignment(driverId, bName.trim());
        } catch (reassignErr) {
          console.warn('handleAssignWeeklyDriver: Could not run handleDriverBarangayReassignment:', reassignErr);
        }
      }

      setSelectedBarangay((prev: any) =>
        prev
          ? {
              ...prev,
              assignedDriverId: driverId || null,
              assignedDriverName: driverName || null,
              assignedDriverEmail: driverEmail || null,
            }
          : prev
      );
    } catch (err: any) {
      console.error('Failed to assign driver to weekly schedule:', err);
      Alert.alert('Error', err.message || 'Failed to assign driver.');
    }
  };

  // Delete Schedule
  const handleDeleteSchedule = async (scheduleId: string) => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Deleting collection schedules is restricted in Read-Only Mode.');
      return;
    }
    const targetSchedule = schedules.find(s => s.id === scheduleId);
    if (isCoordinator && assignedBarangay && targetSchedule?.barangayName?.toLowerCase() !== assignedBarangay.toLowerCase()) {
      Alert.alert(
        'Permission Scoped',
        `As Barangay Environmental Coordinator, you can only delete schedules for your assigned barangay (Brgy. ${assignedBarangay}).`
      );
      return;
    }
    const doDelete = async () => {
      setIsDeleting(true);
      try {
        await deleteDoc(doc(db, 'barangay_schedules', scheduleId));
        if (selectedBarangay?.id === scheduleId) {
          setDetailsModalVisible(false);
        }
      } catch (err: any) {
        console.error('Error deleting:', err);
        Alert.alert('Error', 'Could not delete schedule.');
      } finally {
        setIsDeleting(false);
      }
    };

    if (Platform.OS === 'web') {
      const confirmed = window.confirm(
        'Are you sure you want to remove this schedule? This will immediately remove it from the citizen and driver schedules.'
      );
      if (confirmed) await doDelete();
    } else {
      Alert.alert(
        'Delete Schedule',
        'Are you sure you want to remove this schedule? This will immediately remove it from citizen and driver schedules.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  };

  // Add Specific Date/Time Pickup
  const formattedDate =
    Platform.OS === 'web'
      ? webDateStr
        ? `${webDateStr.split('-')[1]}/${webDateStr.split('-')[2]}`
        : ''
      : `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj
          .getDate()
          .toString()
          .padStart(2, '0')}`;

  const formatTime = (d: Date) => {
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12;
    return `${h.toString().padStart(2, '0')}:${m} ${ampm}`;
  };

  const formattedTime =
    Platform.OS === 'web'
      ? webTimeStr
        ? (function () {
            const [hours, mins] = webTimeStr.split(':');
            let h = parseInt(hours, 10);
            const ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12;
            h = h ? h : 12;
            return `${h.toString().padStart(2, '0')}:${mins} ${ampm}`;
          })()
        : ''
      : formatTime(dateObj);

  const handleSaveSpecificSchedule = async () => {
    if (!selectedBarangay) return;
    setDetailModalFeedback(null);

    const todayDefaultIso = new Date().toLocaleDateString('en-CA');
    const effectiveDateStr =
      Platform.OS === 'web'
        ? (webDateStr || todayDefaultIso)
        : dateObj.toISOString().split('T')[0];

    if (!effectiveDateStr) {
      const msg = 'Please select a valid pickup date.';
      setDetailModalFeedback({ type: 'error', text: msg });
      if (typeof window !== 'undefined' && window.alert) {
        window.alert(msg);
      } else {
        Alert.alert('Date Required', msg);
      }
      return;
    }

    setIsSavingDetail(true);
    try {
      const docRef = doc(db, 'barangay_schedules', selectedBarangay.id);
      const assignedDriverObj = driversList.find((d) => d.id === specificDriverId);
      const resolvedDriverName = specificDriverId
        ? specificDriverName || assignedDriverObj?.displayName || assignedDriverObj?.name || 'Assigned Driver'
        : null;

      const dateParts = effectiveDateStr.split('-');
      const compDate =
        dateParts.length === 3 ? `${dateParts[1]}/${dateParts[2]}` : formattedDate || effectiveDateStr;

      // Duplicate check for specific / special pickup
      const isSpecificDuplicate = (selectedBarangay.specificSchedules || []).some((ss: any) => {
        const matchDate = ss.date === compDate || ss.fullDate === effectiveDateStr;
        const matchCategory = (ss.category || '').toUpperCase() === specificCategory.toUpperCase();
        const matchTime = ss.time === (formattedTime || '06:00 AM');
        return matchDate && matchCategory && matchTime;
      });

      if (isSpecificDuplicate) {
        const msg = `A special pickup on ${compDate} at ${formattedTime || '06:00 AM'} (${specificCategory}) already exists.`;
        setDetailModalFeedback({ type: 'error', text: msg });
        if (typeof window !== 'undefined' && window.alert) window.alert(msg);
        else Alert.alert('Duplicate Pickup', msg);
        setIsSavingDetail(false);
        return;
      }

      const newEntry = {
        date: compDate,
        fullDate: effectiveDateStr,
        time: formattedTime || '06:00 AM',
        category: specificCategory,
        assignedDriverId: specificDriverId || null,
        assignedDriverName: resolvedDriverName,
        assignedDriverEmail: assignedDriverObj?.email || null,
        createdAt: new Date().toISOString(),
      };

      await updateDoc(docRef, {
        specificSchedules: arrayUnion(newEntry),
      });

      setSelectedBarangay({
        ...selectedBarangay,
        specificSchedules: [...(selectedBarangay.specificSchedules || []), newEntry],
      });

      setDetailModalFeedback({
        type: 'success',
        text: `Pickup added for ${compDate} (${resolvedDriverName ? `Driver: ${resolvedDriverName}` : 'Unassigned'})!`,
      });

      const resetDate = new Date();
      resetDate.setHours(6, 0, 0, 0);
      setDateObj(resetDate);
      if (Platform.OS === 'web') {
        setWebTimeStr('06:00');
        setWebDateStr(todayDefaultIso);
      }
      setSpecificCategory('BIODEGRADABLE');
      setSpecificDriverId('');
      setSpecificDriverName('');
      setIsDriverPickerOpen(false);
    } catch (error: any) {
      console.error('Error adding specific schedule:', error);
      const errMsg = error?.message || 'Failed to save specific schedule.';
      setDetailModalFeedback({ type: 'error', text: errMsg });
      if (typeof window !== 'undefined' && window.alert) {
        window.alert(errMsg);
      } else {
        Alert.alert('Error', errMsg);
      }
    } finally {
      setIsSavingDetail(false);
    }
  };

  const handleDeleteSpecificSchedule = async (scheduleIndex: number) => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Deleting collection schedules is restricted in Read-Only Mode.');
      return;
    }
    if (!selectedBarangay || !selectedBarangay.specificSchedules) return;

    const doDeleteSpecific = async () => {
      setIsDeleting(true);
      try {
        const updatedSchedules = [...selectedBarangay.specificSchedules];
        updatedSchedules.splice(scheduleIndex, 1);

        const docRef = doc(db, 'barangay_schedules', selectedBarangay.id);
        await updateDoc(docRef, {
          specificSchedules: updatedSchedules,
        });

        setSelectedBarangay({
          ...selectedBarangay,
          specificSchedules: updatedSchedules,
        });
      } catch (error) {
        console.error('Error deleting specific schedule:', error);
        Alert.alert('Error', 'Could not delete specific schedule.');
      } finally {
        setIsDeleting(false);
      }
    };

    if (Platform.OS === 'web') {
      const confirmed = window.confirm('Are you sure you want to remove this specific pickup?');
      if (confirmed) await doDeleteSpecific();
    } else {
      Alert.alert('Delete Pickup', 'Are you sure you want to remove this specific pickup?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDeleteSpecific },
      ]);
    }
  };

  // Open Export Modal with pre-configured filters
  const openExportModal = () => {
    if (isCoordinator) {
      setExportBarangay(assignedBarangay || 'My Barangay');
    } else {
      setExportBarangay(selectedBarangayFilter !== 'ALL' ? selectedBarangayFilter : 'ALL');
    }
    setExportDays(selectedDayFilter !== 'ALL' ? [selectedDayFilter] : []);
    setExportCategory(selectedCategoryFilter !== 'ALL' ? selectedCategoryFilter : 'ALL');
    setIsExportBarangayDropdownOpen(false);
    setIsExportModalVisible(true);
  };

  // Toggle day filter for export (multi-select)
  const handleToggleExportDay = (day: string) => {
    if (day === 'ALL') {
      setExportDays([]);
      return;
    }

    setExportDays((prev) => {
      if (prev.includes(day)) {
        return prev.filter((d) => d !== day);
      } else {
        const next = [...prev.filter((d) => d !== 'ALL'), day];
        if (next.length >= 7) {
          return [];
        }
        return next;
      }
    });
  };

  const isExportDayActive = (day: string) => {
    if (day === 'ALL') {
      return exportDays.length === 0 || exportDays.includes('ALL');
    }
    return exportDays.includes(day) && !exportDays.includes('ALL');
  };

  // Filtered schedules for export
  const exportMatchingSchedules = useMemo(() => {
    const targetBarangay = isCoordinator ? assignedBarangay : exportBarangay;

    return schedules.filter((s) => {
      // 1. Barangay filter
      if (isCoordinator) {
        if (!assignedBarangay) return false;
        if ((s.barangayName || '').trim().toLowerCase() !== assignedBarangay.trim().toLowerCase()) {
          return false;
        }
      } else {
        if (targetBarangay && targetBarangay !== 'ALL') {
          if ((s.barangayName || '').trim().toLowerCase() !== targetBarangay.trim().toLowerCase()) {
            return false;
          }
        }
      }

      // 2. Day filter (multi-select supported)
      if (exportDays.length > 0 && !exportDays.includes('ALL')) {
        const days = Array.isArray(s.days) ? s.days : [];
        const matchesAnyDay = days.some((d: string) =>
          exportDays.some(
            (selDay) =>
              d.toUpperCase().includes(selDay.toUpperCase()) ||
              selDay.toUpperCase().includes(d.toUpperCase())
          )
        );
        if (!matchesAnyDay) return false;
      }

      // 3. Category filter
      if (exportCategory !== 'ALL' && s.wasteCategory !== exportCategory) {
        return false;
      }

      return true;
    });
  }, [schedules, isCoordinator, assignedBarangay, exportBarangay, exportDays, exportCategory]);

  // Execute Analyst-Grade Export (XLSX with AutoFilter & Executive Summary or Clean CSV)
  const executeExportData = async () => {
    setIsExporting(true);
    try {
      if (exportMatchingSchedules.length === 0) {
        Alert.alert('No Schedules', 'No collection schedules match the selected export filters.');
        setIsExporting(false);
        return;
      }

      const timestampStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const dateStr = new Date().toISOString().slice(0, 10);
      const scopeLabel = isCoordinator
        ? `Brgy. ${assignedBarangay || 'Barangay'} Coordinator`
        : exportBarangay === 'ALL'
        ? 'CENRO Danao City-Wide (All Barangays)'
        : `CENRO Danao (Brgy. ${exportBarangay})`;

      // 1. Prepare analyst-grade tabular dataset
      const analystRows = exportMatchingSchedules.map((s, idx) => {
        const schedId = s.id
          ? `SCH-${s.id.slice(-6).toUpperCase()}`
          : `SCH-${(idx + 1).toString().padStart(4, '0')}`;
        const bName = (s.barangayName || '').trim() || 'Unassigned Barangay';
        const zoneName = (s.zone || '').trim() || 'All Zones / General';
        const streetRoute = (s.streetName || '').trim() || 'Whole Barangay Sector';
        const daysList = Array.isArray(s.days) ? s.days : [];
        const daysPerWeek = daysList.length;
        const primaryTime = s.time || s.timeText || s.collectionTime || '06:00 AM';

        let detailedTimes = primaryTime;
        if (s.dayTimes && typeof s.dayTimes === 'object' && Object.keys(s.dayTimes).length > 0) {
          const times = Object.entries(s.dayTimes)
            .map(([day, time]) => `${day}: ${time}`)
            .join('; ');
          if (times) detailedTimes = times;
        }

        const truckName = (s.truck || '').trim() || 'Unassigned / Rotating Fleet';
        const category = ((s.wasteCategory || 'BIODEGRADABLE') + '').trim().toUpperCase();
        const specificList = Array.isArray(s.specificSchedules) ? s.specificSchedules : [];
        const specificCount = specificList.length;

        let specificLog = 'None scheduled';
        if (specificCount > 0) {
          if (includeSpecificInExport) {
            specificLog = specificList
              .map((sp: any) => `${sp.date || ''} ${sp.time || ''} [${sp.category || 'GENERAL'}]`)
              .join('; ');
          } else {
            specificLog = `${specificCount} special pickup(s) active`;
          }
        }

        return {
          Schedule_ID: schedId,
          Barangay: bName,
          Street_Route_Sector: streetRoute,
          Collection_Days: daysList.join(', ') || 'Unscheduled',
          Days_Per_Week: daysPerWeek,
          Primary_Time: primaryTime,
          Schedule_Breakdown: detailedTimes,
          Assigned_Truck: truckName,
          Waste_Category: category,
          Service_Status: 'ACTIVE',
          Special_Pickups_Count: specificCount,
          Special_Pickups_Log: specificLog,
          Jurisdiction_Scope: scopeLabel,
          Export_Timestamp: timestampStr,
        };
      });

      const fileBaseName = isCoordinator
        ? `Danao_Collection_Schedules_Brgy_${(assignedBarangay || 'Barangay').replace(/\s+/g, '_')}_${dateStr}`
        : exportBarangay === 'ALL'
        ? `Danao_Collection_Schedules_CityWide_${dateStr}`
        : `Danao_Collection_Schedules_Brgy_${exportBarangay.replace(/\s+/g, '_')}_${dateStr}`;

      if (exportFormat === 'pdf') {
        const headers = [
          'Barangay',
          'Street / Sector',
          'Days',
          'Time',
          'Assigned Truck',
          'Waste Stream',
          'Status',
        ];
        const rows = exportMatchingSchedules.map((s) => [
          s.barangayName,
          s.streetName || 'Whole Barangay',
          (s.days || []).join(', '),
          s.time || 'N/A',
          s.truckNumber || 'Unassigned',
          s.wasteCategory || 'General',
          s.status || 'Active',
        ]);

        await exportReport({
          format: 'pdf',
          filename: fileBaseName,
          title: 'Danao City Waste Collection Schedule',
          subtitle: `Official Collection Routes & Schedule Master Directory (${scopeLabel})`,
          jurisdiction:
            isCoordinator && assignedBarangay
              ? `Brgy. ${assignedBarangay}`
              : exportBarangay === 'ALL'
              ? 'City of Danao'
              : `Brgy. ${exportBarangay}`,
          generatedBy: isCoordinator ? 'Barangay Coordinator' : 'CENRO Administration',
          headers,
          rows,
          summaryCards: [
            { label: 'Total Routes', value: exportMatchingSchedules.length },
            {
              label: 'Weekly Runs',
              value: exportMatchingSchedules.reduce((acc, s) => acc + (s.days || []).length, 0),
            },
            {
              label: 'Unique Barangays',
              value: new Set(exportMatchingSchedules.map((s) => s.barangayName)).size,
            },
          ],
          sheetName: 'Schedules',
        });
      } else if (exportFormat === 'xlsx') {
        const filename = `${fileBaseName}.xlsx`;
        const wb = XLSX.utils.book_new();

        // Sheet 1: Collection_Schedules with AutoFilter & Auto-Fit Column Widths
        const wsData = XLSX.utils.json_to_sheet(analystRows);
        const rowCount = analystRows.length + 1;
        // Apply Excel AutoFilter to row 1 across all 15 columns (A1:O{rowCount})
        wsData['!autofilter'] = { ref: `A1:O${rowCount}` };
        // Set generous column widths so text is never truncated or squished
        wsData['!cols'] = [
          { wch: 15 }, // Schedule_ID
          { wch: 18 }, // Barangay
          { wch: 26 }, // Street_Route_Sector
          { wch: 18 }, // Collection_Days
          { wch: 15 }, // Days_Per_Week
          { wch: 15 }, // Primary_Time
          { wch: 32 }, // Schedule_Breakdown
          { wch: 28 }, // Assigned_Truck
          { wch: 22 }, // Waste_Category
          { wch: 15 }, // Service_Status
          { wch: 22 }, // Special_Pickups_Count
          { wch: 36 }, // Special_Pickups_Log
          { wch: 32 }, // Jurisdiction_Scope
          { wch: 20 }, // Export_Timestamp
        ];
        XLSX.utils.book_append_sheet(wb, wsData, 'Collection_Schedules');

        // Sheet 2: Executive_Summary (KPI Dashboard for Management & Analysts)
        const totalWeeklyRuns = exportMatchingSchedules.reduce(
          (acc, s) => acc + (s.days || []).length,
          0
        );
        const uniqueBarangays = new Set(exportMatchingSchedules.map((s) => s.barangayName)).size;
        const totalSpecialPickups = exportMatchingSchedules.reduce(
          (acc, s) => acc + (s.specificSchedules || []).length,
          0
        );

        const summaryRows = [
          {
            'Analytic Indicator': 'REPORT TITLE',
            'Metric Value / Observation':
              'DANAO CITY SOLID WASTE MANAGEMENT - COLLECTION SCHEDULES ANALYSIS',
          },
          {
            'Analytic Indicator': 'Jurisdiction Scope',
            'Metric Value / Observation': isCoordinator
              ? `Barangay ${assignedBarangay}`
              : exportBarangay === 'ALL'
              ? 'City-Wide (All Danao City Barangays)'
              : `Barangay ${exportBarangay}`,
          },
          {
            'Analytic Indicator': 'Day Filter',
            'Metric Value / Observation':
              exportDays.length > 0 && !exportDays.includes('ALL')
                ? exportDays.join(', ')
                : 'All Days',
          },
          {
            'Analytic Indicator': 'Export Authority / Officer',
            'Metric Value / Observation': isCoordinator
              ? 'Barangay Environmental Coordinator'
              : 'CENRO Danao Administrator',
          },
          { 'Analytic Indicator': 'Generation Timestamp', 'Metric Value / Observation': timestampStr },
          { 'Analytic Indicator': '', 'Metric Value / Observation': '' },
          { 'Analytic Indicator': '=== OPERATIONAL FLEET & ROUTE KPIS ===', 'Metric Value / Observation': '' },
          {
            'Analytic Indicator': 'Total Active Route Schedules',
            'Metric Value / Observation': exportMatchingSchedules.length,
          },
          {
            'Analytic Indicator': 'Unique Barangays Represented',
            'Metric Value / Observation': uniqueBarangays,
          },
          {
            'Analytic Indicator': 'Total Weekly Truck Deployments',
            'Metric Value / Observation': totalWeeklyRuns,
          },
          {
            'Analytic Indicator': 'Average Weekly Trips per Route',
            'Metric Value / Observation': (
              totalWeeklyRuns / (exportMatchingSchedules.length || 1)
            ).toFixed(2),
          },
          {
            'Analytic Indicator': 'Active Special / Event Pickups',
            'Metric Value / Observation': totalSpecialPickups,
          },
          { 'Analytic Indicator': '', 'Metric Value / Observation': '' },
          {
            'Analytic Indicator': '=== WASTE STREAM SEGREGATION DISTRIBUTION ===',
            'Metric Value / Observation': '',
          },
          {
            'Analytic Indicator': 'Biodegradable (Organic) Routes',
            'Metric Value / Observation': exportMatchingSchedules.filter(
              (s) =>
                (s.wasteCategory || '').toUpperCase().includes('BIO') &&
                !(s.wasteCategory || '').toUpperCase().includes('NON')
            ).length,
          },
          {
            'Analytic Indicator': 'Non-Biodegradable (Residual) Routes',
            'Metric Value / Observation': exportMatchingSchedules.filter((s) =>
              (s.wasteCategory || '').toUpperCase().includes('NON')
            ).length,
          },
          {
            'Analytic Indicator': 'Recyclable Stream Routes',
            'Metric Value / Observation': exportMatchingSchedules.filter((s) =>
              (s.wasteCategory || '').toUpperCase().includes('RECYCL')
            ).length,
          },
          {
            'Analytic Indicator': 'Special / Hazardous Waste Routes',
            'Metric Value / Observation': exportMatchingSchedules.filter((s) =>
              (s.wasteCategory || '').toUpperCase().includes('SPECIAL')
            ).length,
          },
        ];
        const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
        wsSummary['!cols'] = [{ wch: 44 }, { wch: 44 }];
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Executive_Summary');

        if (Platform.OS === 'web') {
          const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          const blob = new Blob([wbout], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } else {
          Alert.alert(
            'Excel Export Ready',
            `Prepared ${exportMatchingSchedules.length} schedules in ${filename} with AutoFilter and Executive KPI Summary.`
          );
        }
      } else {
        // CSV with UTF-8 BOM for flawless Excel rendering
        const filename = `${fileBaseName}.csv`;
        const headers = Object.keys(analystRows[0]);
        const csvRows = [
          headers.join(','),
          ...analystRows.map((r: any) =>
            headers
              .map((h) => {
                const val = (r[h] ?? '') + '';
                return `"${val.replace(/"/g, '""')}"`;
              })
              .join(',')
          ),
        ];
        const csvContent = '\uFEFF' + csvRows.join('\r\n');

        if (Platform.OS === 'web') {
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } else {
          const headers = Object.keys(analystRows[0] || {});
          const rows = analystRows.map((r: any) => headers.map((h) => r[h]));
          await exportReport({
            format: 'csv',
            filename: fileBaseName,
            title: 'Danao Collection Schedules',
            headers,
            rows,
          });
        }
      }

      setIsExportModalVisible(false);
    } catch (err) {
      console.error('Export Error:', err);
      Alert.alert('Export Failed', 'Unable to generate schedule export.');
    } finally {
      setIsExporting(false);
    }
  };


  return (
    <ScrollView
      style={[styles.container, isMobile && { padding: 14 }]}
      contentContainerStyle={{ paddingBottom: 40 }}
      nestedScrollEnabled
    >
      {/* Header */}
      <View style={[styles.headerRow, isMobile && { flexDirection: 'column', gap: 12 }]}>
        <View>
          <Text style={styles.headerTitle}>Collection Schedules</Text>
          <Text style={styles.headerDesc}>
            Manage waste collection days, assigned trucks, and regular routes across all dynamic barangays.
          </Text>
        </View>
        <View style={[styles.headerActions, isMobile && { width: '100%', flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
          {/* View Mode Switcher: List vs Calendar */}
          <View style={styles.viewModeToggle}>
            <TouchableOpacity
              style={[styles.viewModeBtn, viewMode === 'list' && styles.viewModeBtnActive]}
              onPress={() => setViewMode('list')}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name="format-list-bulleted"
                size={16}
                color={viewMode === 'list' ? '#FFFFFF' : '#4B5563'}
              />
              <Text
                style={[
                  styles.viewModeBtnText,
                  viewMode === 'list' && styles.viewModeBtnTextActive,
                ]}
              >
                List View
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.viewModeBtn, viewMode === 'calendar' && styles.viewModeBtnActive]}
              onPress={() => setViewMode('calendar')}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name="calendar-month"
                size={16}
                color={viewMode === 'calendar' ? '#FFFFFF' : '#4B5563'}
              />
              <Text
                style={[
                  styles.viewModeBtnText,
                  viewMode === 'calendar' && styles.viewModeBtnTextActive,
                ]}
              >
                Calendar View
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.outlineBtn} onPress={openExportModal} activeOpacity={0.8}>
            <MaterialIcons name="file-download" size={18} color="#059669" />
            <Text style={[styles.outlineBtnText, { color: '#059669', fontWeight: '800' }]}>
              {isCoordinator && assignedBarangay ? `Export Brgy. ${assignedBarangay}` : 'Export Schedules'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Render Calendar View or List View */}
      {viewMode === 'calendar' ? (
        <SchedulerCalendarView
          schedules={schedules}
          trucksList={trucksList}
          isCoordinator={isCoordinator}
          assignedBarangay={assignedBarangay}
          onSelectSchedule={(sched) => {
            setDetailModalFeedback(null);
            if (Platform.OS === 'web') {
              setWebDateStr(new Date().toLocaleDateString('en-CA'));
              setWebTimeStr('06:00');
            }
            setSpecificDriverId('');
            setSpecificDriverName('');
            setIsDriverPickerOpen(false);
            setSelectedBarangay(sched);
            setDetailsModalVisible(true);
          }}
          onEditSchedule={isReadOnly ? undefined : (sched) => {
            handleOpenEditModal(sched);
          }}
          onAddScheduleForDate={isReadOnly ? undefined : (_dateStr, dayOfWeekAbbr) => {
            handleOpenAddModal(isCoordinator && assignedBarangay ? assignedBarangay : undefined);
            if (dayOfWeekAbbr) {
              setSelectedDays([dayOfWeekAbbr]);
            }
          }}
        />
      ) : (
        <>
          {/* Interactive Controls & Filters Bar */}
      <View style={[styles.controlsBar, isNarrow && { flexDirection: 'column', alignItems: 'stretch', gap: 14 }]}>
        <View style={[styles.filtersRow, isNarrow && { flexWrap: 'wrap', width: '100%', gap: 10 }]}>
          {/* Free-text Search */}
          <View style={[styles.searchBox, isMobile && { width: '100%' }]}>
            <MaterialIcons name="search" size={18} color="#94A3B8" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search barangay, route, truck..."
              placeholderTextColor="#94A3B8"
              value={searchQuery}
              onChangeText={(t) => {
                setSearchQuery(t);
                setCurrentPage(1);
              }}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <MaterialIcons name="close" size={16} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Barangay Filter Dropdown */}
          <View style={[styles.filterDropdownWrapper, isMobile && { flex: 1, minWidth: '48%' }]}>
            {isCoordinator && assignedBarangay ? (
              <View
                style={[
                  styles.filterDropdownBtn,
                  styles.filterDropdownBtnActive,
                  { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
                ]}
              >
                <MaterialIcons name="lock" size={16} color="#059669" />
                <Text
                  style={[
                    styles.filterDropdownBtnText,
                    { color: '#059669', fontWeight: '800' },
                  ]}
                  numberOfLines={1}
                >
                  Brgy. {assignedBarangay} (Locked)
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  styles.filterDropdownBtn,
                  selectedBarangayFilter !== 'ALL' && styles.filterDropdownBtnActive,
                ]}
                onPress={() => {
                  setIsBarangayFilterOpen(!isBarangayFilterOpen);
                  setIsDayFilterOpen(false);
                  setIsSortFilterOpen(false);

                  setIsCategoryFilterOpen(false);
                }}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name="location-on"
                  size={16}
                  color={selectedBarangayFilter !== 'ALL' ? '#059669' : '#64748B'}
                />
                <Text
                  style={[
                    styles.filterDropdownBtnText,
                    selectedBarangayFilter !== 'ALL' && { color: '#059669', fontWeight: '800' },
                  ]}
                  numberOfLines={1}
                >
                  {selectedBarangayFilter === 'ALL'
                    ? 'All Barangays'
                    : `Brgy. ${selectedBarangayFilter}`}
                </Text>
                <MaterialIcons
                  name={isBarangayFilterOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={18}
                  color="#64748B"
                />
              </TouchableOpacity>
            )}

            {isBarangayFilterOpen && (
              <View style={styles.dropdownPopup}>
                <View style={styles.dropdownSearchHeader}>
                  <MaterialIcons name="search" size={14} color="#94A3B8" />
                  <TextInput
                    style={styles.dropdownSearchInput}
                    placeholder="Filter barangays..."
                    placeholderTextColor="#94A3B8"
                    value={barangaySearchFilterText}
                    onChangeText={setBarangaySearchFilterText}
                  />
                  {barangaySearchFilterText.length > 0 && (
                    <TouchableOpacity onPress={() => setBarangaySearchFilterText('')}>
                      <MaterialIcons name="close" size={14} color="#94A3B8" />
                    </TouchableOpacity>
                  )}
                </View>
                <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                  <TouchableOpacity
                    style={[
                      styles.dropdownPopupItem,
                      selectedBarangayFilter === 'ALL' && styles.dropdownPopupItemSelected,
                    ]}
                    onPress={() => {
                      setSelectedBarangayFilter('ALL');
                      setIsBarangayFilterOpen(false);
                setIsSortFilterOpen(false);
                      setCurrentPage(1);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownPopupItemText,
                        selectedBarangayFilter === 'ALL' && { color: '#059669', fontWeight: '800' },
                      ]}
                    >
                      All Barangays ({dynamicBarangays.length})
                    </Text>
                  </TouchableOpacity>

                  {filteredBarangayDropdownList.map((b) => (
                    <TouchableOpacity
                      key={b}
                      style={[
                        styles.dropdownPopupItem,
                        selectedBarangayFilter === b && styles.dropdownPopupItemSelected,
                      ]}
                      onPress={() => {
                        setSelectedBarangayFilter(b);
                        setIsBarangayFilterOpen(false);
                setIsSortFilterOpen(false);
                        setCurrentPage(1);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownPopupItemText,
                          selectedBarangayFilter === b && { color: '#059669', fontWeight: '800' },
                        ]}
                      >
                        {b}
                      </Text>
                      {selectedBarangayFilter === b && (
                        <MaterialIcons name="check" size={16} color="#059669" />
                      )}
                    </TouchableOpacity>
                  ))}

                  {filteredBarangayDropdownList.length === 0 && (
                    <View style={{ padding: 12, alignItems: 'center' }}>
                      <Text style={{ fontSize: 12, color: '#94A3B8' }}>No barangays found</Text>
                    </View>
                  )}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Day of Week Filter Dropdown */}
          <View style={[styles.filterDropdownWrapper, isMobile && { flex: 1, minWidth: '48%' }]}>
            <TouchableOpacity
              style={[
                styles.filterDropdownBtn,
                selectedDayFilter !== 'ALL' && styles.filterDropdownBtnActive,
              ]}
              onPress={() => {
                setIsDayFilterOpen(!isDayFilterOpen);
                setIsBarangayFilterOpen(false);
                setIsSortFilterOpen(false);

                setIsCategoryFilterOpen(false);
              }}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name="event"
                size={16}
                color={selectedDayFilter !== 'ALL' ? '#059669' : '#64748B'}
              />
              <Text
                style={[
                  styles.filterDropdownBtnText,
                  selectedDayFilter !== 'ALL' && { color: '#059669', fontWeight: '800' },
                ]}
                numberOfLines={1}
              >
                {selectedDayFilter === 'ALL' ? 'Any Day' : selectedDayFilter}
              </Text>
              <MaterialIcons
                name={isDayFilterOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                size={18}
                color="#64748B"
              />
            </TouchableOpacity>

            {isDayFilterOpen && (
              <View style={styles.dropdownPopup}>
                <TouchableOpacity
                  style={[
                    styles.dropdownPopupItem,
                    selectedDayFilter === 'ALL' && styles.dropdownPopupItemSelected,
                  ]}
                  onPress={() => {
                    setSelectedDayFilter('ALL');
                    setIsDayFilterOpen(false);
                  setIsSortFilterOpen(false);
                    setCurrentPage(1);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownPopupItemText,
                      selectedDayFilter === 'ALL' && { color: '#059669', fontWeight: '800' },
                    ]}
                  >
                    Any Day of the Week
                  </Text>
                </TouchableOpacity>
                {DAYS_OF_WEEK.map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[
                      styles.dropdownPopupItem,
                      selectedDayFilter === d && styles.dropdownPopupItemSelected,
                    ]}
                    onPress={() => {
                      setSelectedDayFilter(d);
                      setIsDayFilterOpen(false);
                  setIsSortFilterOpen(false);
                      setCurrentPage(1);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownPopupItemText,
                        selectedDayFilter === d && { color: '#059669', fontWeight: '800' },
                      ]}
                    >
                      {d}
                    </Text>
                    {selectedDayFilter === d && (
                      <MaterialIcons name="check" size={16} color="#059669" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Sort Dropdown (Visible for CENRO admin) */}
          {!isCoordinator && (
            <View style={[styles.filterDropdownWrapper, isMobile && { flex: 1, minWidth: '48%' }]}>
              <TouchableOpacity
                style={styles.filterDropdownBtn}
                onPress={() => {
                  setIsSortFilterOpen(!isSortFilterOpen);
                  setIsBarangayFilterOpen(false);
                  setIsDayFilterOpen(false);
                  setIsCategoryFilterOpen(false);
                }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="sort" size={16} color="#64748B" />
                <Text style={styles.filterDropdownBtnText} numberOfLines={1}>
                  {SORT_OPTIONS.find((s) => s.id === sortBy)?.label || 'Sort'}
                </Text>
                <MaterialIcons
                  name={isSortFilterOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={18}
                  color="#64748B"
                />
              </TouchableOpacity>

              {isSortFilterOpen && (
                <View style={styles.dropdownPopup}>
                  {SORT_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.id}
                      style={[
                        styles.dropdownPopupItem,
                        sortBy === opt.id && styles.dropdownPopupItemSelected,
                      ]}
                      onPress={() => {
                        setSortBy(opt.id);
                        setIsSortFilterOpen(false);
                        setCurrentPage(1);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownPopupItemText,
                          sortBy === opt.id && { color: '#059669', fontWeight: '800' },
                        ]}
                      >
                        {opt.label}
                      </Text>
                      {sortBy === opt.id && (
                        <MaterialIcons name="check" size={16} color="#059669" />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>

        {/* Action Button: Add New Barangay / Route */}
        <View style={styles.buttonsRow}>
          {isReadOnly ? (
            <View style={styles.readOnlyHeaderBadge}>
              <MaterialIcons name="visibility" size={16} color="#92400E" />
              <Text style={styles.readOnlyHeaderBadgeText}>Read-Only Mode</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, isMobile && { width: '100%', justifyContent: 'center' }]}
              onPress={() => handleOpenAddModal(isCoordinator && assignedBarangay ? assignedBarangay : undefined)}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>
                {isCoordinator && assignedBarangay ? `Add Route for Brgy. ${assignedBarangay}` : 'Add Collection Route'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Main Table Card */}
      <View style={[styles.card, isMobile && { padding: 12 }]}>
        <ScrollView
          horizontal={isMobile}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, minWidth: '100%' }}
          style={{ width: '100%' }}
        >
          <View style={{ minWidth: isMobile ? 700 : '100%', width: '100%' }}>
            {/* Table Header */}
            <View style={styles.tableHead}>
              <Text style={[styles.th, { flex: 2.5 }]}>BARANGAY NAME</Text>
              <Text style={[styles.th, { flex: 3.5 }]}>RECURRING COLLECTION SCHEDULE</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right', paddingRight: 24 }]}>ACTIONS</Text>
            </View>

            {loading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#059669" />
                <Text style={{ color: '#64748B', fontSize: 13, marginTop: 12 }}>
                  Loading collection schedules...
                </Text>
              </View>
            ) : sortedBarangayKeys.length === 0 ? (
              <View style={{ padding: 48, alignItems: 'center' }}>
                <MaterialIcons name="event-busy" size={48} color="#CBD5E1" />
                <Text style={{ color: '#0F172A', fontWeight: '700', fontSize: 16, marginTop: 12 }}>
                  No barangay schedules found
                </Text>
                <Text style={{ color: '#64748B', fontSize: 13, marginTop: 4, textAlign: 'center' }}>
                  {schedules.length === 0
                    ? "Click '+ Add Collection Route' above to register your first collection route."
                    : 'No schedules match the active filters or search term.'}
                </Text>
                {selectedBarangayFilter !== 'ALL' || selectedDayFilter !== 'ALL' || searchQuery ? (
                  <TouchableOpacity
                    style={styles.clearFiltersBtn}
                    onPress={() => {
                      setSelectedBarangayFilter('ALL');
                      setSelectedDayFilter('ALL');
                      setSelectedCategoryFilter('ALL');
                      setSearchQuery('');
                    }}
                  >
                    <Text style={styles.clearFiltersBtnText}>Reset All Filters</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              paginatedBarangayKeys.map((bName) => {
                const streetsInBarangay = filteredGroups[bName] || {};
                const streetCount = Object.keys(streetsInBarangay).length;
                const allSchedsInBarangay = Object.values(streetsInBarangay).flat();
                const isExpanded = expandedBarangay === bName;

                return (
                  <View key={bName} style={styles.accordionContainer}>
                    {/* Barangay Header Row */}
                    <TouchableOpacity
                      style={[styles.tableRow, isExpanded && styles.tableRowActive]}
                      onPress={() => setExpandedBarangay(isExpanded ? null : bName)}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.td,
                          {
                            flex: 2.5,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 12,
                          },
                        ]}
                      >
                        <View style={styles.avatarBadge}>
                          <Text style={styles.avatarText}>
                            {(bName || 'BR').substring(0, 2).toUpperCase()}
                          </Text>
                        </View>
                        <View>
                          <Text style={styles.brgyName}>{bName}</Text>
                          <Text style={styles.brgyDesc}>
                            {streetCount} {streetCount === 1 ? 'Route / Sector' : 'Routes / Sectors'}
                          </Text>
                        </View>
                      </View>

                      {/* Quick Days summary preview */}
                      <View
                        style={[
                          styles.td,
                          {
                            flex: 3.5,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            flexWrap: 'wrap',
                          },
                        ]}
                      >
                        {sortDaysInOrder(
                          Array.from(
                            new Set(allSchedsInBarangay.flatMap((s) => s.days || []))
                          )
                        )
                          .slice(0, 5)
                          .map((d, dIdx) => {
                            const isFinished = isBarangayDayFinished(bName, d, allSchedsInBarangay);
                            return (
                              <View key={dIdx} style={[styles.dayBadge, isFinished && styles.dayBadgeFinished]}>
                                {isFinished && <MaterialIcons name="check" size={11} color="#15803D" style={{ marginRight: 2 }} />}
                                <Text style={[styles.dayText, isFinished && styles.dayTextFinished]}>{d}</Text>
                              </View>
                            );
                          })}
                        {(() => {
                          const isDoneThisWeek = isBarangayCompletedThisWeek(bName, allSchedsInBarangay);
                          if (isDoneThisWeek) {
                            return (
                              <View style={[styles.activeStatusBadge, { backgroundColor: '#DCFCE7', borderColor: '#86EFAC', borderWidth: 1 }]}>
                                <MaterialIcons name="check-circle" size={13} color="#166534" />
                                <Text style={[styles.activeStatusText, { color: '#166534', fontWeight: '800' }]}>Completed</Text>
                              </View>
                            );
                          }
                          return (
                            <View style={styles.activeStatusBadge}>
                              <View style={styles.activeStatusDot} />
                              <Text style={styles.activeStatusText}>Active Route</Text>
                            </View>
                          );
                        })()}
                      </View>

                      {/* Expand / Collapse Icon */}
                      <View style={[styles.td, { flex: 1.5, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingRight: 16 }]}>
                        <MaterialIcons
                          name={isExpanded ? 'expand-less' : 'expand-more'}
                          size={24}
                          color="#64748B"
                        />
                      </View>
                    </TouchableOpacity>

                    {/* Accordion Body: List of Routes/Streets in this Barangay */}
                    {isExpanded && (
                      <View style={styles.accordionBody}>
                        {Object.keys(streetsInBarangay).map((streetNameKey) => {
                          const routeSchedules = streetsInBarangay[streetNameKey] || [];
                          const fullStreetId = `${bName}-${streetNameKey}`;
                          const isStreetExpanded =
                            expandedStreet === fullStreetId || Object.keys(streetsInBarangay).length === 1;

                          return (
                            <View key={streetNameKey} style={styles.streetContainer}>
                              {/* Route / Sector Header */}
                              <TouchableOpacity
                                style={styles.streetRow}
                                onPress={() => {
                                  setExpandedStreet(
                                    expandedStreet === fullStreetId ? null : fullStreetId
                                  );
                                }}
                                activeOpacity={0.8}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <MaterialIcons name="route" size={18} color="#059669" />
                                  <Text style={styles.streetNameText}>{streetNameKey}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                  <Text style={styles.streetDescText}>
                                    {routeSchedules.length}{' '}
                                    {routeSchedules.length === 1 ? 'Schedule' : 'Schedules'}
                                  </Text>
                                  <MaterialIcons
                                    name={isStreetExpanded ? 'expand-less' : 'expand-more'}
                                    size={20}
                                    color="#64748B"
                                  />
                                </View>
                              </TouchableOpacity>

                              {/* Schedules List for this route */}
                              {isStreetExpanded && (
                                <View style={styles.schedulesBody}>
                                  {routeSchedules.map((row) => (
                                    <View key={row.id} style={styles.scheduleItemRow}>
                                      {/* Days & Time Column */}
                                      <View
                                        style={{
                                          flex: 1,
                                          flexDirection: 'column',
                                          gap: 6,
                                        }}
                                      >
                                        <View
                                          style={{
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            gap: 6,
                                            flexWrap: 'wrap',
                                          }}
                                        >
                                          {(() => {
                                            const days: string[] = sortDaysInOrder(row.days || []);
                                            const dTimes: Record<string, string> = row.dayTimes || {};
                                            const defaultTime = row.time || row.timeText || row.collectionTime || '06:00 AM';
                                            const uniqueTimes = new Set(days.map((d: string) => dTimes[d] || defaultTime));
                                            const hasDifferentTimes = uniqueTimes.size > 1;

                                            if (hasDifferentTimes) {
                                              return days.map((day: string, dIdx: number) => {
                                                const isFinished = isBarangayDayFinished(bName, day, [row]);
                                                return (
                                                  <View
                                                    key={`d-${dIdx}`}
                                                    style={[
                                                      styles.dayBadge,
                                                      isFinished
                                                        ? styles.dayBadgeFinished
                                                        : {
                                                            backgroundColor: '#F0FDF4',
                                                            borderColor: '#BBF7D0',
                                                            borderWidth: 1,
                                                            flexDirection: 'row',
                                                            alignItems: 'center',
                                                            gap: 3,
                                                          },
                                                    ]}
                                                  >
                                                    {isFinished && <MaterialIcons name="check" size={11} color="#15803D" style={{ marginRight: 2 }} />}
                                                    <Text style={[styles.dayText, isFinished ? styles.dayTextFinished : { color: '#047857', fontWeight: '800' }]}>{day}</Text>
                                                    <MaterialIcons name="access-time" size={10} color={isFinished ? '#15803D' : '#166534'} />
                                                    <Text style={[styles.dayText, isFinished ? styles.dayTextFinished : { color: '#166534', fontWeight: '700' }]}>
                                                      {dTimes[day] || defaultTime}
                                                    </Text>
                                                  </View>
                                                );
                                              });
                                            }

                                            return (
                                              <>
                                                {days.map((day: string, dIdx: number) => {
                                                  const isFinished = isBarangayDayFinished(bName, day, [row]);
                                                  return (
                                                    <View key={`d-${dIdx}`} style={[styles.dayBadge, isFinished && styles.dayBadgeFinished]}>
                                                      {isFinished && <MaterialIcons name="check" size={11} color="#15803D" style={{ marginRight: 2 }} />}
                                                      <Text style={[styles.dayText, isFinished && styles.dayTextFinished]}>{day}</Text>
                                                    </View>
                                                  );
                                                })}
                                                <View
                                                  style={[
                                                    styles.dayBadge,
                                                    {
                                                      backgroundColor: '#F0FDF4',
                                                      borderColor: '#BBF7D0',
                                                      borderWidth: 1,
                                                      flexDirection: 'row',
                                                      alignItems: 'center',
                                                      gap: 3,
                                                    },
                                                  ]}
                                                >
                                                  <MaterialIcons name="access-time" size={11} color="#166534" />
                                                  <Text style={[styles.dayText, { color: '#166534', fontWeight: '800' }]}>
                                                    {defaultTime}
                                                  </Text>
                                                </View>
                                              </>
                                            );
                                          })()}
                                        </View>

                                        {/* Assigned Driver Badge */}
                                        {(() => {
                                          const validDriver = getValidDriverName(row.assignedDriverId, row.assignedDriverName, row.barangayName || row.barangay);
                                          if (!validDriver) return null;
                                          return (
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                              <View
                                                style={{
                                                  flexDirection: 'row',
                                                  alignItems: 'center',
                                                  gap: 4,
                                                  backgroundColor: '#EFF6FF',
                                                  borderColor: '#BFDBFE',
                                                  borderWidth: 1,
                                                  paddingHorizontal: 7,
                                                  paddingVertical: 2,
                                                  borderRadius: 4,
                                                }}
                                              >
                                                <MaterialIcons name="person" size={12} color="#1E40AF" />
                                                <Text style={{ fontSize: 11, fontWeight: '700', color: '#1E40AF' }}>
                                                  Driver: {validDriver}
                                                </Text>
                                              </View>
                                            </View>
                                          );
                                        })()}

                                        {/* Specific Pickups */}
                                        {(row.specificSchedules || []).length > 0 && (
                                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                                            {(row.specificSchedules || []).map((ss: any, idx: number) => (
                                              <View
                                                key={`ss-${idx}`}
                                                style={[
                                                  styles.dayBadge,
                                                  {
                                                    backgroundColor: '#EEF2FF',
                                                    borderColor: '#C7D2FE',
                                                    borderWidth: 1,
                                                  },
                                                ]}
                                              >
                                                <Text style={[styles.dayText, { color: '#4338CA', fontWeight: '700' }]}>
                                                  {ss.date} {ss.time}
                                                </Text>
                                              </View>
                                            ))}
                                          </View>
                                        )}
                                      </View>

                                      {/* Action Buttons */}
                                      <View
                                        style={{
                                          flexDirection: 'row',
                                          alignItems: 'center',
                                          gap: 8,
                                        }}
                                      >
                                        {/* Specific / Special Pickups */}
                                        <TouchableOpacity
                                          onPress={() => {
                                            setDetailModalFeedback(null);
                                            if (Platform.OS === 'web') {
                                              setWebDateStr(new Date().toLocaleDateString('en-CA'));
                                              setWebTimeStr('06:00');
                                            }
                                            setSpecificDriverId('');
                                            setSpecificDriverName('');
                                            setIsDriverPickerOpen(false);
                                            setSelectedBarangay(row);
                                            setDetailsModalVisible(true);
                                          }}
                                          style={styles.actionIconBtn}
                                          accessibilityLabel="Special or one-time pickup dates"
                                          accessibilityHint="Opens special and holiday pickup dates manager"
                                          activeOpacity={0.7}
                                        >
                                          <MaterialIcons
                                            name="calendar-today"
                                            size={16}
                                            color="#059669"
                                          />
                                        </TouchableOpacity>

                                        {/* Edit Schedule */}
                                        {!isReadOnly && (
                                          <TouchableOpacity
                                            onPress={() => handleOpenEditModal(row)}
                                            style={styles.actionIconBtn}
                                            activeOpacity={0.7}
                                          >
                                            <MaterialIcons name="edit" size={16} color="#475569" />
                                          </TouchableOpacity>
                                        )}

                                        {/* Delete Schedule */}
                                        {!isReadOnly && (
                                          <TouchableOpacity
                                            onPress={() => handleDeleteSchedule(row.id)}
                                            style={[styles.actionIconBtn, styles.actionIconBtnDanger]}
                                            activeOpacity={0.7}
                                          >
                                            <MaterialIcons
                                              name="delete-outline"
                                              size={16}
                                              color="#EF4444"
                                            />
                                          </TouchableOpacity>
                                        )}
                                      </View>
                                    </View>
                                  ))}
                                </View>
                              )}
                            </View>
                          );
                        })}

                        {/* Button to add another route/sector to this specific Barangay */}
                        {!isReadOnly && (
                          <TouchableOpacity
                            style={styles.addStreetBtn}
                            onPress={() => handleOpenAddModal(bName)}
                            activeOpacity={0.7}
                          >
                            <MaterialIcons name="add-circle-outline" size={18} color="#059669" />
                            <Text style={styles.addStreetBtnText}>
                              Add Route / Sector to {bName}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>

        {/* Pagination Footer */}
        {sortedBarangayKeys.length > 0 && (
          <View style={styles.pagination}>
            <Text style={styles.pageInfo}>
              Showing {sortedBarangayKeys.length} {sortedBarangayKeys.length === 1 ? 'Barangay' : 'Barangays'} •{' '}
              {totalFilteredSchedules} {totalFilteredSchedules === 1 ? 'Schedule' : 'Schedules'} Total
            </Text>
            {totalPages > 1 && (
              <View style={styles.pageControls}>
                <TouchableOpacity
                  style={[styles.pageBtn, currentPage === 1 && styles.pageBtnDisabled]}
                  onPress={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <MaterialIcons
                    name="chevron-left"
                    size={20}
                    color={currentPage === 1 ? '#CBD5E1' : '#1E293B'}
                  />
                </TouchableOpacity>
                <Text style={styles.pageNum}>
                  Page {currentPage} of {totalPages}
                </Text>
                <TouchableOpacity
                  style={[styles.pageBtn, currentPage === totalPages && styles.pageBtnDisabled]}
                  onPress={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  <MaterialIcons
                    name="chevron-right"
                    size={20}
                    color={currentPage === totalPages ? '#CBD5E1' : '#1E293B'}
                  />
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>
        </>
      )}

      {/* ========================================================================= */}
      {/* ADD / EDIT BARANGAY SCHEDULE MODAL                                       */}
      {/* ========================================================================= */}
      <Modal
        visible={isModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          const savedBarangay = barangayName.trim();
      const savedStreet = streetName.trim();
      const schedAction = editingScheduleId ? 'Updated' : 'Created';

      setModalVisible(false);
          setEditingScheduleId(null);
          setEditingOriginalSchedule(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isMobile && { width: '95%', padding: 18 }]}>
            {/* Modal Header */}
            <View style={styles.modalHeaderRow}>
              <View>
                <Text style={styles.modalTitle}>
                  {editingScheduleId
                    ? 'Edit Collection Route'
                    : isCoordinator
                    ? `Add Route Schedule · Brgy. ${assignedBarangay || 'Baliang'}`
                    : isAlreadyRegistered
                    ? `Add Route Schedule · Brgy. ${barangayName.trim()}`
                    : 'Add Collection Route'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {isCoordinator
                    ? 'Configure collection schedule, pickup hours, and fleet assignment for your barangay.'
                    : 'Configure collection schedule, route sector, pickup hours, and assigned fleet.'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setModalVisible(false);
                  setEditingScheduleId(null);
                  setEditingOriginalSchedule(null);
                }}
                style={styles.modalCloseBtn}
                activeOpacity={0.7}
              >

                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ maxHeight: isMobile ? Math.min(height - 160, 540) : Math.min(height - 160, 720), paddingRight: 4 }}
              contentContainerStyle={{ paddingVertical: 6, paddingRight: 2 }}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
            >
              {/* SECTION 1: Barangay & Route Identification */}
              <View style={styles.modalSectionCard}>
                <View style={styles.modalSectionHeader}>
                  <View style={styles.modalSectionBadge}>
                    <MaterialIcons name="location-city" size={16} color="#059669" />
                  </View>
                  <Text style={styles.modalSectionTitle}>1. Route & Barangay Assignment</Text>
                </View>

                {/* 2-Column Responsive Form Row */}
                <View style={[styles.formGrid, isMobile && { flexDirection: 'column', gap: 12 }, { alignItems: 'flex-start' }]}>
                  {/* Left Column: Barangay Name */}
                  <View style={{ flex: 1, width: isMobile ? '100%' : undefined }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={[styles.inputLabel, { marginBottom: 0 }]}>
                        BARANGAY NAME <Text style={styles.requiredAsterisk}>*</Text>
                      </Text>
                      {!isCoordinator && (
                        <TouchableOpacity
                          onPress={() => setBarangaySuggestionsOpen(!barangaySuggestionsOpen)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#059669' }}>
                            {barangaySuggestionsOpen ? 'Hide List' : 'Browse Danao (42)'}
                          </Text>
                          <MaterialIcons
                            name={barangaySuggestionsOpen ? 'expand-less' : 'expand-more'}
                            size={16}
                            color="#059669"
                          />
                        </TouchableOpacity>
                      )}
                    </View>

                    {isCoordinator && assignedBarangay ? (
                      <View
                        style={[
                          styles.textInput,
                          {
                            backgroundColor: '#F0FDF4',
                            borderColor: '#86EFAC',
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            height: 44,
                            paddingHorizontal: 12,
                          },
                        ]}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <MaterialIcons name="lock" size={16} color="#059669" />
                          <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#065F46' }}>
                            Brgy. {assignedBarangay}
                          </Text>
                        </View>
                        <View style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 4 }}>
                          <Text style={{ fontSize: 10, fontWeight: '800', color: '#166534' }}>YOUR BARANGAY</Text>
                        </View>
                      </View>
                    ) : (
                      <>
                        <View
                          style={[
                            styles.textInput,
                            {
                              flexDirection: 'row',
                              alignItems: 'center',
                              paddingHorizontal: 10,
                              paddingVertical: 0,
                              height: 44,
                            },
                            formErrors.barangayName ? styles.inputErrorBorder : null,
                          ]}
                        >
                          <MaterialIcons name="location-city" size={18} color="#059669" style={{ marginRight: 8 }} />
                          <TextInput
                            style={{ flex: 1, fontSize: 13.5, color: '#1E293B', height: '100%' }}
                            placeholder="Type or select barangay..."
                            placeholderTextColor="#94A3B8"
                            value={barangayName}
                            onFocus={() => setBarangaySuggestionsOpen(true)}
                            onChangeText={(t) => {
                              setBarangayName(t);
                              setBarangaySuggestionsOpen(true);
                              if (formErrors.barangayName) {
                                setFormErrors((prev) => {
                                  const next = { ...prev };
                                  delete next.barangayName;
                                  return next;
                                });
                              }
                            }}
                          />
                          {barangayName.length > 0 && (
                            <TouchableOpacity
                              onPress={() => {
                                setBarangayName('');
                                setBarangaySuggestionsOpen(true);
                              }}
                              style={{ padding: 4 }}
                            >
                              <MaterialIcons name="cancel" size={16} color="#94A3B8" />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            onPress={() => setBarangaySuggestionsOpen(!barangaySuggestionsOpen)}
                            style={{ padding: 4, marginLeft: 2 }}
                          >
                            <MaterialIcons
                              name={barangaySuggestionsOpen ? 'arrow-drop-up' : 'arrow-drop-down'}
                              size={22}
                              color="#64748B"
                            />
                          </TouchableOpacity>
                        </View>

                        {formErrors.barangayName ? (
                          <Text style={styles.fieldError}>{formErrors.barangayName}</Text>
                        ) : null}

                        {/* Quick Chips when suggestions are closed */}
                        {!barangaySuggestionsOpen && availableUnregisteredDanaoBarangays.length > 0 && (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                            <Text style={{ fontSize: 11, color: '#64748B', fontWeight: '600', alignSelf: 'center', marginRight: 2 }}>
                              Quick pick:
                            </Text>
                            {availableUnregisteredDanaoBarangays.slice(0, 4).map((b) => (
                              <TouchableOpacity
                                key={b}
                                onPress={() => {
                                  setBarangayName(b);
                                  if (formErrors.barangayName) {
                                    setFormErrors((prev) => {
                                      const next = { ...prev };
                                      delete next.barangayName;
                                      return next;
                                    });
                                  }
                                }}
                                style={{
                                  backgroundColor: '#F0FDF4',
                                  borderWidth: 1,
                                  borderColor: '#BBF7D0',
                                  paddingHorizontal: 8,
                                  paddingVertical: 3,
                                  borderRadius: 12,
                                }}
                              >
                                <Text style={{ fontSize: 11, fontWeight: '700', color: '#166534' }}>
                                  + {b}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}

                        {/* IntelliSense Dropdown Container */}
                        {barangaySuggestionsOpen && (
                          <View style={styles.suggestionsContainer}>
                            <View style={styles.suggestionsHeader}>
                              <Text style={styles.suggestionsLabel}>
                                {barangayName.trim()
                                  ? `Results for "${barangayName.trim()}" (${matchingDanaoBarangays.length})`
                                  : `All Danao City Barangays (${DANAO_CITY_BARANGAYS.length})`}
                              </Text>
                              <TouchableOpacity
                                onPress={() => setBarangaySuggestionsOpen(false)}
                                style={{ padding: 2 }}
                              >
                                <MaterialIcons name="close" size={16} color="#64748B" />
                              </TouchableOpacity>
                            </View>

                            <ScrollView
                              style={{ maxHeight: 200 }}
                              nestedScrollEnabled={true}
                              keyboardShouldPersistTaps="handled"
                              showsVerticalScrollIndicator={true}
                            >
                              {/* Option to create / use custom barangay if not an exact match */}
                              {barangayName.trim().length > 0 && !isExactDanaoMatch && (
                                <TouchableOpacity
                                  style={styles.customBarangayItem}
                                  onPress={() => {
                                    setBarangaySuggestionsOpen(false);
                                    if (formErrors.barangayName) {
                                      setFormErrors((prev) => {
                                        const next = { ...prev };
                                        delete next.barangayName;
                                        return next;
                                      });
                                    }
                                  }}
                                >
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                                    <MaterialIcons name="add-circle" size={18} color="#7C3AED" />
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#6D28D9' }}>
                                        Use Custom: &quot;{barangayName.trim()}&quot;
                                      </Text>
                                      <Text style={{ fontSize: 10, color: '#7C3AED' }}>
                                        Not in preset Danao list — click to create custom route
                                      </Text>
                                    </View>
                                  </View>
                                  <View style={{ backgroundColor: '#EDE9FE', paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 4 }}>
                                    <Text style={{ fontSize: 10, fontWeight: '800', color: '#6D28D9' }}>CUSTOM</Text>
                                  </View>
                                </TouchableOpacity>
                              )}

                              {matchingDanaoBarangays.map((b) => {
                                const isUnassigned = availableUnregisteredDanaoBarangays.includes(b);
                                const isSelected = barangayName.trim().toLowerCase() === b.toLowerCase();
                                return (
                                  <TouchableOpacity
                                    key={b}
                                    style={[
                                      styles.suggestionItem,
                                      isSelected ? styles.suggestionItemSelected : null,
                                    ]}
                                    onPress={() => {
                                      setBarangayName(b);
                                      setBarangaySuggestionsOpen(false);
                                      if (formErrors.barangayName) {
                                        setFormErrors((prev) => {
                                          const next = { ...prev };
                                          delete next.barangayName;
                                          return next;
                                        });
                                      }
                                    }}
                                  >
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                      <MaterialIcons
                                        name={isSelected ? 'check-circle' : isUnassigned ? 'add-location' : 'location-on'}
                                        size={16}
                                        color={isSelected ? '#059669' : isUnassigned ? '#059669' : '#64748B'}
                                      />
                                      <Text
                                        style={[
                                          styles.suggestionItemText,
                                          isSelected ? { color: '#065F46', fontWeight: '800' } : null,
                                        ]}
                                      >
                                        {b}
                                      </Text>
                                    </View>

                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                      {isUnassigned ? (
                                        <View style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                          <Text style={{ fontSize: 9.5, fontWeight: '800', color: '#166534' }}>NEW ROUTE</Text>
                                        </View>
                                      ) : (
                                        <View style={{ backgroundColor: '#F1F5F9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                          <Text style={{ fontSize: 9.5, fontWeight: '700', color: '#64748B' }}>EXISTS</Text>
                                        </View>
                                      )}
                                    </View>
                                  </TouchableOpacity>
                                );
                              })}

                              {matchingDanaoBarangays.length === 0 && (
                                <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                                  <Text style={{ fontSize: 12, color: '#64748B' }}>
                                    No predefined Danao City barangays matched.
                                  </Text>
                                </View>
                              )}
                            </ScrollView>
                          </View>
                        )}
                      </>
                    )}
                  </View>

                  {/* Right Column: Street / Route Sector */}
                  <View style={{ flex: 1.2, width: isMobile ? '100%' : undefined }}>
                    <Text style={styles.inputLabel}>
                      STREET / ROUTE SECTOR <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                    <TextInput
                      style={[
                        styles.textInput,
                        { height: 44 },
                        formErrors.streetName && styles.inputErrorBorder,
                      ]}
                      placeholder="e.g. Rizal St., Purok 2, or Whole Barangay"
                      placeholderTextColor="#94A3B8"
                      value={streetName}
                      onFocus={() => setStreetSuggestionsOpen(true)}
                      onChangeText={(t) => {
                        setStreetName(t);
                        setStreetSuggestionsOpen(true);
                        if (formErrors.streetName) {
                          setFormErrors((prev) => {
                            const next = { ...prev };
                            delete next.streetName;
                            return next;
                          });
                        }
                      }}
                    />
                    {formErrors.streetName ? (
                      <Text style={styles.fieldError}>{formErrors.streetName}</Text>
                    ) : null}

                    {/* Street suggestions dropdown */}
                    {streetSuggestionsOpen && suggestedStreetsForBarangay.length > 0 && (
                      <View style={styles.suggestionsContainer}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={styles.suggestionsLabel}>Suggested Routes / Sectors:</Text>
                          <TouchableOpacity onPress={() => setStreetSuggestionsOpen(false)}>
                            <MaterialIcons name="close" size={14} color="#64748B" />
                          </TouchableOpacity>
                        </View>
                        <ScrollView style={{ maxHeight: 110 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                          {suggestedStreetsForBarangay.map((s) => (
                            <TouchableOpacity
                              key={s}
                              style={styles.suggestionItem}
                              onPress={() => {
                                setStreetName(s);
                                setStreetSuggestionsOpen(false);
                                if (formErrors.streetName) {
                                  setFormErrors((prev) => {
                                    const next = { ...prev };
                                    delete next.streetName;
                                    return next;
                                  });
                                }
                              }}
                            >
                              <MaterialIcons name="alt-route" size={14} color="#059669" />
                              <Text style={styles.suggestionItemText}>{s}</Text>
                              <Text style={{ fontSize: 10, color: '#059669', fontWeight: '800', marginLeft: 'auto' }}>
                                Select
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                </View>

                {/* Informative pill when adding an additional route / schedule to an existing barangay */}
                {isAlreadyRegistered && (
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 10,
                    backgroundColor: '#EFF6FF',
                    borderColor: '#BFDBFE',
                    borderWidth: 1,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 8,
                    alignSelf: 'flex-start',
                  }}>
                    <MaterialIcons name="alt-route" size={14} color="#2563EB" />
                    <Text style={{ color: '#1E40AF', fontSize: 11.5, fontWeight: '700' }}>
                      Adding an additional route for Brgy. {barangayName.trim() || assignedBarangay} ({existingRoutesCount} existing {existingRoutesCount === 1 ? 'route' : 'routes'})
                    </Text>
                  </View>
                )}
              </View>

              {/* SECTION 2: Collection Parameters */}
              <View style={styles.modalSectionCard}>
                <View style={styles.modalSectionHeader}>
                  <View style={styles.modalSectionBadge}>
                    <MaterialIcons name="schedule" size={16} color="#059669" />
                  </View>
                  <Text style={styles.modalSectionTitle}>2. Collection Schedule & Fleet</Text>
                </View>

                {/* Regular Collection Days */}
                <View style={{ marginBottom: 16 }}>
                  <View style={styles.labelRow}>
                    <Text style={styles.inputLabel}>
                      REGULAR COLLECTION DAYS <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                    <TouchableOpacity
                      onPress={handleSelectAllDays}
                      style={styles.quickDayBtn}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.quickDayBtnText}>
                        {selectedDays.length === DAYS_OF_WEEK.length
                          ? 'Clear All'
                          : 'Daily Service'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.modalDaysRow}>
                    {DAYS_OF_WEEK.map((day) => {
                      const selected = selectedDays.includes(day);
                      return (
                        <TouchableOpacity
                          key={day}
                          style={[styles.modalDay, selected && styles.modalDaySelected]}
                          onPress={() => toggleDay(day)}
                          activeOpacity={0.8}
                        >
                          <Text
                            style={[
                              styles.modalDayText,
                              selected && styles.modalDayTextSelected,
                            ]}
                          >
                            {day}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {formErrors.selectedDays ? (
                    <Text style={styles.fieldError}>{formErrors.selectedDays}</Text>
                  ) : null}
                </View>

                {/* Regular Collection Time Configurator */}
                <View style={{ marginBottom: 16 }}>
                  <View style={styles.labelRow}>
                    <Text style={styles.inputLabel}>
                      COLLECTION PICKUP HOURS <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                  </View>

                  {/* Mode Segmented Switch */}
                  <View style={styles.timeModeSegmentedContainer}>
                    <TouchableOpacity
                      style={[
                        styles.timeModeTab,
                        !useCustomDayTimes && styles.timeModeTabActive,
                      ]}
                      onPress={() => {
                        setUseCustomDayTimes(false);
                        const fallbackTime = modalTimeStr || '06:00 AM';
                        setDayTimes((prev) => {
                          const next = { ...prev };
                          selectedDays.forEach((d) => {
                            next[d] = fallbackTime;
                          });
                          return next;
                        });
                      }}
                      activeOpacity={0.8}
                    >
                      <MaterialIcons
                        name="schedule"
                        size={15}
                        color={!useCustomDayTimes ? '#FFFFFF' : '#64748B'}
                      />
                      <Text
                        style={[
                          styles.timeModeTabText,
                          !useCustomDayTimes && styles.timeModeTabTextActive,
                        ]}
                      >
                        Same Time for All Days
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.timeModeTab,
                        useCustomDayTimes && styles.timeModeTabActive,
                      ]}
                      onPress={() => setUseCustomDayTimes(true)}
                      activeOpacity={0.8}
                    >
                      <MaterialIcons
                        name="tune"
                        size={15}
                        color={useCustomDayTimes ? '#FFFFFF' : '#64748B'}
                      />
                      <Text
                        style={[
                          styles.timeModeTabText,
                          useCustomDayTimes && styles.timeModeTabTextActive,
                        ]}
                      >
                        Customize by Day
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Mode 1: Uniform / Standard Pickup Time */}
                  {!useCustomDayTimes && (
                    <View style={styles.uniformTimeCard}>
                      <View style={styles.uniformTimeHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <View style={styles.uniformTimeIconCircle}>
                            <MaterialIcons name="alarm" size={22} color="#1B4D3E" />
                          </View>
                          <View>
                            <Text style={styles.uniformTimeLabel}>Standard Pickup Hour</Text>
                            <Text style={styles.uniformTimeBigText}>
                              {modalTimeStr || '06:00 AM'}
                            </Text>
                          </View>
                        </View>

                        <TouchableOpacity
                          onPress={() => {
                            setTimePickerTargetDay(null);
                            setShowModalAnalogTimePicker(true);
                          }}
                          style={styles.clockPickerMainBtn}
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="access-time" size={15} color="#FFFFFF" />
                          <Text style={styles.clockPickerMainBtnText}>Clock Picker</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Quick Presets Row */}
                      <View style={styles.presetSection}>
                        <Text style={styles.presetSectionLabel}>Preset Options:</Text>
                        <View style={styles.presetPillsRow}>
                          {['05:00 AM', '06:00 AM', '07:00 AM', '08:00 AM', '01:00 PM', '05:00 PM'].map((t) => {
                            const isSel = (modalTimeStr || '06:00 AM') === t;
                            return (
                              <TouchableOpacity
                                key={t}
                                style={[styles.presetChip, isSel && styles.presetChipActive]}
                                onPress={() => {
                                  setModalTimeStr(t);
                                  setDayTimes((prev) => {
                                    const next = { ...prev };
                                    selectedDays.forEach((d) => {
                                      next[d] = t;
                                    });
                                    return next;
                                  });
                                }}
                                activeOpacity={0.8}
                              >
                                <Text style={[styles.presetChipText, isSel && styles.presetChipTextActive]}>
                                  {t}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>

                      {/* Coverage indicator */}
                      {selectedDays.length > 0 ? (
                        <View style={styles.scheduleCoverageBanner}>
                          <MaterialIcons name="check-circle" size={16} color="#059669" />
                          <Text style={styles.scheduleCoverageText}>
                            Applies to <Text style={{ fontWeight: '800' }}>{sortDaysInOrder(selectedDays).join(', ')}</Text> at{' '}
                            <Text style={{ fontWeight: '800' }}>{modalTimeStr || '06:00 AM'}</Text>
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.scheduleCoverageBannerEmpty}>
                          <MaterialIcons name="info-outline" size={15} color="#64748B" />
                          <Text style={styles.scheduleCoverageTextEmpty}>
                            Select collection days above to schedule pickups.
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Mode 2: Day-Specific Pickup Times */}
                  {useCustomDayTimes && (
                    <View style={{ gap: 10 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={styles.customDaysHeaderDesc}>
                          Assign pickup times for each collection day:
                        </Text>
                        {selectedDays.length > 1 && (
                          <TouchableOpacity
                            onPress={() => {
                              const sorted = sortDaysInOrder(selectedDays);
                              const firstDay = sorted[0];
                              const firstTime = (firstDay ? dayTimes[firstDay] : null) || modalTimeStr || '06:00 AM';
                              setDayTimes((prev) => {
                                const next = { ...prev };
                                sorted.forEach((d) => {
                                  next[d] = firstTime;
                                });
                                return next;
                              });
                            }}
                            style={styles.syncAllDaysLink}
                            activeOpacity={0.8}
                          >
                            <MaterialIcons name="sync" size={13} color="#065F46" />
                            <Text style={styles.syncAllDaysLinkText}>Copy {sortDaysInOrder(selectedDays)[0] || 'MON'} to All</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {selectedDays.length === 0 ? (
                        <View style={styles.scheduleCoverageBannerEmpty}>
                          <MaterialIcons name="info-outline" size={15} color="#64748B" />
                          <Text style={styles.scheduleCoverageTextEmpty}>
                            Select regular collection days above first.
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.daysTableContainer}>
                          {sortDaysInOrder(selectedDays).map((day, idx) => {
                            const currentTime = dayTimes[day] || modalTimeStr || '06:00 AM';
                            const dayFullName =
                              day === 'MON' ? 'Monday' :
                              day === 'TUE' ? 'Tuesday' :
                              day === 'WED' ? 'Wednesday' :
                              day === 'THU' ? 'Thursday' :
                              day === 'FRI' ? 'Friday' :
                              day === 'SAT' ? 'Saturday' : 'Sunday';

                            return (
                              <View
                                key={day}
                                style={[
                                  styles.dayTableRow,
                                  idx === selectedDays.length - 1 && { borderBottomWidth: 0 },
                                ]}
                              >
                                {/* Left: Day Badge + Full Name */}
                                <View style={styles.dayTableRowLeft}>
                                  <View style={styles.dayBadgeModern}>
                                    <Text style={styles.dayBadgeModernText}>{day}</Text>
                                  </View>
                                  <Text style={styles.dayFullName}>{dayFullName}</Text>
                                </View>

                                {/* Right: Time Dropdown + Clock Picker */}
                                <View style={styles.dayTableRowRight}>
                                  {Platform.OS === 'web' ? (
                                    <WebTimeSelect
                                      value={currentTime}
                                      onChange={(val) => {
                                        setDayTimes((prev) => ({
                                          ...prev,
                                          [day]: val,
                                        }));
                                      }}
                                    />
                                  ) : (
                                    <TouchableOpacity
                                      onPress={() => {
                                        setTimePickerTargetDay(day);
                                        setShowModalAnalogTimePicker(true);
                                      }}
                                      style={styles.mobileTimeBtn}
                                      activeOpacity={0.8}
                                    >
                                      <MaterialIcons name="schedule" size={14} color="#1B4D3E" />
                                      <Text style={styles.mobileTimeBtnText}>{currentTime}</Text>
                                    </TouchableOpacity>
                                  )}

                                  <TouchableOpacity
                                    onPress={() => {
                                      setTimePickerTargetDay(day);
                                      setShowModalAnalogTimePicker(true);
                                    }}
                                    style={styles.dayClockPickerBtn}
                                    activeOpacity={0.8}
                                  >
                                    <MaterialIcons name="access-time" size={14} color="#1E293B" />
                                    <Text style={styles.dayClockPickerBtnText}>Clock</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}

                      {/* Summary Banner */}
                      {selectedDays.length > 0 && (
                        <View style={styles.scheduleCoverageBanner}>
                          <MaterialIcons name="playlist-add-check" size={18} color="#059669" />
                          <Text style={styles.scheduleCoverageText}>
                            {selectedDays
                              .map(
                                (d) =>
                                  `${d}: ${dayTimes[d] || modalTimeStr || '06:00 AM'}`
                              )
                              .join('  •  ')}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {/* Waste Category Selection */}
                <View style={{ marginBottom: 16 }}>
                  <Text style={styles.inputLabel}>
                    WASTE CATEGORY <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <View style={styles.categoryGrid}>
                    {CATEGORIES.map((cat) => {
                      const isSelected = wasteCategory === cat.name;
                      return (
                        <TouchableOpacity
                          key={cat.name}
                          style={[
                            styles.catBtn,
                            isSelected && {
                              backgroundColor: cat.color,
                              borderColor: cat.color,
                            },
                          ]}
                          onPress={() => setWasteCategory(cat.name)}
                          activeOpacity={0.8}
                        >
                          <MaterialIcons
                            name={cat.icon as any}
                            size={16}
                            color={isSelected ? '#FFFFFF' : cat.color}
                          />
                          <Text
                            style={[
                              styles.catBtnText,
                              isSelected && { color: '#FFFFFF', fontWeight: '800' },
                            ]}
                          >
                            {cat.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Assigned Truck / Driver */}
                <View style={{ marginBottom: 8 }}>
                  <View style={styles.labelRow}>
                    <Text style={styles.inputLabel}>
                      ASSIGNED TRUCK / UNIT (OPTIONAL)
                      {barangayName.trim() ? (
                        <Text style={{ fontSize: 11, color: '#059669', fontWeight: '600' }}>
                          {' '}· Brgy. {barangayName.trim()}
                        </Text>
                      ) : null}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setTruckPickerOpen(!truckPickerOpen)}
                      style={styles.quickDayBtn}
                    >
                      <Text style={styles.quickDayBtnText}>
                        {truckPickerOpen ? 'Hide Fleet' : 'Select from Fleet'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.textInput}
                    value={truckName}
                    onChangeText={setTruckName}
                    placeholder="e.g. Compactor #101, Truck 04 (Optional)"
                    placeholderTextColor="#94A3B8"
                  />

                  {/* Fleet Vehicle Picker Dropdown */}
                  {truckPickerOpen && (
                    <View style={styles.fleetPickerCard}>
                      {/* Search Bar & Clear Selected */}
                      <View style={styles.fleetPickerSearchRow}>
                        <View style={styles.fleetSearchInputWrapper}>
                          <MaterialIcons name="search" size={17} color="#64748B" style={{ marginRight: 6 }} />
                          <TextInput
                            style={styles.fleetSearchInput}
                            value={truckPickerSearch}
                            onChangeText={setTruckPickerSearch}
                            placeholder="Search plate #, model, barangay, or driver..."
                            placeholderTextColor="#94A3B8"
                          />
                          {truckPickerSearch.length > 0 && (
                            <TouchableOpacity
                              onPress={() => setTruckPickerSearch('')}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <MaterialIcons name="close" size={16} color="#94A3B8" />
                            </TouchableOpacity>
                          )}
                        </View>
                        {truckName.trim().length > 0 && (
                          <TouchableOpacity
                            style={styles.fleetClearSelectionBtn}
                            onPress={() => setTruckName('')}
                          >
                            <MaterialIcons name="clear" size={13} color="#EF4444" />
                            <Text style={styles.fleetClearSelectionText}>Unassign</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Fleet List Body */}
                      <View style={styles.fleetListContainer}>
                        {!barangayName.trim() ? (
                          <View style={styles.fleetEmptyState}>
                            <MaterialIcons name="location-city" size={30} color="#94A3B8" />
                            <Text style={styles.fleetEmptyTitle}>No Barangay Selected</Text>
                            <Text style={styles.fleetEmptySub}>
                              Please select or enter a barangay above first to view its assigned fleet vehicles.
                            </Text>
                          </View>
                        ) : trucksList.length === 0 ? (
                          <View style={styles.fleetEmptyState}>
                            <MaterialIcons name="local-shipping" size={30} color="#CBD5E1" />
                            <Text style={styles.fleetEmptyTitle}>No trucks found in fleet database</Text>
                            <Text style={styles.fleetEmptySub}>
                              Register vehicles in the Truck Inventory tab or type a custom unit name above.
                            </Text>
                          </View>
                        ) : matchingBarangayTrucks.length === 0 ? (
                          <View style={styles.fleetEmptyState}>
                            {truckPickerSearch.trim() ? (
                              <>
                                <MaterialIcons name="search-off" size={26} color="#94A3B8" />
                                <Text style={styles.fleetEmptyTitle}>No matching trucks found</Text>
                                <Text style={styles.fleetEmptySub}>
                                  No trucks assigned to Brgy. {barangayName.trim()} match &quot;{truckPickerSearch}&quot;.
                                </Text>
                                <TouchableOpacity onPress={() => setTruckPickerSearch('')} style={{ marginTop: 6 }}>
                                  <Text style={{ fontSize: 12, color: '#059669', fontWeight: '700' }}>Clear Search</Text>
                                </TouchableOpacity>
                              </>
                            ) : (
                              <>
                                <MaterialIcons name="local-shipping" size={30} color="#CBD5E1" />
                                <Text style={styles.fleetEmptyTitle}>No trucks assigned to Brgy. {barangayName.trim()}</Text>
                                <Text style={styles.fleetEmptySub}>
                                  Assign trucks to this barangay in the Truck Inventory tab, or type a custom unit name above.
                                </Text>
                              </>
                            )}
                          </View>
                        ) : (
                          <ScrollView
                            style={{ maxHeight: 260 }}
                            nestedScrollEnabled={true}
                            showsVerticalScrollIndicator={true}
                          >
                            <View style={{ marginBottom: 4 }}>
                              <View style={styles.fleetSectionHeaderRow}>
                                <MaterialIcons name="check-circle" size={14} color="#059669" />
                                <Text style={styles.fleetSectionHeaderTitle}>
                                  Assigned to Brgy. {barangayName.trim()} ({matchingBarangayTrucks.length})
                                </Text>
                              </View>
                              {matchingBarangayTrucks.map((truck) => {
                                const isSelected = truckName.trim().toLowerCase() === String(truck.plateNumber || '').trim().toLowerCase();
                                const status = (truck.status || 'active').toLowerCase();
                                const statusBg =
                                  status === 'active' ? '#DCFCE7' : status === 'maintenance' ? '#FEF3C7' : '#FEE2E2';
                                const statusColor =
                                  status === 'active' ? '#15803D' : status === 'maintenance' ? '#B45309' : '#B91C1C';
                                const brgyLabel = getTruckBarangay(truck);

                                return (
                                  <TouchableOpacity
                                    key={truck.id}
                                    style={[
                                      styles.fleetItemCard,
                                      isSelected && styles.fleetItemCardSelected,
                                    ]}
                                    onPress={() => {
                                      setTruckName(truck.plateNumber || '');
                                      const validTruckDriver = getValidDriverName(truck.assignedDriverId, truck.assignedDriverName);
                                      if (truck.assignedDriverId && validTruckDriver) {
                                        setScheduleDriverId(truck.assignedDriverId);
                                        setScheduleDriverName(validTruckDriver);
                                      }
                                      setTruckPickerOpen(false);
                                    }}
                                    activeOpacity={0.7}
                                  >
                                    <View style={{ flex: 1 }}>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <Text style={styles.fleetPlateText}>
                                          {truck.plateNumber || 'Unit #' + truck.id.slice(0, 5)}
                                        </Text>
                                        {truck.type ? (
                                          <View style={styles.fleetTypeBadge}>
                                            <Text style={styles.fleetTypeBadgeText}>{truck.type}</Text>
                                          </View>
                                        ) : null}
                                        <View style={[styles.fleetStatusBadge, { backgroundColor: statusBg }]}>
                                          <Text style={[styles.fleetStatusBadgeText, { color: statusColor }]}>
                                            {status.toUpperCase()}
                                          </Text>
                                        </View>
                                      </View>

                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                                        {getValidDriverName(truck.assignedDriverId, truck.assignedDriverName) ? (
                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                            <MaterialIcons name="person" size={13} color="#475569" />
                                            <Text style={styles.fleetMetaText}>
                                              Driver: {getValidDriverName(truck.assignedDriverId, truck.assignedDriverName)}
                                            </Text>
                                          </View>
                                        ) : null}
                                        {brgyLabel ? (
                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                            <MaterialIcons name="location-on" size={13} color="#059669" />
                                            <Text style={[styles.fleetMetaText, { color: '#059669', fontWeight: '600' }]}>
                                              Brgy. {brgyLabel}
                                            </Text>
                                          </View>
                                        ) : null}
                                        {truck.capacity ? (
                                          <Text style={styles.fleetMetaText}>
                                            Cap: {truck.capacity}
                                          </Text>
                                        ) : null}
                                      </View>
                                    </View>

                                    <View style={{ marginLeft: 8 }}>
                                      {isSelected ? (
                                        <View style={styles.fleetSelectedCheck}>
                                          <MaterialIcons name="check" size={14} color="#FFFFFF" />
                                        </View>
                                      ) : (
                                        <Text style={styles.fleetSelectActionText}>Select</Text>
                                      )}
                                    </View>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </ScrollView>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Assigned Regular Driver */}
                  <View style={{ marginTop: 14 }}>
                    <Text style={styles.inputLabel}>
                      ASSIGN REGULAR DRIVER (OPTIONAL)
                    </Text>
                    {Platform.OS === 'web' ? (
                      createElement('select', {
                        value: scheduleDriverId,
                        onChange: (e: any) => {
                          const val = e.target.value;
                          setScheduleDriverId(val);
                          const d = driversList.find((drv) => drv.id === val);
                          setScheduleDriverName(d ? (d.displayName || d.name || d.email || '') : '');
                        },
                        style: {
                          padding: '10px 14px',
                          borderRadius: '8px',
                          border: '1.5px solid #CBD5E1',
                          width: '100%',
                          fontSize: '14px',
                          fontWeight: '600',
                          color: '#0F172A',
                          backgroundColor: '#FFFFFF',
                          outline: 'none',
                          height: '46px',
                          cursor: 'pointer',
                        },
                      }, isCoordinator
                        ? [
                            createElement('option', { key: 'none', value: '' }, '-- Optional: Select Driver for this Weekly Schedule --'),
                            ...(coordinatorScheduleDrivers.length === 0
                              ? [
                                  createElement(
                                    'option',
                                    { key: 'empty', value: '', disabled: true },
                                    `-- No Drivers Assigned to Brgy. ${scheduleModalTargetBarangay || 'your barangay'} --`
                                  ),
                                ]
                              : coordinatorScheduleDrivers.map((drv) =>
                                  createElement(
                                    'option',
                                    { key: drv.id, value: drv.id },
                                    `${drv.displayName || drv.name || drv.email || drv.id}${getDriverBarangay(drv) ? ` • Brgy. ${getDriverBarangay(drv)}` : ''}`
                                  )
                                )),
                          ]
                        : [
                            createElement('option', { key: 'none', value: '' }, '-- Optional: Select Driver for this Weekly Schedule --'),
                            ...matchingScheduleDrivers.map((drv) =>
                              createElement(
                                'option',
                                { key: drv.id, value: drv.id },
                                `${drv.displayName || drv.name || drv.email || drv.id}${getDriverBarangay(drv) ? ` • Brgy. ${getDriverBarangay(drv)}` : ''}`
                              )
                            ),
                            ...(otherScheduleDrivers.length > 0
                              ? [
                                  createElement(
                                    'optgroup',
                                    { key: 'other-sched-group', label: 'Other Danao Fleet Drivers (Reassign)' },
                                    otherScheduleDrivers.map((drv) =>
                                      createElement(
                                        'option',
                                        { key: drv.id, value: drv.id },
                                        `${drv.displayName || drv.name || drv.email || drv.id}${getDriverBarangay(drv) ? ` • Brgy. ${getDriverBarangay(drv)}` : ''}`
                                      )
                                    )
                                  ),
                                ]
                              : []),
                          ])
                    ) : (
                      <TextInput
                        style={styles.textInput}
                        value={scheduleDriverName}
                        onChangeText={setScheduleDriverName}
                        placeholder="Driver Name (Optional)"
                        placeholderTextColor="#94A3B8"
                      />
                    )}
                  </View>
                </View>
              </View>
            </ScrollView>

            {/* Modal Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setModalVisible(false);
                  setEditingScheduleId(null);
                  setEditingOriginalSchedule(null);
                }}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >

                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveSchedule}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>
                    {editingScheduleId ? 'Update Route Schedule' : 'Save Route Schedule'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Regular Schedule Analog Clock Modal */}
        <AnalogTimePicker
          visible={showModalAnalogTimePicker}
          onClose={() => {
            setShowModalAnalogTimePicker(false);
            setTimePickerTargetDay(null);
          }}
          initialHours24={(() => {
            const activeTime = timePickerTargetDay
              ? (dayTimes[timePickerTargetDay] || modalTimeStr || '06:00 AM')
              : (modalTimeStr || '06:00 AM');
            const [timePart, ampm] = activeTime.split(' ');
            if (!timePart) return 6;
            let [h] = timePart.split(':').map(Number);
            if (ampm === 'PM' && h !== 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            return h || 6;
          })()}
          initialMinutes={(() => {
            const activeTime = timePickerTargetDay
              ? (dayTimes[timePickerTargetDay] || modalTimeStr || '06:00 AM')
              : (modalTimeStr || '06:00 AM');
            const [timePart] = activeTime.split(' ');
            if (!timePart) return 0;
            const [, m] = timePart.split(':').map(Number);
            return m || 0;
          })()}
          onSelect={(hours24, minutes) => {
            const ampm = hours24 >= 12 ? 'PM' : 'AM';
            let h12 = hours24 % 12;
            if (h12 === 0) h12 = 12;
            const mStr = minutes.toString().padStart(2, '0');
            const formatted = `${h12.toString().padStart(2, '0')}:${mStr} ${ampm}`;
            if (timePickerTargetDay) {
              setDayTimes((prev) => ({ ...prev, [timePickerTargetDay]: formatted }));
            } else {
              setModalTimeStr(formatted);
              if (!useCustomDayTimes) {
                setDayTimes((prev) => {
                  const next = { ...prev };
                  selectedDays.forEach((d) => {
                    next[d] = formatted;
                  });
                  return next;
                });
              }
            }
          }}
        />
      </Modal>

      {/* ========================================================================= */}
      {/* SPECIFIC PICKUP DATES & TIMES MODAL                                       */}
      {/* ========================================================================= */}
      <Modal
        visible={isDetailsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isMobile && { width: '95%', padding: 18 }]}>
            {selectedBarangay && (
              <>
                <View style={styles.modalHeaderRow}>
                  <View>
                    <Text style={styles.modalTitle}>
                      {selectedBarangay.barangayName} • Special Pickups
                    </Text>
                    <Text style={styles.modalSubtitle}>
                      {selectedBarangay.streetName || 'Whole Barangay'} • One-time or special date collections
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => setDetailsModalVisible(false)}
                      style={styles.modalCloseBtn}
                      disabled={isDeleting}
                    >
                      <MaterialIcons name="close" size={20} color="#64748B" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Active Regular Weekly Schedule Card */}
                <View
                  style={{
                    backgroundColor: '#F0FDF4',
                    borderWidth: 1,
                    borderColor: '#BBF7D0',
                    borderRadius: 10,
                    padding: 12,
                    marginBottom: 16,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="check-circle" size={16} color="#059669" />
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#166534', letterSpacing: 0.5 }}>
                        ACTIVE WEEKLY SCHEDULE
                      </Text>
                    </View>
                    <View style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#15803D' }}>RUNNING WEEKLY</Text>
                    </View>
                  </View>

                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#0F172A' }}>
                    {sortDaysInOrder(selectedBarangay.days || []).join(', ') || 'Regular Days'} •{' '}
                    {selectedBarangay.time || selectedBarangay.timeText || '06:00 AM'}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: '#475569', marginTop: 2 }}>
                    Category: {selectedBarangay.category || selectedBarangay.wasteCategory || 'All Categories'} • Vehicle: {selectedBarangay.truckName || selectedBarangay.truck || 'Unassigned'}
                  </Text>

                  {/* Driver Assignment for Weekly Schedule */}
                  <View
                    style={{
                      marginTop: 10,
                      paddingTop: 8,
                      borderTopWidth: 1,
                      borderTopColor: '#DCFCE7',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="person" size={15} color={getValidDriverName(selectedBarangay.assignedDriverId, selectedBarangay.assignedDriverName, selectedBarangay.barangayName || selectedBarangay.barangay || detailsModalBarangay) ? '#1E40AF' : '#64748B'} />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: getValidDriverName(selectedBarangay.assignedDriverId, selectedBarangay.assignedDriverName, selectedBarangay.barangayName || selectedBarangay.barangay || detailsModalBarangay) ? '#1E40AF' : '#64748B' }}>
                        Weekly Driver: {getValidDriverName(selectedBarangay.assignedDriverId, selectedBarangay.assignedDriverName, selectedBarangay.barangayName || selectedBarangay.barangay || detailsModalBarangay) || 'Unassigned'}
                      </Text>
                    </View>

                    {Platform.OS === 'web' && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>Assign Driver:</Text>
                        {createElement('select', {
                          value: selectedBarangay.assignedDriverId || '',
                          onChange: (e: any) => {
                            const val = e.target.value;
                            const d = driversList.find((drv) => drv.id === val);
                            handleAssignWeeklyDriver(
                              selectedBarangay.id,
                              val,
                              d ? (d.displayName || d.name || d.email || 'Driver') : '',
                              d ? (d.email || '') : '',
                              detailsModalBarangay || 'Baliang'
                            );
                          },
                          style: {
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1.5px solid #CBD5E1',
                            fontSize: '12px',
                            fontWeight: '700',
                            color: '#0F172A',
                            backgroundColor: '#FFFFFF',
                            cursor: 'pointer',
                            outline: 'none',
                          },
                        }, isCoordinator
                          ? [
                              createElement('option', { key: 'none', value: '' }, '-- Unassigned --'),
                              ...(coordinatorDetailsDrivers.length === 0
                                ? [
                                    createElement(
                                      'option',
                                      { key: 'empty', value: '', disabled: true },
                                      `-- No Drivers Assigned to Brgy. ${detailsModalBarangay || 'Baliang'} --`
                                    ),
                                  ]
                                : coordinatorDetailsDrivers.map((drv) =>
                                    createElement(
                                      'option',
                                      { key: drv.id, value: drv.id },
                                      `${drv.displayName || drv.name || drv.email || drv.id}${getDriverBarangay(drv) ? ` (${getDriverBarangay(drv)})` : ''}`
                                    )
                                  )),
                            ]
                          : [
                              createElement('option', { key: 'none', value: '' }, '-- Unassigned --'),
                              ...matchingDetailsDrivers.map((drv) =>
                                createElement(
                                  'option',
                                  { key: drv.id, value: drv.id },
                                  `${drv.displayName || drv.name || drv.email || drv.id}${getDriverBarangay(drv) ? ` (${getDriverBarangay(drv)})` : ''}`
                                )
                              ),
                              ...(otherDetailsDrivers.length > 0
                                ? [
                                    createElement(
                                      'optgroup',
                                      { key: 'other-drivers-group', label: 'Other Danao Fleet Drivers (Reassign)' },
                                      otherDetailsDrivers.map((drv) =>
                                        createElement(
                                          'option',
                                          { key: drv.id, value: drv.id },
                                          `${drv.displayName || drv.name || drv.email || drv.id}${getDriverBarangay(drv) ? ` (${getDriverBarangay(drv)})` : ''}`
                                        )
                                      )
                                    ),
                                  ]
                                : []),
                            ])}
                      </View>
                    )}
                  </View>
                </View>

                {/* Existing Specific Pickups List */}
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#334155', marginBottom: 8 }}>
                  Special One-Time Dates (Optional)
                </Text>
                <ScrollView style={{ maxHeight: 180, marginBottom: 16 }}>
                  {(selectedBarangay.specificSchedules || []).length === 0 ? (
                    <View style={{ padding: 14, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0' }}>
                      <Text style={{ color: '#475569', fontSize: 12.5, fontWeight: '700' }}>
                        No one-time special pickup dates added yet.
                      </Text>
                      <Text style={{ color: '#64748B', fontSize: 11, marginTop: 3, textAlign: 'center' }}>
                        Your regular weekly pickup above is running as scheduled. Use the form below only if you need to schedule an extra ad-hoc pickup date.
                      </Text>
                    </View>
                  ) : (
                    (selectedBarangay.specificSchedules || []).map((ss: any, idx: number) => (
                      <View key={idx} style={styles.specificScheduleCard}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={{ fontWeight: '700', color: '#0F172A', fontSize: 14 }}>
                            {ss.date} at {ss.time}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                            <Text
                              style={{
                                fontSize: 11,
                                color:
                                  CATEGORIES.find((c) => c.name === ss.category)?.color || '#059669',
                                fontWeight: '800',
                              }}
                            >
                              {ss.category}
                            </Text>
                            {(() => {
                              const validSpecificDriver = getValidDriverName(ss.assignedDriverId, ss.assignedDriverName, selectedBarangay.barangayName || selectedBarangay.barangay || detailsModalBarangay);
                              return validSpecificDriver ? (
                                <View
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 4,
                                    backgroundColor: '#EFF6FF',
                                    borderColor: '#BFDBFE',
                                    borderWidth: 1,
                                    paddingHorizontal: 6,
                                    paddingVertical: 2,
                                    borderRadius: 4,
                                  }}
                                >
                                  <MaterialIcons name="person" size={11} color="#1E40AF" />
                                  <Text style={{ fontSize: 10.5, fontWeight: '700', color: '#1E40AF' }}>
                                    Driver: {validSpecificDriver}
                                  </Text>
                                </View>
                              ) : (
                                <View
                                  style={{
                                    backgroundColor: '#F1F5F9',
                                    paddingHorizontal: 6,
                                    paddingVertical: 2,
                                    borderRadius: 4,
                                  }}
                                >
                                  <Text style={{ fontSize: 10, color: '#64748B', fontStyle: 'italic' }}>
                                    Any Fleet Driver
                                  </Text>
                                </View>
                              );
                            })()}
                          </View>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleDeleteSpecificSchedule(idx)}
                          style={[styles.actionIconBtn, styles.actionIconBtnDanger]}
                          disabled={isDeleting}
                        >
                          <MaterialIcons name="close" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </ScrollView>

                <View style={styles.modalDivider} />

                {/* Form to add a specific pickup */}
                <Text style={{ fontSize: 14, fontWeight: '800', color: '#0F172A', marginBottom: 12 }}>
                  Add Special Pickup Date
                </Text>

                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>
                      PICKUP DATE <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                    {Platform.OS === 'web' ? (
                      <WebDatePicker value={webDateStr} onChange={setWebDateStr} />
                    ) : (
                      <TouchableOpacity
                        style={[styles.textInput, { justifyContent: 'center' }]}
                        onPress={() => setShowDatePicker(true)}
                      >
                        <Text style={{ color: '#0F172A' }}>{formattedDate}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>
                      PICKUP TIME <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                    {Platform.OS === 'web' ? (
                      <TouchableOpacity
                        style={[
                          styles.textInput,
                          { justifyContent: 'center', height: 48, boxSizing: 'border-box' as any },
                        ]}
                        onPress={() => setShowAnalogTimePicker(true)}
                      >
                        <Text style={{ color: '#0F172A' }}>{formattedTime}</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[
                          styles.textInput,
                          { justifyContent: 'center', height: 48, boxSizing: 'border-box' as any },
                        ]}
                        onPress={() => setShowTimePicker(true)}
                      >
                        <Text style={{ color: '#0F172A' }}>{formattedTime}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {Platform.OS === 'web' && (
                  <AnalogTimePicker
                    visible={showAnalogTimePicker}
                    onClose={() => setShowAnalogTimePicker(false)}
                    initialHours24={webTimeStr ? parseInt(webTimeStr.split(':')[0], 10) : 0}
                    initialMinutes={webTimeStr ? parseInt(webTimeStr.split(':')[1], 10) : 0}
                    onSelect={(h, m) => {
                      setWebTimeStr(
                        `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
                      );
                    }}
                  />
                )}

                {Platform.OS !== 'web' && (showDatePicker || showTimePicker) && (
                  <DateTimePicker
                    value={dateObj}
                    mode={showDatePicker ? 'date' : 'time'}
                    display="default"
                    minimumDate={new Date()}
                    onChange={(event, selectedDate) => {
                      if (Platform.OS !== 'ios') {
                        setShowDatePicker(false);
                        setShowTimePicker(false);
                      }
                      if (selectedDate) {
                        setDateObj(selectedDate);
                      }
                    }}
                  />
                )}

                <Text style={styles.inputLabel}>
                  WASTE CATEGORY <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <View style={styles.categoryGrid}>
                  {CATEGORIES.map((cat) => {
                    const isSelected = specificCategory === cat.name;
                    return (
                      <TouchableOpacity
                        key={cat.name}
                        style={[
                          styles.catBtn,
                          isSelected && {
                            backgroundColor: cat.color,
                            borderColor: cat.color,
                          },
                        ]}
                        onPress={() => setSpecificCategory(cat.name)}
                      >
                        <Text
                          style={[
                            styles.catBtnText,
                            isSelected && { color: '#FFFFFF', fontWeight: '800' },
                          ]}
                        >
                          {cat.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Driver Assignment Field */}
                <View style={{ marginTop: 14, marginBottom: 14 }}>
                  <View style={styles.labelRow}>
                    <Text style={styles.inputLabel}>
                      ASSIGN DRIVER (EXCLUSIVE TO THIS DATE)
                    </Text>
                    {specificDriverId ? (
                      <TouchableOpacity
                        onPress={() => {
                          setSpecificDriverId('');
                          setSpecificDriverName('');
                        }}
                      >
                        <Text style={{ fontSize: 11, color: '#EF4444', fontWeight: '700' }}>
                          Clear Assignment
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.textInput,
                      {
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        height: 44,
                        backgroundColor: specificDriverId ? '#EFF6FF' : '#FFFFFF',
                        borderColor: specificDriverId ? '#93C5FD' : '#CBD5E1',
                      },
                    ]}
                    onPress={() => setIsDriverPickerOpen(!isDriverPickerOpen)}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <MaterialIcons
                        name="local-shipping"
                        size={18}
                        color={specificDriverId ? '#1D4ED8' : '#64748B'}
                      />
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: specificDriverId ? '800' : '500',
                          color: specificDriverId ? '#1E40AF' : '#64748B',
                        }}
                        numberOfLines={1}
                      >
                        {specificDriverId
                          ? `Assigned: ${specificDriverName}`
                          : 'Optional: Assign specific driver (only he will see it)...'}
                      </Text>
                    </View>
                    <MaterialIcons
                      name={isDriverPickerOpen ? 'expand-less' : 'expand-more'}
                      size={20}
                      color="#64748B"
                    />
                  </TouchableOpacity>

                  {isDriverPickerOpen && (
                    <View
                      style={{
                        marginTop: 6,
                        backgroundColor: '#FFFFFF',
                        borderWidth: 1,
                        borderColor: '#CBD5E1',
                        borderRadius: 8,
                        maxHeight: 180,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.1,
                        shadowRadius: 4,
                        elevation: 4,
                      }}
                    >
                      <ScrollView nestedScrollEnabled style={{ maxHeight: 180 }}>
                        <TouchableOpacity
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            borderBottomWidth: 1,
                            borderBottomColor: '#F1F5F9',
                            backgroundColor: !specificDriverId ? '#F0FDF4' : '#FFFFFF',
                          }}
                          onPress={() => {
                            setSpecificDriverId('');
                            setSpecificDriverName('');
                            setIsDriverPickerOpen(false);
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: '700',
                              color: !specificDriverId ? '#15803D' : '#334155',
                            }}
                          >
                            Unassigned (Any Fleet Driver)
                          </Text>
                          <Text style={{ fontSize: 11, color: '#64748B' }}>
                            Visible to all drivers operating in this barangay
                          </Text>
                        </TouchableOpacity>

                        {(() => {
                          const renderDriverItem = (driver: any) => {
                            const isSelected = specificDriverId === driver.id;
                            const dName = driver.displayName || driver.name || driver.email || 'Official Driver';
                            const dBrgy = getDriverBarangay(driver) || driver.assignedBarangay || driver.barangay || '';
                            const isMatchingBrgy =
                              detailsModalBarangay &&
                              dBrgy &&
                              normalizeBrgy(dBrgy) === normalizeBrgy(detailsModalBarangay);

                            return (
                              <TouchableOpacity
                                key={driver.id}
                                style={{
                                  paddingHorizontal: 12,
                                  paddingVertical: 10,
                                  borderBottomWidth: 1,
                                  borderBottomColor: '#F8FAFC',
                                  backgroundColor: isSelected ? '#EFF6FF' : '#FFFFFF',
                                }}
                                onPress={() => {
                                  setSpecificDriverId(driver.id);
                                  setSpecificDriverName(dName);
                                  setIsDriverPickerOpen(false);
                                }}
                              >
                                <View
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                  }}
                                >
                                  <Text
                                    style={{
                                      fontSize: 13,
                                      fontWeight: '700',
                                      color: isSelected ? '#1D4ED8' : '#1E293B',
                                    }}
                                  >
                                    {dName}
                                  </Text>
                                  {dBrgy ? (
                                    <View
                                      style={{
                                        backgroundColor: isMatchingBrgy ? '#DCFCE7' : '#F1F5F9',
                                        paddingHorizontal: 6,
                                        paddingVertical: 2,
                                        borderRadius: 4,
                                      }}
                                    >
                                      <Text
                                        style={{
                                          fontSize: 10,
                                          fontWeight: '800',
                                          color: isMatchingBrgy ? '#166534' : '#475569',
                                        }}
                                      >
                                        Brgy. {dBrgy}
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>
                                <Text style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                                  {driver.employeeId ? `ID: ${driver.employeeId} • ` : ''}
                                  {driver.currentTruckPlate ? `🚚 ${driver.currentTruckPlate} • ` : ''}
                                  {driver.email}
                                </Text>
                              </TouchableOpacity>
                            );
                          };

                          if (isCoordinator) {
                            if (coordinatorDetailsDrivers.length === 0) {
                              return (
                                <View style={{ padding: 14, alignItems: 'center' }}>
                                  <MaterialIcons name="person-off" size={20} color="#94A3B8" />
                                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#475569', marginTop: 4 }}>
                                    No drivers assigned to Brgy. {detailsModalBarangay || 'Baliang'}
                                  </Text>
                                  <Text style={{ fontSize: 11, color: '#64748B', marginTop: 2, textAlign: 'center' }}>
                                    Only official drivers assigned to your barangay appear here.
                                  </Text>
                                </View>
                              );
                            }
                            return coordinatorDetailsDrivers.map(renderDriverItem);
                          }

                          return (
                            <>
                              {matchingDetailsDrivers.length > 0 && (
                                <View style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#F0FDF4', borderBottomWidth: 1, borderBottomColor: '#DCFCE7' }}>
                                  <Text style={{ fontSize: 11, fontWeight: '800', color: '#166534' }}>
                                    Brgy. {detailsModalBarangay || 'Selected'} Drivers
                                  </Text>
                                </View>
                              )}
                              {matchingDetailsDrivers.map(renderDriverItem)}

                              {otherDetailsDrivers.length > 0 && (
                                <>
                                  <View style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', marginTop: 4 }}>
                                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#64748B' }}>
                                      Other Danao Fleet Drivers (Reassign)
                                    </Text>
                                  </View>
                                  {otherDetailsDrivers.map(renderDriverItem)}
                                </>
                              )}
                            </>
                          );
                        })()}
                      </ScrollView>
                    </View>
                  )}
                </View>

                {detailModalFeedback && (
                  <View
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      marginBottom: 12,
                      backgroundColor: detailModalFeedback.type === 'success' ? '#F0FDF4' : '#FEF2F2',
                      borderColor: detailModalFeedback.type === 'success' ? '#86EFAC' : '#FECACA',
                      borderWidth: 1,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12.5,
                        fontWeight: '700',
                        color: detailModalFeedback.type === 'success' ? '#15803D' : '#DC2626',
                        textAlign: 'center',
                      }}
                    >
                      {detailModalFeedback.text}
                    </Text>
                  </View>
                )}

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.modalSaveBtn}
                    onPress={handleSaveSpecificSchedule}
                    disabled={isSavingDetail}
                  >
                    {isSavingDetail ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.modalSaveText}>Add Pickup</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* EXPORT COLLECTION SCHEDULES MODAL                                         */}
      {/* ========================================================================= */}
      <Modal
        visible={isExportModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsExportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.exportModalContent,
              {
                maxHeight: Math.min(height * 0.92, 780),
                width: isMobile ? '94%' : '100%',
                maxWidth: 580,
              },
            ]}
          >
            {/* Modal Header - Fixed at Top */}
            <View style={styles.exportModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    backgroundColor: '#ECFDF5',
                    borderWidth: 1,
                    borderColor: '#A7F3D0',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <MaterialIcons name="file-download" size={20} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Export Collection Schedules</Text>
                  <Text style={styles.modalSubtitle} numberOfLines={1}>
                    {isCoordinator
                      ? `Coordinator Manifest • Brgy. ${assignedBarangay || 'Assigned'}`
                      : 'CENRO Admin Export • City-Wide & Multi-Barangay Manifest'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => setIsExportModalVisible(false)}
                style={styles.modalCloseBtn}
                activeOpacity={0.7}
              >
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Modal Body - Scrollable Content */}
            <ScrollView
              style={styles.exportModalScrollBody}
              contentContainerStyle={[styles.exportModalScrollBodyContent, isMobile && { padding: 14 }]}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
              keyboardShouldPersistTaps="handled"
            >
              {/* Scope / Authorization Banner */}
              {isCoordinator ? (
                <View style={styles.exportScopeBannerCoord}>
                  <MaterialIcons name="lock" size={16} color="#059669" style={{ marginTop: 1 }} />
                  <Text style={styles.exportScopeBannerCoordText}>
                    <Text style={{ fontWeight: '800' }}>Coordinator Scope:</Text> You can only export schedules
                    for your assigned barangay (Brgy. {assignedBarangay || 'Assigned'}). City-wide exports require CENRO
                    administrative clearance.
                  </Text>
                </View>
              ) : (
                <View style={styles.exportScopeBannerCenro}>
                  <MaterialIcons name="admin-panel-settings" size={16} color="#1E40AF" style={{ marginTop: 1 }} />
                  <Text style={styles.exportScopeBannerCenroText}>
                    <Text style={{ fontWeight: '800' }}>CENRO Full Scope:</Text> You can export all 42 Danao City
                    barangays or apply custom route, day, and waste category filters below.
                  </Text>
                </View>
              )}

              {/* Filter 1: Barangay Scope */}
              <View style={[{ marginBottom: 14, position: 'relative' }, isExportBarangayDropdownOpen ? { zIndex: 1000 } : { zIndex: 1 }]}>
                <Text style={styles.inputLabel}>BARANGAY JURISDICTION</Text>
                {isCoordinator ? (
                  <View
                    style={[
                      styles.textInput,
                      {
                        backgroundColor: '#F0FDF4',
                        borderColor: '#86EFAC',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        height: 44,
                        paddingHorizontal: 12,
                      },
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialIcons name="lock" size={16} color="#059669" />
                      <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#065F46' }}>
                        Brgy. {assignedBarangay || 'Your Barangay'}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 4 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: '#166534' }}>LOCKED SCOPE</Text>
                    </View>
                  </View>
                ) : (
                  <View style={{ position: 'relative', zIndex: isExportBarangayDropdownOpen ? 1000 : 1 }}>
                    <TouchableOpacity
                      style={[
                        styles.textInput,
                        {
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          height: 44,
                          paddingHorizontal: 12,
                          backgroundColor: '#FFFFFF',
                        },
                      ]}
                      onPress={() => setIsExportBarangayDropdownOpen(!isExportBarangayDropdownOpen)}
                      activeOpacity={0.8}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                        <MaterialIcons
                          name="location-city"
                          size={18}
                          color={exportBarangay === 'ALL' ? '#1E40AF' : '#059669'}
                        />
                        <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#1E293B' }} numberOfLines={1}>
                          {exportBarangay === 'ALL'
                            ? `All Barangays (${dynamicBarangays.length} registered)`
                            : `Brgy. ${exportBarangay}`}
                        </Text>
                      </View>
                      <MaterialIcons
                        name={isExportBarangayDropdownOpen ? 'arrow-drop-up' : 'arrow-drop-down'}
                        size={22}
                        color="#64748B"
                      />
                    </TouchableOpacity>

                    {/* Backdrop to close dropdown when clicking outside */}
                    {isExportBarangayDropdownOpen && (
                      <TouchableOpacity
                        style={{
                          position: 'fixed' as any,
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          zIndex: 990,
                        }}
                        activeOpacity={1}
                        onPress={() => setIsExportBarangayDropdownOpen(false)}
                      />
                    )}

                    {isExportBarangayDropdownOpen && (
                      <View
                        style={{
                          position: 'absolute',
                          top: 48,
                          left: 0,
                          right: 0,
                          backgroundColor: '#FFFFFF',
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#CBD5E1',
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 8 },
                          shadowOpacity: 0.18,
                          shadowRadius: 14,
                          elevation: 50,
                          maxHeight: 190,
                          zIndex: 1000,
                        }}
                      >
                        <ScrollView nestedScrollEnabled style={{ maxHeight: 190, backgroundColor: '#FFFFFF' }}>
                          <TouchableOpacity
                            style={{
                              paddingHorizontal: 14,
                              paddingVertical: 10,
                              borderBottomWidth: 1,
                              borderBottomColor: '#F1F5F9',
                              backgroundColor: exportBarangay === 'ALL' ? '#EFF6FF' : '#FFFFFF',
                            }}
                            onPress={() => {
                              setExportBarangay('ALL');
                              setIsExportBarangayDropdownOpen(false);
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: '800',
                                color: exportBarangay === 'ALL' ? '#1D4ED8' : '#1E293B',
                              }}
                            >
                              All Barangays (Complete City Schedule)
                            </Text>
                          </TouchableOpacity>

                          {dynamicBarangays.map((b) => (
                            <TouchableOpacity
                              key={b}
                              style={{
                                paddingHorizontal: 14,
                                paddingVertical: 10,
                                borderBottomWidth: 1,
                                borderBottomColor: '#F8FAFC',
                                backgroundColor: exportBarangay === b ? '#ECFDF5' : '#FFFFFF',
                              }}
                              onPress={() => {
                                setExportBarangay(b);
                                setIsExportBarangayDropdownOpen(false);
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 13,
                                  fontWeight: exportBarangay === b ? '800' : '600',
                                  color: exportBarangay === b ? '#059669' : '#334155',
                                }}
                              >
                                Brgy. {b}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Filter 2: Collection Day (Wrapping Responsive Chips - Multi-Select) */}
              <View style={{ marginBottom: 14, position: 'relative', zIndex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={[styles.inputLabel, { marginBottom: 0 }]}>DAY FILTER</Text>
                  {exportDays.length > 0 && !exportDays.includes('ALL') && (
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#059669' }}>
                      {exportDays.length} {exportDays.length === 1 ? 'day' : 'days'} selected
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {['ALL', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => {
                    const active = isExportDayActive(d);
                    return (
                      <TouchableOpacity
                        key={d}
                        style={[
                          {
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: active ? '#059669' : '#E2E8F0',
                            backgroundColor: active ? '#ECFDF5' : '#FFFFFF',
                          },
                        ]}
                        onPress={() => handleToggleExportDay(d)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={{
                            fontSize: 11.5,
                            fontWeight: active ? '800' : '600',
                            color: active ? '#059669' : '#64748B',
                          }}
                        >
                          {d === 'ALL' ? 'All Days' : d}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Filter 3: Waste Category */}
              <View style={{ marginBottom: 14, position: 'relative', zIndex: 1 }}>
                <Text style={styles.inputLabel}>WASTE CATEGORY FILTER</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {['ALL', 'BIODEGRADABLE', 'NON-BIODEGRADABLE', 'RECYCLABLE', 'SPECIAL'].map((c) => {
                    const active = exportCategory === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[
                          {
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: active ? '#059669' : '#E2E8F0',
                            backgroundColor: active ? '#ECFDF5' : '#FFFFFF',
                          },
                        ]}
                        onPress={() => setExportCategory(c)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={{
                            fontSize: 11.5,
                            fontWeight: active ? '800' : '600',
                            color: active ? '#059669' : '#64748B',
                          }}
                        >
                          {c === 'ALL' ? 'All Categories' : c}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Option: Include Specific Pickups */}
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingVertical: 6,
                  marginBottom: 14,
                }}
                onPress={() => setIncludeSpecificInExport(!includeSpecificInExport)}
                activeOpacity={0.7}
              >
                <MaterialIcons
                  name={includeSpecificInExport ? 'check-box' : 'check-box-outline-blank'}
                  size={20}
                  color={includeSpecificInExport ? '#059669' : '#94A3B8'}
                />
                <Text style={{ fontSize: 12.5, color: '#334155', fontWeight: '600', flexShrink: 1 }}>
                  Include Specific / Special Date-Time Pickup details in export
                </Text>
              </TouchableOpacity>

              {/* Export File Format Selector (Excel vs CSV vs PDF) */}
              <View style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={[styles.inputLabel, { marginBottom: 0 }]}>EXPORT FORMAT</Text>
                  <View style={styles.analystBadge}>
                    <MaterialIcons name="auto-awesome" size={12} color="#059669" />
                    <Text style={styles.analystBadgeText}>ANALYST READY</Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'column', gap: 8 }}>
                  {/* Excel Option */}
                  <TouchableOpacity
                    style={[
                      styles.exportFormatCardRow,
                      exportFormat === 'xlsx' && styles.exportFormatCardRowActive,
                    ]}
                    onPress={() => setExportFormat('xlsx')}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 8 }}>
                      <View
                        style={[
                          styles.exportFormatIconWrap,
                          { backgroundColor: exportFormat === 'xlsx' ? '#DCFCE7' : '#F1F5F9' },
                        ]}
                      >
                        <MaterialIcons
                          name="table-chart"
                          size={20}
                          color={exportFormat === 'xlsx' ? '#059669' : '#166534'}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.exportFormatTitle,
                            exportFormat === 'xlsx' && styles.exportFormatTitleActive,
                          ]}
                        >
                          Excel Workbook (.xlsx)
                        </Text>
                        <Text style={styles.exportFormatDesc} numberOfLines={2}>
                          Pre-configured with Excel AutoFilter dropdowns, auto-fit column widths, and Executive KPI Summary sheet.
                        </Text>
                      </View>
                    </View>
                    <View
                      style={[
                        styles.exportRadioOuter,
                        exportFormat === 'xlsx' && styles.exportRadioOuterActive,
                      ]}
                    >
                      {exportFormat === 'xlsx' && <View style={styles.exportRadioInner} />}
                    </View>
                  </TouchableOpacity>

                  {/* CSV Option */}
                  <TouchableOpacity
                    style={[
                      styles.exportFormatCardRow,
                      exportFormat === 'csv' && styles.exportFormatCardRowActive,
                    ]}
                    onPress={() => setExportFormat('csv')}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 8 }}>
                      <View
                        style={[
                          styles.exportFormatIconWrap,
                          { backgroundColor: exportFormat === 'csv' ? '#E0F2FE' : '#F1F5F9' },
                        ]}
                      >
                        <MaterialIcons
                          name="description"
                          size={20}
                          color={exportFormat === 'csv' ? '#0284C7' : '#475569'}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.exportFormatTitle,
                            exportFormat === 'csv' && styles.exportFormatTitleActive,
                          ]}
                        >
                          Standard CSV (.csv)
                        </Text>
                        <Text style={styles.exportFormatDesc} numberOfLines={2}>
                          Clean UTF-8 BOM comma-separated table formatted for Python (Pandas), R, SQL, and BI pipelines.
                        </Text>
                      </View>
                    </View>
                    <View
                      style={[
                        styles.exportRadioOuter,
                        exportFormat === 'csv' && styles.exportRadioOuterActive,
                      ]}
                    >
                      {exportFormat === 'csv' && <View style={styles.exportRadioInner} />}
                    </View>
                  </TouchableOpacity>

                  {/* PDF Option */}
                  <TouchableOpacity
                    style={[
                      styles.exportFormatCardRow,
                      exportFormat === 'pdf' && styles.exportFormatCardRowActive,
                    ]}
                    onPress={() => setExportFormat('pdf')}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 8 }}>
                      <View
                        style={[
                          styles.exportFormatIconWrap,
                          { backgroundColor: exportFormat === 'pdf' ? '#FEE2E2' : '#F1F5F9' },
                        ]}
                      >
                        <MaterialIcons
                          name="picture-as-pdf"
                          size={20}
                          color={exportFormat === 'pdf' ? '#DC2626' : '#991B1B'}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.exportFormatTitle,
                            exportFormat === 'pdf' && styles.exportFormatTitleActive,
                          ]}
                        >
                          Official PDF Report (.pdf)
                        </Text>
                        <Text style={styles.exportFormatDesc} numberOfLines={2}>
                          Print-ready municipal schedule document with CENRO Danao City letterhead, route details, and signatures.
                        </Text>
                      </View>
                    </View>
                    <View
                      style={[
                        styles.exportRadioOuter,
                        exportFormat === 'pdf' && styles.exportRadioOuterActive,
                      ]}
                    >
                      {exportFormat === 'pdf' && <View style={styles.exportRadioInner} />}
                    </View>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Summary Box */}
              <View style={styles.exportSummaryBox}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exportSummaryCount}>
                    {exportMatchingSchedules.length} Schedule(s) Selected
                  </Text>
                  <Text style={styles.exportSummarySub}>
                    {isCoordinator
                      ? `Scoped exclusively to Brgy. ${assignedBarangay || 'Your Barangay'}`
                      : exportBarangay === 'ALL'
                      ? `Covering all ${new Set(exportMatchingSchedules.map((s) => s.barangayName)).size} matching barangay(s)`
                      : `Filtered to Brgy. ${exportBarangay}`}
                    {exportDays.length > 0 && !exportDays.includes('ALL')
                      ? ` • Days: ${exportDays.join(', ')}`
                      : ''}
                  </Text>
                </View>
                <View
                  style={{
                    backgroundColor: exportMatchingSchedules.length > 0 ? '#ECFDF5' : '#F1F5F9',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 6,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '800',
                      color: exportMatchingSchedules.length > 0 ? '#059669' : '#94A3B8',
                    }}
                  >
                    {exportMatchingSchedules.length > 0 ? 'READY' : 'EMPTY'}
                  </Text>
                </View>
              </View>
            </ScrollView>

            {/* Modal Actions - Fixed at Bottom */}
            <View style={[styles.exportModalFooter, isMobile && { paddingHorizontal: 16, paddingVertical: 12 }]}>
              <TouchableOpacity
                style={[styles.modalCancelBtn, isMobile && { flex: 1, alignItems: 'center', justifyContent: 'center' }]}
                onPress={() => setIsExportModalVisible(false)}
                disabled={isExporting}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalSaveBtn,
                  isMobile && { flex: 1.6, alignItems: 'center', justifyContent: 'center' },
                  exportMatchingSchedules.length === 0 && { opacity: 0.5, backgroundColor: '#94A3B8' },
                ]}
                onPress={executeExportData}
                disabled={isExporting || exportMatchingSchedules.length === 0}
                activeOpacity={0.8}
              >
                {isExporting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <MaterialIcons
                      name={
                        exportFormat === 'xlsx'
                          ? 'table-chart'
                          : exportFormat === 'pdf'
                          ? 'picture-as-pdf'
                          : 'description'
                      }
                      size={18}
                      color="#FFFFFF"
                    />
                    <Text style={[styles.modalSaveText, isMobile && { fontSize: 13 }]}>
                      Download {exportFormat === 'xlsx' ? 'Excel (.xlsx)' : exportFormat === 'pdf' ? 'PDF (.pdf)' : 'CSV (.csv)'}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  readOnlyHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderColor: '#FCD34D',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    gap: 6,
  },
  readOnlyHeaderBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 28,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 4,
  },
  headerDesc: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 20,
    maxWidth: 620,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },

  // Controls & Filters Bar
  controlsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    zIndex: 100,
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    flex: 1,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minWidth: 220,
    gap: 8,
  },
  searchInput: {
    fontSize: 13,
    color: '#0F172A',
    flex: 1,
    padding: 0,
  },
  filterDropdownWrapper: {
    position: 'relative',
    zIndex: 200,
  },
  filterDropdownBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
    minWidth: 140,
  },
  filterDropdownBtnActive: {
    borderColor: '#059669',
    backgroundColor: '#ECFDF5',
  },
  filterDropdownBtnText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
    flex: 1,
  },
  dropdownPopup: {
    position: 'absolute',
    top: 44,
    left: 0,
    minWidth: 220,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 1000,
    overflow: 'hidden',
  },
  dropdownSearchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#F8FAFC',
    gap: 6,
  },
  dropdownSearchInput: {
    fontSize: 12,
    color: '#0F172A',
    flex: 1,
    padding: 0,
  },
  dropdownPopupItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  dropdownPopupItemSelected: {
    backgroundColor: '#ECFDF5',
  },
  dropdownPopupItemText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '500',
  },

  viewModeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  viewModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  viewModeBtnActive: {
    backgroundColor: '#059669',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  viewModeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  viewModeBtnTextActive: {
    color: '#FFFFFF',
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  outlineBtnText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 13,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#1B4D3E',
    shadowColor: '#1B4D3E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },

  // Table Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
  },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  th: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  tableRowActive: {
    backgroundColor: '#F0FDF4',
  },
  td: {
    justifyContent: 'center',
  },

  avatarBadge: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#059669',
  },
  brgyName: {
    fontWeight: '800',
    color: '#0F172A',
    fontSize: 14,
  },
  brgyDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },

  dayBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  dayBadgeFinished: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
  },
  dayText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#047857',
  },
  dayTextFinished: {
    color: '#15803D',
    fontWeight: '900',
  },

  truckName: {
    fontWeight: '600',
    color: '#334155',
    fontSize: 13,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  activeStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  activeStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
  },
  activeStatusText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#047857',
  },

  actionIconBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconBtnDanger: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FEE2E2',
  },

  clearFiltersBtn: {
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  clearFiltersBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#059669',
  },

  // Accordion inside table
  accordionContainer: {
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  accordionBody: {
    backgroundColor: '#F8FAFC',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  streetContainer: {
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  streetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F1F5F9',
  },
  streetNameText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  streetDescText: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '600',
  },
  schedulesBody: {
    padding: 8,
  },
  scheduleItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  addStreetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#059669',
    borderStyle: 'dashed',
    borderRadius: 8,
    marginTop: 6,
    backgroundColor: '#ECFDF5',
  },
  addStreetBtnText: {
    color: '#059669',
    fontWeight: '800',
    fontSize: 13,
  },

  // Pagination
  pagination: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  pageInfo: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  pageControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pageBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pageBtnDisabled: {
    opacity: 0.5,
  },
  pageNum: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 9999,
    width: '100%',
    height: '100%',
    ...Platform.select({
      web: {
        position: 'fixed' as any,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw' as any,
        height: '100vh' as any,
      },
    }),
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 22,
    width: '100%',
    maxWidth: 720,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 14,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 18,
  },
  modalCloseBtn: {
    padding: 7,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },

  modalSectionCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 16,
  },
  modalSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  modalSectionBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },

  formGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  requiredAsterisk: {
    color: '#EF4444',
    fontWeight: '900',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  inputErrorBorder: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  fieldError: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },

  suggestionsContainer: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    marginTop: 6,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 5,
    zIndex: 9999,
  },
  suggestionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 6,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  suggestionsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  suggestionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginBottom: 3,
    backgroundColor: '#F8FAFC',
  },
  suggestionItemSelected: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  suggestionItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
  customBarangayItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 6,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },

  modalDaysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 4,
  },
  modalDay: {
    flex: 1,
    minWidth: 44,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDaySelected: {
    backgroundColor: '#1B4D3E',
    borderColor: '#1B4D3E',
  },
  modalDayText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  modalDayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  quickDayBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  quickDayBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },

  // Segmented Mode Switch for Time Configuration
  timeModeSegmentedContainer: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 9,
    padding: 3,
    marginBottom: 12,
  },
  timeModeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 7,
  },
  timeModeTabActive: {
    backgroundColor: '#1B4D3E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  timeModeTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  timeModeTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },

  // Uniform Time Hero Card
  uniformTimeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 16,
    marginBottom: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  uniformTimeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  uniformTimeIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  uniformTimeLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  uniformTimeBigText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 1,
  },
  clockPickerMainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1B4D3E',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    shadowColor: '#1B4D3E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  clockPickerMainBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12.5,
  },

  presetSection: {
    marginBottom: 12,
  },
  presetSectionLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 7,
  },
  presetPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  presetChipActive: {
    backgroundColor: '#1B4D3E',
    borderColor: '#1B4D3E',
  },
  presetChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#334155',
  },
  presetChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },

  scheduleCoverageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  scheduleCoverageText: {
    fontSize: 12,
    color: '#166534',
  },
  scheduleCoverageBannerEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  scheduleCoverageTextEmpty: {
    fontSize: 12,
    color: '#64748B',
    fontStyle: 'italic',
  },

  // Custom Day Card Styles
  customDaysHeaderDesc: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    flex: 1,
  },
  syncAllDaysLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  syncAllDaysLinkText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  daysTableContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  dayTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  dayTableRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dayTableRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayBadgeModern: {
    backgroundColor: '#1B4D3E',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    minWidth: 46,
    alignItems: 'center',
  },
  dayBadgeModernText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  dayFullName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  mobileTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  mobileTimeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  dayClockPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    height: 38,
  },
  dayClockPickerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },

  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  catBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  catBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#334155',
  },

  truckSuggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 8,
    padding: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  truckChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  truckChipActive: {
    backgroundColor: '#1B4D3E',
    borderColor: '#1B4D3E',
  },
  truckChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#065F46',
  },

  modalDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 14,
  },
  specificScheduleCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 6,
  },

  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 14,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  modalCancelText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 13.5,
  },
  modalSaveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 8,
    backgroundColor: '#1B4D3E',
    minWidth: 120,
    alignItems: 'center',
  },
  modalSaveText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13.5,
  },

  // Export Modal Container & Layout
  exportModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxWidth: 580,
    maxHeight: '92%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      },
      default: {
        elevation: 16,
      },
    }),
  },
  exportModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  exportModalScrollBody: {
    flex: 1,
    width: '100%',
  },
  exportModalScrollBodyContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  exportModalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },

  // Export Modal Scoping & Summary Styles
  exportScopeBannerCoord: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  exportScopeBannerCoordText: {
    fontSize: 12,
    color: '#166534',
    lineHeight: 18,
    flex: 1,
  },
  exportScopeBannerCenro: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  exportScopeBannerCenroText: {
    fontSize: 12,
    color: '#1E40AF',
    lineHeight: 18,
    flex: 1,
  },
  exportSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  exportSummaryCount: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  exportSummarySub: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },

  // Analyst Badge & Format Card Styles
  analystBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  analystBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.4,
  },
  exportFormatCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  exportFormatCardRowActive: {
    borderColor: '#059669',
    backgroundColor: '#F0FDF4',
  },
  exportFormatIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  exportRadioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    marginLeft: 10,
    flexShrink: 0,
  },
  exportRadioOuterActive: {
    borderColor: '#059669',
    backgroundColor: '#059669',
  },
  exportRadioInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  exportFormatCard: {
    flex: 1,
    padding: 13,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  exportFormatCardActive: {
    borderColor: '#059669',
    backgroundColor: '#F0FDF4',
  },
  exportFormatTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#334155',
  },
  exportFormatTitleActive: {
    color: '#065F46',
    fontWeight: '800',
  },
  exportFormatDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },
  fleetPickerCard: {
    marginTop: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    padding: 10,
  },
  fleetPickerSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  fleetSearchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 38,
  },
  fleetSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    paddingVertical: 0,
    height: '100%',
  },
  fleetClearSelectionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 8,
    height: 38,
    borderRadius: 8,
  },
  fleetClearSelectionText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#B91C1C',
  },
  fleetListContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 6,
  },
  fleetEmptyState: {
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fleetEmptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginTop: 6,
    textAlign: 'center',
  },
  fleetEmptySub: {
    fontSize: 11.5,
    color: '#94A3B8',
    marginTop: 3,
    textAlign: 'center',
    lineHeight: 16,
  },
  fleetSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 5,
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    marginBottom: 6,
  },
  fleetSectionHeaderTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  fleetItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    marginBottom: 6,
  },
  fleetItemCardSelected: {
    borderColor: '#059669',
    backgroundColor: '#F0FDF4',
  },
  fleetPlateText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  fleetTypeBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  fleetTypeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1D4ED8',
    textTransform: 'uppercase',
  },
  fleetStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  fleetStatusBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  fleetMetaText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  fleetSelectActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  fleetSelectedCheck: {
    backgroundColor: '#059669',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});


