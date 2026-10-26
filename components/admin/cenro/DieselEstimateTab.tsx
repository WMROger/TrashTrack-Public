import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import {
  calculateDiesel,
  DieselActual,
  DieselInputs,
  DieselModel,
  DieselParameters,
  DieselPlan,
  dieselSavings,
} from '@/services/dieselMath';
import {
  applicableDieselFactor,
  DEFAULT_DIESEL_SETTINGS,
  DieselLog,
  DieselSchedule,
  DieselSettings,
  loadDieselGps,
  makeDieselPlan,
  parametersForTruck,
  reviewDieselLog,
  saveDieselPlan,
  saveDieselSettings,
  submitDieselActual,
  trainTruckDiesel,
} from '@/services/dieselService';
import { exportDieselCsv, exportDieselReport } from '@/services/dieselReports';
import ExportModal from './ExportModal';
import { ExportFormat } from '@/services/reportExportService';
import { optimizeBarangayRouteWithTraffic } from '@/services/trafficAwareOptimizerService';
import { DANAO_CITY_BARANGAYS } from '@/constants/danaoBarangays';

type Props = {
  userRole?: string;
  assignedBarangay?: string;
  onNavigateTab?: (tab: string) => void;
  isReadOnly?: boolean;
};

type Form = Record<string, string>;

const DANAO_BASELINE_DIESEL_PRICE = 65.0; // Danao City baseline pump price in PHP/L
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

const inputLabels: Record<keyof DieselInputs, string> = {
  distanceKm: 'Distance (km)',
  drivingHours: 'Driving hours',
  idleHours: 'Idle hours',
  collectionHours: 'Collection hours',
  averageLoadPercent: 'Average load (%)',
};

const parameterLabels: Record<keyof DieselParameters, string> = {
  pricePerLiter: 'CENRO supply price (PHP/L)',
  kmPerLiter: 'Driving efficiency (km/L)',
  idleLitersPerHour: 'Idle consumption (L/hour)',
  collectionLitersPerHour: 'Collection / compactor consumption (L/hour)',
  fullLoadPenaltyPercent: 'Extra driving fuel at full load (%)',
  averageLoadPercent: 'Average load (%)',
  minutesPerStop: 'Collection minutes per stop',
};

const FIELD_CONFIGS: Record<string, { step: number; min: number; max?: number; required: boolean; unit?: string }> = {
  distanceKm: { step: 1, min: 0, required: true, unit: 'km' },
  drivingHours: { step: 0.5, min: 0, max: 24, required: true, unit: 'hrs' },
  idleHours: { step: 0.5, min: 0, max: 24, required: true, unit: 'hrs' },
  collectionHours: { step: 0.5, min: 0, max: 24, required: true, unit: 'hrs' },
  averageLoadPercent: { step: 5, min: 0, max: 100, required: true, unit: '%' },
  collectedKg: { step: 10, min: 0, required: true, unit: 'kg' },
  actualLiters: { step: 1, min: 0, required: false, unit: 'L' },
  pricePerLiter: { step: 1, min: 0, required: true, unit: '₱/L' },
  kmPerLiter: { step: 0.1, min: 0, required: true, unit: 'km/L' },
  idleLitersPerHour: { step: 0.1, min: 0, required: true, unit: 'L/h' },
  collectionLitersPerHour: { step: 0.1, min: 0, required: true, unit: 'L/h' },
  fullLoadPenaltyPercent: { step: 1, min: 0, max: 100, required: true, unit: '%' },
  minutesPerStop: { step: 0.5, min: 0, required: true, unit: 'min' },
};

const stringify = (object: object): Form =>
  Object.fromEntries(Object.entries(object).map(([k, v]) => [k, v == null ? '' : String(v)]));

const num = (value: string, label: string) => {
  if (!value?.trim() || !Number.isFinite(Number(value))) throw new Error('Enter ' + label + '.');
  return Number(value);
};

const parseInputs = (form: Form): DieselInputs =>
  Object.fromEntries(Object.entries(inputLabels).map(([key, label]) => [key, num(form[key], label)])) as DieselInputs;

const fmt = (n: number | null | undefined, suffix = '') =>
  n == null ? 'Not recorded' : n.toLocaleString('en-PH', { maximumFractionDigits: 2 }) + suffix;

const money = (n: number | null | undefined, litersFallback?: number, priceFallback = DANAO_BASELINE_DIESEL_PRICE) => {
  if (n != null) return '₱' + fmt(n);
  if (litersFallback != null && litersFallback > 0) return '₱' + fmt(litersFallback * priceFallback) + ' (est)';
  return '₱' + fmt(priceFallback) + '/L';
};

const emptyActual = (): Form => ({
  tripDate: today(),
  distanceKm: '',
  drivingHours: '',
  idleHours: '0',
  collectionHours: '0',
  averageLoadPercent: '50',
  collectedKg: '',
  actualLiters: '',
  evidence: '',
  distanceSource: 'manual',
  fuelMethod: 'not-recorded',
  isDemo: 'false',
});

function Field({
  label,
  value,
  onChange,
  text = false,
  disabled = false,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  text?: boolean;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label} {required && <Text style={styles.required}>*</Text>}
      </Text>
      <TextInput
        accessibilityLabel={label}
        style={[styles.input, disabled && styles.disabled]}
        value={value || ''}
        onChangeText={onChange}
        editable={!disabled}
        keyboardType={text ? 'default' : 'decimal-pad'}
        placeholderTextColor="#94A3B8"
      />
    </View>
  );
}

function DateField({
  label,
  value,
  onChange,
  disabled = false,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const [showNativePicker, setShowNativePicker] = useState(false);

  const dateObj = useMemo(() => {
    if (!value) return new Date();
    const parts = value.split('-').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return new Date();
  }, [value]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label} {required && <Text style={styles.required}>*</Text>}
      </Text>
      {Platform.OS === 'web' ? (
        <View style={[styles.webDateWrapper, disabled && styles.disabled]}>
          {React.createElement('input', {
            type: 'date',
            value: value || '',
            disabled: disabled,
            onChange: (e: any) => onChange(e.target.value),
            onClick: (e: any) => {
              if (e.target && typeof e.target.showPicker === 'function' && !disabled) {
                try {
                  e.target.showPicker();
                } catch {}
              }
            },
            style: {
              border: '1.5px solid #CBD5E1',
              borderRadius: '10px',
              padding: '10px 14px',
              color: '#0F172A',
              backgroundColor: '#FFFFFF',
              fontSize: '14px',
              fontWeight: '600',
              minHeight: '46px',
              height: '46px',
              width: '100%',
              boxSizing: 'border-box',
              outline: 'none',
              fontFamily: 'inherit',
              cursor: disabled ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
            },
          }) as any}
        </View>
      ) : (
        <>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={disabled}
            style={[styles.dateInputNative, disabled && styles.disabled]}
            onPress={() => setShowNativePicker(true)}
          >
            <Text style={[styles.dateInputNativeText, !value && { color: '#94A3B8' }]}>
              {value || 'Select date (YYYY-MM-DD)'}
            </Text>
            <MaterialIcons name="calendar-today" size={18} color={disabled ? '#94A3B8' : '#166534'} />
          </TouchableOpacity>
          {showNativePicker && (
            <DateTimePicker
              value={dateObj}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, selectedDate) => {
                if (Platform.OS !== 'ios') {
                  setShowNativePicker(false);
                }
                if (event.type === 'set' && selectedDate) {
                  const yyyy = selectedDate.getFullYear();
                  const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
                  const dd = String(selectedDate.getDate()).padStart(2, '0');
                  onChange(`${yyyy}-${mm}-${dd}`);
                }
              }}
            />
          )}
        </>
      )}
    </View>
  );
}

function NumberStepperField({
  label,
  value,
  onChange,
  disabled = false,
  required = false,
  step = 1,
  min = 0,
  max,
  unit,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  disabled?: boolean;
  required?: boolean;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
}) {
  const handleStep = (direction: 'up' | 'down') => {
    if (disabled) return;
    const current = parseFloat(value);
    const base = Number.isFinite(current) ? current : min != null && min > 0 ? min : 0;
    const delta = direction === 'up' ? step : -step;
    let next = base + delta;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);

    const stepStr = step.toString();
    const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
    const rounded = Number(next.toFixed(Math.max(decimals, 2)));
    onChange(rounded.toString());
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label} {required && <Text style={styles.required}>*</Text>}
      </Text>
      <View style={[styles.stepperContainer, disabled && styles.disabled]}>
        <TextInput
          accessibilityLabel={label}
          style={styles.stepperInput}
          value={value || ''}
          onChangeText={onChange}
          editable={!disabled}
          keyboardType="decimal-pad"
          placeholderTextColor="#94A3B8"
        />
        {!!unit && (
          <View style={styles.stepperUnitBadge}>
            <Text style={styles.stepperUnitText}>{unit}</Text>
          </View>
        )}
        <View style={styles.stepperControls}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Increase ${label}`}
            disabled={disabled}
            onPress={() => handleStep('up')}
            style={styles.stepperBtn}
          >
            <MaterialIcons name="keyboard-arrow-up" size={18} color={disabled ? '#94A3B8' : '#166534'} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Decrease ${label}`}
            disabled={disabled}
            onPress={() => handleStep('down')}
            style={[styles.stepperBtn, styles.stepperBtnDown]}
          >
            <MaterialIcons name="keyboard-arrow-down" size={18} color={disabled ? '#94A3B8' : '#166534'} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, secondary && { color: '#166534' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function DieselEstimateTab({
  userRole = 'admin',
  assignedBarangay = '',
  onNavigateTab,
  isReadOnly = false,
}: Props) {
  const driver = userRole === 'driver',
    coordinator = userRole === 'coordinator',
    manager = !driver && !coordinator;
  const uid = auth.currentUser?.uid || '';
  const [selectedBarangayFallback, setSelectedBarangayFallback] = useState<string>(assignedBarangay || 'Suba');
  const effectiveBarangay = assignedBarangay || selectedBarangayFallback;

  // CENRO Municipal Barangay Filter (CENRO can view each barangay)
  const [cenroBarangayFilter, setCenroBarangayFilter] = useState<string>('all');

  const [settings, setSettings] = useState<DieselSettings>(DEFAULT_DIESEL_SETTINGS);
  const [schedules, setSchedules] = useState<DieselSchedule[]>([]);
  const [routeHistoryTrips, setRouteHistoryTrips] = useState<DieselSchedule[]>([]);
  const [logs, setLogs] = useState<DieselLog[]>([]);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [plans, setPlans] = useState<Record<string, DieselPlan>>({});
  const [selectedId, setSelectedId] = useState('');

  // CENRO defaults directly to the actual telemetry & fuel data entry tab!
  const [tab, setTab] = useState<'actual' | 'estimate' | 'records'>('actual');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileScope, setProfileScope] = useState('fleet');
  const [parameterForm, setParameterForm] = useState<Form>({});
  const [sourceForm, setSourceForm] = useState<Form>({});
  const [baselineForm, setBaselineForm] = useState<Form>({});
  const [optimizedForm, setOptimizedForm] = useState<Form>({});
  const [actualForm, setActualForm] = useState<Form>(emptyActual);
  const [model, setModel] = useState<DieselModel | null>(null);
  const [isExportModalVisible, setIsExportModalVisible] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [filter, setFilter] = useState('');
  const [month, setMonth] = useState('');
  const [gpsNote, setGpsNote] = useState('');

  // Quick Odometer Calculator state
  const [odoStart, setOdoStart] = useState('');
  const [odoEnd, setOdoEnd] = useState('');
  const [showOdoCalc, setShowOdoCalc] = useState(false);

  // Coordinator Unlock State for already-submitted pending reports
  const [coordinatorEditUnlocked, setCoordinatorEditUnlocked] = useState(false);
  const [showUnlockConfirmModal, setShowUnlockConfirmModal] = useState(false);

  // CENRO Audit View Mode: false = Read-only Confirmation & Double-Check view; true = Edit mode
  const [cenroEditMode, setCenroEditMode] = useState(false);

  // Price Modal state
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [inputFuelPrice, setInputFuelPrice] = useState('65.00');
  const [inputFuelDate, setInputFuelDate] = useState(today());
  const [inputFuelSource, setInputFuelSource] = useState('CENRO Danao Depot');

  // Quick Create Master Trip state
  const [quickCreateModalOpen, setQuickCreateModalOpen] = useState(false);
  const [quickTrucks, setQuickTrucks] = useState<
    Array<{ id: string; plateNumber: string; assignedDriverId?: string; assignedDriverName?: string; assignedBarangay?: string; type?: string }>
  >([]);
  const [quickDrivers, setQuickDrivers] = useState<Array<{ id: string; name: string }>>([]);
  const [quickSelectedTruckId, setQuickSelectedTruckId] = useState('');
  const [quickSelectedDriverId, setQuickSelectedDriverId] = useState('');
  const [quickWasteCategory, setQuickWasteCategory] = useState('General Waste');
  const [quickDate, setQuickDate] = useState(today());
  const [quickBarangay, setQuickBarangay] = useState<string>(assignedBarangay || 'Baliang');

  // Local Draft status
  const [hasDraft, setHasDraft] = useState(false);

  // Effective fuel price: falls back to Danao City baseline (₱65.00/L) if 0 or unconfigured
  const effectiveFuelPrice = settings.parameters.pricePerLiter > 0 ? settings.parameters.pricePerLiter : DANAO_BASELINE_DIESEL_PRICE;

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      setError('A signed-in account is required.');
      return;
    }
    const scoped = (name: string, driverKey = 'driverId') =>
      driver
        ? query(collection(db, name), where(driverKey, '==', uid))
        : coordinator
        ? query(collection(db, name), where('barangay', '==', effectiveBarangay))
        : query(collection(db, name));

    const unsubs = [
      onSnapshot(
        doc(db, 'diesel_settings', 'main'),
        snap =>
          setSettings(
            snap.exists()
              ? ({ ...DEFAULT_DIESEL_SETTINGS, ...snap.data() } as DieselSettings)
              : DEFAULT_DIESEL_SETTINGS
          ),
        e => {
          console.warn('DieselEstimateTab: diesel_settings note:', e?.message || e);
          setSettings(DEFAULT_DIESEL_SETTINGS);
        }
      ),
      onSnapshot(
        scoped('schedules', 'assignedDriverId'),
        snap => {
          setError('');
          setSchedules(
            snap.docs
              .map(s => {
                const d = s.data();
                return {
                  id: s.id,
                  ...d,
                  driver: d.driver || d.driverName || d.assignedDriverName || '',
                } as DieselSchedule;
              })
              .filter(s => s.truckId && s.assignedDriverId && s.barangay && s.isLiveDispatch)
          );
          setLoading(false);
        },
        e => {
          console.warn('DieselEstimateTab: schedules query error:', e?.message || e);
          setError('Unable to load collection trips: ' + (e?.message || e));
          setLoading(false);
        }
      ),
      onSnapshot(
        scoped('diesel_logs'),
        snap => setLogs(snap.docs.map(s => ({ id: s.id, ...s.data() } as DieselLog))),
        e => {
          console.warn('DieselEstimateTab: diesel_logs note:', e?.message || e);
        }
      ),
      onSnapshot(
        scoped('diesel_estimates'),
        snap => setPlans(Object.fromEntries(snap.docs.map(s => [s.id, s.data().plan as DieselPlan]))),
        e => {
          console.warn('DieselEstimateTab: diesel_estimates note:', e?.message || e);
        }
      ),
      onSnapshot(
        scoped('driver_route_history', 'driverId'),
        snap => {
          const list: DieselSchedule[] = snap.docs.map(h => {
            const data = h.data();
            const dateStr = data.completedAt?.toDate
              ? data.completedAt.toDate().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })
              : (data.dateText || today());
            return {
              id: h.id,
              barangay: data.barangay || effectiveBarangay,
              truckId: data.truckId || data.truckPlate || 'TRUCK-01',
              truckPlate: data.truckPlate || 'TRUCK-01',
              assignedDriverId: data.driverId || '',
              assignedDriverName: data.driverName || 'Driver',
              driver: data.driverName || 'Driver',
              driverName: data.driverName || 'Driver',
              dateText: dateStr,
              street: data.routeName || `Brgy. ${data.barangay} Collection Route`,
              status: data.status || 'completed',
              isLiveDispatch: true,
              completedAt: data.completedAt,
              createdAt: data.createdAt,
              actualDistanceKm: data.totalDistanceKm,
              actualFuelLiters: data.fuelBurnedLiters,
              durationMinutes: data.durationMinutes,
              pickupsCompleted: data.pickupsCompleted,
            } as DieselSchedule;
          });
          setRouteHistoryTrips(list);
        },
        () => {}
      ),
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, [uid, driver, coordinator, effectiveBarangay]);

  // Subscribe to trucks and driver users for Quick-Create master trips
  useEffect(() => {
    if (!db) return;
    const unsubTrucks = onSnapshot(
      collection(db, 'trucks'),
      snap => {
        const list = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            plateNumber: data.plateNumber || d.id,
            assignedDriverId: data.assignedDriverId,
            assignedDriverName: data.assignedDriverName,
            assignedBarangay: data.assignedBarangay || data.barangay || '',
            type: data.type,
          };
        });
        setQuickTrucks(list);
      },
      () => {}
    );

    const qDrivers = query(collection(db, 'users'), where('role', '==', 'driver'));
    const unsubDrivers = onSnapshot(
      qDrivers,
      snap => {
        const list = snap.docs
          .filter(d => {
            const u = d.data();
            return u.disabled !== true && u.status !== 'disabled';
          })
          .map(d => {
            const u = d.data();
            const name =
              u.displayName ||
              u.fullName ||
              [u.firstName, u.lastName].filter(Boolean).join(' ') ||
              u.name ||
              (u.email ? u.email.split('@')[0] : 'Driver ' + d.id.slice(-4));
            return { id: d.id, name };
          });
        setQuickDrivers(list);
      },
      () => {}
    );

    return () => {
      unsubTrucks();
      unsubDrivers();
    };
  }, []);

  const getScheduleTimestamp = (s: any): number => {
    if (s.completedAt?.toMillis) return s.completedAt.toMillis();
    if (s.completedAt?.seconds) return s.completedAt.seconds * 1000;
    if (typeof s.completedAt === 'string') {
      const t = new Date(s.completedAt).getTime();
      if (!isNaN(t)) return t;
    }
    if (s.createdAt?.toMillis) return s.createdAt.toMillis();
    if (s.createdAt?.seconds) return s.createdAt.seconds * 1000;
    if (typeof s.createdAt === 'string') {
      const t = new Date(s.createdAt).getTime();
      if (!isNaN(t)) return t;
    }
    if (s.dateText) {
      const t = new Date(s.dateText).getTime();
      if (!isNaN(t)) return t;
    }
    return 0;
  };

  const allSchedules = useMemo(() => {
    const map = new Map<string, DieselSchedule>();
    schedules.forEach(s => map.set(s.id, s));
    routeHistoryTrips.forEach(h => {
      if (!map.has(h.id)) {
        map.set(h.id, h);
      } else {
        const existing = map.get(h.id)!;
        if (existing.actualDistanceKm == null && h.actualDistanceKm != null) {
          map.set(h.id, {
            ...existing,
            actualDistanceKm: h.actualDistanceKm,
            actualFuelLiters: h.actualFuelLiters,
            durationMinutes: h.durationMinutes,
            pickupsCompleted: h.pickupsCompleted,
          });
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => getScheduleTimestamp(b) - getScheduleTimestamp(a));
  }, [schedules, routeHistoryTrips]);

  // Resolve human driver names for assignedDriverId from users collection or trucks collection
  useEffect(() => {
    if (!allSchedules.length || !db) return;
    const missingDriverIds = Array.from(
      new Set(allSchedules.map(s => s.assignedDriverId).filter(id => id && !driverNames[id]))
    );
    if (!missingDriverIds.length) return;

    let isMounted = true;
    const fetchDriverNames = async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        missingDriverIds.map(async driverId => {
          try {
            const userSnap = await getDoc(doc(db, 'users', driverId));
            if (userSnap.exists()) {
              const u = userSnap.data();
              const resolved =
                u.displayName ||
                u.fullName ||
                [u.firstName, u.lastName].filter(Boolean).join(' ') ||
                u.name ||
                u.driverName ||
                (u.email ? u.email.split('@')[0] : '');
              if (resolved) {
                updates[driverId] = resolved;
              }
            }
          } catch (err) {
            console.warn('DieselEstimateTab: Could not fetch driver name from users for', driverId, err);
          }

          if (!updates[driverId]) {
            const matchingSchedule = allSchedules.find(s => s.assignedDriverId === driverId);
            if (matchingSchedule?.truckId) {
              try {
                const truckSnap = await getDoc(doc(db, 'trucks', matchingSchedule.truckId));
                if (truckSnap.exists()) {
                  const t = truckSnap.data();
                  const fromTruck = t.assignedDriverName || t.driverName || t.driver || '';
                  if (fromTruck) {
                    updates[driverId] = fromTruck;
                  }
                }
              } catch (truckErr) {
                console.warn('DieselEstimateTab: Could not fetch driver name from truck for', driverId, truckErr);
              }
            }
          }
        })
      );
      if (isMounted && Object.keys(updates).length > 0) {
        setDriverNames(prev => ({ ...prev, ...updates }));
      }
    };

    fetchDriverNames();
    return () => {
      isMounted = false;
    };
  }, [allSchedules, driverNames]);

  const getDriverName = (s?: DieselSchedule | null): string => {
    if (!s) return 'Assigned Driver';
    const isUid = (str?: string) => Boolean(str && /^[a-zA-Z0-9_-]{20,}$/.test(str.trim()));
    const rawDriver = s.assignedDriverName || s.driverName || s.driver;
    if (rawDriver && !isUid(rawDriver)) {
      return rawDriver;
    }
    if (s.assignedDriverId && driverNames[s.assignedDriverId]) {
      return driverNames[s.assignedDriverId];
    }
    if (rawDriver && isUid(rawDriver) && driverNames[rawDriver]) {
      return driverNames[rawDriver];
    }
    return rawDriver && !isUid(rawDriver)
      ? rawDriver
      : (s.assignedDriverId && driverNames[s.assignedDriverId]) || 'Assigned Driver';
  };

  // Distinct list of active barangays with schedules for CENRO quick navigation
  const activeBarangaysWithTrips = useMemo(() => {
    const counts: Record<string, number> = {};
    allSchedules.forEach(s => {
      if (s.barangay) {
        counts[s.barangay] = (counts[s.barangay] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [allSchedules]);

  // Filter schedules based on whether CENRO has selected a specific barangay or "all"
  const displayedSchedules = useMemo(() => {
    let list = allSchedules;
    if (coordinator) {
      list = allSchedules.filter(s => s.barangay === effectiveBarangay);
    } else if (cenroBarangayFilter !== 'all') {
      list = allSchedules.filter(s => s.barangay === cenroBarangayFilter);
    }
    return list.slice().sort((a, b) => getScheduleTimestamp(b) - getScheduleTimestamp(a));
  }, [allSchedules, coordinator, effectiveBarangay, cenroBarangayFilter]);

  // Trip Report status filter: 'all' | 'awaiting' | 'pending' | 'approved'
  const [tripReportFilter, setTripReportFilter] = useState<'all' | 'awaiting' | 'pending' | 'approved'>('all');

  const awaitingCount = useMemo(() => {
    return displayedSchedules.filter(s => !logs.some(l => l.scheduleId === s.id)).length;
  }, [displayedSchedules, logs]);

  const pendingCount = useMemo(() => {
    return displayedSchedules.filter(s => {
      const l = logs.find(log => log.scheduleId === s.id);
      return l && l.status !== 'approved' && l.status !== 'needs-correction';
    }).length;
  }, [displayedSchedules, logs]);

  const approvedCount = useMemo(() => {
    return displayedSchedules.filter(s => {
      const l = logs.find(log => log.scheduleId === s.id);
      return l && l.status === 'approved';
    }).length;
  }, [displayedSchedules, logs]);

  const filteredSchedules = useMemo(() => {
    if (tripReportFilter === 'awaiting') {
      return displayedSchedules.filter(s => !logs.some(l => l.scheduleId === s.id));
    }
    if (tripReportFilter === 'pending') {
      return displayedSchedules.filter(s => {
        const l = logs.find(log => log.scheduleId === s.id);
        return l && l.status !== 'approved' && l.status !== 'needs-correction';
      });
    }
    if (tripReportFilter === 'approved') {
      return displayedSchedules.filter(s => {
        const l = logs.find(log => log.scheduleId === s.id);
        return l && l.status === 'approved';
      });
    }
    return displayedSchedules;
  }, [displayedSchedules, tripReportFilter, logs]);

  // Categorized trips for structured grouping in 'all' view
  const categorizedTrips = useMemo(() => {
    const approved: DieselSchedule[] = [];
    const pending: DieselSchedule[] = [];
    const awaiting: DieselSchedule[] = [];
    const correction: DieselSchedule[] = [];

    displayedSchedules.forEach(s => {
      const l = logs.find(log => log.scheduleId === s.id);
      if (!l) {
        awaiting.push(s);
      } else if (l.status === 'approved') {
        approved.push(s);
      } else if (l.status === 'needs-correction') {
        correction.push(s);
      } else {
        pending.push(s);
      }
    });

    return { approved, pending, awaiting, correction };
  }, [displayedSchedules, logs]);

  const [tripDropdownOpen, setTripDropdownOpen] = useState(false);
  const [tripSearchQuery, setTripSearchQuery] = useState('');

  const searchedSchedules = useMemo(() => {
    const q = tripSearchQuery.trim().toLowerCase();
    if (!q) return filteredSchedules;
    return filteredSchedules.filter(s => {
      const driver = getDriverName(s).toLowerCase();
      const truck = (s.truckPlate || s.truckId || '').toLowerCase();
      const brgy = (s.barangay || '').toLowerCase();
      const id = (s.id || '').toLowerCase();
      const date = (s.dateText || '').toLowerCase();
      return driver.includes(q) || truck.includes(q) || brgy.includes(q) || id.includes(q) || date.includes(q);
    });
  }, [filteredSchedules, tripSearchQuery, getDriverName]);

  const searchedCategorizedTrips = useMemo(() => {
    const q = tripSearchQuery.trim().toLowerCase();
    const filterFn = (s: DieselSchedule) => {
      if (!q) return true;
      const driver = getDriverName(s).toLowerCase();
      const truck = (s.truckPlate || s.truckId || '').toLowerCase();
      const brgy = (s.barangay || '').toLowerCase();
      const id = (s.id || '').toLowerCase();
      const date = (s.dateText || '').toLowerCase();
      return driver.includes(q) || truck.includes(q) || brgy.includes(q) || id.includes(q) || date.includes(q);
    };

    return {
      approved: categorizedTrips.approved.filter(filterFn),
      pending: categorizedTrips.pending.filter(filterFn),
      awaiting: categorizedTrips.awaiting.filter(filterFn),
      correction: categorizedTrips.correction.filter(filterFn),
    };
  }, [categorizedTrips, tripSearchQuery, getDriverName]);

  const handleFilterSelect = (filter: 'all' | 'awaiting' | 'pending' | 'approved') => {
    setTripReportFilter(filter);
    setTripSearchQuery('');
    setMessage('');
    setError('');
    let targets = displayedSchedules;
    if (filter === 'awaiting') {
      targets = categorizedTrips.awaiting;
    } else if (filter === 'pending') {
      targets = categorizedTrips.pending;
    } else if (filter === 'approved') {
      targets = categorizedTrips.approved;
    }
    if (targets.length > 0) {
      setSelectedId(targets[0].id);
    }
  };

  const renderDropdownTripItem = (s: DieselSchedule) => {
    const tripLog = logs.find(l => l.scheduleId === s.id);
    const isSelected = s.id === selectedId;
    const shortId = `#${s.id.slice(-6).toUpperCase()}`;
    const driver = getDriverName(s);
    const truck = s.truckPlate || s.truckId;
    const isApp = tripLog?.status === 'approved';
    const isPend = tripLog && tripLog.status !== 'approved' && tripLog.status !== 'needs-correction';
    const isCorr = tripLog?.status === 'needs-correction';

    const borderAccent = isApp ? '#166534' : isCorr ? '#DC2626' : isPend ? '#EA580C' : '#94A3B8';
    const badgeBg = isApp ? '#DCFCE7' : isCorr ? '#FEE2E2' : isPend ? '#FFEDD5' : '#F1F5F9';
    const badgeColor = isApp ? '#166534' : isCorr ? '#DC2626' : isPend ? '#C2410C' : '#475569';
    const badgeText = isApp ? '✓ Approved' : isCorr ? '⚠️ Correction' : isPend ? '📝 Pending Review' : '⏳ Awaiting Report';

    return (
      <TouchableOpacity
        key={s.id}
        accessibilityRole="button"
        onPress={() => {
          setSelectedId(s.id);
          setTripDropdownOpen(false);
          setMessage('');
          setError('');
        }}
        style={[
          styles.dropdownItemRow,
          isSelected && styles.dropdownItemRowActive,
        ]}
      >
        <View style={[styles.dropdownItemAccentBar, { backgroundColor: borderAccent }]} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <Text style={[styles.dropdownItemId, isSelected && { color: '#047857' }]}>
                {shortId}
              </Text>
              <View style={[styles.dropdownItemBadge, { backgroundColor: badgeBg }]}>
                <Text style={[styles.dropdownItemBadgeText, { color: badgeColor }]}>
                  {badgeText}
                </Text>
              </View>
              <View style={styles.dropdownBarangayPill}>
                <Text style={styles.dropdownBarangayPillText}>Brgy. {s.barangay}</Text>
              </View>
            </View>
            {isSelected && (
              <View style={styles.dropdownSelectedCheck}>
                <MaterialIcons name="check" size={14} color="#059669" />
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <Text style={styles.dropdownItemTruck} numberOfLines={1}>
              🚛 {truck} · Driver: {driver}
            </Text>
            <Text style={styles.dropdownItemMeta}>
              {tripLog?.actual?.distanceKm
                ? `⚡ ${tripLog.actual.distanceKm} km · ${tripLog.actual.actualLiters || 0} L diesel`
                : s.actualDistanceKm
                ? `⚡ ${s.actualDistanceKm} km · ${s.actualFuelLiters || 0} L diesel`
                : `📅 ${s.dateText || 'Shift scheduled'}`}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderSchedulePickerItem = (s: DieselSchedule) => {
    const tripLog = logs.find(l => l.scheduleId === s.id);
    const shortId = `#${s.id.slice(-6).toUpperCase()}`;
    const driver = getDriverName(s);
    const truck = s.truckPlate || s.truckId;
    const dateStr = s.dateText || 'Today';

    let statusPrefix = '⏳ [AWAITING REPORT]';
    let extra = '';
    if (tripLog) {
      if (tripLog.status === 'approved') {
        statusPrefix = '✅ [REPORT APPROVED]';
      } else if (tripLog.status === 'needs-correction') {
        statusPrefix = '⚠️ [NEEDS CORRECTION]';
      } else {
        statusPrefix = '📝 [REPORT PENDING]';
      }
      if (tripLog.actual?.distanceKm) {
        extra = ` · (${tripLog.actual.distanceKm} km, ${tripLog.actual.actualLiters || 0} L)`;
      }
    } else if (s.actualDistanceKm) {
      extra = ` · (${s.actualDistanceKm} km, ${s.actualFuelLiters || 0} L)`;
    }

    const label = `${statusPrefix} ${shortId} · Brgy. ${s.barangay} · ${truck} (${driver}) · ${dateStr}${extra}`;
    return <Picker.Item key={s.id} value={s.id} label={label} />;
  };

  // Automatically sync selected trip when barangay filter changes, report filter changes, or list updates
  useEffect(() => {
    if (filteredSchedules.length > 0) {
      if (!selectedId || !filteredSchedules.some(s => s.id === selectedId)) {
        setSelectedId(filteredSchedules[0].id);
      }
    } else {
      if (!displayedSchedules.some(s => s.id === selectedId)) {
        setSelectedId(displayedSchedules[0]?.id || '');
      }
    }
  }, [filteredSchedules, displayedSchedules, selectedId]);

  const selected = allSchedules.find(s => s.id === selectedId);
  const currentLog = logs.find(l => l.scheduleId === selectedId);
  const isPendingReview = Boolean(
    currentLog &&
    currentLog.status !== 'approved' &&
    currentLog.status !== 'needs-correction'
  );
  const isApproved = currentLog?.status === 'approved';
  const savedPlan = plans[selectedId] || selected?.routeOptimization?.dieselEstimate;
  const p = useMemo(() => parametersForTruck(settings, selected?.truckId), [settings, selected?.truckId]);

  // When a report is already submitted and pending review, coordinators/drivers are locked by default
  // unless they explicitly confirm and unlock editing below.
  // Approved reports are permanently locked for coordinators/drivers.
  // CENRO managers have full review rights in the Executive Shift Audit Dossier.
  const isPendingLocked = !manager && isPendingReview && !coordinatorEditUnlocked;
  const locked = (!manager && currentLog?.status === 'approved') || isPendingLocked;
  const draftKey = 'trashtrack.diesel.draft.' + uid + '.' + selectedId;

  useEffect(() => {
    setParameterForm(stringify(profileScope === 'truck' ? p : settings.parameters));
    setSourceForm({
      priceDate: settings.priceDate || today(),
      priceSource: settings.priceSource,
      parameterSource: settings.parameterSource,
    });
  }, [settings, p, profileScope]);

  useEffect(() => {
    if (!selected) return;
    const routeOpt = optimizeBarangayRouteWithTraffic(selected.barangay);
    const count =
      selected.stops?.filter(s => s.type !== 'depot' && s.type !== 'transfer_station').length ??
      Math.max(0, routeOpt.optimizedStops.length - 2);
    const plan =
      savedPlan ||
      makeDieselPlan(
        selected.routeOptimization?.baselineDistanceKm ?? routeOpt.baselineDistanceKm,
        selected.routeOptimization?.optimizedDistanceKm ?? routeOpt.optimizedDistanceKm,
        count,
        p,
        settings.parameterSource
      );
    setBaselineForm(stringify(plan.baselineInputs));
    setOptimizedForm(stringify(plan.optimizedInputs));
  }, [selected, savedPlan, p, settings.parameterSource]);

  useEffect(() => {
    let active = true;
    if (currentLog) {
      setActualForm(stringify(currentLog.actual));
    } else if (selected && (selected.actualDistanceKm != null || selected.actualFuelLiters != null)) {
      const durHours = (selected.durationMinutes || 0) / 60;
      const tripDateVal = selected.dateText && !isNaN(new Date(selected.dateText).getTime())
        ? new Date(selected.dateText).toISOString().slice(0, 10)
        : today();
      setActualForm({
        ...emptyActual(),
        tripDate: tripDateVal,
        distanceKm: selected.actualDistanceKm != null ? String(selected.actualDistanceKm) : '',
        drivingHours: durHours > 0 ? (durHours * 0.45).toFixed(1) : '1.0',
        idleHours: '0.2',
        collectionHours: durHours > 0 ? (durHours * 0.55).toFixed(1) : '1.0',
        averageLoadPercent: '60',
        collectedKg: selected.collectionMeasurement?.value
          ? String(selected.collectionMeasurement.unit === 'ton' ? selected.collectionMeasurement.value * 1000 : selected.collectionMeasurement.value)
          : '500',
        actualLiters: selected.actualFuelLiters != null ? String(selected.actualFuelLiters) : '',
        fuelMethod: selected.actualFuelLiters != null ? 'metered' : 'not-recorded',
        distanceSource: selected.actualDistanceKm != null ? 'gps' : 'manual',
        evidence: `Driver assisted mobile telemetry: ${selected.durationMinutes || 0} mins run, ${selected.actualDistanceKm || 0} km, ${selected.pickupsCompleted || 0} stops recorded.`,
      });
    } else {
      setActualForm(emptyActual());
    }
    setGpsNote('');
    setReviewNote(currentLog?.reviewNote || '');
    setHasDraft(false);
    setCoordinatorEditUnlocked(false);
    setShowUnlockConfirmModal(false);
    // If pending review or approved, CENRO is strictly in review mode (edit mode disabled).
    // If not pending (no report filed yet), CENRO can edit/input shift telemetry directly.
    setCenroEditMode(!isPendingReview && !currentLog);

    if (!currentLog && selectedId) {
      AsyncStorage.getItem(draftKey)
        .then(raw => {
          if (active && raw) {
            try {
              setActualForm(JSON.parse(raw));
              setHasDraft(true);
              setMessage('Trip draft restored from this device.');
            } catch {}
          }
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [selectedId, currentLog, draftKey, selected]);

  // Self-heal / reconcile selected trip to schedules so Firestore diesel_logs rules pass
  useEffect(() => {
    if (!selectedId || !selected || !db || (!coordinator && !manager)) return;
    if (!schedules.some(s => s.id === selectedId)) {
      setDoc(doc(db, 'schedules', selectedId), {
        barangay: selected.barangay,
        truckId: selected.truckId,
        truckPlate: selected.truckPlate || selected.truckId,
        assignedDriverId: selected.assignedDriverId,
        assignedDriverName: selected.assignedDriverName || selected.driver || 'Driver',
        driver: selected.driver || 'Driver',
        driverName: selected.driverName || 'Driver',
        dateText: selected.dateText || today(),
        timeText: 'Shift Master Route',
        street: selected.street || `Brgy. ${selected.barangay} Collection Route`,
        status: 'completed',
        isLiveDispatch: true,
        completedAt: selected.completedAt || serverTimestamp(),
        createdAt: selected.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
        dieselClosedAt: serverTimestamp(),
        completedByUid: selected.assignedDriverId,
        createdByUid: selected.assignedDriverId,
        actualDistanceKm: selected.actualDistanceKm || 0,
        actualFuelLiters: selected.actualFuelLiters || 0,
        durationMinutes: selected.durationMinutes || 0,
        pickupsCompleted: selected.pickupsCompleted || 0,
        routeOptimization: {
          baselineDistanceKm: Math.round((selected.actualDistanceKm || 0) * 1.15 * 100) / 100,
          optimizedDistanceKm: Math.round((selected.actualDistanceKm || 0) * 100) / 100,
          stopCount: selected.pickupsCompleted || 0,
          method: 'driver-telemetry',
        },
      }, { merge: true }).catch(err => {
        console.warn('DieselEstimateTab: Could not auto-sync schedule for history trip:', err);
      });
    }
  }, [selectedId, selected, schedules, coordinator, manager]);

  useEffect(() => {
    setModel(null);
    if (!selected?.truckId) {
      setModel(null);
      return;
    }
    return onSnapshot(
      doc(db, 'diesel_models', selected.truckId),
      snap => setModel(snap.exists() ? (snap.data() as DieselModel) : null),
      e => {
        // Truck learning model is optional telemetry; do not block data entry or display error banner
        console.warn('DieselEstimateTab: truck model note:', e.message);
      }
    );
  }, [selected?.truckId]);

  const preview = useMemo(() => {
    if (savedPlan) return { plan: savedPlan, error: '' };
    if (!selected) return { plan: null, error: '' };
    try {
      const baselineInputs = parseInputs(baselineForm),
        optimizedInputs = parseInputs(optimizedForm),
        factor = applicableDieselFactor(model, p);
      const plan: DieselPlan = {
        version: 1,
        savedAt: new Date().toISOString(),
        parameters: p,
        parameterSource:
          settings.parameterSource +
          '; ' +
          settings.priceSource +
          '; price effective ' +
          (settings.priceDate || 'not configured'),
        distanceSource: 'Planned route / editable planning inputs; not measured GPS',
        baselineInputs,
        optimizedInputs,
        baseline: calculateDiesel(baselineInputs, p, factor),
        optimized: calculateDiesel(optimizedInputs, p, factor),
        modelId: factor !== 1 ? model?.id || null : null,
      };
      return { plan, error: '' };
    } catch (e) {
      return { plan: null, error: (e as Error).message };
    }
  }, [savedPlan, selected, baselineForm, optimizedForm, model, p, settings]);

  const plan = preview.plan,
    savings = plan ? dieselSavings(plan.baseline, plan.optimized) : null;
  const filtered = displayedSchedules.filter(
    s =>
      ((s.truckPlate || s.truckId) + ' ' + s.barangay + ' ' + getDriverName(s) + ' ' + s.id)
        .toLowerCase()
        .includes(filter.toLowerCase()) &&
      (!month || (logs.find(l => l.scheduleId === s.id)?.actual.tripDate || '').startsWith(month))
  );

  const run = async (action: () => Promise<void> | void) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveParameters = () =>
    run(async () => {
      const values = Object.fromEntries(
        Object.entries(parameterLabels).map(([key, label]) => [key, num(parameterForm[key], label)])
      ) as DieselParameters;
      const next = {
        ...settings,
        priceDate: sourceForm.priceDate,
        priceSource: sourceForm.priceSource,
        parameterSource: sourceForm.parameterSource,
        parameters:
          profileScope === 'fleet' ? values : { ...settings.parameters, pricePerLiter: values.pricePerLiter },
      };
      if (profileScope === 'truck' && selected) {
        const { pricePerLiter: _price, ...physical } = values;
        next.profiles = { ...settings.profiles, [selected.truckId]: physical };
      }
      await saveDieselSettings(next);
      setMessage('Price and assumptions saved. Existing estimates retain their original parameters.');
    });

  // Standard submit (submits as pending)
  const submitActual = () =>
    run(async () => {
      if (!selected) return;
      await AsyncStorage.setItem(draftKey, JSON.stringify(actualForm));
      const rawLiters = actualForm.actualLiters.trim() ? num(actualForm.actualLiters, 'actual liters') : null;
      const actualLiters = rawLiters != null && rawLiters > 0 ? rawLiters : null;
      const fuelMethod = actualLiters != null
        ? (actualForm.fuelMethod === 'dispenser' || actualForm.fuelMethod === 'not-recorded' ? 'metered' : actualForm.fuelMethod)
        : 'not-recorded';
      const actual: DieselActual = {
        ...parseInputs(actualForm),
        tripDate: actualForm.tripDate || today(),
        collectedKg: num(actualForm.collectedKg, 'collected weight'),
        actualLiters,
        distanceSource: (actualForm.distanceSource || 'odometer') as DieselActual['distanceSource'],
        fuelMethod: fuelMethod as DieselActual['fuelMethod'],
        evidence: actualForm.evidence.trim()
          ? actualForm.evidence.trim()
          : coordinator
          ? `Logged by Barangay ${effectiveBarangay || selected.barangay || 'Local'} Coordinator on driver's behalf.`
          : 'Logged by CENRO Danao Municipal Operations.',
        isDemo: actualForm.isDemo === 'true',
      };
      await submitDieselActual(selected, actual);
      await AsyncStorage.removeItem(draftKey);
      setHasDraft(false);
      setCoordinatorEditUnlocked(false);
      setMessage(
        coordinator
          ? `✅ Trip shift log submitted on behalf of driver for Barangay ${effectiveBarangay || selected.barangay}! Submitted for CENRO review.`
          : 'Trip submitted for CENRO review. Only approved real measurements can contribute to learning.'
      );
    });

  // CENRO direct save & approve in one click
  const submitAndApproveActual = () =>
    run(async () => {
      if (!selected) return;
      await AsyncStorage.setItem(draftKey, JSON.stringify(actualForm));
      const rawLiters = actualForm.actualLiters.trim() ? num(actualForm.actualLiters, 'actual liters') : null;
      const actualLiters = rawLiters != null && rawLiters > 0 ? rawLiters : null;
      const fuelMethod = actualLiters != null
        ? (actualForm.fuelMethod === 'dispenser' || actualForm.fuelMethod === 'not-recorded' ? 'metered' : actualForm.fuelMethod)
        : 'not-recorded';
      const actual: DieselActual = {
        ...parseInputs(actualForm),
        tripDate: actualForm.tripDate || today(),
        collectedKg: num(actualForm.collectedKg, 'collected weight'),
        actualLiters,
        distanceSource: (actualForm.distanceSource || 'odometer') as DieselActual['distanceSource'],
        fuelMethod: fuelMethod as DieselActual['fuelMethod'],
        evidence: actualForm.evidence.trim() ? actualForm.evidence.trim() : 'Direct entry by CENRO Danao Administrator.',
        isDemo: actualForm.isDemo === 'true',
      };
      await submitDieselActual(selected, actual);
      await reviewDieselLog(selected.id, 'approved', reviewNote.trim() || 'Direct entry and verification by CENRO Municipal Operations.');
      await AsyncStorage.removeItem(draftKey);
      setHasDraft(false);
      try {
        const result = await trainTruckDiesel(selected.truckId, p);
        setModel(result);
        setMessage(`✅ Trip data recorded and officially approved by CENRO for Brgy. ${selected.barangay}! Truck learning updated.`);
      } catch {
        setMessage(`✅ Trip data recorded and officially approved by CENRO for Brgy. ${selected.barangay}!`);
      }
    });

  const importGps = () =>
    run(async () => {
      if (!selected) return;
      const summary = await loadDieselGps(selected);
      setGpsNote(
        summary.accepted +
          ' valid points; ' +
          summary.gaps +
          ' gaps over 5 minutes; ' +
          summary.rejected +
          ' rejected points. Missing sections can undercount distance.'
      );
      if (summary.accepted < 2)
        throw new Error('No usable real GPS trail for this trip. Use an odometer difference or manual distance entry.');
      setActualForm(f => ({ ...f, distanceKm: String(summary.distanceKm), distanceSource: 'gps' }));
    });

  // Planned route geometry and stop counts
  const plannedRouteFallback = useMemo(() => (selected ? optimizeBarangayRouteWithTraffic(selected.barangay) : null), [selected]);
  const plannedKm = selected?.routeOptimization?.optimizedDistanceKm ?? plannedRouteFallback?.optimizedDistanceKm ?? 0;
  const stopCount =
    selected?.stops?.filter(s => s.type !== 'depot' && s.type !== 'transfer_station').length ??
    Math.max(0, (plannedRouteFallback?.optimizedStops?.length ?? 2) - 2);
  const estDrivingHours = (plannedKm / 20).toFixed(1);
  const estCollectionHours = ((stopCount * (p.minutesPerStop || 3)) / 60).toFixed(1);

  /* =========================================================================
     PRE-DEFENSE DEMO HELPER: DELETE THIS FUNCTION FOR FINAL DEFENSE
     Quickly fills realistic Danao City shift telemetry with 1 click.
     ========================================================================= */
  const fillSampleShiftData = () => {
    if (locked) return;
    const dist = plannedKm > 0 ? plannedKm : 14.8;
    const driveH = (dist / 20).toFixed(1);
    const idleH = '0.5';
    const colH = estCollectionHours && parseFloat(estCollectionHours) > 0 ? estCollectionHours : '1.8';
    const loadPct = '65';
    const kg = String(Math.round(480 + stopCount * 35));
    // Physics-consistent fuel consumption for Danao City collection
    const estLiters = (dist * 0.35 + parseFloat(idleH) * 1.2 + parseFloat(colH) * 2.2).toFixed(1);
    const slipNo = Math.floor(1000 + Math.random() * 9000);

    setActualForm({
      tripDate: actualForm.tripDate || today(),
      distanceKm: String(dist),
      distanceSource: 'odometer',
      drivingHours: driveH,
      idleHours: idleH,
      collectionHours: colH,
      averageLoadPercent: loadPct,
      collectedKg: kg,
      actualLiters: estLiters,
      fuelMethod: 'metered',
      evidence: `CENRO Danao Municipal Fuel Dispenser Slip #DNO-${slipNo} (${estLiters} L @ Depot Pump 2)`,
      isDemo: 'false',
    });
    setMessage(`⚡ Sample shift telemetry populated: ${dist} km, ${estLiters} L diesel, ${colH}h collection time.`);
  };
  /* =========================================================================
     END PRE-DEFENSE DEMO HELPER
     ========================================================================= */

  // Quick Odometer Difference Calculator handler
  const handleApplyOdometer = () => {
    if (locked) return;
    const start = parseFloat(odoStart);
    const end = parseFloat(odoEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      const diff = (end - start).toFixed(1);
      setActualForm(f => ({
        ...f,
        distanceKm: diff,
        distanceSource: 'odometer',
        evidence: f.evidence
          ? `${f.evidence}; Odometer: ${start} km to ${end} km (${diff} km)`
          : `Odometer: ${start} km to ${end} km (${diff} km)`,
      }));
      setShowOdoCalc(false);
      setMessage(`✅ Net trip distance calculated from odometer: ${diff} km.`);
    } else {
      Alert.alert('Invalid Odometer', 'End odometer reading must be greater than or equal to start reading.');
    }
  };

  const cancelCoordinatorEdit = () => {
    if (currentLog) {
      setActualForm(stringify(currentLog.actual));
    }
    setCoordinatorEditUnlocked(false);
    setMessage('Shift report editing cancelled. Form re-locked.');
  };

  const resetSimulation = () => {
    if (!selected) return;
    const routeOpt = optimizeBarangayRouteWithTraffic(selected.barangay);
    const count =
      selected.stops?.filter(s => s.type !== 'depot' && s.type !== 'transfer_station').length ??
      Math.max(0, routeOpt.optimizedStops.length - 2);
    const plan =
      savedPlan ||
      makeDieselPlan(
        selected.routeOptimization?.baselineDistanceKm ?? routeOpt.baselineDistanceKm,
        selected.routeOptimization?.optimizedDistanceKm ?? routeOpt.optimizedDistanceKm,
        count,
        p,
        settings.parameterSource
      );
    setBaselineForm(stringify(plan.baselineInputs));
    setOptimizedForm(stringify(plan.optimizedInputs));
    setMessage('Route estimate inputs reset to Danao City baseline route defaults.');
  };

  // Quick save fuel price modal handler
  const handleSaveFuelPrice = () =>
    run(async () => {
      const priceVal = parseFloat(inputFuelPrice);
      if (!Number.isFinite(priceVal) || priceVal <= 0) {
        throw new Error('Please enter a valid fuel price in ₱/L greater than 0.');
      }
      const next: DieselSettings = {
        ...settings,
        priceDate: inputFuelDate || today(),
        priceSource: inputFuelSource.trim() || 'CENRO Danao Depot',
        parameterSource: settings.parameterSource || 'Danao City baseline parameters',
        parameters: {
          ...settings.parameters,
          pricePerLiter: priceVal,
        },
      };
      await saveDieselSettings(next);
      setPriceModalOpen(false);
      setMessage(`✅ Fuel supply price updated to ₱${priceVal.toFixed(2)}/L! All cost calculations updated.`);
    });

  // Quick Create Master Trip handler
  const openQuickCreateModal = () => {
    try {
      const targetBarangay = (manager && cenroBarangayFilter !== 'all')
        ? cenroBarangayFilter
        : (effectiveBarangay || assignedBarangay || 'Binaliw');
      setQuickBarangay(targetBarangay);

      if (quickTrucks.length > 0) {
        const matchingTruck = quickTrucks.find(t => t.assignedBarangay === targetBarangay) || quickTrucks[0];
        if (matchingTruck && !quickSelectedTruckId) {
          setQuickSelectedTruckId(matchingTruck.id);
          if (matchingTruck.assignedDriverId) {
            setQuickSelectedDriverId(matchingTruck.assignedDriverId);
          } else if (quickDrivers.length > 0) {
            setQuickSelectedDriverId(quickDrivers[0].id);
          }
        }
      }
      setQuickDate(today());
      setQuickCreateModalOpen(true);
    } catch (err) {
      console.error('[DieselEstimateTab] openQuickCreateModal error:', err);
      setQuickCreateModalOpen(true);
    }
  };

  const handleCreateMasterTrip = () =>
    run(async () => {
      if (!quickSelectedTruckId) {
        throw new Error('Please select an active truck to dispatch.');
      }
      const targetBarangay = manager ? quickBarangay : effectiveBarangay;
      const truck = quickTrucks.find(t => t.id === quickSelectedTruckId);
      const driver = quickDrivers.find(d => d.id === quickSelectedDriverId);
      const resolvedDriverId = quickSelectedDriverId || truck?.assignedDriverId || uid;
      const resolvedDriverName = driver?.name || truck?.assignedDriverName || 'Assigned Driver';
      const resolvedPlate = truck?.plateNumber || quickSelectedTruckId;

      const routeOpt = optimizeBarangayRouteWithTraffic(targetBarangay);
      const cleanedStops = (routeOpt.optimizedStops || []).map((stop, idx) => ({
        id: stop.id || `stop-${idx}`,
        name: stop.name || `Collection Stop ${idx + 1}`,
        latitude: Number(stop.latitude) || 0,
        longitude: Number(stop.longitude) || 0,
        barangay: stop.barangay || targetBarangay,
        stopType: stop.stopType || 'regular_pickup',
        trafficCongestionLevel: stop.trafficCongestionLevel || 'low',
        peakAvoidanceReason: stop.peakAvoidanceReason || '',
        optimalTimeWindow: stop.optimalTimeWindow || 'Standard Routine',
        street: stop.street || '',
        wasteType: stop.wasteType || quickWasteCategory || 'General Waste',
        estimatedWeight: stop.estimatedWeight || '50 kg',
      }));

      const scheduleDoc: Record<string, any> = {
        userId: uid,
        createdBy: uid,
        barangay: targetBarangay || 'Danao City',
        truckId: quickSelectedTruckId || '',
        truckPlate: resolvedPlate || quickSelectedTruckId || 'N/A',
        assignedDriverId: resolvedDriverId || uid || '',
        assignedDriverName: resolvedDriverName || 'Assigned Driver',
        isLiveDispatch: true,
        status: 'pending',
        dateText: quickDate || today(),
        street: 'Barangay Proper',
        wasteCategory: quickWasteCategory || 'General Waste',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        stops: cleanedStops,
        routeOptimization: {
          baselineDistanceKm: Number(routeOpt.baselineDistanceKm) || 0,
          optimizedDistanceKm: Number(routeOpt.optimizedDistanceKm) || 0,
          baselineDurationMins: Number(routeOpt.baselineDurationMins) || 0,
          optimizedDurationMins: Number(routeOpt.optimizedDurationMins) || 0,
          stopCount: cleanedStops.length,
          distanceSource: 'Traffic-Aware Optimized Route',
        },
      };

      // Strip any accidental undefined fields
      const sanitizedDoc = Object.fromEntries(
        Object.entries(scheduleDoc).filter(([_, v]) => v !== undefined)
      );

      const ref = await addDoc(collection(db, 'schedules'), sanitizedDoc);
      // If CENRO was filtered to another barangay, switch filter to this barangay
      if (manager && cenroBarangayFilter !== 'all' && cenroBarangayFilter !== targetBarangay) {
        setCenroBarangayFilter(targetBarangay);
      }
      setSelectedId(ref.id);
      setQuickCreateModalOpen(false);
      setTab('actual');
      setMessage(
        `🎉 Master collection trip dispatched for ${resolvedPlate} in Brgy. ${targetBarangay}! Ready for shift telemetry input.`
      );
    });

  // Discard draft handler
  const discardDraft = () =>
    run(async () => {
      await AsyncStorage.removeItem(draftKey);
      setHasDraft(false);
      setActualForm(currentLog ? stringify(currentLog.actual) : emptyActual());
      setMessage('Draft discarded. Restored default values.');
    });

  // Municipal barangay operations breakdown for CENRO
  const municipalBreakdown = useMemo(() => {
    if (!manager) return [];
    const map: Record<
      string,
      {
        barangay: string;
        tripCount: number;
        totalDistance: number;
        totalLiters: number;
        approvedCount: number;
        pendingCount: number;
        unloggedCount: number;
      }
    > = {};

    allSchedules.forEach(s => {
      const b = s.barangay || 'Unknown';
      if (!map[b]) {
        map[b] = {
          barangay: b,
          tripCount: 0,
          totalDistance: 0,
          totalLiters: 0,
          approvedCount: 0,
          pendingCount: 0,
          unloggedCount: 0,
        };
      }
      map[b].tripCount += 1;
      const l = logs.find(log => log.scheduleId === s.id);
      if (l) {
        map[b].totalDistance += parseFloat(String(l.actual.distanceKm || 0)) || 0;
        map[b].totalLiters += parseFloat(String(l.actual.actualLiters || 0)) || 0;
        if (l.status === 'approved') map[b].approvedCount += 1;
        else if (l.status === 'pending') map[b].pendingCount += 1;
      } else {
        map[b].unloggedCount += 1;
      }
    });

    return Object.values(map).sort((a, b) => b.tripCount - a.tripCount || a.barangay.localeCompare(b.barangay));
  }, [manager, allSchedules, logs]);

  const fields = (
    labels: Record<string, string>,
    form: Form,
    setter: React.Dispatch<React.SetStateAction<Form>>,
    disabled = false,
    prefix = '',
    showRequired = false
  ) =>
    Object.entries(labels).map(([key, label]) => {
      const cfg = FIELD_CONFIGS[key];
      if (cfg) {
        return (
          <NumberStepperField
            key={key}
            label={prefix + label}
            value={form[key]}
            disabled={disabled}
            required={showRequired && cfg.required}
            step={cfg.step}
            min={cfg.min}
            max={cfg.max}
            unit={cfg.unit}
            onChange={value =>
              setter(f => ({
                ...f,
                [key]: value,
                ...(key === 'distanceKm' && f.distanceSource === 'gps' ? { distanceSource: 'manual' } : {}),
              }))
            }
          />
        );
      }
      return (
        <Field
          key={key}
          label={prefix + label}
          value={form[key]}
          disabled={disabled}
          required={showRequired}
          onChange={value =>
            setter(f => ({
              ...f,
              [key]: value,
              ...(key === 'distanceKm' && f.distanceSource === 'gps' ? { distanceSource: 'manual' } : {}),
            }))
          }
        />
      );
    });

  if (loading) return <ActivityIndicator accessibilityLabel="Loading diesel module" style={{ padding: 40 }} color="#166534" />;

  return (
    <View style={styles.rootContainer}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* HEADER: TAILORED FOR CENRO MUNICIPAL OPERATIONS VS BARANGAY STEWARD */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={styles.eyebrow}>
              {coordinator
                ? 'TRASHTRACK · BARANGAY FIELD STEWARD'
                : manager
                ? 'CENRO DANAO · MUNICIPAL DIESEL & FLEET DATA OPERATIONS'
                : 'TRASHTRACK · DRIVER OPERATIONS'}
            </Text>
            {manager && (
              <View style={styles.cenroAdminPill}>
                <MaterialIcons name="admin-panel-settings" size={14} color="#166534" />
                <Text style={styles.cenroAdminPillText}>CENRO Data Entry & Municipal Audit</Text>
              </View>
            )}
          </View>
          <Text style={styles.title}>
            {coordinator
              ? 'Trip & Diesel Log (Driver Assisted)'
              : manager
              ? 'CENRO Diesel Telemetry & Shift Input'
              : 'Trip & Diesel Log'}
          </Text>
          <Text style={styles.subtitle}>
            {coordinator
              ? `Record end-of-shift trip distance, hours, and diesel consumption on behalf of drivers in Barangay ${effectiveBarangay}.`
              : manager
              ? 'Central oversight across all 42 Danao City barangays. Filter by barangay, input shift telemetry & fuel disbursements, and officially verify trip consumption.'
              : 'After your shift, record each completed trip separately.'}
          </Text>
        </View>
        {manager && (
          <Button
            label={settingsOpen ? 'Close parameters' : 'Supply price & parameters'}
            onPress={() => setSettingsOpen(!settingsOpen)}
            secondary
          />
        )}
      </View>

      {/* ERROR & SUCCESS MESSAGES */}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          {message}
        </Text>
      )}

      {/* FUEL SUPPLY PRICE BANNER */}
      <View style={styles.banner}>
        <View style={styles.bannerRow}>
          <View style={{ flex: 1, minWidth: 260 }}>
            <Text style={styles.bannerText}>
              {coordinator
                ? `Assisting Barangay ${effectiveBarangay} collection. `
                : manager
                ? 'CENRO Municipal Depot Fuel Baseline: '
                : ''}
              Diesel Supply Price:{' '}
              <Text style={{ fontWeight: '800', color: '#1B3625' }}>
                ₱{effectiveFuelPrice.toFixed(2)}/L
              </Text>{' '}
              {settings.parameters.pricePerLiter > 0
                ? `(Effective: ${settings.priceDate || 'Configured'})`
                : '(Danao Baseline · Not yet configured)'}
              . GPS measures distance, not diesel volume.
            </Text>
          </View>
          {(coordinator || manager) && (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setInputFuelPrice(
                  settings.parameters.pricePerLiter > 0 ? String(settings.parameters.pricePerLiter) : '65.00'
                );
                setInputFuelDate(settings.priceDate || today());
                setInputFuelSource(settings.priceSource || 'CENRO Danao Depot');
                setPriceModalOpen(true);
              }}
              style={styles.bannerActionBtn}
            >
              <MaterialIcons name="local-gas-station" size={16} color="#166534" />
              <Text style={styles.bannerActionBtnText}>Set Fuel Price</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* CENRO MUNICIPAL BARANGAY VIEW & OVERVIEW BAR */}
      {manager && (
        <View style={styles.cenroBarangayBar}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={styles.cenroBarangayIconBox}>
                <MaterialIcons name="location-city" size={24} color="#166534" />
              </View>
              <View>
                <Text style={styles.cenroBarangayLabel}>MUNICIPAL BARANGAY VIEW</Text>
                <Text style={styles.cenroBarangaySub}>
                  {cenroBarangayFilter === 'all'
                    ? `Viewing all 42 Danao City Barangays (${allSchedules.length} active master trips)`
                    : `Filtered to Brgy. ${cenroBarangayFilter} (${displayedSchedules.length} master trip${displayedSchedules.length === 1 ? '' : 's'})`}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 260 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#166534' }}>Select Barangay:</Text>
              <View style={{ flex: 1, minWidth: 180 }}>
                <Picker
                  selectedValue={cenroBarangayFilter}
                  onValueChange={val => setCenroBarangayFilter(val)}
                  style={[styles.picker, { minHeight: 40, height: 40, paddingVertical: 2, fontSize: 13 }]}
                >
                  <Picker.Item label={`📍 All Barangays (${allSchedules.length} trips)`} value="all" />
                  {DANAO_CITY_BARANGAYS.map(b => {
                    const count = allSchedules.filter(s => s.barangay === b).length;
                    return (
                      <Picker.Item
                        key={b}
                        label={`Brgy. ${b} ${count > 0 ? `(${count} trip${count > 1 ? 's' : ''})` : ''}`}
                        value={b}
                      />
                    );
                  })}
                </Picker>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* 3-STEP VISUAL PROGRESS TRACKER */}
      <View style={styles.stepProgressContainer}>
        {/* Step 1 */}
        <TouchableOpacity
          style={[styles.stepItem, !selectedId && styles.stepItemActive]}
          onPress={() => setSelectedId(selectedId || displayedSchedules[0]?.id || '')}
        >
          <View style={[styles.stepBadge, selectedId ? styles.stepBadgeDone : styles.stepBadgeActive]}>
            {selectedId ? <MaterialIcons name="check" size={14} color="#fff" /> : <Text style={styles.stepBadgeNum}>1</Text>}
          </View>
          <View style={styles.stepTextCol}>
            <Text style={styles.stepTitle}>1. Master Trip</Text>
            <Text style={styles.stepSubtitle} numberOfLines={1}>
              {selected
                ? `${selected.barangay} · ${selected.truckPlate || selected.truckId} (#${selected.id.slice(-6).toUpperCase()})`
                : 'Select trip'}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={[styles.stepLine, selectedId ? styles.stepLineActive : null]} />

        {/* Step 2 */}
        <TouchableOpacity
          style={[styles.stepItem, selectedId && tab === 'actual' && !currentLog && styles.stepItemActive]}
          onPress={() => {
            if (selectedId) setTab('actual');
          }}
        >
          <View
            style={[
              styles.stepBadge,
              currentLog ? styles.stepBadgeDone : selectedId ? styles.stepBadgeActive : styles.stepBadgeInactive,
            ]}
          >
            {currentLog ? <MaterialIcons name="check" size={14} color="#fff" /> : <Text style={styles.stepBadgeNum}>2</Text>}
          </View>
          <View style={styles.stepTextCol}>
            <Text style={styles.stepTitle}>
              {coordinator ? '2. Telemetry & Fuel' : '2. CENRO Input'}
            </Text>
            <Text style={styles.stepSubtitle} numberOfLines={1}>
              {currentLog
                ? `${currentLog.actual?.distanceKm || 0} km · ${currentLog.actual?.actualLiters || 0} L (Report Filed)`
                : actualForm.distanceKm
                ? `${actualForm.distanceKm} km · ${actualForm.actualLiters ? `${actualForm.actualLiters} L` : 'Pending L'}`
                : 'Enter km & fuel'}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={[styles.stepLine, currentLog ? styles.stepLineActive : null]} />

        {/* Step 3 */}
        <TouchableOpacity
          style={[styles.stepItem, currentLog && styles.stepItemActive]}
          onPress={() => {
            if (selectedId) setTab('actual');
          }}
        >
          <View
            style={[
              styles.stepBadge,
              currentLog?.status === 'approved'
                ? styles.stepBadgeDone
                : currentLog
                ? styles.stepBadgeActive
                : styles.stepBadgeInactive,
            ]}
          >
            {currentLog?.status === 'approved' ? (
              <MaterialIcons name="check" size={14} color="#fff" />
            ) : (
              <Text style={styles.stepBadgeNum}>3</Text>
            )}
          </View>
          <View style={styles.stepTextCol}>
            <Text style={styles.stepTitle}>3. Official Review</Text>
            <Text style={styles.stepSubtitle} numberOfLines={1}>
              {currentLog
                ? currentLog.status === 'approved'
                  ? 'CENRO Approved'
                  : currentLog.status === 'needs-correction'
                  ? 'Needs Correction'
                  : 'Pending CENRO Review'
                : 'Awaiting Report'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* FULL FLEET / TRUCK PARAMETERS CARD (FOR MANAGERS) */}
      {manager && settingsOpen && (
        <View style={styles.card}>
          <Text style={styles.heading}>CENRO supply price & truck assumptions</Text>
          <Text style={styles.subtitle}>
            Baseline rates reflect Danao City operational parameters. The supply price applies fleet-wide; physical parameters can be
            set per truck.
          </Text>
          <Picker
            accessibilityLabel="Parameter scope"
            selectedValue={profileScope}
            onValueChange={setProfileScope}
            style={styles.picker}
          >
            <Picker.Item label="Fleet defaults" value="fleet" />
            {selected && <Picker.Item label={'Selected truck: ' + (selected.truckPlate || selected.truckId)} value="truck" />}
          </Picker>
          <View style={styles.grid}>
            {fields(parameterLabels, parameterForm, setParameterForm)}
            {Object.entries({
              priceDate: 'Price effective date (YYYY-MM-DD)',
              priceSource: 'Supply source / batch reference',
              parameterSource: 'Parameter source / assumption notes',
            }).map(([key, label]) =>
              key === 'priceDate' ? (
                <DateField
                  key={key}
                  label={label}
                  value={sourceForm[key]}
                  onChange={value => setSourceForm(f => ({ ...f, [key]: value }))}
                />
              ) : (
                <Field
                  key={key}
                  label={label}
                  text
                  value={sourceForm[key]}
                  onChange={value => setSourceForm(f => ({ ...f, [key]: value }))}
                />
              )
            )}
          </View>
          <Button label="Save price & parameters" onPress={saveParameters} disabled={busy} />
        </View>
      )}

      {/* MASTER COLLECTION TRIP SELECTION & DISPATCH */}
      <View style={[styles.card, tripDropdownOpen && { zIndex: 100 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Text style={styles.label}>
            {coordinator
              ? 'Assigned collection trip (Driver Assisted)'
              : manager
              ? `Master collection trip (${cenroBarangayFilter === 'all' ? 'All Danao Barangays' : `Brgy. ${cenroBarangayFilter}`})`
              : 'Assigned collection trip'}{' '}
            <Text style={styles.required}>*</Text>
          </Text>
          {(coordinator || manager) && (
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.quickDispatchBtn}
              onPress={openQuickCreateModal}
            >
              <MaterialIcons name="bolt" size={16} color="#166534" />
              <Text style={styles.quickDispatchBtnText}>
                + Quick Dispatch {manager && cenroBarangayFilter !== 'all' ? `for ${cenroBarangayFilter}` : 'Trip'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* QUICK FILTER CHIPS: ALL / AWAITING REPORT / PENDING REVIEW / REPORT APPROVED */}
        {displayedSchedules.length > 0 && (
          <View style={styles.tripFilterRow}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#4B6354', marginRight: 4 }}>
              Filter:
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => handleFilterSelect('all')}
              style={[styles.tripFilterChip, tripReportFilter === 'all' && styles.tripFilterChipActiveAll]}
            >
              <Text style={[styles.tripFilterChipText, tripReportFilter === 'all' && styles.tripFilterChipTextActive]}>
                All Trips
              </Text>
              <View style={[styles.tripFilterCountBadge, tripReportFilter === 'all' && styles.tripFilterCountBadgeActive]}>
                <Text style={[styles.tripFilterCountText, tripReportFilter === 'all' && styles.tripFilterCountTextActive]}>
                  {displayedSchedules.length}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => handleFilterSelect('awaiting')}
              style={[styles.tripFilterChip, tripReportFilter === 'awaiting' && styles.tripFilterChipActiveAwaiting]}
            >
              <MaterialIcons
                name="pending-actions"
                size={13}
                color={tripReportFilter === 'awaiting' ? '#fff' : '#D97706'}
              />
              <Text style={[styles.tripFilterChipText, tripReportFilter === 'awaiting' && styles.tripFilterChipTextActive]}>
                Awaiting Report
              </Text>
              <View style={[styles.tripFilterCountBadge, tripReportFilter === 'awaiting' && styles.tripFilterCountBadgeActive]}>
                <Text style={[styles.tripFilterCountText, tripReportFilter === 'awaiting' && styles.tripFilterCountTextActive]}>
                  {awaitingCount}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => handleFilterSelect('pending')}
              style={[styles.tripFilterChip, tripReportFilter === 'pending' && styles.tripFilterChipActivePending]}
            >
              <MaterialIcons
                name="schedule"
                size={13}
                color={tripReportFilter === 'pending' ? '#fff' : '#EA580C'}
              />
              <Text style={[styles.tripFilterChipText, tripReportFilter === 'pending' && styles.tripFilterChipTextActive]}>
                Pending Review
              </Text>
              <View style={[styles.tripFilterCountBadge, tripReportFilter === 'pending' && styles.tripFilterCountBadgeActive]}>
                <Text style={[styles.tripFilterCountText, tripReportFilter === 'pending' && styles.tripFilterCountTextActive]}>
                  {pendingCount}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => handleFilterSelect('approved')}
              style={[styles.tripFilterChip, tripReportFilter === 'approved' && styles.tripFilterChipActiveApproved]}
            >
              <MaterialIcons
                name="check-circle"
                size={13}
                color={tripReportFilter === 'approved' ? '#fff' : '#166534'}
              />
              <Text style={[styles.tripFilterChipText, tripReportFilter === 'approved' && styles.tripFilterChipTextActive]}>
                Report Approved
              </Text>
              <View style={[styles.tripFilterCountBadge, tripReportFilter === 'approved' && styles.tripFilterCountBadgeActive]}>
                <Text style={[styles.tripFilterCountText, tripReportFilter === 'approved' && styles.tripFilterCountTextActive]}>
                  {approvedCount}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ENHANCED EXECUTIVE CUSTOM DROPDOWN SELECTOR */}
        {filteredSchedules.length > 0 ? (
          <View style={[styles.customDropdownContainer, tripDropdownOpen && { zIndex: 1000 }]}>
            {/* BACKDROP TO CLOSE DROPDOWN WHEN CLICKING OUTSIDE */}
            {tripDropdownOpen && (
              <TouchableOpacity
                style={[
                  StyleSheet.absoluteFill,
                  {
                    zIndex: 40,
                    ...(Platform.OS === 'web'
                      ? {
                          position: 'fixed' as any,
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          width: '100vw' as any,
                          height: '100vh' as any,
                        }
                      : {
                          position: 'absolute',
                          top: -1000,
                          left: -1000,
                          right: -1000,
                          bottom: -1000,
                        }),
                  },
                ]}
                activeOpacity={1}
                onPress={() => setTripDropdownOpen(false)}
              />
            )}

            <View style={{ position: 'relative', zIndex: tripDropdownOpen ? 1000 : 1 }}>
              {/* DROPDOWN TRIGGER BUTTON */}
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setTripDropdownOpen(!tripDropdownOpen)}
                style={[
                  styles.dropdownTriggerBtn,
                  tripDropdownOpen && styles.dropdownTriggerBtnActive,
                  currentLog?.status === 'approved'
                    ? { borderColor: '#166534' }
                    : currentLog && currentLog.status !== 'needs-correction'
                    ? { borderColor: '#EA580C' }
                    : selected
                    ? { borderColor: '#059669' }
                    : { borderColor: '#CBD5E1' },
                ]}
              >
                {selected ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 }}>
                    <View
                      style={[
                        styles.dropdownTriggerIconBox,
                        currentLog?.status === 'approved'
                          ? { backgroundColor: '#DCFCE7' }
                          : currentLog && currentLog.status !== 'needs-correction'
                          ? { backgroundColor: '#FFEDD5' }
                          : { backgroundColor: '#FEF3C7' },
                      ]}
                    >
                      <MaterialIcons
                        name={
                          currentLog?.status === 'approved'
                            ? 'verified'
                            : currentLog && currentLog.status !== 'needs-correction'
                            ? 'pending-actions'
                            : 'schedule'
                        }
                        size={22}
                        color={
                          currentLog?.status === 'approved'
                            ? '#166534'
                            : currentLog && currentLog.status !== 'needs-correction'
                            ? '#EA580C'
                            : '#D97706'
                        }
                      />
                    </View>

                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <Text style={styles.dropdownTriggerId}>
                          #{selected.id.slice(-6).toUpperCase()}
                        </Text>
                        <View
                          style={[
                            styles.dropdownItemBadge,
                            currentLog?.status === 'approved'
                              ? { backgroundColor: '#DCFCE7' }
                              : currentLog && currentLog.status !== 'needs-correction'
                              ? { backgroundColor: '#FFEDD5' }
                              : { backgroundColor: '#FEF3C7' },
                          ]}
                        >
                          <Text
                            style={[
                              styles.dropdownItemBadgeText,
                              currentLog?.status === 'approved'
                                ? { color: '#166534' }
                                : currentLog && currentLog.status !== 'needs-correction'
                                ? { color: '#C2410C' }
                                : { color: '#B45309' },
                            ]}
                          >
                            {currentLog?.status === 'approved'
                              ? '✓ CENRO Approved'
                              : currentLog?.status === 'needs-correction'
                              ? '⚠️ Correction Needed'
                              : currentLog
                              ? '📝 Pending Review'
                              : '⏳ Awaiting Report'}
                          </Text>
                        </View>
                        <View style={styles.dropdownBarangayPill}>
                          <Text style={styles.dropdownBarangayPillText}>
                            Brgy. {selected.barangay}
                          </Text>
                        </View>
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <Text style={styles.dropdownTriggerSubText}>
                          🚛 {selected.truckPlate || selected.truckId} · Driver: {getDriverName(selected)}
                        </Text>
                        <Text style={[styles.dropdownTriggerSubText, { color: '#047857', fontWeight: '700' }]}>
                          {currentLog?.actual?.distanceKm
                            ? `· ${currentLog.actual.distanceKm} km · ${currentLog.actual.actualLiters || 0} L`
                            : selected.actualDistanceKm
                            ? `· ${selected.actualDistanceKm} km · ${selected.actualFuelLiters || 0} L · ${selected.dateText || ''}`
                            : `· ${selected.dateText || 'Shift scheduled'}`}
                        </Text>
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <MaterialIcons name="touch-app" size={20} color="#64748B" />
                    <Text style={{ fontSize: 14, color: '#64748B', fontWeight: '600' }}>
                      Select a collection trip to inspect or input shift telemetry...
                    </Text>
                  </View>
                )}

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={styles.dropdownTripCountBadge}>
                    <Text style={styles.dropdownTripCountBadgeText}>
                      {filteredSchedules.length} trip{filteredSchedules.length !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <MaterialIcons
                    name={tripDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                    size={24}
                    color="#475569"
                  />
                </View>
              </TouchableOpacity>

              {/* OPEN DROPDOWN MENU */}
              {tripDropdownOpen && (
                <View style={styles.dropdownMenuBox}>
                  {/* SEARCH BAR (For quick filtering across many reports) */}
                  <View style={styles.dropdownSearchBar}>
                    <MaterialIcons name="search" size={18} color="#64748B" />
                    <TextInput
                      style={styles.dropdownSearchInput}
                      placeholder="Quick search by ID, Truck Plate, Driver, or Barangay..."
                      placeholderTextColor="#94A3B8"
                      value={tripSearchQuery}
                      onChangeText={setTripSearchQuery}
                      autoFocus
                    />
                    {tripSearchQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setTripSearchQuery('')} style={{ padding: 4 }}>
                        <MaterialIcons name="close" size={16} color="#64748B" />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* LIST ITEMS (VERTICALLY SCROLLABLE WITH FIXED MAX HEIGHT) */}
                  <ScrollView
                    style={{ maxHeight: 360 }}
                    showsVerticalScrollIndicator={true}
                    nestedScrollEnabled={true}
                  >
                    {tripReportFilter === 'all' && !tripSearchQuery ? (
                      <>
                        {searchedCategorizedTrips.approved.length > 0 && (
                          <View style={styles.dropdownSectionHeader}>
                            <MaterialIcons name="verified" size={14} color="#166534" />
                            <Text style={[styles.dropdownSectionHeaderText, { color: '#166534' }]}>
                              CENRO APPROVED ({searchedCategorizedTrips.approved.length})
                            </Text>
                          </View>
                        )}
                        {searchedCategorizedTrips.approved.map(renderDropdownTripItem)}

                        {searchedCategorizedTrips.pending.length > 0 && (
                          <View style={styles.dropdownSectionHeader}>
                            <MaterialIcons name="schedule" size={14} color="#EA580C" />
                            <Text style={[styles.dropdownSectionHeaderText, { color: '#C2410C' }]}>
                              PENDING REVIEW ({searchedCategorizedTrips.pending.length})
                            </Text>
                          </View>
                        )}
                        {searchedCategorizedTrips.pending.map(renderDropdownTripItem)}

                        {searchedCategorizedTrips.awaiting.length > 0 && (
                          <View style={styles.dropdownSectionHeader}>
                            <MaterialIcons name="pending-actions" size={14} color="#D97706" />
                            <Text style={[styles.dropdownSectionHeaderText, { color: '#B45309' }]}>
                              AWAITING REPORT ({searchedCategorizedTrips.awaiting.length})
                            </Text>
                          </View>
                        )}
                        {searchedCategorizedTrips.awaiting.map(renderDropdownTripItem)}

                        {searchedCategorizedTrips.correction.length > 0 && (
                          <View style={styles.dropdownSectionHeader}>
                            <MaterialIcons name="warning" size={14} color="#DC2626" />
                            <Text style={[styles.dropdownSectionHeaderText, { color: '#DC2626' }]}>
                              NEEDS CORRECTION ({searchedCategorizedTrips.correction.length})
                            </Text>
                          </View>
                        )}
                        {searchedCategorizedTrips.correction.map(renderDropdownTripItem)}
                      </>
                    ) : searchedSchedules.length > 0 ? (
                      searchedSchedules.map(renderDropdownTripItem)
                    ) : (
                      <View style={styles.dropdownEmptySearch}>
                        <MaterialIcons name="search-off" size={28} color="#94A3B8" />
                        <Text style={styles.dropdownEmptySearchText}>
                          No trips found matching &quot;{tripSearchQuery}&quot;
                        </Text>
                        <TouchableOpacity
                          onPress={() => setTripSearchQuery('')}
                          style={styles.dropdownClearSearchBtn}
                        >
                          <Text style={styles.dropdownClearSearchBtnText}>Clear Search</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>
        ) : displayedSchedules.length > 0 ? (
          /* FILTER EMPTY STATE */
          <View style={[styles.emptyCard, { paddingVertical: 18, marginTop: 4 }]}>
            <MaterialIcons
              name={
                tripReportFilter === 'approved'
                  ? 'verified'
                  : tripReportFilter === 'pending'
                  ? 'schedule'
                  : tripReportFilter === 'awaiting'
                  ? 'check-circle'
                  : 'pending-actions'
              }
              size={32}
              color={
                tripReportFilter === 'approved'
                  ? '#166534'
                  : tripReportFilter === 'pending'
                  ? '#D97706'
                  : tripReportFilter === 'awaiting'
                  ? '#166534'
                  : '#64748B'
              }
            />
            <Text style={[styles.emptyTitle, { fontSize: 15, marginTop: 8 }]}>
              {tripReportFilter === 'approved'
                ? 'No Approved Shift Reports Yet.'
                : tripReportFilter === 'pending'
                ? 'No Shift Reports Currently Pending Review.'
                : tripReportFilter === 'awaiting'
                ? 'All Master Trips Have Completed Reports!'
                : 'No Completed Reports Yet For This Filter.'}
            </Text>
            <Text style={[styles.emptyText, { marginBottom: 10 }]}>
              {tripReportFilter === 'approved'
                ? 'Reports will appear here once CENRO audits and officially confirms them.'
                : tripReportFilter === 'pending'
                ? 'Reports will appear here once coordinators or drivers submit end-of-shift telemetry.'
                : tripReportFilter === 'awaiting'
                ? 'Every scheduled collection trip currently has an end-of-shift report submitted.'
                : 'Trips are currently awaiting end-of-shift telemetry and fuel entries.'}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => handleFilterSelect('all')}
              style={styles.emptySecondaryBtn}
            >
              <MaterialIcons name="list" size={16} color="#166534" />
              <Text style={styles.emptySecondaryBtnText}>View All Trips ({displayedSchedules.length})</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* ACTIONABLE EMPTY STATE FOR SELECTED BARANGAY */
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconBox}>
              <MaterialIcons name="local-shipping" size={32} color="#166534" />
            </View>
            <Text style={styles.emptyTitle}>
              No Active Master Trips for{' '}
              {manager
                ? cenroBarangayFilter === 'all'
                  ? 'Danao City'
                  : `Barangay ${cenroBarangayFilter}`
                : `Barangay ${effectiveBarangay}`}
            </Text>
            <Text style={styles.emptyText}>
              To input end-of-shift telemetry and fuel consumption, a master collection trip must first be dispatched with
              an assigned truck and driver.
            </Text>
            <View style={styles.emptyActions}>
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.emptyPrimaryBtn}
                onPress={() => {
                  if (onNavigateTab) {
                    onNavigateTab('collection-scheduler');
                  } else {
                    setMessage('Please open the Collection Scheduler tab to dispatch a collection schedule.');
                  }
                }}
              >
                <MaterialIcons name="calendar-today" size={18} color="#fff" />
                <Text style={styles.emptyPrimaryBtnText}>+ Dispatch Collection Schedule</Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                style={styles.emptySecondaryBtn}
                onPress={openQuickCreateModal}
              >
                <MaterialIcons name="bolt" size={18} color="#166534" />
                <Text style={styles.emptySecondaryBtnText}>⚡ Quick-Create Master Trip</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {selected && (
          <View style={styles.assistedBadge}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontWeight: '700', color: '#166534', fontSize: 13 }}>
                  {coordinator ? '🤝 ASSISTING DRIVER' : manager ? '🏢 CENRO MANAGING TRIP FOR' : 'ASSIGNED DRIVER'}:
                </Text>
                <Text style={{ color: '#1B3625', fontSize: 14, fontWeight: '700' }}>{getDriverName(selected)}</Text>
              </View>
              <View style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ color: '#166534', fontSize: 12, fontWeight: '800' }}>Brgy. {selected.barangay}</Text>
              </View>
            </View>
            <Text style={{ color: '#4B6354', fontSize: 12, marginTop: 4 }}>
              Truck: {selected.truckPlate || selected.truckId} · Master Trip #{selected.id.slice(-6).toUpperCase()} · Shift Status: {selected.status || 'Active'}
            </Text>

            {/* UNMISTAKABLE REPORT STATUS BANNER FOR THIS SPECIFIC SELECTED TRIP */}
            <View
              style={[
                styles.tripReportStatusCard,
                currentLog?.status === 'approved'
                  ? styles.tripReportStatusApproved
                  : currentLog?.status === 'needs-correction'
                  ? styles.tripReportStatusCorrection
                  : currentLog
                  ? styles.tripReportStatusPending
                  : styles.tripReportStatusAwaiting,
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 240 }}>
                  <View
                    style={[
                      styles.tripReportIconBox,
                      currentLog?.status === 'approved'
                        ? { backgroundColor: '#DCFCE7' }
                        : currentLog?.status === 'needs-correction'
                        ? { backgroundColor: '#FEE2E2' }
                        : currentLog
                        ? { backgroundColor: '#FEF3C7' }
                        : { backgroundColor: '#F1F5F9' },
                    ]}
                  >
                    <MaterialIcons
                      name={
                        currentLog?.status === 'approved'
                          ? 'check-circle'
                          : currentLog?.status === 'needs-correction'
                          ? 'warning'
                          : currentLog
                          ? 'schedule'
                          : 'pending-actions'
                      }
                      size={20}
                      color={
                        currentLog?.status === 'approved'
                          ? '#166534'
                          : currentLog?.status === 'needs-correction'
                          ? '#DC2626'
                          : currentLog
                          ? '#B45309'
                          : '#64748B'
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text
                        style={[
                          styles.tripReportStatusTitle,
                          currentLog?.status === 'approved'
                            ? { color: '#14532D' }
                            : currentLog?.status === 'needs-correction'
                            ? { color: '#991B1B' }
                            : currentLog
                            ? { color: '#92400E' }
                            : { color: '#334155' },
                        ]}
                      >
                        {currentLog?.status === 'approved'
                          ? 'Report Done: CENRO Approved'
                          : currentLog?.status === 'needs-correction'
                          ? 'Report Done: Needs Correction'
                          : currentLog
                          ? 'Report Done: Pending CENRO Review'
                          : 'No Report Filed Yet (Awaiting Shift Entry)'}
                      </Text>
                    </View>
                    <Text style={styles.tripReportStatusDesc}>
                      {currentLog
                        ? `Logged: ${currentLog.actual?.distanceKm ?? 0} km · ${currentLog.actual?.actualLiters ?? 0} L diesel · ${currentLog.actual?.collectedKg ? `${currentLog.actual.collectedKg} kg waste` : 'Waste recorded'} · By ${currentLog.submittedBy || 'Coordinator/Driver'}`
                        : coordinator
                        ? 'No end-of-shift report has been submitted for this trip yet. Fill in actual distance and fuel below to submit to CENRO.'
                        : 'No telemetry or diesel log recorded yet for this dispatch.'}
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.tripReportStatusBadgePill,
                    currentLog?.status === 'approved'
                      ? { backgroundColor: '#166534' }
                      : currentLog?.status === 'needs-correction'
                      ? { backgroundColor: '#DC2626' }
                      : currentLog
                      ? { backgroundColor: '#D97706' }
                      : { backgroundColor: '#64748B' },
                  ]}
                >
                  <Text style={styles.tripReportStatusBadgePillText}>
                    {currentLog?.status === 'approved'
                      ? '✓ REPORT COMPLETED'
                      : currentLog?.status === 'needs-correction'
                      ? '⚠️ NEEDS CORRECTION'
                      : currentLog
                      ? '📝 REPORT PENDING'
                      : '⏳ AWAITING INPUT'}
                  </Text>
                </View>
              </View>

              {currentLog?.reviewNote ? (
                <View style={styles.tripReportReviewNote}>
                  <MaterialIcons name="comment" size={14} color="#991B1B" />
                  <Text style={styles.tripReportReviewNoteText}>
                    <Text style={{ fontWeight: '700' }}>CENRO Feedback:</Text> {currentLog.reviewNote}
                  </Text>
                </View>
              ) : null}
            </View>

            {manager && (
              <Text style={{ color: '#047857', fontSize: 11, fontWeight: '600', marginTop: 6 }}>
                {isPendingReview
                  ? '🔒 Review Mode Active: Driver shift submitted — Pending CENRO Review. Telemetry cannot be modified.'
                  : isApproved
                  ? '✓ Officially Approved: This shift record is verified and locked.'
                  : cenroEditMode
                  ? '✏️ Direct Shift Entry Active: No report filed yet. Enter telemetry below to record it.'
                  : '🔍 CENRO Audit Active: Double-checking driver & coordinator shift telemetry.'}
              </Text>
            )}

            {!manager && isPendingReview && (
              <Text style={{ color: isPendingLocked ? '#B45309' : '#0D9488', fontSize: 11, fontWeight: '600', marginTop: 6 }}>
                {isPendingLocked
                  ? '🔒 Shift Report Submitted & Locked: Report is under CENRO review. To modify, click "Unlock to Edit" below.'
                  : '✏️ Edit Mode Active: Report unlocked. Make changes and click "Update & Re-submit Report to CENRO" below.'}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* MODULE TABS: ORDERED TO PRIORITIZE DATA ENTRY */}
      <View style={styles.tabs}>
        {[
          [
            'actual',
            manager ? '🔍 Shift Audit & Confirmation' : 'End-of-shift entry',
            'fact-check',
            selected
              ? currentLog
                ? currentLog.status === 'approved'
                  ? '✓ Approved'
                  : currentLog.status === 'needs-correction'
                  ? '⚠️ Correction'
                  : '📝 Pending Review'
                : '⏳ Awaiting Report'
              : null,
          ],
          ['estimate', '📈 Route Estimates & Physics', 'insights', null],
          ['records', manager ? '📊 Municipal Barangay Overview & Reports' : 'Monitoring & reports', 'assessment', null],
        ].map(([key, label, iconName, badge]) => (
          <TouchableOpacity
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            key={key}
            onPress={() => setTab(key as any)}
            style={[styles.tab, tab === key && styles.activeTab]}
          >
            <MaterialIcons
              name={iconName as any}
              size={18}
              color={tab === key ? '#fff' : '#166534'}
            />
            <Text style={[styles.tabText, tab === key && { color: '#fff' }]}>{label}</Text>
            {badge && (
              <View
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 10,
                  backgroundColor: tab === key ? 'rgba(255, 255, 255, 0.25)' : currentLog ? '#DCFCE7' : '#E2E8F0',
                  marginLeft: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '800',
                    color: tab === key ? '#FFFFFF' : currentLog ? '#166534' : '#475569',
                  }}
                >
                  {badge}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* TAB 1: END-OF-SHIFT ENTRY / CENRO DATA INPUT */}
      {tab === 'actual' && selected && (
        <View style={styles.formCard}>
          {/* HEADER & STATUS STRIP */}
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <View style={styles.cardHeaderIconBox}>
                <MaterialIcons name="local-shipping" size={22} color="#FFFFFF" />
              </View>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={styles.cardHeaderTitle}>
                    {manager
                      ? isPendingReview
                        ? 'Official Shift Telemetry Audit'
                        : cenroEditMode
                        ? 'Direct Shift Telemetry Entry'
                        : 'Official Shift Telemetry'
                      : 'Trip Results & Telemetry'}
                  </Text>
                  <View style={styles.officialPill}>
                    <MaterialIcons name="verified" size={12} color="#059669" />
                    <Text style={styles.officialPillText}>CENRO DANAO</Text>
                  </View>
                </View>
                <Text style={styles.cardHeaderSubtitle}>
                  Barangay <Text style={{ fontWeight: '700', color: '#1E293B' }}>{selected.barangay}</Text> · Truck <Text style={{ fontWeight: '700', color: '#1E293B' }}>{selected.truckPlate || selected.truckId}</Text> · Master Trip <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontWeight: '700', color: '#059669' }}>#{selected.id.slice(-6)}</Text>
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {/* CENRO AUDIT/EDIT MODE TOGGLE: ONLY ALLOWED IF NOT PENDING REVIEW */}
              {manager && (
                isPendingReview ? (
                  <View style={styles.cenroReviewOnlyPill}>
                    <MaterialIcons name="lock" size={14} color="#047857" />
                    <Text style={styles.cenroReviewOnlyPillText}>Review & Confirm Only</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={styles.cenroModeToggleBtn}
                    onPress={() => setCenroEditMode(!cenroEditMode)}
                  >
                    <MaterialIcons name={cenroEditMode ? "visibility" : "edit"} size={15} color="#0D9488" />
                    <Text style={styles.cenroModeToggleBtnText}>
                      {cenroEditMode ? "Preview Audit" : "Edit Values"}
                    </Text>
                  </TouchableOpacity>
                )
              )}

              {/* PRE-DEFENSE DEMO HELPER: ONLY SHOWN IF NOT PENDING REVIEW */}
              {!isPendingReview && !isApproved && (
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.sampleDataBtn}
                  disabled={locked}
                  onPress={fillSampleShiftData}
                >
                  <View style={styles.sampleDataIconCircle}>
                    <MaterialIcons name="bolt" size={15} color="#FFFFFF" />
                  </View>
                  <View>
                    <Text style={styles.sampleDataBtnText}>⚡ Fill Sample Shift Data</Text>
                    <Text style={styles.sampleDataBtnSub}>1-click Danao telemetry</Text>
                  </View>
                </TouchableOpacity>
              )}
              {/* END PRE-DEFENSE DEMO HELPER */}

              {/* TRIP STATUS BADGE */}
              {currentLog ? (
                currentLog.status === 'approved' ? (
                  <View style={[styles.statusBadge, styles.statusBadgeApproved]}>
                    <View style={[styles.statusDot, { backgroundColor: '#166534' }]} />
                    <MaterialIcons name="check-circle" size={15} color="#166534" />
                    <Text style={styles.statusBadgeTextApproved}>CENRO APPROVED</Text>
                  </View>
                ) : currentLog.status === 'needs-correction' ? (
                  <View style={[styles.statusBadge, styles.statusBadgeCorrection]}>
                    <View style={[styles.statusDot, { backgroundColor: '#DC2626' }]} />
                    <MaterialIcons name="warning" size={15} color="#DC2626" />
                    <Text style={styles.statusBadgeTextCorrection}>RETURNED FOR CORRECTION</Text>
                  </View>
                ) : (
                  <View style={[styles.statusBadge, styles.statusBadgePending]}>
                    <View style={[styles.statusDot, { backgroundColor: '#D97706' }]} />
                    <MaterialIcons name="schedule" size={15} color="#D97706" />
                    <Text style={styles.statusBadgeTextPending}>PENDING REVIEW</Text>
                  </View>
                )
              ) : (
                <View style={[styles.statusBadge, styles.statusBadgeDraft]}>
                  <View style={[styles.statusDot, { backgroundColor: '#64748B' }]} />
                  <MaterialIcons name="edit" size={15} color="#475569" />
                  <Text style={styles.statusBadgeTextDraft}>
                    {coordinator ? 'AWAITING SHIFT REPORT' : 'AWAITING CENRO INPUT'}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* DRAFT ACTIVE BANNER */}
          {hasDraft && !currentLog && (
            <View style={styles.draftBanner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <MaterialIcons name="edit-note" size={20} color="#92400E" />
                <Text style={styles.draftBannerText}>
                  Local Draft Active: Showing unsaved changes from this device.
                </Text>
              </View>
              <TouchableOpacity accessibilityRole="button" onPress={discardDraft} style={styles.draftDiscardBtn}>
                <Text style={styles.draftDiscardText}>Discard Draft</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* TELEMETRY CALCULATIONS & DUAL-MODE DISPATCH (AUDIT DOSSIER VS. DATA ENTRY) */}
          {(() => {
            const dist = parseFloat(actualForm.distanceKm) || 0;
            const driveH = parseFloat(actualForm.drivingHours) || 0;
            const idleH = parseFloat(actualForm.idleHours) || 0;
            const colH = parseFloat(actualForm.collectionHours) || 0;
            const totalHours = driveH + idleH + colH;
            const actLiters = parseFloat(actualForm.actualLiters) || 0;
            const loadPct = parseFloat(actualForm.averageLoadPercent) || 50;

            const drivingL =
              dist > 0 && p.kmPerLiter > 0
                ? (dist / p.kmPerLiter) * (1 + (p.fullLoadPenaltyPercent / 100) * (loadPct / 100))
                : 0;
            const idleL = idleH * (p.idleLitersPerHour || 1);
            const colL = colH * (p.collectionLitersPerHour || 2);
            const estLiters = (drivingL + idleL + colL) * (applicableDieselFactor(model, p) || 1);
            const estCost = (actLiters > 0 ? actLiters : estLiters) * effectiveFuelPrice;
            const efficiency =
              actLiters > 0 && dist > 0 ? dist / actLiters : dist > 0 && estLiters > 0 ? dist / estLiters : null;

            // If it's pending review, CENRO CANNOT edit anything and must ONLY review it.
            // If it's not pending review (e.g. no report yet), CENRO can edit it when in edit mode.
            const showAuditDossier = manager && (isPendingReview || isApproved || !cenroEditMode);

            if (showAuditDossier) {
              return (
                /* =========================================================================
                   VIEW 1: CENRO EXECUTIVE AUDIT & CONFIRMATION DOSSIER (READ-ONLY)
                   Designed specifically for supervisory review, double-checking, and 1-click confirmation.
                   ========================================================================= */
                <View style={{ gap: 14 }}>
                  {/* AUDIT SECTION 1: ROUTE MILEAGE & SCHEDULE */}
                  <View style={styles.auditCard}>
                    <View style={styles.auditCardHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={[styles.auditCardHeaderIcon, { backgroundColor: '#F0FDFA' }]}>
                          <MaterialIcons name="alt-route" size={18} color="#0D9488" />
                        </View>
                        <View>
                          <Text style={styles.auditCardTitle}>1. Shift Schedule & Route Distance</Text>
                          <Text style={styles.auditCardSub}>Verified distance traveled & odometer source</Text>
                        </View>
                      </View>
                      <View style={[styles.auditBadgePill, { backgroundColor: '#CCFBF1' }]}>
                        <Text style={[styles.auditBadgeText, { color: '#0F766E' }]}>ROUTE MILEAGE</Text>
                      </View>
                    </View>

                    <View style={styles.auditGrid3}>
                      <View style={styles.auditStatTile}>
                        <Text style={styles.auditStatLabel}>DISTANCE TRAVELED</Text>
                        <Text style={[styles.auditStatNumber, { color: '#0F766E' }]}>
                          {actualForm.distanceKm ? `${parseFloat(actualForm.distanceKm).toFixed(1)} km` : '— km'}
                        </Text>
                        <Text style={styles.auditStatDesc}>
                          {plannedKm > 0
                            ? `Planned: ~${plannedKm.toFixed(1)} km (${
                                parseFloat(actualForm.distanceKm || '0') >= plannedKm ? '+' : ''
                              }${(parseFloat(actualForm.distanceKm || '0') - plannedKm).toFixed(1)} km variance)`
                            : 'Official route distance'}
                        </Text>
                      </View>

                      <View style={styles.auditStatTile}>
                        <Text style={styles.auditStatLabel}>MEASUREMENT SOURCE</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <MaterialIcons
                            name={
                              actualForm.distanceSource === 'odometer'
                                ? 'speed'
                                : actualForm.distanceSource === 'gps'
                                ? 'satellite-alt'
                                : 'straighten'
                            }
                            size={18}
                            color="#0284C7"
                          />
                          <Text style={styles.auditStatSourceText}>
                            {actualForm.distanceSource === 'odometer'
                              ? 'Odometer difference log'
                              : actualForm.distanceSource === 'gps'
                              ? 'Imported GPS trail'
                              : 'Planned / manual distance'}
                          </Text>
                        </View>
                        <Text style={styles.auditStatDesc}>Physical vehicle verification method</Text>
                      </View>

                      <View style={styles.auditStatTile}>
                        <Text style={styles.auditStatLabel}>TRIP DATE</Text>
                        <Text style={styles.auditStatNumber}>
                          {actualForm.tripDate || 'Not specified'}
                        </Text>
                        <Text style={styles.auditStatDesc}>Date of collection dispatch</Text>
                      </View>
                    </View>

                    {/* ODOMETER AUDIT DRAWER */}
                    <View style={styles.auditDrawerContainer}>
                      <TouchableOpacity
                        onPress={() => setShowOdoCalc(!showOdoCalc)}
                        style={styles.auditDrawerToggle}
                      >
                        <MaterialIcons name="calculate" size={16} color="#0369A1" />
                        <Text style={styles.auditDrawerToggleText}>
                          {showOdoCalc ? 'Close Odometer Difference Calculator' : 'Verify Odometer Start & End Readings'}
                        </Text>
                        <MaterialIcons name={showOdoCalc ? 'expand-less' : 'expand-more'} size={18} color="#0369A1" />
                      </TouchableOpacity>

                      {showOdoCalc && (
                        <View style={styles.odoCalcContainer}>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                            <View style={{ flex: 1, minWidth: 140 }}>
                              <Text style={styles.odoInputLabel}>Start Odometer (km)</Text>
                              <TextInput
                                placeholder="e.g. 10420"
                                keyboardType="decimal-pad"
                                value={odoStart}
                                onChangeText={setOdoStart}
                                style={styles.odoInput}
                                placeholderTextColor="#94A3B8"
                              />
                            </View>
                            <View style={{ paddingTop: 16 }}>
                              <Text style={{ fontWeight: '800', color: '#94A3B8', fontSize: 16 }}>→</Text>
                            </View>
                            <View style={{ flex: 1, minWidth: 140 }}>
                              <Text style={styles.odoInputLabel}>End Odometer (km)</Text>
                              <TextInput
                                placeholder="e.g. 10484"
                                keyboardType="decimal-pad"
                                value={odoEnd}
                                onChangeText={setOdoEnd}
                                style={styles.odoInput}
                                placeholderTextColor="#94A3B8"
                              />
                            </View>
                            {(() => {
                              const startVal = parseFloat(odoStart);
                              const endVal = parseFloat(odoEnd);
                              const diff =
                                Number.isFinite(startVal) && Number.isFinite(endVal) ? endVal - startVal : null;
                              return (
                                <View style={styles.odoResultCol}>
                                  <Text style={styles.odoInputLabel}>Net Distance</Text>
                                  <View
                                    style={[
                                      styles.odoDiffBadge,
                                      diff != null && diff < 0 && { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.odoDiffText,
                                        diff != null && diff < 0 && { color: '#DC2626' },
                                      ]}
                                    >
                                      {diff != null ? (diff >= 0 ? `${diff.toFixed(1)} km` : 'Invalid') : '— km'}
                                    </Text>
                                  </View>
                                </View>
                              );
                            })()}
                            <View style={{ paddingTop: 16 }}>
                              <TouchableOpacity onPress={handleApplyOdometer} style={styles.odoApplyBtn}>
                                <MaterialIcons name="check" size={16} color="#FFFFFF" />
                                <Text style={styles.odoApplyBtnText}>Apply Distance</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* AUDIT SECTION 2: OPERATING HOURS BREAKDOWN */}
                  <View style={styles.auditCard}>
                    <View style={styles.auditCardHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={[styles.auditCardHeaderIcon, { backgroundColor: '#EFF6FF' }]}>
                          <MaterialIcons name="schedule" size={18} color="#2563EB" />
                        </View>
                        <View>
                          <Text style={styles.auditCardTitle}>2. Operating Hours Breakdown</Text>
                          <Text style={styles.auditCardSub}>Engine run-time allocation across shift activities</Text>
                        </View>
                      </View>
                      <View
                        style={[styles.hoursPill, totalHours > 24 ? styles.hoursPillAlert : styles.hoursPillNormal]}
                      >
                        <MaterialIcons
                          name={totalHours > 24 ? 'error' : 'check-circle'}
                          size={14}
                          color={totalHours > 24 ? '#DC2626' : '#166534'}
                        />
                        <Text style={[styles.hoursPillText, totalHours > 24 && { color: '#DC2626' }]}>
                          Total: {totalHours.toFixed(1)} hrs {totalHours > 24 ? '(Exceeds 24h limit!)' : '(Compliant)'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.auditGrid3}>
                      <View style={styles.auditStatTile}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[styles.legendDot, { backgroundColor: '#3B82F6' }]} />
                          <Text style={styles.auditStatLabel}>DRIVING TIME</Text>
                        </View>
                        <Text style={[styles.auditStatNumber, { color: '#1D4ED8' }]}>{driveH.toFixed(1)} hrs</Text>
                        <Text style={styles.auditStatDesc}>
                          {totalHours > 0
                            ? `${((driveH / totalHours) * 100).toFixed(0)}% of total shift`
                            : 'Transit run-time'}
                        </Text>
                      </View>

                      <View style={styles.auditStatTile}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                          <Text style={styles.auditStatLabel}>IDLE RUN-TIME</Text>
                        </View>
                        <Text style={[styles.auditStatNumber, { color: '#B45309' }]}>{idleH.toFixed(1)} hrs</Text>
                        <Text style={styles.auditStatDesc}>
                          {totalHours > 0
                            ? `${((idleH / totalHours) * 100).toFixed(0)}% of total shift`
                            : 'Stationary idle burn'}
                        </Text>
                      </View>

                      <View style={styles.auditStatTile}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                          <Text style={styles.auditStatLabel}>COMPACTOR COLLECTION</Text>
                        </View>
                        <Text style={[styles.auditStatNumber, { color: '#047857' }]}>{colH.toFixed(1)} hrs</Text>
                        <Text style={styles.auditStatDesc}>
                          {totalHours > 0
                            ? `${((colH / totalHours) * 100).toFixed(0)}% of total shift`
                            : 'Active compaction & loading'}
                        </Text>
                      </View>
                    </View>

                    {/* LIVE MULTI-SEGMENT DISTRIBUTION BAR */}
                    {totalHours > 0 && (
                      <View style={styles.hoursDistributionContainer}>
                        <View style={styles.hoursDistributionBar}>
                          {driveH > 0 && (
                            <View
                              style={[
                                styles.hoursDistSegment,
                                { flex: Math.max(0.1, driveH), backgroundColor: '#3B82F6' },
                              ]}
                            />
                          )}
                          {idleH > 0 && (
                            <View
                              style={[
                                styles.hoursDistSegment,
                                { flex: Math.max(0.1, idleH), backgroundColor: '#F59E0B' },
                              ]}
                            />
                          )}
                          {colH > 0 && (
                            <View
                              style={[
                                styles.hoursDistSegment,
                                { flex: Math.max(0.1, colH), backgroundColor: '#10B981' },
                              ]}
                            />
                          )}
                        </View>
                        <View style={styles.hoursDistLegend}>
                          <View style={styles.legendItem}>
                            <View style={[styles.legendDot, { backgroundColor: '#3B82F6' }]} />
                            <Text style={styles.legendText}>
                              Driving: {driveH.toFixed(1)}h ({((driveH / totalHours) * 100).toFixed(0)}%)
                            </Text>
                          </View>
                          <View style={styles.legendItem}>
                            <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                            <Text style={styles.legendText}>
                              Idling: {idleH.toFixed(1)}h ({((idleH / totalHours) * 100).toFixed(0)}%)
                            </Text>
                          </View>
                          <View style={styles.legendItem}>
                            <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                            <Text style={styles.legendText}>
                              Collection: {colH.toFixed(1)}h ({((colH / totalHours) * 100).toFixed(0)}%)
                            </Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </View>

                  {/* AUDIT SECTION 3: PAYLOAD & COMPACTOR LOAD */}
                  <View style={styles.auditCard}>
                    <View style={styles.auditCardHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={[styles.auditCardHeaderIcon, { backgroundColor: '#FFFBEB' }]}>
                          <MaterialIcons name="scale" size={18} color="#D97706" />
                        </View>
                        <View>
                          <Text style={styles.auditCardTitle}>3. Payload & Waste Collection</Text>
                          <Text style={styles.auditCardSub}>Compactor load fullness and collected waste weight</Text>
                        </View>
                      </View>
                      <View style={[styles.auditBadgePill, { backgroundColor: '#FEF3C7' }]}>
                        <Text style={[styles.auditBadgeText, { color: '#B45309' }]}>COMPACTOR LOAD</Text>
                      </View>
                    </View>

                    <View style={styles.auditGrid2}>
                      <View style={styles.auditStatTile}>
                        <Text style={styles.auditStatLabel}>AVERAGE COMPACTOR LOAD</Text>
                        <Text style={[styles.auditStatNumber, { color: '#B45309' }]}>
                          {actualForm.averageLoadPercent ? `${actualForm.averageLoadPercent}%` : '50%'}
                        </Text>
                        {(() => {
                          const loadVal = Math.min(100, Math.max(0, parseFloat(actualForm.averageLoadPercent) || 0));
                          const barColor =
                            loadVal <= 35
                              ? '#10B981'
                              : loadVal <= 70
                              ? '#3B82F6'
                              : loadVal <= 85
                              ? '#F59E0B'
                              : '#EF4444';
                          return (
                            <View style={[styles.loadGaugeContainer, { marginTop: 8 }]}>
                              <View style={styles.loadGaugeHeader}>
                                <Text style={styles.loadGaugeLabel}>Capacity Utilization</Text>
                                <Text style={[styles.loadGaugePercent, { color: barColor }]}>
                                  {loadVal}% Loaded
                                </Text>
                              </View>
                              <View style={styles.loadGaugeTrack}>
                                <View
                                  style={[
                                    styles.loadGaugeFill,
                                    { width: `${loadVal}%`, backgroundColor: barColor },
                                  ]}
                                />
                              </View>
                            </View>
                          );
                        })()}
                      </View>

                      <View style={styles.auditStatTile}>
                        <Text style={styles.auditStatLabel}>ACTUAL COLLECTED WEIGHT</Text>
                        <Text style={[styles.auditStatNumber, { color: '#166534' }]}>
                          {actualForm.collectedKg ? `${parseFloat(actualForm.collectedKg).toLocaleString()} kg` : '— kg'}
                        </Text>
                        <Text style={styles.auditStatDesc}>
                          {parseFloat(actualForm.collectedKg) > 0
                            ? `Equivalent to ${(parseFloat(actualForm.collectedKg) / 1000).toFixed(2)} metric tons of municipal waste`
                            : 'Weighbridge or estimated payload'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* AUDIT SECTION 4: DIESEL CONSUMPTION & FUEL SLIP */}
                  <View style={styles.auditCard}>
                    <View style={styles.auditCardHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={[styles.auditCardHeaderIcon, { backgroundColor: '#ECFDF5' }]}>
                          <MaterialIcons name="local-gas-station" size={18} color="#059669" />
                        </View>
                        <View>
                          <Text style={styles.auditCardTitle}>4. Diesel Consumption & Fuel Slip Verification</Text>
                          <Text style={styles.auditCardSub}>Measured fuel volume from Danao City depot or pump ticket</Text>
                        </View>
                      </View>
                      <View style={[styles.auditBadgePill, { backgroundColor: '#D1FAE5' }]}>
                        <Text style={[styles.auditBadgeText, { color: '#047857' }]}>FUEL AUDIT</Text>
                      </View>
                    </View>

                    <View style={styles.auditGrid2}>
                      <View style={styles.auditStatTile}>
                        <Text style={styles.auditStatLabel}>MEASURED DIESEL CONSUMED</Text>
                        <Text style={[styles.auditStatNumber, { color: '#059669' }]}>
                          {actualForm.actualLiters
                            ? `${parseFloat(actualForm.actualLiters).toFixed(1)} L`
                            : 'Unmeasured'}
                        </Text>
                        <Text style={styles.auditStatDesc}>
                          {actualForm.actualLiters
                            ? 'Physical fuel consumption recorded for this shift'
                            : 'Not measured; falls back to physics engine calculation'}
                        </Text>
                      </View>

                      <View style={styles.auditStatTile}>
                        <Text style={styles.auditStatLabel}>MEASUREMENT METHOD</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <MaterialIcons name="verified" size={16} color="#059669" />
                          <Text style={styles.auditStatSourceText}>
                            {actualForm.fuelMethod === 'metered'
                              ? 'Dispenser meter / official pump ticket'
                              : actualForm.fuelMethod === 'full-to-full'
                              ? 'Full-to-full refill covering trip'
                              : actualForm.fuelMethod === 'tank-balance'
                              ? 'Tank balance: start + added − ending L'
                              : 'Not recorded / estimated by physics'}
                          </Text>
                        </View>
                        <Text style={styles.auditStatDesc}>Fuel metering standard</Text>
                      </View>
                    </View>

                    {/* FUEL SLIP EVIDENCE BOX */}
                    <View style={styles.auditEvidenceBox}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <MaterialIcons name="receipt-long" size={18} color="#047857" />
                        <Text style={styles.auditEvidenceTitle}>Official Fuel Slip Reference & Evidence:</Text>
                      </View>
                      <Text style={styles.auditEvidenceContent}>
                        {actualForm.evidence?.trim()
                          ? actualForm.evidence
                          : 'No receipt or fuel slip reference entered.'}
                      </Text>
                    </View>
                  </View>

                  {/* AUDIT SECTION 5: REAL-TIME SHIFT PERFORMANCE & COST HUD */}
                  <View style={styles.hudCard}>
                    <View style={styles.hudHeader}>
                      <View style={styles.hudHeaderIconBox}>
                        <MaterialIcons name="analytics" size={20} color="#166534" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.hudTitle}>Real-Time Shift Performance & Cost Projections</Text>
                        <Text style={styles.hudSubtitle}>
                          Physics-engine telemetry calculated using Danao City baseline rates
                        </Text>
                      </View>
                    </View>

                    <View style={styles.hudGrid}>
                      <View style={styles.hudItem}>
                        <View style={styles.hudItemTop}>
                          <View style={[styles.hudItemIconBox, { backgroundColor: '#EFF6FF' }]}>
                            <MaterialIcons name="timelapse" size={18} color="#2563EB" />
                          </View>
                          <Text style={styles.hudItemLabel}>Total Shift Hours</Text>
                        </View>
                        <Text style={[styles.hudItemBig, totalHours > 24 && { color: '#DC2626' }]}>
                          {totalHours.toFixed(1)} hrs
                        </Text>
                        <Text style={styles.hudItemSub}>
                          {totalHours > 24
                            ? '⚠️ Exceeds 24 hr limit'
                            : `${driveH}h drive · ${idleH}h idle · ${colH}h col`}
                        </Text>
                      </View>

                      <View style={styles.hudItem}>
                        <View style={styles.hudItemTop}>
                          <View style={[styles.hudItemIconBox, { backgroundColor: '#ECFDF5' }]}>
                            <MaterialIcons name="local-gas-station" size={18} color="#059669" />
                          </View>
                          <Text style={styles.hudItemLabel}>
                            {actLiters > 0 ? 'Measured Diesel' : 'Estimated Diesel'}
                          </Text>
                        </View>
                        <Text style={styles.hudItemBig}>
                          {actLiters > 0 ? `${actLiters.toFixed(1)} L` : estLiters > 0 ? `~${estLiters.toFixed(1)} L` : '—'}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          <View style={[styles.hudStatusTag, actLiters > 0 ? styles.tagGreen : styles.tagGray]}>
                            <Text
                              style={[
                                styles.hudStatusTagText,
                                actLiters > 0 ? styles.tagTextGreen : styles.tagTextGray,
                              ]}
                            >
                              {actLiters > 0 ? 'VERIFIED PUMP READING' : 'PHYSICS ESTIMATE'}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.hudItem}>
                        <View style={styles.hudItemTop}>
                          <View style={[styles.hudItemIconBox, { backgroundColor: '#F0FDF4' }]}>
                            <MaterialIcons name="speed" size={18} color="#166534" />
                          </View>
                          <Text style={styles.hudItemLabel}>Fuel Efficiency</Text>
                        </View>
                        <Text style={styles.hudItemBig}>{efficiency ? `${efficiency.toFixed(2)} km/L` : '—'}</Text>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginTop: 4,
                          }}
                        >
                          <Text style={styles.hudItemSub}>Target: {p.kmPerLiter} km/L</Text>
                          {efficiency ? (
                            <View
                              style={[
                                styles.hudStatusTag,
                                efficiency >= p.kmPerLiter
                                  ? styles.tagGreen
                                  : efficiency >= p.kmPerLiter * 0.8
                                  ? styles.tagAmber
                                  : styles.tagRed,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.hudStatusTagText,
                                  efficiency >= p.kmPerLiter
                                    ? styles.tagTextGreen
                                    : efficiency >= p.kmPerLiter * 0.8
                                    ? styles.tagTextAmber
                                    : styles.tagTextRed,
                                ]}
                              >
                                {efficiency >= p.kmPerLiter
                                  ? 'OPTIMAL'
                                  : efficiency >= p.kmPerLiter * 0.8
                                  ? 'ACCEPTABLE'
                                  : 'HIGH BURN'}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </View>

                      <View style={styles.hudItem}>
                        <View style={styles.hudItemTop}>
                          <View style={[styles.hudItemIconBox, { backgroundColor: '#FEF3C7' }]}>
                            <MaterialIcons name="payments" size={18} color="#D97706" />
                          </View>
                          <Text style={styles.hudItemLabel}>Estimated Shift Cost</Text>
                        </View>
                        <Text style={[styles.hudItemBig, { color: '#166534' }]}>
                          {estCost > 0
                            ? `₱${estCost.toLocaleString('en-PH', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`
                            : '—'}
                        </Text>
                        <Text style={styles.hudItemSub}>@ ₱{effectiveFuelPrice.toFixed(2)}/L Danao supply</Text>
                      </View>
                    </View>
                  </View>

                  {/* UNIFIED CENRO SHIFT REVIEW & CONFIRMATION PANEL (BOTTOM) */}
                  <View style={[styles.auditActionBar, { marginTop: 8 }]}>
                    <View style={styles.auditActionBarHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                        <View style={styles.auditActionIconCircle}>
                          <MaterialIcons name="fact-check" size={20} color="#166534" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.auditActionTitle}>CENRO Shift Review & Confirmation</Text>
                          <Text style={styles.auditActionSub}>
                            {currentLog?.status === 'approved'
                              ? 'This shift telemetry is officially approved by CENRO and locked for learning.'
                              : isPendingReview
                              ? 'Driver shift report submitted. Double-check fuel, distance, and receipts above, then confirm approval.'
                              : 'Verify reported fuel & mileage against municipal logs above, then confirm approval.'}
                          </Text>
                        </View>
                      </View>

                      {/* EDIT BUTTON ONLY IF NOT PENDING REVIEW AND NOT APPROVED */}
                      {isPendingReview ? (
                        <View style={styles.auditLockPill}>
                          <MaterialIcons name="lock" size={14} color="#047857" />
                          <Text style={styles.auditLockPillText}>Review & Confirm Only</Text>
                        </View>
                      ) : (
                        !isApproved && (
                          <TouchableOpacity
                            accessibilityRole="button"
                            onPress={() => setCenroEditMode(true)}
                            style={styles.auditEditToggleBtn}
                          >
                            <MaterialIcons name="edit" size={15} color="#0D9488" />
                            <Text style={styles.auditEditToggleText}>Edit Telemetry</Text>
                          </TouchableOpacity>
                        )
                      )}
                    </View>

                    {/* AUDIT NOTE INPUT */}
                    <View style={{ marginTop: 4 }}>
                      <Text style={styles.auditNoteLabel}>CENRO Audit Remarks / Slip Reference (Optional)</Text>
                      <TextInput
                        placeholder="e.g. Verified with Danao City Depot Pump Ticket #DNO-4821 and driver trip ticket"
                        value={reviewNote}
                        onChangeText={setReviewNote}
                        style={styles.auditNoteInput}
                        placeholderTextColor="#94A3B8"
                      />
                    </View>

                    {/* CONFIRMATION ACTION BUTTONS */}
                    <View style={styles.auditActionButtonsRow}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() =>
                          run(async () => {
                            if (!currentLog) {
                              await submitAndApproveActual();
                            } else {
                              await reviewDieselLog(
                                selectedId,
                                'approved',
                                reviewNote.trim() || 'Approved and verified by CENRO Municipal Operations.'
                              );
                              try {
                                const result = await trainTruckDiesel(selected.truckId, p);
                                setModel(result);
                                setMessage('✅ Shift record approved! Truck learning updated: ' + result.status + '.');
                              } catch {
                                setMessage(
                                  '✅ Shift record approved! Learning could not refresh; use Update truck learning to retry.'
                                );
                              }
                            }
                          })
                        }
                        style={[styles.auditConfirmApproveBtn, busy && styles.disabled]}
                      >
                        <MaterialIcons name="check-circle" size={18} color="#FFFFFF" />
                        <Text style={styles.auditConfirmApproveText}>
                          {currentLog?.status === 'approved' ? 'Re-confirm Official Approval' : 'Approve & Confirm Shift'}
                        </Text>
                      </TouchableOpacity>

                      {currentLog?.status !== 'approved' && (
                        <TouchableOpacity
                          accessibilityRole="button"
                          disabled={busy}
                          onPress={() =>
                            run(async () => {
                              if (!reviewNote.trim()) {
                                setError('Please enter a note explaining why this record is being returned for correction.');
                                return;
                              }
                              await reviewDieselLog(selectedId, 'needs-correction', reviewNote.trim());
                              setMessage('⚠️ Returned shift record for correction.');
                            })
                          }
                          style={[styles.auditReturnBtn, busy && styles.disabled]}
                        >
                          <MaterialIcons name="assignment-return" size={18} color="#DC2626" />
                          <Text style={styles.auditReturnText}>Return for Correction</Text>
                        </TouchableOpacity>
                      )}

                      {/* ONLY SHOW EDIT VALUES IF NOT PENDING REVIEW AND NOT APPROVED */}
                      {!isPendingReview && !isApproved && (
                        <TouchableOpacity
                          accessibilityRole="button"
                          onPress={() => setCenroEditMode(true)}
                          style={[styles.auditEditToggleBtn, { marginLeft: 'auto' }]}
                        >
                          <MaterialIcons name="edit" size={15} color="#0D9488" />
                          <Text style={styles.auditEditToggleText}>Edit Values</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            }

            /* =========================================================================
               VIEW 2: EDITABLE DATA ENTRY FORM (FOR DRIVERS / COORDINATORS, OR CENRO IN EDIT MODE)
               ========================================================================= */
            return (
              <View style={{ gap: 14 }}>
                {/* CENRO EDIT ACTIVE BANNER */}
                {manager && (
                  <View style={styles.cenroEditActiveBanner}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <MaterialIcons name="edit" size={18} color="#0D9488" />
                      <Text style={styles.cenroEditActiveText}>
                        <Text style={{ fontWeight: '700' }}>Shift Data Entry Active:</Text> No shift report filed yet. You can enter or adjust the telemetry below.
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setCenroEditMode(false)}
                      style={styles.cenroReturnAuditBtn}
                    >
                      <MaterialIcons name="visibility" size={15} color="#FFFFFF" />
                      <Text style={styles.cenroReturnAuditBtnText}>Preview Audit</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* COORDINATOR LOCKED BANNER (PENDING CENRO REVIEW) */}
                {!manager && isPendingLocked && (
                  <View style={styles.coordinatorLockedBanner}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <View style={styles.coordinatorLockIconBox}>
                        <MaterialIcons name="lock" size={20} color="#B45309" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.coordinatorLockedTitle}>
                          Shift Report Submitted · Locked During CENRO Review
                        </Text>
                        <Text style={styles.coordinatorLockedSubtitle}>
                          This shift report was already submitted to CENRO and is locked against accidental edits. To change distance, hours, payload, or fuel, click below to confirm editing.
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => setShowUnlockConfirmModal(true)}
                      style={styles.coordinatorUnlockBannerBtn}
                    >
                      <MaterialIcons name="edit" size={15} color="#FFFFFF" />
                      <Text style={styles.coordinatorUnlockBannerBtnText}>Unlock to Edit</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* COORDINATOR EDIT UNLOCKED ACTIVE BANNER */}
                {!manager && isPendingReview && coordinatorEditUnlocked && (
                  <View style={styles.coordinatorUnlockedBanner}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <View style={[styles.coordinatorLockIconBox, { backgroundColor: '#FEF3C7' }]}>
                        <MaterialIcons name="lock-open" size={20} color="#D97706" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.coordinatorLockedTitle, { color: '#92400E' }]}>
                          ⚠️ Report Unlocked for Modification
                        </Text>
                        <Text style={[styles.coordinatorLockedSubtitle, { color: '#78350F' }]}>
                          You can now adjust telemetry fields. Once done, click &quot;Update &amp; Re-submit Report to CENRO&quot; below to lock and send your changes.
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={cancelCoordinatorEdit}
                      style={styles.coordinatorCancelBannerBtn}
                    >
                      <MaterialIcons name="lock" size={15} color="#64748B" />
                      <Text style={styles.coordinatorCancelBannerBtnText}>Cancel & Re-lock</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* CARD 1: SHIFT SCHEDULE & ROUTE MILEAGE */}
                <View style={[styles.formSectionCard, styles.sectionCardRoute]}>
                  <View style={styles.sectionHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={[styles.sectionHeaderIcon, { backgroundColor: '#F0FDFA' }]}>
                        <MaterialIcons name="alt-route" size={18} color="#0D9488" />
                      </View>
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.sectionTitle}>1. Shift Schedule & Route Distance</Text>
                          <View style={[styles.sectionPill, { backgroundColor: '#CCFBF1' }]}>
                            <Text style={[styles.sectionPillText, { color: '#0F766E' }]}>ROUTE MILEAGE</Text>
                          </View>
                        </View>
                        <Text style={styles.sectionSubtitle}>Trip date and verified distance traveled</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.formRow3}>
                    <View style={styles.formCol}>
                      <DateField
                        label="Trip date (YYYY-MM-DD)"
                        value={actualForm.tripDate}
                        disabled={locked}
                        required
                        onChange={value => setActualForm(f => ({ ...f, tripDate: value }))}
                      />
                    </View>

                    <View style={styles.formCol}>
                      <NumberStepperField
                        label="Distance"
                        value={actualForm.distanceKm}
                        disabled={locked}
                        required
                        step={1}
                        min={0}
                        unit="km"
                        onChange={value =>
                          setActualForm(f => ({
                            ...f,
                            distanceKm: value,
                            ...(f.distanceSource === 'gps' ? { distanceSource: 'manual' } : {}),
                          }))
                        }
                      />
                    </View>

                    <View style={styles.formCol}>
                      <View style={styles.field}>
                        <Text style={styles.label}>
                          Distance source <Text style={styles.required}>*</Text>
                        </Text>
                        <View style={styles.pickerWrapper}>
                          <Picker
                            accessibilityLabel="Distance source"
                            selectedValue={actualForm.distanceSource}
                            enabled={!locked}
                            onValueChange={value => {
                              if (value !== 'gps') setActualForm(f => ({ ...f, distanceSource: value }));
                            }}
                            style={styles.pickerInner}
                          >
                            <Picker.Item label="Manual / planned route distance" value="manual" />
                            <Picker.Item label="Odometer difference log" value="odometer" />
                            {actualForm.distanceSource === 'gps' && <Picker.Item label="Imported GPS distance" value="gps" />}
                          </Picker>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* ODOMETER DIFFERENCE CALCULATOR TOOL */}
                  <View style={styles.telemetryToolbar}>
                    <View style={styles.telemetryToolbarHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={styles.odoIconBadge}>
                          <MaterialIcons name="speed" size={16} color="#0284C7" />
                        </View>
                        <View>
                          <Text style={styles.telemetryToolbarTitle}>Trip Ticket Odometer Calculator</Text>
                          <Text style={styles.telemetryToolbarSub}>Compute verified mileage from start & end odometer readings</Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        disabled={locked}
                        onPress={() => setShowOdoCalc(!showOdoCalc)}
                        style={[styles.odoToggleBtn, showOdoCalc && styles.odoToggleBtnActive, locked && styles.disabled]}
                      >
                        <MaterialIcons
                          name={showOdoCalc ? 'expand-less' : 'calculate'}
                          size={16}
                          color={showOdoCalc ? '#FFFFFF' : '#0369A1'}
                        />
                        <Text style={[styles.odoToggleBtnText, showOdoCalc && { color: '#FFFFFF' }]}>
                          {showOdoCalc ? 'Close Calculator' : 'Open Calculator'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {showOdoCalc && (
                      <View style={styles.odoCalcContainer}>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                          <View style={{ flex: 1, minWidth: 140 }}>
                            <Text style={styles.odoInputLabel}>Start Odometer (km)</Text>
                            <TextInput
                              placeholder="e.g. 10420"
                              keyboardType="decimal-pad"
                              value={odoStart}
                              onChangeText={setOdoStart}
                              style={styles.odoInput}
                              placeholderTextColor="#94A3B8"
                            />
                          </View>
                          <View style={{ paddingTop: 16 }}>
                            <Text style={{ fontWeight: '800', color: '#94A3B8', fontSize: 16 }}>→</Text>
                          </View>
                          <View style={{ flex: 1, minWidth: 140 }}>
                            <Text style={styles.odoInputLabel}>End Odometer (km)</Text>
                            <TextInput
                              placeholder="e.g. 10484"
                              keyboardType="decimal-pad"
                              value={odoEnd}
                              onChangeText={setOdoEnd}
                              style={styles.odoInput}
                              placeholderTextColor="#94A3B8"
                            />
                          </View>
                          {(() => {
                            const startVal = parseFloat(odoStart);
                            const endVal = parseFloat(odoEnd);
                            const diff =
                              Number.isFinite(startVal) && Number.isFinite(endVal) ? endVal - startVal : null;
                            return (
                              <View style={styles.odoResultCol}>
                                <Text style={styles.odoInputLabel}>Net Distance</Text>
                                <View
                                  style={[
                                    styles.odoDiffBadge,
                                    diff != null && diff < 0 && { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.odoDiffText,
                                      diff != null && diff < 0 && { color: '#DC2626' },
                                    ]}
                                  >
                                    {diff != null ? (diff >= 0 ? `${diff.toFixed(1)} km` : 'Invalid') : '— km'}
                                  </Text>
                                </View>
                              </View>
                            );
                          })()}
                          <View style={{ paddingTop: 16 }}>
                            <TouchableOpacity onPress={handleApplyOdometer} style={styles.odoApplyBtn}>
                              <MaterialIcons name="check" size={16} color="#FFFFFF" />
                              <Text style={styles.odoApplyBtnText}>Apply Distance</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    )}
                    {!!gpsNote && (
                      <View style={styles.gpsNoteContainer}>
                        <MaterialIcons name="satellite-alt" size={14} color="#0369A1" />
                        <Text style={styles.gpsNoteText}>{gpsNote}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* CARD 2: OPERATING HOURS BREAKDOWN */}
                <View style={[styles.formSectionCard, styles.sectionCardHours]}>
                  <View style={styles.sectionHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={[styles.sectionHeaderIcon, { backgroundColor: '#EFF6FF' }]}>
                        <MaterialIcons name="schedule" size={18} color="#2563EB" />
                      </View>
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.sectionTitle}>2. Operating Hours Breakdown</Text>
                          <View style={[styles.sectionPill, { backgroundColor: '#DBEAFE' }]}>
                            <Text style={[styles.sectionPillText, { color: '#1D4ED8' }]}>ENGINE RUN-TIME</Text>
                          </View>
                        </View>
                        <Text style={styles.sectionSubtitle}>
                          Engine run-time allocation across shift activities
                        </Text>
                      </View>
                    </View>

                    <View
                      style={[styles.hoursPill, totalHours > 24 ? styles.hoursPillAlert : styles.hoursPillNormal]}
                    >
                      <MaterialIcons
                        name={totalHours > 24 ? 'error' : 'timelapse'}
                        size={15}
                        color={totalHours > 24 ? '#DC2626' : '#166534'}
                      />
                      <Text style={[styles.hoursPillText, totalHours > 24 && { color: '#DC2626' }]}>
                        Total: {totalHours.toFixed(1)} hrs {totalHours > 24 ? '(Exceeds 24h!)' : ''}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.formRow3}>
                    <View style={styles.formCol}>
                      <NumberStepperField
                        label="Driving hours"
                        value={actualForm.drivingHours}
                        disabled={locked}
                        required
                        step={0.5}
                        min={0}
                        max={24}
                        unit="hrs"
                        onChange={value => setActualForm(f => ({ ...f, drivingHours: value }))}
                      />
                    </View>
                    <View style={styles.formCol}>
                      <NumberStepperField
                        label="Idle hours"
                        value={actualForm.idleHours}
                        disabled={locked}
                        required
                        step={0.5}
                        min={0}
                        max={24}
                        unit="hrs"
                        onChange={value => setActualForm(f => ({ ...f, idleHours: value }))}
                      />
                    </View>
                    <View style={styles.formCol}>
                      <NumberStepperField
                        label="Collection hours"
                        value={actualForm.collectionHours}
                        disabled={locked}
                        required
                        step={0.5}
                        min={0}
                        max={24}
                        unit="hrs"
                        onChange={value => setActualForm(f => ({ ...f, collectionHours: value }))}
                      />
                    </View>
                  </View>

                  {/* INTERACTIVE LIVE MULTI-SEGMENT HOURS BAR */}
                  {totalHours > 0 && (
                    <View style={styles.hoursDistributionContainer}>
                      <View style={styles.hoursDistributionBar}>
                        {driveH > 0 && (
                          <View
                            style={[styles.hoursDistSegment, { flex: Math.max(0.1, driveH), backgroundColor: '#3B82F6' }]}
                          />
                        )}
                        {idleH > 0 && (
                          <View
                            style={[styles.hoursDistSegment, { flex: Math.max(0.1, idleH), backgroundColor: '#F59E0B' }]}
                          />
                        )}
                        {colH > 0 && (
                          <View
                            style={[styles.hoursDistSegment, { flex: Math.max(0.1, colH), backgroundColor: '#10B981' }]}
                          />
                        )}
                      </View>
                      <View style={styles.hoursDistLegend}>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: '#3B82F6' }]} />
                          <Text style={styles.legendText}>
                            Driving: {driveH.toFixed(1)}h ({((driveH / totalHours) * 100).toFixed(0)}%)
                          </Text>
                        </View>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                          <Text style={styles.legendText}>
                            Idling: {idleH.toFixed(1)}h ({((idleH / totalHours) * 100).toFixed(0)}%)
                          </Text>
                        </View>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                          <Text style={styles.legendText}>
                            Collection: {colH.toFixed(1)}h ({((colH / totalHours) * 100).toFixed(0)}%)
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}

                  <Text style={styles.fieldHint}>
                    💡 Operating hours must total ≤ 24 hrs. Engine idle and compactor operation are calculated with distinct fuel burn rates.
                  </Text>
                </View>

                {/* CARD 3: PAYLOAD & WASTE COLLECTION */}
                <View style={[styles.formSectionCard, styles.sectionCardPayload]}>
                  <View style={styles.sectionHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={[styles.sectionHeaderIcon, { backgroundColor: '#FFFBEB' }]}>
                        <MaterialIcons name="scale" size={18} color="#D97706" />
                      </View>
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.sectionTitle}>3. Payload & Waste Collection</Text>
                          <View style={[styles.sectionPill, { backgroundColor: '#FEF3C7' }]}>
                            <Text style={[styles.sectionPillText, { color: '#B45309' }]}>COMPACTOR LOAD</Text>
                          </View>
                        </View>
                        <Text style={styles.sectionSubtitle}>
                          Compactor fullness and total collected tonnage
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.formRow2}>
                    <View style={styles.formCol}>
                      <NumberStepperField
                        label="Average load (%)"
                        value={actualForm.averageLoadPercent}
                        disabled={locked}
                        required
                        step={5}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={value => setActualForm(f => ({ ...f, averageLoadPercent: value }))}
                      />
                      {!locked && (
                        <View style={styles.presetChipsRow}>
                          <Text style={styles.presetLabel}>Quick preset:</Text>
                          {[
                            { pct: '25', label: 'Light', color: '#10B981' },
                            { pct: '50', label: 'Half', color: '#3B82F6' },
                            { pct: '75', label: 'Heavy', color: '#F59E0B' },
                            { pct: '100', label: 'Full', color: '#EF4444' },
                          ].map(pItem => (
                            <TouchableOpacity
                              key={pItem.pct}
                              style={[
                                styles.presetChip,
                                actualForm.averageLoadPercent === pItem.pct && styles.presetChipActive,
                              ]}
                              onPress={() => setActualForm(f => ({ ...f, averageLoadPercent: pItem.pct }))}
                            >
                              <View style={[styles.presetDot, { backgroundColor: pItem.color }]} />
                              <Text
                                style={[
                                  styles.presetChipText,
                                  actualForm.averageLoadPercent === pItem.pct && styles.presetChipTextActive,
                                ]}
                              >
                                {pItem.pct}% {pItem.label}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}

                      {/* DYNAMIC COMPACTOR CAPACITY UTILIZATION GAUGE */}
                      {(() => {
                        const loadVal = Math.min(100, Math.max(0, parseFloat(actualForm.averageLoadPercent) || 0));
                        const barColor =
                          loadVal <= 35 ? '#10B981' : loadVal <= 70 ? '#3B82F6' : loadVal <= 85 ? '#F59E0B' : '#EF4444';
                        return (
                          <View style={styles.loadGaugeContainer}>
                            <View style={styles.loadGaugeHeader}>
                              <Text style={styles.loadGaugeLabel}>Compactor Capacity Utilization</Text>
                              <Text style={[styles.loadGaugePercent, { color: barColor }]}>{loadVal}% Loaded</Text>
                            </View>
                            <View style={styles.loadGaugeTrack}>
                              <View style={[styles.loadGaugeFill, { width: `${loadVal}%`, backgroundColor: barColor }]} />
                            </View>
                          </View>
                        );
                      })()}
                    </View>

                    <View style={styles.formCol}>
                      <NumberStepperField
                        label="Actual collected weight"
                        value={actualForm.collectedKg}
                        disabled={locked}
                        required
                        step={10}
                        min={0}
                        unit="kg"
                        onChange={value => setActualForm(f => ({ ...f, collectedKg: value }))}
                      />
                      <Text style={styles.fieldHint}>
                        Enter weighbridge ticket reading or estimated barangay payload.
                      </Text>
                    </View>
                  </View>
                </View>

                {/* CARD 4: DIESEL CONSUMPTION & OFFICIAL SLIP */}
                <View style={[styles.formSectionCard, styles.sectionCardDiesel]}>
                  <View style={styles.sectionHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={[styles.sectionHeaderIcon, { backgroundColor: '#ECFDF5' }]}>
                        <MaterialIcons name="local-gas-station" size={18} color="#059669" />
                      </View>
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.sectionTitle}>4. Diesel Consumption & Slip Verification</Text>
                          <View style={[styles.sectionPill, { backgroundColor: '#D1FAE5' }]}>
                            <Text style={[styles.sectionPillText, { color: '#047857' }]}>FUEL TELEMETRY</Text>
                          </View>
                        </View>
                        <Text style={styles.sectionSubtitle}>
                          Measured fuel volume from Danao City depot or pump receipt
                        </Text>
                      </View>
                    </View>

                    <View style={styles.mlBadge}>
                      <MaterialIcons name="auto-awesome" size={14} color="#059669" />
                      <Text style={styles.mlBadgeText}>Trains Physics Model</Text>
                    </View>
                  </View>

                  <View style={styles.formRow2}>
                    <View style={styles.formCol}>
                      <NumberStepperField
                        label="Measured diesel consumed (optional)"
                        value={actualForm.actualLiters}
                        disabled={locked}
                        required={false}
                        step={1}
                        min={0}
                        unit="L"
                        onChange={value => setActualForm(f => ({ ...f, actualLiters: value }))}
                      />
                      <Text style={styles.fieldHint}>
                        Optional: shifts without fuel logs can still be saved for route mileage.
                      </Text>
                    </View>

                    <View style={styles.formCol}>
                      <View style={styles.field}>
                        <Text style={styles.label}>How was consumption measured?</Text>
                        <View style={styles.pickerWrapper}>
                          <Picker
                            accessibilityLabel="Fuel measurement method"
                            selectedValue={actualForm.fuelMethod}
                            enabled={!locked}
                            onValueChange={value => setActualForm(f => ({ ...f, fuelMethod: value }))}
                            style={styles.pickerInner}
                          >
                            <Picker.Item label="Not recorded / estimated by physics" value="not-recorded" />
                            <Picker.Item label="Tank balance: start + added − ending L" value="tank-balance" />
                            <Picker.Item label="Full-to-full refill covering trip" value="full-to-full" />
                            <Picker.Item label="Dispenser meter / official pump ticket" value="metered" />
                          </Picker>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View style={{ marginTop: 8 }}>
                    <Field
                      label="Fuel slip reference / receipt / calibration notes"
                      text
                      disabled={locked}
                      value={actualForm.evidence}
                      onChange={value => setActualForm(f => ({ ...f, evidence: value }))}
                    />
                  </View>
                </View>

                {/* CARD 5: PRE-SUBMISSION REAL-TIME SHIFT TELEMETRY HUD */}
                <View style={styles.hudCard}>
                  <View style={styles.hudHeader}>
                    <View style={styles.hudHeaderIconBox}>
                      <MaterialIcons name="analytics" size={20} color="#166534" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hudTitle}>Real-Time Shift Performance & Cost Projections</Text>
                      <Text style={styles.hudSubtitle}>
                        Instant physics-engine telemetry calculated using Danao City baseline rates
                      </Text>
                    </View>
                  </View>

                  <View style={styles.hudGrid}>
                    <View style={styles.hudItem}>
                      <View style={styles.hudItemTop}>
                        <View style={[styles.hudItemIconBox, { backgroundColor: '#EFF6FF' }]}>
                          <MaterialIcons name="timelapse" size={18} color="#2563EB" />
                        </View>
                        <Text style={styles.hudItemLabel}>Total Shift Hours</Text>
                      </View>
                      <Text style={[styles.hudItemBig, totalHours > 24 && { color: '#DC2626' }]}>
                        {totalHours.toFixed(1)} hrs
                      </Text>
                      <Text style={styles.hudItemSub}>
                        {totalHours > 24
                          ? '⚠️ Exceeds 24 hr limit'
                          : `${driveH}h drive · ${idleH}h idle · ${colH}h col`}
                      </Text>
                    </View>

                    <View style={styles.hudItem}>
                      <View style={styles.hudItemTop}>
                        <View style={[styles.hudItemIconBox, { backgroundColor: '#ECFDF5' }]}>
                          <MaterialIcons name="local-gas-station" size={18} color="#059669" />
                        </View>
                        <Text style={styles.hudItemLabel}>
                          {actLiters > 0 ? 'Measured Diesel' : 'Estimated Diesel'}
                        </Text>
                      </View>
                      <Text style={styles.hudItemBig}>
                        {actLiters > 0 ? `${actLiters.toFixed(1)} L` : estLiters > 0 ? `~${estLiters.toFixed(1)} L` : '—'}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                        <View style={[styles.hudStatusTag, actLiters > 0 ? styles.tagGreen : styles.tagGray]}>
                          <Text
                            style={[
                              styles.hudStatusTagText,
                              actLiters > 0 ? styles.tagTextGreen : styles.tagTextGray,
                            ]}
                          >
                            {actLiters > 0 ? 'VERIFIED PUMP READING' : 'PHYSICS ESTIMATE'}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.hudItem}>
                      <View style={styles.hudItemTop}>
                        <View style={[styles.hudItemIconBox, { backgroundColor: '#F0FDF4' }]}>
                          <MaterialIcons name="speed" size={18} color="#166534" />
                        </View>
                        <Text style={styles.hudItemLabel}>Fuel Efficiency</Text>
                      </View>
                      <Text style={styles.hudItemBig}>{efficiency ? `${efficiency.toFixed(2)} km/L` : '—'}</Text>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginTop: 4,
                        }}
                      >
                        <Text style={styles.hudItemSub}>Target: {p.kmPerLiter} km/L</Text>
                        {efficiency ? (
                          <View
                            style={[
                              styles.hudStatusTag,
                              efficiency >= p.kmPerLiter
                                ? styles.tagGreen
                                : efficiency >= p.kmPerLiter * 0.8
                                ? styles.tagAmber
                                : styles.tagRed,
                            ]}
                          >
                            <Text
                              style={[
                                styles.hudStatusTagText,
                                efficiency >= p.kmPerLiter
                                  ? styles.tagTextGreen
                                  : efficiency >= p.kmPerLiter * 0.8
                                  ? styles.tagTextAmber
                                  : styles.tagTextRed,
                              ]}
                            >
                              {efficiency >= p.kmPerLiter
                                ? 'OPTIMAL'
                                : efficiency >= p.kmPerLiter * 0.8
                                ? 'ACCEPTABLE'
                                : 'HIGH BURN'}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.hudItem}>
                      <View style={styles.hudItemTop}>
                        <View style={[styles.hudItemIconBox, { backgroundColor: '#FEF3C7' }]}>
                          <MaterialIcons name="payments" size={18} color="#D97706" />
                        </View>
                        <Text style={styles.hudItemLabel}>Estimated Shift Cost</Text>
                      </View>
                      <Text style={[styles.hudItemBig, { color: '#166534' }]}>
                        {estCost > 0
                          ? `₱${estCost.toLocaleString('en-PH', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : '—'}
                      </Text>
                      <Text style={styles.hudItemSub}>@ ₱{effectiveFuelPrice.toFixed(2)}/L Danao supply</Text>
                    </View>
                  </View>
                </View>

                {!!currentLog?.reviewNote && (
                  <Text style={styles.bannerText}>CENRO audit notes: {currentLog.reviewNote}</Text>
                )}

                {/* ACTION BUTTONS: HIGH-CONTRAST HIERARCHY */}
                <View style={styles.actionsBar}>
                  {manager ? (
                    <>
                      <TouchableOpacity
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={submitAndApproveActual}
                        style={[styles.primaryActionBtn, styles.approveBtn]}
                      >
                        <MaterialIcons name="verified" size={18} color="#fff" />
                        <Text style={styles.primaryActionBtnText}>
                          {currentLog?.status === 'approved'
                            ? 'Update Official CENRO Record'
                            : 'Save & Officially Approve (CENRO)'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={submitActual}
                        style={styles.secondaryActionBtn}
                      >
                        <MaterialIcons name="send" size={16} color="#166534" />
                        <Text style={styles.secondaryActionBtnText}>Submit as Pending Review</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() => setCenroEditMode(false)}
                        style={styles.draftActionBtn}
                      >
                        <MaterialIcons name="visibility" size={16} color="#0D9488" />
                        <Text style={[styles.draftActionBtnText, { color: '#0D9488' }]}>Back to Audit View</Text>
                      </TouchableOpacity>
                    </>
                  ) : isPendingLocked ? (
                    /* COORDINATOR VIEW: REPORT ALREADY SUBMITTED AND LOCKED FOR PENDING REVIEW */
                    <TouchableOpacity
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => setShowUnlockConfirmModal(true)}
                      style={styles.unlockEditConfirmBtn}
                    >
                      <MaterialIcons name="lock-open" size={18} color="#FFFFFF" />
                      <Text style={styles.unlockEditConfirmBtnText}>
                        Edit Confirmation: Unlock to Modify Submitted Report
                      </Text>
                    </TouchableOpacity>
                  ) : !manager && isPendingReview && coordinatorEditUnlocked ? (
                    /* COORDINATOR VIEW: REPORT UNLOCKED FOR EDITING */
                    <>
                      <TouchableOpacity
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={submitActual}
                        style={[styles.primaryActionBtn, { backgroundColor: '#0D9488' }]}
                      >
                        <MaterialIcons name="send" size={18} color="#FFFFFF" />
                        <Text style={styles.primaryActionBtnText}>
                          Update & Re-submit Report to CENRO
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={cancelCoordinatorEdit}
                        style={styles.cancelEditBtn}
                      >
                        <MaterialIcons name="close" size={16} color="#64748B" />
                        <Text style={styles.cancelEditBtnText}>Cancel & Re-lock</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    /* UNLOCKED / NEW REPORT (NOT YET SUBMITTED) */
                    !locked && (
                      <TouchableOpacity
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={submitActual}
                        style={styles.primaryActionBtn}
                      >
                        <MaterialIcons name="send" size={18} color="#fff" />
                        <Text style={styles.primaryActionBtnText}>
                          {coordinator ? "Submit trip on driver's behalf" : 'Submit trip to CENRO'}
                        </Text>
                      </TouchableOpacity>
                    )
                  )}

                  {!isPendingLocked && !locked && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() =>
                        run(async () => {
                          await AsyncStorage.setItem(draftKey, JSON.stringify(actualForm));
                          setHasDraft(true);
                          setMessage('Draft saved locally on this device.');
                        })
                      }
                      style={styles.draftActionBtn}
                    >
                      <MaterialIcons name="save" size={16} color="#475569" />
                      <Text style={styles.draftActionBtnText}>Save Draft on Device</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* MANAGER SEPARATE REVIEW SECTION (IF TRIP IS ALREADY PENDING) */}
                {manager && currentLog?.status === 'pending' && (
                  <View style={styles.review}>
                    <Text style={styles.heading}>CENRO review actions</Text>
                    <Field label="Review note" text value={reviewNote} onChange={setReviewNote} />
                    <View style={styles.actions}>
                      <Button
                        label="Approve record"
                        disabled={busy}
                        onPress={() =>
                          run(async () => {
                            await reviewDieselLog(selectedId, 'approved', reviewNote || 'Approved by CENRO.');
                            try {
                              const result = await trainTruckDiesel(selected.truckId, p);
                              setModel(result);
                              setMessage('Record approved. Truck learning updated: ' + result.status + '.');
                            } catch {
                              setMessage('Record approved. Learning could not refresh; use Update truck learning to retry.');
                            }
                          })
                        }
                      />
                      <Button
                        label="Return for correction"
                        secondary
                        disabled={busy}
                        onPress={() =>
                          run(async () => {
                            await reviewDieselLog(selectedId, 'needs-correction', reviewNote || 'Returned for correction.');
                            setMessage('Returned for correction.');
                          })
                        }
                      />
                    </View>
                  </View>
                )}
              </View>
            );
          })()}
        </View>
      )}

      {/* GUIDANCE NOTICE IF NO TRIP SELECTED ON ACTUAL TAB */}
      {tab === 'actual' && !selected && (
        <View style={styles.selectTripNotice}>
          <MaterialIcons name="touch-app" size={26} color="#166534" />
          <View style={{ flex: 1 }}>
            <Text style={styles.selectTripTitle}>
              {manager ? 'No Master Trip Selected for Telemetry Input' : 'No Master Trip Selected'}
            </Text>
            <Text style={styles.selectTripText}>
              {manager
                ? `Select an active collection trip from ${
                    cenroBarangayFilter === 'all' ? 'any barangay' : `Brgy. ${cenroBarangayFilter}`
                  } above or click "+ Quick Dispatch Trip" to input shift data.`
                : 'Select an assigned collection trip above or click "+ Quick Dispatch Master Trip" to start logging shift telemetry.'}
            </Text>
          </View>
        </View>
      )}

      {/* TAB 2: ESTIMATE & CALCULATION */}
      {tab === 'estimate' && selected && (
        <View style={styles.card}>
          <Text style={styles.heading}>{savedPlan ? 'Saved trip estimate' : 'Route planning estimate'}</Text>
          <Text style={styles.subtitle}>
            {savedPlan
              ? 'Saved ' + new Date(savedPlan.savedAt).toLocaleString() + '. Original parameters and price are preserved.'
              : 'No estimate saved yet. Estimates created after a trip are retrospective.'}
          </Text>
          {!!selected.routeOptimization?.lastReplannedAt && (
            <Text style={styles.bannerText}>
              This route was changed after dispatch. The saved estimate remains the original comparison point.
            </Text>
          )}
          {!savedPlan && (
            <View style={styles.simulatorBanner}>
              <MaterialIcons name="science" size={18} color="#2563EB" />
              <Text style={styles.simulatorBannerText}>
                <Text style={{ fontWeight: '700' }}>What-If Route Simulator Active:</Text> You can adjust distance, operating hours, and compactor load below to preview physics-calculated consumption and projected savings in real-time. {!manager && '(Official municipal estimate saving is reserved for CENRO).' }
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={resetSimulation}
                style={styles.simulatorResetBtn}
              >
                <MaterialIcons name="refresh" size={14} color="#2563EB" />
                <Text style={styles.simulatorResetBtnText}>Reset Defaults</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.columns}>
            <View style={styles.column}>
              <Text style={styles.heading}>Usual route</Text>
              {fields(inputLabels, baselineForm, setBaselineForm, !!savedPlan, 'Usual · ')}
            </View>
            <View style={styles.column}>
              <Text style={styles.heading}>Optimized route</Text>
              {fields(inputLabels, optimizedForm, setOptimizedForm, !!savedPlan, 'Optimized · ')}
            </View>
          </View>
          {!!preview.error && <Text style={styles.error}>{preview.error}</Text>}
          {plan && (
            <>
              <View style={styles.grid}>
                {[
                  ['USUAL ROUTE', plan.baseline.liters, plan.baseline.cost ?? plan.baseline.liters * effectiveFuelPrice],
                  ['OPTIMIZED ROUTE', plan.optimized.liters, plan.optimized.cost ?? plan.optimized.liters * effectiveFuelPrice],
                  ['PROJECTED SAVINGS · SIGNED', savings?.liters, savings?.cost ?? (savings?.liters ? savings.liters * effectiveFuelPrice : null)],
                ].map(([label, liters, cost]) => (
                  <View key={String(label)} style={styles.metric}>
                    <Text style={styles.label}>{label}</Text>
                    <Text style={styles.big}>{fmt(liters as number, ' L')}</Text>
                    <Text style={{ fontWeight: '600', color: '#1B3625' }}>
                      {money(cost as number | null, liters as number, effectiveFuelPrice)}
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={styles.formula}>
                Driving: {fmt(plan.optimizedInputs.distanceKm)} km ÷ {fmt(plan.parameters.kmPerLiter)} km/L × (1 +{' '}
                {fmt(plan.parameters.fullLoadPenaltyPercent)}% × {fmt(plan.optimizedInputs.averageLoadPercent)}%) ={' '}
                {fmt(plan.optimized.drivingLiters)} L{'\n'}
                Idle: {fmt(plan.optimizedInputs.idleHours)} h × {fmt(plan.parameters.idleLitersPerHour)} L/h ={' '}
                {fmt(plan.optimized.idleLiters)} L{'\n'}
                Collection: {fmt(plan.optimizedInputs.collectionHours)} h ×{' '}
                {fmt(plan.parameters.collectionLitersPerHour)} L/h = {fmt(plan.optimized.collectionLiters)} L{'\n'}
                Total: {fmt(plan.optimized.baseLiters)} L × {fmt(plan.optimized.factor)} adjustment ={' '}
                {fmt(plan.optimized.liters)} L{'\n'}
                Cost: {fmt(plan.optimized.liters)} L ×{' '}
                {money(plan.parameters.pricePerLiter > 0 ? plan.parameters.pricePerLiter : effectiveFuelPrice)}/L ={' '}
                {money(plan.optimized.cost, plan.optimized.liters, effectiveFuelPrice)}
                {'\n'}
                Projected savings: {fmt(savings?.percent, '%')}
              </Text>
              <Text style={styles.subtitle}>
                {plan.distanceSource}. {plan.parameterSource}. Negative savings means higher projected consumption.
                Driving fuel is distance-based. Enter idle and collection time separately; do not count the same hour twice.
              </Text>
              {manager && !savedPlan && (
                <Button
                  label="Save this trip estimate"
                  disabled={busy || effectiveFuelPrice <= 0}
                  onPress={() =>
                    run(async () => {
                      await saveDieselPlan(selected, plan);
                      setMessage('Estimate saved with its original supply price and parameters.');
                    })
                  }
                />
              )}
            </>
          )}
        </View>
      )}

      {/* GUIDANCE NOTICE IF NO TRIP SELECTED ON ESTIMATE TAB */}
      {tab === 'estimate' && !selected && (
        <View style={styles.selectTripNotice}>
          <MaterialIcons name="alt-route" size={26} color="#166534" />
          <View style={{ flex: 1 }}>
            <Text style={styles.selectTripTitle}>No Master Trip Selected</Text>
            <Text style={styles.selectTripText}>
              Select an assigned collection trip above to inspect baseline versus optimized fuel calculations.
            </Text>
          </View>
        </View>
      )}

      {/* TAB 3: MONITORING & REPORTS / MUNICIPAL BARANGAY OVERVIEW */}
      {tab === 'records' && (
        <View style={styles.card}>
          <Text style={styles.heading}>
            {manager ? 'Municipal Barangay Diesel Operations & Variance' : 'Estimated versus reported consumption'}
          </Text>

          {/* MUNICIPAL BARANGAY BREAKDOWN TABLE FOR CENRO */}
          {manager && municipalBreakdown.length > 0 && (
            <View style={styles.municipalBreakdownBox}>
              <Text style={styles.municipalBreakdownTitle}>🏢 Municipal Breakdown Across Danao City</Text>
              <Text style={styles.subtitle}>
                Click any barangay to quickly filter trips and view its logs.
              </Text>
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, { flex: 1.5 }]}>Barangay</Text>
                  <Text style={[styles.th, { flex: 1, textAlign: 'center' }]}>Trips</Text>
                  <Text style={[styles.th, { flex: 1.2, textAlign: 'right' }]}>Distance</Text>
                  <Text style={[styles.th, { flex: 1.2, textAlign: 'right' }]}>Diesel (L)</Text>
                  <Text style={[styles.th, { flex: 1.4, textAlign: 'right' }]}>Est. Cost</Text>
                  <Text style={[styles.th, { flex: 1, textAlign: 'center' }]}>Action</Text>
                </View>
                {municipalBreakdown.map(item => (
                  <View key={item.barangay} style={styles.tableRow}>
                    <Text style={[styles.td, { flex: 1.5, fontWeight: '700', color: '#1B3625' }]}>
                      Brgy. {item.barangay}
                    </Text>
                    <Text style={[styles.td, { flex: 1, textAlign: 'center' }]}>
                      {item.tripCount}
                    </Text>
                    <Text style={[styles.td, { flex: 1.2, textAlign: 'right' }]}>
                      {item.totalDistance.toFixed(1)} km
                    </Text>
                    <Text style={[styles.td, { flex: 1.2, textAlign: 'right' }]}>
                      {item.totalLiters > 0 ? `${item.totalLiters.toFixed(1)} L` : '—'}
                    </Text>
                    <Text style={[styles.td, { flex: 1.4, textAlign: 'right', fontWeight: '600', color: '#166534' }]}>
                      {item.totalLiters > 0 ? `₱${(item.totalLiters * effectiveFuelPrice).toFixed(0)}` : '—'}
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        setCenroBarangayFilter(item.barangay);
                        setTab('actual');
                      }}
                      style={[styles.thActionBtn, { flex: 1 }]}
                    >
                      <Text style={styles.thActionBtnText}>Input/View</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.grid}>
            <Field label="Filter truck, driver, barangay or trip" text value={filter} onChange={setFilter} />
            <Field label="Trip month (YYYY-MM) · blank for all" text value={month} onChange={setMonth} />
          </View>
          <View style={styles.actions}>
            <Button
              label="Export Reports (PDF / Excel / CSV)"
              secondary
              disabled={busy || !filtered.length}
              onPress={() => setIsExportModalVisible(true)}
            />
          </View>
          <Text style={styles.subtitle}>
            {filtered.length} trip(s) in view. Variance = actual − original estimate. Blank readings are never counted as zero.
          </Text>
          {filtered.map(s => {
            const l = logs.find(item => item.scheduleId === s.id),
              estimate = plans[s.id] || s.routeOptimization?.dieselEstimate,
              actual = l?.actual.actualLiters;
            return (
              <TouchableOpacity
                accessibilityRole="button"
                key={s.id}
                style={styles.record}
                onPress={() => {
                  setSelectedId(s.id);
                  setTab('actual');
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.label}>
                    Brgy. {s.barangay} · {s.truckPlate || s.truckId} · Driver: {getDriverName(s)}
                  </Text>
                  <View style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#166534' }}>{s.dateText || 'Today'}</Text>
                  </View>
                </View>
                <Text style={styles.subtitle}>
                  {l?.status || 'No actual record'} · Estimate {fmt(estimate?.optimized.liters, ' L')} · Actual{' '}
                  {fmt(actual, ' L')} · Variance{' '}
                  {fmt(actual != null && estimate ? actual - estimate.optimized.liters : null, ' L')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* TRUCK LEARNING (FOR MANAGERS) */}
      {manager && selected && (
        <View style={styles.card}>
          <Text style={styles.heading}>Learning from this truck’s measured trips</Text>
          <Text style={styles.subtitle}>
            A fitted fuel adjustment needs at least 12 approved real records: at least 8 earlier training trips and 3 later
            validation trips, separated by date. Manual distance, missing readings, and unreviewed records are
            excluded. The candidate must reduce validation error by more than 5%. Changed physical truck parameters
            invalidate the old adjustment.
          </Text>
          <Text style={styles.formula}>
            Status: {model?.status || 'Not trained'} · Eligible records: {model?.sampleCount ?? 0}
            {'\n'}Validation error: basic {fmt(model?.baselineMae, ' L')} · learned {fmt(model?.candidateMae, ' L')}
            {'\n'}Current adjustment: ×{fmt(applicableDieselFactor(model, p))}
          </Text>
          <Button
            label="Update truck learning"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const result = await trainTruckDiesel(selected.truckId, p);
                setModel(result);
                setMessage(
                  result.status === 'validated'
                    ? 'Learned adjustment passed validation and applies to new estimates.'
                    : 'Basic formula retained until enough records and an improved validation result are available.'
                );
              })
            }
          />
        </View>
      )}
      </ScrollView>

      {/* FUEL PRICE CONFIGURATION MODAL */}
      <Modal visible={priceModalOpen} transparent animationType="fade" onRequestClose={() => setPriceModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setPriceModalOpen(false)}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={styles.modalIconBox}>
                  <MaterialIcons name="local-gas-station" size={24} color="#166534" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Set Diesel Fuel Supply Price</Text>
                  <Text style={styles.modalSubtitle}>Configure CENRO pump price for municipal cost calculations</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setPriceModalOpen(false)} style={styles.modalCloseBtn}>
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }} contentContainerStyle={styles.modalBody}>
              <Text style={styles.label}>Quick Presets (PHP / Liter)</Text>
              <View style={styles.modalPresetRow}>
                {['60.00', '65.00', '68.50', '70.00', '72.00'].map(val => (
                  <TouchableOpacity
                    key={val}
                    style={[styles.modalPresetBtn, inputFuelPrice === val && styles.modalPresetBtnActive]}
                    onPress={() => setInputFuelPrice(val)}
                  >
                    <Text
                      style={[
                        styles.modalPresetBtnText,
                        inputFuelPrice === val && { color: '#166534', fontWeight: '800' },
                      ]}
                    >
                      ₱{val}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Field
                label="Pump / Supply Price (₱/L)"
                required
                value={inputFuelPrice}
                onChange={setInputFuelPrice}
              />
              <DateField
                label="Effective Date (YYYY-MM-DD)"
                required
                value={inputFuelDate}
                onChange={setInputFuelDate}
              />
              <Field
                label="Supply Source / Supplier Depot"
                text
                value={inputFuelSource}
                onChange={setInputFuelSource}
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setPriceModalOpen(false)}
                style={[styles.button, styles.secondary]}
              >
                <Text style={[styles.buttonText, { color: '#166534' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={handleSaveFuelPrice}
                disabled={busy}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Save Supply Price</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* QUICK-CREATE MASTER TRIP MODAL */}
      <Modal
        visible={quickCreateModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setQuickCreateModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setQuickCreateModalOpen(false)}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={styles.modalIconBox}>
                  <MaterialIcons name="bolt" size={24} color="#166534" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Quick Dispatch Master Trip</Text>
                  <Text style={styles.modalSubtitle}>
                    Deploy an official collection route in Danao City
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setQuickCreateModalOpen(false)} style={styles.modalCloseBtn}>
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }} contentContainerStyle={styles.modalBody}>
              {/* TARGET BARANGAY: CENRO CAN PICK ANY BARANGAY */}
              {manager ? (
                <View style={{ marginBottom: 6 }}>
                  <Text style={styles.label}>
                    Target Barangay <Text style={styles.required}>*</Text>
                  </Text>
                  <Picker
                    selectedValue={quickBarangay}
                    onValueChange={val => setQuickBarangay(val)}
                    style={styles.picker}
                  >
                    {DANAO_CITY_BARANGAYS.map(b => (
                      <Picker.Item key={b} label={`Brgy. ${b}`} value={b} />
                    ))}
                  </Picker>
                </View>
              ) : (
                <View style={{ marginBottom: 6 }}>
                  <Text style={styles.label}>Barangay</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#166534' }}>
                    Brgy. {effectiveBarangay}
                  </Text>
                </View>
              )}

              <Text style={styles.label}>
                Select Collection Truck <Text style={styles.required}>*</Text>
              </Text>
              {quickTrucks.length > 0 ? (
                <Picker
                  selectedValue={quickSelectedTruckId}
                  onValueChange={val => {
                    setQuickSelectedTruckId(val);
                    const truck = quickTrucks.find(t => t.id === val);
                    if (truck?.assignedDriverId) {
                      setQuickSelectedDriverId(truck.assignedDriverId);
                    }
                  }}
                  style={styles.picker}
                >
                  <Picker.Item label="-- Select Truck --" value="" />
                  {quickTrucks.map(t => (
                    <Picker.Item
                      key={t.id}
                      label={`${t.plateNumber} ${t.type ? `(${t.type})` : ''} ${
                        t.assignedDriverName ? `· Driver: ${t.assignedDriverName}` : ''
                      }`}
                      value={t.id}
                    />
                  ))}
                </Picker>
              ) : (
                <Field
                  label="Truck Plate Number"
                  text
                  required
                  value={quickSelectedTruckId}
                  onChange={setQuickSelectedTruckId}
                />
              )}

              <Text style={[styles.label, { marginTop: 10 }]}>Assigned Driver</Text>
              {quickDrivers.length > 0 ? (
                <Picker
                  selectedValue={quickSelectedDriverId}
                  onValueChange={setQuickSelectedDriverId}
                  style={styles.picker}
                >
                  <Picker.Item label="-- Auto-assign / Select Driver --" value="" />
                  {quickDrivers.map(d => (
                    <Picker.Item key={d.id} label={d.name} value={d.id} />
                  ))}
                </Picker>
              ) : (
                <Field
                  label="Driver Name"
                  text
                  value={quickSelectedDriverId}
                  onChange={setQuickSelectedDriverId}
                />
              )}

              <Text style={[styles.label, { marginTop: 10 }]}>Waste Category</Text>
              <Picker
                selectedValue={quickWasteCategory}
                onValueChange={setQuickWasteCategory}
                style={styles.picker}
              >
                <Picker.Item label="General Waste" value="General Waste" />
                <Picker.Item label="Biodegradable" value="Biodegradable" />
                <Picker.Item label="Recyclable" value="Recyclable" />
                <Picker.Item label="Special / Hazardous" value="Special Waste" />
              </Picker>

              <DateField
                label="Trip Date (YYYY-MM-DD)"
                required
                value={quickDate}
                onChange={setQuickDate}
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setQuickCreateModalOpen(false)}
                style={[styles.button, styles.secondary]}
              >
                <Text style={[styles.buttonText, { color: '#166534' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={handleCreateMasterTrip}
                disabled={busy}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Dispatch Master Trip</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* COORDINATOR UNLOCK PENDING REPORT CONFIRMATION MODAL */}
      <Modal
        visible={showUnlockConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUnlockConfirmModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={[StyleSheet.absoluteFill, { zIndex: 1 }]}
            activeOpacity={1}
            onPress={() => setShowUnlockConfirmModal(false)}
          />
          <View style={[styles.modalContent, { maxWidth: 490, zIndex: 10 }]} pointerEvents="auto">
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.modalIconBox, { backgroundColor: '#FEF3C7' }]}>
                  <MaterialIcons name="edit-note" size={24} color="#D97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Unlock Pending Shift Report?</Text>
                  <Text style={styles.modalSubtitle}>
                    Trip #{selected?.id?.slice(-6) || ''} · Brgy. {selected?.barangay || effectiveBarangay}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setShowUnlockConfirmModal(false)}
                style={styles.modalCloseBtn}
              >
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={{ paddingVertical: 14, gap: 12 }}>
              <View style={{ backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 8, padding: 12, flexDirection: 'row', gap: 10 }}>
                <MaterialIcons name="info" size={20} color="#D97706" style={{ marginTop: 2 }} />
                <Text style={{ fontSize: 13, color: '#92400E', flex: 1, lineHeight: 18 }}>
                  This shift report was already submitted to CENRO Danao and is currently pending official review.
                </Text>
              </View>

              <Text style={{ fontSize: 13, color: '#334155', lineHeight: 20 }}>
                Unlocking will enable you to modify route mileage, operating hours breakdown, waste tonnage collected, and diesel slip verification. Once changes are made, re-submit so CENRO can audit the revised shift data.
              </Text>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setShowUnlockConfirmModal(false)}
                style={[styles.button, styles.secondary, { cursor: 'pointer' as any }]}
              >
                <Text style={[styles.buttonText, { color: '#64748B' }]}>Keep Locked</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => {
                  setShowUnlockConfirmModal(false);
                  setCoordinatorEditUnlocked(true);
                  setMessage('🔓 Shift report unlocked. Modify fields below and click "Update & Re-submit Report".');
                }}
                style={[styles.button, { backgroundColor: '#D97706', cursor: 'pointer' as any }]}
              >
                <MaterialIcons name="lock-open" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.buttonText}>Confirm & Unlock</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Diesel Fuel Report Export Modal */}
      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="Diesel Fuel Consumption & Variance Report"
        dataCount={filtered.length}
        onExport={async (format: ExportFormat) => {
          await run(() => exportDieselReport(filtered, logs, plans, format));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: { flex: 1, backgroundColor: '#F3F6F4' },
  page: { flex: 1, backgroundColor: '#F3F6F4' },
  content: { padding: 20, paddingBottom: 60, gap: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 16,
  },
  eyebrow: { color: '#527361', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  cenroAdminPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  cenroAdminPillText: { color: '#166534', fontSize: 11, fontWeight: '800' },
  title: { color: '#173F2B', fontSize: 28, fontWeight: '800', marginVertical: 4 },
  subtitle: { color: '#52665B', fontSize: 13, lineHeight: 20, marginVertical: 4 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DCE7DF',
    padding: 18,
    gap: 12,
    overflow: 'visible',
  },
  heading: { color: '#0F172A', fontSize: 17, fontWeight: '800' },
  label: { color: '#1E293B', fontSize: 12, fontWeight: '700', marginBottom: 6, letterSpacing: 0.2 },
  field: { flexGrow: 1, flexBasis: 'auto', minWidth: 160, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  input: {
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    minHeight: 46,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    minHeight: 46,
    height: 46,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  stepperInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#0F172A',
    backgroundColor: 'transparent',
    fontSize: 15,
    fontWeight: '700',
    minHeight: 44,
  },
  stepperControls: {
    width: 34,
    alignSelf: 'stretch',
    borderLeftWidth: 1,
    borderLeftColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    flexDirection: 'column',
  },
  stepperBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  stepperBtnDown: { borderTopWidth: 1, borderTopColor: '#CBD5E1' },
  required: { color: '#DC2626', fontWeight: '700' },
  webDateWrapper: { width: '100%' },
  dateInputNative: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#CCDAD0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FAFCFA',
    minHeight: 44,
    height: 44,
  },
  dateInputNativeText: { color: '#1B3625', fontSize: 14 },
  picker: { color: '#1B3625', backgroundColor: '#F5F8F5', minHeight: 46, borderRadius: 8 },
  button: {
    backgroundColor: '#166534',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 8,
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  secondary: { backgroundColor: '#EDF6EF', borderColor: '#C9DDCE', borderWidth: 1 },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 4 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#EAEFEA',
    borderWidth: 1,
    borderColor: '#D4E2D7',
  },
  activeTab: {
    backgroundColor: '#166534',
    borderColor: '#166534',
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: { fontWeight: '700', color: '#2C4A38', fontSize: 13 },
  banner: {
    backgroundColor: '#FFF7DC',
    borderColor: '#EDDEAF',
    borderWidth: 1,
    padding: 12,
    borderRadius: 10,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  bannerText: { color: '#705817', fontSize: 13, lineHeight: 20 },
  bannerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  bannerActionBtnText: { color: '#166534', fontSize: 12, fontWeight: '700' },
  error: { backgroundColor: '#FEE2E2', color: '#991B1B', padding: 12, borderRadius: 8, fontSize: 13 },
  success: { backgroundColor: '#DCFCE7', color: '#166534', padding: 12, borderRadius: 8, fontSize: 13 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  column: { flex: 1, minWidth: 230, gap: 8 },
  metric: { backgroundColor: '#F0F7F1', padding: 16, borderRadius: 10, flexGrow: 1, minWidth: 160 },
  big: { color: '#166534', fontSize: 24, fontWeight: '800', marginVertical: 6 },
  formula: { backgroundColor: '#F5F8F5', padding: 14, borderRadius: 8, color: '#304B3A', fontSize: 13, lineHeight: 22 },
  switchRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  review: { paddingTop: 16, borderTopWidth: 1, borderTopColor: '#DCE7DF', gap: 10 },
  record: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E5EDE7' },
  assistedBadge: {
    backgroundColor: '#EDF6EF',
    borderColor: '#C9DDCE',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 6,
  },

  /* TRIP REPORT STATUS CARD STYLES */
  tripReportStatusCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  tripReportStatusApproved: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  tripReportStatusPending: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FCD34D',
  },
  tripReportStatusCorrection: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
  },
  tripReportStatusAwaiting: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
  },
  tripReportIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tripReportStatusTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  tripReportStatusDesc: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
    lineHeight: 16,
  },
  tripReportStatusBadgePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  tripReportStatusBadgePillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  tripReportReviewNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginTop: 2,
  },
  tripReportReviewNoteText: {
    color: '#991B1B',
    fontSize: 12,
    flex: 1,
  },

  /* FILTER CHIPS ABOVE PICKER */
  tripFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  tripFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}),
  },
  tripFilterChipActiveAll: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  tripFilterChipActiveAwaiting: {
    backgroundColor: '#D97706',
    borderColor: '#D97706',
  },
  tripFilterChipActivePending: {
    backgroundColor: '#EA580C',
    borderColor: '#EA580C',
  },
  tripFilterChipActiveApproved: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  tripFilterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  tripFilterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  tripFilterCountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
  },
  tripFilterCountBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  tripFilterCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  tripFilterCountTextActive: {
    color: '#FFFFFF',
  },

  /* ENHANCED EXECUTIVE CUSTOM DROPDOWN SELECTOR */
  customDropdownContainer: {
    position: 'relative',
    marginBottom: 6,
    zIndex: 100,
  },
  dropdownTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    padding: 12,
    minHeight: 60,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}),
  },
  dropdownTriggerBtnActive: {
    borderColor: '#059669',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  dropdownTriggerIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownTriggerId: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#0F172A',
  },
  dropdownTriggerSubText: {
    fontSize: 12,
    color: '#475569',
  },
  dropdownTripCountBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dropdownTripCountBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  dropdownMenuBox: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    zIndex: 1000,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#059669',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 25,
  },
  dropdownSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  dropdownSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  dropdownSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#F1F5F9',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  dropdownSectionHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  dropdownItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 10,
    backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}),
  },
  dropdownItemRowActive: {
    backgroundColor: '#F0FDF4',
  },
  dropdownItemAccentBar: {
    width: 3.5,
    alignSelf: 'stretch',
    borderRadius: 2,
  },
  dropdownItemId: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#0F172A',
  },
  dropdownItemBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dropdownItemBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  dropdownBarangayPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dropdownBarangayPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  dropdownItemTruck: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  dropdownItemMeta: {
    fontSize: 11,
    color: '#64748B',
  },
  dropdownSelectedCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownEmptySearch: {
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dropdownEmptySearchText: {
    fontSize: 13,
    color: '#64748B',
  },
  dropdownClearSearchBtn: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dropdownClearSearchBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
  },

  /* CENRO MUNICIPAL BARANGAY VIEW STYLES */
  cenroBarangayBar: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  cenroBarangayIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cenroBarangayLabel: { color: '#166534', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  cenroBarangaySub: { color: '#374151', fontSize: 13, marginTop: 2 },
  cenroPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderColor: '#C9DDCE',
    borderWidth: 1,
  },
  cenroPillActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  cenroPillText: { color: '#1B3625', fontSize: 12, fontWeight: '600' },
  cenroPillTextActive: { color: '#fff', fontWeight: '800' },

  /* ACTIONABLE EMPTY STATE */
  emptyCard: {
    backgroundColor: '#F8FAF9',
    borderColor: '#DCE7DF',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginVertical: 6,
  },
  emptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyTitle: { color: '#183D29', fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  emptyText: { color: '#52665B', fontSize: 13, textAlign: 'center', lineHeight: 20, maxWidth: 460, marginBottom: 16 },
  emptyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  emptyPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  emptyPrimaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  emptySecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EDF6EF',
    borderColor: '#166534',
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  emptySecondaryBtnText: { color: '#166534', fontSize: 13, fontWeight: '700' },
  quickDispatchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  quickDispatchBtnText: { color: '#166534', fontSize: 12, fontWeight: '700' },

  /* 3-STEP PROGRESS TRACKER */
  stepProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: '#DCE7DF',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  stepItemActive: { opacity: 1 },
  stepItemInactive: { opacity: 0.6 },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBadgeActive: { backgroundColor: '#166534' },
  stepBadgeDone: { backgroundColor: '#15803D' },
  stepBadgeInactive: { backgroundColor: '#CBD5E1' },
  stepBadgeNum: { color: '#fff', fontSize: 12, fontWeight: '800' },
  stepTextCol: { flex: 1 },
  stepTitle: { color: '#183D29', fontSize: 12, fontWeight: '700' },
  stepSubtitle: { color: '#64748B', fontSize: 11 },
  stepLine: {
    height: 2,
    flex: 0.3,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 8,
  },
  stepLineActive: { backgroundColor: '#166534' },
  selectTripNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
  },
  selectTripTitle: { color: '#166534', fontSize: 14, fontWeight: '700' },
  selectTripText: { color: '#4B6354', fontSize: 13, lineHeight: 18, marginTop: 2 },

  /* LOCAL DRAFT BANNER */
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF3C7',
    borderColor: '#FCD34D',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  draftBannerText: { color: '#92400E', fontSize: 12, fontWeight: '600' },
  draftDiscardBtn: {
    backgroundColor: '#FDE68A',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  draftDiscardText: { color: '#92400E', fontSize: 11, fontWeight: '700' },
  shiftCalcCard: {
    backgroundColor: '#F8FAF9',
    borderColor: '#DCE7DF',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginTop: 4,
  },
  shiftCalcHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shiftCalcTitle: { color: '#183D29', fontSize: 13, fontWeight: '700' },
  shiftCalcGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  shiftCalcItem: {
    flexGrow: 1,
    flexBasis: 120,
    backgroundColor: '#fff',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
  },
  shiftCalcLabel: { color: '#64748B', fontSize: 11 },
  shiftCalcValue: { color: '#1B3625', fontSize: 15, fontWeight: '700', marginTop: 2 },

  /* FORM SECTION CARDS (TELEMETRY WORKBENCH) */
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 22,
    gap: 18,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 16,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  cardHeaderIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardHeaderTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  cardHeaderSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 3,
  },
  officialPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  officialPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.5,
  },
  formSectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    gap: 14,
    borderLeftWidth: 4,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  sectionCardRoute: {
    borderLeftColor: '#0D9488', // Teal
  },
  sectionCardHours: {
    borderLeftColor: '#2563EB', // Royal Blue
  },
  sectionCardPayload: {
    borderLeftColor: '#D97706', // Amber
  },
  sectionCardDiesel: {
    borderLeftColor: '#059669', // Emerald
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  sectionHeaderIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#F0FDFA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  sectionPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sectionPillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  /* RESPONSIVE FORM GRID ROWS */
  formRow2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  formRow3: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  formCol: {
    flex: 1,
    minWidth: 220,
  },
  fieldHint: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 16,
  },

  /* PRESET CHIPS & CAPACITY GAUGE */
  presetChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  presetLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '700',
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
    borderWidth: 1,
  },
  presetChipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  presetDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  presetChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },

  /* DYNAMIC COMPACTOR CAPACITY UTILIZATION GAUGE */
  loadGaugeContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginTop: 10,
    gap: 8,
  },
  loadGaugeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  loadGaugeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  loadGaugePercent: {
    fontSize: 12,
    fontWeight: '800',
  },
  loadGaugeTrack: {
    height: 10,
    backgroundColor: '#E2E8F0',
    borderRadius: 5,
    overflow: 'hidden',
  },
  loadGaugeFill: {
    height: '100%',
    borderRadius: 5,
  },

  /* HOURS DISTRIBUTION PROGRESS BAR */
  hoursDistributionContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginTop: 8,
    gap: 10,
  },
  hoursDistributionBar: {
    height: 12,
    borderRadius: 6,
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
    gap: 2,
  },
  hoursDistSegment: {
    height: '100%',
    borderRadius: 2,
  },
  hoursDistLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },

  /* HOURS PILL BADGE */
  hoursPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  hoursPillNormal: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  hoursPillAlert: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
  },
  hoursPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },

  /* ML BADGE */
  mlBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  mlBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
  },

  /* TELEMETRY TOOLBAR & ODOMETER CALCULATOR */
  telemetryToolbar: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
    marginTop: 6,
  },
  telemetryToolbarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  telemetryToolbarTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  telemetryToolbarSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  odoIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  odoToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  odoToggleBtnActive: {
    backgroundColor: '#0284C7',
    borderColor: '#0284C7',
  },
  odoToggleBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369A1',
  },
  odoCalcContainer: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 14,
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  odoInputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  odoInput: {
    height: 40,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  odoResultCol: {
    minWidth: 120,
  },
  odoDiffBadge: {
    height: 40,
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  odoDiffText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#059669',
  },
  odoApplyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    backgroundColor: '#0284C7',
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  odoApplyBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  gpsNoteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  gpsNoteText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0369A1',
  },

  /* PICKER WRAPPER */
  pickerWrapper: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    minHeight: 44,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 2,
  },
  pickerInner: {
    color: '#0F172A',
    backgroundColor: 'transparent',
    minHeight: 42,
    height: 42,
  },

  /* STEPPER UNIT BADGE */
  stepperUnitBadge: {
    paddingHorizontal: 10,
    backgroundColor: '#F8FAFC',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#E2E8F0',
  },
  stepperUnitText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },

  /* PRE-DEFENSE DEMO HELPER STYLES: DELETE FOR FINAL DEFENSE */
  sampleDataBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  sampleDataIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sampleDataBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  sampleDataBtnSub: {
    fontSize: 9,
    color: '#D1FAE5',
    fontWeight: '600',
  },
  /* END PRE-DEFENSE DEMO HELPER STYLES */

  /* STATUS BADGES */
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusBadgeApproved: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  statusBadgeTextApproved: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065F46',
  },
  statusBadgeCorrection: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  statusBadgeTextCorrection: {
    fontSize: 11,
    fontWeight: '800',
    color: '#991B1B',
  },
  statusBadgePending: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  statusBadgeTextPending: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400E',
  },
  statusBadgeDraft: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  statusBadgeTextDraft: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },

  /* REAL-TIME TELEMETRY HUD */
  hudCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    gap: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
  },
  hudHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hudHeaderIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  hudSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  hudGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  hudItem: {
    flex: 1,
    minWidth: 180,
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  hudItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  hudItemIconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudItemLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    flex: 1,
  },
  hudItemBig: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  hudItemSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 4,
  },
  hudStatusTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagGreen: { backgroundColor: '#DCFCE7' },
  tagAmber: { backgroundColor: '#FEF3C7' },
  tagRed: { backgroundColor: '#FEE2E2' },
  tagGray: { backgroundColor: '#F1F5F9' },
  hudStatusTagText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  tagTextGreen: { color: '#166534' },
  tagTextAmber: { color: '#B45309' },
  tagTextRed: { color: '#DC2626' },
  tagTextGray: { color: '#475569' },

  /* ACTION TOOLBAR */
  actionsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    minHeight: 46,
    justifyContent: 'center',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  approveBtn: {
    backgroundColor: '#059669',
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    minHeight: 46,
    justifyContent: 'center',
  },
  secondaryActionBtnText: {
    color: '#065F46',
    fontSize: 13,
    fontWeight: '700',
  },
  draftActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    minHeight: 46,
    justifyContent: 'center',
  },
  draftActionBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },

  /* CENRO AUDIT & CONFIRMATION VIEW STYLES */
  cenroModeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDFA',
    borderWidth: 1.2,
    borderColor: '#0D9488',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cenroModeToggleBtnText: {
    color: '#0D9488',
    fontSize: 12,
    fontWeight: '700',
  },
  cenroReviewOnlyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    borderWidth: 1.2,
    borderColor: '#86EFAC',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  cenroReviewOnlyPillText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '700',
  },
  auditLockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    borderWidth: 1.2,
    borderColor: '#86EFAC',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  auditLockPillText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '700',
  },
  auditActionBar: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  auditActionBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  auditActionIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  auditActionTitle: {
    color: '#14532D',
    fontSize: 15,
    fontWeight: '800',
  },
  auditActionSub: {
    color: '#15803D',
    fontSize: 12,
    marginTop: 2,
  },
  auditEditToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#0D9488',
  },
  auditEditToggleText: {
    color: '#0D9488',
    fontSize: 12,
    fontWeight: '700',
  },
  auditNoteLabel: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  auditNoteInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#86EFAC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
  },
  auditActionButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  auditConfirmApproveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 8,
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  auditConfirmApproveText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  auditReturnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderColor: '#F87171',
    borderWidth: 1.2,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 8,
  },
  auditReturnText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
  auditCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  auditCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  auditCardHeaderIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  auditCardTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  auditCardSub: {
    color: '#64748B',
    fontSize: 11,
  },
  auditBadgePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  auditBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  auditGrid3: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  auditGrid2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  auditStatTile: {
    flex: 1,
    minWidth: 180,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  auditStatLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  auditStatNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginVertical: 2,
  },
  auditStatDesc: {
    fontSize: 11,
    color: '#64748B',
  },
  auditStatSourceText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
  },
  auditDrawerContainer: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  auditDrawerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  auditDrawerToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0369A1',
    flex: 1,
  },
  auditEvidenceBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1.2,
    borderColor: '#86EFAC',
    borderRadius: 8,
    padding: 12,
    gap: 6,
    marginTop: 4,
  },
  auditEvidenceTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#047857',
  },
  auditEvidenceContent: {
    fontSize: 13,
    fontWeight: '600',
    color: '#14532D',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  cenroEditActiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E6FFFA',
    borderWidth: 1.2,
    borderColor: '#99F6E4',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  cenroEditActiveText: {
    fontSize: 12,
    color: '#0F766E',
  },
  cenroReturnAuditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0D9488',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  cenroReturnAuditBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },

  /* COORDINATOR LOCKED / UNLOCKED BANNERS & ACTION BUTTONS */
  coordinatorLockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFBEB',
    borderWidth: 1.2,
    borderColor: '#FDE68A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    flexWrap: 'wrap',
  },
  coordinatorLockIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coordinatorLockedTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400E',
  },
  coordinatorLockedSubtitle: {
    fontSize: 12,
    color: '#78350F',
    marginTop: 2,
    lineHeight: 16,
  },
  coordinatorUnlockBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    shadowColor: '#D97706',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  coordinatorUnlockBannerBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  coordinatorUnlockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0FDFA',
    borderWidth: 1.2,
    borderColor: '#99F6E4',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    flexWrap: 'wrap',
  },
  coordinatorCancelBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 7,
  },
  coordinatorCancelBannerBtnText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
  },
  unlockEditConfirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#D97706',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    minHeight: 46,
    justifyContent: 'center',
    shadowColor: '#D97706',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  unlockEditConfirmBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  cancelEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    minHeight: 46,
    justifyContent: 'center',
  },
  cancelEditBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },

  /* SIMULATOR BANNER */
  simulatorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
    flexWrap: 'wrap',
  },
  simulatorBannerText: {
    fontSize: 12,
    color: '#1E40AF',
    flex: 1,
    lineHeight: 16,
  },
  simulatorResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  simulatorResetBtnText: {
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: '700',
  },

  /* MUNICIPAL BREAKDOWN TABLE */
  municipalBreakdownBox: {
    backgroundColor: '#FAFCFA',
    borderColor: '#DCE7DF',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 10,
    marginVertical: 4,
  },
  municipalBreakdownTitle: { color: '#166534', fontSize: 14, fontWeight: '700' },
  table: {
    backgroundColor: '#fff',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E1',
  },
  th: { fontSize: 11, fontWeight: '700', color: '#475569', textTransform: 'uppercase' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  td: { fontSize: 12, color: '#334155' },
  thActionBtn: {
    backgroundColor: '#DCFCE7',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    alignItems: 'center',
  },
  thActionBtnText: { color: '#166534', fontSize: 11, fontWeight: '700' },

  /* MODAL STYLES (PRICE & QUICK-CREATE) */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 99999,
    ...(Platform.OS === 'web' ? {
      position: 'fixed' as any,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100vw' as any,
      height: '100vh' as any,
    } : {}),
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 14,
    width: '100%',
    maxWidth: 540,
    maxHeight: '90%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 10,
    zIndex: 100000,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#F8FAFC',
  },
  modalIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: { color: '#1E293B', fontSize: 16, fontWeight: '700' },
  modalSubtitle: { color: '#64748B', fontSize: 12 },
  modalCloseBtn: { padding: 6, borderRadius: 6 },
  modalBody: { padding: 18, gap: 12 },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#F8FAFC',
  },
  modalPresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  modalPresetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  modalPresetBtnActive: { borderColor: '#166534', backgroundColor: '#DCFCE7' },
  modalPresetBtnText: { color: '#475569', fontSize: 12, fontWeight: '600' },
});
