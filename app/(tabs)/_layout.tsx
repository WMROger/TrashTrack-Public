import { LinearGradient } from 'expo-linear-gradient';
import { Tabs, useRouter } from 'expo-router';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import React, { useEffect, useState, useRef } from 'react';
import { Image, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import AIChatModal from '@/components/AIChatModal';
import { useAuthContext } from '@/components/AuthContext';
import { CustomTabBar } from '@/components/CustomTabBar';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { auth, db } from '@/config/firebase';
import { Colors } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { residentNotificationService } from '@/services/residentNotificationService';
import { IncomingCollectionService } from '@/services/incomingCollectionService';
import { soundAlertService } from '@/services/soundAlertService';
import { subscribeToSystemOverrides, EmergencyBroadcastData } from '@/services/systemOverridesService';
import { NotificationService } from '@/services/notificationService';

export default function TabLayout() {
  const { theme } = useTheme();
  const { user } = useAuthContext();
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [showAIChat, setShowAIChat] = useState(false);
  const [unreadAnnouncementsCount, setUnreadAnnouncementsCount] = useState(0);
  const [hasScheduleAlert, setHasScheduleAlert] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [gateDismissed, setGateDismissed] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [isSuppressedByStorage, setIsSuppressedByStorage] = useState(false);
  const [activeEmergency, setActiveEmergency] = useState<EmergencyBroadcastData | null>(null);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const acknowledgedEmergencyIdsRef = useRef<string[]>([]);
  const prevEmergencyIdRef = useRef<string | null>(null);

  // Load acknowledged emergency broadcast IDs from storage
  useEffect(() => {
    AsyncStorage.getItem('@trashtrack_ack_emergency_ids')
      .then((val) => {
        if (val) {
          try {
            acknowledgedEmergencyIdsRef.current = JSON.parse(val);
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  // Listen to City Emergency Advisories & trigger urgent 2-tone siren chime + modal
  useEffect(() => {
    const unsub = subscribeToSystemOverrides((data) => {
      const broadcast = data.activeEmergencyBroadcast;
      const activeBroadcastId = broadcast?.active && broadcast?.id ? broadcast.id : null;
      const prevId = prevEmergencyIdRef.current;

      if (activeBroadcastId && broadcast) {
        if (activeBroadcastId !== prevId) {
          prevEmergencyIdRef.current = activeBroadcastId;
          if (!acknowledgedEmergencyIdsRef.current.includes(activeBroadcastId)) {
            setActiveEmergency(broadcast);
            setShowEmergencyModal(true);

            // Play urgent 2-tone emergency siren chime
            soundAlertService.playEmergencyAlertSiren().catch(() => {});

            // Trigger system notification for background/lockscreen awareness
            NotificationService.scheduleEmergencyNotification({
              broadcastId: activeBroadcastId,
              title: `🚨 EMERGENCY: ${broadcast.subject}`,
              message: broadcast.message,
              priority: broadcast.priority,
            }).catch(() => {});
          }
        }
      } else {
        prevEmergencyIdRef.current = null;
        setShowEmergencyModal(false);
        setActiveEmergency(null);
      }
    });

    return () => unsub();
  }, []);

  const handleAcknowledgeEmergency = () => {
    if (activeEmergency?.id) {
      acknowledgedEmergencyIdsRef.current.push(activeEmergency.id);
      AsyncStorage.setItem(
        '@trashtrack_ack_emergency_ids',
        JSON.stringify(acknowledgedEmergencyIdsRef.current)
      ).catch(() => {});
    }
    setShowEmergencyModal(false);
  };

  const handleReplayEmergencySiren = () => {
    soundAlertService.playEmergencyAlertSiren().catch(() => {});
  };

  // Check stored "Don't show again" preference for Re-Verification Gate
  useEffect(() => {
    if (!user?.uid) return;
    AsyncStorage.getItem(`@trashtrack_rejection_gate_dont_show_${user.uid}`)
      .then((val) => {
        if (val === 'true') {
          setIsSuppressedByStorage(true);
          setDontShowAgain(true);
        }
      })
      .catch(() => {});
  }, [user?.uid]);

  // If user is verified or status resets away from rejected, clear suppression
  useEffect(() => {
    if (user?.uid && verificationStatus && verificationStatus !== 'rejected') {
      AsyncStorage.removeItem(`@trashtrack_rejection_gate_dont_show_${user.uid}`).catch(() => {});
      setIsSuppressedByStorage(false);
      setDontShowAgain(false);
    }
  }, [user?.uid, verificationStatus]);

  // Subscribe to real-time resident unread announcements for the Announce tab badge
  useEffect(() => {
    const activeUid = user?.uid || auth.currentUser?.uid || 'resident';
    const unsub = residentNotificationService.subscribeAnnouncements(activeUid, (count) => {
      setUnreadAnnouncementsCount(count);
    });
    return () => unsub();
  }, [user?.uid]);

  // Subscribe to real-time incoming/nearby truck alert for the Schedule tab badge (+1)
  useEffect(() => {
    if (role === 'driver' || role === 'cenro' || role === 'cicto' || role === 'coordinator') {
      setHasScheduleAlert(false);
      return;
    }
    const activeUid = user?.uid || auth.currentUser?.uid || 'resident';
    const unsub = residentNotificationService.subscribeScheduleAlert(activeUid, (hasAlert) => {
      setHasScheduleAlert(hasAlert);
    });
    return () => unsub();
  }, [user?.uid, role]);

  // Listen to resident's verification status for the Re-Verification Gate
  useEffect(() => {
    if (!user?.uid || !db) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const vStatus = data.verificationStatus || '';
        setVerificationStatus(vStatus);
        setRejectionReason(data.rejectionReason || '');
      }
    }, (err) => {
      if (err?.code !== 'permission-denied') {
        console.warn('TabLayout: user doc listener note:', err);
      }
    });
    return () => unsub();
  }, [user?.uid]);

  // Check if user has non-resident role and redirect if necessary
  useEffect(() => {
    const checkRole = async () => {
      if (!user || !db) {
        setIsLoading(false);
        return;
      }

      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const userRole = String(userData.role || 'user').toLowerCase().trim();
          if (
            userRole === 'admin' ||
            userRole === 'cenro' ||
            userRole === 'coordinator' ||
            userRole === 'barangay_coordinator'
          ) {
            if (Platform.OS === 'web') {
              setIsAdmin(true);
              router.replace('/admin/dashboard' as any);
              return;
            }
          }
          if (userRole === 'cicto' || userRole === 'cicto_admin') {
            if (Platform.OS === 'web') {
              router.replace('/cicto/dashboard' as any);
              return;
            }
          }
          IncomingCollectionService.setUserRole(user.uid, userRole);
          residentNotificationService.setUserRole(userRole);
          if (userRole === 'driver') {
            setRole('driver');
          } else {
            setRole(userRole);
          }
        }
        setIsAdmin(false);
      } catch (error) {
        console.error('Error checking role in tabs:', error);
        setIsAdmin(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkRole();
  }, [user, router]);

  // Show loading while checking admin role
  if (isLoading) {
    return null; // Will redirect to admin if needed
  }

  // Don't render tabs if user is admin (they'll be redirected)
  if (isAdmin) {
    return null;
  }

  const colors = Colors[theme ?? 'light'];

  return (
    <>
      <Tabs
        initialRouteName="home"
        screenOptions={({ route, navigation }) => ({
          lazy: true,
          tabBarActiveTintColor: '#2E7D32',
          tabBarInactiveTintColor: '#757575',
          headerShown: false,
          tabBarButton: (props) => {
            const isFocused = navigation.getState().routes[navigation.getState().index].name === route.name;
            const isProtruding = route.name === 'report';
            return <CustomTabBar {...props} isFocused={isFocused} isProtruding={isProtruding} />;
          },
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopWidth: 1,
            borderTopColor: '#E0E0E0',
            height: 80,
            paddingTop: 8,
            paddingBottom: Platform.OS === 'ios' ? 24 : 8,
          },
        })}>
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarIcon: ({ focused, color, size }) => (
              <MaterialIcons 
                name="home" 
                size={28} 
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="schedule"
          listeners={{
            tabPress: () => {
              residentNotificationService.clearScheduleAlert();
            },
          }}
          options={{
            title: 'Schedule',
            tabBarIcon: ({ focused, color, size }) => (
              <View style={styles.tabIconWrapper}>
                <MaterialIcons 
                  name="event" 
                  size={28} 
                  color={color}
                />
                {!focused && hasScheduleAlert && (
                  <View style={styles.badgePill} pointerEvents="none">
                    <Text style={styles.badgePillText}>+1</Text>
                  </View>
                )}
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="report"
          options={{
            title: 'Report',
            tabBarIcon: ({ focused, color, size }) => (
              <MaterialIcons 
                name="camera-alt" 
                size={32} 
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="announcements"
          options={{
            title: 'Announcements',
            tabBarLabel: 'Announce',
            tabBarIcon: ({ focused, color, size }) => (
              <View style={styles.tabIconWrapper}>
                <MaterialIcons 
                  name="campaign" 
                  size={28} 
                  color={color}
                />
                {!focused && unreadAnnouncementsCount > 0 && (
                  <View style={styles.badgePill} pointerEvents="none">
                    <Text style={styles.badgePillText}>
                      {unreadAnnouncementsCount > 9 ? '9+' : `+${unreadAnnouncementsCount}`}
                    </Text>
                  </View>
                )}
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ focused, color, size }) => (
              <MaterialIcons 
                name="person" 
                size={28} 
                color={color}
              />
            ),
          }}
        />
      </Tabs>

      {/* Floating AI Chat Button */}
      <View style={styles.fabContainer}>
        <TouchableOpacity 
          style={styles.fab}
          onPress={() => setShowAIChat(true)}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#73946B', '#242E21']}
            style={styles.fabGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Image 
              source={require('../../assets/images/AIChatBot.png')}
              style={styles.aiIcon}
              resizeMode="contain"
            />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* AI Chat Modal */}
      <AIChatModal 
        visible={showAIChat} 
        onClose={() => setShowAIChat(false)} 
      />

      {/* Full Re-Verification Gate Modal */}
      <Modal
        visible={verificationStatus === 'rejected' && !gateDismissed && !isSuppressedByStorage}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setGateDismissed(true)}
      >
        <View style={styles.gateBackdrop}>
          <View style={styles.gateCard}>
            <View style={styles.gateIconWrap}>
              <MaterialIcons name="gpp-bad" size={42} color="#DC2626" />
            </View>

            <Text style={styles.gateTitle}>Residency Verification Rejected</Text>
            <Text style={styles.gateSubtitle}>City of Danao · CICTO & CENRO Administration</Text>

            <View style={styles.gateReasonCard}>
              <Text style={styles.gateReasonLabel}>OFFICIAL REJECTION REASON:</Text>
              <Text style={styles.gateReasonText}>
                {rejectionReason || 'The submitted proof of residency was invalid, incomplete, or unreadable.'}
              </Text>
            </View>

            <View style={styles.gateNoticeList}>
              <View style={styles.gateNoticeItem}>
                <MaterialIcons name="lock" size={16} color="#DC2626" />
                <Text style={styles.gateNoticeText}>Waste Reporting & Eco-Merch Redemptions are locked</Text>
              </View>
              <View style={styles.gateNoticeItem}>
                <MaterialIcons name="visibility" size={16} color="#059669" />
                <Text style={styles.gateNoticeText}>Basic View Mode active: You can view schedules & live trucks</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.gateFixBtn}
              onPress={() => {
                setGateDismissed(true);
                router.push('/(tabs)/profile?reupload=true' as any);
              }}
              activeOpacity={0.85}
            >
              <MaterialIcons name="upload-file" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.gateFixBtnText}>Fix & Re-upload Proof of Residency</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.gateDismissBtn}
              onPress={() => {
                setGateDismissed(true);
                if (dontShowAgain && user?.uid) {
                  AsyncStorage.setItem(`@trashtrack_rejection_gate_dont_show_${user.uid}`, 'true').catch(() => {});
                  setIsSuppressedByStorage(true);
                }
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.gateDismissBtnText}>Continue in Basic View Mode (View Only)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.gateDontShowRow}
              onPress={() => {
                const nextVal = !dontShowAgain;
                setDontShowAgain(nextVal);
                if (user?.uid) {
                  if (nextVal) {
                    AsyncStorage.setItem(`@trashtrack_rejection_gate_dont_show_${user.uid}`, 'true').catch(() => {});
                  } else {
                    AsyncStorage.removeItem(`@trashtrack_rejection_gate_dont_show_${user.uid}`).catch(() => {});
                  }
                }
              }}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name={dontShowAgain ? "check-box" : "check-box-outline-blank"}
                size={18}
                color={dontShowAgain ? "#166534" : "#94A3B8"}
              />
              <Text style={[styles.gateDontShowText, dontShowAgain && { color: '#166534', fontWeight: '700' }]}>
                Don&apos;t show again
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🚨 DANAO CITY EMERGENCY ADVISORY MODAL (WITH SOUND ALERT) */}
      <Modal
        visible={showEmergencyModal && Boolean(activeEmergency?.active)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleAcknowledgeEmergency}
      >
        <View style={styles.emergencyModalOverlay}>
          <View style={styles.emergencyModalCard}>
            {/* Top Siren Aura Badge */}
            <View style={styles.emergencyIconCircle}>
              <MaterialIcons name="campaign" size={44} color="#DC2626" />
            </View>

            {/* Advisory Department Tag */}
            <View style={styles.emergencyDeptTag}>
              <View style={styles.emergencyDot} />
              <Text style={styles.emergencyDeptText}>
                {activeEmergency?.priority === 'urgent'
                  ? 'URGENT CITY EMERGENCY ADVISORY'
                  : 'OFFICIAL MUNICIPAL ADVISORY'}
              </Text>
            </View>

            {/* Subject */}
            <Text style={styles.emergencyModalTitle}>
              {activeEmergency?.subject || 'Emergency Advisory'}
            </Text>

            {/* Broadcast Message Box */}
            <View style={styles.emergencyReasonBox}>
              <View style={styles.reasonTopRow}>
                <MaterialIcons name="warning" size={18} color="#DC2626" />
                <Text style={styles.reasonHeader}>PUBLIC SAFETY BULLETIN</Text>
              </View>
              <Text style={styles.reasonBody}>
                {activeEmergency?.message}
              </Text>
            </View>

            {/* Dispatched Info */}
            <View style={styles.emergencyDispatchedRow}>
              <Text style={styles.dispatchedText}>
                Issued by: {activeEmergency?.senderName || 'Danao City CENRO / CICTO'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MaterialIcons name="volume-up" size={14} color="#DC2626" />
                <Text style={{ fontSize: 11, color: '#DC2626', fontWeight: '700' }}>Sound Alert Active</Text>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={{ width: '100%', gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                style={styles.replaySirenBtn}
                onPress={handleReplayEmergencySiren}
                activeOpacity={0.8}
              >
                <MaterialIcons name="volume-up" size={18} color="#DC2626" />
                <Text style={styles.replaySirenBtnText}>
                  Replay Emergency Siren Sound
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.emergencyAckBtn}
                onPress={handleAcknowledgeEmergency}
                activeOpacity={0.85}
              >
                <MaterialIcons name="check-circle" size={18} color="#FFFFFF" />
                <Text style={styles.emergencyAckBtnText}>I Understand & Acknowledge</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fabContainer: {
    position: 'absolute',
    bottom: 90, // Position above the tab bar
    right: 20,
    zIndex: 1000,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
    overflow: 'hidden',
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiIcon: {
    width: 28,
    height: 28,
    tintColor: '#FFFFFF',
  },
  tabIconWrapper: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  badgePill: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#EF4444',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    zIndex: 99,
  },
  badgePillText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
    lineHeight: 12,
  },
  gateBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
  },
  gateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FECACA',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  gateIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 2,
    borderColor: '#FECACA',
  },
  gateTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#991B1B',
    textAlign: 'center',
    marginBottom: 4,
  },
  gateSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 16,
  },
  gateReasonCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
    width: '100%',
    marginBottom: 14,
  },
  gateReasonLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#991B1B',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  gateReasonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7F1D1D',
    lineHeight: 18,
  },
  gateNoticeList: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 18,
    gap: 8,
  },
  gateNoticeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gateNoticeText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#334155',
    flex: 1,
  },
  gateFixBtn: {
    backgroundColor: '#166534',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 13,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  gateFixBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  gateDismissBtn: {
    paddingVertical: 10,
    width: '100%',
    alignItems: 'center',
  },
  gateDismissBtnText: {
    color: '#64748B',
    fontSize: 12.5,
    fontWeight: '600',
  },
  gateDontShowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    marginTop: 2,
  },
  gateDontShowText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  emergencyModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
  },
  emergencyModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 440,
    alignItems: 'center',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
  },
  emergencyIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FEE2E2',
    borderWidth: 2,
    borderColor: '#F87171',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  emergencyDeptTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 10,
  },
  emergencyDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#DC2626',
  },
  emergencyDeptText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 0.5,
  },
  emergencyModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 14,
  },
  emergencyReasonBox: {
    width: '100%',
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 14,
    marginBottom: 14,
  },
  reasonTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  reasonHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#991B1B',
    letterSpacing: 0.4,
  },
  reasonBody: {
    color: '#7F1D1D',
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '500',
  },
  emergencyDispatchedRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 2,
  },
  dispatchedText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  replaySirenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    paddingVertical: 11,
    borderRadius: 12,
  },
  replaySirenBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
  },
  emergencyAckBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#DC2626',
    paddingVertical: 13,
    borderRadius: 12,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  emergencyAckBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
