import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
  Modal,
} from 'react-native';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  limit,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { DANAO_CITY_BARANGAYS } from '@/constants/danaoBarangays';

interface Announcement {
  id: string;
  title: string;
  category: string;
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  description: string;
  isPublished: boolean;
  createdAt: any;
  targetScope?: 'all' | 'barangay';
  barangay?: string;
  postedByRole?: string;
  postedByBarangay?: string;
  author?: string;
}

export const ANNOUNCEMENT_CATEGORIES = [
  { label: 'General', icon: 'info', color: '#475569', desc: 'General community bulletins & notices' },
  { label: 'Emergency', icon: 'warning', color: '#DC2626', desc: 'Severe weather, hazards & emergency stops' },
  { label: 'Maintenance', icon: 'build', color: '#D97706', desc: 'Truck repairs & facility downtime' },
  { label: 'Schedule Change', icon: 'event', color: '#2563EB', desc: 'Route time or collection day adjustments' },
  { label: 'Service Update', icon: 'campaign', color: '#059669', desc: 'New barangay routes & guidelines' },
  { label: 'Holiday Notice', icon: 'celebration', color: '#7C3AED', desc: 'Public holidays & adjusted schedules' },
  { label: 'Policy Update', icon: 'policy', color: '#0F766E', desc: 'Waste segregation & city ordinances' },
];

const normalizeBrgy = (str?: string) => {
  if (!str) return '';
  return str.toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim();
};

interface AnnouncementsTabProps {
  userRole?: string;
  assignedBarangay?: string;
  isReadOnly?: boolean;
}

const isDateInMonth = (dateVal: any, monthYearStr: string): boolean => {
  if (!dateVal) return false;
  let d: Date | null = null;
  if (dateVal.toDate && typeof dateVal.toDate === 'function') {
    d = dateVal.toDate();
  } else if (dateVal._seconds) {
    d = new Date(dateVal._seconds * 1000);
  } else if (dateVal.seconds) {
    d = new Date(dateVal.seconds * 1000);
  } else if (typeof dateVal === 'string' || typeof dateVal === 'number') {
    d = new Date(dateVal);
  }
  if (!d || isNaN(d.getTime())) return false;

  const parts = (monthYearStr || '').trim().split(/\s+/);
  const monthName = parts[0];
  const yearStr = parts[1];
  if (!monthName) return true;

  const targetYear = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const targetMonthIndex = monthNames.indexOf(monthName.toLowerCase());
  if (targetMonthIndex === -1) return true;

  return d.getMonth() === targetMonthIndex && d.getFullYear() === targetYear;
};

export default function AnnouncementsTab({
  userRole = 'admin',
  assignedBarangay = '',
  isReadOnly = false,
}: AnnouncementsTabProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const rawBarangay = (assignedBarangay || '').trim();
  const isCityScope = !rawBarangay || /^(city|all|danao\s*city)$/i.test(rawBarangay);
  const isCoordinator =
    (userRole === 'coordinator' ||
     userRole === 'barangay_coordinator' ||
     userRole === 'cenro_coordinator') &&
    !isCityScope;
  const effectiveCoordinatorBarangay = isCoordinator ? rawBarangay : '';

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('General');
  const [priority, setPriority] = useState<'Low' | 'Medium' | 'High' | 'Urgent'>('Medium');
  const [description, setDescription] = useState('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false);

  // Target Scope State
  // For CENRO: 'all' (City-Wide) vs 'barangay' (Specific)
  // For Coordinator: permanently locked to their assigned barangay
  const [targetScope, setTargetScope] = useState<'all' | 'barangay'>(isCoordinator ? 'barangay' : 'all');
  const [selectedTargetBarangay, setSelectedTargetBarangay] = useState<string>(
    isCoordinator && effectiveCoordinatorBarangay ? effectiveCoordinatorBarangay : DANAO_CITY_BARANGAYS[0]
  );
  const [showTargetBarangayModal, setShowTargetBarangayModal] = useState(false);
  const [targetBarangaySearch, setTargetBarangaySearch] = useState('');

  // Table Filter & Search
  const [tableFilter, setTableFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  // Barangay filter for CENRO: 'all' | 'citywide' | specific barangay
  const [barangayFilter, setBarangayFilter] = useState<'all' | 'citywide' | string>('all');
  const [showBarangayFilterModal, setShowBarangayFilterModal] = useState(false);
  const [barangayFilterSearch, setBarangayFilterSearch] = useState('');

  // EnviroHero Proclamation Modal State (Manuscript Section 8)
  const [showEnviroHeroModal, setShowEnviroHeroModal] = useState(false);
  const [heroName, setHeroName] = useState('');
  const [heroBarangay, setHeroBarangay] = useState('Suba');
  const [heroMonth, setHeroMonth] = useState('October 2026');
  const [heroTokens, setHeroTokens] = useState('0');
  const [heroPickups, setHeroPickups] = useState('0');
  const [heroCitation, setHeroCitation] = useState('');
  const [isSavingHero, setIsSavingHero] = useState(false);

  // Registered Citizen Accounts for EnviroHero Dropdown
  const [residentUsers, setResidentUsers] = useState<any[]>([]);
  const [awards, setAwards] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [selectedResidentId, setSelectedResidentId] = useState<string>('');
  const [showResidentDropdown, setShowResidentDropdown] = useState(false);
  const [residentSearchQuery, setResidentSearchQuery] = useState('');

  const handleSaveEnviroHero = async () => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Proclaiming EnviroHero is restricted in Read-Only Mode.');
      return;
    }
    if (!heroName.trim()) {
      Alert.alert('Validation Error', 'Please select a resident account from the list.');
      return;
    }
    setIsSavingHero(true);
    try {
      const heroRef = doc(db, 'public_data', 'envirohero_monthly');
      const existingHero = await getDoc(heroRef);
      const existingHeroData = existingHero.exists() ? existingHero.data() : null;
      const sameMonth = existingHeroData?.month?.trim?.() === heroMonth.trim();
      await setDoc(heroRef, {
        name: heroName.trim(),
        barangay: heroBarangay.trim(),
        month: heroMonth.trim(),
        tokens: Number(heroTokens) || 1000,
        pickups: Number(heroPickups) || 30,
        citation: heroCitation.trim(),
        cheersCount: sameMonth ? Number(existingHeroData?.cheersCount ?? 0) : 0,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      // Automatically post official proclamation bulletin
      const stopsCount = Number(heroPickups) || 0;
      const stopsUnit = stopsCount === 1 ? 'stop' : 'stops';
      const cleanCitation = heroCitation.trim().replace(/^["“”']+|["“”']+$/g, '');

      await setDoc(doc(collection(db, 'announcements')), {
        title: `🌟 Official Proclamation: EnviroHero of the Month (${heroMonth.trim()})`,
        category: 'Policy Update',
        priority: 'High',
        description: `The City Environment and Natural Resources Office (CENRO) and Office of the City Mayor proudly honor ${heroName.trim()} of Barangay ${heroBarangay.trim()} as the official EnviroHero of the Month!\n\nAchievement: ${Number(heroTokens || 0).toLocaleString()} Eco-Tokens earned across ${stopsCount} verified clean ${stopsUnit}.\n\nCitation: "${cleanCitation}"`,
        isPublished: true,
        targetScope: 'all',
        barangay: 'all',
        author: 'CENRO Executive Office',
        postedByRole: 'cenro',
        isEnviroHero: true,
        isPinned: true,
        createdAt: serverTimestamp(),
      });

      Alert.alert('EnviroHero Proclaimed', `Successfully updated the monthly EnviroHero spotlight and published a city-wide announcement bulletin.`);
      setShowEnviroHeroModal(false);
    } catch (err: any) {
      console.error('Error saving EnviroHero:', err);
      Alert.alert('Error', err?.message || 'Could not proclaim EnviroHero.');
    } finally {
      setIsSavingHero(false);
    }
  };

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list: Announcement[] = [];
      snap.forEach((d) => {
        const itemData = d.data();
        // Exclude system overrides (which are strictly for driver/in-cab alerts)
        const isSystemOverride =
          !itemData.isPublished &&
          (itemData.title?.includes('Fleet Collection Force-Paused') ||
            itemData.title?.includes('OPERATIONS RESUMED') ||
            itemData.title?.includes('SEVERE WEATHER') ||
            itemData.title?.includes('Severe Weather Protocol') ||
            itemData.title?.includes('Backup Fleet') ||
            itemData.title?.includes('Overload Surge Priority'));

        if (!isSystemOverride) {
          list.push({ id: d.id, ...itemData } as Announcement);
        }
      });
      setAnnouncements(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Fetch registered citizen accounts from Firestore for EnviroHero auto-fill
  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        const users: any[] = [];
        snap.forEach((d) => {
          users.push({ id: d.id, ...d.data() });
        });
        users.sort((a, b) => {
          const nameA = a.displayName || a.name || a.email || '';
          const nameB = b.displayName || b.name || b.email || '';
          return nameA.localeCompare(nameB);
        });
        setResidentUsers(users);
      },
      (err) => console.warn('AnnouncementsTab: could not load users for EnviroHero:', err)
    );
    return () => unsub();
  }, []);

  // Fetch real-time reward awards to calculate total points earned in the month
  useEffect(() => {
    if (!db) return;
    const unsubAwards = onSnapshot(
      query(collection(db, 'reward_awards'), limit(500)),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setAwards(items);
      },
      (err) => console.warn('AnnouncementsTab: could not load awards for EnviroHero:', err)
    );
    return () => unsubAwards();
  }, []);

  // Fetch real-time reports to calculate actual verified clean pickup stops in the month
  useEffect(() => {
    if (!db) return;
    const unsubReports = onSnapshot(
      query(collection(db, 'reports'), limit(500)),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setReports(items);
      },
      (err) => console.warn('AnnouncementsTab: could not load reports for EnviroHero:', err)
    );
    return () => unsubReports();
  }, []);

  // Calculate total points earned and clean reports specifically for the selected month
  const getResidentMonthMetrics = useCallback(
    (u: any, monthStr: string) => {
      const email = (u.email || '').toLowerCase().trim();
      const uName = (u.displayName || u.name || `${u.firstName || ''} ${u.lastName || ''}`).toLowerCase().trim();

      // 1. Total tokens earned from awards during this month
      const userMonthAwards = awards.filter((a) => {
        const matchesUser =
          (a.userId && a.userId === u.id) ||
          (a.recipientUid && a.recipientUid === u.id) ||
          (email && a.recipientEmail && a.recipientEmail.toLowerCase() === email) ||
          (uName && a.recipientName && a.recipientName.toLowerCase() === uName);

        if (!matchesUser) return false;
        return isDateInMonth(a.awardedAt || a.timestamp || a.createdAt, monthStr);
      });

      const awardTokensThisMonth = userMonthAwards.reduce(
        (sum, a) => sum + (Number(a.tokens) || 0),
        0
      );

      // 2. Verified resolved clean reports in this month
      const userMonthReports = reports.filter((r) => {
        const matchesUser =
          (r.userId && r.userId === u.id) ||
          (r.reportedByUid && r.reportedByUid === u.id) ||
          (email && r.userEmail && r.userEmail.toLowerCase() === email);

        if (!matchesUser) return false;

        const isResolved = ['resolved', 'completed', 'cleaned', 'done'].includes(
          String(r.status || '').toLowerCase()
        );
        if (!isResolved) return false;

        return isDateInMonth(r.resolvedAt || r.createdAt, monthStr);
      });

      const reportPointsThisMonth = userMonthReports.reduce(
        (sum, r) => sum + (Number(r.rewardPoints) || 50),
        0
      );

      const totalEarnedThisMonth = awardTokensThisMonth + reportPointsThisMonth;
      const cleanStopsThisMonth = userMonthReports.length;

      // Fallback: if user has tokens directly recorded on profile created/updated in that month
      const storedLifetime = Math.max(
        Number(u.points || 0),
        Number(u.tokens || 0),
        Number(u.rewardTokens || 0)
      );

      const effectiveEarned =
        totalEarnedThisMonth > 0
          ? totalEarnedThisMonth
          : userMonthAwards.length === 0 && isDateInMonth(u.createdAt || u.updatedAt, monthStr)
          ? storedLifetime
          : totalEarnedThisMonth;

      return {
        totalEarned: effectiveEarned,
        cleanStops: cleanStopsThisMonth,
      };
    },
    [awards, reports]
  );

  const filteredResidentUsers = useMemo(() => {
    // Exclude admin / cenro / cicto staff accounts
    const isStaffAccount = (u: any) => {
      const r = (u.role || '').toLowerCase();
      const d = (u.displayName || u.name || '').toLowerCase();
      const em = (u.email || '').toLowerCase();
      const desig = (u.designation || '').toLowerCase();
      return (
        r === 'admin' ||
        r === 'cenro' ||
        r === 'cicto' ||
        r === 'coordinator' ||
        r === 'driver' ||
        desig.includes('admin') ||
        desig.includes('coordinator') ||
        d.includes('administrator') ||
        d.includes('admin') ||
        d.includes('coordinator') ||
        em.includes('admin') ||
        em.includes('+cenro') ||
        em.includes('+cicto') ||
        em.includes('+driver') ||
        em.includes('+coor')
      );
    };

    let list = residentUsers.filter((u) => !isStaffAccount(u));

    if (isCoordinator && effectiveCoordinatorBarangay) {
      const coordBrgy = effectiveCoordinatorBarangay.trim().toLowerCase();
      list = list.filter((u) => {
        const uBrgy = (u.barangay || '').trim().toLowerCase();
        return uBrgy === coordBrgy || uBrgy.includes(coordBrgy) || coordBrgy.includes(uBrgy);
      });
    }

    if (residentSearchQuery.trim()) {
      const q = residentSearchQuery.toLowerCase().trim();
      list = list.filter((u) => {
        const name = (u.displayName || u.name || `${u.firstName || ''} ${u.lastName || ''}`).toLowerCase();
        const email = (u.email || '').toLowerCase();
        const barangay = (u.barangay || '').toLowerCase();
        return name.includes(q) || email.includes(q) || barangay.includes(q);
      });
    }

    // Sort by TOTAL POINTS EARNED FOR THIS MONTH DESCENDING (Top points on top first!)
    list.sort((a, b) => {
      const ptsA = getResidentMonthMetrics(a, heroMonth).totalEarned;
      const ptsB = getResidentMonthMetrics(b, heroMonth).totalEarned;
      if (ptsB !== ptsA) return ptsB - ptsA;

      const stopsA = getResidentMonthMetrics(a, heroMonth).cleanStops;
      const stopsB = getResidentMonthMetrics(b, heroMonth).cleanStops;
      if (stopsB !== stopsA) return stopsB - stopsA;

      const nameA = a.displayName || a.name || a.email || '';
      const nameB = b.displayName || b.name || b.email || '';
      return nameA.localeCompare(nameB);
    });

    return list;
  }, [residentUsers, isCoordinator, effectiveCoordinatorBarangay, residentSearchQuery, heroMonth, getResidentMonthMetrics]);

  const handleSelectResident = useCallback(
    (res: any, monthStr = heroMonth) => {
      setSelectedResidentId(res.id);
      const resolvedName =
        res.displayName ||
        res.name ||
        `${res.firstName || ''} ${res.lastName || ''}`.trim() ||
        res.email?.split('@')[0] ||
        'Resident';
      setHeroName(resolvedName);

      if (res.barangay) {
        const matched = DANAO_CITY_BARANGAYS.find(
          (b) => normalizeBrgy(b) === normalizeBrgy(res.barangay)
        );
        setHeroBarangay(matched || res.barangay);
      }

      const metrics = getResidentMonthMetrics(res, monthStr);
      setHeroTokens(String(metrics.totalEarned));
      setHeroPickups(String(metrics.cleanStops));

      const bName = res.barangay || heroBarangay || 'Danao City';
      const stopsCount = metrics.cleanStops;
      const stopsUnit = stopsCount === 1 ? 'stop' : 'stops';
      setHeroCitation(
        `Exemplary waste segregation discipline, leading ${monthStr} with ${metrics.totalEarned.toLocaleString()} total eco-tokens earned and ${stopsCount} verified clean pickup ${stopsUnit} in Brgy. ${bName}.`
      );

      setShowResidentDropdown(false);
      setResidentSearchQuery('');
    },
    [heroMonth, heroBarangay, getResidentMonthMetrics]
  );

  // Re-evaluate citation and metrics if heroMonth is edited
  useEffect(() => {
    if (selectedResidentId && residentUsers.length > 0) {
      const selected = residentUsers.find((u) => u.id === selectedResidentId);
      if (selected) {
        handleSelectResident(selected, heroMonth);
      }
    }
  }, [heroMonth, getResidentMonthMetrics]);

  const handleOpenHeroModal = () => {
    // Auto-select the top #1 points earner for this month
    if (filteredResidentUsers.length > 0) {
      handleSelectResident(filteredResidentUsers[0]);
    }
    setShowEnviroHeroModal(true);
  };

  const handlePublish = async () => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Publishing announcements is restricted in Read-Only Mode.');
      return;
    }
    if (!title.trim() || !description.trim()) {
      Alert.alert('Validation Error', 'Title and Description are required.');
      return;
    }

    const effectiveScope = isCoordinator ? 'barangay' : targetScope;
    const effectiveBarangay = isCoordinator
      ? effectiveCoordinatorBarangay
      : (targetScope === 'barangay' ? selectedTargetBarangay : 'all');

    if (effectiveScope === 'barangay' && !effectiveBarangay) {
      Alert.alert('Validation Error', 'Please select a target barangay.');
      return;
    }

    setIsSubmitting(true);
    try {
      const newDocRef = doc(collection(db, 'announcements'));
      await setDoc(newDocRef, {
        title: title.trim(),
        category,
        priority,
        description: description.trim(),
        isPublished: true,
        targetScope: effectiveScope,
        barangay: effectiveBarangay,
        postedByRole: isCoordinator ? 'coordinator' : 'cenro',
        postedByBarangay: isCoordinator ? effectiveCoordinatorBarangay : '',
        author: isCoordinator
          ? `Brgy. ${effectiveCoordinatorBarangay} Coordinator`
          : 'CENRO Danao City',
        createdAt: serverTimestamp(),
      });

      const scopeMsg = effectiveScope === 'all'
        ? 'published city-wide across all barangays'
        : `published to Brgy. ${effectiveBarangay}`;
      Alert.alert('Success', `Announcement ${scopeMsg} successfully.`);

      setTitle('');
      setCategory('General');
      setPriority('Medium');
      setDescription('');
      if (!isCoordinator) {
        setTargetScope('all');
      }
      setShowCategoryDropdown(false);
      setShowPriorityDropdown(false);
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to publish announcement.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const executeDelete = async (id: string) => {
    setIsDeleting(true);
    setDeleteErrorMessage(null);
    try {
      await deleteDoc(doc(db, 'announcements', id));
      setShowDeleteConfirm(false);
      setSelectedAnnouncement(null);
    } catch (e: any) {
      console.error('Failed to delete announcement:', e);
      setDeleteErrorMessage(e?.message || 'Failed to delete announcement.');
    } finally {
      setIsDeleting(false);
    }
  };

  const getPriorityColor = (p: string) => {
    switch (p) {
      case 'Urgent':
        return { bg: '#FEE2E2', text: '#DC2626' };
      case 'High':
        return { bg: '#FEF3C7', text: '#D97706' };
      case 'Medium':
        return { bg: '#E0F2FE', text: '#0284C7' };
      case 'Low':
        return { bg: '#F3F4F6', text: '#4B5563' };
      default:
        return { bg: '#F3F4F6', text: '#4B5563' };
    }
  };

  const getCategoryConfig = (catLabel: string) => {
    return (
      ANNOUNCEMENT_CATEGORIES.find((c) => c.label.toLowerCase() === (catLabel || '').toLowerCase()) || {
        label: catLabel || 'General',
        icon: 'info',
        color: '#475569',
        desc: '',
      }
    );
  };

  // Compute stats for CENRO filter modal
  const cityWideCount = announcements.filter(
    (a) => !a.barangay || a.targetScope === 'all' || a.barangay.toLowerCase() === 'all' || a.barangay.trim() === ''
  ).length;

  const barangayCounts: Record<string, number> = {};
  announcements.forEach((a) => {
    const b = a.barangay;
    if (b && b.toLowerCase() !== 'all' && a.targetScope !== 'all' && b.trim() !== '') {
      const matched = DANAO_CITY_BARANGAYS.find((dbName) => normalizeBrgy(dbName) === normalizeBrgy(b));
      const key = matched || b;
      barangayCounts[key] = (barangayCounts[key] || 0) + 1;
    }
  });

  // Filtered list based on category, search, and barangay scoping
  const filteredAnnouncements = announcements.filter((item) => {
    // 1. Category Filter
    const matchesCategory = tableFilter === 'All' || item.category === tableFilter;

    // 2. Text Search
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      q === '' ||
      item.title?.toLowerCase().includes(q) ||
      (item.description || (item as any).content || '').toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q) ||
      (item.barangay && item.barangay.toLowerCase().includes(q)) ||
      (item.author && item.author.toLowerCase().includes(q));

    // 3. Barangay Scope Filtering
    const isCityWide =
      !item.barangay ||
      item.targetScope === 'all' ||
      item.barangay.toLowerCase() === 'all' ||
      item.barangay.trim() === '';

    let matchesBarangay = true;
    if (isCoordinator && effectiveCoordinatorBarangay) {
      // Coordinator view: ONLY announcements for their barangay + City-Wide announcements
      const isMyBarangay = normalizeBrgy(item.barangay) === normalizeBrgy(effectiveCoordinatorBarangay);
      matchesBarangay = isCityWide || isMyBarangay;
    } else {
      // CENRO view:
      if (barangayFilter === 'all') {
        matchesBarangay = true;
      } else if (barangayFilter === 'citywide') {
        matchesBarangay = isCityWide;
      } else {
        matchesBarangay = normalizeBrgy(item.barangay) === normalizeBrgy(barangayFilter);
      }
    }

    return matchesCategory && matchesSearch && matchesBarangay;
  });

  const selectedCategoryConfig = getCategoryConfig(category);

  // Target barangay modal search list
  const filteredTargetBarangayList = DANAO_CITY_BARANGAYS.filter((b) =>
    b.toLowerCase().includes(targetBarangaySearch.trim().toLowerCase())
  );

  // Filter modal search list
  const filteredFilterBarangayList = DANAO_CITY_BARANGAYS.filter((b) =>
    b.toLowerCase().includes(barangayFilterSearch.trim().toLowerCase())
  );

  return (
    <ScrollView style={[styles.container, isMobile && { padding: 16 }]} showsVerticalScrollIndicator={false}>
      <Text style={styles.headerSubtitle}>COMMUNICATIONS & CITIZEN BROADCASTS</Text>
      <Text style={styles.headerTitle}>
        {isCoordinator && effectiveCoordinatorBarangay
          ? `Brgy. ${effectiveCoordinatorBarangay} Announcement Creator`
          : 'Announcement Creator'}
      </Text>

      {/* Creator Card */}
      {!isReadOnly ? (
        <View style={[styles.card, isMobile && { padding: 16 }]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <MaterialIcons name="campaign" size={22} color="#2E8B57" style={styles.cardIcon} />
            <Text style={styles.cardTitle}>
              {isCoordinator && effectiveCoordinatorBarangay
                ? `New Brgy. ${effectiveCoordinatorBarangay} Announcement`
                : 'New Municipal Announcement'}
            </Text>
          </View>
          {!isCoordinator && (
            <TouchableOpacity
              style={styles.heroProclaimBtn}
              onPress={handleOpenHeroModal}
              activeOpacity={0.8}
            >
              <MaterialIcons name="emoji-events" size={16} color="#B45309" />
              <Text style={styles.heroProclaimBtnText}>Proclaim EnviroHero</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Coordinator Locked Jurisdiction Banner */}
        {Boolean(isCoordinator && effectiveCoordinatorBarangay) && (
          <View style={styles.coordinatorLockedBanner}>
            <MaterialIcons name="verified-user" size={20} color="#065F46" />
            <View style={{ flex: 1 }}>
              <Text style={styles.coordinatorLockedTitle}>
                Barangay Coordinator Jurisdiction: Brgy. {effectiveCoordinatorBarangay}
              </Text>
              <Text style={styles.coordinatorLockedSubtitle}>
                This announcement will strictly broadcast to residents and drivers registered in Brgy. {effectiveCoordinatorBarangay}.
              </Text>
            </View>
          </View>
        )}

        <View style={[styles.formGrid, isMobile && { flexDirection: 'column' }]}>
          {/* Title */}
          <View style={[styles.formGroup, { width: '100%' }]}>
            <Text style={styles.label}>
              ANNOUNCEMENT TITLE <Text style={styles.requiredAsterisk}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder={
                isCoordinator && effectiveCoordinatorBarangay
                  ? `e.g. Brgy. ${effectiveCoordinatorBarangay} Weekend Waste Collection Notice`
                  : 'e.g. Danao City Holiday Collection Schedule'
              }
              placeholderTextColor="#94A3B8"
              value={title}
              onChangeText={setTitle}
            />
          </View>

          {/* Broadcast Audience Selector for CENRO */}
          {!isCoordinator && (
            <View style={[styles.formGroup, { width: '100%', marginBottom: 8 }]}>
              <Text style={styles.label}>
                BROADCAST AUDIENCE / JURISDICTION <Text style={styles.requiredAsterisk}>*</Text>
              </Text>
              <View style={[styles.scopeSelectorRow, isMobile && { flexDirection: 'column' }]}>
                {/* Option 1: City-Wide */}
                <TouchableOpacity
                  style={[
                    styles.scopeOptionCard,
                    targetScope === 'all' && styles.scopeOptionCardActive,
                  ]}
                  onPress={() => setTargetScope('all')}
                  activeOpacity={0.8}
                >
                  <View style={[styles.scopeRadio, targetScope === 'all' && styles.scopeRadioActive]}>
                    {targetScope === 'all' && <View style={styles.scopeRadioInner} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="public" size={17} color={targetScope === 'all' ? '#1B4D3E' : '#64748B'} />
                      <Text style={[styles.scopeOptionTitle, targetScope === 'all' && styles.scopeOptionTitleActive]}>
                        City-Wide Broadcast (All Barangays)
                      </Text>
                    </View>
                    <Text style={styles.scopeOptionDesc}>
                      Alerts all 42 barangays and all registered residents across Danao City.
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Option 2: Specific Barangay */}
                <TouchableOpacity
                  style={[
                    styles.scopeOptionCard,
                    targetScope === 'barangay' && styles.scopeOptionCardActive,
                  ]}
                  onPress={() => setTargetScope('barangay')}
                  activeOpacity={0.8}
                >
                  <View style={[styles.scopeRadio, targetScope === 'barangay' && styles.scopeRadioActive]}>
                    {targetScope === 'barangay' && <View style={styles.scopeRadioInner} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="holiday-village" size={17} color={targetScope === 'barangay' ? '#1B4D3E' : '#64748B'} />
                      <Text style={[styles.scopeOptionTitle, targetScope === 'barangay' && styles.scopeOptionTitleActive]}>
                        Specific Barangay
                      </Text>
                    </View>
                    <Text style={styles.scopeOptionDesc}>
                      Target a single barangay for localized advisories or specific collection alerts.
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* Target Barangay Picker for Specific mode */}
              {targetScope === 'barangay' && (
                <View style={styles.targetBarangayPickerWrap}>
                  <Text style={[styles.label, { marginTop: 10 }]}>
                    TARGET BARANGAY <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <TouchableOpacity
                    style={styles.targetBarangayBtn}
                    onPress={() => {
                      setTargetBarangaySearch('');
                      setShowTargetBarangayModal(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="place" size={18} color="#059669" />
                    <Text style={styles.targetBarangayBtnText}>
                      Brgy. {selectedTargetBarangay}
                    </Text>
                    <MaterialIcons name="arrow-drop-down" size={20} color="#059669" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Category Dropdown */}
          <View style={[styles.formGroup, isMobile && { width: '100%' }, { zIndex: 30 }]}>
            <Text style={styles.label}>
              CATEGORY <Text style={styles.requiredAsterisk}>*</Text>
            </Text>
            <View style={{ position: 'relative' }}>
              <TouchableOpacity
                style={[styles.dropdown, showCategoryDropdown && styles.dropdownOpen]}
                onPress={() => {
                  setShowCategoryDropdown(!showCategoryDropdown);
                  setShowPriorityDropdown(false);
                }}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={[styles.catIconBox, { backgroundColor: `${selectedCategoryConfig.color}15` }]}>
                    <MaterialIcons name={selectedCategoryConfig.icon as any} size={18} color={selectedCategoryConfig.color} />
                  </View>
                  <Text style={styles.dropdownText}>{category}</Text>
                </View>
                <MaterialIcons
                  name={showCategoryDropdown ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={20}
                  color="#6B7280"
                />
              </TouchableOpacity>

              {showCategoryDropdown && (
                <View style={styles.dropdownMenuScroll}>
                  <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={true} nestedScrollEnabled={true}>
                    {ANNOUNCEMENT_CATEGORIES.map((c) => {
                      const isSelected = category === c.label;
                      return (
                        <TouchableOpacity
                          key={c.label}
                          style={[styles.categoryDropdownItem, isSelected && styles.categoryDropdownItemSelected]}
                          onPress={() => {
                            setCategory(c.label);
                            setShowCategoryDropdown(false);
                          }}
                          activeOpacity={0.7}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                            <View style={[styles.catIconBox, { backgroundColor: `${c.color}15` }]}>
                              <MaterialIcons name={c.icon as any} size={16} color={c.color} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.categoryItemLabel,
                                  isSelected && { color: '#1B4D3E', fontWeight: '800' },
                                ]}
                              >
                                {c.label}
                              </Text>
                              <Text style={styles.categoryItemDesc} numberOfLines={1}>
                                {c.desc}
                              </Text>
                            </View>
                          </View>
                          {isSelected && <MaterialIcons name="check" size={18} color="#1B4D3E" />}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>

          {/* Priority Dropdown */}
          <View style={[styles.formGroup, isMobile && { width: '100%' }, { zIndex: 20 }]}>
            <Text style={styles.label}>
              PRIORITY LEVEL <Text style={styles.requiredAsterisk}>*</Text>
            </Text>
            <View style={{ position: 'relative' }}>
              <TouchableOpacity
                style={[styles.dropdown, showPriorityDropdown && styles.dropdownOpen]}
                onPress={() => {
                  setShowPriorityDropdown(!showPriorityDropdown);
                  setShowCategoryDropdown(false);
                }}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View
                    style={[
                      styles.priorityDot,
                      { backgroundColor: getPriorityColor(priority).text },
                    ]}
                  />
                  <Text style={[styles.dropdownText, { color: getPriorityColor(priority).text, fontWeight: '700' }]}>
                    {priority}
                  </Text>
                </View>
                <MaterialIcons
                  name={showPriorityDropdown ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={20}
                  color="#6B7280"
                />
              </TouchableOpacity>

              {showPriorityDropdown && (
                <View style={styles.dropdownMenu}>
                  {(['Low', 'Medium', 'High', 'Urgent'] as const).map((p) => {
                    const isSelected = priority === p;
                    const pColor = getPriorityColor(p);
                    return (
                      <TouchableOpacity
                        key={p}
                        style={[styles.priorityDropdownItem, isSelected && styles.categoryDropdownItemSelected]}
                        onPress={() => {
                          setPriority(p);
                          setShowPriorityDropdown(false);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={[styles.priorityDot, { backgroundColor: pColor.text }]} />
                          <Text style={[styles.dropdownItemText, { color: pColor.text, fontWeight: isSelected ? '800' : '600' }]}>
                            {p}
                          </Text>
                        </View>
                        {isSelected && <MaterialIcons name="check" size={18} color={pColor.text} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          </View>

          {/* Content */}
          <View style={[styles.formGroup, { width: '100%', zIndex: 1 }]}>
            <Text style={styles.label}>
              MESSAGE CONTENT <Text style={styles.requiredAsterisk}>*</Text>
            </Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Type the full announcement message here..."
              placeholderTextColor="#94A3B8"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.primaryBtn, isMobile && { width: '100%', justifyContent: 'center' }]}
            onPress={handlePublish}
            disabled={isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="send" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>
                  {isCoordinator ? `Publish to Brgy. ${effectiveCoordinatorBarangay}` : 'Publish Announcement'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
      ) : (
        <View style={[styles.card, isMobile && { padding: 16 }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <MaterialIcons name="visibility" size={20} color="#D97706" style={styles.cardIcon} />
              <Text style={[styles.cardTitle, { color: '#92400E' }]}>Read-Only Bulletin Mode</Text>
            </View>
          </View>
          <Text style={{ fontSize: 13, color: '#78350F', marginTop: 4 }}>
            You have view-only access to municipal and barangay announcements. Creating new bulletins and proclaiming EnviroHeroes are restricted by CICTO.
          </Text>
        </View>
      )}

      {/* History Table Card */}
      <View style={[styles.card, isMobile && { padding: 14 }, { zIndex: 1 }]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <MaterialIcons name="history" size={20} color="#1B4D3E" />
            <Text style={styles.cardTitle}>Published Announcements</Text>
          </View>
          <Text style={styles.cardCountBadge}>{filteredAnnouncements.length} Total</Text>
        </View>

        {/* Coordinator Jurisdiction indicator */}
        {Boolean(isCoordinator && effectiveCoordinatorBarangay) && (
          <View style={styles.coordinatorTableNote}>
            <MaterialIcons name="filter-list" size={16} color="#065F46" />
            <Text style={styles.coordinatorTableNoteText}>
              Filtered to announcements for Brgy. {effectiveCoordinatorBarangay} and city-wide municipal broadcasts.
            </Text>
          </View>
        )}

        {/* CENRO Barangay Filter Card */}
        {!isCoordinator && (
          <View style={styles.barangayFilterCard}>
            <View style={styles.barangayFilterLeft}>
              <MaterialIcons name="filter-list" size={18} color="#059669" />
              <Text style={styles.barangayFilterTitle}>FILTER BY JURISDICTION</Text>
            </View>
            <TouchableOpacity
              style={styles.barangayFilterBtn}
              onPress={() => {
                setBarangayFilterSearch('');
                setShowBarangayFilterModal(true);
              }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="place" size={16} color="#059669" />
              <Text style={styles.barangayFilterBtnText}>
                {barangayFilter === 'all'
                  ? 'All Jurisdictions (City-Wide & 42 Barangays)'
                  : barangayFilter === 'citywide'
                  ? '🌐 City-Wide Broadcasts Only'
                  : `📍 Brgy. ${barangayFilter}`}
              </Text>
              <MaterialIcons name="arrow-drop-down" size={20} color="#059669" />
            </TouchableOpacity>
          </View>
        )}

        {/* Search & Category Filters Row */}
        <View style={styles.tableControlsRow}>
          <View style={[styles.tableSearchContainer, isMobile && { width: '100%' }]}>
            <MaterialIcons name="search" size={18} color="#94A3B8" />
            <TextInput
              style={styles.tableSearchInput}
              placeholder="Search by title, content, or barangay..."
              placeholderTextColor="#94A3B8"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <MaterialIcons name="close" size={16} color="#94A3B8" />
              </TouchableOpacity>
            ) : null}
          </View>

          <ScrollView
            horizontal={true}
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.filterPillsRow}
          >
            {['All', ...ANNOUNCEMENT_CATEGORIES.map((c) => c.label)].map((cat) => {
              const isActive = tableFilter === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.filterPill, isActive && styles.filterPillActive]}
                  onPress={() => setTableFilter(cat)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterPillText, isActive && styles.filterPillTextActive]}>{cat}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Table Content */}
        <ScrollView
          horizontal={isMobile}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, minWidth: '100%' }}
          style={{ width: '100%' }}
        >
          <View style={{ minWidth: isMobile ? 780 : '100%', width: '100%' }}>
            <View style={styles.tableHead}>
              <Text style={[styles.th, { flex: 2 }]}>TITLE</Text>
              <Text style={[styles.th, { flex: 1.3 }]}>JURISDICTION</Text>
              <Text style={[styles.th, { flex: 1.1 }]}>CATEGORY</Text>
              <Text style={[styles.th, { flex: 0.8 }]}>PRIORITY</Text>
              <Text style={[styles.th, { flex: 1.3 }]}>DATE</Text>
              <Text style={[styles.th, { flex: 0.7, textAlign: 'right' }]}>ACTION</Text>
            </View>

            {loading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#2E8B57" />
              </View>
            ) : filteredAnnouncements.length === 0 ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <MaterialIcons name="campaign" size={36} color="#CBD5E1" />
                <Text style={{ color: '#64748B', marginTop: 8, fontWeight: '600', fontSize: 13 }}>
                  No announcements found matching filter.
                </Text>
              </View>
            ) : (
              filteredAnnouncements.map((row) => {
                const pColor = getPriorityColor(row.priority);
                const catCfg = getCategoryConfig(row.category);
                const dateStr = row.createdAt?.toDate
                  ? row.createdAt.toDate().toLocaleString()
                  : 'Just now';
                const isCityWide =
                  !row.barangay ||
                  row.targetScope === 'all' ||
                  row.barangay.toLowerCase() === 'all' ||
                  row.barangay.trim() === '';

                return (
                  <TouchableOpacity
                    key={row.id}
                    style={styles.tableRow}
                    onPress={() => {
                      setSelectedAnnouncement(row);
                      setShowDeleteConfirm(false);
                      setDeleteErrorMessage(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 2 }}>
                      <Text style={styles.rowTitle}>{row.title}</Text>
                      <Text style={styles.rowDesc} numberOfLines={1}>
                        {row.description || (row as any).content || ''}
                      </Text>
                    </View>
                    <View style={{ flex: 1.3, flexDirection: 'row', alignItems: 'center' }}>
                      {isCityWide ? (
                        <View style={styles.scopeBadgeCityWide}>
                          <MaterialIcons name="public" size={12} color="#0284C7" />
                          <Text style={styles.scopeBadgeCityWideText}>City-Wide</Text>
                        </View>
                      ) : (
                        <View style={styles.scopeBadgeBarangay}>
                          <MaterialIcons name="place" size={12} color="#059669" />
                          <Text style={styles.scopeBadgeBarangayText} numberOfLines={1}>
                            Brgy. {row.barangay}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={{ flex: 1.1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={[styles.catBadge, { backgroundColor: `${catCfg.color}15`, borderColor: `${catCfg.color}30` }]}>
                        <MaterialIcons name={catCfg.icon as any} size={12} color={catCfg.color} />
                        <Text style={[styles.catBadgeText, { color: catCfg.color }]}>{row.category || 'General'}</Text>
                      </View>
                    </View>
                    <View style={{ flex: 0.8 }}>
                      <View style={[styles.badge, { backgroundColor: pColor.bg }]}>
                        <Text style={[styles.badgeText, { color: pColor.text }]}>{row.priority}</Text>
                      </View>
                    </View>
                    <Text style={[styles.td, { flex: 1.3, color: '#64748B', fontSize: 12 }]}>{dateStr}</Text>
                    <View style={{ flex: 0.7, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedAnnouncement(row);
                          setShowDeleteConfirm(false);
                          setDeleteErrorMessage(null);
                        }}
                        style={styles.actionIconBtn}
                        activeOpacity={0.7}
                        accessibilityLabel="View announcement"
                      >
                        <MaterialIcons name="visibility" size={18} color="#0D9488" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </ScrollView>
      </View>

      {/* View & Delete Announcement Modal */}
      <Modal
        visible={!!selectedAnnouncement}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          if (!isDeleting) {
            if (showDeleteConfirm) {
              setShowDeleteConfirm(false);
              setDeleteErrorMessage(null);
            } else {
              setSelectedAnnouncement(null);
            }
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          {selectedAnnouncement && (
            showDeleteConfirm ? (
              <View style={styles.confirmModalCard}>
                <View style={styles.confirmHeaderIcon}>
                  <MaterialIcons name="delete-forever" size={30} color="#DC2626" />
                </View>

                <Text style={styles.confirmTitle}>Delete Announcement?</Text>
                <Text style={styles.confirmSub}>
                  Are you sure you want to permanently remove this announcement? This action will immediately unpublish it from all citizen mobile feeds.
                </Text>

                <View style={styles.confirmPreviewBox}>
                  <Text style={styles.confirmPreviewTitle} numberOfLines={2}>
                    {selectedAnnouncement.title}
                  </Text>
                  <View style={styles.confirmPreviewMeta}>
                    <Text style={styles.confirmPreviewMetaText}>
                      Category: {selectedAnnouncement.category || 'General'}  •  {selectedAnnouncement.priority} Priority
                    </Text>
                  </View>
                </View>

                {deleteErrorMessage ? (
                  <View style={styles.confirmErrorBanner}>
                    <MaterialIcons name="error-outline" size={16} color="#DC2626" />
                    <Text style={styles.confirmErrorText}>{deleteErrorMessage}</Text>
                  </View>
                ) : null}

                <View style={styles.confirmActionsRow}>
                  <TouchableOpacity
                    style={styles.confirmCancelBtn}
                    onPress={() => {
                      setShowDeleteConfirm(false);
                      setDeleteErrorMessage(null);
                    }}
                    disabled={isDeleting}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.confirmCancelText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.confirmDeleteBtn}
                    onPress={() => executeDelete(selectedAnnouncement.id)}
                    disabled={isDeleting}
                    activeOpacity={0.7}
                  >
                    {isDeleting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <MaterialIcons name="delete" size={18} color="#FFFFFF" />
                        <Text style={styles.confirmDeleteText}>Yes, Delete</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={[styles.modalCard, isMobile && styles.modalCardMobile]}>
                {(() => {
                  const pColor = getPriorityColor(selectedAnnouncement.priority);
                  const catCfg = getCategoryConfig(selectedAnnouncement.category);
                  const dateStr = selectedAnnouncement.createdAt?.toDate
                    ? selectedAnnouncement.createdAt.toDate().toLocaleString()
                    : 'Just now';
                  const isCityWide =
                    !selectedAnnouncement.barangay ||
                    selectedAnnouncement.targetScope === 'all' ||
                    selectedAnnouncement.barangay.toLowerCase() === 'all' ||
                    selectedAnnouncement.barangay.trim() === '';
                  const canDelete =
                    !isReadOnly &&
                    (!isCoordinator ||
                      (effectiveCoordinatorBarangay &&
                        normalizeBrgy(selectedAnnouncement.barangay) === normalizeBrgy(effectiveCoordinatorBarangay)));

                  return (
                    <>
                      {/* Modal Header */}
                      <View style={styles.modalHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                          <View style={[styles.catBadge, { backgroundColor: `${catCfg.color}15`, borderColor: `${catCfg.color}30` }]}>
                            <MaterialIcons name={catCfg.icon as any} size={14} color={catCfg.color} />
                            <Text style={[styles.catBadgeText, { color: catCfg.color, fontSize: 12 }]}>
                              {selectedAnnouncement.category || 'General'}
                            </Text>
                          </View>
                          <View style={[styles.badge, { backgroundColor: pColor.bg }]}>
                            <Text style={[styles.badgeText, { color: pColor.text }]}>{selectedAnnouncement.priority}</Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          onPress={() => setSelectedAnnouncement(null)}
                          style={styles.modalCloseBtn}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons name="close" size={22} color="#64748B" />
                        </TouchableOpacity>
                      </View>

                      {/* Modal Body */}
                      <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={true}>
                        <Text style={styles.modalTitle}>{selectedAnnouncement.title}</Text>
                        <View style={styles.modalDateRow}>
                          <MaterialIcons name="schedule" size={14} color="#94A3B8" />
                          <Text style={styles.modalDateText}>Published: {dateStr}</Text>
                        </View>

                        {/* Metadata Box: Jurisdiction & Author */}
                        <View style={styles.modalMetaBox}>
                          <View style={styles.modalMetaItem}>
                            <Text style={styles.modalMetaLabel}>TARGET JURISDICTION</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                              {isCityWide ? (
                                <View style={styles.scopeBadgeCityWide}>
                                  <MaterialIcons name="public" size={13} color="#0284C7" />
                                  <Text style={styles.scopeBadgeCityWideText}>City-Wide Broadcast (All Barangays)</Text>
                                </View>
                              ) : (
                                <View style={styles.scopeBadgeBarangay}>
                                  <MaterialIcons name="place" size={13} color="#059669" />
                                  <Text style={styles.scopeBadgeBarangayText}>Brgy. {selectedAnnouncement.barangay} Only</Text>
                                </View>
                              )}
                            </View>
                          </View>
                          <View style={styles.modalMetaItem}>
                            <Text style={styles.modalMetaLabel}>AUTHOR / POSTED BY</Text>
                            <Text style={styles.modalMetaValue}>
                              {selectedAnnouncement.author ||
                                (selectedAnnouncement.postedByRole === 'coordinator'
                                  ? `Brgy. ${selectedAnnouncement.postedByBarangay || selectedAnnouncement.barangay} Coordinator`
                                  : 'CENRO Officer')}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.modalDivider} />

                        <Text style={styles.modalSectionLabel}>ANNOUNCEMENT CONTENT</Text>
                        <Text style={styles.modalDescription}>
                          {selectedAnnouncement.description || (selectedAnnouncement as any).content || ''}
                        </Text>
                      </ScrollView>

                      {/* Modal Footer with Delete & Close */}
                      <View style={styles.modalFooter}>
                        {canDelete ? (
                          <TouchableOpacity
                            style={styles.modalDeleteBtn}
                            onPress={() => setShowDeleteConfirm(true)}
                            disabled={isDeleting}
                            activeOpacity={0.7}
                          >
                            <MaterialIcons name="delete-outline" size={18} color="#DC2626" />
                            <Text style={styles.modalDeleteText}>Delete Announcement</Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.modalCenroBroadcastNote}>
                            <MaterialIcons name="info-outline" size={15} color="#0284C7" />
                            <Text style={styles.modalCenroBroadcastNoteText}>City-Wide Municipal Broadcast</Text>
                          </View>
                        )}

                        <TouchableOpacity
                          style={styles.modalCloseFooterBtn}
                          onPress={() => setSelectedAnnouncement(null)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.modalCloseFooterText}>Close</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  );
                })()}
              </View>
            )
          )}
        </View>
      </Modal>

      {/* Target Barangay Modal (for CENRO during announcement creation) */}
      <Modal
        visible={showTargetBarangayModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowTargetBarangayModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 500, maxHeight: 520 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="place" size={20} color="#059669" />
                <Text style={styles.modalCardTitle}>Select Target Barangay</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowTargetBarangayModal(false)}
                style={styles.modalCloseBtn}
                activeOpacity={0.7}
              >
                <MaterialIcons name="close" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalSearchContainer}>
              <MaterialIcons name="search" size={18} color="#6B7280" />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search Danao City barangay..."
                placeholderTextColor="#9CA3AF"
                value={targetBarangaySearch}
                onChangeText={setTargetBarangaySearch}
              />
              {targetBarangaySearch ? (
                <TouchableOpacity onPress={() => setTargetBarangaySearch('')}>
                  <MaterialIcons name="close" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              ) : null}
            </View>

            <ScrollView style={{ paddingHorizontal: 16, maxHeight: 360 }} showsVerticalScrollIndicator={true}>
              {filteredTargetBarangayList.map((b) => {
                const isSelected = selectedTargetBarangay === b;
                return (
                  <TouchableOpacity
                    key={b}
                    style={[styles.modalPickerRow, isSelected && styles.modalPickerRowActive]}
                    onPress={() => {
                      setSelectedTargetBarangay(b);
                      setShowTargetBarangayModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <MaterialIcons
                        name="holiday-village"
                        size={18}
                        color={isSelected ? '#059669' : '#6B7280'}
                      />
                      <Text style={[styles.modalPickerRowText, isSelected && styles.modalPickerRowTextActive]}>
                        Brgy. {b}
                      </Text>
                    </View>
                    {isSelected && <MaterialIcons name="check" size={18} color="#059669" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* EnviroHero Proclamation Modal (Manuscript Section 8 Requirement) */}
      <Modal
        visible={showEnviroHeroModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowEnviroHeroModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 520, maxHeight: 620 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="emoji-events" size={22} color="#D97706" />
                <Text style={styles.modalCardTitle}>Proclaim EnviroHero of the Month</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowEnviroHeroModal(false)}
                style={styles.modalCloseBtn}
                activeOpacity={0.7}
              >
                <MaterialIcons name="close" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ paddingHorizontal: 18, maxHeight: 520 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>PROCLAMATION MONTH *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. October 2026"
                placeholderTextColor="#9CA3AF"
                value={heroMonth}
                onChangeText={setHeroMonth}
              />

              {/* SELECT EXISTING RESIDENT ACCOUNT DROPDOWN */}
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={styles.label}>SELECT REGISTERED RESIDENT ACCOUNT</Text>
                  {selectedResidentId ? (
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedResidentId('');
                        setHeroName('');
                        setHeroBarangay('');
                        setHeroTokens('0');
                        setHeroPickups('0');
                        setHeroCitation('');
                      }}
                    >
                      <Text style={{ fontSize: 11, color: '#D97706', fontWeight: '700' }}>Clear Account Link</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <TouchableOpacity
                  style={[
                    styles.input,
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: selectedResidentId ? '#FEF3C7' : '#F8FAFC',
                      borderColor: selectedResidentId ? '#F59E0B' : '#CBD5E1',
                    },
                  ]}
                  onPress={() => setShowResidentDropdown(!showResidentDropdown)}
                  activeOpacity={0.8}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <MaterialIcons
                      name={selectedResidentId ? 'verified-user' : 'person-search'}
                      size={18}
                      color={selectedResidentId ? '#D97706' : '#64748B'}
                    />
                    <Text
                      style={{
                        fontSize: 13,
                        color: selectedResidentId ? '#92400E' : '#475569',
                        fontWeight: selectedResidentId ? '700' : '500',
                      }}
                      numberOfLines={1}
                    >
                      {selectedResidentId
                        ? `Selected: ${heroName} (${heroBarangay || 'Danao City'})`
                        : 'Choose existing resident account (auto-fills info)...'}
                    </Text>
                  </View>
                  <MaterialIcons
                    name={showResidentDropdown ? 'expand-less' : 'expand-more'}
                    size={20}
                    color="#64748B"
                  />
                </TouchableOpacity>

                {showResidentDropdown && (
                  <View
                    style={{
                      backgroundColor: '#FFFFFF',
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: '#CBD5E1',
                      marginTop: 6,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.1,
                      shadowRadius: 8,
                      elevation: 5,
                      overflow: 'hidden',
                      zIndex: 100,
                    }}
                  >
                    {/* Search inside resident dropdown */}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: '#F1F5F9',
                        backgroundColor: '#F8FAFC',
                      }}
                    >
                      <MaterialIcons name="search" size={16} color="#64748B" />
                      <TextInput
                        style={{ flex: 1, fontSize: 12, color: '#0F172A', padding: 0 }}
                        placeholder="Search resident by name, email, or barangay..."
                        placeholderTextColor="#94A3B8"
                        value={residentSearchQuery}
                        onChangeText={setResidentSearchQuery}
                      />
                      {residentSearchQuery ? (
                        <TouchableOpacity onPress={() => setResidentSearchQuery('')}>
                          <MaterialIcons name="close" size={14} color="#94A3B8" />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {/* Rank info banner */}
                    <View
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 5,
                        backgroundColor: '#F1F5F9',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderBottomWidth: 1,
                        borderBottomColor: '#E2E8F0',
                      }}
                    >
                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#64748B', textTransform: 'uppercase' }}>
                        Ranked by points earned in {heroMonth}
                      </Text>
                      <Text style={{ fontSize: 10, color: '#94A3B8' }}>
                        {filteredResidentUsers.length} resident{filteredResidentUsers.length === 1 ? '' : 's'}
                      </Text>
                    </View>

                    <ScrollView
                      style={{ maxHeight: 200 }}
                      nestedScrollEnabled={true}
                      showsVerticalScrollIndicator={true}
                      keyboardShouldPersistTaps="handled"
                    >
                      {filteredResidentUsers.length === 0 ? (
                        <View style={{ padding: 14, alignItems: 'center' }}>
                          <Text style={{ fontSize: 12, color: '#94A3B8' }}>
                            No registered accounts found matching &quot;{residentSearchQuery}&quot;.
                          </Text>
                        </View>
                      ) : (
                        filteredResidentUsers.map((res, index) => {
                          const isSelected = selectedResidentId === res.id;
                          const name =
                            res.displayName ||
                            res.name ||
                            `${res.firstName || ''} ${res.lastName || ''}`.trim() ||
                            res.email?.split('@')[0] ||
                            'Resident';
                          const metrics = getResidentMonthMetrics(res, heroMonth);
                          const isTop = index === 0 && metrics.totalEarned > 0;

                          return (
                            <TouchableOpacity
                              key={res.id}
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                                borderBottomWidth: 1,
                                borderBottomColor: '#F1F5F9',
                                backgroundColor: isSelected ? '#FEF3C7' : '#FFFFFF',
                              }}
                              onPress={() => handleSelectResident(res)}
                              activeOpacity={0.7}
                            >
                              <View style={{ flex: 1, marginRight: 8 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  {isTop ? (
                                    <View
                                      style={{
                                        backgroundColor: '#FEF3C7',
                                        paddingHorizontal: 5,
                                        paddingVertical: 1,
                                        borderRadius: 4,
                                        borderWidth: 1,
                                        borderColor: '#F59E0B',
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 2,
                                      }}
                                    >
                                      <MaterialIcons name="emoji-events" size={10} color="#D97706" />
                                      <Text style={{ fontSize: 9, color: '#B45309', fontWeight: '800' }}>
                                        #1
                                      </Text>
                                    </View>
                                  ) : null}
                                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#0F172A' }}>
                                    {name}
                                  </Text>
                                  {res.barangay ? (
                                    <View
                                      style={{
                                        backgroundColor: '#E0F2FE',
                                        paddingHorizontal: 6,
                                        paddingVertical: 1,
                                        borderRadius: 4,
                                      }}
                                    >
                                      <Text style={{ fontSize: 10, color: '#0284C7', fontWeight: '700' }}>
                                        Brgy. {res.barangay}
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>
                                <Text style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                                  {res.email || 'Registered Citizen'}
                                </Text>
                              </View>
                              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                                <View
                                  style={{
                                    backgroundColor: metrics.totalEarned > 0 ? '#ECFDF5' : '#F1F5F9',
                                    paddingHorizontal: 6,
                                    paddingVertical: 2,
                                    borderRadius: 6,
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 3,
                                  }}
                                >
                                  <MaterialIcons
                                    name="stars"
                                    size={12}
                                    color={metrics.totalEarned > 0 ? '#059669' : '#94A3B8'}
                                  />
                                  <Text
                                    style={{
                                      fontSize: 11,
                                      fontWeight: '800',
                                      color: metrics.totalEarned > 0 ? '#059669' : '#64748B',
                                    }}
                                  >
                                    {metrics.totalEarned.toLocaleString()} pts
                                  </Text>
                                </View>
                                {metrics.cleanStops > 0 && (
                                  <Text style={{ fontSize: 9, color: '#059669', fontWeight: '600' }}>
                                    {metrics.cleanStops} clean stop{metrics.cleanStops > 1 ? 's' : ''}
                                  </Text>
                                )}
                                {isSelected ? (
                                  <MaterialIcons name="check" size={16} color="#D97706" />
                                ) : null}
                              </View>
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </ScrollView>
                  </View>
                )}
              </View>

              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                  <Text style={[styles.label, { marginBottom: 0 }]}>HONORED RESIDENT NAME</Text>
                  <MaterialIcons name="lock" size={12} color="#94A3B8" />
                </View>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: '#F8FAFC',
                      color: '#475569',
                      borderColor: '#E2E8F0',
                      fontWeight: '600',
                    },
                  ]}
                  editable={false}
                  placeholder="Auto-matched from resident account"
                  placeholderTextColor="#9CA3AF"
                  value={heroName || ''}
                />
              </View>

              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                  <Text style={[styles.label, { marginBottom: 0 }]}>BARANGAY SECTOR</Text>
                  <MaterialIcons name="lock" size={12} color="#94A3B8" />
                </View>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: '#F8FAFC',
                      color: '#475569',
                      borderColor: '#E2E8F0',
                      fontWeight: '600',
                    },
                  ]}
                  editable={false}
                  placeholder="Auto-matched from resident account"
                  placeholderTextColor="#9CA3AF"
                  value={heroBarangay ? (heroBarangay.startsWith('Brgy.') ? heroBarangay : `Brgy. ${heroBarangay}`) : 'Danao City'}
                />
              </View>

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                    <Text style={[styles.label, { marginBottom: 0 }]}>ECO-TOKENS EARNED</Text>
                    <MaterialIcons name="lock" size={12} color="#94A3B8" />
                  </View>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: '#F8FAFC',
                        color: '#475569',
                        borderColor: '#E2E8F0',
                        fontWeight: '600',
                      },
                    ]}
                    editable={false}
                    placeholder="0"
                    placeholderTextColor="#9CA3AF"
                    value={heroTokens}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                    <Text style={[styles.label, { marginBottom: 0 }]}>CLEAN PICKUP STOPS</Text>
                    <MaterialIcons name="lock" size={12} color="#94A3B8" />
                  </View>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: '#F8FAFC',
                        color: '#475569',
                        borderColor: '#E2E8F0',
                        fontWeight: '600',
                      },
                    ]}
                    editable={false}
                    placeholder="0"
                    placeholderTextColor="#9CA3AF"
                    value={heroPickups}
                  />
                </View>
              </View>

              <Text style={[styles.label, { marginTop: 12 }]}>OFFICIAL CENRO CITATION *</Text>
              <TextInput
                style={[styles.input, { height: 70, textAlignVertical: 'top' }]}
                multiline
                placeholder="Official citation commendation text..."
                placeholderTextColor="#9CA3AF"
                value={heroCitation}
                onChangeText={setHeroCitation}
              />

              <View style={styles.modalActionButtonsRow}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => setShowEnviroHeroModal(false)}
                  disabled={isSavingHero}
                >
                  <Text style={styles.modalCancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalSubmitButton, { backgroundColor: '#D97706' }, isSavingHero && { opacity: 0.7 }]}
                  onPress={handleSaveEnviroHero}
                  disabled={isSavingHero}
                >
                  {isSavingHero ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalSubmitButtonText}>Proclaim & Broadcast</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Barangay Filter Modal (for CENRO filtering table) */}
      <Modal
        visible={showBarangayFilterModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowBarangayFilterModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 520, maxHeight: 560 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="filter-list" size={20} color="#059669" />
                <Text style={styles.modalCardTitle}>Filter Announcements by Jurisdiction</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowBarangayFilterModal(false)}
                style={styles.modalCloseBtn}
                activeOpacity={0.7}
              >
                <MaterialIcons name="close" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalSearchContainer}>
              <MaterialIcons name="search" size={18} color="#6B7280" />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search barangay..."
                placeholderTextColor="#9CA3AF"
                value={barangayFilterSearch}
                onChangeText={setBarangayFilterSearch}
              />
              {barangayFilterSearch ? (
                <TouchableOpacity onPress={() => setBarangayFilterSearch('')}>
                  <MaterialIcons name="close" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              ) : null}
            </View>

            <ScrollView style={{ paddingHorizontal: 16, maxHeight: 400 }} showsVerticalScrollIndicator={true}>
              {/* Option 1: All Jurisdictions */}
              <TouchableOpacity
                style={[styles.modalPickerRow, barangayFilter === 'all' && styles.modalPickerRowActive]}
                onPress={() => {
                  setBarangayFilter('all');
                  setShowBarangayFilterModal(false);
                }}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <MaterialIcons
                    name="location-city"
                    size={18}
                    color={barangayFilter === 'all' ? '#059669' : '#6B7280'}
                  />
                  <Text style={[styles.modalPickerRowText, barangayFilter === 'all' && styles.modalPickerRowTextActive]}>
                    All Jurisdictions (City-Wide & 42 Barangays)
                  </Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{announcements.length} total</Text>
                </View>
              </TouchableOpacity>

              {/* Option 2: City-Wide Broadcasts Only */}
              <TouchableOpacity
                style={[styles.modalPickerRow, barangayFilter === 'citywide' && styles.modalPickerRowActive]}
                onPress={() => {
                  setBarangayFilter('citywide');
                  setShowBarangayFilterModal(false);
                }}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <MaterialIcons
                    name="public"
                    size={18}
                    color={barangayFilter === 'citywide' ? '#0284C7' : '#6B7280'}
                  />
                  <Text style={[styles.modalPickerRowText, barangayFilter === 'citywide' && styles.modalPickerRowTextActive]}>
                    🌐 City-Wide Broadcasts Only
                  </Text>
                </View>
                <View style={[styles.countBadge, { backgroundColor: '#E0F2FE' }]}>
                  <Text style={[styles.countBadgeText, { color: '#0284C7' }]}>{cityWideCount} broadcasts</Text>
                </View>
              </TouchableOpacity>

              {/* List of 42 Danao City Barangays */}
              {filteredFilterBarangayList.map((b) => {
                const isSelected = normalizeBrgy(barangayFilter) === normalizeBrgy(b);
                const count = barangayCounts[b] || 0;
                return (
                  <TouchableOpacity
                    key={b}
                    style={[styles.modalPickerRow, isSelected && styles.modalPickerRowActive]}
                    onPress={() => {
                      setBarangayFilter(b);
                      setShowBarangayFilterModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <MaterialIcons
                        name="holiday-village"
                        size={18}
                        color={isSelected ? '#059669' : '#6B7280'}
                      />
                      <Text style={[styles.modalPickerRowText, isSelected && styles.modalPickerRowTextActive]}>
                        Brgy. {b}
                      </Text>
                    </View>
                    {count > 0 ? (
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>{count} announcements</Text>
                      </View>
                    ) : (
                      <Text style={{ fontSize: 11, color: '#9CA3AF' }}>0 announcements</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    padding: 32,
  },
  headerSubtitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 24,
    letterSpacing: -0.5,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 24,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    overflow: 'visible',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardIcon: {
    marginRight: 2,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardCountBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1B4D3E',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },

  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  formGroup: {
    width: '48%',
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  requiredAsterisk: {
    color: '#EF4444',
    fontWeight: '800',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13.5,
    color: '#0F172A',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  textArea: {
    minHeight: 110,
  },

  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  dropdownOpen: {
    borderColor: '#1B4D3E',
    backgroundColor: '#F8FAFC',
  },
  dropdownText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0F172A',
  },
  catIconBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownMenu: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 999,
    overflow: 'hidden',
  },
  dropdownMenuScroll: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 999,
    overflow: 'hidden',
  },
  categoryDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  categoryDropdownItemSelected: {
    backgroundColor: '#F0FDF4',
  },
  categoryItemLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  categoryItemDesc: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 1,
  },
  priorityDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dropdownItemText: {
    fontSize: 13,
    fontWeight: '600',
  },

  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 8,
    backgroundColor: '#1B4D3E',
    shadowColor: '#1B4D3E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },

  filterPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
    height: 38,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterPillActive: {
    backgroundColor: '#1B4D3E',
    borderColor: '#1B4D3E',
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  tableHead: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  th: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  td: {
    fontSize: 13,
  },
  rowTitle: {
    fontWeight: '700',
    color: '#0F172A',
    fontSize: 13.5,
    marginBottom: 2,
  },
  rowDesc: {
    color: '#64748B',
    fontSize: 11.5,
  },

  catBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  catBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  deleteBtn: {
    padding: 6,
    borderRadius: 6,
  },
  actionIconBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
  },

  // Modal Styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 620,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    maxHeight: '90%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  modalCardMobile: {
    maxWidth: '100%',
    maxHeight: '95%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FAFAFA',
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 8,
  },
  modalBody: {
    padding: 22,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    lineHeight: 26,
    marginBottom: 8,
  },
  modalDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  modalDateText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginBottom: 16,
  },
  modalSectionLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  modalDescription: {
    fontSize: 14.5,
    color: '#334155',
    lineHeight: 22,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FAFAFA',
  },
  modalDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  modalDeleteText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
  },
  modalCloseFooterBtn: {
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  modalCloseFooterText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },

  // Confirmation Popup Styles
  confirmModalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  confirmHeaderIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  confirmSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
  },
  confirmPreviewBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  confirmPreviewTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  confirmPreviewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  confirmPreviewMetaText: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '600',
  },
  confirmErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  confirmErrorText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
    flex: 1,
  },
  confirmActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  confirmDeleteBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#DC2626',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  confirmDeleteText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Coordinator Locked Banner
  coordinatorLockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  coordinatorLockedTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#065F46',
  },
  coordinatorLockedSubtitle: {
    fontSize: 12,
    color: '#047857',
    marginTop: 2,
  },

  // Broadcast Scope Selector
  scopeSelectorRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  scopeOptionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  scopeOptionCardActive: {
    backgroundColor: '#F0FDF4',
    borderColor: '#059669',
  },
  scopeRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#94A3B8',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  scopeRadioActive: {
    borderColor: '#059669',
  },
  scopeRadioInner: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#059669',
  },
  scopeOptionTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#334155',
  },
  scopeOptionTitleActive: {
    color: '#065F46',
    fontWeight: '800',
  },
  scopeOptionDesc: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 16,
  },

  // Target Barangay Picker in Creator
  targetBarangayPickerWrap: {
    marginTop: 8,
  },
  targetBarangayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#059669',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  targetBarangayBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#065F46',
    flex: 1,
    marginLeft: 6,
  },

  // Coordinator Table Note
  coordinatorTableNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  coordinatorTableNoteText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
  },

  // CENRO Barangay Filter Card
  barangayFilterCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  barangayFilterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  barangayFilterTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.5,
  },
  barangayFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  barangayFilterBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#065F46',
  },

  // Table Controls (Search & Category pills)
  tableControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  tableSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 8,
    minWidth: 260,
  },
  tableSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    padding: 0,
  },

  // Scope Badges in Table
  scopeBadgeCityWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E0F2FE',
    borderColor: '#BAE6FD',
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  scopeBadgeCityWideText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
  },
  scopeBadgeBarangay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  scopeBadgeBarangayText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },

  // Modal Meta Box (Detail view)
  modalMetaBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  modalMetaItem: {
    gap: 2,
  },
  modalMetaLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  modalMetaValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  modalCenroBroadcastNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  modalCenroBroadcastNoteText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },

  // Modal Pickers (Target barangay & Table filter)
  modalCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    margin: 16,
    marginBottom: 8,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    padding: 0,
  },
  modalPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalPickerRowActive: {
    backgroundColor: '#F0FDF4',
  },
  modalPickerRowText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#334155',
  },
  modalPickerRowTextActive: {
    color: '#065F46',
    fontWeight: '800',
  },
  countBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  heroProclaimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  heroProclaimBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#B45309',
  },
  modalActionButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    marginBottom: 8,
  },
  modalCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  modalCancelButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  modalSubmitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#D97706',
    minWidth: 140,
  },
  modalSubmitButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
