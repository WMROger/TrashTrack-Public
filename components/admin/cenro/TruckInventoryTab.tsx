import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  useWindowDimensions,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import {
  collection,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
  getDocs,
  getDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { DANAO_CITY_BARANGAYS } from '../../../constants/danaoBarangays';
import DriverQrBadgeModal from '../../driver/DriverQrBadgeModal';
import FleetInventoryQrBadgeModal from './FleetInventoryQrBadgeModal';
import { ensureDriverQrToken } from '@/services/driverQrService';
import { calculateShiftTiming } from '@/services/fleetInventoryQrService';
import ExportModal from './ExportModal';
import { exportReport, ExportFormat } from '@/services/reportExportService';

interface Truck {
  id: string;
  plateNumber: string;
  type: string;
  capacity: string;
  status: 'active' | 'maintenance' | 'out_of_service';
  assignedDriverId?: string;
  assignedDriverName?: string;
  lastDriverId?: string;
  lastDriverName?: string;
  lastUsedAt?: any;
  assignedBarangay?: string;
  barangay?: string;
  shiftStartedAt?: any;
  createdAt: any;
}

interface TruckInventoryTabProps {
  userRole?: string;
  assignedBarangay?: string;
  isReadOnly?: boolean;
}

export default function TruckInventoryTab({
  userRole = 'admin',
  assignedBarangay = '',
  isReadOnly = false,
}: TruckInventoryTabProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const isCoordinator = userRole === 'coordinator';
  const effectiveCoordinatorBarangay = (assignedBarangay || '').trim();

  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(true);
  const [driverBarangayMap, setDriverBarangayMap] = useState<Record<string, string>>({});
  const [driverNameMap, setDriverNameMap] = useState<Record<string, string>>({});
  const [activeDriverByTruck, setActiveDriverByTruck] = useState<Record<string, { id: string; name: string; email?: string; startedAt?: any }>>({});
  const [recentDriverByTruck, setRecentDriverByTruck] = useState<Record<string, { id: string; name: string; email?: string; timestamp?: any }>>({});

  // Filter State (for CENRO Admin)
  const [selectedBarangayFilter, setSelectedBarangayFilter] = useState<string>('all');
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  const [filterSearchQuery, setFilterSearchQuery] = useState('');

  // Form State
  const [plateNumber, setPlateNumber] = useState('');
  const [truckType, setTruckType] = useState('Compactor');
  const [capacity, setCapacity] = useState('');
  const [selectedBarangayForNewTruck, setSelectedBarangayForNewTruck] = useState<string>(
    isCoordinator && effectiveCoordinatorBarangay ? effectiveCoordinatorBarangay : 'Poblacion'
  );
  const [isNewTruckBarangayDropdownOpen, setIsNewTruckBarangayDropdownOpen] = useState(false);
  const [newTruckBarangaySearchQuery, setNewTruckBarangaySearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [plateError, setPlateError] = useState<string | null>(null);

  const filteredNewTruckBarangays = useMemo(() => {
    if (!newTruckBarangaySearchQuery.trim()) return DANAO_CITY_BARANGAYS;
    const q = newTruckBarangaySearchQuery.toLowerCase().trim();
    return DANAO_CITY_BARANGAYS.filter((b) => b.toLowerCase().includes(q));
  }, [newTruckBarangaySearchQuery]);

  // History Modal State
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [selectedTruck, setSelectedTruck] = useState<Truck | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'week' | 'month' | 'all'>('week');
  const [truckHistory, setTruckHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});

  const toggleSession = (sessionId: string) => {
    setExpandedSessions((prev) => ({
      ...prev,
      [sessionId]: !prev[sessionId],
    }));
  };

  // Driver QR Badge State (CENRO Onboarding / Fleet verification)
  const [driverQrModalVisible, setDriverQrModalVisible] = useState(false);
  const [selectedDriverForQr, setSelectedDriverForQr] = useState<any>(null);
  const [fetchingDriverQr, setFetchingDriverQr] = useState(false);

  // Fleet Inventory QR Badge State
  const [fleetQrModalVisible, setFleetQrModalVisible] = useState(false);
  const [selectedTruckForFleetQr, setSelectedTruckForFleetQr] = useState<Truck | null>(null);

  // Unassign Driver Modal & Feedback State
  const [unassignModalVisible, setUnassignModalVisible] = useState(false);
  const [truckToUnassign, setTruckToUnassign] = useState<Truck | null>(null);
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Status Change Confirmation Modal State
  const [statusConfirmModalVisible, setStatusConfirmModalVisible] = useState(false);
  const [truckToChangeStatus, setTruckToChangeStatus] = useState<Truck | null>(null);
  const [targetStatusToApply, setTargetStatusToApply] = useState<'active' | 'maintenance' | 'out_of_service'>('active');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Assign Driver Modal State
  const [assignDriverModalVisible, setAssignDriverModalVisible] = useState(false);
  const [truckToAssignDriver, setTruckToAssignDriver] = useState<Truck | null>(null);
  const [selectedDriverIdToAssign, setSelectedDriverIdToAssign] = useState<string>('');
  const [driverSearchQuery, setDriverSearchQuery] = useState('');
  const [isAssigningDriver, setIsAssigningDriver] = useState(false);
  const [allDriversList, setAllDriversList] = useState<any[]>([]);
  const [driversLoaded, setDriversLoaded] = useState(false);

  // Assign Barangay Modal State (CENRO only)
  const [assignBarangayModalVisible, setAssignBarangayModalVisible] = useState(false);
  const [truckToAssignBarangay, setTruckToAssignBarangay] = useState<Truck | null>(null);
  const [targetBarangay, setTargetBarangay] = useState<string>('Poblacion');
  const [assignSearchQuery, setAssignSearchQuery] = useState('');
  const [isSavingBarangay, setIsSavingBarangay] = useState(false);

  // Fleet Summary Card Filter & Sort State
  type FleetStatusFilter = 'all' | 'active' | 'deployed' | 'maintenance' | 'out_of_service';
  const [statusFilter, setStatusFilter] = useState<FleetStatusFilter>('all');
  const [sortColumn, setSortColumn] = useState<'plate' | 'barangay' | 'capacity' | 'status' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const normalizeBrgy = (str?: string) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/^brgy\.?\s*/i, '')
      .replace(/^barangay\s*/i, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  };

  const getResolvedTruckStatus = useCallback((status?: string): 'active' | 'maintenance' | 'out_of_service' => {
    const s = String(status || '').toLowerCase().trim();
    if (s === 'maintenance') return 'maintenance';
    if (s === 'out_of_service' || s === 'inactive' || s === 'decommissioned') return 'out_of_service';
    return 'active';
  }, []);

  useEffect(() => {
    if (!db || trucks.length === 0) return;
    const misconfigured = trucks.filter(
      (t) => (t as any).status === 'available' || (t as any).status === 'assigned'
    );
    if (misconfigured.length === 0) return;
    misconfigured.forEach((t) => {
      updateDoc(doc(db, 'trucks', t.id), {
        status: 'active',
        updatedAt: serverTimestamp(),
      }).catch((e) => console.warn('[TruckInventoryTab] Auto-repair truck status error:', e));
    });
  }, [trucks]);

  const getTruckBarangay = (t: Truck): string => {
    if (t.assignedBarangay && t.assignedBarangay.trim()) return t.assignedBarangay.trim();
    if (t.barangay && t.barangay.trim()) return t.barangay.trim();
    if (t.assignedDriverId && driverBarangayMap[t.assignedDriverId]) {
      return driverBarangayMap[t.assignedDriverId].trim();
    }
    return '';
  };

  const handlePlateChange = (text: string) => {
    const cleaned = text.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8);
    setPlateNumber(cleaned);
    if (cleaned.length > 0 && cleaned.length < 6) {
      setPlateError('Plate number must be 6–8 characters (e.g. ABC-1234)');
    } else {
      setPlateError(null);
    }
  };

  // Listen to trucks
  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, 'trucks'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: Truck[] = [];
      snapshot.forEach((docSnap) => {
        data.push({ id: docSnap.id, ...docSnap.data() } as Truck);
      });
      setTrucks(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Listen to users to map drivers to their assigned barangay and track active/recent truck assignments
  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const bMap: Record<string, string> = {};
      const nameMap: Record<string, string> = {};
      const activeMap: Record<string, { id: string; name: string; email?: string; startedAt?: any }> = {};
      const recentMap: Record<string, { id: string; name: string; email?: string; timestamp?: any }> = {};
      const dList: any[] = [];

      snap.forEach((docSnap) => {
        const u = docSnap.data();
        const b = (u.assignedBarangay || u.barangay || '').trim();
        if (b) {
          bMap[docSnap.id] = b;
        }

        const dName = (u.displayName || u.name || u.fullName || u.email || 'Driver').trim();
        nameMap[docSnap.id] = dName;

        const tId = u.currentTruckId;
        const tPlate = u.currentTruckPlate || u.assignedTruck;
        const isOnDuty = u.dutyStatus === 'on_duty' || u.status === 'on_duty';

        if (u.role === 'driver' && u.disabled !== true && u.status !== 'disabled') {
          dList.push({
            id: docSnap.id,
            name: dName,
            email: u.email || '',
            employeeId: u.employeeId || '',
            licenseNumber: u.licenseNumber || '',
            assignedBarangay: b,
            currentTruckId: tId || null,
            currentTruckPlate: tPlate || null,
            dutyStatus: u.dutyStatus || u.status || 'off_duty',
          });
        }

        const isDriverActive = u.role === 'driver' && u.disabled !== true && u.status !== 'disabled';

        if (isOnDuty && (tId || tPlate) && isDriverActive) {
          const info = { id: docSnap.id, name: dName, email: u.email, startedAt: u.updatedAt };
          if (tId) activeMap[tId] = info;
          if (tPlate) activeMap[tPlate] = info;
        }

        if ((tId || tPlate) && isDriverActive) {
          const info = { id: docSnap.id, name: dName, email: u.email, timestamp: u.updatedAt };
          if (tId && !recentMap[tId]) recentMap[tId] = info;
          if (tPlate && !recentMap[tPlate]) recentMap[tPlate] = info;
        }

        if ((u.unassignedNotice?.truckPlate || u.unassignedNotice?.truckId) && isDriverActive) {
          const noticePlate = u.unassignedNotice.truckPlate;
          const noticeId = u.unassignedNotice.truckId;
          const info = { id: docSnap.id, name: dName, email: u.email, timestamp: u.unassignedNotice.unassignedAt };
          if (noticeId && !recentMap[noticeId]) recentMap[noticeId] = info;
          if (noticePlate && !recentMap[noticePlate]) recentMap[noticePlate] = info;
        }
      });

      setAllDriversList(dList);
      setDriverBarangayMap(bMap);
      setDriverNameMap(nameMap);
      setActiveDriverByTruck(activeMap);
      setRecentDriverByTruck(recentMap);
      setDriversLoaded(true);
    });
    return () => unsub();
  }, []);

  // Auto-clean orphaned driver assignments in trucks if driver is deleted or disabled
  useEffect(() => {
    if (!db || !driversLoaded || trucks.length === 0) return;

    const orphanedTrucks = trucks.filter((t) => {
      if (!t.assignedDriverId && !t.assignedDriverName) return false;
      const valid = allDriversList.some((d) => d.id === t.assignedDriverId);
      return !valid;
    });

    if (orphanedTrucks.length === 0) return;

    const cleanup = async () => {
      try {
        const batch = writeBatch(db);
        orphanedTrucks.forEach((t) => {
          batch.update(doc(db, 'trucks', t.id), {
            assignedDriverId: null,
            assignedDriverName: null,
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
        console.log(`[TruckInventoryTab] Auto-cleaned ${orphanedTrucks.length} orphaned driver assignment(s) in trucks.`);
      } catch (err) {
        console.warn('[TruckInventoryTab] Failed to auto-clean orphaned truck assignments:', err);
      }
    };
    cleanup();
  }, [trucks, allDriversList, driversLoaded]);

  const getValidDriver = useCallback(
    (truck: Truck) => {
      if (!truck.assignedDriverId) return null;
      const d = allDriversList.find((driver) => driver.id === truck.assignedDriverId);
      return d || null;
    },
    [allDriversList]
  );

  const filteredDriversToAssign = useMemo(() => {
    let list = [...allDriversList];

    // Strictly filter to certified drivers registered to the truck's assigned barangay
    if (truckToAssignDriver) {
      const truckBrgy = getTruckBarangay(truckToAssignDriver);
      const normalizedTruckBrgy = normalizeBrgy(truckBrgy);
      if (normalizedTruckBrgy) {
        list = list.filter((d) => normalizeBrgy(d.assignedBarangay) === normalizedTruckBrgy);
      } else {
        // If the truck has no assigned barangay yet, no drivers match
        list = [];
      }
    }

    if (driverSearchQuery.trim()) {
      const q = driverSearchQuery.toLowerCase().trim();
      list = list.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.employeeId?.toLowerCase().includes(q) ||
          d.assignedBarangay?.toLowerCase().includes(q) ||
          d.licenseNumber?.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => {
      const aHasTruck = Boolean(a.currentTruckPlate && a.currentTruckPlate !== truckToAssignDriver?.plateNumber);
      const bHasTruck = Boolean(b.currentTruckPlate && b.currentTruckPlate !== truckToAssignDriver?.plateNumber);
      if (aHasTruck !== bHasTruck) return aHasTruck ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [allDriversList, driverSearchQuery, truckToAssignDriver, driverBarangayMap]);

  // Compute map of which barangays currently have trucks
  const barangaysWithTrucks = useMemo(() => {
    const counts: Record<string, number> = {};
    trucks.forEach((t) => {
      const b = getTruckBarangay(t);
      if (b) {
        counts[b] = (counts[b] || 0) + 1;
      }
    });
    return counts;
  }, [trucks, driverBarangayMap]);

  const isTruckDeployed = useCallback(
    (t: Truck) => {
      if (
        activeDriverByTruck[t.id]?.name ||
        activeDriverByTruck[t.plateNumber]?.name
      ) {
        return true;
      }
      if (t.assignedDriverId) {
        const driver = allDriversList.find((d) => d.id === t.assignedDriverId);
        return Boolean(driver && (driver.dutyStatus === 'on_duty' || driver.status === 'on_duty'));
      }
      return false;
    },
    [activeDriverByTruck, allDriversList]
  );

  // Filter trucks based on user role and selected barangay filter
  const scopedTrucks = useMemo(() => {
    // 1. If Coordinator: strictly lock to their barangay
    if (isCoordinator && effectiveCoordinatorBarangay) {
      const normalizedCoord = normalizeBrgy(effectiveCoordinatorBarangay);
      return trucks.filter((t) => {
        const b = getTruckBarangay(t);
        return normalizeBrgy(b) === normalizedCoord;
      });
    }

    // 2. If CENRO Admin: apply barangay filter
    if (selectedBarangayFilter === 'all') {
      return trucks;
    }
    if (selectedBarangayFilter === 'unassigned') {
      return trucks.filter((t) => !getTruckBarangay(t));
    }
    const normalizedFilter = normalizeBrgy(selectedBarangayFilter);
    return trucks.filter((t) => normalizeBrgy(getTruckBarangay(t)) === normalizedFilter);
  }, [trucks, isCoordinator, effectiveCoordinatorBarangay, selectedBarangayFilter, driverBarangayMap]);

  // Status counts derived from the scoped fleet
  const activeCount = useMemo(() => scopedTrucks.filter((t) => getResolvedTruckStatus(t.status) === 'active').length, [scopedTrucks, getResolvedTruckStatus]);
  const maintenanceCount = useMemo(() => scopedTrucks.filter((t) => getResolvedTruckStatus(t.status) === 'maintenance').length, [scopedTrucks, getResolvedTruckStatus]);
  const outCount = useMemo(() => scopedTrucks.filter((t) => getResolvedTruckStatus(t.status) === 'out_of_service').length, [scopedTrucks, getResolvedTruckStatus]);
  const deployedCount = useMemo(() => scopedTrucks.filter(isTruckDeployed).length, [scopedTrucks, isTruckDeployed]);

  // Displayed trucks filtered by summary card filter and sorted by column
  const displayedTrucks = useMemo(() => {
    let result = [...scopedTrucks];

    // Filter by status if summary card clicked
    if (statusFilter === 'active') {
      result = result.filter((t) => getResolvedTruckStatus(t.status) === 'active');
    } else if (statusFilter === 'deployed') {
      result = result.filter(isTruckDeployed);
    } else if (statusFilter === 'maintenance') {
      result = result.filter((t) => getResolvedTruckStatus(t.status) === 'maintenance');
    } else if (statusFilter === 'out_of_service') {
      result = result.filter((t) => getResolvedTruckStatus(t.status) === 'out_of_service');
    }

    // Sort by column if selected
    if (sortColumn) {
      result.sort((a, b) => {
        let cmp = 0;
        if (sortColumn === 'plate') {
          cmp = (a.plateNumber || '').localeCompare(b.plateNumber || '');
        } else if (sortColumn === 'barangay') {
          cmp = getTruckBarangay(a).localeCompare(getTruckBarangay(b));
        } else if (sortColumn === 'capacity') {
          const capA = parseFloat(a.capacity) || 0;
          const capB = parseFloat(b.capacity) || 0;
          cmp = capA - capB;
        } else if (sortColumn === 'status') {
          cmp = (a.status || '').localeCompare(b.status || '');
        }
        return sortDirection === 'desc' ? -cmp : cmp;
      });
    }

    return result;
  }, [scopedTrucks, statusFilter, isTruckDeployed, sortColumn, sortDirection, driverBarangayMap, getResolvedTruckStatus]);

  const [isExportModalVisible, setIsExportModalVisible] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    const headers = [
      'Plate Number',
      'Truck Type',
      'Capacity (Tons)',
      'Assigned Driver',
      'Assigned Barangay',
      'Operational Status',
      'Deployment State',
    ];

    const rows = displayedTrucks.map((t) => [
      t.plateNumber || 'N/A',
      t.type || 'Compactor',
      `${t.capacity || 'N/A'} tons`,
      t.assignedDriverName || (t.assignedDriverId ? driverNameMap[t.assignedDriverId] : '') || 'Unassigned',
      getTruckBarangay(t) || 'Unassigned',
      t.status ? t.status.toUpperCase() : 'ACTIVE',
      isTruckDeployed(t) ? 'DEPLOYED' : 'STANDBY',
    ]);

    const jurisdictionScope =
      isCoordinator && effectiveCoordinatorBarangay
        ? `Brgy. ${effectiveCoordinatorBarangay}`
        : selectedBarangayFilter !== 'all'
        ? `Brgy. ${selectedBarangayFilter}`
        : 'City of Danao (All Barangays)';

    await exportReport({
      format,
      filename: `danao_truck_inventory_${new Date().toISOString().slice(0, 10)}`,
      title: 'Municipal Truck Fleet Inventory Report',
      subtitle: 'City Environment & Natural Resources Office Fleet Operations Registry',
      jurisdiction: jurisdictionScope,
      generatedBy: isCoordinator ? 'Barangay Coordinator' : 'CENRO Fleet Admin',
      headers,
      rows,
      summaryCards: [
        { label: 'Total Fleet', value: displayedTrucks.length },
        { label: 'Active Trucks', value: displayedTrucks.filter((t) => t.status === 'active').length },
        { label: 'Deployed', value: displayedTrucks.filter(isTruckDeployed).length },
        { label: 'In Maintenance', value: displayedTrucks.filter((t) => t.status === 'maintenance').length },
      ],
      sheetName: 'Truck_Fleet',
    });
  };

  const toggleSort = (col: 'plate' | 'barangay' | 'capacity' | 'status') => {
    if (sortColumn === col) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumn(null);
        setSortDirection('asc');
      }
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const handleAddTruck = async () => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Registering trucks is restricted in Read-Only Mode.');
      return;
    }
    const normalizedPlate = plateNumber.toUpperCase().trim();
    const normalizedCapacity = capacity.trim();

    if (!normalizedPlate || !normalizedCapacity) {
      Alert.alert('Missing Fields', 'Please fill in the plate number and capacity.');
      return;
    }

    if (normalizedPlate.length < 6 || normalizedPlate.length > 8) {
      Alert.alert(
        'Invalid Plate Number',
        'Standard vehicle plate numbers must be 6 to 8 characters long (e.g. ABC-1234).'
      );
      return;
    }

    const isDuplicate = trucks.some(
      (t) => t.plateNumber?.toUpperCase().replace(/\s+/g, '') === normalizedPlate.replace(/\s+/g, '')
    );
    if (isDuplicate) {
      Alert.alert(
        'Duplicate Plate Number',
        `A truck unit with plate number "${normalizedPlate}" already exists in the fleet inventory.`
      );
      return;
    }

    const capNum = parseFloat(normalizedCapacity);
    if (isNaN(capNum) || capNum <= 0 || capNum > 100) {
      Alert.alert('Invalid Capacity', 'Please enter a valid capacity in tons (between 0.5 and 100).');
      return;
    }

    const bToAssign = isCoordinator
      ? effectiveCoordinatorBarangay
      : selectedBarangayForNewTruck.trim() || 'Poblacion';

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'trucks'), {
        plateNumber: normalizedPlate,
        type: truckType,
        capacity: normalizedCapacity,
        status: 'active',
        assignedBarangay: bToAssign,
        barangay: bToAssign,
        createdAt: serverTimestamp(),
      });

      setPlateNumber('');
      setCapacity('');
      setPlateError(null);
      setShowAddForm(false);
      Alert.alert(
        'Success',
        `Truck ${normalizedPlate} registered successfully and assigned to Brgy. ${bToAssign}.`
      );
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'Failed to add truck.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusMeta = (status: 'active' | 'maintenance' | 'out_of_service') => {
    switch (status) {
      case 'active':
        return {
          label: 'Active',
          title: 'Set Status to Active',
          subtitle: 'Reactivate truck for municipal collection service',
          badgeBg: '#ECFDF5',
          badgeBorder: '#A7F3D0',
          color: '#059669',
          icon: 'check-circle' as const,
          description:
            'Restores this vehicle to active operational service. The truck will be eligible for collection route dispatches and driver vehicle selection.',
          btnText: 'Confirm: Mark Active',
          btnBg: '#059669',
        };
      case 'maintenance':
        return {
          label: 'Under Maintenance',
          title: 'Set Status to Maintenance',
          subtitle: 'Flag vehicle for repairs, maintenance, or mechanical inspection',
          badgeBg: '#FFFBEB',
          badgeBorder: '#FDE68A',
          color: '#D97706',
          icon: 'build' as const,
          description:
            'Flags this vehicle as under maintenance. Drivers cannot select or drive this truck for active waste collection runs until maintenance is marked complete.',
          btnText: 'Confirm: Set Maintenance',
          btnBg: '#D97706',
        };
      case 'out_of_service':
        return {
          label: 'Out of Service',
          title: 'Set Status to Out of Service',
          subtitle: 'Decommission or temporarily bench this vehicle from fleet operations',
          badgeBg: '#FEF2F2',
          badgeBorder: '#FECACA',
          color: '#DC2626',
          icon: 'block' as const,
          description:
            'Removes this truck from the active municipal fleet. It will be excluded from route operations and driver assignment until reactivated by an administrator.',
          btnText: 'Confirm: Out of Service',
          btnBg: '#DC2626',
        };
    }
  };

  const handlePromptChangeStatus = (
    truck: Truck,
    newStatus: 'active' | 'maintenance' | 'out_of_service'
  ) => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Updating truck operational status is restricted in Read-Only Mode.');
      return;
    }
    setTruckToChangeStatus(truck);
    setTargetStatusToApply(newStatus);
    setStatusConfirmModalVisible(true);
  };

  const confirmUpdateStatus = async () => {
    if (!truckToChangeStatus || !db) return;
    setIsUpdatingStatus(true);
    const target = targetStatusToApply;
    const truckId = truckToChangeStatus.id;
    const plate = truckToChangeStatus.plateNumber || 'Truck';
    const meta = getStatusMeta(target);

    try {
      await updateDoc(doc(db, 'trucks', truckId), {
        status: target,
        updatedAt: serverTimestamp(),
      });

      // Log status transition in history
      try {
        await addDoc(collection(db, 'truck_usage_history'), {
          truckId: truckId,
          truckPlate: plate,
          driverId: truckToChangeStatus.assignedDriverId || '',
          driverName: truckToChangeStatus.assignedDriverName || '',
          action: `status_changed_to_${target}`,
          previousStatus: truckToChangeStatus.status || 'unknown',
          newStatus: target,
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
          status: target,
          updatedBy: isCoordinator ? `Brgy. ${effectiveCoordinatorBarangay} Coordinator` : 'CENRO Fleet Admin',
        });
      } catch (histErr) {
        console.warn('Could not log status change to truck_usage_history:', histErr);
      }

      setStatusConfirmModalVisible(false);
      setTruckToChangeStatus(null);

      setFeedbackToast({
        message: `Truck ${plate} operational status updated to ${meta.label}.`,
        type: 'success',
      });
      setTimeout(() => setFeedbackToast(null), 5000);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'Failed to update truck status.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleUpdateStatus = (id: string, newStatus: string) => {
    const foundTruck = trucks.find((t) => t.id === id);
    if (foundTruck) {
      handlePromptChangeStatus(foundTruck, newStatus as any);
    }
  };

  const handleOpenDriverQrBadge = async (truck: Truck) => {
    if (!truck.assignedDriverId || !db) {
      Alert.alert('No Driver Assigned', 'This vehicle currently does not have an assigned driver.');
      return;
    }
    setFetchingDriverQr(true);
    try {
      const driverSnap = await getDoc(doc(db, 'users', truck.assignedDriverId));
      if (driverSnap.exists()) {
        const data = driverSnap.data();
        const qrLoginToken = data.qrLoginToken || await ensureDriverQrToken(truck.assignedDriverId, data.employeeId);
        let authKey: string | undefined = undefined;
        try {
          const credSnap = await getDoc(doc(db, 'driver_qr_credentials', truck.assignedDriverId));
          if (credSnap.exists()) {
            authKey = credSnap.data()?.authKey;
          }
        } catch {}
        setSelectedDriverForQr({
          uid: truck.assignedDriverId,
          name: data.displayName || data.name || truck.assignedDriverName || 'Official Driver',
          email: data.email || '',
          employeeId: data.employeeId || 'DRV-OFFICIAL',
          qrLoginToken,
          authKey,
          assignedBarangay: data.assignedBarangay || truck.assignedBarangay || 'Danao City',
          plateNumber: truck.plateNumber || data.plateNumber,
          contactNumber: data.phone || data.contactNumber,
          licenseNumber: data.licenseNumber,
        });
        setDriverQrModalVisible(true);
      } else {
        Alert.alert('Driver Record', 'Could not locate driver user account details.');
      }
    } catch (err) {
      console.error('Error fetching driver for QR badge:', err);
      Alert.alert('Error', 'Failed to retrieve driver profile for QR badge.');
    } finally {
      setFetchingDriverQr(false);
    }
  };

  const handleOpenFleetInventoryQr = (truck: Truck) => {
    if (!truck.assignedDriverId) {
      Alert.alert('No Driver Assigned', 'Please assign a driver to this vehicle before generating the shift QR badge.');
      return;
    }
    setSelectedTruckForFleetQr(truck);
    setFleetQrModalVisible(true);
  };

  const handleOpenUnassignModal = (truck: Truck) => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Unassigning drivers is restricted in Read-Only Mode.');
      return;
    }
    setTruckToUnassign(truck);
    setUnassignModalVisible(true);
  };

  const executeUnassignDriver = async () => {
    if (!truckToUnassign || !db) return;
    setIsUnassigning(true);

    const truckId = truckToUnassign.id;
    const driverId = truckToUnassign.assignedDriverId;
    const driverName = truckToUnassign.assignedDriverName || 'Driver';
    const plateNum = truckToUnassign.plateNumber;

    try {
      let timeInDate: Date | null = null;
      let durationFormatted: string = '';
      let durationMinutes: number = 0;
      if (truckToUnassign.shiftStartedAt) {
        const timing = calculateShiftTiming(truckToUnassign.shiftStartedAt);
        timeInDate = timing.timeIn;
        durationFormatted = timing.durationFormatted;
        durationMinutes = timing.durationMinutes;
      }

      // 1. Clear driver assignment from the truck, but record lastDriver
      await updateDoc(doc(db, 'trucks', truckId), {
        assignedDriverId: null,
        assignedDriverName: null,
        shiftStartedAt: null,
        lastDriverId: driverId || null,
        lastDriverName: driverName,
        lastUsedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      try {
        await addDoc(collection(db, 'truck_usage_history'), {
          truckId: truckId,
          truckPlate: plateNum || '',
          driverId: driverId || '',
          driverName: driverName,
          action: 'unassigned_by_admin',
          timeIn: timeInDate,
          timeOut: serverTimestamp(),
          durationMinutes,
          durationFormatted,
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
          status: 'unassigned',
        });
      } catch (histErr) {
        console.warn('Could not log unassign to truck_usage_history:', histErr);
      }

      // 2. Clear truck assignment from the driver's user document
      if (driverId) {
        try {
          await updateDoc(doc(db, 'users', driverId), {
            currentTruckId: null,
            currentTruckPlate: null,
            assignedTruck: null,
            status: 'off_duty',
            dutyStatus: 'off_duty',
            unassignedNotice: {
              truckPlate: plateNum || 'Assigned Truck',
              truckId: truckId,
              unassignedAt: new Date().toISOString(),
              unassignedBy: isCoordinator ? `Brgy. ${effectiveCoordinatorBarangay} Coordinator` : 'CENRO Fleet Admin',
              acknowledged: false,
            },
            updatedAt: serverTimestamp(),
          });
        } catch (userErr) {
          console.warn('Could not clear driver user doc:', userErr);
        }

        try {
          await addDoc(collection(db, 'notifications'), {
            userId: driverId,
            title: '🚛 Shift Ended',
            message: `Your shift on truck ${plateNum || ''} has been ended by ${isCoordinator ? `Brgy. ${effectiveCoordinatorBarangay} Coordinator` : 'CENRO Fleet Management'}.`,
            type: 'truck_unassigned',
            read: false,
            createdAt: serverTimestamp(),
          });
        } catch (notifErr) {
          console.warn('Could not send shift end notification:', notifErr);
        }

        try {
          const empQ = query(collection(db, 'employee_ids'), where('userId', '==', driverId));
          const empSnap = await getDocs(empQ);
          empSnap.forEach(async (d) => {
            await updateDoc(d.ref, {
              assignedTruckId: null,
              assignedTruckPlate: null,
              updatedAt: serverTimestamp(),
            });
          });
        } catch (empErr) {
          console.warn('Could not update employee_ids doc:', empErr);
        }

        // Deactivate live telemetry if active
        try {
          await updateDoc(doc(db, 'truck_locations', driverId), {
            status: 'inactive',
            isSimulation: false,
            isSimulated: false,
            speedKph: 0,
            lastUpdate: serverTimestamp(),
          });
        } catch (locErr) {
          // May not exist in truck_locations if never driven
        }
      }

      setUnassignModalVisible(false);
      setTruckToUnassign(null);
      setFeedbackToast({
        message: `Successfully ended shift for ${driverName} on truck ${plateNum}.`,
        type: 'success',
      });
      setTimeout(() => setFeedbackToast(null), 5000);
    } catch (e: any) {
      console.error('Failed to end shift:', e);
      Alert.alert('Error', e.message || 'Failed to end shift.');
    } finally {
      setIsUnassigning(false);
    }
  };

  const handleSaveTruckBarangay = async () => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Reassigning truck barangays is restricted in Read-Only Mode.');
      return;
    }
    if (!truckToAssignBarangay || !db) return;
    setIsSavingBarangay(true);
    try {
      await updateDoc(doc(db, 'trucks', truckToAssignBarangay.id), {
        assignedBarangay: targetBarangay,
        barangay: targetBarangay,
        updatedAt: serverTimestamp(),
      });
      setAssignBarangayModalVisible(false);
      setTruckToAssignBarangay(null);
      setFeedbackToast({
        message: `Updated ${truckToAssignBarangay.plateNumber} assignment to Brgy. ${targetBarangay}.`,
        type: 'success',
      });
      setTimeout(() => setFeedbackToast(null), 5000);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to update truck barangay assignment.');
    } finally {
      setIsSavingBarangay(false);
    }
  };

  const handleOpenAssignDriverModal = (truck: Truck) => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Assigning drivers is restricted in Read-Only Mode.');
      return;
    }
    setTruckToAssignDriver(truck);
    setSelectedDriverIdToAssign('');
    setDriverSearchQuery('');
    setAssignDriverModalVisible(true);
  };

  const executeAssignDriver = async () => {
    if (!truckToAssignDriver || !selectedDriverIdToAssign || !db) return;
    setIsAssigningDriver(true);

    const truckId = truckToAssignDriver.id;
    const plateNum = truckToAssignDriver.plateNumber;
    const targetDriver = allDriversList.find((d) => d.id === selectedDriverIdToAssign);
    const driverName = targetDriver?.name || 'Driver';

    // Strict validation: Ensure driver is registered to the truck's assigned barangay
    const truckBrgy = getTruckBarangay(truckToAssignDriver);
    if (truckBrgy && normalizeBrgy(targetDriver?.assignedBarangay) !== normalizeBrgy(truckBrgy)) {
      setIsAssigningDriver(false);
      Alert.alert('Assignment Error', `This driver is not registered to Brgy. ${truckBrgy}.`);
      return;
    }

    // Strict validation: Driver cannot be assigned if already assigned to another truck or on an active shift
    const hasOtherTruck = Boolean(
      (targetDriver?.currentTruckPlate && targetDriver.currentTruckPlate !== plateNum) ||
      (targetDriver?.currentTruckId && targetDriver.currentTruckId !== truckId)
    );
    if (hasOtherTruck) {
      setIsAssigningDriver(false);
      Alert.alert(
        'Driver Already Assigned',
        `${driverName} is currently assigned to truck ${targetDriver?.currentTruckPlate || 'another vehicle'}. Please unassign them or end their shift on that vehicle before assigning them here.`
      );
      return;
    }

    try {
      // 1. Assign driver to this truck (standby until driver scans or logs in to start shift)
      await updateDoc(doc(db, 'trucks', truckId), {
        assignedDriverId: selectedDriverIdToAssign,
        assignedDriverName: driverName,
        shiftStartedAt: null,
        lastDriverId: selectedDriverIdToAssign,
        lastDriverName: driverName,
        lastUsedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 3. Update driver's user document (assigned but off duty until shift initiation)
      await updateDoc(doc(db, 'users', selectedDriverIdToAssign), {
        currentTruckId: truckId,
        currentTruckPlate: plateNum,
        assignedTruck: plateNum,
        dutyStatus: 'off_duty',
        status: 'off_duty',
        updatedAt: serverTimestamp(),
      });

      // 4. Update employee_ids if existing
      try {
        const empQ = query(collection(db, 'employee_ids'), where('userId', '==', selectedDriverIdToAssign));
        const empSnap = await getDocs(empQ);
        empSnap.forEach(async (d) => {
          await updateDoc(d.ref, {
            assignedTruckId: truckId,
            assignedTruckPlate: plateNum,
            updatedAt: serverTimestamp(),
          });
        });
      } catch (empErr) {
        console.warn('Could not update employee_ids:', empErr);
      }

      // 5. Log to truck_usage_history
      try {
        await addDoc(collection(db, 'truck_usage_history'), {
          truckId: truckId,
          truckPlate: plateNum || '',
          driverId: selectedDriverIdToAssign,
          driverName: driverName,
          action: 'assigned_by_admin',
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
          status: 'assigned',
        });
      } catch (histErr) {
        console.warn('Could not log to truck_usage_history:', histErr);
      }

      // 6. Notify driver
      try {
        await addDoc(collection(db, 'notifications'), {
          userId: selectedDriverIdToAssign,
          title: '🚛 Truck Assigned',
          message: `You have been assigned to collection truck ${plateNum || ''} by ${isCoordinator ? `Brgy. ${effectiveCoordinatorBarangay} Coordinator` : 'CENRO Fleet Management'}.`,
          type: 'truck_assigned',
          read: false,
          createdAt: serverTimestamp(),
        });
      } catch (notifErr) {
        console.warn('Could not send notification:', notifErr);
      }

      setAssignDriverModalVisible(false);
      setTruckToAssignDriver(null);
      setSelectedDriverIdToAssign('');
      setFeedbackToast({
        message: `Successfully assigned ${driverName} to truck ${plateNum}.`,
        type: 'success',
      });
      setTimeout(() => setFeedbackToast(null), 5000);
    } catch (e: any) {
      console.error('Failed to assign driver:', e);
      Alert.alert('Error', e.message || 'Failed to assign driver.');
    } finally {
      setIsAssigningDriver(false);
    }
  };

  useEffect(() => {
    async function fetchHistory() {
      if (!selectedTruck || !db) return;
      setLoadingHistory(true);

      try {
        const plate = (selectedTruck.plateNumber || '').trim();
        const truckId = selectedTruck.id;
        const historyItems: any[] = [];
        const seenKeys = new Set<string>();

        const addItem = (item: any) => {
          const key = `${item.id || item.createdAt}_${item.driver}_${item.action}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            historyItems.push(item);
          }
        };

        // 1. Query truck_usage_history
        try {
          const usageRef = collection(db, 'truck_usage_history');
          const [snap1, snap2] = await Promise.all([
            getDocs(query(usageRef, where('truckPlate', '==', plate))),
            getDocs(query(usageRef, where('truckId', '==', truckId))),
          ]);
          [...snap1.docs, ...snap2.docs].forEach((d) => {
            const data = d.data();
            const actionText =
              data.action === 'shift_started'
                ? 'Shift Started'
                : data.action === 'shift_ended'
                ? 'Shift Ended'
                : data.action === 'unassigned_by_admin'
                ? 'Shift Ended (Admin)'
                : 'Driver Operation';
            const timingText = data.durationFormatted ? ` (${data.durationFormatted})` : '';
            addItem({
              id: `usage-${d.id}`,
              driver: data.driverName || 'Driver',
              route: data.barangay ? `Brgy. ${data.barangay}` : `Brgy. ${getTruckBarangay(selectedTruck) || 'Municipal Route'}`,
              action: `${actionText}${timingText}`,
              status: data.action === 'shift_started' ? 'active' : 'completed',
              createdAt: data.timestamp || data.createdAt || data.startedAt || data.endedAt,
            });
          });
        } catch (e) {
          console.warn('Could not fetch truck_usage_history:', e);
        }

        // 2. Query schedules
        try {
          const schedRef = collection(db, 'schedules');
          const [snapByTruck, snapByPlate, snapById] = await Promise.all([
            getDocs(query(schedRef, where('truck', '==', plate))),
            getDocs(query(schedRef, where('truckPlate', '==', plate))),
            getDocs(query(schedRef, where('truckId', '==', truckId))),
          ]);

          [...snapByTruck.docs, ...snapByPlate.docs, ...snapById.docs].forEach((d) => {
            const data = d.data();
            const dName =
              data.driver ||
              data.driverName ||
              data.assignedDriverName ||
              (data.assignedDriverId ? driverNameMap[data.assignedDriverId] : null) ||
              'Driver';
            const rStatus = (data.status || '').toLowerCase();
            const actionText =
              rStatus === 'completed' || rStatus === 'done' || rStatus === 'resolved'
                ? 'Route Completed'
                : rStatus === 'in_progress' || rStatus === 'active'
                ? 'Route In Progress'
                : rStatus === 'issue'
                ? 'Issue Encountered'
                : 'Scheduled Collection';

            addItem({
              id: `sched-${d.id}`,
              driver: dName,
              route: data.barangay || data.barangayName || data.streetName || `Brgy. ${getTruckBarangay(selectedTruck) || 'Route'}`,
              action: actionText,
              status: rStatus === 'issue' ? 'issue' : rStatus === 'in_progress' || rStatus === 'active' ? 'active' : 'completed',
              createdAt: data.createdAt || data.completedAt || data.updatedAt,
            });
          });
        } catch (e) {
          console.warn('Could not fetch schedules:', e);
        }

        // 3. Query reports (completed collections for this truck)
        try {
          const repRef = collection(db, 'reports');
          const snapReports = await getDocs(query(repRef, where('assignedTruckPlate', '==', plate)));
          snapReports.docs.forEach((d) => {
            const data = d.data();
            const dName = data.assignedDriverName || (data.assignedDriverId ? driverNameMap[data.assignedDriverId] : null) || 'Driver';
            addItem({
              id: `rep-${d.id}`,
              driver: dName,
              route: data.street ? `${data.street}, Brgy. ${data.barangay || ''}` : `Brgy. ${data.barangay || ''}`,
              action: data.status === 'collected' || data.status === 'completed' ? 'Waste Collected' : 'Collection Dispatched',
              status: 'completed',
              createdAt: data.collectedAt || data.completedAt || data.updatedAt || data.createdAt,
            });
          });
        } catch (e) {
          console.warn('Could not fetch reports:', e);
        }

        // 4. Query fleet_trips
        try {
          const tripsRef = collection(db, 'fleet_trips');
          const [tripSnap1, tripSnap2] = await Promise.all([
            getDocs(query(tripsRef, where('plateNumber', '==', plate))),
            getDocs(query(tripsRef, where('truckId', '==', truckId))),
          ]);
          [...tripSnap1.docs, ...tripSnap2.docs].forEach((d) => {
            const data = d.data();
            addItem({
              id: `trip-${d.id}`,
              driver: data.driverName || (data.driverId ? driverNameMap[data.driverId] : null) || 'Driver',
              route: data.barangay ? `Brgy. ${data.barangay}` : 'Collection Route',
              action: 'Fleet Trip Completed',
              status: 'completed',
              createdAt: data.lastUpdate ? new Date(data.lastUpdate) : data.createdAt,
            });
          });
        } catch (e) {
          console.warn('Could not fetch fleet_trips:', e);
        }

        // 5. Synthesize active shift or recent driver if not already covered
        const activeDriverName =
          selectedTruck.assignedDriverName ||
          activeDriverByTruck[selectedTruck.id]?.name ||
          activeDriverByTruck[plate]?.name;

        if (activeDriverName) {
          addItem({
            id: 'current-active-shift',
            driver: activeDriverName,
            route: `Brgy. ${getTruckBarangay(selectedTruck) || 'Assigned Sector'}`,
            action: 'Current Shift Active',
            status: 'active',
            createdAt: selectedTruck.shiftStartedAt || new Date(),
          });
        }

        const recentDriverName =
          selectedTruck.lastDriverName ||
          recentDriverByTruck[selectedTruck.id]?.name ||
          recentDriverByTruck[plate]?.name;

        // Only synthesize recent driver if no real history items exist for this driver
        const hasRealUsageRecords = historyItems.some(
          (h) => h.id && h.id.startsWith('usage-') && h.driver && recentDriverName && h.driver.toLowerCase() === recentDriverName.toLowerCase()
        );

        if (recentDriverName && recentDriverName !== activeDriverName && !hasRealUsageRecords) {
          addItem({
            id: 'recent-shift-record',
            driver: recentDriverName,
            route: `Brgy. ${getTruckBarangay(selectedTruck) || 'Assigned Sector'}`,
            action: 'Previous Shift Ended',
            status: 'completed',
            createdAt: selectedTruck.lastUsedAt || new Date(Date.now() - 3600000),
          });
        }

        // Sort items descending by timestamp
        historyItems.sort((a, b) => {
          const aTime = a.createdAt?.toDate
            ? a.createdAt.toDate().getTime()
            : a.createdAt
            ? new Date(a.createdAt).getTime()
            : 0;
          const bTime = b.createdAt?.toDate
            ? b.createdAt.toDate().getTime()
            : b.createdAt
            ? new Date(b.createdAt).getTime()
            : 0;
          return bTime - aTime;
        });

        // Date Filter
        const now = new Date();
        let cutoff = new Date(0);
        if (historyFilter === 'week') {
          cutoff = new Date();
          cutoff.setDate(now.getDate() - 7);
        } else if (historyFilter === 'month') {
          cutoff = new Date();
          cutoff.setMonth(now.getMonth() - 1);
        }

        const filtered = historyItems.filter((r) => {
          if (!r.createdAt) return true;
          const createdMs = r.createdAt?.toDate
            ? r.createdAt.toDate().getTime()
            : new Date(r.createdAt).getTime();
          // Always keep active shifts regardless of filter
          if (r.status === 'active') return true;
          return createdMs >= cutoff.getTime();
        });

        // Deduplicate events that share the same minute bucket, driver, action, and route
        const deduplicated: any[] = [];
        const seenActionKeys = new Set<string>();

        for (const item of filtered) {
          const itemMs = item.createdAt?.toDate
            ? item.createdAt.toDate().getTime()
            : item.createdAt
            ? new Date(item.createdAt).getTime()
            : 0;
          const minuteBucket = Math.floor(itemMs / 60000);
          const actKey = `${minuteBucket}_${item.driver}_${item.action}_${item.route}`;
          if (!seenActionKeys.has(actKey)) {
            seenActionKeys.add(actKey);
            deduplicated.push({
              ...item,
              createdMs: itemMs,
            });
          }
        }

        // Group into sessions: combine activities from the same driver within the same operational shift
        const sessions: any[] = [];
        let currentSession: any = null;

        for (const item of deduplicated) {
          const itemDate = new Date(item.createdMs);
          const dateStr = itemDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const timeStr = itemDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

          const actObj = {
            id: item.id,
            date: dateStr,
            time: timeStr,
            timeMs: item.createdMs,
            driver: item.driver || 'Driver',
            route: item.route || 'Municipal Route',
            action: item.action || 'Collection Route',
            status: item.status || 'completed',
          };

          const isShiftEndAction = item.action && (item.action.includes('Shift Ended') || item.action.includes('unassigned'));
          const isShiftStartAction = item.action && item.action.includes('Shift Start');

          const canJoinCurrent =
            currentSession &&
            currentSession.driver.toLowerCase().trim() === (item.driver || '').toLowerCase().trim() &&
            Math.abs(currentSession.latestTimeMs - item.createdMs) <= 6 * 3600 * 1000 &&
            !currentSession.hasShiftStarted &&
            !(currentSession.hasShiftEnded && isShiftEndAction);

          if (canJoinCurrent) {
            currentSession.activities.push(actObj);
            if (item.createdMs < currentSession.earliestTimeMs) {
              currentSession.earliestTimeMs = item.createdMs;
              currentSession.earliestTime = timeStr;
            }
            if (isShiftStartAction) {
              currentSession.hasShiftStarted = true;
            }
            if (item.status === 'active') {
              currentSession.status = 'active';
            } else if (item.status === 'issue' && currentSession.status !== 'active') {
              currentSession.status = 'issue';
            }
          } else {
            currentSession = {
              sessionId: `session-${item.id || item.createdMs}`,
              driver: item.driver || 'Driver',
              date: dateStr,
              latestTime: timeStr,
              latestTimeMs: item.createdMs,
              earliestTime: timeStr,
              earliestTimeMs: item.createdMs,
              primaryAction: item.action || 'Collection Session',
              primaryRoute: item.route || 'Municipal Route',
              status: item.status || 'completed',
              hasShiftEnded: isShiftEndAction,
              hasShiftStarted: isShiftStartAction,
              activities: [actObj],
            };
            sessions.push(currentSession);
          }
        }

        // Post-process session labels and summaries
        sessions.forEach((s) => {
          const endAct = s.activities.find((a: any) => a.action && a.action.includes('Shift Ended'));
          const routeDoneAct = s.activities.find((a: any) => a.action && a.action.includes('Route Completed'));
          const activeAct = s.activities.find((a: any) => a.action && (a.action.includes('Active') || a.action.includes('Shift Start')));

          if (s.status === 'active' && activeAct) {
            s.primaryAction = activeAct.action;
          } else if (endAct) {
            s.primaryAction = endAct.action;
          } else if (routeDoneAct) {
            s.primaryAction = routeDoneAct.action;
          } else if (s.activities.length > 0) {
            s.primaryAction = s.activities[0].action;
          }

          const specificRoute = s.activities.find((a: any) => a.route && !a.route.includes('Municipal Route') && !a.route.includes('Assigned Sector'));
          if (specificRoute) {
            s.primaryRoute = specificRoute.route;
          }

          if (s.earliestTime && s.earliestTime !== s.latestTime) {
            s.timeRange = `${s.earliestTime} – ${s.latestTime}`;
          } else {
            s.timeRange = s.latestTime;
          }
        });

        setTruckHistory(sessions);
      } catch (err) {
        console.error('Error fetching truck history:', err);
        setTruckHistory([]);
      } finally {
        setLoadingHistory(false);
      }
    }

    fetchHistory();
  }, [selectedTruck, historyFilter, activeDriverByTruck, recentDriverByTruck, driverNameMap]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Loading fleet data...</Text>
      </View>
    );
  }

  const filteredBarangayList = DANAO_CITY_BARANGAYS.filter((b) =>
    b.toLowerCase().includes(filterSearchQuery.trim().toLowerCase())
  );

  const filteredAssignList = DANAO_CITY_BARANGAYS.filter((b) =>
    b.toLowerCase().includes(assignSearchQuery.trim().toLowerCase())
  );

  return (
    <ScrollView style={[styles.container, isMobile && { padding: 16 }]}>
      {feedbackToast && (
        <View
          style={{
            backgroundColor: feedbackToast.type === 'success' ? '#ECFDF5' : '#FEE2E2',
            borderWidth: 1,
            borderColor: feedbackToast.type === 'success' ? '#A7F3D0' : '#FECACA',
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <MaterialIcons
              name={feedbackToast.type === 'success' ? 'check-circle' : 'error-outline'}
              size={20}
              color={feedbackToast.type === 'success' ? '#059669' : '#DC2626'}
            />
            <Text
              style={{
                fontSize: 13,
                color: feedbackToast.type === 'success' ? '#065F46' : '#991B1B',
                fontWeight: '600',
                flex: 1,
              }}
            >
              {feedbackToast.message}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setFeedbackToast(null)}>
            <MaterialIcons
              name="close"
              size={18}
              color={feedbackToast.type === 'success' ? '#059669' : '#DC2626'}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* Header Row */}
      <View style={[styles.headerRow, isMobile && { flexDirection: 'column', gap: 12 }]}>
        <View>
          <Text style={styles.headerTitle}>
            {isCoordinator && effectiveCoordinatorBarangay
              ? `Fleet Inventory • Brgy. ${effectiveCoordinatorBarangay}`
              : 'Fleet Inventory'}
          </Text>
          <Text style={styles.headerDesc}>
            {isCoordinator && effectiveCoordinatorBarangay
              ? `Manage and monitor municipal garbage trucks assigned to Brgy. ${effectiveCoordinatorBarangay}.`
              : 'Manage and monitor municipal garbage trucks across Danao City.'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <TouchableOpacity
            style={styles.outlineExportBtn}
            onPress={() => setIsExportModalVisible(true)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="file-download" size={18} color="#059669" />
            <Text style={styles.outlineExportBtnText}>Export</Text>
          </TouchableOpacity>
          {isReadOnly ? (
            <View style={styles.readOnlyHeaderBadge}>
              <MaterialIcons name="visibility" size={16} color="#92400E" />
              <Text style={styles.readOnlyHeaderBadgeText}>Read-Only Mode</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, isMobile && { width: '100%', justifyContent: 'center' }]}
              onPress={() => {
                setPlateError(null);
                setIsNewTruckBarangayDropdownOpen(false);
                setNewTruckBarangaySearchQuery('');
                setShowAddForm(true);
              }}
            >
              <MaterialIcons name="add" size={20} color="#FFF" />
              <Text style={styles.primaryBtnText}>Add New Truck</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Coordinator Locked Banner */}
      {isCoordinator && effectiveCoordinatorBarangay ? (
        <View style={styles.coordinatorBanner}>
          <MaterialIcons name="lock" size={18} color="#065F46" />
          <Text style={styles.coordinatorBannerText}>
            Locked to Jurisdiction:{' '}
            <Text style={{ fontWeight: '800' }}>Brgy. {effectiveCoordinatorBarangay}</Text> — showing only trucks assigned to your barangay.
          </Text>
        </View>
      ) : null}

      {/* CENRO Admin Barangay Filter Bar */}
      {!isCoordinator && (
        <View style={styles.filterSection}>
          <View style={styles.filterHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="filter-alt" size={18} color="#2E8B57" />
              <Text style={styles.filterSectionTitle}>FILTER FLEET BY BARANGAY</Text>
            </View>
            {selectedBarangayFilter !== 'all' && (
              <TouchableOpacity
                style={styles.clearFilterBtn}
                onPress={() => setSelectedBarangayFilter('all')}
              >
                <MaterialIcons name="close" size={14} color="#EF4444" />
                <Text style={styles.clearFilterText}>Reset to All Barangays</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={[styles.filterControlsRow, isMobile && { flexDirection: 'column' }]}>
            {/* Searchable Dropdown Button */}
            <TouchableOpacity
              style={[
                styles.filterDropdownBtn,
                selectedBarangayFilter !== 'all' && styles.filterDropdownBtnActive,
              ]}
              onPress={() => {
                setFilterSearchQuery('');
                setIsFilterModalVisible(true);
              }}
            >
              <MaterialIcons
                name="location-city"
                size={18}
                color={selectedBarangayFilter !== 'all' ? '#059669' : '#6B7280'}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.filterDropdownLabel}>BARANGAY FILTER</Text>
                <Text
                  style={[
                    styles.filterDropdownValue,
                    selectedBarangayFilter !== 'all' && { color: '#065F46', fontWeight: '800' },
                  ]}
                  numberOfLines={1}
                >
                  {selectedBarangayFilter === 'all'
                    ? 'All Barangays (Browse 42)'
                    : selectedBarangayFilter === 'unassigned'
                    ? 'Unassigned Trucks'
                    : `Brgy. ${selectedBarangayFilter}`}
                </Text>
              </View>
              <MaterialIcons name="arrow-drop-down" size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Summary Cards with 1-Click Interactive Filter */}
      <View style={[styles.summaryGrid, isMobile && { gap: 10 }]}>
        {/* Total Fleet */}
        <TouchableOpacity
          activeOpacity={0.7}
          accessibilityRole="button"
          onPress={() => setStatusFilter('all')}
          style={[
            styles.summaryCard,
            statusFilter === 'all' && styles.summaryCardActiveAll,
            isMobile && { width: '48%', minWidth: 130 },
          ]}
        >
          <View style={[styles.summaryIconBg, statusFilter === 'all' && { backgroundColor: '#DCFCE7' }]}>
            <MaterialIcons name="local-shipping" size={24} color="#166534" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.summaryTitle, statusFilter === 'all' && { color: '#166534', fontWeight: '700' }]}>
                {selectedBarangayFilter !== 'all' || isCoordinator ? 'Filtered Fleet' : 'Total Fleet'}
              </Text>
              {statusFilter === 'all' && (
                <View style={styles.activePillSmall}>
                  <Text style={styles.activePillSmallText}>All</Text>
                </View>
              )}
            </View>
            <Text style={[styles.summaryValue, statusFilter === 'all' && { color: '#166534' }]}>
              {scopedTrucks.length}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Active */}
        <TouchableOpacity
          activeOpacity={0.7}
          accessibilityRole="button"
          onPress={() => setStatusFilter(statusFilter === 'active' ? 'all' : 'active')}
          style={[
            styles.summaryCard,
            statusFilter === 'active' && styles.summaryCardActiveStatus,
            isMobile && { width: '48%', minWidth: 130 },
          ]}
        >
          <View style={[styles.summaryIconBg, { backgroundColor: '#ECFDF5' }, statusFilter === 'active' && { backgroundColor: '#A7F3D0' }]}>
            <MaterialIcons name="check-circle" size={24} color="#059669" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.summaryTitle, statusFilter === 'active' && { color: '#059669', fontWeight: '700' }]}>Active</Text>
              {statusFilter === 'active' && (
                <View style={[styles.activePillSmall, { backgroundColor: '#ECFDF5' }]}>
                  <Text style={[styles.activePillSmallText, { color: '#059669' }]}>Filtered</Text>
                </View>
              )}
            </View>
            <Text style={[styles.summaryValue, { color: '#059669' }]}>{activeCount}</Text>
          </View>
        </TouchableOpacity>

        {/* Deployed */}
        <TouchableOpacity
          activeOpacity={0.7}
          accessibilityRole="button"
          onPress={() => setStatusFilter(statusFilter === 'deployed' ? 'all' : 'deployed')}
          style={[
            styles.summaryCard,
            statusFilter === 'deployed' && styles.summaryCardActiveDeployed,
            isMobile && { width: '48%', minWidth: 130 },
          ]}
        >
          <View style={[styles.summaryIconBg, { backgroundColor: '#EDE9FE' }, statusFilter === 'deployed' && { backgroundColor: '#DDD6FE' }]}>
            <MaterialIcons name="person-pin" size={24} color="#7C3AED" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.summaryTitle, statusFilter === 'deployed' && { color: '#7C3AED', fontWeight: '700' }]}>Deployed</Text>
              {statusFilter === 'deployed' && (
                <View style={[styles.activePillSmall, { backgroundColor: '#EDE9FE' }]}>
                  <Text style={[styles.activePillSmallText, { color: '#7C3AED' }]}>Filtered</Text>
                </View>
              )}
            </View>
            <Text style={[styles.summaryValue, { color: '#7C3AED' }]}>{deployedCount}</Text>
          </View>
        </TouchableOpacity>

        {/* Maintenance */}
        <TouchableOpacity
          activeOpacity={0.7}
          accessibilityRole="button"
          onPress={() => setStatusFilter(statusFilter === 'maintenance' ? 'all' : 'maintenance')}
          style={[
            styles.summaryCard,
            statusFilter === 'maintenance' && styles.summaryCardActiveMaintenance,
            isMobile && { width: '48%', minWidth: 130 },
          ]}
        >
          <View style={[styles.summaryIconBg, { backgroundColor: '#FEF3C7' }, statusFilter === 'maintenance' && { backgroundColor: '#FDE68A' }]}>
            <MaterialIcons name="build" size={24} color="#D97706" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.summaryTitle, statusFilter === 'maintenance' && { color: '#D97706', fontWeight: '700' }]}>Maintenance</Text>
              {statusFilter === 'maintenance' && (
                <View style={[styles.activePillSmall, { backgroundColor: '#FEF3C7' }]}>
                  <Text style={[styles.activePillSmallText, { color: '#D97706' }]}>Filtered</Text>
                </View>
              )}
            </View>
            <Text style={[styles.summaryValue, { color: '#D97706' }]}>{maintenanceCount}</Text>
          </View>
        </TouchableOpacity>

        {/* Out of Service */}
        <TouchableOpacity
          activeOpacity={0.7}
          accessibilityRole="button"
          onPress={() => setStatusFilter(statusFilter === 'out_of_service' ? 'all' : 'out_of_service')}
          style={[
            styles.summaryCard,
            statusFilter === 'out_of_service' && styles.summaryCardActiveOut,
            isMobile && { width: '48%', minWidth: 130 },
          ]}
        >
          <View style={[styles.summaryIconBg, { backgroundColor: '#FEE2E2' }, statusFilter === 'out_of_service' && { backgroundColor: '#FECACA' }]}>
            <MaterialIcons name="block" size={24} color="#DC2626" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.summaryTitle, statusFilter === 'out_of_service' && { color: '#DC2626', fontWeight: '700' }]}>Out of Service</Text>
              {statusFilter === 'out_of_service' && (
                <View style={[styles.activePillSmall, { backgroundColor: '#FEE2E2' }]}>
                  <Text style={[styles.activePillSmallText, { color: '#DC2626' }]}>Filtered</Text>
                </View>
              )}
            </View>
            <Text style={[styles.summaryValue, { color: '#DC2626' }]}>{outCount}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Trucks Table */}
      <View style={[styles.tableCard, isMobile && { padding: 12 }]}>
        <View style={styles.tableCardHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Text style={styles.cardTitle}>Fleet Roster</Text>
            {statusFilter !== 'all' && (
              <View style={styles.activeFilterTag}>
                <Text style={styles.activeFilterTagText}>
                  Status: {statusFilter === 'out_of_service' ? 'Out of Service' : statusFilter === 'active' ? 'Active' : statusFilter === 'deployed' ? 'Deployed' : 'Maintenance'}
                </Text>
                <TouchableOpacity onPress={() => setStatusFilter('all')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="close" size={14} color="#166534" />
                </TouchableOpacity>
              </View>
            )}
            {sortColumn && (
              <View style={[styles.activeFilterTag, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                <Text style={[styles.activeFilterTagText, { color: '#1E40AF' }]}>
                  Sorted by: {sortColumn.toUpperCase()} ({sortDirection.toUpperCase()})
                </Text>
                <TouchableOpacity onPress={() => setSortColumn(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="close" size={14} color="#1E40AF" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={styles.tableCountSubtitle}>
              Showing {displayedTrucks.length} of {scopedTrucks.length} vehicle{scopedTrucks.length === 1 ? '' : 's'}
              {!isCoordinator && selectedBarangayFilter !== 'all'
                ? ` for Brgy. ${selectedBarangayFilter}`
                : isCoordinator && effectiveCoordinatorBarangay
                ? ` for Brgy. ${effectiveCoordinatorBarangay}`
                : ' across all barangays'}
            </Text>
            {(statusFilter !== 'all' || sortColumn) && (
              <TouchableOpacity
                onPress={() => {
                  setStatusFilter('all');
                  setSortColumn(null);
                }}
                style={styles.resetFilterBtn}
              >
                <Text style={styles.resetFilterBtnText}>Reset</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <ScrollView
          horizontal={isMobile}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, minWidth: '100%' }}
          style={{ width: '100%' }}
        >
          <View style={{ minWidth: isMobile ? 800 : '100%', width: '100%' }}>
            <View style={styles.tableHead}>
              <TouchableOpacity
                style={[styles.thContainer, { flex: 1.5 }]}
                onPress={() => toggleSort('plate')}
              >
                <Text style={styles.th}>VEHICLE INFO</Text>
                <MaterialIcons
                  name={sortColumn === 'plate' ? (sortDirection === 'asc' ? 'arrow-upward' : 'arrow-downward') : 'sort'}
                  size={14}
                  color={sortColumn === 'plate' ? '#166534' : '#9CA3AF'}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.thContainer, { flex: 1.4 }]}
                onPress={() => toggleSort('barangay')}
              >
                <Text style={styles.th}>ASSIGNED BARANGAY</Text>
                <MaterialIcons
                  name={sortColumn === 'barangay' ? (sortDirection === 'asc' ? 'arrow-upward' : 'arrow-downward') : 'sort'}
                  size={14}
                  color={sortColumn === 'barangay' ? '#166534' : '#9CA3AF'}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.thContainer, { flex: 1 }]}
                onPress={() => toggleSort('capacity')}
              >
                <Text style={styles.th}>CAPACITY</Text>
                <MaterialIcons
                  name={sortColumn === 'capacity' ? (sortDirection === 'asc' ? 'arrow-upward' : 'arrow-downward') : 'sort'}
                  size={14}
                  color={sortColumn === 'capacity' ? '#166534' : '#9CA3AF'}
                />
              </TouchableOpacity>

              <Text style={[styles.th, { flex: 1.4 }]}>DRIVER / OPERATOR</Text>

              <TouchableOpacity
                style={[styles.thContainer, { flex: 1.3 }]}
                onPress={() => toggleSort('status')}
              >
                <Text style={styles.th}>STATUS</Text>
                <MaterialIcons
                  name={sortColumn === 'status' ? (sortDirection === 'asc' ? 'arrow-upward' : 'arrow-downward') : 'sort'}
                  size={14}
                  color={sortColumn === 'status' ? '#166534' : '#9CA3AF'}
                />
              </TouchableOpacity>

              <Text style={[styles.th, { flex: 1.3, textAlign: 'right' }]}>ACTIONS</Text>
            </View>

            {displayedTrucks.length === 0 ? (
              <View style={styles.emptyTable}>
                <MaterialIcons name="local-shipping" size={40} color="#D1D5DB" />
                <Text style={styles.emptyText}>
                  {statusFilter !== 'all'
                    ? `No trucks currently matching status "${statusFilter === 'out_of_service' ? 'Out of Service' : statusFilter.toUpperCase()}".`
                    : isCoordinator
                    ? `No trucks currently assigned to Brgy. ${effectiveCoordinatorBarangay || 'your barangay'}.`
                    : selectedBarangayFilter !== 'all'
                    ? `No trucks assigned to Brgy. ${selectedBarangayFilter}.`
                    : 'No trucks registered in the fleet.'}
                </Text>
                {statusFilter !== 'all' ? (
                  <TouchableOpacity
                    style={[styles.primaryBtn, { marginTop: 12 }]}
                    onPress={() => setStatusFilter('all')}
                  >
                    <Text style={styles.primaryBtnText}>Show All Fleet</Text>
                  </TouchableOpacity>
                ) : !isCoordinator && selectedBarangayFilter !== 'all' && (
                  <TouchableOpacity
                    style={[styles.primaryBtn, { marginTop: 12 }]}
                    onPress={() => setSelectedBarangayFilter('all')}
                  >
                    <Text style={styles.primaryBtnText}>View All Barangays</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              displayedTrucks.map((truck) => {
                const b = getTruckBarangay(truck);
                return (
                  <View key={truck.id} style={styles.tr}>
                    {/* Vehicle Info */}
                    <View
                      style={[
                        styles.td,
                        { flex: 1.5, flexDirection: 'row', alignItems: 'center', gap: 12 },
                      ]}
                    >
                      <View style={styles.avatarBg}>
                        <FontAwesome5 name="truck" size={16} color="#4B5563" />
                      </View>
                      <View>
                        <Text style={styles.truckPlate}>{truck.plateNumber}</Text>
                        <Text style={styles.truckType}>{truck.type}</Text>
                      </View>
                    </View>

                    {/* Assigned Barangay */}
                    <View style={[styles.td, { flex: 1.4, justifyContent: 'center' }]}>
                      {b ? (
                        <TouchableOpacity
                          disabled={isCoordinator}
                          onPress={() => {
                            setTruckToAssignBarangay(truck);
                            setTargetBarangay(b);
                            setAssignSearchQuery('');
                            setAssignBarangayModalVisible(true);
                          }}
                          style={styles.barangayBadge}
                        >
                          <MaterialIcons name="place" size={13} color="#059669" />
                          <Text style={styles.barangayBadgeText} numberOfLines={1}>
                            Brgy. {b}
                          </Text>
                          {!isCoordinator && (
                            <MaterialIcons name="edit" size={11} color="#059669" style={{ marginLeft: 3 }} />
                          )}
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          disabled={isCoordinator}
                          onPress={() => {
                            setTruckToAssignBarangay(truck);
                            setTargetBarangay('Poblacion');
                            setAssignSearchQuery('');
                            setAssignBarangayModalVisible(true);
                          }}
                          style={[
                            styles.barangayBadge,
                            { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
                          ]}
                        >
                          <MaterialIcons name="add-location-alt" size={13} color="#6B7280" />
                          <Text style={[styles.barangayBadgeText, { color: '#6B7280' }]}>
                            {isCoordinator ? 'Unassigned' : '+ Assign'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Capacity */}
                    <View style={[styles.td, { flex: 1, justifyContent: 'center' }]}>
                      <Text style={styles.capacityText}>{truck.capacity} Tons</Text>
                    </View>

                    {/* Assigned Driver / Operator */}
                    <View style={[styles.td, { flex: 1.4, justifyContent: 'center' }]}>
                      {(() => {
                        const validAssigned = getValidDriver(truck);
                        const activeInfo = activeDriverByTruck[truck.id] || activeDriverByTruck[truck.plateNumber];
                        const dName = (validAssigned ? truck.assignedDriverName : null) || activeInfo?.name;

                        if (validAssigned || activeInfo) {
                          const isOnDuty = Boolean(
                            activeInfo?.name ||
                            (validAssigned && (validAssigned.dutyStatus === 'on_duty' || validAssigned.status === 'on_duty'))
                          );

                          return (
                            <View>
                              <View style={styles.driverAssignedBadge}>
                                <MaterialIcons name="person" size={14} color="#7C3AED" />
                                <Text style={styles.driverAssignedText} numberOfLines={1}>
                                  {dName}
                                </Text>
                              </View>
                              {isOnDuty ? (
                                <Text style={styles.driverActiveSubtext}>● On Duty</Text>
                              ) : (
                                <Text style={[styles.driverActiveSubtext, { color: '#6B7280' }]}>○ Off Duty (Pending Scan)</Text>
                              )}
                            </View>
                          );
                        }

                        const recentName = truck.lastDriverName || recentDriverByTruck[truck.id]?.name || recentDriverByTruck[truck.plateNumber]?.name;
                        if (recentName) {
                          return (
                            <View>
                              <Text style={styles.unassignedText}>Unassigned</Text>
                              <View style={styles.lastDriverRow}>
                                <MaterialIcons name="history" size={12} color="#6B7280" />
                                <Text style={styles.lastDriverText} numberOfLines={1}>
                                  Last: {recentName}
                                </Text>
                              </View>
                            </View>
                          );
                        }

                        return (
                          <View>
                            <Text style={styles.unassignedText}>Unassigned</Text>
                            <TouchableOpacity
                              onPress={() => handleOpenAssignDriverModal(truck)}
                              style={{ marginTop: 2 }}
                              activeOpacity={0.7}
                            >
                              <Text style={{ fontSize: 11, color: '#7C3AED', fontWeight: '700' }}>+ Assign Driver</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })()}
                    </View>

                    {/* Status */}
                    <View style={[styles.td, { flex: 1.3, justifyContent: 'center' }]}>
                      <View
                        style={[
                          styles.statusBadge,
                          getResolvedTruckStatus(truck.status) === 'active'
                            ? styles.statusActive
                            : getResolvedTruckStatus(truck.status) === 'maintenance'
                            ? styles.statusMaintenance
                            : styles.statusOut,
                        ]}
                      >
                        <View
                          style={[
                            styles.statusDot,
                            getResolvedTruckStatus(truck.status) === 'active'
                              ? { backgroundColor: '#059669' }
                              : getResolvedTruckStatus(truck.status) === 'maintenance'
                              ? { backgroundColor: '#D97706' }
                              : { backgroundColor: '#DC2626' },
                          ]}
                        />
                        <Text
                          style={[
                            styles.statusText,
                            getResolvedTruckStatus(truck.status) === 'active'
                              ? { color: '#059669' }
                              : getResolvedTruckStatus(truck.status) === 'maintenance'
                              ? { color: '#D97706' }
                              : { color: '#DC2626' },
                          ]}
                        >
                          {getResolvedTruckStatus(truck.status) === 'active'
                            ? 'Active'
                            : getResolvedTruckStatus(truck.status) === 'maintenance'
                            ? 'Maintenance'
                            : 'Out of Service'}
                        </Text>
                      </View>
                    </View>

                    {/* Actions */}
                    <View
                      style={[
                        styles.td,
                        {
                          flex: 1.3,
                          flexDirection: 'row',
                          justifyContent: 'flex-end',
                          alignItems: 'center',
                          gap: 6,
                        },
                      ]}
                    >
                      {/* View History */}
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedTruck(truck);
                          setHistoryModalVisible(true);
                        }}
                        style={styles.actionBtn}
                        accessibilityLabel="View History"
                      >
                        <MaterialIcons name="history" size={18} color="#4B5563" />
                      </TouchableOpacity>

                      {/* CENRO: Assign / Transfer Barangay */}
                      {!isReadOnly && !isCoordinator && (
                        <TouchableOpacity
                          onPress={() => {
                            setTruckToAssignBarangay(truck);
                            setTargetBarangay(b || 'Poblacion');
                            setAssignSearchQuery('');
                            setAssignBarangayModalVisible(true);
                          }}
                          style={[styles.actionBtn, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
                          accessibilityLabel="Assign / Transfer Barangay"
                        >
                          <MaterialIcons name="edit-location-alt" size={18} color="#2563EB" />
                        </TouchableOpacity>
                      )}

                      {/* Assign Driver (when currently unassigned) */}
                      {!isReadOnly && !getValidDriver(truck) && (
                        <TouchableOpacity
                          onPress={() => handleOpenAssignDriverModal(truck)}
                          style={[
                            styles.actionBtn,
                            { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' },
                          ]}
                          accessibilityLabel="Assign Driver"
                        >
                          <MaterialIcons name="person-add" size={17} color="#7C3AED" />
                        </TouchableOpacity>
                      )}

                      {/* Fleet Inventory QR Badge (Shift Verification & Time Out) - only when a driver is assigned */}
                      {Boolean(getValidDriver(truck)) && (
                        <TouchableOpacity
                          onPress={() => handleOpenFleetInventoryQr(truck)}
                          style={[
                            styles.actionBtn,
                            { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
                          ]}
                          accessibilityLabel="View Fleet Inventory QR Badge"
                        >
                          <MaterialIcons name="qr-code-2" size={18} color="#059669" />
                        </TouchableOpacity>
                      )}

                      {/* End Shift */}
                      {!isReadOnly && Boolean(getValidDriver(truck)) && (
                        <TouchableOpacity
                          onPress={() => handleOpenUnassignModal(truck)}
                          style={[
                            styles.actionBtn,
                            { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' },
                          ]}
                          accessibilityLabel="End Shift"
                        >
                          <MaterialIcons name="power-settings-new" size={16} color="#7C3AED" />
                        </TouchableOpacity>
                      )}

                      {/* Mark Active */}
                      {!isReadOnly && truck.status !== 'active' && (
                        <TouchableOpacity
                          onPress={() => handlePromptChangeStatus(truck, 'active')}
                          style={[
                            styles.actionBtn,
                            { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
                          ]}
                          accessibilityLabel="Mark Active"
                        >
                          <MaterialIcons name="check-circle" size={18} color="#059669" />
                        </TouchableOpacity>
                      )}

                      {/* Mark Maintenance */}
                      {!isReadOnly && truck.status !== 'maintenance' && (
                        <TouchableOpacity
                          onPress={() => handlePromptChangeStatus(truck, 'maintenance')}
                          style={[
                            styles.actionBtn,
                            { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
                          ]}
                          accessibilityLabel="Mark Maintenance"
                        >
                          <MaterialIcons name="build" size={18} color="#D97706" />
                        </TouchableOpacity>
                      )}

                      {/* Mark Out of Service */}
                      {!isReadOnly && truck.status !== 'out_of_service' && (
                        <TouchableOpacity
                          onPress={() => handlePromptChangeStatus(truck, 'out_of_service')}
                          style={[
                            styles.actionBtn,
                            { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
                          ]}
                          accessibilityLabel="Mark Out of Service"
                        >
                          <MaterialIcons name="block" size={18} color="#DC2626" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </View>

      <View style={{ height: 40 }} />

      {/* Register New Truck Modal */}
      <Modal
        visible={showAddForm}
        transparent
        animationType="fade"
        onRequestClose={() => !isSubmitting && setShowAddForm(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => !isSubmitting && setShowAddForm(false)}
          />

          <View style={[styles.modalContent, { maxWidth: 580, zIndex: 10 }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: '#ECFDF5',
                    justifyContent: 'center',
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: '#A7F3D0',
                  }}
                >
                  <MaterialIcons name="local-shipping" size={20} color="#059669" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Register New Truck</Text>
                  <Text style={styles.modalSubtitle}>
                    Add a municipal vehicle to the Danao City fleet
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => !isSubmitting && setShowAddForm(false)}
                disabled={isSubmitting}
                style={styles.modalCloseBtn}
              >
                <MaterialIcons name="close" size={22} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {/* Form Scrollable Body */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 460 }}
              contentContainerStyle={{ gap: 16, paddingVertical: 6 }}
            >
              {/* Plate Number */}
              <View style={styles.formGroup}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <Text style={[styles.label, { marginBottom: 0 }]}>
                    PLATE NUMBER <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <Text style={{ fontSize: 11, color: '#6B7280', fontWeight: '600' }}>
                    {plateNumber.length}/8
                  </Text>
                </View>
                <TextInput
                  style={[styles.input, plateError ? { borderColor: '#EF4444' } : null]}
                  placeholder="e.g. ABC-1234"
                  value={plateNumber}
                  onChangeText={handlePlateChange}
                  placeholderTextColor="#9CA3AF"
                  maxLength={8}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                {plateError ? (
                  <Text style={{ color: '#EF4444', fontSize: 11, marginTop: 4, fontWeight: '500' }}>
                    {plateError}
                  </Text>
                ) : (
                  <Text style={{ color: '#6B7280', fontSize: 11, marginTop: 4 }}>
                    Philippine standard format (6–8 chars, e.g. ABC-1234)
                  </Text>
                )}
              </View>

              {/* Truck Type */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>
                  TRUCK TYPE <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <View style={styles.typeSelector}>
                  {['Compactor', 'Dump Truck', 'Mini-Dump'].map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.typeBtn, truckType === type && styles.typeBtnActive]}
                      onPress={() => setTruckType(type)}
                    >
                      <Text style={[styles.typeBtnText, truckType === type && styles.typeBtnTextActive]}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Capacity */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>
                  CAPACITY (Tons) <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 5"
                  value={capacity}
                  onChangeText={setCapacity}
                  keyboardType="numeric"
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              {/* Assigned Barangay */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>
                  ASSIGNED BARANGAY <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                {isCoordinator ? (
                  <View style={styles.lockedBarangayCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="lock" size={16} color="#059669" />
                      <Text style={styles.lockedBarangayName}>
                        Brgy. {effectiveCoordinatorBarangay || 'Unassigned'}
                      </Text>
                    </View>
                    <Text style={styles.lockedBarangayDesc}>
                      Fixed to your barangay coordinator jurisdiction.
                    </Text>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    {/* Custom Dropdown Trigger */}
                    <TouchableOpacity
                      style={[
                        styles.barangayDropdownBtn,
                        isNewTruckBarangayDropdownOpen && styles.barangayDropdownBtnActive,
                      ]}
                      onPress={() => {
                        setIsNewTruckBarangayDropdownOpen(!isNewTruckBarangayDropdownOpen);
                        setNewTruckBarangaySearchQuery('');
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}>
                        <MaterialIcons
                          name="location-on"
                          size={18}
                          color={selectedBarangayForNewTruck ? '#059669' : '#9CA3AF'}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.barangayDropdownValue} numberOfLines={1}>
                            Brgy. {selectedBarangayForNewTruck}
                          </Text>
                          <Text style={styles.barangayDropdownSubtext}>
                            Operational fleet jurisdiction
                          </Text>
                        </View>
                      </View>
                      <MaterialIcons
                        name={isNewTruckBarangayDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                        size={22}
                        color="#6B7280"
                      />
                    </TouchableOpacity>

                    {/* Dropdown Menu Popup */}
                    {isNewTruckBarangayDropdownOpen && (
                      <View style={styles.barangayDropdownMenu}>
                        {/* Search Filter Header */}
                        <View style={styles.barangayDropdownSearchHeader}>
                          <MaterialIcons name="search" size={16} color="#9CA3AF" />
                          <TextInput
                            style={styles.barangayDropdownSearchInput}
                            placeholder="Search 42 barangays..."
                            placeholderTextColor="#9CA3AF"
                            value={newTruckBarangaySearchQuery}
                            onChangeText={setNewTruckBarangaySearchQuery}
                            autoFocus={Platform.OS === 'web'}
                          />
                          {newTruckBarangaySearchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setNewTruckBarangaySearchQuery('')}>
                              <MaterialIcons name="close" size={16} color="#9CA3AF" />
                            </TouchableOpacity>
                          )}
                        </View>

                        {/* Barangay List */}
                        <ScrollView
                          nestedScrollEnabled
                          style={{ maxHeight: 220 }}
                          keyboardShouldPersistTaps="handled"
                          showsVerticalScrollIndicator={true}
                        >
                          {filteredNewTruckBarangays.map((b) => {
                            const isSelected = selectedBarangayForNewTruck === b;
                            const count = barangaysWithTrucks[b] || 0;
                            return (
                              <TouchableOpacity
                                key={b}
                                style={[
                                  styles.barangayDropdownItem,
                                  isSelected && styles.barangayDropdownItemActive,
                                ]}
                                onPress={() => {
                                  setSelectedBarangayForNewTruck(b);
                                  setIsNewTruckBarangayDropdownOpen(false);
                                  setNewTruckBarangaySearchQuery('');
                                }}
                                activeOpacity={0.7}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                                  <MaterialIcons
                                    name="holiday-village"
                                    size={16}
                                    color={isSelected ? '#059669' : '#9CA3AF'}
                                  />
                                  <Text
                                    style={[
                                      styles.barangayDropdownItemText,
                                      isSelected && styles.barangayDropdownItemTextActive,
                                    ]}
                                  >
                                    Brgy. {b}
                                  </Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  {count > 0 ? (
                                    <View style={styles.dropdownTruckBadge}>
                                      <Text style={styles.dropdownTruckBadgeText}>
                                        {count} truck{count === 1 ? '' : 's'}
                                      </Text>
                                    </View>
                                  ) : null}
                                  {isSelected && (
                                    <View style={styles.dropdownCheckCircle}>
                                      <MaterialIcons name="check" size={12} color="#FFFFFF" />
                                    </View>
                                  )}
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                          {filteredNewTruckBarangays.length === 0 && (
                            <View style={{ padding: 16, alignItems: 'center' }}>
                              <Text style={{ fontSize: 12.5, color: '#9CA3AF' }}>
                                No matching barangay found
                              </Text>
                            </View>
                          )}
                        </ScrollView>
                      </View>
                    )}

                    <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                      Currently Selected:{' '}
                      <Text style={{ fontWeight: '700', color: '#111827' }}>
                        Brgy. {selectedBarangayForNewTruck}
                      </Text>
                    </Text>
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Modal Actions Footer */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 10,
                marginTop: 16,
                paddingTop: 16,
                borderTopWidth: 1,
                borderTopColor: '#E5E7EB',
              }}
            >
              <TouchableOpacity
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: '#D1D5DB',
                  backgroundColor: '#FFF',
                }}
                onPress={() => {
                  setPlateError(null);
                  setIsNewTruckBarangayDropdownOpen(false);
                  setNewTruckBarangaySearchQuery('');
                  setShowAddForm(false);
                }}
                disabled={isSubmitting}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151' }}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  isSubmitting && styles.primaryBtnDisabled,
                  { paddingVertical: 10, paddingHorizontal: 18 },
                ]}
                onPress={handleAddTruck}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <MaterialIcons name="save" size={18} color="#FFF" />
                    <Text style={styles.primaryBtnText}>Register Truck</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* CENRO Barangay Filter Modal */}
      <Modal
        visible={isFilterModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsFilterModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 480 }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Filter Fleet by Barangay</Text>
                <Text style={styles.modalSubtitle}>Select an operational barangay jurisdiction</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsFilterModalVisible(false)}
                style={styles.modalCloseBtn}
              >
                <MaterialIcons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View style={styles.modalSearchContainer}>
              <MaterialIcons name="search" size={18} color="#6B7280" />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search barangay name..."
                placeholderTextColor="#9CA3AF"
                value={filterSearchQuery}
                onChangeText={setFilterSearchQuery}
                autoFocus
              />
              {filterSearchQuery ? (
                <TouchableOpacity onPress={() => setFilterSearchQuery('')}>
                  <MaterialIcons name="close" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              ) : null}
            </View>

            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {/* Option: All Barangays */}
              <TouchableOpacity
                style={[
                  styles.barangayModalRow,
                  selectedBarangayFilter === 'all' && styles.barangayModalRowActive,
                ]}
                onPress={() => {
                  setSelectedBarangayFilter('all');
                  setIsFilterModalVisible(false);
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <MaterialIcons
                    name="grid-view"
                    size={20}
                    color={selectedBarangayFilter === 'all' ? '#059669' : '#6B7280'}
                  />
                  <Text
                    style={[
                      styles.barangayModalRowText,
                      selectedBarangayFilter === 'all' && styles.barangayModalRowTextActive,
                    ]}
                  >
                    All Barangays (Whole Fleet)
                  </Text>
                </View>
                <View style={styles.truckCountBadge}>
                  <Text style={styles.truckCountBadgeText}>{trucks.length} trucks</Text>
                </View>
              </TouchableOpacity>

              {/* Option: Unassigned */}
              <TouchableOpacity
                style={[
                  styles.barangayModalRow,
                  selectedBarangayFilter === 'unassigned' && styles.barangayModalRowActive,
                ]}
                onPress={() => {
                  setSelectedBarangayFilter('unassigned');
                  setIsFilterModalVisible(false);
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <MaterialIcons
                    name="location-off"
                    size={20}
                    color={selectedBarangayFilter === 'unassigned' ? '#059669' : '#6B7280'}
                  />
                  <Text
                    style={[
                      styles.barangayModalRowText,
                      selectedBarangayFilter === 'unassigned' && styles.barangayModalRowTextActive,
                    ]}
                  >
                    Unassigned Jurisdiction
                  </Text>
                </View>
                <View style={[styles.truckCountBadge, { backgroundColor: '#F3F4F6' }]}>
                  <Text style={[styles.truckCountBadgeText, { color: '#6B7280' }]}>
                    {trucks.filter((t) => !getTruckBarangay(t)).length} trucks
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={{ height: 1, backgroundColor: '#E5E7EB', marginVertical: 8 }} />

              {/* List of 42 Danao Barangays */}
              {filteredBarangayList.map((b) => {
                const count = barangaysWithTrucks[b] || 0;
                const isSelected = selectedBarangayFilter === b;
                return (
                  <TouchableOpacity
                    key={b}
                    style={[styles.barangayModalRow, isSelected && styles.barangayModalRowActive]}
                    onPress={() => {
                      setSelectedBarangayFilter(b);
                      setIsFilterModalVisible(false);
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <MaterialIcons
                        name="holiday-village"
                        size={18}
                        color={isSelected ? '#059669' : '#6B7280'}
                      />
                      <Text
                        style={[
                          styles.barangayModalRowText,
                          isSelected && styles.barangayModalRowTextActive,
                        ]}
                      >
                        Brgy. {b}
                      </Text>
                    </View>
                    {count > 0 ? (
                      <View style={styles.truckCountBadge}>
                        <Text style={styles.truckCountBadgeText}>{count} trucks</Text>
                      </View>
                    ) : (
                      <Text style={{ fontSize: 11, color: '#9CA3AF' }}>0 trucks</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* CENRO: Assign / Transfer Barangay Modal */}
      <Modal
        visible={assignBarangayModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !isSavingBarangay && setAssignBarangayModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 480 }]}>
            {truckToAssignBarangay && (
              <>
                <View style={styles.modalHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: '#ECFDF5',
                        justifyContent: 'center',
                        alignItems: 'center',
                        borderWidth: 1,
                        borderColor: '#A7F3D0',
                      }}
                    >
                      <MaterialIcons name="edit-location-alt" size={20} color="#059669" />
                    </View>
                    <View>
                      <Text style={styles.modalTitle}>Assign Barangay</Text>
                      <Text style={styles.modalSubtitle}>
                        Unit: {truckToAssignBarangay.plateNumber} ({truckToAssignBarangay.type})
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => setAssignBarangayModalVisible(false)}
                    disabled={isSavingBarangay}
                    style={styles.modalCloseBtn}
                  >
                    <MaterialIcons name="close" size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>

                {/* Search Input */}
                <View style={styles.modalSearchContainer}>
                  <MaterialIcons name="search" size={18} color="#6B7280" />
                  <TextInput
                    style={styles.modalSearchInput}
                    placeholder="Search barangay..."
                    placeholderTextColor="#9CA3AF"
                    value={assignSearchQuery}
                    onChangeText={setAssignSearchQuery}
                  />
                  {assignSearchQuery ? (
                    <TouchableOpacity onPress={() => setAssignSearchQuery('')}>
                      <MaterialIcons name="close" size={16} color="#9CA3AF" />
                    </TouchableOpacity>
                  ) : null}
                </View>

                <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
                  {filteredAssignList.map((b) => {
                    const isSelected = targetBarangay === b;
                    return (
                      <TouchableOpacity
                        key={b}
                        style={[
                          styles.barangayModalRow,
                          isSelected && styles.barangayModalRowActive,
                        ]}
                        onPress={() => setTargetBarangay(b)}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                          <MaterialIcons
                            name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'}
                            size={18}
                            color={isSelected ? '#059669' : '#9CA3AF'}
                          />
                          <Text
                            style={[
                              styles.barangayModalRowText,
                              isSelected && styles.barangayModalRowTextActive,
                            ]}
                          >
                            Brgy. {b}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'flex-end',
                    gap: 10,
                    marginTop: 16,
                  }}
                >
                  <TouchableOpacity
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: '#D1D5DB',
                      backgroundColor: '#FFF',
                    }}
                    onPress={() => setAssignBarangayModalVisible(false)}
                    disabled={isSavingBarangay}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151' }}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 18,
                      paddingVertical: 10,
                      borderRadius: 8,
                      backgroundColor: '#059669',
                    }}
                    onPress={handleSaveTruckBarangay}
                    disabled={isSavingBarangay}
                  >
                    {isSavingBarangay ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <MaterialIcons name="save" size={16} color="#FFF" />
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFF' }}>
                          Assign to Brgy. {targetBarangay}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Truck History Modal */}
      <Modal
        visible={historyModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHistoryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedTruck && (
              <>
                <View style={styles.modalHeader}>
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.modalTitle}>{selectedTruck.plateNumber} History</Text>
                      <View
                        style={[
                          styles.statusBadge,
                          getResolvedTruckStatus(selectedTruck.status) === 'active'
                            ? styles.statusActive
                            : getResolvedTruckStatus(selectedTruck.status) === 'maintenance'
                            ? styles.statusMaintenance
                            : styles.statusOut,
                          { paddingHorizontal: 6, paddingVertical: 2 },
                        ]}
                      >
                        <View
                          style={[
                            styles.statusDot,
                            getResolvedTruckStatus(selectedTruck.status) === 'active'
                              ? { backgroundColor: '#059669' }
                              : getResolvedTruckStatus(selectedTruck.status) === 'maintenance'
                              ? { backgroundColor: '#D97706' }
                              : { backgroundColor: '#DC2626' },
                          ]}
                        />
                        <Text
                          style={[
                            styles.statusText,
                            getResolvedTruckStatus(selectedTruck.status) === 'active'
                              ? { color: '#059669' }
                              : getResolvedTruckStatus(selectedTruck.status) === 'maintenance'
                              ? { color: '#D97706' }
                              : { color: '#DC2626' },
                            { fontSize: 10.5 },
                          ]}
                        >
                          {getResolvedTruckStatus(selectedTruck.status) === 'active'
                            ? 'Active'
                            : getResolvedTruckStatus(selectedTruck.status) === 'maintenance'
                            ? 'Maintenance'
                            : 'Out of Service'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.modalSubtitle}>
                      {selectedTruck.type} • {selectedTruck.capacity} Tons • Brgy. {getTruckBarangay(selectedTruck) || 'Unassigned'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setHistoryModalVisible(false)}
                    style={styles.modalCloseBtn}
                  >
                    <MaterialIcons name="close" size={24} color="#6B7280" />
                  </TouchableOpacity>
                </View>

                {/* Current / Recent Operator Status Card */}
                {(() => {
                  const validAssigned = getValidDriver(selectedTruck);
                  const activeDriver =
                    (validAssigned ? selectedTruck.assignedDriverName : null) ||
                    activeDriverByTruck[selectedTruck.id]?.name ||
                    activeDriverByTruck[selectedTruck.plateNumber]?.name;
                  const recentDriver =
                    selectedTruck.lastDriverName ||
                    recentDriverByTruck[selectedTruck.id]?.name ||
                    recentDriverByTruck[selectedTruck.plateNumber]?.name;

                  if (activeDriver) {
                    return (
                      <View style={styles.operatorCardActive}>
                        <View style={styles.operatorCardHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={styles.activeDot} />
                            <Text style={styles.operatorCardActiveLabel}>CURRENT OPERATOR • ON SHIFT</Text>
                          </View>
                          <View style={styles.onDutyPill}>
                            <Text style={styles.onDutyPillText}>Active Now</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                          <View style={styles.operatorAvatar}>
                            <MaterialIcons name="person" size={20} color="#7C3AED" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.operatorName}>{activeDriver}</Text>
                            <Text style={styles.operatorMeta}>
                              Assigned Sector: Brgy. {getTruckBarangay(selectedTruck) || 'Danao City'}
                            </Text>
                          </View>
                          {Boolean(getValidDriver(selectedTruck)) && !isCoordinator && (
                            <TouchableOpacity
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 6,
                                backgroundColor: '#EDE9FE',
                              }}
                              onPress={() => {
                                setHistoryModalVisible(false);
                                handleOpenUnassignModal(selectedTruck);
                              }}
                            >
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#7C3AED' }}>End Shift</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  }

                  if (recentDriver) {
                    return (
                      <View style={styles.operatorCardRecent}>
                        <View style={styles.operatorCardHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <MaterialIcons name="history" size={14} color="#4B5563" />
                            <Text style={styles.operatorCardRecentLabel}>MOST RECENT OPERATOR</Text>
                          </View>
                          <View style={styles.offDutyPill}>
                            <Text style={styles.offDutyPillText}>Off Duty</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                          <View style={[styles.operatorAvatar, { backgroundColor: '#F3F4F6' }]}>
                            <MaterialIcons name="person" size={20} color="#6B7280" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.operatorName}>{recentDriver}</Text>
                            <Text style={styles.operatorMeta}>
                              Last recorded driver for this unit • Vehicle currently unassigned
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  }

                  return (
                    <View style={styles.operatorCardEmpty}>
                      <MaterialIcons name="info-outline" size={20} color="#6B7280" />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.operatorEmptyTitle}>No Driver Currently Assigned</Text>
                        <Text style={styles.operatorEmptyDesc}>
                          This vehicle is parked at dispatch depot and ready for assignment.
                        </Text>
                      </View>
                    </View>
                  );
                })()}

                {/* Filters */}
                <View style={styles.filterRow}>
                  {['week', 'month', 'all'].map((f) => (
                    <TouchableOpacity
                      key={f}
                      style={[styles.filterChip, historyFilter === f && styles.filterChipActive]}
                      onPress={() => setHistoryFilter(f as any)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          historyFilter === f && styles.filterChipTextActive,
                        ]}
                      >
                        {f === 'week' ? 'Past Week' : f === 'month' ? 'Past Month' : 'All Time'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <ScrollView style={styles.historyList}>
                  {loadingHistory ? (
                    <ActivityIndicator size="small" color="#2E8B57" style={{ marginTop: 20 }} />
                  ) : truckHistory.length === 0 ? (
                    <View style={styles.historyEmptyState}>
                      <MaterialIcons name="event-busy" size={40} color="#9CA3AF" />
                      <Text style={styles.historyEmptyTitle}>No Route Activity Recorded</Text>
                      <Text style={styles.historyEmptyDesc}>
                        {historyFilter === 'week'
                          ? 'No driver activity found for the past 7 days. Try switching to "All Time" to view full vehicle history.'
                          : historyFilter === 'month'
                          ? 'No driver activity found for the past month. Try switching to "All Time".'
                          : 'No prior route or dispatch records found for this truck.'}
                      </Text>
                    </View>
                  ) : (
                    truckHistory.map((session) => {
                      const isExpanded = !!expandedSessions[session.sessionId];
                      const hasMultiple = session.activities && session.activities.length > 1;

                      return (
                        <View key={session.sessionId} style={styles.historyItem}>
                          <View style={styles.historyTimeCol}>
                            <Text style={styles.historyDate}>{session.date}</Text>
                            <Text style={styles.historyTime}>{session.latestTime}</Text>
                            {session.earliestTime && session.earliestTime !== session.latestTime && (
                              <Text style={styles.historyTimeRange}>from {session.earliestTime}</Text>
                            )}
                          </View>

                          <View style={styles.historyDivider}>
                            <View
                              style={[
                                styles.historyDot,
                                session.status === 'issue'
                                  ? { backgroundColor: '#EF4444' }
                                  : session.status === 'active'
                                  ? { backgroundColor: '#7C3AED' }
                                  : { backgroundColor: '#059669' },
                              ]}
                            />
                            <View style={styles.historyLine} />
                          </View>

                          <TouchableOpacity
                            activeOpacity={hasMultiple ? 0.7 : 1}
                            onPress={() => hasMultiple && toggleSession(session.sessionId)}
                            style={[
                              styles.historyDetails,
                              hasMultiple && { cursor: 'pointer' as any },
                              isExpanded && styles.historyDetailsExpanded,
                            ]}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                                <MaterialIcons name="person" size={16} color="#7C3AED" />
                                <Text style={styles.historyDriver}>{session.driver}</Text>
                              </View>
                              <View
                                style={[
                                  styles.historyStatus,
                                  session.status === 'issue'
                                    ? styles.statusOut
                                    : session.status === 'active'
                                    ? { backgroundColor: '#EDE9FE' }
                                    : styles.statusActive,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.statusText,
                                    session.status === 'issue'
                                      ? { color: '#DC2626' }
                                      : session.status === 'active'
                                      ? { color: '#7C3AED' }
                                      : { color: '#059669' },
                                  ]}
                                >
                                  {session.status === 'issue'
                                    ? 'Issue Reported'
                                    : session.status === 'active'
                                    ? 'Active On Duty'
                                    : 'Completed'}
                                </Text>
                              </View>
                            </View>

                            <View style={styles.historyActionRow}>
                              <MaterialIcons
                                name={session.status === 'active' ? 'play-arrow' : 'check-circle-outline'}
                                size={14}
                                color="#4B5563"
                              />
                              <Text style={styles.historyActionText}>{session.primaryAction}</Text>
                            </View>

                            <Text style={styles.historyRoute}>
                              <MaterialIcons name="place" size={13} color="#6B7280" /> {session.primaryRoute}
                            </Text>

                            {/* Dropdown Toggle indicator for combined session */}
                            {hasMultiple && (
                              <View style={styles.sessionDropdownToggle}>
                                <View style={styles.sessionDropdownBadge}>
                                  <MaterialIcons name="alt-route" size={13} color="#1D4ED8" />
                                  <Text style={styles.sessionDropdownBadgeText}>
                                    {session.activities.length} session activities
                                  </Text>
                                </View>
                                <View style={styles.sessionDropdownHint}>
                                  <Text style={styles.sessionDropdownHintText}>
                                    {isExpanded ? 'Hide Details' : 'View Dropdown'}
                                  </Text>
                                  <MaterialIcons
                                    name={isExpanded ? 'expand-less' : 'expand-more'}
                                    size={18}
                                    color="#2563EB"
                                  />
                                </View>
                              </View>
                            )}

                            {/* Dropdown list of detailed activities in this session */}
                            {isExpanded && hasMultiple && (
                              <View style={styles.sessionActivitiesContainer}>
                                {session.activities.map((act: any, idx: number) => (
                                  <View
                                    key={act.id || idx}
                                    style={[
                                      styles.sessionSubActivityRow,
                                      idx === session.activities.length - 1 && { borderBottomWidth: 0 },
                                    ]}
                                  >
                                    <View
                                      style={[
                                        styles.sessionSubActivityDot,
                                        act.status === 'active'
                                          ? { backgroundColor: '#7C3AED' }
                                          : act.status === 'issue'
                                          ? { backgroundColor: '#EF4444' }
                                          : { backgroundColor: '#059669' },
                                      ]}
                                    />
                                    <Text style={styles.sessionSubActivityTime}>{act.time}</Text>
                                    <View style={styles.sessionSubActivityContent}>
                                      <Text style={styles.sessionSubActivityAction}>{act.action}</Text>
                                      <Text style={styles.sessionSubActivityRoute}>
                                        <MaterialIcons name="place" size={11} color="#6B7280" /> {act.route}
                                      </Text>
                                    </View>
                                  </View>
                                ))}
                              </View>
                            )}
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Unassign Driver Confirmation Modal */}
      <Modal
        visible={unassignModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !isUnassigning && setUnassignModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 460 }]}>
            {truckToUnassign && (
              <>
                <View style={styles.modalHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: '#F5F3FF',
                        justifyContent: 'center',
                        alignItems: 'center',
                        borderWidth: 1,
                        borderColor: '#DDD6FE',
                      }}
                    >
                      <MaterialIcons name="power-settings-new" size={20} color="#7C3AED" />
                    </View>
                    <View>
                      <Text style={styles.modalTitle}>End Shift</Text>
                      <Text style={styles.modalSubtitle}>Conclude driver shift for this vehicle</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => setUnassignModalVisible(false)}
                    disabled={isUnassigning}
                    style={styles.modalCloseBtn}
                  >
                    <MaterialIcons name="close" size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>

                <View
                  style={{
                    marginVertical: 16,
                    backgroundColor: '#F9FAFB',
                    padding: 16,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#E5E7EB',
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 13, color: '#6B7280', fontWeight: '600' }}>TRUCK:</Text>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: '#111827' }}>
                      {truckToUnassign.plateNumber} ({truckToUnassign.type || 'Compactor'} -{' '}
                      {truckToUnassign.capacity} Tons)
                    </Text>
                  </View>

                  <View style={{ height: 1, backgroundColor: '#E5E7EB' }} />

                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 13, color: '#6B7280', fontWeight: '600' }}>
                      ASSIGNED DRIVER:
                    </Text>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        backgroundColor: '#EDE9FE',
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 12,
                      }}
                    >
                      <MaterialIcons name="person" size={14} color="#7C3AED" />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#7C3AED' }}>
                        {truckToUnassign.assignedDriverName || 'Assigned Driver'}
                      </Text>
                    </View>
                  </View>

                  <View style={{ height: 1, backgroundColor: '#E5E7EB' }} />

                  <View
                    style={{
                      flexDirection: 'row',
                      gap: 8,
                      alignItems: 'flex-start',
                      marginTop: 2,
                    }}
                  >
                    <MaterialIcons
                      name="info-outline"
                      size={16}
                      color="#6B7280"
                      style={{ marginTop: 1 }}
                    />
                    <Text style={{ fontSize: 12, color: '#6B7280', flex: 1, lineHeight: 18 }}>
                      This will end the driver&apos;s active shift on this truck and update their status to off-duty.
                    </Text>
                  </View>
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'flex-end',
                    gap: 10,
                    marginTop: 8,
                  }}
                >
                  <TouchableOpacity
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: '#D1D5DB',
                      backgroundColor: '#FFF',
                    }}
                    onPress={() => setUnassignModalVisible(false)}
                    disabled={isUnassigning}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151' }}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 18,
                      paddingVertical: 10,
                      borderRadius: 8,
                      backgroundColor: '#7C3AED',
                    }}
                    onPress={executeUnassignDriver}
                    disabled={isUnassigning}
                  >
                    {isUnassigning ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <MaterialIcons name="power-settings-new" size={16} color="#FFF" />
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFF' }}>
                          End Shift
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Assign Driver to Vehicle Modal */}
      <Modal
        visible={assignDriverModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !isAssigningDriver && setAssignDriverModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 500, maxHeight: '90%' }]}>
            {truckToAssignDriver && (
              <>
                <View style={styles.modalHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: '#F5F3FF',
                        justifyContent: 'center',
                        alignItems: 'center',
                        borderWidth: 1,
                        borderColor: '#DDD6FE',
                      }}
                    >
                      <MaterialIcons name="person-add" size={20} color="#7C3AED" />
                    </View>
                    <View>
                      <Text style={styles.modalTitle}>Assign Driver to Truck</Text>
                      <Text style={styles.modalSubtitle}>
                        {getTruckBarangay(truckToAssignDriver)
                          ? `Select a certified driver for Brgy. ${getTruckBarangay(truckToAssignDriver)}`
                          : `Select a certified driver for ${truckToAssignDriver.plateNumber}`}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => setAssignDriverModalVisible(false)}
                    disabled={isAssigningDriver}
                    style={styles.modalCloseBtn}
                  >
                    <MaterialIcons name="close" size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>

                {/* Truck Summary Box */}
                <View
                  style={{
                    marginVertical: 12,
                    backgroundColor: '#F9FAFB',
                    padding: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: '#E5E7EB',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <View>
                    <Text style={{ fontSize: 10, color: '#6B7280', fontWeight: '700', letterSpacing: 0.5 }}>VEHICLE UNIT</Text>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#111827' }}>
                      {truckToAssignDriver.plateNumber}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#4B5563' }}>
                      {truckToAssignDriver.type || 'Compactor'} · {truckToAssignDriver.capacity} Tons
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 10, color: '#6B7280', fontWeight: '700', letterSpacing: 0.5 }}>SECTOR</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#059669' }}>
                      Brgy. {getTruckBarangay(truckToAssignDriver) || 'Danao City'}
                    </Text>
                  </View>
                </View>

                {/* Sector restriction notice */}
                {truckToAssignDriver && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      backgroundColor: getTruckBarangay(truckToAssignDriver) ? '#ECFDF5' : '#FEF2F2',
                      paddingVertical: 7,
                      paddingHorizontal: 10,
                      borderRadius: 8,
                      marginBottom: 10,
                      borderWidth: 1,
                      borderColor: getTruckBarangay(truckToAssignDriver) ? '#A7F3D0' : '#FECACA',
                    }}
                  >
                    <MaterialIcons
                      name={getTruckBarangay(truckToAssignDriver) ? 'verified' : 'warning'}
                      size={15}
                      color={getTruckBarangay(truckToAssignDriver) ? '#059669' : '#DC2626'}
                    />
                    <Text
                      style={{
                        fontSize: 11.5,
                        color: getTruckBarangay(truckToAssignDriver) ? '#065F46' : '#991B1B',
                        fontWeight: '600',
                      }}
                    >
                      {getTruckBarangay(truckToAssignDriver)
                        ? `Strictly showing drivers registered to Brgy. ${getTruckBarangay(truckToAssignDriver)}`
                        : 'This truck has no assigned barangay. Assign a barangay first.'}
                    </Text>
                  </View>
                )}

                {/* Search Bar for Drivers */}
                <View style={{ marginBottom: 10 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: '#FFFFFF',
                      borderWidth: 1,
                      borderColor: '#D1D5DB',
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      height: 40,
                    }}
                  >
                    <MaterialIcons name="search" size={18} color="#9CA3AF" />
                    <TextInput
                      style={{ flex: 1, marginLeft: 8, fontSize: 13, color: '#111827' }}
                      placeholder={
                        truckToAssignDriver && getTruckBarangay(truckToAssignDriver)
                          ? `Search driver in Brgy. ${getTruckBarangay(truckToAssignDriver)}...`
                          : 'Search driver by name, ID, or barangay...'
                      }
                      value={driverSearchQuery}
                      onChangeText={setDriverSearchQuery}
                      placeholderTextColor="#9CA3AF"
                    />
                    {driverSearchQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setDriverSearchQuery('')}>
                        <MaterialIcons name="close" size={16} color="#9CA3AF" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* Drivers List */}
                <ScrollView style={{ maxHeight: 260, marginBottom: 14 }}>
                  {filteredDriversToAssign.length === 0 ? (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <MaterialIcons name="person-off" size={32} color="#9CA3AF" />
                      <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 8, textAlign: 'center', fontWeight: '600' }}>
                        {truckToAssignDriver && getTruckBarangay(truckToAssignDriver)
                          ? `No certified drivers found registered to Brgy. ${getTruckBarangay(truckToAssignDriver)}.`
                          : 'No certified drivers found for this vehicle.'}
                      </Text>
                      {truckToAssignDriver && !getTruckBarangay(truckToAssignDriver) && (
                        <Text style={{ fontSize: 11, color: '#DC2626', marginTop: 4, textAlign: 'center' }}>
                          This truck has no assigned barangay. Please assign a barangay to the truck first.
                        </Text>
                      )}
                    </View>
                  ) : (
                    filteredDriversToAssign.map((drv) => {
                      const isSelected = drv.id === selectedDriverIdToAssign;
                      const hasOtherTruck = Boolean(
                        drv.currentTruckPlate && drv.currentTruckPlate !== truckToAssignDriver.plateNumber
                      );
                      return (
                        <TouchableOpacity
                          key={drv.id}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            padding: 10,
                            borderRadius: 10,
                            marginBottom: 8,
                            backgroundColor: isSelected ? '#F5F3FF' : hasOtherTruck ? '#F9FAFB' : '#FFFFFF',
                            borderWidth: 1.5,
                            borderColor: isSelected ? '#7C3AED' : '#E5E7EB',
                            opacity: hasOtherTruck ? 0.7 : 1,
                          }}
                          onPress={() => {
                            if (hasOtherTruck) {
                              Alert.alert(
                                'Driver Currently Assigned',
                                `${drv.name} is already assigned to truck ${drv.currentTruckPlate}. Please unassign them or end their shift on that truck before reassigning.`
                              );
                              return;
                            }
                            setSelectedDriverIdToAssign(drv.id);
                          }}
                          activeOpacity={hasOtherTruck ? 0.9 : 0.7}
                        >
                          <View
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 18,
                              backgroundColor: isSelected ? '#7C3AED' : hasOtherTruck ? '#E5E7EB' : '#EDE9FE',
                              justifyContent: 'center',
                              alignItems: 'center',
                              marginRight: 10,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: '700',
                                color: isSelected ? '#FFFFFF' : hasOtherTruck ? '#6B7280' : '#7C3AED',
                              }}
                            >
                              {drv.name.slice(0, 2).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: hasOtherTruck ? '#4B5563' : '#111827' }}>
                              {drv.name}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                              {drv.employeeId ? (
                                <Text style={{ fontSize: 11, color: '#6B7280' }}>
                                  {drv.employeeId}
                                </Text>
                              ) : null}
                              {drv.assignedBarangay ? (
                                <Text style={{ fontSize: 11, color: '#059669', fontWeight: '600' }}>
                                  • Brgy. {drv.assignedBarangay}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                          {hasOtherTruck ? (
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 4,
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: 6,
                                backgroundColor: '#FEF3C7',
                                borderWidth: 1,
                                borderColor: '#FDE68A',
                              }}
                            >
                              <MaterialIcons name="lock" size={11} color="#92400E" />
                              <Text style={{ fontSize: 10.5, fontWeight: '700', color: '#92400E' }}>
                                Assigned: {drv.currentTruckPlate}
                              </Text>
                            </View>
                          ) : (
                            <View
                              style={{
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: 6,
                                backgroundColor: '#ECFDF5',
                                borderWidth: 1,
                                borderColor: '#A7F3D0',
                              }}
                            >
                              <Text style={{ fontSize: 10.5, fontWeight: '700', color: '#065F46' }}>
                                Available
                              </Text>
                            </View>
                          )}
                          {hasOtherTruck ? (
                            <View style={{ marginLeft: 8 }}>
                              <MaterialIcons name="lock-outline" size={18} color="#9CA3AF" />
                            </View>
                          ) : (
                            <MaterialIcons
                              name={isSelected ? 'check-circle' : 'radio-button-unchecked'}
                              size={20}
                              color={isSelected ? '#7C3AED' : '#D1D5DB'}
                              style={{ marginLeft: 8 }}
                            />
                          )}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>

                {/* Footer Buttons */}
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                  <TouchableOpacity
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: '#D1D5DB',
                      backgroundColor: '#FFF',
                    }}
                    onPress={() => setAssignDriverModalVisible(false)}
                    disabled={isAssigningDriver}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151' }}>Cancel</Text>
                  </TouchableOpacity>

                  {(() => {
                    const selectedDriver = filteredDriversToAssign.find((d) => d.id === selectedDriverIdToAssign);
                    const isSelectedDriverBlocked = Boolean(
                      selectedDriver?.currentTruckPlate &&
                      selectedDriver.currentTruckPlate !== truckToAssignDriver.plateNumber
                    );
                    const isConfirmDisabled =
                      !selectedDriverIdToAssign ||
                      isAssigningDriver ||
                      isSelectedDriverBlocked ||
                      !filteredDriversToAssign.some((d) => d.id === selectedDriverIdToAssign);

                    return (
                      <TouchableOpacity
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingHorizontal: 18,
                          paddingVertical: 10,
                          borderRadius: 8,
                          backgroundColor: isConfirmDisabled ? '#9CA3AF' : '#7C3AED',
                        }}
                        onPress={executeAssignDriver}
                        disabled={isConfirmDisabled}
                      >
                        {isAssigningDriver ? (
                          <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                          <>
                            <MaterialIcons name="check" size={16} color="#FFF" />
                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFF' }}>
                              Confirm Assignment
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    );
                  })()}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Change Truck Operational Status Confirmation Modal */}
      <Modal
        visible={statusConfirmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !isUpdatingStatus && setStatusConfirmModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 480 }]}>
            {truckToChangeStatus && (() => {
              const currentResolved = getResolvedTruckStatus(truckToChangeStatus.status);
              const targetMeta = getStatusMeta(targetStatusToApply);
              const currentMeta = getStatusMeta(currentResolved);
              const currentDriver = truckToChangeStatus.assignedDriverName || getValidDriver(truckToChangeStatus)?.name;

              return (
                <>
                  <View style={styles.modalHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: targetMeta.badgeBg,
                          justifyContent: 'center',
                          alignItems: 'center',
                          borderWidth: 1,
                          borderColor: targetMeta.badgeBorder,
                        }}
                      >
                        <MaterialIcons name={targetMeta.icon} size={20} color={targetMeta.color} />
                      </View>
                      <View>
                        <Text style={styles.modalTitle}>{targetMeta.title}</Text>
                        <Text style={styles.modalSubtitle}>{targetMeta.subtitle}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => setStatusConfirmModalVisible(false)}
                      disabled={isUpdatingStatus}
                      style={styles.modalCloseBtn}
                    >
                      <MaterialIcons name="close" size={20} color="#9CA3AF" />
                    </TouchableOpacity>
                  </View>

                  <View
                    style={{
                      marginVertical: 16,
                      backgroundColor: '#F9FAFB',
                      padding: 16,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                      gap: 12,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 13, color: '#6B7280', fontWeight: '600' }}>TRUCK:</Text>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: '#111827' }}>
                        {truckToChangeStatus.plateNumber} ({truckToChangeStatus.type || 'Compactor'} -{' '}
                        {truckToChangeStatus.capacity} Tons)
                      </Text>
                    </View>

                    <View style={{ height: 1, backgroundColor: '#E5E7EB' }} />

                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 13, color: '#6B7280', fontWeight: '600' }}>
                        JURISDICTION:
                      </Text>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#1F2937' }}>
                        Brgy. {getTruckBarangay(truckToChangeStatus) || 'Danao City'}
                      </Text>
                    </View>

                    <View style={{ height: 1, backgroundColor: '#E5E7EB' }} />

                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 13, color: '#6B7280', fontWeight: '600' }}>
                        STATUS TRANSITION:
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: 6,
                            backgroundColor: currentMeta.badgeBg,
                            borderWidth: 1,
                            borderColor: currentMeta.badgeBorder,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '700', color: currentMeta.color }}>
                            {currentMeta.label}
                          </Text>
                        </View>
                        <MaterialIcons name="arrow-forward" size={14} color="#9CA3AF" />
                        <View
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: 6,
                            backgroundColor: targetMeta.badgeBg,
                            borderWidth: 1,
                            borderColor: targetMeta.badgeBorder,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '700', color: targetMeta.color }}>
                            {targetMeta.label}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {Boolean(currentDriver) && targetStatusToApply !== 'active' && (
                      <>
                        <View style={{ height: 1, backgroundColor: '#E5E7EB' }} />
                        <View
                          style={{
                            backgroundColor: '#FEF3C7',
                            borderWidth: 1,
                            borderColor: '#FDE68A',
                            borderRadius: 8,
                            padding: 10,
                            flexDirection: 'row',
                            gap: 8,
                            alignItems: 'flex-start',
                          }}
                        >
                          <MaterialIcons name="warning" size={16} color="#B45309" style={{ marginTop: 2 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#92400E', marginBottom: 2 }}>
                              Active Driver Assigned
                            </Text>
                            <Text style={{ fontSize: 11.5, color: '#B45309', lineHeight: 16 }}>
                              Driver <Text style={{ fontWeight: '700' }}>{currentDriver}</Text> is currently assigned to this vehicle. Changing the status to {targetMeta.label.toLowerCase()} will mark the truck unavailable for collection runs.
                            </Text>
                          </View>
                        </View>
                      </>
                    )}

                    <View style={{ height: 1, backgroundColor: '#E5E7EB' }} />

                    <View
                      style={{
                        flexDirection: 'row',
                        gap: 8,
                        alignItems: 'flex-start',
                        marginTop: 2,
                      }}
                    >
                      <MaterialIcons
                        name="info-outline"
                        size={16}
                        color="#6B7280"
                        style={{ marginTop: 1 }}
                      />
                      <Text style={{ fontSize: 12, color: '#6B7280', flex: 1, lineHeight: 18 }}>
                        {targetMeta.description}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'flex-end',
                      gap: 10,
                      marginTop: 8,
                    }}
                  >
                    <TouchableOpacity
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: '#D1D5DB',
                        backgroundColor: '#FFF',
                      }}
                      onPress={() => setStatusConfirmModalVisible(false)}
                      disabled={isUpdatingStatus}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151' }}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: 18,
                        paddingVertical: 10,
                        borderRadius: 8,
                        backgroundColor: targetMeta.btnBg,
                      }}
                      onPress={confirmUpdateStatus}
                      disabled={isUpdatingStatus}
                    >
                      {isUpdatingStatus ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <>
                          <MaterialIcons name={targetMeta.icon} size={16} color="#FFF" />
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFF' }}>
                            {targetMeta.btnText}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Fleet Inventory Official QR Badge Modal */}
      {selectedTruckForFleetQr && (
        <FleetInventoryQrBadgeModal
          visible={fleetQrModalVisible}
          onClose={() => {
            setFleetQrModalVisible(false);
            setSelectedTruckForFleetQr(null);
          }}
          truck={selectedTruckForFleetQr}
        />
      )}

      {/* Driver Official QR Badge Modal */}
      {selectedDriverForQr && (
        <DriverQrBadgeModal
          visible={driverQrModalVisible}
          onClose={() => {
            setDriverQrModalVisible(false);
            setSelectedDriverForQr(null);
          }}
          driverData={selectedDriverForQr}
        />
      )}

      {/* Fleet Inventory Export Modal */}
      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="Municipal Truck Fleet Inventory"
        dataCount={displayedTrucks.length}
        onExport={handleExport}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB', padding: 24 },
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
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 4 },
  headerDesc: { fontSize: 14, color: '#6B7280' },

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

  coordinatorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 20,
  },
  coordinatorBannerText: { fontSize: 13.5, color: '#065F46', flex: 1 },

  // CENRO Filter Section
  filterSection: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    marginBottom: 20,
    gap: 12,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filterSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.5,
  },
  clearFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
  },
  clearFilterText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  filterControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  filterDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    minWidth: 240,
    maxWidth: 360,
  },
  filterDropdownBtnActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  filterDropdownLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.5,
  },
  filterDropdownValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2E8B57',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#FFF', fontSize: 14, fontWeight: '600' },

  summaryGrid: { flexDirection: 'row', gap: 16, marginBottom: 24, flexWrap: 'wrap' },
  summaryCard: {
    flex: 1,
    minWidth: 180,
    backgroundColor: '#FFF',
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  summaryCardActiveAll: {
    borderColor: '#166534',
    borderWidth: 2,
    backgroundColor: '#F0FDF4',
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryCardActiveStatus: {
    borderColor: '#059669',
    borderWidth: 2,
    backgroundColor: '#ECFDF5',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryCardActiveDeployed: {
    borderColor: '#7C3AED',
    borderWidth: 2,
    backgroundColor: '#F5F3FF',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryCardActiveMaintenance: {
    borderColor: '#D97706',
    borderWidth: 2,
    backgroundColor: '#FFFBEB',
    shadowColor: '#D97706',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryCardActiveOut: {
    borderColor: '#DC2626',
    borderWidth: 2,
    backgroundColor: '#FEF2F2',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  activePillSmall: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activePillSmallText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
  },
  activeFilterTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  activeFilterTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  resetFilterBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  resetFilterBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  thContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  summaryIconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryTitle: { fontSize: 12.5, color: '#6B7280', fontWeight: '500', marginBottom: 2 },
  summaryValue: { fontSize: 22, fontWeight: '800', color: '#111827' },

  formCard: {
    backgroundColor: '#FFF',
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 24,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  formGroup: { flex: 1, minWidth: 250 },
  label: { fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 8, letterSpacing: 0.5 },
  requiredAsterisk: { color: '#EF4444', fontWeight: '800' },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#111827',
  },

  lockedBarangayCard: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 8,
    padding: 12,
  },
  lockedBarangayName: { fontSize: 14, fontWeight: '800', color: '#065F46' },
  lockedBarangayDesc: { fontSize: 11, color: '#047857', marginTop: 2 },

  barangayDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  barangayDropdownBtnActive: {
    borderColor: '#059669',
    backgroundColor: '#FFFFFF',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  barangayDropdownValue: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#111827',
  },
  barangayDropdownSubtext: {
    fontSize: 10.5,
    color: '#6B7280',
    marginTop: 1,
  },
  barangayDropdownMenu: {
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  barangayDropdownSearchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  barangayDropdownSearchInput: {
    flex: 1,
    fontSize: 12.5,
    color: '#111827',
    paddingVertical: 2,
  },
  barangayDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  barangayDropdownItemActive: {
    backgroundColor: '#ECFDF5',
  },
  barangayDropdownItemText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
  },
  barangayDropdownItemTextActive: {
    color: '#065F46',
    fontWeight: '700',
  },
  dropdownTruckBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  dropdownTruckBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2E8B57',
  },
  dropdownCheckCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
  },

  typeSelector: { flexDirection: 'row', gap: 8 },
  typeBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
  },
  typeBtnActive: { backgroundColor: '#E8F5E9', borderColor: '#2E8B57' },
  typeBtnText: { fontSize: 13, fontWeight: '600', color: '#4B5563' },
  typeBtnTextActive: { color: '#2E8B57' },

  formFooter: { marginTop: 24, alignItems: 'flex-end' },

  tableCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    padding: 20,
  },
  tableCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  tableCountSubtitle: { fontSize: 12.5, color: '#6B7280', fontWeight: '500' },
  table: { width: '100%' },
  tableHead: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  th: { fontSize: 11.5, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5 },
  tr: {
    flexDirection: 'row',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    paddingHorizontal: 16,
  },
  td: { justifyContent: 'flex-start' },

  avatarBg: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  truckPlate: { fontSize: 14.5, fontWeight: '700', color: '#111827' },
  truckType: { fontSize: 12, color: '#6B7280', marginTop: 1 },

  barangayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    alignSelf: 'flex-start',
    maxWidth: 160,
  },
  barangayBadgeText: { fontSize: 11.5, fontWeight: '700', color: '#065F46' },

  capacityText: { fontSize: 13.5, fontWeight: '600', color: '#374151' },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  statusActive: { backgroundColor: '#ECFDF5' },
  statusMaintenance: { backgroundColor: '#FEF3C7' },
  statusOut: { backgroundColor: '#FEE2E2' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11.5, fontWeight: '600' },

  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },

  driverAssignedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#EDE9FE',
    alignSelf: 'flex-start',
  },
  driverAssignedText: { fontSize: 11.5, fontWeight: '600', color: '#7C3AED', maxWidth: 120 },
  driverActiveSubtext: { fontSize: 10, color: '#16A34A', fontWeight: '700', marginTop: 2, marginLeft: 2 },
  lastDriverRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  lastDriverText: { fontSize: 10.5, color: '#6B7280', maxWidth: 130 },
  noDriverSubtext: { fontSize: 10, color: '#9CA3AF', marginTop: 2 },
  unassignedText: { fontSize: 12, color: '#6B7280', fontStyle: 'italic' },

  emptyTable: { padding: 40, alignItems: 'center', gap: 8 },
  emptyText: { color: '#9CA3AF', fontSize: 14, textAlign: 'center' },

  // Operator Status Cards
  operatorCardActive: {
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  operatorCardRecent: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  operatorCardEmpty: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  operatorCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  operatorCardActiveLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6D28D9',
    letterSpacing: 0.5,
  },
  operatorCardRecentLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4B5563',
    letterSpacing: 0.5,
  },
  operatorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EDE9FE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  operatorName: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#111827',
  },
  operatorMeta: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },
  operatorEmptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  operatorEmptyDesc: {
    fontSize: 11.5,
    color: '#6B7280',
    marginTop: 1,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16A34A',
  },
  onDutyPill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  onDutyPillText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#15803D',
  },
  offDutyPill: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  offDutyPillText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#4B5563',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxWidth: 600,
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },
  modalSubtitle: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  modalCloseBtn: { padding: 4 },

  modalSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  modalSearchInput: { flex: 1, fontSize: 13, color: '#111827' },

  barangayModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  barangayModalRowActive: { backgroundColor: '#ECFDF5' },
  barangayModalRowText: { fontSize: 13.5, color: '#374151', fontWeight: '500' },
  barangayModalRowTextActive: { color: '#065F46', fontWeight: '700' },
  truckCountBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  truckCountBadgeText: { fontSize: 11, fontWeight: '700', color: '#2E8B57' },

  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  filterChipActive: { backgroundColor: '#E8F5E9', borderColor: '#2E8B57' },
  filterChipText: { fontSize: 13, fontWeight: '600', color: '#4B5563' },
  filterChipTextActive: { color: '#2E8B57' },

  historyList: { flex: 1 },
  historyItem: { flexDirection: 'row', marginBottom: 16 },
  historyTimeCol: { width: 90, alignItems: 'flex-end', paddingTop: 2 },
  historyDate: { fontSize: 12.5, fontWeight: '700', color: '#111827' },
  historyTime: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  historyDivider: { width: 30, alignItems: 'center', marginHorizontal: 8 },
  historyDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#2E8B57', zIndex: 1 },
  historyLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#E5E7EB',
    position: 'absolute',
    top: 12,
    bottom: -16,
  },
  historyDetails: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  historyDriver: { fontSize: 13.5, fontWeight: '700', color: '#111827' },
  historyActionRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  historyActionText: { fontSize: 12, fontWeight: '600', color: '#4B5563' },
  historyRoute: { fontSize: 12, color: '#6B7280' },
  historyStatus: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  historyTimeRange: { fontSize: 9.5, color: '#9CA3AF', marginTop: 1 },
  historyDetailsExpanded: {
    borderColor: '#93C5FD',
    backgroundColor: '#F8FAFC',
  },
  sessionDropdownToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  sessionDropdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sessionDropdownBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  sessionDropdownHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  sessionDropdownHintText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#2563EB',
  },
  sessionActivitiesContainer: {
    marginTop: 10,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sessionSubActivityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sessionSubActivityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
    marginTop: 5,
    marginRight: 8,
  },
  sessionSubActivityTime: {
    fontSize: 10.5,
    color: '#64748B',
    fontWeight: '700',
    minWidth: 58,
  },
  sessionSubActivityContent: {
    flex: 1,
  },
  sessionSubActivityAction: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
  },
  sessionSubActivityRoute: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },

  historyEmptyState: { padding: 30, alignItems: 'center', gap: 6 },
  historyEmptyTitle: { fontSize: 14.5, fontWeight: '700', color: '#374151' },
  historyEmptyDesc: { fontSize: 12, color: '#6B7280', textAlign: 'center', maxWidth: 360, lineHeight: 17 },
});
