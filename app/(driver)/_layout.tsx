import { useTheme } from '@/hooks/useTheme';
import { Tabs, useRouter, usePathname } from 'expo-router';
import { collection, doc, onSnapshot, query, where, updateDoc, serverTimestamp } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Modal, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthContext } from '@/components/AuthContext';
import { CustomTabBar } from '@/components/CustomTabBar';
import { auth, db } from '@/config/firebase';
import { MaterialIcons, Feather } from '@expo/vector-icons';

import { locationService } from '@/services/locationService';
import { syncOfflineDriverActions } from '@/services/driverOfflineQueue';
import {
  subscribeToSystemOverrides,
  SystemOverridesData,
  DEFAULT_OVERRIDES,
  EmergencyBroadcastData,
} from '@/services/systemOverridesService';
import { getDriverSessionOrigin, clearDriverSessionOrigin } from '@/services/driverQrService';
import {
  announceEmergencyBroadcast,
  stopSpeaking,
} from '@/services/voiceAnnouncementService';


export default function DriverLayout() {
  const { user, loading: authLoading } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const isHomeScreen = pathname === '/(driver)' || pathname === '/(driver)/' || pathname === '' || pathname === '/index';
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [assignedTruckId, setAssignedTruckId] = useState<string | null>(null);
  const [activeRouteCount, setActiveRouteCount] = useState(0);
  const [activeScheduleIds, setActiveScheduleIds] = useState<string[]>([]);
  const [assignedBarangay, setAssignedBarangay] = useState<string>('');
  const [routePolyline, setRoutePolyline] = useState<{ latitude: number; longitude: number }[]>([]);

  // Fleet inventory unassigned notification state
  const [showUnassignedModal, setShowUnassignedModal] = useState(false);
  const [unassignedDetails, setUnassignedDetails] = useState<{
    truckPlate: string;
    unassignedBy: string;
    unassignedAt?: string;
  } | null>(null);
  const previousTruckIdRef = useRef<string | null>(null);
  const previousTruckPlateRef = useRef<string | null>(null);
  const isInitialSnapshotRef = useRef(true);

  // CENRO System Overrides State (Emergency Pause, Flood Warning, etc.)
  const [systemOverrides, setSystemOverrides] = useState<SystemOverridesData>(DEFAULT_OVERRIDES);
  const [showEmergencyPauseModal, setShowEmergencyPauseModal] = useState(false);
  const [hasAcknowledgedCurrentPause, setHasAcknowledgedCurrentPause] = useState(false);
  const [showResumedToast, setShowResumedToast] = useState(false);
  const prevPauseStateRef = useRef<boolean>(false);
  const isFirstOverrideCheckRef = useRef<boolean>(true);

  // CENRO Emergency Broadcast State & In-Cab Voice Announcement
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const prevBroadcastIdRef = useRef<string | null>(null);
  const acknowledgedBroadcastIdsRef = useRef<string[]>([]);


  // Check if user has driver role
  useEffect(() => {
    if (authLoading) return;
    const activeUid = user?.uid || auth.currentUser?.uid;
    if (!activeUid || !db) {
      setIsAuthorized(false);
      setIsLoading(false);
      router.replace('/auth');
      return;
    }

    const userRef = doc(db, 'users', activeUid);
    const unsub = onSnapshot(userRef, async (snap) => {
      if (snap.exists()) {
        const userData = snap.data();
        if (userData.role !== 'driver' && userData.role !== 'admin') {
          // Redirect non-driver users away from driver interface to home
          setIsAuthorized(false);
          setIsLoading(false);
          router.replace('/(tabs)/home');
          return;
        }
        if (userData.disabled === true || userData.status === 'disabled') {
          setIsAuthorized(false);
          setIsLoading(false);
          router.replace('/auth');
          return;
        }

        // Access to the Driver Portal is strictly restricted to QR badge verification
        if (userData.role === 'driver') {
          const origin = await getDriverSessionOrigin();
          const isOnDuty = userData.dutyStatus === 'on_duty' || !!userData.currentTruckId;
          if (!origin && !isOnDuty) {
            setIsAuthorized(false);
            setIsLoading(false);
            router.replace('/(tabs)/home');
            return;
          }
        }


        const prevTruckId = previousTruckIdRef.current;
        const prevPlate = previousTruckPlateRef.current;
        const newTruckId = typeof userData.currentTruckId === 'string' ? userData.currentTruckId : null;
        const newPlate = typeof userData.currentTruckPlate === 'string' ? userData.currentTruckPlate : null;

        // 1. Check if admin explicitly set an unassignedNotice
        if (userData.unassignedNotice && userData.unassignedNotice.acknowledged === false) {
          setUnassignedDetails({
            truckPlate: userData.unassignedNotice.truckPlate || prevPlate || 'Assigned Truck',
            unassignedBy: userData.unassignedNotice.unassignedBy || 'CENRO Fleet Admin',
            unassignedAt: userData.unassignedNotice.unassignedAt,
          });
          setShowUnassignedModal(true);
        }
        // 2. Fallback detection: if driver was active on a truck in the previous tick and is now unassigned
        else if (!isInitialSnapshotRef.current && prevTruckId && !newTruckId && userData.dutyStatus === 'off_duty') {
          if (!userData.unassignedNotice || userData.unassignedNotice.acknowledged === false) {
            setUnassignedDetails({
              truckPlate: prevPlate || 'Assigned Truck',
              unassignedBy: 'CENRO Fleet Admin',
            });
            setShowUnassignedModal(true);
          }
        }

        previousTruckIdRef.current = newTruckId;
        previousTruckPlateRef.current = newPlate;
        isInitialSnapshotRef.current = false;

        setAssignedTruckId(newTruckId);
        setIsAuthorized(true);
      } else {
        setIsAuthorized(true);
      }
      setIsLoading(false);
    }, (error) => {
      if (error?.code !== 'permission-denied') {
        console.warn('DriverLayout: user profile listener error:', error);
      }
      setIsAuthorized(true);
      setIsLoading(false);
    });

    return () => unsub();
  }, [user?.uid, router]);

  const handleAcknowledgeUnassign = async () => {
    setShowUnassignedModal(false);
    const activeUid = user?.uid || auth.currentUser?.uid;
    if (activeUid && db) {
      await locationService.stopTracking(activeUid);
      await locationService.stopSimulation(activeUid);

      try {
        await updateDoc(doc(db, 'users', activeUid), {
          'unassignedNotice.acknowledged': true,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn('Could not mark unassignedNotice acknowledged:', e);
      }
    }
    const origin = await getDriverSessionOrigin();
    if (origin === 'resident') {
      router.replace('/(tabs)/home');
    } else {
      try {
        await auth.signOut();
      } catch (err) {
        console.warn('Sign out error on unassign acknowledge:', err);
      }
      await clearDriverSessionOrigin();
      router.replace('/auth');
    }
  };

  useEffect(() => {
    if (!user?.uid || !db) return;
    const assignedQuery = query(collection(db, 'schedules'), where('assignedDriverId', '==', user.uid));
    const unsubscribeSchedules = onSnapshot(
      assignedQuery,
      snapshot => {
        const active = snapshot.docs.filter(schedule => !schedule.data().dieselClosedAt && ['pending', 'in-progress', 'in_progress'].includes(String(schedule.data().status)));
        const master = active.filter(schedule => schedule.data().isLiveDispatch);
        setActiveRouteCount(active.length);
        setActiveScheduleIds((master.length ? master : active).map(schedule => schedule.id));
        const targetSchedule = master[0] || active[0];
        const brgy = targetSchedule ? (targetSchedule.data().barangayName || targetSchedule.data().barangay || '') : '';
        setAssignedBarangay(brgy);
        const savedPolyline = active.find(schedule => Array.isArray(schedule.data().routeOptimization?.roadPolyline))?.data().routeOptimization?.roadPolyline || [];
        setRoutePolyline(savedPolyline.filter((point: any) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)));
      },
      error => {
        if (error?.code !== 'permission-denied') {
          console.warn('DriverLayout: schedules listener error:', error);
        }
      }
    );
    const unsubscribeNetwork = NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable !== false) syncOfflineDriverActions();
    });
    syncOfflineDriverActions();
    return () => {
      unsubscribeSchedules();
      unsubscribeNetwork();
    };
  }, [user?.uid]);

  const handleAcknowledgeBroadcast = () => {
    if (systemOverrides.activeEmergencyBroadcast?.id) {
      acknowledgedBroadcastIdsRef.current.push(systemOverrides.activeEmergencyBroadcast.id);
    }
    setShowBroadcastModal(false);
    stopSpeaking();
  };

  const handleReplayBroadcast = () => {
    if (systemOverrides.activeEmergencyBroadcast) {
      announceEmergencyBroadcast(
        systemOverrides.activeEmergencyBroadcast.subject,
        systemOverrides.activeEmergencyBroadcast.message
      );
    }
  };

  // Real-time CENRO System Overrides listener (Fleet Pause, Severe Weather Protocol, Emergency Broadcast, etc.)
  useEffect(() => {
    const unsub = subscribeToSystemOverrides((data) => {
      setSystemOverrides(data);

      // 🚨 Detect Active Emergency Broadcast & Announce via Voice TTS
      const broadcast = data.activeEmergencyBroadcast;
      const activeBroadcastId = broadcast?.active && broadcast?.id ? broadcast.id : null;
      const prevBroadcastId = prevBroadcastIdRef.current;

      if (activeBroadcastId) {
        if (activeBroadcastId !== prevBroadcastId) {
          prevBroadcastIdRef.current = activeBroadcastId;
          if (!acknowledgedBroadcastIdsRef.current.includes(activeBroadcastId) && broadcast) {
            setShowBroadcastModal(true);
            announceEmergencyBroadcast(broadcast.subject, broadcast.message);
          }

        }
      } else {
        prevBroadcastIdRef.current = null;
        setShowBroadcastModal(false);
        stopSpeaking();
      }

      const isPaused = Boolean(data.forcePauseCollection);
      const wasPaused = prevPauseStateRef.current;

      if (isFirstOverrideCheckRef.current) {
        isFirstOverrideCheckRef.current = false;
        prevPauseStateRef.current = isPaused;
        if (isPaused) {
          setShowEmergencyPauseModal(true);
        }
        return;
      }

      // Transition: newly paused
      if (isPaused && !wasPaused) {
        setShowEmergencyPauseModal(true);
        setHasAcknowledgedCurrentPause(false);
        setShowResumedToast(false);

        // Immediately stop active GPS tracking and driving simulation safely
        const activeUid = user?.uid || auth.currentUser?.uid;
        if (activeUid) {
          locationService.stopTracking(activeUid).catch(() => {});
          locationService.stopSimulation(activeUid).catch(() => {});
        }
      }

      // Transition: resumed
      if (!isPaused && wasPaused) {
        setShowEmergencyPauseModal(false);
        setHasAcknowledgedCurrentPause(false);
        setShowResumedToast(true);
      }

      prevPauseStateRef.current = isPaused;
    });

    return () => {
      unsub();
      stopSpeaking();
    };
  }, [user?.uid]);


  // Auto-dismiss resumed toast after 7 seconds
  useEffect(() => {
    if (!showResumedToast) return;
    const timer = setTimeout(() => setShowResumedToast(false), 7000);
    return () => clearTimeout(timer);
  }, [showResumedToast]);


  // Show loading while checking driver role
  if (isLoading || !isAuthorized) {
    return null; // Will redirect if needed
  }

  const activeColor = isDark ? '#86EFAC' : '#2E7D32'; 
  const inactiveColor = isDark ? '#9CA3AF' : '#757575';

  return (
    <>
      <Tabs
      initialRouteName="index"
      screenOptions={({ route, navigation }) => ({
        lazy: true,
        headerShown: false,
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarButton: (props) => {
          const state = navigation.getState();
          const currentRouteName = state.routes[state.index]?.name;
          const isFocused = currentRouteName === route.name;
          return <CustomTabBar {...props} isFocused={isFocused} />;
        },
        tabBarStyle: {
          backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: isDark ? '#111827' : '#E0E0E0',
          height: 80,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 24 : 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
        },
      })}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="home" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="pages/DriverSchedulePage"
        options={{
          title: 'Schedule',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="event" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="pages/DriverHistoryPage"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="history" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="notifications" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="diesel-log"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="edit-profile"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="select-truck"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="route-map"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tabs>

    {/* ⚠️ CENRO FLEET INVENTORY UNASSIGNMENT POPUP MODAL */}
    <Modal
      visible={showUnassignedModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleAcknowledgeUnassign}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, isDark && styles.modalCardDark]}>
          {/* Warning Icon Badge */}
          <View style={[styles.modalIconBadge, isDark && styles.modalIconBadgeDark]}>
            <MaterialIcons name="no-transfer" size={34} color="#DC2626" />
          </View>

          {/* Department Tag */}
          <View style={styles.modalDeptTag}>
            <View style={styles.modalDot} />
            <Text style={styles.modalDeptText}>CENRO FLEET DISPATCH NOTICE</Text>
          </View>

          {/* Modal Title */}
          <Text style={[styles.modalTitle, isDark && styles.textLight]}>
            Shift Ended
          </Text>

          {/* Description */}
          <Text style={[styles.modalDescription, isDark && styles.textMuted]}>
            Your shift on this collection vehicle has been ended by CENRO Fleet Management. Your live GPS tracking and operational status have been concluded.
          </Text>

          {/* Vehicle Summary Box */}
          <View style={[styles.vehicleCard, isDark && styles.vehicleCardDark]}>
            <View style={styles.vehicleIconCircle}>
              <MaterialIcons name="local-shipping" size={20} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.vehicleLabel, isDark && styles.textMuted]}>PREVIOUS TRUCK</Text>
              <Text style={[styles.vehiclePlate, isDark && styles.textLight]}>
                {unassignedDetails?.truckPlate || 'Assigned Vehicle'}
              </Text>
            </View>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>SHIFT ENDED</Text>
            </View>
          </View>

          <Text style={[styles.modalHint, isDark && styles.textMuted]}>
            If this was done in error, please contact dispatch. Your Driver Portal will remain in read-only mode until CENRO assigns a truck in Fleet Inventory.
          </Text>

          {/* Action Buttons */}
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.ackBtn, isDark && styles.ackBtnDark]}
              onPress={handleAcknowledgeUnassign}
              activeOpacity={0.85}
            >
              <MaterialIcons name="check" size={18} color={isDark ? '#D1D5DB' : '#4B5563'} />
              <Text style={[styles.ackBtnText, isDark && styles.textLight]}>
                Acknowledge & Go Off-Duty
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>

    {/* 🚨 PERSISTENT EMERGENCY / RESUMED STICKY BANNER (Shown only on non-home tabs to prevent header overlap) */}
    {systemOverrides.activeEmergencyBroadcast?.active && !isHomeScreen ? (
      <View style={[styles.stickyAlertBanner, { top: insets.top || 12, backgroundColor: '#FEF2F2', borderColor: '#F87171' }]}>
        <View style={styles.stickyAlertLeft}>
          <MaterialIcons name="campaign" size={24} color="#DC2626" />
          <View style={{ flex: 1 }}>
            <Text style={styles.stickyAlertTitle} numberOfLines={1}>
              🚨 {systemOverrides.activeEmergencyBroadcast.priority === 'urgent' ? 'URGENT: ' : ''}{systemOverrides.activeEmergencyBroadcast.subject}
            </Text>
            <Text style={styles.stickyAlertSubtitle} numberOfLines={1}>
              {systemOverrides.activeEmergencyBroadcast.message}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.stickyAlertBtn, { backgroundColor: '#DC2626', flexDirection: 'row', alignItems: 'center', gap: 4 }]}
          onPress={() => {
            setShowBroadcastModal(true);
            handleReplayBroadcast();
          }}
          activeOpacity={0.8}
        >
          <MaterialIcons name="volume-up" size={14} color="#FFFFFF" />
          <Text style={styles.stickyAlertBtnText}>Directives</Text>
        </TouchableOpacity>
      </View>
    ) : systemOverrides.forcePauseCollection && !isHomeScreen ? (
      <View style={[styles.stickyAlertBanner, { top: insets.top || 12 }]}>
        <View style={styles.stickyAlertLeft}>
          <MaterialIcons name="pause-circle-filled" size={22} color="#DC2626" />
          <View style={{ flex: 1 }}>
            <Text style={styles.stickyAlertTitle} numberOfLines={1}>
              FLEET COLLECTION PAUSED BY CENRO
            </Text>
            <Text style={styles.stickyAlertSubtitle} numberOfLines={1}>
              {systemOverrides.forcePauseReason || 'Operations halted • Standby at safe zone'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.stickyAlertBtn}
          onPress={() => setShowEmergencyPauseModal(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.stickyAlertBtnText}>Directives</Text>
        </TouchableOpacity>
      </View>
    ) : showResumedToast && !isHomeScreen ? (
      <View style={[styles.stickyResumedBanner, { top: insets.top || 12 }]}>
        <View style={styles.stickyAlertLeft}>
          <MaterialIcons name="check-circle" size={22} color="#059669" />
          <View style={{ flex: 1 }}>
            <Text style={styles.stickyResumedTitle} numberOfLines={1}>
              OPERATIONS RESUMED
            </Text>
            <Text style={styles.stickyResumedSubtitle} numberOfLines={1}>
              CENRO has cleared fleet collection routes to resume.
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.stickyDismissBtn}
          onPress={() => setShowResumedToast(false)}
        >
          <MaterialIcons name="close" size={18} color="#059669" />
        </TouchableOpacity>
      </View>
    ) : null}

    {/* 📢 CENRO IN-CAB EMERGENCY BROADCAST MODAL */}
    <Modal
      visible={showBroadcastModal && Boolean(systemOverrides.activeEmergencyBroadcast?.active)}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleAcknowledgeBroadcast}
    >
      <View style={styles.emergencyModalOverlay}>
        <View style={[styles.emergencyModalCard, isDark && styles.emergencyModalCardDark]}>
          {/* Top Flashing Icon Badge */}
          <View style={[styles.emergencyIconCircle, { backgroundColor: '#FEE2E2', borderColor: '#F87171' }]}>
            <MaterialIcons name="campaign" size={42} color="#DC2626" />
          </View>

          {/* Department Header Badge */}
          <View style={[styles.emergencyDeptTag, { backgroundColor: 'rgba(220, 38, 38, 0.12)' }]}>
            <View style={styles.emergencyDot} />
            <Text style={styles.emergencyDeptText}>
              {systemOverrides.activeEmergencyBroadcast?.priority === 'urgent'
                ? 'URGENT CALAMITY DIRECTIVE'
                : 'CENRO EMERGENCY BROADCAST'}
            </Text>
          </View>

          {/* Title */}
          <Text style={[styles.emergencyModalTitle, isDark && styles.textLight]}>
            {systemOverrides.activeEmergencyBroadcast?.subject || 'Emergency Directive'}
          </Text>

          {/* Broadcast Message Box */}
          <View style={[styles.emergencyReasonBox, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
            <View style={styles.reasonTopRow}>
              <MaterialIcons name="volume-up" size={18} color="#DC2626" />
              <Text style={styles.reasonHeader}>IN-CAB DISPATCH MESSAGE</Text>
            </View>
            <Text style={[styles.reasonBody, { color: '#7F1D1D', fontSize: 14, lineHeight: 20 }]}>
              {systemOverrides.activeEmergencyBroadcast?.message}
            </Text>
          </View>

          {/* Dispatched Info */}
          <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingHorizontal: 4 }}>
            <Text style={{ fontSize: 11, color: isDark ? '#94A3B8' : '#64748B', fontWeight: '600' }}>
              Dispatched by: {systemOverrides.activeEmergencyBroadcast?.senderName || 'CENRO Command'}

            </Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialIcons name="record-voice-over" size={14} color="#059669" />
              <Text style={{ fontSize: 11, color: '#059669', fontWeight: '700' }}>Voice Active</Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={{ width: '100%', gap: 10 }}>
            <TouchableOpacity
              style={[styles.replayBtn, isDark && styles.replayBtnDark]}
              onPress={handleReplayBroadcast}
              activeOpacity={0.8}
            >
              <MaterialIcons name="volume-up" size={20} color={isDark ? '#60A5FA' : '#2563EB'} />
              <Text style={[styles.replayBtnText, isDark && { color: '#60A5FA' }]}>
                Replay Voice Announcement
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.emergencyAckBtn}
              onPress={handleAcknowledgeBroadcast}
              activeOpacity={0.85}
            >
              <MaterialIcons name="check-circle" size={20} color="#FFFFFF" />
              <Text style={styles.emergencyAckBtnText}>Acknowledge Directive</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>


    {/* 🚨 CENRO EMERGENCY OPERATIONS PAUSE DIRECTIVE MODAL */}
    <Modal
      visible={showEmergencyPauseModal && systemOverrides.forcePauseCollection}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        setShowEmergencyPauseModal(false);
        setHasAcknowledgedCurrentPause(true);
      }}
    >
      <View style={styles.emergencyModalOverlay}>
        <View style={[styles.emergencyModalCard, isDark && styles.emergencyModalCardDark]}>
          {/* Top Flashing Icon Badge */}
          <View style={styles.emergencyIconCircle}>
            <MaterialIcons name="pause-circle-filled" size={42} color="#DC2626" />
          </View>

          {/* Department Header Badge */}
          <View style={styles.emergencyDeptTag}>
            <View style={styles.emergencyDot} />
            <Text style={styles.emergencyDeptText}>CENRO EMERGENCY DISPATCH DIRECTIVE</Text>
          </View>

          {/* Title */}
          <Text style={[styles.emergencyModalTitle, isDark && styles.textLight]}>
            Fleet Collection Force-Paused
          </Text>

          {/* Warning Banner */}
          <View style={styles.emergencyReasonBox}>
            <View style={styles.reasonTopRow}>
              <MaterialIcons name="warning" size={18} color="#DC2626" />
              <Text style={styles.reasonHeader}>REASON FOR MUNICIPAL HALT</Text>
            </View>
            <Text style={styles.reasonBody}>
              {systemOverrides.forcePauseReason || 'Emergency weather / calamity contingency pause (e.g. Flooding, Landslide, Typhoon warning).'}
            </Text>
          </View>

          {/* Instructions Box */}
          <View style={[styles.directiveInstructionsBox, isDark && styles.directiveInstructionsBoxDark]}>
            <Text style={[styles.directiveInstructionsTitle, isDark && styles.textLight]}>
              REQUIRED DRIVER ACTIONS:
            </Text>
            <View style={styles.instructionItem}>
              <MaterialIcons name="stop-circle" size={18} color="#DC2626" />
              <Text style={[styles.instructionText, isDark && styles.textMuted]}>
                Safely pull over your vehicle immediately.
              </Text>
            </View>
            <View style={styles.instructionItem}>
              <MaterialIcons name="location-on" size={18} color="#2563EB" />
              <Text style={[styles.instructionText, isDark && styles.textMuted]}>
                Standby at depot or the nearest elevated safe zone.
              </Text>
            </View>
            <View style={styles.instructionItem}>
              <MaterialIcons name="hourglass-empty" size={18} color="#D97706" />
              <Text style={[styles.instructionText, isDark && styles.textMuted]}>
                Do not proceed on routes until authorized by CENRO.
              </Text>
            </View>
          </View>

          {/* Action Button */}
          <TouchableOpacity
            style={styles.emergencyAckBtn}
            onPress={() => {
              setShowEmergencyPauseModal(false);
              setHasAcknowledgedCurrentPause(true);
            }}
            activeOpacity={0.85}
          >
            <MaterialIcons name="check-circle" size={20} color="#FFFFFF" />
            <Text style={styles.emergencyAckBtnText}>Acknowledge Directive & Standby</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  </>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modalCardDark: {
    backgroundColor: '#1F2937',
    borderColor: '#374151',
  },
  modalIconBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FEE2E2',
    borderWidth: 2,
    borderColor: '#FCA5A5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalIconBadgeDark: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#EF4444',
  },
  modalDeptTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    marginBottom: 10,
  },
  modalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DC2626',
  },
  modalDeptText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#DC2626',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 18,
  },
  vehicleCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 14,
  },
  vehicleCardDark: {
    backgroundColor: '#111827',
    borderColor: '#374151',
  },
  vehicleIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: '#6B7280',
  },
  vehiclePlate: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#DC2626',
  },
  modalHint: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 16,
  },
  modalActions: {
    width: '100%',
    gap: 10,
  },
  selectTruckBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16A34A',
    paddingVertical: 13,
    borderRadius: 14,
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  selectTruckBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  ackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingVertical: 12,
    borderRadius: 14,
  },
  ackBtnDark: {
    backgroundColor: '#374151',
    borderColor: '#4B5563',
  },
  ackBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  textLight: {
    color: '#F9FAFB',
  },
  textMuted: {
    color: '#9CA3AF',
  },
  stickyAlertBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  stickyAlertLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stickyAlertTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#991B1B',
    letterSpacing: 0.3,
  },
  stickyAlertSubtitle: {
    fontSize: 11,
    color: '#B91C1C',
    fontWeight: '500',
  },
  stickyAlertBtn: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  stickyAlertBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  stickyWeatherBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    backgroundColor: '#F0F9FF',
    borderColor: '#7DD3FC',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  stickyWeatherTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#075985',
    letterSpacing: 0.3,
  },
  stickyWeatherSubtitle: {
    fontSize: 11,
    color: '#0369A1',
    fontWeight: '500',
  },
  stickyResumedBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    backgroundColor: '#ECFDF5',
    borderColor: '#6EE7B7',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  stickyResumedTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.3,
  },
  stickyResumedSubtitle: {
    fontSize: 11,
    color: '#047857',
    fontWeight: '500',
  },
  stickyDismissBtn: {
    padding: 6,
  },
  emergencyModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  emergencyModalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.3,
    shadowRadius: 28,
    elevation: 14,
    borderWidth: 1.5,
    borderColor: '#FECACA',
  },
  emergencyModalCardDark: {
    backgroundColor: '#1E293B',
    borderColor: '#7F1D1D',
  },
  emergencyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 3,
    borderColor: '#FCA5A5',
  },
  emergencyDeptTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
    marginBottom: 8,
  },
  emergencyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DC2626',
  },
  emergencyDeptText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 0.8,
  },
  emergencyModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 12,
    textAlign: 'center',
  },
  emergencyReasonBox: {
    width: '100%',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  reasonTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  reasonHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: '#991B1B',
    letterSpacing: 0.5,
  },
  reasonBody: {
    fontSize: 13,
    color: '#7F1D1D',
    fontWeight: '600',
    lineHeight: 18,
  },
  directiveInstructionsBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  directiveInstructionsBoxDark: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
  },
  directiveInstructionsTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.6,
  },
  instructionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  instructionText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
    flex: 1,
  },
  emergencyAckBtn: {
    width: '100%',
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  emergencyAckBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  replayBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
  },
  replayBtnDark: {
    backgroundColor: '#1E293B',
    borderColor: '#3B82F6',
  },
  replayBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
  },
});

