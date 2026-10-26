import { useAuthContext } from '@/components/AuthContext';
import { db } from '@/config/firebase';
import { useTheme } from '@/hooks/useTheme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, query, runTransaction, serverTimestamp, updateDoc, where, addDoc } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import StartShiftQrScannerModal from '@/components/driver/StartShiftQrScannerModal';
import { autoAssignQueuedReportsOnDriverShiftStart } from '@/services/autoDispatchService';
import { getDriverShiftDieselRecommendation, ShiftDieselRecommendation } from '@/services/dieselRecommendationService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

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
  currentBarangay?: string;
  shiftStartedAt?: any;
  createdAt: any;
}

export default function SelectTruckScreen() {
  const router = useRouter();
  const { user } = useAuthContext();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();

  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  // Driver assigned barangay & profile state
  const [driverBarangay, setDriverBarangay] = useState<string>('');
  const [driverBarangayLoading, setDriverBarangayLoading] = useState<boolean>(true);
  const [driverBarangayMap, setDriverBarangayMap] = useState<Record<string, string>>({});

  const [confirmTruck, setConfirmTruck] = useState<Truck | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showStartShiftQrModal, setShowStartShiftQrModal] = useState(false);
  const [fuelRec, setFuelRec] = useState<ShiftDieselRecommendation | null>(null);
  const [loadingFuelRec, setLoadingFuelRec] = useState(false);

  // Fetch all trucks in real-time
  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      collection(db, 'trucks'),
      (snapshot) => {
        const truckList: Truck[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          truckList.push({
            id: docSnap.id,
            plateNumber: data.plateNumber || 'N/A',
            type: data.type || 'Unknown',
            capacity: data.capacity || '0',
            status: data.status || 'active',
            assignedDriverId: data.assignedDriverId || undefined,
            assignedDriverName: data.assignedDriverName || undefined,
            assignedBarangay: (data.assignedBarangay || data.barangay || data.currentBarangay || '').trim(),
            barangay: (data.barangay || data.assignedBarangay || data.currentBarangay || '').trim(),
            currentBarangay: (data.currentBarangay || data.assignedBarangay || data.barangay || '').trim(),
            shiftStartedAt: data.shiftStartedAt || undefined,
            createdAt: data.createdAt,
          });
        });

        // Sort: active first, then maintenance, then out_of_service
        const statusOrder: Record<string, number> = { active: 0, maintenance: 1, out_of_service: 2 };
        truckList.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));

        setTrucks(truckList);
        setLoading(false);
      },
      (error) => {
        if (error?.code !== 'permission-denied') {
          console.warn('SelectTruck: trucks listener error:', error);
        }
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Listen to current driver's user document to retrieve assigned barangay
  useEffect(() => {
    if (!db || !user?.uid) {
      setDriverBarangayLoading(false);
      return;
    }

    const userRef = doc(db, 'users', user.uid);
    const unsubscribeUser = onSnapshot(
      userRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const b = (data.assignedBarangay || data.barangay || '').trim();
          setDriverBarangay(b);
        }
        setDriverBarangayLoading(false);
      },
      (error) => {
        if (error?.code !== 'permission-denied') {
          console.warn('SelectTruck: user doc listener error:', error);
        }
        setDriverBarangayLoading(false);
      }
    );

    return () => unsubscribeUser();
  }, [user?.uid]);

  // Also check if driver has an active route assignment in barangay_schedules
  useEffect(() => {
    if (!db || !user?.uid) return;
    const unsub = onSnapshot(
      collection(db, 'barangay_schedules'),
      (snap) => {
        let matchedBrgy = '';
        snap.forEach((d) => {
          if (matchedBrgy) return;
          const data = d.data();
          if (data.assignedDriverId === user.uid) {
            matchedBrgy = (data.barangayName || data.barangay || '').trim();
          } else if (Array.isArray(data.specificSchedules || data.pickups)) {
            const hasSpecial = (data.specificSchedules || data.pickups).some(
              (ss: any) => ss.assignedDriverId === user.uid
            );
            if (hasSpecial) {
              matchedBrgy = (data.barangayName || data.barangay || '').trim();
            }
          }
        });
        if (matchedBrgy) {
          setDriverBarangay((prev) => (!prev || prev === 'Poblacion' ? matchedBrgy : prev));
        }
      },
      (err) => {
        if (err?.code !== 'permission-denied') {
          console.warn('SelectTruck: barangay_schedules listener error:', err);
        }
      }
    );
    return () => unsub();
  }, [user?.uid]);

  // Fallback: listen to driver profiles in users collection to map any truck's assignedDriverId to driver's barangay
  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(query(collection(db, 'users'), where('role', '==', 'driver')), (snap) => {
      const bMap: Record<string, string> = {};
      snap.forEach((docSnap) => {
        const u = docSnap.data();
        const b = (u.assignedBarangay || u.barangay || '').trim();
        if (b) {
          bMap[docSnap.id] = b;
        }
      });
      setDriverBarangayMap(bMap);
    }, () => {});
    return () => unsub();
  }, []);

  const normalizeBrgy = (str?: string): string => {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/^brgy\.?\s*/i, '')
      .replace(/^barangay\s*/i, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  };

  const getTruckBarangay = (truck: Truck): string => {
    if (truck.assignedBarangay && truck.assignedBarangay.trim()) return truck.assignedBarangay.trim();
    if (truck.barangay && truck.barangay.trim()) return truck.barangay.trim();
    if (truck.currentBarangay && truck.currentBarangay.trim()) return truck.currentBarangay.trim();
    if (truck.assignedDriverId && driverBarangayMap[truck.assignedDriverId]) {
      return driverBarangayMap[truck.assignedDriverId].trim();
    }
    return '';
  };

  // Strictly filter trucks: only trucks assigned to the driver's barangay can the driver see
  const filteredTrucks = useMemo(() => {
    if (driverBarangayLoading) return [];
    if (!driverBarangay) return [];

    const normDriverBrgy = normalizeBrgy(driverBarangay);

    return trucks.filter((truck) => {
      // If the truck is already currently assigned to this driver, keep it visible
      if (user?.uid && truck.assignedDriverId === user.uid) {
        return true;
      }
      const truckBrgy = getTruckBarangay(truck);
      return normalizeBrgy(truckBrgy) === normDriverBrgy;
    });
  }, [trucks, driverBarangay, driverBarangayLoading, driverBarangayMap, user?.uid]);

  const getTruckIcon = (type: string): keyof typeof MaterialIcons.glyphMap => {
    switch (type.toLowerCase()) {
      case 'compactor':
        return 'compress';
      case 'dump truck':
        return 'local-shipping';
      case 'mini-dump':
        return 'fire-truck';
      default:
        return 'local-shipping';
    }
  };

  const getStatusConfig = (truck: Truck) => {
    const isAssignedToMe = truck.assignedDriverId === user?.uid;
    const isAssignedToOther = !!truck.assignedDriverId && truck.assignedDriverId !== user?.uid;

    if (isAssignedToOther) {
      return {
        borderColor: isDark ? '#4B5563' : '#D1D5DB',
        bgColor: isDark ? '#1F2937' : '#F9FAFB',
        label: `Assigned to: ${truck.assignedDriverName || 'Another Driver'}`,
        labelColor: isDark ? '#9CA3AF' : '#6B7280',
        disabled: true,
        iconBg: isDark ? '#374151' : '#E5E7EB',
        iconColor: isDark ? '#6B7280' : '#9CA3AF',
      };
    }

    if (isAssignedToMe) {
      return {
        borderColor: isDark ? '#3B82F6' : '#60A5FA',
        bgColor: isDark ? '#1E3A5F' : '#EFF6FF',
        label: 'Assigned to You • Tap to Start Duty',
        labelColor: isDark ? '#93C5FD' : '#2563EB',
        disabled: false,
        iconBg: isDark ? '#1E40AF' : '#DBEAFE',
        iconColor: isDark ? '#60A5FA' : '#2563EB',
      };
    }

    switch (String(truck.status || '').toLowerCase().trim()) {
      case 'active':
      case 'available':
      case 'assigned':
      case 'in_use':
      case 'idle':
      case '':
        return {
          borderColor: isDark ? '#22C55E' : '#86EFAC',
          bgColor: isDark ? '#1C2920' : '#F0FDF4',
          label: 'Available',
          labelColor: isDark ? '#86EFAC' : '#16A34A',
          disabled: false,
          iconBg: isDark ? '#166534' : '#DCFCE7',
          iconColor: isDark ? '#86EFAC' : '#16A34A',
        };
      case 'maintenance':
        return {
          borderColor: isDark ? '#F59E0B' : '#FCD34D',
          bgColor: isDark ? '#2D2410' : '#FFFBEB',
          label: 'Under Maintenance',
          labelColor: isDark ? '#FCD34D' : '#D97706',
          disabled: true,
          iconBg: isDark ? '#78350F' : '#FEF3C7',
          iconColor: isDark ? '#FCD34D' : '#D97706',
        };
      case 'inactive':
      case 'decommissioned':
      case 'out_of_service':
        return {
          borderColor: isDark ? '#EF4444' : '#FCA5A5',
          bgColor: isDark ? '#2D1010' : '#FEF2F2',
          label: 'Out of Service',
          labelColor: isDark ? '#FCA5A5' : '#DC2626',
          disabled: true,
          iconBg: isDark ? '#7F1D1D' : '#FEE2E2',
          iconColor: isDark ? '#FCA5A5' : '#DC2626',
        };
      default:
        return {
          borderColor: isDark ? '#4B5563' : '#D1D5DB',
          bgColor: isDark ? '#1F2937' : '#F9FAFB',
          label: 'Unknown',
          labelColor: isDark ? '#9CA3AF' : '#6B7280',
          disabled: true,
          iconBg: isDark ? '#374151' : '#E5E7EB',
          iconColor: isDark ? '#6B7280' : '#9CA3AF',
        };
    }
  };

  const handleSelectTruck = async (truck: Truck) => {
    if (!user) return;
    setConfirmTruck(truck);
    setShowConfirmModal(true);
    setLoadingFuelRec(true);
    setFuelRec(null);
    try {
      const b = driverBarangay || getTruckBarangay(truck) || 'Poblacion';
      const rec = await getDriverShiftDieselRecommendation(user.uid, truck.id, b, {
        type: truck.type,
        capacity: truck.capacity,
        plateNumber: truck.plateNumber,
      });
      setFuelRec(rec);
    } catch (err) {
      console.warn('SelectTruck: could not fetch fuel recommendation:', err);
    } finally {
      setLoadingFuelRec(false);
    }
  };

  const handleConfirmAssignment = () => {
    if (!confirmTruck) return;
    setShowConfirmModal(false);
    assignTruck(confirmTruck);
  };

  const assignTruck = async (truck: Truck) => {
    if (!user || !db) return;

    setAssigning(true);
    try {
      const driverName = user.displayName || user.email || 'Unknown Driver';

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Truck assignment timed out. Please check network connection.')), 10000);
      });

      const performUpdates = async () => {
        const truckRef = doc(db, 'trucks', truck.id);
        const userRef = doc(db, 'users', user.uid);

        await runTransaction(db, async (tx) => {
          const truckSnap = await tx.get(truckRef);
          if (!truckSnap.exists()) {
            throw new Error('Selected truck no longer exists.');
          }
          const liveTruck = truckSnap.data() || {};
          const liveStatus = String(liveTruck.status || '').toLowerCase().trim();
          if (liveStatus === 'maintenance' || liveStatus === 'out_of_service' || liveStatus === 'inactive' || liveStatus === 'decommissioned') {
            throw new Error('This truck is currently unavailable for dispatch.');
          }
          if (
            liveTruck.assignedDriverId &&
            liveTruck.assignedDriverId !== user.uid &&
            Boolean(liveTruck.shiftStartedAt)
          ) {
            throw new Error(`This truck was just claimed by ${liveTruck.assignedDriverName || 'another driver'}.`);
          }

          tx.update(truckRef, {
            assignedDriverId: user.uid,
            assignedDriverName: driverName,
            lastDriverId: user.uid,
            lastDriverName: driverName,
            lastUsedAt: serverTimestamp(),
            shiftStartedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          tx.update(userRef, {
            currentTruckId: truck.id,
            currentTruckPlate: truck.plateNumber,
            status: 'on_duty',
            dutyStatus: 'on_duty',
            updatedAt: serverTimestamp(),
          });
        });

        // Log to truck_usage_history for permanent fleet audit trail
        try {
          const assignedBarangay = driverBarangay || getTruckBarangay(truck) || 'Poblacion';
          await addDoc(collection(db, 'truck_usage_history'), {
            truckId: truck.id,
            truckPlate: truck.plateNumber,
            driverId: user.uid,
            driverName: driverName,
            driverEmail: user.email || '',
            barangay: assignedBarangay,
            action: 'shift_started',
            timestamp: serverTimestamp(),
            createdAt: serverTimestamp(),
            status: 'active',
          });
        } catch (histErr) {
          console.warn('SelectTruck: could not log to truck_usage_history:', histErr);
        }

        // Check if there are queued verified reports for this driver's assigned barangay
        try {
          const assignedBarangay = driverBarangay || getTruckBarangay(truck) || 'Poblacion';
          autoAssignQueuedReportsOnDriverShiftStart(user.uid, assignedBarangay, truck.id, truck.plateNumber).catch((err) => {
            console.warn('Shift start auto-bundle background note:', err);
          });
        } catch (bundleErr) {
          console.warn('Could not auto-bundle reports on shift start:', bundleErr);
        }
      };

      try {
        await Promise.race([performUpdates(), timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      router.replace('/(driver)');
    } catch (error: any) {
      console.error('Failed to assign truck:', error);
      const isQuota = error?.code === 'resource-exhausted' || error?.message?.includes('Quota exceeded') || error?.message?.includes('resource-exhausted');
      const msg = isQuota
        ? 'Firebase daily quota has been exceeded for today. Firestore operations will resume once quota resets.'
        : (error?.message || 'Failed to assign truck. Please try again.');

      Alert.alert(isQuota ? 'Firebase Quota Exceeded' : 'Assignment Error', msg);
    } finally {
      setAssigning(false);
    }
  };

  const handleQrVerified = async (_scannedData: string, truckInfo?: any) => {
    setShowStartShiftQrModal(false);
    if (!truckInfo?.truckId && !truckInfo?.plateNumber) {
      Alert.alert('Scan Error', 'Could not detect vehicle plate from QR code.');
      return;
    }

    let matchingTruck = trucks.find(
      (t) =>
        (truckInfo.truckId && t.id === truckInfo.truckId) ||
        (truckInfo.plateNumber && t.plateNumber.toUpperCase() === truckInfo.plateNumber.toUpperCase())
    );

    if (!matchingTruck && db && truckInfo.truckId) {
      try {
        const trSnap = await getDoc(doc(db, 'trucks', truckInfo.truckId));
        if (trSnap.exists()) {
          const d = trSnap.data();
          matchingTruck = {
            id: trSnap.id,
            plateNumber: d.plateNumber || 'N/A',
            type: d.type || 'Unknown',
            capacity: d.capacity || '0',
            status: d.status || 'active',
            assignedDriverId: d.assignedDriverId || undefined,
            assignedDriverName: d.assignedDriverName || undefined,
            assignedBarangay: (d.assignedBarangay || d.barangay || '').trim(),
            barangay: (d.barangay || d.assignedBarangay || '').trim(),
            currentBarangay: (d.currentBarangay || d.assignedBarangay || '').trim(),
            shiftStartedAt: d.shiftStartedAt || undefined,
            createdAt: d.createdAt,
          };
        }
      } catch (err) {
        console.warn('Error fetching scanned truck doc:', err);
      }
    }

    if (!matchingTruck) {
      Alert.alert('Vehicle Not Found', `Vehicle ${truckInfo.plateNumber || truckInfo.truckId} could not be found in active inventory.`);
      return;
    }

    if (matchingTruck.assignedDriverId && matchingTruck.assignedDriverId !== user?.uid) {
      Alert.alert('Vehicle Unavailable', `Truck ${matchingTruck.plateNumber} is currently assigned to another driver.`);
      return;
    }

    assignTruck(matchingTruck);
  };

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(driver)' as any);
    }
  };

  if (loading || driverBarangayLoading) {
    return (
      <SafeAreaView style={[styles.safeArea, isDark && styles.safeAreaDark]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={isDark ? '#86EFAC' : '#4E6C50'} />
          <Text style={[styles.loadingText, isDark && styles.textMuted]}>Loading assigned fleet for your sector...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, isDark && styles.safeAreaDark]}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View
        style={[
          styles.header,
          isDark && styles.headerDark,
          { paddingTop: Math.max(insets.top, StatusBar.currentHeight || 0) + 12 },
        ]}
      >
        <View style={styles.headerTopBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleGoBack}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerPillTag}>
            <Text style={styles.headerPillTagText}>Shift Initialization</Text>
          </View>
        </View>

        <View style={styles.headerContent}>
          <View style={styles.headerTitleRow}>
            <MaterialIcons name="local-shipping" size={28} color="#FFFFFF" />
            <Text style={styles.headerTitle}>Select Your Truck</Text>
          </View>
          <Text style={styles.headerSubtitle}>
            {driverBarangay
              ? `Available fleet for Brgy. ${driverBarangay}`
              : 'Choose an assigned truck for today’s shift'}
          </Text>
        </View>
      </View>

      {/* Truck List */}
      <ScrollView
        style={[styles.scrollView, isDark && styles.scrollViewDark]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Quick QR Scanner Banner */}
        <TouchableOpacity
          style={styles.scanQrBannerBtn}
          onPress={() => setShowStartShiftQrModal(true)}
          activeOpacity={0.8}
        >
          <View style={styles.scanQrIconCircle}>
            <MaterialIcons name="qr-code-scanner" size={22} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.scanQrBannerTitle}>Scan Fleet Inventory QR</Text>
            <Text style={styles.scanQrBannerSubtitle}>Point camera at the truck badge to start duty immediately</Text>
          </View>
          <MaterialIcons name="chevron-right" size={22} color="#A7F3D0" />
        </TouchableOpacity>
        {!driverBarangay ? (
          <View style={[styles.emptyCard, isDark && styles.emptyCardDark]}>
            <View style={[styles.emptyIconContainer, { backgroundColor: isDark ? '#372020' : '#FEE2E2' }]}>
              <MaterialIcons name="location-off" size={36} color={isDark ? '#F87171' : '#EF4444'} />
            </View>
            <Text style={[styles.emptyTitle, isDark && styles.textLight]}>No Barangay Assigned</Text>
            <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
              Your driver account is not assigned to any barangay collection sector. Please contact CENRO Administration to assign you to a barangay before selecting a truck.
            </Text>
          </View>
        ) : filteredTrucks.length === 0 ? (
          <View style={[styles.emptyCard, isDark && styles.emptyCardDark]}>
            <View style={[styles.emptyIconContainer, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}>
              <MaterialIcons name="local-shipping" size={36} color={isDark ? '#9CA3AF' : '#6B7280'} />
            </View>
            <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
              No Trucks in Brgy. {driverBarangay}
            </Text>
            <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
              There are currently no municipal collection trucks assigned to Brgy. {driverBarangay}. Please contact CENRO Fleet Management to assign a vehicle to your sector.
            </Text>
          </View>
        ) : (
          filteredTrucks.map((truck) => {
            const config = getStatusConfig(truck);
            const truckBrgy = getTruckBarangay(truck);

            return (
              <TouchableOpacity
                key={truck.id}
                style={[
                  styles.truckCard,
                  {
                    backgroundColor: config.bgColor,
                    borderColor: config.borderColor,
                  },
                  config.disabled && styles.truckCardDisabled,
                ]}
                activeOpacity={config.disabled ? 1 : 0.7}
                onPress={() => !config.disabled && handleSelectTruck(truck)}
                disabled={config.disabled}
              >
                {/* Truck Icon */}
                <View style={[styles.truckIconContainer, { backgroundColor: config.iconBg }]}>
                  <MaterialIcons
                    name={getTruckIcon(truck.type)}
                    size={28}
                    color={config.iconColor}
                  />
                </View>

                {/* Truck Info */}
                <View style={styles.truckInfo}>
                  <Text
                    style={[
                      styles.plateNumber,
                      isDark && styles.textLight,
                      config.disabled && { opacity: 0.6 },
                    ]}
                  >
                    {truck.plateNumber}
                  </Text>
                  <Text
                    style={[
                      styles.truckType,
                      isDark && styles.textMuted,
                      config.disabled && { opacity: 0.6 },
                    ]}
                  >
                    {truck.type} • {truck.capacity} Tons
                  </Text>

                  {/* Status & Barangay Badges */}
                  <View style={styles.badgeRow}>
                    <View style={[styles.statusBadge, { backgroundColor: config.iconBg }]}>
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: config.labelColor },
                        ]}
                      />
                      <Text style={[styles.statusLabel, { color: config.labelColor }]}>
                        {config.label}
                      </Text>
                    </View>

                    {truckBrgy ? (
                      <View style={[styles.barangayBadge, isDark && styles.barangayBadgeDark]}>
                        <MaterialIcons
                          name="location-on"
                          size={12}
                          color={isDark ? '#86EFAC' : '#15803D'}
                        />
                        <Text style={[styles.barangayBadgeText, isDark && styles.barangayBadgeTextDark]}>
                          Brgy. {truckBrgy}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* Arrow for selectable trucks */}
                {!config.disabled && (
                  <View style={styles.selectArrow}>
                    <Feather
                      name="chevron-right"
                      size={20}
                      color={isDark ? '#86EFAC' : '#16A34A'}
                    />
                  </View>
                )}

                {/* Lock icon for disabled trucks */}
                {config.disabled && (
                  <View style={styles.lockIcon}>
                    <Feather
                      name="lock"
                      size={16}
                      color={isDark ? '#4B5563' : '#D1D5DB'}
                    />
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Confirmation Modal ── */}
      <Modal
        visible={showConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, isDark && styles.modalCardDark]}>
            {/* Modal Header Icon */}
            <View style={styles.modalIconCircle}>
              <MaterialIcons name="local-shipping" size={36} color="#FFFFFF" />
            </View>

            <Text style={[styles.modalTitle, isDark && styles.textLight]}>
              Confirm Truck Selection
            </Text>
            <Text style={[styles.modalSubtitle, isDark && styles.textMuted]}>
              You’re about to start your shift with this truck
            </Text>

            <ScrollView style={{ width: '100%', maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {/* Truck Detail Card */}
              {confirmTruck && (
                <View style={[styles.modalDetailCard, isDark && { backgroundColor: '#1F2937', borderColor: '#374151' }]}>
                  <View style={styles.modalDetailRow}>
                    <View style={styles.modalDetailLabel}>
                      <MaterialIcons name="confirmation-number" size={16} color={isDark ? '#86EFAC' : '#2E8B57'} />
                      <Text style={[styles.modalDetailLabelText, isDark && styles.textMuted]}>Plate Number</Text>
                    </View>
                    <Text style={[styles.modalDetailValue, isDark && styles.textLight]}>{confirmTruck.plateNumber}</Text>
                  </View>

                  <View style={[styles.modalDivider, isDark && { backgroundColor: '#374151' }]} />

                  <View style={styles.modalDetailRow}>
                    <View style={styles.modalDetailLabel}>
                      <MaterialIcons name="category" size={16} color={isDark ? '#86EFAC' : '#2E8B57'} />
                      <Text style={[styles.modalDetailLabelText, isDark && styles.textMuted]}>Type</Text>
                    </View>
                    <Text style={[styles.modalDetailValue, isDark && styles.textLight]}>{confirmTruck.type}</Text>
                  </View>

                  <View style={[styles.modalDivider, isDark && { backgroundColor: '#374151' }]} />

                  <View style={styles.modalDetailRow}>
                    <View style={styles.modalDetailLabel}>
                      <MaterialIcons name="fitness-center" size={16} color={isDark ? '#86EFAC' : '#2E8B57'} />
                      <Text style={[styles.modalDetailLabelText, isDark && styles.textMuted]}>Capacity</Text>
                    </View>
                    <Text style={[styles.modalDetailValue, isDark && styles.textLight]}>{confirmTruck.capacity} Tons</Text>
                  </View>

                  <View style={[styles.modalDivider, isDark && { backgroundColor: '#374151' }]} />

                  <View style={styles.modalDetailRow}>
                    <View style={styles.modalDetailLabel}>
                      <MaterialIcons name="location-on" size={16} color={isDark ? '#86EFAC' : '#2E8B57'} />
                      <Text style={[styles.modalDetailLabelText, isDark && styles.textMuted]}>Assigned Sector</Text>
                    </View>
                    <Text style={[styles.modalDetailValue, isDark && styles.textLight]}>
                      Brgy. {getTruckBarangay(confirmTruck) || driverBarangay || 'Poblacion'}
                    </Text>
                  </View>
                </View>
              )}

              {/* AI Refueling Advice Card */}
              {loadingFuelRec ? (
                <View style={[styles.fuelRecLoadingCard, isDark && styles.fuelRecLoadingCardDark]}>
                  <ActivityIndicator size="small" color={isDark ? '#86EFAC' : '#166534'} />
                  <Text style={[styles.fuelRecLoadingText, isDark && styles.textMuted]}>
                    Calculating shift fuel recommendation & citizen reports buffer...
                  </Text>
                </View>
              ) : fuelRec ? (
                <View style={[styles.fuelRecCard, isDark && styles.fuelRecCardDark]}>
                  <View style={styles.fuelRecHeaderRow}>
                    <View style={styles.fuelRecHeaderLeft}>
                      <MaterialIcons
                        name="local-gas-station"
                        size={18}
                        color={fuelRec.isAiLearned ? (isDark ? '#86EFAC' : '#166534') : (isDark ? '#93C5FD' : '#2563EB')}
                      />
                      <Text
                        style={[
                          styles.fuelRecHeaderTitle,
                          isDark && styles.textLight,
                          !fuelRec.isAiLearned && { color: isDark ? '#93C5FD' : '#1E40AF' },
                        ]}
                        numberOfLines={1}
                      >
                        {fuelRec.isAiLearned ? 'AI Refueling Advice' : 'Route Baseline Estimate'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.fuelRecBadge,
                        fuelRec.isAiLearned ? styles.fuelRecBadgeLearned : styles.fuelRecBadgeGathering,
                      ]}
                    >
                      <Text
                        style={[
                          styles.fuelRecBadgeText,
                          !fuelRec.isAiLearned && styles.fuelRecBadgeTextGathering,
                        ]}
                      >
                        {fuelRec.isAiLearned
                          ? 'AI Learned'
                          : `${fuelRec.eligibleTripsCount}/${fuelRec.learningThreshold} Trips`}
                      </Text>
                    </View>
                  </View>

                  {/* Big Number Banner */}
                  <View
                    style={[
                      styles.fuelRecBanner,
                      isDark && styles.fuelRecBannerDark,
                      !fuelRec.isAiLearned && { borderColor: isDark ? '#1E3A8A' : '#BFDBFE' },
                    ]}
                  >
                    <View>
                      <Text style={[styles.fuelRecBannerSubtitle, isDark && styles.textMuted]}>
                        {fuelRec.isAiLearned
                          ? 'Recommended Refuel for Shift'
                          : 'Estimated Refuel for Shift (Cold-Start)'}
                      </Text>
                      <Text
                        style={[
                          styles.fuelRecBannerNumber,
                          isDark && { color: fuelRec.isAiLearned ? '#86EFAC' : '#93C5FD' },
                          !isDark && !fuelRec.isAiLearned && { color: '#1D4ED8' },
                        ]}
                      >
                        {fuelRec.totalRecommendedLiters.toFixed(1)} <Text style={styles.fuelRecBannerUnit}>Liters</Text>
                      </Text>
                    </View>
                    {fuelRec.estimatedCostPhp !== null && (
                      <View
                        style={[
                          styles.fuelRecCostPill,
                          !fuelRec.isAiLearned && { backgroundColor: isDark ? '#1E3A8A' : '#DBEAFE' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.fuelRecCostText,
                            !fuelRec.isAiLearned && { color: isDark ? '#BFDBFE' : '#1E40AF' },
                          ]}
                        >
                          ≈ ₱{fuelRec.estimatedCostPhp.toFixed(2)}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Itemized Breakdown */}
                  <View style={styles.fuelRecBreakdownList}>
                    <View style={styles.fuelRecItemRow}>
                      <View style={styles.fuelRecItemLeft}>
                        <MaterialIcons name="alt-route" size={14} color={isDark ? '#9CA3AF' : '#4B5563'} />
                        <Text style={[styles.fuelRecItemLabel, isDark && styles.textLight]}>
                          Usual Route ({fuelRec.barangay})
                        </Text>
                      </View>
                      <Text style={[styles.fuelRecItemValue, isDark && styles.textLight]}>
                        {fuelRec.usualBaselineLiters.toFixed(1)} L
                      </Text>
                    </View>

                    <View style={styles.fuelRecItemRow}>
                      <View style={styles.fuelRecItemLeft}>
                        <MaterialIcons name="tune" size={14} color={isDark ? '#9CA3AF' : '#4B5563'} />
                        <Text style={[styles.fuelRecItemLabel, isDark && styles.textLight]}>
                          Efficiency Rating ({confirmTruck?.type || 'Truck'})
                        </Text>
                      </View>
                      <Text style={[styles.fuelRecItemValue, isDark && styles.textLight]}>
                        {fuelRec.kmPerLiter ? `${fuelRec.kmPerLiter.toFixed(1)} km/L` : '3.0 km/L'}
                      </Text>
                    </View>

                    <View style={styles.fuelRecItemRow}>
                      <View style={styles.fuelRecItemLeft}>
                        <MaterialIcons name="report" size={14} color="#D97706" />
                        <Text style={[styles.fuelRecItemLabel, isDark && styles.textLight]}>
                          Citizen Reports ({fuelRec.reportCount})
                        </Text>
                      </View>
                      <Text style={[styles.fuelRecItemValue, { color: fuelRec.reportExtraLiters > 0 ? '#D97706' : (isDark ? '#9CA3AF' : '#6B7280') }]}>
                        {fuelRec.reportExtraLiters > 0 ? `+${fuelRec.reportExtraLiters.toFixed(1)} L` : '0.0 L'}
                      </Text>
                    </View>

                    <View style={styles.fuelRecItemRow}>
                      <View style={styles.fuelRecItemLeft}>
                        <MaterialIcons name="shield" size={14} color="#2563EB" />
                        <Text style={[styles.fuelRecItemLabel, isDark && styles.textLight]}>
                          Safety Reserve (+10%)
                        </Text>
                      </View>
                      <Text style={[styles.fuelRecItemValue, { color: '#2563EB' }]}>
                        +{fuelRec.safetyReserveLiters.toFixed(1)} L
                      </Text>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.fuelRecFooterNotice,
                      isDark && styles.fuelRecFooterNoticeDark,
                      !fuelRec.isAiLearned && { backgroundColor: isDark ? '#1E293B' : '#EFF6FF' },
                    ]}
                  >
                    <MaterialIcons
                      name="info-outline"
                      size={14}
                      color={fuelRec.isAiLearned ? (isDark ? '#86EFAC' : '#166534') : (isDark ? '#93C5FD' : '#1D4ED8')}
                    />
                    <Text
                      style={[
                        styles.fuelRecFooterNoticeText,
                        isDark && { color: fuelRec.isAiLearned ? '#86EFAC' : '#93C5FD' },
                        !isDark && !fuelRec.isAiLearned && { color: '#1E40AF' },
                      ]}
                    >
                      {fuelRec.isAiLearned
                        ? (fuelRec.reportCount > 0
                            ? `Includes extra fuel so you don't run out during ${fuelRec.reportCount} citizen report detour(s).`
                            : 'AI calibrated from verified municipal dispatch history with a 10% safety margin.')
                        : (fuelRec.reportCount > 0
                            ? `Calculated from ${fuelRec.barangay} route distance (${fuelRec.baselineDistanceKm.toFixed(1)} km) + ${fuelRec.reportCount} report detour(s). AI calibration begins after 12 logged shifts.`
                            : `Calculated from ${fuelRec.barangay} road network distance (${fuelRec.baselineDistanceKm.toFixed(1)} km). AI learning unlocks after 12 verified shifts.`)}
                    </Text>
                  </View>
                </View>
              ) : null}
            </ScrollView>

            {/* Action Buttons */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalCancelBtn, isDark && { backgroundColor: '#374151', borderColor: '#4B5563' }]}
                onPress={() => setShowConfirmModal(false)}
                activeOpacity={0.8}
              >
                <Text style={[styles.modalCancelText, isDark && { color: '#D1D5DB' }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleConfirmAssignment}
                activeOpacity={0.85}
              >
                <MaterialIcons name="play-arrow" size={20} color="#FFFFFF" />
                <Text style={styles.modalConfirmText}>Start Shift</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Start Shift QR Scanner Modal ── */}
      <StartShiftQrScannerModal
        visible={showStartShiftQrModal}
        onClose={() => setShowStartShiftQrModal(false)}
        driverUid={user?.uid}
        onVerified={handleQrVerified}
        isStartingShift={assigning}
      />

      {/* Assigning Overlay */}
      {assigning && (
        <View style={styles.overlay}>
          <View style={[styles.overlayContent, isDark && styles.overlayContentDark]}>
            <ActivityIndicator size="large" color={isDark ? '#86EFAC' : '#4E6C50'} />
            <Text style={[styles.overlayText, isDark && styles.textLight]}>
              Starting your shift...
            </Text>
            <Text style={[styles.overlaySubtext, isDark && styles.textMuted]}>
              Assigning truck and preparing dashboard
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4FBF1',
  },
  safeAreaDark: {
    backgroundColor: '#111827',
  },
  textLight: {
    color: '#F9FAFB',
  },
  textMuted: {
    color: '#9CA3AF',
  },
  scanQrBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#064E3B',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    gap: 12,
    borderWidth: 1.5,
    borderColor: '#059669',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  scanQrIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanQrBannerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  scanQrBannerSubtitle: {
    fontSize: 11,
    color: '#A7F3D0',
    marginTop: 2,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },

  // Header
  header: {
    backgroundColor: '#2D4A35',
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  headerDark: {
    backgroundColor: '#1A2E23',
  },
  headerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  headerPillTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  headerPillTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A7F3D0',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  headerContent: {
    gap: 4,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginLeft: 38,
  },

  // Scroll
  scrollView: {
    flex: 1,
    backgroundColor: '#F4FBF1',
  },
  scrollViewDark: {
    backgroundColor: '#111827',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },

  // Empty State
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 36,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    gap: 8,
    marginTop: 10,
  },
  emptyCardDark: {
    backgroundColor: '#1F2937',
    borderColor: '#374151',
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1F2937',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 290,
  },

  // Truck Card
  truckCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  truckCardDisabled: {
    elevation: 0,
    shadowOpacity: 0,
  },
  truckIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  truckInfo: {
    flex: 1,
    gap: 2,
  },
  plateNumber: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1F2937',
    letterSpacing: 0.3,
  },
  truckType: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  barangayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 3,
  },
  barangayBadgeDark: {
    backgroundColor: '#064E3B',
  },
  barangayBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  barangayBadgeTextDark: {
    color: '#86EFAC',
  },
  selectArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(22, 163, 74, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Confirmation Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 15,
  },
  modalCardDark: {
    backgroundColor: '#111827',
  },
  modalIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#2E8B57',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#2E8B57',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
  },
  modalDetailCard: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 24,
  },
  modalDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  modalDetailLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalDetailLabelText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  modalDetailValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  modalActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4B5563',
  },
  modalConfirmBtn: {
    flex: 1.5,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#2E8B57',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#2E8B57',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  overlayContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 40,
    alignItems: 'center',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
    minWidth: 260,
  },
  overlayContentDark: {
    backgroundColor: '#1F2937',
  },
  overlayText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  overlaySubtext: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },

  // Fuel Recommendation Card Styles
  fuelRecLoadingCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  fuelRecLoadingCardDark: {
    backgroundColor: '#064E3B',
    borderColor: '#065F46',
  },
  fuelRecLoadingText: {
    fontSize: 12,
    color: '#166534',
    textAlign: 'center',
  },
  fuelRecCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    marginBottom: 20,
  },
  fuelRecCardDark: {
    backgroundColor: '#0F291E',
    borderColor: '#166534',
  },
  fuelRecHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  fuelRecHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    flexShrink: 1,
  },
  fuelRecHeaderTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
    flexShrink: 1,
  },
  fuelRecBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    flexShrink: 0,
  },
  fuelRecBadgeLearned: {
    backgroundColor: '#DCFCE7',
  },
  fuelRecBadgeGathering: {
    backgroundColor: '#FEF3C7',
  },
  fuelRecBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  fuelRecBadgeTextGathering: {
    color: '#B45309',
  },
  fuelRecBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  fuelRecBannerDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  fuelRecBannerSubtitle: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
    marginBottom: 2,
  },
  fuelRecBannerNumber: {
    fontSize: 22,
    fontWeight: '900',
    color: '#15803D',
  },
  fuelRecBannerUnit: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4B5563',
  },
  fuelRecCostPill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  fuelRecCostText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  fuelRecBreakdownList: {
    gap: 8,
    marginBottom: 12,
  },
  fuelRecItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fuelRecItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fuelRecItemLabel: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
  fuelRecItemValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  fuelRecFooterNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    padding: 8,
    borderRadius: 8,
  },
  fuelRecFooterNoticeDark: {
    backgroundColor: '#064E3B',
  },
  fuelRecFooterNoticeText: {
    fontSize: 11,
    color: '#166534',
    flex: 1,
    lineHeight: 15,
  },
});
