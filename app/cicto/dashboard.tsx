import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ensureCictoProfileInFirestore, isCictoEmail } from '../../constants/cictoConfig';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthContext } from '../../components/AuthContext';
import { PortalLoadingScreen } from '../../components/admin';
import CictoSidebar from '../../components/admin/CictoSidebar';
import {
  CenroCommandTab,
  CictoAuditTrailTab,
  CictoDashboardTab,
  CictoHelpdeskTab,
  CictoLogoutModal,
  CictoNotificationDropdown,
  DataManagementTab,
  FleetOpsTab,
  IdentityAccessTab,
  RewardsTab,
  SystemSettingsTab,
} from '../../components/admin/cicto';
import { auth, db } from '../../config/firebase';
import { CictoNotification, markAllCictoNotificationsAsRead, subscribeToCictoNotifications } from '../../services/cictoAccountService';

export default function CictoDashboard() {
  const { user, loading: authLoading } = useAuthContext();
  const router = useRouter();
  const [isCictoAdmin, setIsCictoAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [identityRoleFilter, setIdentityRoleFilter] = useState<string>('all');
  const [identityStatusFilter, setIdentityStatusFilter] = useState<string>('all');
  const [identitySearchQuery, setIdentitySearchQuery] = useState<string>('');
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [notifications, setNotifications] = useState<CictoNotification[]>([]);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [hasViewedAlerts, setHasViewedAlerts] = useState(false);
  const [lastViewedCount, setLastViewedCount] = useState(0);
  const { width } = useWindowDimensions();
  const sidebarCollapsed = Platform.OS === 'web' && width < 980;

  useEffect(() => {
    let isMounted = true;

    if (!auth) {
      if (isMounted) setIsLoading(false);
      router.replace('/cicto' as any);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (activeUser) => {
      if (!isMounted) return;

      if (!activeUser) {
        console.log('CICTO dashboard: No authenticated user, redirecting to login');
        setIsLoading(false);
        router.replace('/cicto' as any);
        return;
      }

      const normEmail = (activeUser.email || '').trim().toLowerCase();

      // Proactively ensure CICTO profile exists/is synced for recognized CICTO emails
      if (isCictoEmail(normEmail)) {
        try {
          await ensureCictoProfileInFirestore(
            activeUser.uid,
            normEmail,
            activeUser.displayName || 'CICTO Administrator',
          );
        } catch (e) {
          console.warn('CICTO dashboard: ensureCictoProfile error:', e);
        }
      }

      if (db) {
        try {
          const userRef = doc(db, 'users', activeUser.uid);
          const userSnap = await getDoc(userRef);
          if (!isMounted) return;

          if (userSnap.exists()) {
            const userData = userSnap.data();
            const role = String(userData.role || '').toLowerCase().trim();
            if (role === 'cicto' || role === 'cicto_admin' || isCictoEmail(normEmail)) {
              console.log('CICTO dashboard: Authorized CICTO role for:', activeUser.email);
              setIsCictoAdmin(true);
              setIsLoading(false);
              return;
            } else if (
              role === 'admin' ||
              role === 'cenro' ||
              role === 'coordinator' ||
              role === 'barangay_coordinator' ||
              role === 'cenro_officer' ||
              role === 'mayor'
            ) {
              console.log('CICTO dashboard: Non-CICTO admin role detected, redirecting to CENRO dashboard:', activeUser.email);
              setIsLoading(false);
              router.replace('/admin/dashboard' as any);
              return;
            } else {
              console.log('CICTO dashboard: Non-staff role detected, redirecting to home:', activeUser.email);
              setIsLoading(false);
              router.replace('/(tabs)/home' as any);
              return;
            }
          } else if (isCictoEmail(normEmail)) {
            console.log('CICTO dashboard: Authorized CICTO master email for:', activeUser.email);
            setIsCictoAdmin(true);
            setIsLoading(false);
            return;
          } else {
            console.log('CICTO dashboard: Profile not found for user:', activeUser.email);
            setIsLoading(false);
            router.replace('/cicto?error=auth_error' as any);
            return;
          }
        } catch (e) {
          console.warn('CICTO dashboard: Error checking role:', e);
          if (isCictoEmail(normEmail)) {
            setIsCictoAdmin(true);
            setIsLoading(false);
            return;
          }
          if (isMounted) setIsLoading(false);
          router.replace('/cicto?error=auth_error' as any);
          return;
        }
      } else {
        if (isCictoEmail(normEmail)) {
          setIsCictoAdmin(true);
          setIsLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!isCictoAdmin) return;
    const unsubscribe = subscribeToCictoNotifications((notifs) => {
      setNotifications(notifs);
    });
    return () => unsubscribe();
  }, [isCictoAdmin]);

  const activeAlerts = notifications.filter((n) => n.status === 'active' && !n.read);
  const unreadCount = hasViewedAlerts
    ? Math.max(0, activeAlerts.length - lastViewedCount)
    : activeAlerts.length;

  const handleToggleNotifications = () => {
    const opening = !showNotifDropdown;
    setShowNotifDropdown(opening);
    if (opening) {
      setHasViewedAlerts(true);
      setLastViewedCount(activeAlerts.length);
      markAllCictoNotificationsAsRead().catch(() => { });
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const handleConfirmLogout = async () => {
    try {
      await signOut(auth);
      setShowLogoutModal(false);
      router.replace('/cicto' as any);
    } catch (error) {
      console.error('CICTO logout error:', error);
      Alert.alert('Logout Error', 'Failed to sign out. Please try again.');
    }
  };

  const handleNavigateTab = (
    tab: string,
    params?: { role?: string; status?: string; search?: string }
  ) => {
    if (params?.role) {
      setIdentityRoleFilter(params.role);
    }
    if (params?.status) {
      setIdentityStatusFilter(params.status);
    }
    if (typeof params?.search === 'string') {
      setIdentitySearchQuery(params.search);
    }
    setActiveTab(tab);
  };

  const handleSidebarTabChange = (tab: string) => {
    if (tab === 'identity-access') {
      setIdentityRoleFilter('all');
      setIdentityStatusFilter('all');
      setIdentitySearchQuery('');
    }
    setActiveTab(tab);
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'rewards':
        return <RewardsTab />;
      case 'identity-access':
        return (
          <IdentityAccessTab
            key={`identity-${identityRoleFilter}-${identityStatusFilter}-${identitySearchQuery}`}
            initialRoleFilter={identityRoleFilter}
            initialStatusFilter={identityStatusFilter}
            initialSearchQuery={identitySearchQuery}
          />
        );
      case 'dashboard':
        return <CictoDashboardTab onNavigateTab={handleNavigateTab} />;
      case 'data-management':
      case 'data-mgmt':
        return <DataManagementTab />;
      case 'fleet-ops':
        return <FleetOpsTab />;
      case 'cenro-command':
        return <CenroCommandTab />;
      case 'helpdesk':
      case 'support-tickets':
      case 'tickets':
        return <CictoHelpdeskTab onNavigateTab={handleNavigateTab} />;
      case 'system-settings':
      case 'settings':
      case 'branding':
        return <SystemSettingsTab />;
      case 'activity-logs':
      case 'audit-trail':
      case 'activity':
        return <CictoAuditTrailTab />;
      default:
        return <CictoDashboardTab onNavigateTab={handleNavigateTab} />;
    }
  };

  if (isLoading || authLoading || (!isReady && isCictoAdmin)) {
    return (
      <PortalLoadingScreen
        portal="cicto"
        title="CICTO Super Admin Portal"
        subtitle="City Information & Communications Technology Office"
        isDone={!isLoading && !authLoading && isCictoAdmin}
        onFinish={() => setIsReady(true)}
      />
    );
  }

  if (!isCictoAdmin) {
    return (
      <PortalLoadingScreen
        portal="cicto"
        title="CICTO Super Admin Portal"
        subtitle="City Information & Communications Technology Office"
        isError={true}
        errorTitle="CICTO Clearance Required"
        errorMessage="Your session does not have CICTO administrative access. Returning to login..."
        countdownSeconds={4}
        onCancel={async () => {
          try {
            if (auth?.currentUser) await signOut(auth);
          } catch { }
          router.replace('/cicto?error=auth_error' as any);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['right', 'bottom', 'left']}>
      <View style={styles.dashboardLayout}>
        <CictoSidebar
          activeTab={activeTab}
          onTabChange={handleSidebarTabChange}
          onLogout={handleLogout}
          collapsed={sidebarCollapsed}
        />

        <View style={styles.mainContent}>
          {/* Header Bar */}
          <View style={styles.headerBar}>
            <View style={{ flex: 1 }} />
            <View style={styles.headerRight}>
              {/* Notification Bell Button */}
              <TouchableOpacity
                style={[styles.bellBtn, unreadCount > 0 && styles.bellBtnActive]}
                onPress={handleToggleNotifications}
                activeOpacity={0.7}
              >
                <MaterialIcons
                  name={unreadCount > 0 ? "notifications-active" : "notifications-none"}
                  size={22}
                  color={unreadCount > 0 ? "#DC2626" : "#4B5563"}
                />
                {unreadCount > 0 ? (
                  <View style={styles.badgeContainer}>
                    <Text style={styles.badgeText}>{unreadCount}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.profileBtn}
                onPress={handleLogout}
                activeOpacity={0.8}
              >
                <View style={styles.adminInfo}>
                  <Text style={styles.adminName}>{user?.displayName || user?.email?.split('@')[0] || 'CICTO SUPER ADMIN'}</Text>
                  <Text style={styles.adminRole}>CICTO Oversight Console</Text>
                </View>
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarText}>{(user?.displayName || user?.email || 'A').charAt(0).toUpperCase()}</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* Notification Dropdown Panel */}
          <CictoNotificationDropdown
            visible={showNotifDropdown}
            notifications={notifications}
            unreadCount={unreadCount}
            onClose={() => setShowNotifDropdown(false)}
            onClearAll={() => {
              setNotifications([]);
              setHasViewedAlerts(true);
              setLastViewedCount(0);
            }}
          />

          {/* Tab Content */}
          <View style={styles.tabContent}>
            {renderActiveTab()}
          </View>
        </View>
      </View>

      {/* CICTO Admin Logout Confirmation Modal */}
      <CictoLogoutModal
        visible={showLogoutModal}
        userEmail={user?.email}
        userName={user?.displayName}
        onConfirm={handleConfirmLogout}
        onCancel={() => setShowLogoutModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  dashboardLayout: {
    flex: 1,
    flexDirection: 'row',
  },
  mainContent: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  headerBar: {
    height: 70,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    zIndex: 10,
  },

  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bellBtnActive: {
    backgroundColor: '#FEE2E2',
  },
  badgeContainer: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  profileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 24,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  adminInfo: {
    alignItems: 'flex-end',
  },
  adminName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
  },
  adminRole: {
    fontSize: 10,
    fontWeight: '600',
    color: '#0F766E',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  avatarPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#0F766E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  tabContent: {
    flex: 1,
    overflow: 'hidden',
  },
});
