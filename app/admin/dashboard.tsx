import React, { useEffect, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  deleteDoc,
  where,
} from 'firebase/firestore';
import { useAuthContext } from '../../components/AuthContext';
import { AdminSidebar, PortalLoadingScreen } from '../../components/admin';
import {
  CenroDashboardTab,
  CollectionSchedulerTab,
  DriverOnboardingTab,
  EnvironmentalCoordinatorsTab,
  OperationalOverridesTab,
  TrashReportsTab,
  WasteAnalyticsTab,
  ServiceFeedbackTab,
  RouteOptimizationTab,
  TruckInventoryTab,
  DriverAccountsTab,
  AnnouncementsTab,
  FleetMonitoringTab,
  CictoCommandsTab,
  CenroProfileSettingsModal,
  OperationalLogsTab,
  AdminNotificationDropdown,
  DieselEstimateTab,
  SupportTab,
  CenroRewardsTab,
} from '../../components/admin/cenro';
import { exportReport } from '@/services/reportExportService';
import { SystemBrandingSettings, subscribeToSystemBranding, getCachedSystemBranding } from '@/services/systemBrandingService';
import { auth, db } from '../../config/firebase';
import { sendTestNotification as sendTestNotificationHelper } from '../../services/homeNotifications';
import { canAccessOperationalTab, canWriteOperationalTab } from '../../constants/accessPrivileges';

export default function AdminDashboard() {
  const { user, loading: authLoading } = useAuthContext();
  const router = useRouter();
  const initialActiveUser = user || auth?.currentUser;

  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [authError, setAuthError] = useState<{ title: string; message: string } | null>(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showProfileSettingsModal, setShowProfileSettingsModal] = useState(false);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [branding, setBranding] = useState<SystemBrandingSettings>(getCachedSystemBranding());

  useEffect(() => {
    const unsub = subscribeToSystemBranding((updated) => {
      setBranding(updated);
    });
    return () => unsub();
  }, []);
  const [userRole, setUserRole] = useState<string>('admin');
  const [assignedBarangay, setAssignedBarangay] = useState<string>('');
  const [assignedPrivileges, setAssignedPrivileges] = useState<string[] | null>(null);
  const [userName, setUserName] = useState<string>(
    initialActiveUser?.displayName ||
    (initialActiveUser?.email ? initialActiveUser.email.split('@')[0] : '')
  );

  const getFormattedUserName = () => {
    const raw = userName || user?.displayName || auth?.currentUser?.displayName || '';
    const isGenericRole = /^(cenro\s*admin(istrator)?|admin(istrator)?|cenro|coordinator)$/i.test(raw.trim());
    if (raw && raw.trim() && !isGenericRole) {
      return raw.trim();
    }
    const email = user?.email || auth?.currentUser?.email || '';
    if (email) {
      const prefix = email.split('@')[0];
      const cleanPrefix = prefix.replace(/\d+$/, '');
      const parts = cleanPrefix.split(/[._-]/);
      if (parts.length > 1) {
        return parts.map((part: string) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ');
      }
      if (cleanPrefix.length > 0) {
        return cleanPrefix.charAt(0).toUpperCase() + cleanPrefix.slice(1).toLowerCase();
      }
    }
    return userRole === 'coordinator' ? 'Coordinator' : 'CENRO Officer';
  };

  const getTopBarSubrole = () => {
    if (userRole === 'coordinator') {
      return assignedBarangay ? `Brgy. ${assignedBarangay} Coordinator` : 'Barangay Coordinator';
    }
    return 'Waste Management Operations';
  };
  const [activeTab, setActiveTab] = useState('dashboard');
  const [analyticsTargetSection, setAnalyticsTargetSection] = useState<string | null>(null);
  useEffect(() => {
    if (assignedPrivileges && !canAccessOperationalTab(activeTab, assignedPrivileges)) {
      setActiveTab(assignedPrivileges.includes('mayor_interagency_only') ? 'cicto-commands' : 'dashboard');
    }
  }, [activeTab, assignedPrivileges]);
  const [isTabLoading, setIsTabLoading] = useState(false);
  const spinValue = new Animated.Value(0);
  const [windowWidth, setWindowWidth] = useState(Dimensions.get('window').width);
  const isNarrow = windowWidth < 900;
  const isCurrentTabReadOnly = userRole !== 'coordinator' && !canWriteOperationalTab(activeTab, assignedPrivileges);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [latestReportImages, setLatestReportImages] = useState<string[]>([]);
  const [latestFeedback, setLatestFeedback] = useState<{ userName: string; message: string; rating: string; createdAt?: any; photoURL?: string } | null>(null);
  const [feedbackStats, setFeedbackStats] = useState<{ loved: number; good: number; bad: number; terrible: number }>({ loved: 0, good: 0, bad: 0, terrible: 0 });
  const [historyCounts, setHistoryCounts] = useState<{ pickup: number; reports: number }>({ pickup: 0, reports: 0 });
  const [historyFilter, setHistoryFilter] = useState<'today' | 'week' | 'month'>('today');
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isImagePreviewVisible, setIsImagePreviewVisible] = useState(false);
  // History view/state
  const [historyView, setHistoryView] = useState<'pickup' | 'reports'>('reports');
  const [historyData, setHistoryData] = useState<Report[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyType, setHistoryType] = useState<'pickup' | 'reports'>('reports');
  const [historyReports, setHistoryReports] = useState<Report[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [currentNotificationType, setCurrentNotificationType] = useState(0);
  type Report = {
    id: string;
    title: string;
    description?: string;
    barangay: string;
    street: string;
    userEmail: string;
    status: string;
    createdAt: any;
  };
  const [resolvedReports, setResolvedReports] = useState<Report[]>([]);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setWindowWidth(window.width);
    });
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (authLoading) return;

    const activeUser = user || auth?.currentUser;
    if (!activeUser) {
      // Grace period for web browser refresh hydration
      const graceTimer = setTimeout(() => {
        if (!auth?.currentUser && isMounted) {
          console.log('Admin dashboard: No authenticated user session, showing clearance required');
          setAuthError({
            title: 'Authentication Required',
            message: 'No administrative clearance session detected. Please sign in to access the CENRO operational portal.',
          });
          setIsLoading(false);
        }
      }, 1000);
      return () => clearTimeout(graceTimer);
    }

    if (!db) {
      if (isMounted) setIsLoading(false);
      return;
    }

    // Safety fallback: if connection or snapshot takes over 8 seconds, unblock loading
    const safetyTimer = setTimeout(() => {
      if (isMounted && !isAdmin) {
        setAuthError({
          title: 'Verification Timeout',
          message: 'Administrative clearance verification took too long to respond. Returning to login...',
        });
        setIsLoading(false);
      }
    }, 8000);

    const userRef = doc(db, 'users', activeUser.uid);
    const unsub = onSnapshot(userRef, async (userSnap) => {
      if (!isMounted) return;
      clearTimeout(safetyTimer);
      try {
        if (userSnap.exists()) {
          const userData = userSnap.data();
          setAssignedPrivileges(Array.isArray(userData.privileges) ? userData.privileges : null);
          const isGeneric = (val?: string) =>
            !val || /^(cenro\s*admin(istrator)?|admin(istrator)?|cenro|coordinator)$/i.test(val.trim());

          const resolvedName =
            (!isGeneric(userData.fullName) && userData.fullName) ||
            (userData.firstName ? `${userData.firstName} ${userData.lastName || ''}`.trim() : '') ||
            (!isGeneric(userData.displayName) && userData.displayName) ||
            (!isGeneric(userData.name) && userData.name) ||
            (!isGeneric(activeUser.displayName) && activeUser.displayName) ||
            '';
          if (resolvedName) {
            setUserName(resolvedName);
          }

          let role = userData.role;

          // CICTO super-admin accounts must use the dedicated CICTO portal
          if (role === 'cicto' || role === 'cicto_admin') {
            console.log('Admin dashboard: CICTO role detected in CENRO dashboard:', activeUser.email);
            setAuthError({
              title: 'CICTO Account Detected',
              message: 'This account must use its assigned administrative portal at /cicto.',
            });
            setIsLoading(false);
            return;
          }

          // Driver accounts must use the driver portal
          if (role === 'driver') {
            console.log('Admin dashboard: Driver role detected in CENRO dashboard:', activeUser.email);
            setAuthError({
              title: 'Driver Account Detected',
              message: 'Driver accounts cannot access the CENRO administrative console. Please use the Driver Portal at /driver-login.',
            });
            setIsLoading(false);
            return;
          }

          // Resident accounts cannot access administrative console
          if (role === 'user' || role === 'resident') {
            console.log('Admin dashboard: Resident role detected in CENRO dashboard:', activeUser.email);
            setAuthError({
              title: 'Access Restricted',
              message: 'Resident accounts cannot access the administrative portal. Please use the resident application.',
            });
            setIsLoading(false);
            return;
          }

          if (role === 'coordinator') {
            let brgy = userData.assignedBarangay || userData.barangay || '';
            if (!brgy && userData.employeeId) {
              getDoc(doc(db, 'identifiers', 'coordinator', 'items', userData.employeeId)).then((identSnap) => {
                if (identSnap.exists() && identSnap.data()?.barangay) {
                  const recoveredBrgy = identSnap.data().barangay;
                  setAssignedBarangay(recoveredBrgy);
                  setDoc(userRef, { assignedBarangay: recoveredBrgy, barangay: recoveredBrgy }, { merge: true }).catch(() => {});
                }
              }).catch((e) => {
                console.warn('Dashboard: could not recover coordinator barangay identifier', e);
              });
            } else if (brgy && !userData.assignedBarangay) {
              setDoc(userRef, { assignedBarangay: brgy, barangay: brgy }, { merge: true }).catch(() => {});
            }

            console.log('Admin dashboard: Coordinator role confirmed for:', activeUser.email, 'Barangay:', brgy);
            setUserRole('coordinator');
            setAssignedBarangay(brgy);
            setActiveTab((current) => current === 'dashboard' ? 'diesel-estimate' : current);
            setIsAdmin(true);
            setAuthError(null);
            setIsLoading(false);
            return;
          } else if (
            role === 'mayor' ||
            role === 'admin' ||
            role === 'cenro' ||
            role === 'cenro_officer' ||
            (userData?.designation && String(userData.designation).toUpperCase().includes('CENRO') && !['driver', 'user', 'resident', 'coordinator'].includes(role)) ||
            (userData?.department && String(userData.department).toUpperCase().includes('CENRO') && !['driver', 'user', 'resident', 'coordinator'].includes(role))
          ) {
            console.log('Admin dashboard: Admin role confirmed for:', activeUser.email);
            const rawBrgy = (userData.assignedBarangay || userData.barangay || '').trim();
            const isCityScope = !rawBrgy || /^(city|all|danao\s*city)$/i.test(rawBrgy);
            setUserRole(role || 'admin');
            setAssignedBarangay(isCityScope ? '' : rawBrgy);
            setIsAdmin(true);
            setAuthError(null);
            setIsLoading(false);
          } else {
            // If the snapshot came from local cache or has pending writes before server sync,
            // wait for the authoritative server snapshot before concluding access is restricted.
            if (userSnap.metadata.fromCache || userSnap.metadata.hasPendingWrites) {
              console.log('Admin dashboard: Role not yet in cache/pending writes, awaiting server sync for:', activeUser.email);
              return;
            }
            console.log('Admin dashboard: User does not have CENRO admin/coordinator role:', activeUser.email);
            setAuthError({
              title: 'Access Restricted',
              message: 'Your account does not have administrative clearance for CENRO. CENRO accounts must be provisioned through the CICTO oversight portal. Returning to login...',
            });
            setIsLoading(false);
          }
        } else {
          console.log('Admin dashboard: User document not found at Auth UID, checking for provisioned CENRO profile by email:', activeUser.email);
          try {
            const emailLower = (activeUser.email || '').toLowerCase().trim();
            const qUsers = query(collection(db, 'users'), where('email', '==', emailLower));
            const snapUsers = await getDocs(qUsers);
            const provisionedDoc = snapUsers.docs.find(d => {
              const data = d.data();
              return d.id !== activeUser.uid && (
                data.role === 'admin' ||
                data.role === 'cenro' ||
                data.role === 'coordinator' ||
                (data.employeeId && (String(data.employeeId).toUpperCase().startsWith('CENRO-') || String(data.employeeId).toUpperCase().startsWith('COORD-')))
              );
            });

            if (provisionedDoc) {
              const pData = provisionedDoc.data();
              console.log('Admin dashboard: Linking provisioned CENRO profile', provisionedDoc.id, 'to Auth UID:', activeUser.uid);
              await setDoc(userRef, {
                ...pData,
                uid: activeUser.uid,
                updatedAt: serverTimestamp(),
              }, { merge: true });

              if (pData.employeeId) {
                try {
                  const targetType = pData.role === 'coordinator' || String(pData.employeeId).toUpperCase().startsWith('COORD-') ? 'coordinator' : 'cenro';
                  const identRef = doc(db, 'identifiers', targetType, 'items', pData.employeeId);
                  await setDoc(identRef, { userId: activeUser.uid }, { merge: true });
                } catch {}
              }

              try {
                await deleteDoc(doc(db, 'users', provisionedDoc.id));
              } catch {}

              return;
            }
          } catch (migErr) {
            console.warn('Admin dashboard: Could not link provisioned CENRO profile:', migErr);
          }

          console.log('Admin dashboard: User document not found in Firestore');
          setAuthError({
            title: 'CENRO Record Not Found',
            message: 'No administrative clearance record exists in Firestore for this account. CENRO accounts must be provisioned through the CICTO oversight portal. Returning to login...',
          });
          setIsLoading(false);
        }
      } catch (error: any) {
        console.error('Admin dashboard: Error processing user snapshot:', error);
        if (isMounted) {
          setAuthError({
            title: 'Clearance Verification Failed',
            message: error?.message || 'Database error while verifying administrative clearance. Returning to login...',
          });
          setIsLoading(false);
        }
      }
    }, (error: any) => {
      console.error('Admin dashboard: Error listening to user role:', error);
      if (isMounted) {
        setAuthError({
          title: 'Permission Denied',
          message: error?.message?.includes('permission')
            ? 'Database access was denied by security rules. Returning to login...'
            : 'Failed to synchronize administrative clearance. Returning to login...',
        });
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsub();
    };
  }, [user, authLoading, router]);

  // Dashboard summaries: latest 3 report images and feedback snapshot (only for CENRO admin dashboard)
  useEffect(() => {
    if (!db || !user || !isAdmin || userRole === 'coordinator') return;

    // Latest report images (summary thumbnails)
    const reportsRef = collection(db, 'reports');
    const reportsQuery = query(reportsRef, orderBy('createdAt', 'desc'), limit(12));
    const unsubReports = onSnapshot(reportsQuery, (snap) => {
      const images: string[] = [];
      snap.forEach((d) => {
        const data: any = d.data();
        if (data?.imageURL) images.push(data.imageURL);
      });
      setLatestReportImages(images.slice(0, 3));
    }, (error) => {
      console.warn('Dashboard reports thumbnail snapshot error:', error);
    });

    // Feedback summary and latest feedback
    const feedbackRef = collection(db, 'feedback');
    const feedbackQuery = query(feedbackRef, orderBy('createdAt', 'desc'), limit(20));
    const unsubFeedback = onSnapshot(feedbackQuery, async (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      
      // Process feedbacks and fetch user data
      const processFeedbacks = async () => {
        const userCacheById = new Map<string, any>();
        const userCacheByEmail = new Map<string, any>();
        
        // Resolve storage path to download URL if needed
        const resolvePhotoURL = async (maybePath?: string) => {
          try {
            if (!maybePath) return undefined;
            const isHttp = /^https?:\/\//i.test(maybePath);
            if (isHttp) return maybePath;
            const { getDownloadURL, ref } = await import('firebase/storage');
            const { storage } = await import('../../config/firebase');
            if (!storage) return undefined;
            const r = ref(storage, maybePath);
            return await getDownloadURL(r);
          } catch (e) {
            console.warn('Dashboard: Failed to resolve photo URL:', e);
            return undefined;
          }
        };
        
        if (items.length > 0) {
          const lf = items[0];
          let userName = 'User';
          let userEmail = '';
          let photoURL: string | undefined = undefined;
          
          // Fetch user data from users collection
          try {
            // 1) Try by userId
            if (lf.userId) {
              let userData = userCacheById.get(lf.userId);
              if (!userData) {
                const userDoc = await getDoc(doc(db, 'users', lf.userId));
                if (userDoc.exists()) userData = userDoc.data();
                if (userData) userCacheById.set(lf.userId, userData);
              }
              if (userData) {
                userName = userData.displayName || userData.email?.split('@')[0] || 'User';
                userEmail = userData.email || lf.userEmail || '';
                photoURL = await resolvePhotoURL(userData.photoURL || userData.avatar || undefined);
              }
            }

            // 2) If still missing, try by email
            if (!userEmail) {
              const emailKey = (lf.userEmail || '').toLowerCase();
              if (emailKey) {
                let userData = userCacheByEmail.get(emailKey);
                if (!userData) {
                  const usersRef = collection(db, 'users');
                  const qUsers = query(usersRef, where('email', '==', lf.userEmail));
                  const snapUsers = await getDocs(qUsers);
                  if (!snapUsers.empty) userData = snapUsers.docs[0].data();
                  if (userData) userCacheByEmail.set(emailKey, userData);
                }
                if (userData) {
                  userName = userData.displayName || userData.email?.split('@')[0] || userName;
                  userEmail = userData.email || lf.userEmail || userEmail;
                  if (!photoURL) photoURL = await resolvePhotoURL(userData.photoURL || userData.avatar || undefined);
                }
              }
            }

            // 3) Fallbacks from feedback document itself
            if (!userEmail) userEmail = lf.userEmail || '';
            if (!userName) userName = userEmail?.split('@')[0] || 'User';
            if (!photoURL && (lf.photoURL || lf.avatar)) {
              photoURL = await resolvePhotoURL(lf.photoURL || lf.avatar);
            }
          } catch (error) {
            console.error('Error enriching user data in dashboard:', error);
            userName = lf.userEmail?.split('@')[0] || 'User';
            userEmail = lf.userEmail || '';
          }
          
          setLatestFeedback({
            userName: userName,
            message: lf.description || lf.message || '',
            rating: lf.rating || 'Good',
            createdAt: lf.createdAt,
            photoURL: photoURL,
          });
        } else {
          setLatestFeedback(null);
        }
        
        const total = items.length || 1;
        const count = (label: string) => items.filter((i) => (i.rating || '').toLowerCase() === label.toLowerCase()).length;
        setFeedbackStats({
          loved: Math.round((count('Loved it') / total) * 100),
          good: Math.round((count('Good') / total) * 100),
          bad: Math.round((count('Bad') / total) * 100),
          terrible: Math.round((count('Terrible') / total) * 100),
        });
      };
      
      processFeedbacks();
    }, (error) => {
      console.warn('Dashboard feedback summary snapshot error:', error);
    });

    return () => {
      unsubReports();
      unsubFeedback();
    };
  }, [user, userRole, isAdmin]);

  // History counters (pickup completion and resolved trash reports) and list subscription
  useEffect(() => {
    if (!db || !user || !isAdmin || userRole === 'coordinator') return;
    const schedulesQuery = query(collection(db, 'schedules'), orderBy('createdAt', 'desc'), limit(50));
    const reportsQuery = query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(50));
    const unsubSched = onSnapshot(schedulesQuery, (snap) => {
      const items = snap.docs.map((d) => d.data() as any);
      // Prefer explicit completed statuses if present, else count all
      const completed = items.filter((i) => {
        const s = (i.status || '').toString().toLowerCase();
        return s === 'completed' || s === 'resolved' || s === 'done';
      }).length;
      const pickup = completed > 0 ? completed : items.length;
      setHistoryCounts((prev) => ({ ...prev, pickup }));
    }, (error) => {
      console.warn('Dashboard schedules counter snapshot error:', error);
    });
    const unsubRep = onSnapshot(reportsQuery, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any[];
      const onlyResolved = all.filter((r) => (r.status || '').toString().toLowerCase() === 'resolved');
      setResolvedReports(
        onlyResolved.map((r) => ({
          id: r.id,
          title: r.title || 'Untitled',
          description: r.description || '',
          barangay: r.barangay || '',
          street: r.street || '',
          userEmail: r.userEmail || '',
          status: r.status || 'resolved',
          createdAt: r.createdAt,
        }))
      );
      setHistoryCounts((prev) => ({ ...prev, reports: onlyResolved.length }));
    }, (error) => {
      console.warn('Dashboard reports list snapshot error:', error);
    });
    return () => { unsubSched(); unsubRep(); };
  }, [user, userRole, isAdmin]);

  // Load inline history when admin clearance is confirmed
  useEffect(() => {
    if (isAdmin) {
      fetchInlineHistory(historyView);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, historyView, historyFilter]);

  const handleLogout = async () => {
    console.log('Admin logout: Button pressed, showing confirmation modal');
    setShowLogoutModal(true);
  };

  const sendTestNotification = async () => {
    const next = await sendTestNotificationHelper(db, user, currentNotificationType);
    setCurrentNotificationType(next);
  };

  const confirmLogout = async () => {
    try {
      console.log('Admin logout: Starting logout process...');
      setShowLogoutModal(false);
      await signOut(auth);
      console.log('Admin logout: Successfully logged out');
      setIsAdmin(false);
      router.replace('/admin/login');
    } catch (error) {
      console.error('Admin logout error:', error);
      Alert.alert('Logout Error', 'There was an issue logging out. Please try again.');
    }
  };

  const cancelLogout = () => {
    console.log('Admin logout: Cancelled by user');
    setShowLogoutModal(false);
  };

  // Export functions
  const exportHistoryReportData = async (reports: Report[], format: 'csv' | 'xlsx' | 'pdf') => {
    try {
      const headers = ['Reporter Email', 'Barangay', 'Street / Location', 'Date', 'Report Title', 'Status'];
      const rows = reports.map((report) => {
        const date = report.createdAt?.toDate ? report.createdAt.toDate().toLocaleDateString() : 'N/A';
        return [
          report.userEmail || 'Anonymous',
          report.barangay || 'Danao City',
          report.street || 'N/A',
          date,
          report.title || 'N/A',
          (report.status || 'PENDING').toUpperCase(),
        ];
      });

      await exportReport({
        format,
        filename: `danao_history_reports_${new Date().toISOString().slice(0, 10)}`,
        title: 'Historical Trash Reports Record',
        subtitle: 'City Environment & Natural Resources Office Citizen Reports Archive',
        jurisdiction: 'City of Danao (All Barangays)',
        generatedBy: 'CENRO Administrator',
        headers,
        rows,
        summaryCards: [
          { label: 'Total Reports', value: reports.length },
          { label: 'Resolved / Cleaned', value: reports.filter((r) => r.status === 'cleaned').length },
        ],
        sheetName: 'History_Reports',
      });
    } catch (error) {
      console.error('Export Error:', error);
      Alert.alert('Export Error', 'Failed to export data');
    }
  };

  const exportToCSV = (reports: Report[]) => exportHistoryReportData(reports, 'csv');
  const exportToExcel = (reports: Report[]) => exportHistoryReportData(reports, 'xlsx');
  const exportToPDF = (reports: Report[]) => exportHistoryReportData(reports, 'pdf');

  // History modal functions
  const openHistoryModal = (type: 'pickup' | 'reports') => {
    setHistoryType(type);
    setShowHistoryModal(true);
    setHistoryPage(1);
    fetchHistoryData(type, 1);
  };

  // Inline history panel fetcher (for switching bottom list without modal)
  const fetchInlineHistory = async (type: 'pickup' | 'reports') => {
    if (!db || !isAdmin) return;
    setIsHistoryLoading(true);
    try {
      const collectionName = type === 'pickup' ? 'schedules' : 'reports';
      const collectionRef = collection(db, collectionName);

      const now = new Date();
      let startDate: Date;
      switch (historyFilter) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        default:
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      const q = query(
        collectionRef,
        where('createdAt', '>=', startDate),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      const snap = await getDocs(q);
      const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any[];

      const mapped: Report[] = data.map((r) => ({
        id: r.id,
        title: r.title || (type === 'pickup' ? `Pickup: ${r.barangay || 'Collection'}` : 'Untitled'),
        description: r.description || r.wasteType || '',
        barangay: r.barangay || '',
        street: r.street || '',
        userEmail: r.userEmail || r.assignedDriverEmail || '',
        status: r.status || (type === 'pickup' ? 'completed' : 'pending'),
        createdAt: r.createdAt,
      }));
      setHistoryData(mapped);
    } catch (e) {
      console.warn('Failed to fetch inline history:', e);
      setHistoryData([]);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const fetchHistoryData = async (type: 'pickup' | 'reports', page: number) => {
    if (!db || !isAdmin) return;
    
    try {
      const itemsPerPage = 10;
      
      const collectionName = type === 'pickup' ? 'schedules' : 'reports';
      const collectionRef = collection(db, collectionName);
      
      // Apply date filter
      const now = new Date();
      let startDate: Date;
      
      switch (historyFilter) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        default:
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }
      
      const q = query(collectionRef, 
        where('createdAt', '>=', startDate),
        orderBy('createdAt', 'desc'), 
        limit(itemsPerPage)
      );
      
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Report[];
      
      setHistoryReports(data);
      
      // Calculate total pages (simplified - in real app you'd get total count)
      setHistoryTotalPages(Math.ceil(data.length / itemsPerPage));
      
    } catch (error) {
      console.error('Error fetching history data:', error);
      Alert.alert('Error', 'Failed to fetch history data');
    }
  };

  const handleHistoryPageChange = (newPage: number) => {
    setHistoryPage(newPage);
    fetchHistoryData(historyType, newPage);
  };

  // Show error screen with red styling, countdown, and Return to Login button if verification fails
  if (authError && !isAdmin) {
    return (
      <PortalLoadingScreen
        portal="cenro"
        title="CENRO Portal"
        subtitle="City Environment & Natural Resources Office"
        isError={true}
        errorTitle={authError.title}
        errorMessage={authError.message}
        countdownSeconds={5}
        onCancel={async () => {
          try {
            if (auth?.currentUser) await signOut(auth);
          } catch {}
          router.replace('/cenro?error=auth_error' as any);
        }}
      />
    );
  }

  // Show loading while checking admin access on cold boot until finished to 100%
  if (isLoading || (!isReady && isAdmin)) {
    return (
      <PortalLoadingScreen
        portal="cenro"
        title="CENRO Portal"
        subtitle="City Environment & Natural Resources Office"
        isDone={!isLoading && isAdmin}
        onFinish={() => setIsReady(true)}
      />
    );
  }

  // Fallback: If not authenticated or not admin, show red error screen instead of returning null (blank green screen)
  const currentActiveUser = user || auth?.currentUser;
  if (!currentActiveUser || !isAdmin) {
    return (
      <PortalLoadingScreen
        portal="cenro"
        title="CENRO Portal"
        subtitle="City Environment & Natural Resources Office"
        isError={true}
        errorTitle="Administrative Clearance Required"
        errorMessage="Your session does not have verified administrative access. Returning to login..."
        countdownSeconds={4}
        onCancel={async () => {
          try {
            if (auth?.currentUser) await signOut(auth);
          } catch {}
          router.replace('/cenro?error=auth_error' as any);
        }}
      />
    );
  }

  const renderContent = () => {
    const isCoordinator = userRole === 'coordinator';
    const isReadOnly = !isCoordinator && !canWriteOperationalTab(activeTab, assignedPrivileges);

    // If coordinator tries to access a restricted tab, guard and fallback
    if (isCoordinator) {
      switch (activeTab) {
        case 'diesel-estimate':
          return <DieselEstimateTab userRole={userRole} assignedBarangay={assignedBarangay} onNavigateTab={handleTabPress} isReadOnly={isReadOnly} />;
        case 'route-optimization':
          return <RouteOptimizationTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
        case 'collection-scheduler':
          return <CollectionSchedulerTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
        case 'trash-reports':
          return <TrashReportsTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
        case 'truck-inventory':
          return <TruckInventoryTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
        case 'fleet-monitoring':
          return <FleetMonitoringTab userRole={userRole} assignedBarangay={assignedBarangay} />;
        case 'driver-accounts':
        case 'driver-onboarding':
          return (
            <DriverAccountsTab
              userRole={userRole}
              assignedBarangay={assignedBarangay}
              initialSubTab="driver"
              initialOpenOnboarding={activeTab === 'driver-onboarding'}
              isReadOnly={isReadOnly}
            />
          );
        case 'announcements':
          return <AnnouncementsTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
        case 'service-feedback':
          return <ServiceFeedbackTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
        case 'rewards':
          return <CenroRewardsTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
        case 'logs':
          return <OperationalLogsTab isReadOnly={isReadOnly} />;
        case 'cicto-commands':
          return <CictoCommandsTab userRole={userRole} assignedBarangay={assignedBarangay} />;
        case 'support':
          return <SupportTab userRole={userRole} assignedBarangay={assignedBarangay} onNavigateTab={handleTabPress} />;
        default:
          return <DieselEstimateTab userRole={userRole} assignedBarangay={assignedBarangay} onNavigateTab={handleTabPress} isReadOnly={isReadOnly} />;
      }
    }

    switch (activeTab) {
      case 'diesel-estimate':
        return <DieselEstimateTab userRole={userRole} assignedBarangay={assignedBarangay} onNavigateTab={handleTabPress} isReadOnly={isReadOnly} />;
      case 'dashboard':
        return <CenroDashboardTab onTabChange={handleTabPress} />;
      case 'trash-reports':
        return <TrashReportsTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
      case 'service-feedback':
        return <ServiceFeedbackTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
      case 'rewards':
        return <CenroRewardsTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
      case 'route-optimization':
        return <RouteOptimizationTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
      case 'fleet-monitoring':
        return <FleetMonitoringTab userRole={userRole} assignedBarangay={assignedBarangay} />;
      case 'truck-inventory':
        return <TruckInventoryTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
      case 'driver-onboarding':
      case 'driver-accounts':
        return (
          <DriverAccountsTab
            userRole={userRole}
            assignedBarangay={assignedBarangay}
            initialOpenOnboarding={activeTab === 'driver-onboarding'}
            isReadOnly={isReadOnly}
          />
        );
      case 'collection-scheduler':
        return <CollectionSchedulerTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
      case 'operational-overrides':
        return <OperationalOverridesTab onNavigateToLogs={() => handleTabPress('logs')} isReadOnly={isReadOnly} />;
      case 'logs':
        return <OperationalLogsTab isReadOnly={isReadOnly} />;
      case 'announcements':
        return <AnnouncementsTab userRole={userRole} assignedBarangay={assignedBarangay} isReadOnly={isReadOnly} />;
      case 'cicto-commands':
        return <CictoCommandsTab userRole={userRole} assignedBarangay={assignedBarangay} />;
      case 'support':
        return <SupportTab userRole={userRole} assignedBarangay={assignedBarangay} onNavigateTab={handleTabPress} />;
      case 'coordinators':
        return (
          <DriverAccountsTab
            userRole={userRole}
            assignedBarangay={assignedBarangay}
            initialSubTab="coordinators"
            isReadOnly={isReadOnly}
          />
        );
      case 'analytics':
        return (
          <WasteAnalyticsTab
            targetSection={analyticsTargetSection}
            onClearTargetSection={() => setAnalyticsTargetSection(null)}
            isReadOnly={isReadOnly}
          />
        );
      default:
        return <CenroDashboardTab onTabChange={handleTabPress} />;
    }
  };

  const handleTabPress = (tab: string, targetSection?: string) => {
    const tabAliasMap: Record<string, string> = {
      'diesel-estimate': 'diesel-estimate',
      'diesel': 'diesel-estimate',
      'trip-log': 'diesel-estimate',
      'logs': 'logs',
      'reports': 'trash-reports',
      'trash-reports': 'trash-reports',
      'routes': 'route-optimization',
      'route-optimization': 'route-optimization',
      'fleet': 'fleet-monitoring',
      'fleet-monitoring': 'fleet-monitoring',
      'overrides': 'operational-overrides',
      'operational-overrides': 'operational-overrides',
      'scheduler': 'collection-scheduler',
      'collection-scheduler': 'collection-scheduler',
      'inventory': 'truck-inventory',
      'truck-inventory': 'truck-inventory',
      'drivers': 'driver-accounts',
      'driver-accounts': 'driver-accounts',
      'feedback': 'service-feedback',
      'service-feedback': 'service-feedback',
      'rewards': 'rewards',
      'eco-rewards': 'rewards',
      'announcements': 'announcements',
      'cicto-commands': 'cicto-commands',
      'cicto': 'cicto-commands',
      'chat': 'cicto-commands',
      'support': 'support',
      'help': 'support',
      'dashboard': 'dashboard',
      'analytics': 'analytics',
    };
    const resolvedTab = tabAliasMap[tab] || tab;

    if (!canAccessOperationalTab(resolvedTab, assignedPrivileges)) {
      Alert.alert('Access not assigned', 'Your CICTO-assigned privileges do not include this section. Contact CICTO to request access.');
      return;
    }

    if (resolvedTab === 'profile-settings') {
      setShowProfileSettingsModal(true);
      return;
    }

    if (resolvedTab === activeTab) {
      if (resolvedTab === 'analytics' && targetSection) {
        setAnalyticsTargetSection(targetSection);
      }
      return; // Don't show loader if clicking the same tab
    }
    
    setIsTabLoading(true);
    setActiveTab(resolvedTab);
    if (resolvedTab === 'analytics' && targetSection) {
      setAnalyticsTargetSection(targetSection);
    } else if (resolvedTab !== 'analytics') {
      setAnalyticsTargetSection(null);
    }
    
    // Start spinner animation
    spinValue.setValue(0);
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      })
    ).start();
    
    // Simulate loading time for better UX
    setTimeout(() => {
      setIsTabLoading(false);
    }, 300);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          {isNarrow && (
            <TouchableOpacity
              style={styles.hamburgerBtn}
              onPress={() => setDrawerOpen(true)}
            >
              <MaterialIcons name="menu" size={26} color="#2E8B57" />
            </TouchableOpacity>
          )}
          {(branding.cenroLogoUrl || branding.systemLogoUrl) ? (
            <Image
              source={{ uri: (branding.cenroLogoUrl || branding.systemLogoUrl)! }}
              style={styles.topBarLogo}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.topBarDefaultLogo}>
              <MaterialIcons name="eco" size={22} color="#15803D" />
            </View>
          )}
          <View>
            <Text style={styles.topBarAgencyTitle}>
              {userRole === 'coordinator' ? 'Barangay Field Command' : 'CENRO Civic Command'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#22C55E' }} />
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#15803D', letterSpacing: 0.6 }}>SYSTEM ACTIVE</Text>
            </View>
          </View>
        </View>
        <View style={{ flex: 1 }} />
        <View style={styles.topBarRight}>
          <TouchableOpacity
            style={[styles.topBarIconBtn, unreadNotifCount > 0 && styles.topBarIconBtnActive]}
            onPress={() => setShowNotifDropdown(!showNotifDropdown)}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name={unreadNotifCount > 0 ? "notifications-active" : "notifications-none"}
              size={22}
              color={unreadNotifCount > 0 ? "#DC2626" : "#374151"}
            />
            {unreadNotifCount > 0 ? (
              <View style={styles.notificationDot}>
                <Text style={styles.notificationDotText}>{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBarIconBtn} onPress={() => setShowProfileSettingsModal(true)}>
            <MaterialIcons name="settings" size={24} color="#374151" />
          </TouchableOpacity>
          <View style={styles.topBarDivider} />
          {!isNarrow && (
            <View style={styles.topBarUser}>
              {userRole === 'coordinator' ? (
                <>
                  <Text style={styles.topBarRole}>
                    {getFormattedUserName()}
                  </Text>
                  <Text style={styles.topBarSubrole}>
                    {assignedBarangay ? `Brgy. ${assignedBarangay} Coordinator` : 'Barangay Coordinator'}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.topBarRole}>
                    CENRO Administrator
                  </Text>
                  <Text style={styles.topBarSubrole}>
                    Waste Management Operations
                  </Text>
                </>
              )}
            </View>
          )}
          <View>
            {user?.photoURL ? (
              <Image source={{ uri: user.photoURL }} style={styles.topBarAvatar} />
            ) : (
              <View style={[styles.topBarAvatar, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#DDE9DF' }]}>
                <MaterialIcons name="person" size={22} color="#2E6B49" />
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Real-time Notification Dropdown */}
      <AdminNotificationDropdown
        visible={showNotifDropdown}
        onClose={() => setShowNotifDropdown(false)}
        onNavigateTab={(tabKey) => handleTabPress(tabKey)}
        onUnreadCountChange={setUnreadNotifCount}
      />
      
      <View style={styles.mainContainer}>
        <AdminSidebar 
          activeTab={activeTab} 
          onTabPress={handleTabPress} 
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          userRole={userRole}
          assignedBarangay={assignedBarangay}
          privileges={assignedPrivileges}
        />
        <View style={[styles.contentContainer, isNarrow && styles.contentContainerNarrow]}>
          {isCurrentTabReadOnly && activeTab !== 'dashboard' && activeTab !== 'support' && (
            <View style={styles.readOnlyTopBanner}>
              <View style={styles.readOnlyBannerLeft}>
                <View style={styles.readOnlyBannerIcon}>
                  <MaterialIcons name="lock-outline" size={18} color="#B45309" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.readOnlyBannerTitle}>READ-ONLY MODE</Text>
                  <Text style={styles.readOnlyBannerSubtitle}>
                    Your account has view-only access to this operational section. Modifications, additions, and deletions are restricted by CICTO.
                  </Text>
                </View>
              </View>
              <View style={styles.readOnlyBadge}>
                <MaterialIcons name="visibility" size={14} color="#92400E" style={{ marginRight: 4 }} />
                <Text style={styles.readOnlyBadgeText}>VIEW ONLY</Text>
              </View>
            </View>
          )}
          {isTabLoading ? (
            <View style={styles.tabLoaderContainer}>
              <View style={styles.tabLoader}>
                <Animated.View 
                  style={[
                    styles.loaderSpinner,
                    {
                      transform: [{
                        rotate: spinValue.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg'],
                        })
                      }]
                    }
                  ]} 
                />
                <Text style={styles.loaderText}>Loading...</Text>
              </View>
            </View>
          ) : (
            renderContent()
          )}
        </View>
      </View>

      {/* CENRO Profile & Security Settings Modal */}
      <CenroProfileSettingsModal
        visible={showProfileSettingsModal}
        onClose={() => setShowProfileSettingsModal(false)}
        onLogout={() => setShowLogoutModal(true)}
        userRole={userRole}
        assignedBarangay={assignedBarangay}
      />

      <Modal
        visible={showLogoutModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.logoutModalContainer}>
            {/* Header with Icon */}
            <View style={styles.logoutModalHeader}>
              <View style={styles.logoutIconContainer}>
                <Text style={styles.logoutIconText}>🚪</Text>
              </View>
              <Text style={styles.logoutModalTitle}>Confirm Logout</Text>
              <Text style={styles.logoutModalSubtitle}>Admin Panel</Text>
            </View>
            
            {/* Content */}
            <View style={styles.logoutModalContent}>
              <Text style={styles.logoutModalMessage}>
                Are you sure you want to logout from the admin panel? You will need to sign in again to access administrative features.
              </Text>
            </View>
            
            {/* Actions */}
            <View style={styles.logoutModalActions}>
              <TouchableOpacity 
                style={styles.logoutCancelButton} 
                onPress={cancelLogout}
                activeOpacity={0.8}
              >
                <Text style={styles.logoutCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.logoutConfirmButton} 
                onPress={confirmLogout}
                activeOpacity={0.8}
              >
                <Text style={styles.logoutConfirmButtonText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Image Preview Modal */}
      <Modal
        visible={isImagePreviewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsImagePreviewVisible(false)}
      >
        <View style={styles.imagePreviewOverlay}>
          <View style={styles.imagePreviewContainer}>
            <ScrollView
              contentContainerStyle={styles.imagePreviewScroll}
              maximumZoomScale={3}
              minimumZoomScale={1}
              centerContent
            >
              {imagePreviewUrl ? (
                <Image
                  source={{ uri: imagePreviewUrl }}
                  style={styles.imagePreview}
                  resizeMode="contain"
                />
              ) : null}
            </ScrollView>
            <TouchableOpacity style={styles.imagePreviewClose} onPress={() => setIsImagePreviewVisible(false)}>
              <MaterialIcons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* History Modal */}
      <Modal
        visible={showHistoryModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowHistoryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.historyModalContent}>
            <View style={styles.historyModalHeader}>
              <Text style={styles.historyModalTitle}>
                {historyType === 'pickup' ? 'Pickup Completion History' : 'Trash Reports History'}
              </Text>
              <TouchableOpacity 
                onPress={() => setShowHistoryModal(false)}
                style={styles.historyModalClose}
              >
                <MaterialIcons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            {/* Filter buttons */}
            <View style={styles.historyFilterButtons}>
              <TouchableOpacity 
                style={[styles.historyFilterButton, historyFilter === 'today' && styles.historyFilterButtonActive]}
                onPress={() => {
                  setHistoryFilter('today');
                  fetchHistoryData(historyType, 1);
                }}
              >
                <Text style={[styles.historyFilterButtonText, historyFilter === 'today' && styles.historyFilterButtonTextActive]}>Today</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.historyFilterButton, historyFilter === 'week' && styles.historyFilterButtonActive]}
                onPress={() => {
                  setHistoryFilter('week');
                  fetchHistoryData(historyType, 1);
                }}
              >
                <Text style={[styles.historyFilterButtonText, historyFilter === 'week' && styles.historyFilterButtonTextActive]}>Weekly</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.historyFilterButton, historyFilter === 'month' && styles.historyFilterButtonActive]}
                onPress={() => {
                  setHistoryFilter('month');
                  fetchHistoryData(historyType, 1);
                }}
              >
                <Text style={[styles.historyFilterButtonText, historyFilter === 'month' && styles.historyFilterButtonTextActive]}>Monthly</Text>
              </TouchableOpacity>
            </View>

            {/* Export buttons */}
            <View style={styles.exportButtons}>
              <TouchableOpacity 
                style={styles.exportButton}
                onPress={() => exportToPDF(historyReports)}
              >
                <MaterialIcons name="picture-as-pdf" size={16} color="#fff" />
                <Text style={styles.exportButtonText}>Export PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.exportButton}
                onPress={() => exportToExcel(historyReports)}
              >
                <MaterialIcons name="table-chart" size={16} color="#fff" />
                <Text style={styles.exportButtonText}>Export Excel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.exportButton}
                onPress={() => exportToCSV(historyReports)}
              >
                <MaterialIcons name="download" size={16} color="#fff" />
                <Text style={styles.exportButtonText}>Export CSV</Text>
              </TouchableOpacity>
            </View>

            {/* History list */}
            <ScrollView style={styles.historyList}>
              {historyReports.map((report, index) => (
                <View key={report.id || index} style={styles.historyItem}>
                  <View style={styles.historyItemContent}>
                    <Text style={styles.historyItemName}>{report.userEmail}</Text>
                    <Text style={styles.historyItemLocation}>{report.barangay}, {report.street}</Text>
                    <Text style={styles.historyItemDate}>
                      {report.createdAt?.toDate ? report.createdAt.toDate().toLocaleDateString() : 'N/A'}
                    </Text>
                    <Text style={styles.historyItemTitle}>{report.title}</Text>
                    <Text style={[styles.historyItemStatus, { color: report.status === 'resolved' ? '#10B981' : '#F59E0B' }]}>
                      {report.status}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>

            {/* Pagination */}
            <View style={styles.historyPagination}>
              <TouchableOpacity 
                style={[styles.paginationButton, historyPage === 1 && styles.paginationButtonDisabled]}
                onPress={() => handleHistoryPageChange(historyPage - 1)}
                disabled={historyPage === 1}
              >
                <Text style={[styles.paginationButtonText, historyPage === 1 && styles.paginationButtonTextDisabled]}>Previous</Text>
              </TouchableOpacity>
              
              <Text style={styles.paginationInfo}>
                Page {historyPage} of {historyTotalPages}
              </Text>
              
              <TouchableOpacity 
                style={[styles.paginationButton, historyPage === historyTotalPages && styles.paginationButtonDisabled]}
                onPress={() => handleHistoryPageChange(historyPage + 1)}
                disabled={historyPage === historyTotalPages}
              >
                <Text style={[styles.paginationButtonText, historyPage === historyTotalPages && styles.paginationButtonTextDisabled]}>Next</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  topBar: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topBarLogo: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  topBarDefaultLogo: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarAgencyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1F2937',
    letterSpacing: 0.2,
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#4b6354',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  topBarIconBtn: {
    padding: 7,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    position: 'relative',
  },
  topBarIconBtnActive: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  notificationDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  notificationDotText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
  },
  topBarDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 8,
  },
  topBarUser: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  topBarRole: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#111827',
  },
  topBarSubrole: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.5,
  },
  topBarAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E5E7EB',
  },
  hamburgerBtn: {
    marginRight: 12,
    padding: 4,
  },
  mainContainer: {
    flexDirection: 'row',
    flex: 1,
  },
  contentContainer: {
    flex: 1,
    padding: 20,
  },
  contentContainerNarrow: {
    padding: 0,
  },
  readOnlyTopBanner: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FCD34D',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  readOnlyBannerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  readOnlyBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  readOnlyBannerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#92400E',
    letterSpacing: 0.5,
  },
  readOnlyBannerSubtitle: {
    fontSize: 12,
    color: '#78350F',
    marginTop: 2,
  },
  readOnlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDE68A',
    borderColor: '#F59E0B',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  readOnlyBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
    letterSpacing: 0.5,
  },
  content: {
    flex: 1,
  },
  historyContainer: {
    backgroundColor: '#EAF6E8',
    borderRadius: 20,
    padding: 20,
    borderWidth: 2,
    borderColor: '#BFD9C4',
  },
  historyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#234033',
  },
  historySubtitle: {
    fontSize: 12,
    color: '#234033',
    marginTop: 6,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DDEEDB',
    borderWidth: 1,
    borderColor: '#C8D8CA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 8,
  },
  filterButtonText: {
    color: '#234033',
    fontWeight: '600',
  },
  historyDivider: {
    height: 2,
    backgroundColor: '#234033',
    opacity: 0.5,
    marginTop: 12,
    marginBottom: 20,
  },
  historyCardsRow: {
    flexDirection: 'row',
    gap: 20,
  },
  historyCard: {
    flex: 1,
    borderRadius: 12,
    padding: 18,
    borderWidth: 2,
    minHeight: 280,
  },
  historyCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#234033',
    marginBottom: 10,
  },
  historyCardNumber: {
    fontSize: 36,
    top: 70,
    fontWeight: '800',
    textAlign: 'center',
  },
  historyFilterTab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#DDEEDB',
    borderWidth: 1,
    borderColor: '#C8D8CA',
  },
  historyFilterTabActive: {
    backgroundColor: '#2E8B57',
    borderColor: '#2E8B57',
  },
  historyFilterTabText: {
    color: '#234033',
    fontWeight: '600',
  },
  historyFilterTabTextActive: {
    color: 'white',
  },
  historyTable: {
    backgroundColor: '#E3F0E3',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#8FB497',
    overflow: 'hidden',
  },
  historyTableHeader: {
    backgroundColor: '#D0E2D0',
  },
  historyTableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#C8D8CA',
  },
  historyTableRowEven: {
    backgroundColor: '#F3F7F3',
  },
  historyTableRowOdd: {
    backgroundColor: '#EAF6E8',
  },
  historyTableHeaderText: {
    fontWeight: '700',
    color: '#234033',
  },
  historyTableCell: {
    paddingHorizontal: 6,
    color: '#234033',
  },
  colName: { width: '18%', minWidth: 90 },
  colBarangay: { width: '22%', minWidth: 110 },
  colStreet: { width: '22%', minWidth: 110 },
  colDate: { width: '14%', minWidth: 90 },
  colTitle: { width: '24%', minWidth: 130 },
  headerCard: {
    backgroundColor: '#E3F0E3',
    borderRadius: 20,
    padding: 20,
    borderWidth: 2,
    borderColor: '#8FB497',
    marginBottom: 16,
  },
  headerCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#242E21',
  },
  headerCardSubtitle: {
    fontSize: 12,
    color: '#242E21',
  },
  headerDivider: {
    height: 2,
    backgroundColor: '#242E21',
    width: '100%',
    marginVertical: 8,
    opacity: 0.7,
  },
  sectionBlock: {
    backgroundColor: '#E3F0E3',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#8FB497',
    padding: 16,
    marginBottom: 16,
  },
  blockTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#242E21',
    marginBottom: 12,
  },
  reportsRow: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  reportCard: {
    flex: 1,
    height: 140,
    backgroundColor: '#D0E2D0',
    borderRadius: 16,
  },
  reportImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  feedbackCard: {
    backgroundColor: '#DCEAD9',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  feedbackAvatar: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#BFD3BF',
  },
  dashboardAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  feedbackContent: {
    flex: 1,
    paddingLeft: 8,
    gap: 6,
  },
  feedbackQuote: {
    fontSize: 14,
    fontWeight: '700',
    color: '#242E21',
  },
  feedbackBody: {
    fontSize: 12,
    color: '#242E21',
  },
  feedbackMeta: {
    fontSize: 10,
    color: '#4A5A49',
    textAlign: 'right',
  },
  feedbackPercent: {
    fontSize: 12,
    color: '#242E21',
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  statCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '48%',
    marginBottom: 15,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 10,
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
    textAlign: 'center',
  },
  section: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  activityText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
  },
  activityTime: {
    fontSize: 12,
    color: '#999',
  },
  placeholderText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    fontSize: 18,
    color: '#333',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    width: '80%',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  modalMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  modalButton: {
    backgroundColor: '#FF6347',
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 8,
  },
  modalButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  // Beautiful Logout Modal Styles
  logoutModalContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    width: '90%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 15,
    overflow: 'hidden',
  },
  logoutModalHeader: {
    backgroundColor: '#F8F9FA',
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  logoutIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFE4E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#FF6B6B',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  logoutIconText: {
    fontSize: 28,
  },
  logoutModalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 4,
    textAlign: 'center',
  },
  logoutModalSubtitle: {
    fontSize: 14,
    color: '#6C757D',
    fontWeight: '500',
    textAlign: 'center',
  },
  logoutModalContent: {
    padding: 24,
  },
  logoutModalMessage: {
    fontSize: 16,
    color: '#495057',
    lineHeight: 24,
    textAlign: 'center',
  },
  logoutModalActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  logoutCancelButton: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    borderWidth: 2,
    borderColor: '#DEE2E6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutCancelButtonText: {
    color: '#6C757D',
    fontSize: 16,
    fontWeight: '600',
  },
  logoutConfirmButton: {
    flex: 1,
    backgroundColor: '#DC3545',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#DC3545',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  logoutConfirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Tab Loader Styles
  tabLoaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
  },
  tabLoader: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  loaderSpinner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 4,
    borderColor: '#E3F0E3',
    borderTopColor: '#2E8B57',
    marginBottom: 16,
    // Animation will be handled by React Native's built-in animation
  },
  loaderText: {
    fontSize: 16,
    color: '#6C757D',
    fontWeight: '500',
  },
  imagePreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  imagePreviewContainer: {
    width: '100%',
    maxWidth: 900,
    maxHeight: '90%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  imagePreviewScroll: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  imagePreviewClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 16,
    padding: 6,
  },
  // History modal styles
  historyModalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    margin: 20,
    maxHeight: '90%',
    minHeight: '60%',
  },
  historyModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  historyModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  historyModalClose: {
    padding: 8,
  },
  historyFilterButtons: {
    flexDirection: 'row',
    marginBottom: 20,
    gap: 10,
  },
  historyFilterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  historyFilterButtonActive: {
    backgroundColor: '#234033',
    borderColor: '#234033',
  },
  historyFilterButtonText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  historyFilterButtonTextActive: {
    color: 'white',
  },
  exportButtons: {
    flexDirection: 'row',
    marginBottom: 20,
    gap: 10,
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#234033',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  exportButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  historyList: {
    flex: 1,
    marginBottom: 20,
  },
  historyItem: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#234033',
  },
  historyItemContent: {
    gap: 4,
  },
  historyItemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  historyItemLocation: {
    fontSize: 14,
    color: '#666',
  },
  historyItemDate: {
    fontSize: 12,
    color: '#999',
  },
  historyItemTitle: {
    fontSize: 14,
    color: '#333',
    marginTop: 4,
  },
  historyItemStatus: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  historyPagination: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  paginationButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#234033',
    borderRadius: 6,
  },
  paginationButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
  paginationButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  paginationButtonTextDisabled: {
    color: '#999',
  },
  paginationInfo: {
    fontSize: 14,
    color: '#666',
  },
  exportSmallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#234033',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  exportSmallButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
});
