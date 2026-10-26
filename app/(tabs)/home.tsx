import { useAuthContext } from "@/components/AuthContext";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { getOptimizedReportImageUrl } from "@/config/cloudinary";
import { auth, db, storage } from "@/config/firebase";
import { Colors } from "@/constants/Colors";
import { useTheme } from "@/hooks/useTheme";
import { NotificationService } from "@/services/notificationService";
import { soundAlertService } from '@/services/soundAlertService';
import { setDriverSessionOrigin } from "@/services/driverQrService";
import DriverQrBadgeModal from "@/components/driver/DriverQrBadgeModal";
import EcoCarousel from "@/components/resident/EcoCarousel";
import { formatAdaptiveMassFromMetricTons, toMetricTons, WasteMeasurementUnit } from "@/utils/wasteUnits";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { residentNotificationService } from "@/services/residentNotificationService";
import { isCityWideAnnouncement, sortAnnouncementsWithCityWideFirst } from "./announcements";

export default function HomePage() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = Colors[theme ?? "light"];
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const [userProfile, setUserProfile] = useState<{
    displayName?: string;
    photoURL?: string;
  } | null>(null);
  const [announcements, setAnnouncements] = useState<
    {
      id: string;
      title: string;
      description: string;
      priority: string;
      category: string;
      createdAt: any;
      imageUrl?: string | null;
      likesCount?: number;
      author?: string;
      authorRole?: string;
      barangay?: string;
    }[]
  >([]);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<{
    id: string;
    title: string;
    description: string;
    priority: string;
    category: string;
    createdAt: any;
    imageUrl?: string | null;
    likesCount?: number;
    author?: string;
    authorRole?: string;
    barangay?: string;
  } | null>(null);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const knownAnnouncementIdsRef = useRef<Set<string>>(new Set());
  const isFirstAnnouncementSnapshotRef = useRef(true);
  const latestAnnouncementTimeRef = useRef<number>(Date.now());
  const announcementNotificationsEnabledRef = useRef(false);
  const [announcementNotificationsEnabled, setAnnouncementNotificationsEnabled] = useState(false);

  useEffect(() => {
    if (!user?.uid || !db) return;
    getDoc(doc(db, 'user_settings', user.uid)).then(snapshot => {
      const preferences = snapshot.data()?.notificationPreferences;
      const enabled = preferences?.pushEnabled !== false && preferences?.announcements !== false;
      setAnnouncementNotificationsEnabled(enabled);
      announcementNotificationsEnabledRef.current = enabled;
    }).catch(() => {
      setAnnouncementNotificationsEnabled(false);
      announcementNotificationsEnabledRef.current = false;
    });
  }, [user?.uid]);


  // Driver QR Badge Scanner State
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [QrScannerComponent, setQrScannerComponent] = useState<React.ComponentType<any> | null>(null);
  const [isLoadingQrScanner, setIsLoadingQrScanner] = useState(false);
  const [driverUserData, setDriverUserData] = useState<any>(null);
  const [showMyDriverBadge, setShowMyDriverBadge] = useState(false);

  const openDriverQrScanner = async () => {
    setIsLoadingQrScanner(true);
    try {
      const scannerModule = await import('@/components/driver/DriverQrScannerModal');
      setQrScannerComponent(() => scannerModule.default);
      setShowQrScanner(true);
    } catch (error) {
      console.error('Driver QR scanner could not load:', error);
      Alert.alert(
        'QR Scanner Unavailable',
        'Could not open camera scanner. Please grant camera permission or update the app.',
      );
    } finally {
      setIsLoadingQrScanner(false);
    }
  };

  // Gamification states
  const [userReports, setUserReports] = useState<any[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [earnedRewardTokens, setEarnedRewardTokens] = useState(0);
  const [redeemedRewardTokens, setRedeemedRewardTokens] = useState(0);
  const [trashCollectedTons, setTrashCollectedTons] = useState(0);
  const resolvedReportsCount = userReports.filter((r) => r.status === 'resolved' || r.status === 'completed').length;
  const totalPoints = Math.max(0, (resolvedReportsCount * 50) + earnedRewardTokens - redeemedRewardTokens);

  // Next Collection state
  const [userBarangay, setUserBarangay] = useState<string>('');
  const [nextCollection, setNextCollection] = useState<{
    dateLabel: string;
    timeText: string;
    wasteCategory: string;
  } | null>(null);

  // Driver role detection
  const [userRole, setUserRole] = useState<string | null>(null);
  const isDriver = (userRole || '').trim().toLowerCase() === 'driver';

  // Resolve storage path to public URL if needed
  const resolvePhotoURL = async (maybePath?: string) => {
    try {
      if (!maybePath) return undefined;
      const isHttp = /^https?:\/\//i.test(maybePath);
      const isDataOrLocal =
        /^(data:|file:|content:|asset(s)?:\/\/|blob:|expo-file:)/i.test(
          maybePath
        );
      if (isHttp || isDataOrLocal) return maybePath;
      if (!storage) return undefined;
      const r = ref(storage, maybePath);
      return await getDownloadURL(r);
    } catch (e) {
      // Failed to resolve home photo URL
      return undefined;
    }
  };

  // Request notification permissions on mount
  useEffect(() => {
    const requestPermissions = async () => {
      try {
        await NotificationService.requestPermissions();
      } catch (error) {
        // Error requesting notification permissions
      }
    };

    requestPermissions();
  }, []);

  // Fetch user's barangay, role, and profile from Firestore (single listener)
  useEffect(() => {
    if (!db || !user?.uid) return;
    const unsubUser = onSnapshot(doc(db, 'users', user.uid), async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUserBarangay(data.barangay || '');
        setUserRole(data.role || 'user');
        setDriverUserData(data);
        // Also update the profile display data from the same snapshot
        const photoSource = data.photoURL || user.photoURL || data.verificationImageUrl || undefined;
        const resolved = await resolvePhotoURL(photoSource);
        setUserProfile({
          displayName: data.displayName || user.displayName || 'User',
          photoURL: resolved,
        });
      } else {
        // Fallback to auth data if Firestore document doesn't exist
        const resolved = await resolvePhotoURL(user.photoURL || undefined);
        setUserProfile({
          displayName: user.displayName || 'User',
          photoURL: resolved,
        });
      }
    }, (err) => {
      if (err?.code !== 'permission-denied') {
        console.warn('Home: user profile listener error:', err);
      }
    });
    return () => unsubUser();
  }, [user]);

  // Compute next collection from barangay_schedules (one-time fetch with server-side filter)
  useEffect(() => {
    if (!db || !userBarangay) {
      setNextCollection(null);
      return;
    }

    let cancelled = false;
    const fetchSchedules = async () => {
      try {
        const cleanName = userBarangay.replace(/^(brgy\.?|barangay)\s*/i, '').trim();
        const candidateNames = Array.from(new Set([
          userBarangay,
          cleanName,
          `Brgy. ${cleanName}`,
          `Barangay ${cleanName}`,
          `Brgy ${cleanName}`,
        ]));

        const q = query(
          collection(db, 'barangay_schedules'),
          where('barangayName', 'in', candidateNames.slice(0, 10))
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const schedules: any[] = [];
        snap.forEach((d) => {
          schedules.push({ id: d.id, ...d.data() });
        });

        if (schedules.length === 0) {
          setNextCollection(null);
          return;
        }

        const DOW_MAP = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let closest: { date: Date; wasteCategory: string; timeText: string } | null = null;

        // Search the next 60 days for the closest scheduled collection
        for (let offset = 0; offset < 60; offset++) {
          const checkDate = new Date(today);
          checkDate.setDate(today.getDate() + offset);
          const dowStr = DOW_MAP[checkDate.getDay()];
          const key = `${checkDate.getFullYear()}-${(checkDate.getMonth() + 1).toString().padStart(2, '0')}-${checkDate.getDate().toString().padStart(2, '0')}`;

          for (const s of schedules) {
            let isMatch = s.days && s.days.includes(dowStr);
            let category = s.wasteCategory || 'BIODEGRADABLE';
            let time = (s.dayTimes && s.dayTimes[dowStr]) || s.time || s.timeText || s.collectionTime || '06:00 AM';

            const specificMatch = (s.specificSchedules || []).find((ss: any) => {
              if (!ss.date) return false;
              const monthNames = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
              const monthName = monthNames[checkDate.getMonth()];
              const shortMonthName = monthName.substring(0, 3);
              const monthDD = `${monthName} ${checkDate.getDate()}`;
              const shortMonthDD = `${shortMonthName} ${checkDate.getDate()}`;
              const mmdd = `${(checkDate.getMonth() + 1).toString().padStart(2, '0')}/${checkDate.getDate().toString().padStart(2, '0')}`;
              const dText = ss.date.trim().toLowerCase();
              return dText === mmdd.toLowerCase() ||
                dText === key.toLowerCase() ||
                dText === monthDD.toLowerCase() ||
                dText === shortMonthDD.toLowerCase();
            });

            if (specificMatch) {
              isMatch = true;
              category = specificMatch.category || category;
              time = specificMatch.time || time;
            }

            if (isMatch) {
              if (!closest) {
                closest = { date: checkDate, wasteCategory: category, timeText: time };
              }
              break;
            }
          }
          if (closest) break;
        }

        if (closest) {
          const c = closest as { date: Date; wasteCategory: string; timeText: string };
          const diffDays = Math.round((c.date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          let dateLabel = '';
          if (diffDays === 0) dateLabel = 'Today';
          else if (diffDays === 1) dateLabel = 'Tomorrow';
          else {
            dateLabel = c.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          }
          setNextCollection({ dateLabel, timeText: c.timeText, wasteCategory: c.wasteCategory });
        } else {
          setNextCollection(null);
        }
      } catch (error: any) {
        if (error?.code !== 'permission-denied') {
          console.warn('Home: barangay_schedules fetch error:', error);
        }
        setNextCollection(null);
      }
    };

    fetchSchedules();
    return () => { cancelled = true; };
  }, [userBarangay]);





  // Fetch announcements from Firestore
  useEffect(() => {
    if (!db) {
      setAnnouncementsLoading(false);
      return;
    }

    const announcementsRef = collection(db, "announcements");
    const q = query(announcementsRef, where("isPublished", "==", true));

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        const announcementsData = snapshot.docs.map((doc) => {
          const data = doc.data();
          const desc =
            data.description ||
            data.content ||
            data.message ||
            data.details ||
            data.body ||
            "";
          return {
            id: doc.id,
            title: data.title || "Announcement",
            description: desc,
            priority: data.priority || "Medium",
            category: data.category || "General",
            createdAt: data.createdAt,
            imageUrl: data.imageUrl || data.imageURL || null,
            likesCount: typeof data.likesCount === 'number' ? data.likesCount : (Array.isArray(data.likedBy) ? data.likedBy.length : 0),
            author: data.author || data.authorRole || data.postedBy || 'CENRO Danao City',
            barangay: data.barangay || '',
            targetScope: data.targetScope || 'all',
          };
        });

        // Filter announcements relevant to this resident:
        // 1. City-Wide announcements (targetScope === 'all' or !barangay or barangay === 'all')
        // 2. Announcements targeted to resident's specific barangay
        const normResident = userBarangay
          ? userBarangay.toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim()
          : '';

        const relevantAnnouncements = announcementsData.filter((a) => {
          const isCityWide = isCityWideAnnouncement(a);
          if (isCityWide) return true;
          if (!normResident) return false;
          const normA = (a.barangay || '').toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim();
          return normA === normResident;
        });

        // Sort by creation date (newest first)
        relevantAnnouncements.sort((a, b) => {
          const timeA = a.createdAt?.toDate
            ? a.createdAt.toDate().getTime()
            : new Date(a.createdAt || 0).getTime();
          const timeB = b.createdAt?.toDate
            ? b.createdAt.toDate().getTime()
            : new Date(b.createdAt || 0).getTime();
          return timeB - timeA;
        });

        // Check for genuinely new announcements and send notifications
        if (relevantAnnouncements.length > 0) {
          if (isFirstAnnouncementSnapshotRef.current) {
            // First snapshot on mount: seed known IDs so existing announcements are not notified
            isFirstAnnouncementSnapshotRef.current = false;
            snapshot.docs.forEach((d) => knownAnnouncementIdsRef.current.add(d.id));
            const newestTime = relevantAnnouncements[0].createdAt?.toDate
              ? relevantAnnouncements[0].createdAt.toDate().getTime()
              : new Date(relevantAnnouncements[0].createdAt || 0).getTime();
            latestAnnouncementTimeRef.current = Math.max(newestTime, Date.now());
          } else {
            // Subsequent snapshots: find genuinely newly created announcements (not an older announcement promoted by deletion)
            const genuinelyNewAnnouncements = relevantAnnouncements.filter((a) => {
              const isUnseen = !knownAnnouncementIdsRef.current.has(a.id);
              const aTime = a.createdAt?.toDate
                ? a.createdAt.toDate().getTime()
                : new Date(a.createdAt || 0).getTime();
              return isUnseen && aTime >= (latestAnnouncementTimeRef.current - 60000);
            });

            // Synchronously add all current and new IDs BEFORE scheduling to eliminate duplicate race conditions
            genuinelyNewAnnouncements.forEach((a) => knownAnnouncementIdsRef.current.add(a.id));
            snapshot.docs.forEach((d) => knownAnnouncementIdsRef.current.add(d.id));

            const newestTime = relevantAnnouncements[0].createdAt?.toDate
              ? relevantAnnouncements[0].createdAt.toDate().getTime()
              : new Date(relevantAnnouncements[0].createdAt || 0).getTime();
            latestAnnouncementTimeRef.current = Math.max(newestTime, latestAnnouncementTimeRef.current);

            // Schedule notification only for genuinely new announcements
            if (genuinelyNewAnnouncements.length > 0 && announcementNotificationsEnabledRef.current) {
              const newestOne = genuinelyNewAnnouncements[0];
              try {
                await NotificationService.scheduleAnnouncementNotification(newestOne);
                const p = (newestOne.priority || '').toLowerCase();
                const c = (newestOne.category || '').toLowerCase();
                if (p === 'urgent' || c.includes('emergency')) {
                  soundAlertService.playEmergencyAlertSiren().catch(() => {});
                }
              } catch {
                // Keep the announcement visible even when local scheduling fails.
              }
            }
          }
        }

        // Show latest 2 announcements on home tab (newest city-wide first, then newest barangay)
        const prioritizedAnnouncements = sortAnnouncementsWithCityWideFirst(relevantAnnouncements);
        setAnnouncements(prioritizedAnnouncements.slice(0, 2));
        setAnnouncementsLoading(false);
      },
      (error) => {
        console.warn("Home announcements snapshot warning:", error);
        setAnnouncementsLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [userBarangay]);

  // Fetch user reports in real-time to keep Recent Reports synchronized with My Reports
  useEffect(() => {
    const targetUid = user?.uid || auth.currentUser?.uid;
    if (!db || !targetUid) {
      setUserReports([]);
      setReportsLoading(false);
      return;
    }

    setReportsLoading(true);

    const q = query(
      collection(db, "reports"),
      where("userId", "==", targetUid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: any[] = [];
        snapshot.forEach((d) => {
          items.push({ id: d.id, ...d.data() });
        });

        items.sort((a, b) => {
          const getTime = (val: any) => {
            if (!val) return 0;
            if (typeof val?.toMillis === "function") return val.toMillis();
            if (typeof val?.toDate === "function") return val.toDate().getTime();
            if (typeof val === "number") return val;
            if (val?.seconds) return val.seconds * 1000;
            const parsed = new Date(val).getTime();
            return isNaN(parsed) ? 0 : parsed;
          };
          return getTime(b.createdAt) - getTime(a.createdAt);
        });

        setUserReports(items);
        setReportsLoading(false);
      },
      (error) => {
        if (error?.code !== "permission-denied") {
          console.warn("Home: user reports fetch error:", error);
        }
        setReportsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // Fetch points and measured pickup totals (one-time, deferred)
  useEffect(() => {
    if (!db || !user?.uid) return;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(async () => {
      try {
        const [awardsSnap, redemptionsSnap, schedulesSnap] = await Promise.all([
          getDocs(query(collection(db, 'reward_awards'), where('userId', '==', user.uid))),
          getDocs(query(collection(db, 'reward_redemptions'), where('userId', '==', user.uid))),
          getDocs(query(collection(db, 'schedules'), where('userId', '==', user.uid))),
        ]);
        if (cancelled) return;
        setEarnedRewardTokens(awardsSnap.docs.reduce((sum, item) => sum + Math.max(0, Number(item.data().tokens || 0)), 0));
        setRedeemedRewardTokens(redemptionsSnap.docs.reduce((sum, item) => sum + Math.max(0, Number(item.data().cost || 0)), 0));
        const measuredTons = schedulesSnap.docs.reduce((sum, item) => {
          const schedule = item.data();
          if (!['completed', 'done'].includes(String(schedule.status || '').toLowerCase())) return sum;
          const measurement = schedule.collectionMeasurement;
          const value = Number(measurement?.value || 0);
          const unit = String(measurement?.unit || '');
          if (!(value > 0) || !['kg', 'ton', 'm3'].includes(unit)) return sum;
          return sum + toMetricTons(value, unit as WasteMeasurementUnit);
        }, 0);
        setTrashCollectedTons(measuredTons);
      } catch (error: any) {
        if (error?.code !== 'permission-denied' && error?.code !== 'resource-exhausted') {
          console.warn('Home: gamification fetch error:', error);
        }
      }
    });
    return () => { cancelled = true; task.cancel(); };
  }, [user?.uid]);

  const handleLogout = () => {
    // Navigate back to splash screen (logout)
    router.replace("/splash");
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "Urgent":
        return "#EF4444";
      case "High":
        return "#F97316";
      case "Medium":
        return "#EAB308";
      case "Low":
        return "#22C55E";
      default:
        return "#6B7280";
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case "general":
        return "#22C55E"; // Green
      case "schedule":
        return "#3B82F6"; // Blue
      case "maintenance":
        return "#F59E0B"; // Orange
      case "policy update":
        return "#8B5CF6"; // Purple
      case "emergency":
        return "#EF4444"; // Red
      case "service":
        return "#06B6D4"; // Cyan
      case "weather":
        return "#84CC16"; // Lime
      case "holiday":
        return "#F97316"; // Orange
      default:
        return "#6B7280"; // Gray
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case "Urgent":
        return "alert-circle";
      case "High":
        return "warning";
      case "Medium":
        return "information-circle";
      case "Low":
        return "checkmark-circle";
      default:
        return "ellipse";
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case "general":
        return "megaphone.fill";
      case "schedule":
        return "calendar";
      case "maintenance":
        return "wrench.and.screwdriver.fill";
      case "policy update":
        return "doc.text.fill";
      case "emergency":
        return "exclamationmark.triangle.fill";
      case "service":
        return "gearshape.fill";
      case "weather":
        return "cloud.fill";
      case "holiday":
        return "gift.fill";
      default:
        return "info.circle.fill";
    }
  };

  const formatAnnouncementDate = (createdAt: any) => {
    if (!createdAt) return "";
    const dateObj = createdAt?.toDate ? createdAt.toDate() : new Date(createdAt);
    if (isNaN(dateObj.getTime())) return "";

    const now = new Date();
    const diffMs = now.getTime() - dateObj.getTime();
    if (diffMs < 0) {
      return dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    return dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: dateObj.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  const formatAnnouncementFullDate = (dateVal: any) => {
    if (!dateVal) return "Recent update";
    const d = dateVal?.toDate
      ? dateVal.toDate()
      : (dateVal?.seconds ? new Date(dateVal.seconds * 1000) : new Date(dateVal));
    if (isNaN(d.getTime())) return "Recent update";
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const getAnnouncementVisuals = (category?: string, priority?: string) => {
    const p = (priority || '').toLowerCase();
    const c = (category || '').toLowerCase();

    if (p === 'urgent' || c.includes('emergency')) {
      return {
        iconName: 'warning' as const,
        iconBg: '#FEE2E2',
        iconColor: '#DC2626',
        badgeBg: '#FEE2E2',
        badgeColor: '#DC2626',
      };
    }
    if (p === 'high') {
      return {
        iconName: 'priority-high' as const,
        iconBg: '#FEF3C7',
        iconColor: '#D97706',
        badgeBg: '#FEF3C7',
        badgeColor: '#D97706',
      };
    }
    if (c.includes('schedule')) {
      return {
        iconName: 'event-note' as const,
        iconBg: '#E0F2FE',
        iconColor: '#0284C7',
        badgeBg: '#E0F2FE',
        badgeColor: '#0284C7',
      };
    }
    if (c.includes('holiday')) {
      return {
        iconName: 'celebration' as const,
        iconBg: '#FCE4EC',
        iconColor: '#880E4F',
        badgeBg: '#FCE4EC',
        badgeColor: '#880E4F',
      };
    }
    if (c.includes('maintenance')) {
      return {
        iconName: 'build' as const,
        iconBg: '#F3E8FF',
        iconColor: '#7E22CE',
        badgeBg: '#F3E8FF',
        badgeColor: '#7E22CE',
      };
    }
    if (c.includes('service')) {
      return {
        iconName: 'local-shipping' as const,
        iconBg: '#E0F2FE',
        iconColor: '#1565C0',
        badgeBg: '#E0F2FE',
        badgeColor: '#1565C0',
      };
    }
    if (c.includes('compost') || c.includes('workshop') || c.includes('eco')) {
      return {
        iconName: 'eco' as const,
        iconBg: '#E8F5E9',
        iconColor: '#2E7D32',
        badgeBg: '#E8F5E9',
        badgeColor: '#2E7D32',
      };
    }
    return {
      iconName: 'campaign' as const,
      iconBg: '#C8E6C9',
      iconColor: '#2E7D32',
      badgeBg: '#E8F5E9',
      badgeColor: '#2E7D32',
    };
  };

  return (
    <View style={[styles.container, { backgroundColor: '#E8F5E9' }]}>
      {/* Header Section */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 10, 30) }]}>
        <View style={styles.profileSection}>
          <View style={[styles.profileIcon, { backgroundColor: '#C8E6C9' }]}>
            {userProfile?.photoURL ? (
              <Image
                source={{ uri: userProfile.photoURL }}
                style={styles.profileImage}
                resizeMode="cover"
              />
            ) : (
              <IconSymbol name="person.fill" size={24} color="#2E7D32" />
            )}
          </View>
          <Text style={[styles.greeting, { color: '#2E7D32' }]}>
            Welcome, {userProfile?.displayName?.split(" ")[0] || "User"}!
          </Text>
        </View>

        <View style={styles.headerActions}>
          {isDriver && (
            <TouchableOpacity
              style={styles.headerQrBtn}
              onPress={openDriverQrScanner}
              activeOpacity={0.8}
              accessibilityLabel="Scan Driver or Fleet QR Badge"
            >
              {isLoadingQrScanner ? (
                <ActivityIndicator size="small" color="#2E7D32" />
              ) : (
                <MaterialIcons name="qr-code-scanner" size={22} color="#2E7D32" />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => router.push("/settings")}>
            <IconSymbol name="gear" size={28} color="#78A578" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content */}
      <ScrollView 
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 10) }]}
        showsVerticalScrollIndicator={false}
      >


        {/* Eco Carousel Combining Next Collection, Eco Impact, and 2 Eco Tips */}
        <EcoCarousel
          totalPoints={totalPoints}
          trashCollectedTons={trashCollectedTons}
          userReportsCount={userReports.length}
          userBarangay={userBarangay}
          nextCollection={nextCollection}
        />

        {/* Community Updates */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitleSmall}>Community Updates</Text>
          <TouchableOpacity onPress={() => router.push('/announcements')}>
            <Text style={styles.viewAllText}>View All</Text>
          </TouchableOpacity>
        </View>
        
        {announcements.length > 0 ? (
          announcements.map((announcement) => {
            const visual = getAnnouncementVisuals(announcement.category, announcement.priority);
            const dateStr = formatAnnouncementDate(announcement.createdAt);
            const isHighPriority = announcement.priority === 'High' || announcement.priority === 'Urgent';

            return (
              <TouchableOpacity
                key={announcement.id}
                style={styles.updateCard}
                activeOpacity={0.75}
                onPress={() => {
                  setSelectedAnnouncement(announcement);
                  if (user?.uid) {
                    residentNotificationService.markAnnouncementAsSeen(announcement.id, user.uid);
                  }
                }}
              >
                <View style={[styles.updateIconBg, { backgroundColor: visual.iconBg }]}>
                  <MaterialIcons name={visual.iconName} size={22} color={visual.iconColor} />
                </View>
                <View style={styles.updateTextContent}>
                  <View style={styles.updateHeaderRow}>
                    <Text style={styles.updateTitle} numberOfLines={1}>
                      {announcement.title}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {residentNotificationService.isAnnouncementNew(announcement.id) && (
                        <View style={styles.homeNewBadge}>
                          <View style={styles.homeNewRedDot} />
                          <Text style={styles.homeNewBadgeText}>NEW</Text>
                        </View>
                      )}
                      {isHighPriority && (
                        <View style={[styles.updatePriorityBadge, { backgroundColor: visual.badgeBg }]}>
                          <Text style={[styles.updatePriorityText, { color: visual.badgeColor }]}>
                            {announcement.priority.toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Text style={styles.updateDesc} numberOfLines={2} ellipsizeMode="tail">
                    {announcement.description}
                  </Text>
                  <View style={styles.updateFooterRow}>
                    <View style={styles.updateMetaRow}>
                      {Boolean(announcement.category) && (
                        <View style={[styles.updateCategoryPill, { backgroundColor: visual.iconBg }]}>
                          <Text style={[styles.updateCategoryText, { color: visual.iconColor }]}>
                            {announcement.category}
                          </Text>
                        </View>
                      )}
                      {dateStr ? (
                        <Text style={styles.updateDateText}>{dateStr}</Text>
                      ) : null}
                    </View>
                    <View style={styles.moreDetailsRow}>
                      <Text style={styles.moreDetailsText}>More details</Text>
                      <MaterialIcons name="arrow-forward" size={14} color="#2E7D32" />
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        ) : announcementsLoading ? (
          <View style={styles.updateCard}>
            <View style={[styles.updateIconBg, { backgroundColor: '#E8F5E9' }]}>
              <MaterialIcons name="campaign" size={22} color="#81C784" />
            </View>
            <View style={styles.updateTextContent}>
              <Text style={styles.updateTitle}>Loading updates...</Text>
              <Text style={styles.updateDesc}>Fetching recent community announcements.</Text>
            </View>
          </View>
        ) : (
          <TouchableOpacity 
            style={styles.updateCard}
            activeOpacity={0.8}
            onPress={() => router.push('/announcements')}
          >
            <View style={[styles.updateIconBg, { backgroundColor: '#E8F5E9' }]}>
              <MaterialIcons name="campaign" size={22} color="#2E7D32" />
            </View>
            <View style={styles.updateTextContent}>
              <Text style={styles.updateTitle}>No Recent Announcements</Text>
              <Text style={styles.updateDesc}>Check back later for new municipal notices and schedules.</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Quick Actions */}
        <Text style={[styles.sectionTitleSmall, { marginTop: 10, textTransform: 'uppercase', color: '#78A578' }]}>Quick Actions</Text>
        
        <TouchableOpacity style={styles.quickActionCard} onPress={() => router.push('/report')}>
          <IconSymbol name="camera" size={20} color="#4A6741" />
          <Text style={styles.quickActionText}>Report a Pile</Text>
        </TouchableOpacity>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitleSmall}>Recent Reports</Text>
          <TouchableOpacity onPress={() => router.push('/my-reports')}>
            <Text style={styles.viewAllText}>View All</Text>
          </TouchableOpacity>
        </View>

        {reportsLoading ? (
          <View style={[styles.updateCard, { justifyContent: 'center', paddingVertical: 18 }]}>
            <ActivityIndicator size="small" color="#4A6741" />
          </View>
        ) : userReports.length > 0 ? (
          userReports.slice(0, 3).map((report, index) => {
            const reportDate = (() => {
              if (!report.createdAt) return 'Recently';
              if (typeof report.createdAt?.toDate === 'function') return report.createdAt.toDate().toLocaleDateString();
              if (report.createdAt?.seconds) return new Date(report.createdAt.seconds * 1000).toLocaleDateString();
              const d = new Date(report.createdAt);
              return isNaN(d.getTime()) ? 'Recently' : d.toLocaleDateString();
            })();

            const reportLocation = report.barangay || report.barangayName || report.street || '';
            const reportTitle = report.title || report.wasteType || report.aiAnalysis?.wasteType || 'Trash Report';
            const status = String(report.status || 'pending').toLowerCase();
            const statusLabel = status === 'in-progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1);
            const statusColor = status === 'resolved' || status === 'completed'
              ? '#1B5E20'
              : status === 'in-progress'
              ? '#1565C0'
              : status === 'acknowledged'
              ? '#E65100'
              : '#D97706';
            const statusBg = status === 'resolved' || status === 'completed'
              ? '#E8F5E9'
              : status === 'in-progress'
              ? '#E3F2FD'
              : status === 'acknowledged'
              ? '#FFF3E0'
              : '#FEF3C7';

            return (
              <TouchableOpacity 
                key={report.id || index} 
                style={styles.updateCard}
                onPress={() => router.push('/my-reports')}
                activeOpacity={0.7}
              >
                <View style={[styles.updateIconBg, { backgroundColor: '#E8F5E9', overflow: 'hidden' }]}>
                  {report.imageURL ? (
                    <Image 
                      source={{ uri: getOptimizedReportImageUrl(report.imageURL) || report.imageURL }} 
                      style={{ width: 48, height: 48 }} 
                      resizeMode="cover"
                    />
                  ) : (
                    <IconSymbol name="camera.fill" size={20} color="#234033" />
                  )}
                </View>
                <View style={styles.updateTextContent}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <Text style={styles.updateTitle} numberOfLines={1}>{reportTitle}</Text>
                    <View style={{ backgroundColor: statusBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: statusColor }}>{statusLabel}</Text>
                    </View>
                  </View>
                  <Text style={styles.updateDesc} numberOfLines={1}>
                    {reportDate}{reportLocation ? ` • ${reportLocation}` : ''}
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color="#7C8E80" />
              </TouchableOpacity>
            );
          })
        ) : (
          <TouchableOpacity style={styles.updateCard} onPress={() => router.push('/my-reports')}>
            <View style={styles.updateTextContent}>
              <Text style={styles.updateDesc}>No reports submitted yet.</Text>
            </View>
          </TouchableOpacity>
        )}
        
        <TouchableOpacity style={styles.quickActionCard} onPress={() => router.push('/rewards' as any)}>
          <IconSymbol name="gift" size={20} color="#4A6741" />
          <Text style={styles.quickActionText}>Redeem Points</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* Announcement Details Modal */}
      <Modal
        visible={!!selectedAnnouncement}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedAnnouncement(null)}
      >
        <View style={styles.announcementModalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSelectedAnnouncement(null)}
          />
          <View style={styles.detailsModalContent}>
            {selectedAnnouncement && (() => {
              const visual = getAnnouncementVisuals(selectedAnnouncement.category, selectedAnnouncement.priority);
              const hasImage = !!selectedAnnouncement.imageUrl;
              const fullText = selectedAnnouncement.description || 'No additional details provided.';

              return (
                <>
                  {/* Fixed Header */}
                  <View style={styles.detailsModalHeader}>
                    <View style={styles.detailsModalHeaderBadges}>
                      <View style={[styles.priorityPill, { backgroundColor: visual.badgeBg }]}>
                        <MaterialIcons name={visual.iconName} size={14} color={visual.badgeColor} />
                        <Text style={[styles.priorityPillText, { color: visual.badgeColor }]}>
                          {(selectedAnnouncement.priority || 'Normal').toUpperCase()}
                        </Text>
                      </View>
                      {Boolean(selectedAnnouncement.category) && (
                        <View style={[styles.detailsModalCategoryBadge, { backgroundColor: visual.iconBg }]}>
                          <Text style={[styles.detailsModalCategoryText, { color: visual.iconColor }]}>
                            {selectedAnnouncement.category}
                          </Text>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => setSelectedAnnouncement(null)}
                      style={styles.announcementCloseButton}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                      <IconSymbol name="xmark" size={18} color="#6B7280" />
                    </TouchableOpacity>
                  </View>

                  {/* Scrollable Content */}
                  <ScrollView
                    style={styles.detailsModalScroll}
                    contentContainerStyle={styles.detailsModalScrollContent}
                    showsVerticalScrollIndicator={true}
                    bounces={true}
                  >
                    <Text style={styles.detailsModalTitle}>{selectedAnnouncement.title}</Text>

                    {/* Metadata Card */}
                    <View style={styles.detailsMetaCard}>
                      <View style={styles.detailsMetaItem}>
                        <MaterialIcons name="schedule" size={16} color="#64748B" />
                        <Text style={styles.detailsMetaText}>
                          {formatAnnouncementFullDate(selectedAnnouncement.createdAt)}
                        </Text>
                      </View>
                      <View style={styles.detailsMetaItem}>
                        <MaterialIcons name="account-balance" size={16} color="#64748B" />
                        <Text style={styles.detailsMetaText}>
                          Issued by: {selectedAnnouncement.author || selectedAnnouncement.authorRole || 'CENRO Danao City'}
                        </Text>
                      </View>
                      {selectedAnnouncement.barangay ? (
                        <View style={styles.detailsMetaItem}>
                          <MaterialIcons name="place" size={16} color="#64748B" />
                          <Text style={styles.detailsMetaText}>
                            Area: Barangay {selectedAnnouncement.barangay}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Image if present */}
                    {hasImage && selectedAnnouncement.imageUrl ? (
                      <Image
                        source={{ uri: selectedAnnouncement.imageUrl }}
                        style={styles.detailsModalImage}
                        resizeMode="cover"
                      />
                    ) : null}

                    {/* Full Description */}
                    <Text style={styles.detailsModalDescription}>{fullText}</Text>
                  </ScrollView>

                  {/* Actions Row */}
                  <View style={styles.detailsModalActionsRow}>
                    <TouchableOpacity
                      style={styles.detailsModalCloseButton}
                      onPress={() => setSelectedAnnouncement(null)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.detailsModalCloseButtonText}>Close</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.detailsModalViewAllButton}
                      onPress={() => {
                        const id = selectedAnnouncement.id;
                        setSelectedAnnouncement(null);
                        router.push(`/(tabs)/announcements?id=${encodeURIComponent(id)}`);
                      }}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="campaign" size={18} color="#FFFFFF" />
                      <Text style={styles.detailsModalViewAllButtonText}>Open in Announce</Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Driver QR Scanner Modal */}
      {QrScannerComponent && (
        <QrScannerComponent
          visible={showQrScanner}
          source="resident"
          currentUser={user}
          onClose={() => setShowQrScanner(false)}
          onDriverAuthenticated={async (driverProfile: any) => {
            setShowQrScanner(false);
            await setDriverSessionOrigin('resident');
            if (driverProfile?.shiftAction === 'time_out') {
              Alert.alert(
                'Shift Ended (Time-Out Recorded)',
                `Truck ${driverProfile.currentTruckPlate || 'vehicle'} has been released.\n\nTotal Shift Duration: ${driverProfile.durationFormatted || 'Recorded'}\nTime In: ${driverProfile.timeInFormatted || 'N/A'}\nTime Out: ${driverProfile.timeOutFormatted || 'N/A'}`,
                [{ text: 'OK' }]
              );
            } else if (driverProfile?.currentTruckId || driverProfile?.currentTruckPlate) {
              Alert.alert(
                'Driver Verified • On Duty',
                `Shift active on truck ${driverProfile?.currentTruckPlate || 'vehicle'}! Opening Driver Portal...`,
                [
                  {
                    text: 'Proceed to Cockpit',
                    onPress: () => router.replace('/(driver)'),
                  },
                ]
              );
              setTimeout(() => {
                router.replace('/(driver)');
              }, 300);
            } else {
              Alert.alert(
                'Driver Verified • Read-Only Mode',
                'No truck is currently assigned to your account in CENRO Fleet Inventory. Opening Driver Portal in read-only mode.',
                [
                  {
                    text: 'Open Driver Portal',
                    onPress: () => router.replace('/(driver)'),
                  },
                ]
              );
              setTimeout(() => {
                router.replace('/(driver)');
              }, 300);
            }
          }}
        />
      )}

      {/* Driver Personal QR Badge Modal */}
      {isDriver && (
        <DriverQrBadgeModal
          visible={showMyDriverBadge}
          onClose={() => setShowMyDriverBadge(false)}
          driverData={{
            ...driverUserData,
            uid: user?.uid,
            name: userProfile?.displayName || user?.displayName || 'CENRO Driver',
            email: user?.email || '',
            employeeId: driverUserData?.employeeId || 'CENRO-DRV',
            assignedBarangay: driverUserData?.assignedBarangay || userBarangay || 'Danao City',
            truck: driverUserData?.currentTruckPlate || driverUserData?.plateNumber || 'Pending Assignment',
            plateNumber: driverUserData?.currentTruckPlate || driverUserData?.plateNumber || 'Pending Assignment',
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  driverQuickBanner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  driverBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  driverBannerIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  driverBannerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#14532D',
  },
  driverRoleTag: {
    backgroundColor: '#16A34A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  driverRoleTagText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  driverBannerSubtitle: {
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 16,
    marginTop: 2,
  },
  driverBannerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  driverEnterCockpitBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#15803D',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  driverEnterCockpitText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  driverScanTruckBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#F0FDF4',
    borderWidth: 1.2,
    borderColor: '#86EFAC',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  driverScanTruckText: {
    color: '#15803D',
    fontSize: 12,
    fontWeight: '700',
  },
  driverViewBadgeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  driverViewBadgeText: {
    color: '#374151',
    fontSize: 11,
    fontWeight: '700',
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: 30,
  },
  profileSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  profileIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  profileImage: {
    width: "100%",
    height: "100%",
  },
  greeting: {
    fontSize: 20,
    fontWeight: "800",
  },
  residentModePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  greenLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
  },
  residentModeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
    letterSpacing: 0.4,
  },
  driverSwitchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1E3A8A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  driverSwitchText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerQrBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  homeNewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    gap: 3,
  },
  homeNewRedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  homeNewBadgeText: {
    color: '#DC2626',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  sectionTitleSmall: {
    fontSize: 16,
    fontWeight: "700",
    color: "#2E7D32",
    marginBottom: 4,
  },
  ecoImpactContainer: {
    marginBottom: 8,
  },
  ecoImpactCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  pointsBadge: {
    backgroundColor: '#C8E6C9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  pointsLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: '#2E7D32',
    letterSpacing: 1,
  },
  pointsValue: {
    fontSize: 28,
    fontWeight: "900",
    color: '#1B5E20',
  },
  levelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  levelText: {
    fontSize: 13,
    color: '#4A6741',
    fontWeight: '500',
  },
  levelPercent: {
    fontSize: 12,
    color: '#2E7D32',
    fontWeight: '700',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#F5F5F5',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#2E7D32',
    borderRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1B5E20',
  },
  statLabel: {
    fontSize: 12,
    color: '#4A6741',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: '100%',
    backgroundColor: '#E0E0E0',
  },
  nextCollectionCard: {
    backgroundColor: '#4A6741',
    borderRadius: 16,
    padding: 20,
    marginBottom: 8,
  },
  nextCollectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  nextCollectionTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '700',
  },
  nextCollectionDate: {
    color: '#E8F5E9',
    fontSize: 14,
  },
  nextCollectionTime: {
    color: 'white',
    fontSize: 26,
    fontWeight: '800',
    marginTop: 4,
  },
  nextCollectionDivider: {
    height: 1,
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    textAlign: "center",
    overflow: "hidden",
  },
  announcementTitle: {
    fontSize: 16,
    fontWeight: "bold",
  },
  announcementSubtitle: {
    fontSize: 14,
  },
  announcementDate: {
    fontSize: 12,
    marginTop: 2,
  },
  announcementRight: {
    alignItems: "flex-end",
    justifyContent: "center",
    flexShrink: 0,
    minWidth: 100,
  },
  nextPickupLabel: {
    fontSize: 12,
  },
  nextPickupDate: {
    fontSize: 18,
    fontWeight: "bold",
  },
  viewMoreButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    gap: 6,
  },
  viewMoreText: {
    fontSize: 14,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
  // Community Updates Styles
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  viewAllText: {
    color: '#2E7D32',
    fontSize: 14,
    fontWeight: '600',
  },
  updateCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  updateIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateTextContent: {
    flex: 1,
  },
  updateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 4,
  },
  updateTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#234033',
    flex: 1,
  },
  updatePriorityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  updatePriorityText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  updateDesc: {
    fontSize: 13,
    color: '#4B5F4F',
    lineHeight: 18,
    marginBottom: 6,
  },
  updateMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  updateFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  moreDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E8F5E9',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  moreDetailsText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2E7D32',
  },
  updateCategoryPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  updateCategoryText: {
    fontSize: 11,
    fontWeight: '700',
  },
  updateDateText: {
    fontSize: 11,
    color: '#78909C',
    fontWeight: '500',
  },
  announcementModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailsModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    width: '92%',
    maxWidth: 500,
    maxHeight: '84%',
    minHeight: 280,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  detailsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  detailsModalHeaderBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    flex: 1,
  },
  priorityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  priorityPillText: {
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.4,
  },
  detailsModalCategoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  detailsModalCategoryText: {
    fontSize: 11,
    fontWeight: '700',
  },
  announcementCloseButton: {
    padding: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    marginLeft: 8,
  },
  detailsModalScroll: {
    flexShrink: 1,
    minHeight: 140,
  },
  detailsModalScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  detailsModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 10,
    lineHeight: 26,
  },
  detailsMetaCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    marginVertical: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  detailsMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailsMetaText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
  detailsModalImage: {
    width: '100%',
    height: 190,
    borderRadius: 14,
    marginVertical: 12,
  },
  detailsModalDescription: {
    fontSize: 15,
    color: '#1F2937',
    lineHeight: 24,
    marginVertical: 8,
  },
  detailsModalActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  detailsModalCloseButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsModalCloseButtonText: {
    color: '#4B5563',
    fontSize: 15,
    fontWeight: '600',
  },
  detailsModalViewAllButton: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2E7D32',
    paddingVertical: 12,
    borderRadius: 14,
  },
  detailsModalViewAllButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Quick Actions Styles
  quickActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  quickActionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#234033',
  },
  
  // Next Collection Footer
  nextCollectionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  nextCollectionFooterText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },

  // Notification Detail Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  notificationDetailContainer: {
    width: "100%",
    height: "60%",
    maxWidth: 500,
    maxHeight: "90%",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  notificationDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  notificationDetailTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  closeButton: {
    padding: 8,
  },
  headerSpacer: {
    width: 40,
  },
  notificationDetailContent: {
    flex: 1,
    padding: 20,
  },
  notificationDetailCard: {
    gap: 20,
  },
  notificationTypeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  notificationTypeText: {
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  notificationDetailTitleText: {
    fontSize: 24,
    fontWeight: "bold",
    lineHeight: 32,
  },
  notificationDetailBody: {
    fontSize: 18,
    lineHeight: 28,
    marginTop: 8,
  },
  notificationDetailMeta: {
    padding: 16,
    borderRadius: 8,
    gap: 12,
    marginTop: 8,
  },
  notificationMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  notificationMetaText: {
    fontSize: 14,
  },
  notificationDetailActions: {
    padding: 20,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
  },
  notificationActionButton: {
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    flex: 1,
  },
  notificationActionText: {
    fontSize: 14,
    fontWeight: "600",
  },
  notificationTypeIndicator: {
    marginTop: 2,
    textAlign: "center",
    maxWidth: 60,
  },

  // Driver Section Styles
  driverCard: {
    borderRadius: 16,
    overflow: "hidden",
    marginTop: 8,
    marginBottom: 4,
    elevation: 6,
    shadowColor: "#1B5E20",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  driverGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 16,
  },
  driverIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  driverTextContainer: {
    flex: 1,
  },
  driverTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  driverSubtitle: {
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
    marginTop: 2,
    fontWeight: "500",
  },
  driverSectionContainer: {
    marginTop: 8,
    marginBottom: 6,
  },
  driverActionButtonsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  driverStartShiftBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2E7D32",
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
    elevation: 2,
    shadowColor: "#1B5E20",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  driverStartShiftBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  driverViewDataBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8F5E9",
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: "#C8E6C9",
  },
  driverViewDataBtnText: {
    color: "#2E7D32",
    fontWeight: "700",
    fontSize: 14,
  },


});
