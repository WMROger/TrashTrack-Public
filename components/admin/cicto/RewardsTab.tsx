import ExportModal from '@/components/admin/cenro/ExportModal';
import { auth, db } from '@/config/firebase';
import { cloudinaryService } from '@/services/cloudinaryService';
import { ExportFormat, exportReport } from '@/services/reportExportService';
import {
  RewardSouvenir,
  addRewardCatalogItem,
  deleteRewardCatalogItem,
  updateRewardCatalogItem,
} from '@/services/rewardService';
import { isImageFile } from '@/utils/cloudinaryHelpers';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import {
  addDoc,
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

interface DirectoryUser {
  id: string;
  displayName?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  employeeId?: string;
  designation?: string;
  points?: number;
  rewardTokens?: number;
  tokens?: number;
  ecoPoints?: number;
  barangay?: string;
  assignedBarangay?: string;
  photoURL?: string;
  avatarUrl?: string;
}

export interface LeaderboardUserEntry {
  id: string;
  name: string;
  email: string;
  role: 'citizen' | 'driver' | 'admin';
  roleLabel: string;
  employeeId?: string;
  barangay: string;
  points: number;
  awardsCount: number;
  conferredTokens: number;
  resolvedReportsCount: number;
  reportPoints: number;
  redemptionsCount: number;
  redeemedCost: number;
  userAwards: any[];
  userReports: any[];
  userRedemptions: any[];
  rawUser: DirectoryUser;
}

const DANAO_BARANGAYS = [
  'Baliang',
  'Bayabas',
  'Binaliw',
  'Cabungahan',
  'Cahumayan',
  'Cambanay',
  'Cambubho',
  'Cogon-Cruz',
  'Danasan',
  'Dungga',
  'Guinabuangan',
  'Guinsay',
  'Ibo',
  'Langosig',
  'Lawaan',
  'Licos',
  'Looc',
  'Magtagobtob',
  'Malapoc',
  'Manlayag',
  'Mantija',
  'Masaba',
  'Mantalongon',
  'Poblacion',
  'Quisol',
  'Sabang',
  'Sandingan',
  'Santican',
  'Sibacan',
  'Suba',
  'Taboc',
  'Taytay',
  'Togonon',
  'Tuburan Sur',
];

export default function RewardsTab() {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [loading, setLoading] = useState(true);
  const [awards, setAwards] = useState<any[]>([]);
  const [redemptions, setRedemptions] = useState<any[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [catalogItems, setCatalogItems] = useState<RewardSouvenir[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [filter, setFilter] = useState<'all' | 'driver' | 'reporter' | 'redemptions' | 'catalog' | 'leaderboard'>('all');
  // Search keyword filter for awards, redemptions, catalog, and leaderboard
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<string>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [nativePickerTarget, setNativePickerTarget] = useState<'from' | 'to' | null>(null);

  // Catalog Filter & Sort State
  const [catalogSort, setCatalogSort] = useState<'newest' | 'most_redeemed' | 'least_redeemed' | 'cost_desc' | 'cost_asc' | 'stock_desc' | 'stock_asc' | 'name_asc'>('newest');
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState<string>('all');
  const [catalogStockFilter, setCatalogStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');

  // User Points Leaderboard Filter & Sort State
  const [leaderboardRoleFilter, setLeaderboardRoleFilter] = useState<'all' | 'citizen' | 'driver'>('all');
  const [leaderboardBarangayFilter, setLeaderboardBarangayFilter] = useState<string>('all');
  const [leaderboardSort, setLeaderboardSort] = useState<'points_desc' | 'points_asc' | 'awards_desc' | 'name_asc'>('points_desc');
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [inspectedParticipant, setInspectedParticipant] = useState<LeaderboardUserEntry | null>(null);
  const [isExportModalVisible, setIsExportModalVisible] = useState(false);

  // Dynamic uniform column layout calculation (Strict 5 per row on desktop)
  const numColumns = width >= 1150 ? 5 : width >= 920 ? 4 : width >= 700 ? 3 : width >= 480 ? 2 : 1;

  const handleNativeDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setNativePickerTarget(null);
    }
    if (selectedDate && !isNaN(selectedDate.getTime())) {
      const formatted = selectedDate.toISOString().split('T')[0];
      if (nativePickerTarget === 'from') {
        setCustomStartDate(formatted);
      } else if (nativePickerTarget === 'to') {
        setCustomEndDate(formatted);
      }
    }
    if (Platform.OS === 'ios') {
      setNativePickerTarget(null);
    }
  };

  // Live real-time data subscriptions
  useEffect(() => {
    if (!db) return;
    setLoading(true);

    const unsubAwards = onSnapshot(
      query(collection(db, 'reward_awards'), limit(150)),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort((a: any, b: any) => {
          const tA = a.awardedAt?.toMillis ? a.awardedAt.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
          const tB = b.awardedAt?.toMillis ? b.awardedAt.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
          return tB - tA;
        });
        setAwards(items);
        setLoading(false);
      },
      (err) => {
        console.warn('Error loading reward awards:', err);
        setLoading(false);
      }
    );

    const unsubRedemptions = onSnapshot(
      query(collection(db, 'reward_redemptions'), limit(150)),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort((a: any, b: any) => {
          const tA = a.redeemedAt?.toMillis ? a.redeemedAt.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
          const tB = b.redeemedAt?.toMillis ? b.redeemedAt.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
          return tB - tA;
        });
        setRedemptions(items);
      },
      (err) => console.warn('Error loading reward redemptions:', err)
    );

    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), limit(300)),
      (snap) => {
        const users = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DirectoryUser));
        setDirectoryUsers(users);
      },
      (err) => console.warn('Error loading directory users for rewards:', err)
    );

    const unsubCatalog = onSnapshot(
      collection(db, 'reward_catalog'),
      (snap) => {
        if (!snap.empty) {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RewardSouvenir));
          items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          setCatalogItems(items);
        } else {
          setCatalogItems([]);
        }
      },
      (err) => console.warn('Error loading reward catalog in CICTO:', err)
    );

    const unsubReports = onSnapshot(
      query(collection(db, 'reports'), limit(500)),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setReports(items);
      },
      (err) => console.warn('Error loading reports in CICTO rewards:', err)
    );

    return () => {
      unsubAwards();
      unsubRedemptions();
      unsubUsers();
      unsubCatalog();
      unsubReports();
    };
  }, []);

  // Merch Modal State
  const [merchModalOpen, setMerchModalOpen] = useState(false);
  const [editingMerch, setEditingMerch] = useState<RewardSouvenir | null>(null);
  const [merchName, setMerchName] = useState('');
  const [merchCategory, setMerchCategory] = useState('Merchandise');
  const [merchType, setMerchType] = useState('');
  const [merchCost, setMerchCost] = useState('1000');
  const [merchStock, setMerchStock] = useState('50');
  const [merchImage, setMerchImage] = useState('');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [isSavingMerch, setIsSavingMerch] = useState(false);

  // Modal State
  const [conferModalOpen, setConferModalOpen] = useState(false);
  const [awardRole, setAwardRole] = useState<'driver' | 'reporter'>('driver');
  const [awardKind, setAwardKind] = useState('Route Precision Distinction');
  const [selectedUser, setSelectedUser] = useState<DirectoryUser | null>(null);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [customRecipientName, setCustomRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [awardTokens, setAwardTokens] = useState('250');
  const [citationNote, setCitationNote] = useState('');
  const [customAwardTitle, setCustomAwardTitle] = useState('');
  const [isConferring, setIsConferring] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);

  const AWARD_PRESETS: Record<'reporter' | 'driver', Array<{ title: string; tokens: number; desc: string }>> = {
    reporter: [
      { title: 'Citizen Vigilance Citation', tokens: 200, desc: 'Timely and accurate geo-tagged reporting of illegal dumping.' },
      { title: 'Clean Barangay Advocate', tokens: 100, desc: 'Continuous active community participation in clean-up drives.' },
      { title: 'Other', tokens: 0, desc: 'Custom distinction with user-defined eco-token reward amount.' },
    ],
    driver: [
      { title: 'Route Precision Distinction', tokens: 250, desc: '100% on-time route completion and waypoint adherence.' },
      { title: 'Safe Driving Honor', tokens: 200, desc: 'Zero incident municipal driving and safety compliance.' },
      { title: 'Heavy Volume Mastery Award', tokens: 300, desc: 'Excellence in high-tonnage sector collection operations.' },
      { title: 'Other', tokens: 0, desc: 'Custom distinction with user-defined eco-token reward amount.' },
    ],
  };

  const handleSelectRole = (role: 'reporter' | 'driver') => {
    setAwardRole(role);
    setSelectedUser(null);
    setRecipientSearch('');
    setCustomRecipientName('');
    setRecipientEmail('');
    setIsUserDropdownOpen(false);

    setCustomAwardTitle('');
    const defaultPreset = AWARD_PRESETS[role][0];
    setAwardKind(defaultPreset.title);
    setAwardTokens(String(defaultPreset.tokens));
  };

  // Filter candidate users for the currently selected award role
  const candidateUsers = useMemo(() => {
    return directoryUsers.filter((u) => {
      const r = (u.role || 'user').toLowerCase();
      const desig = (u.designation || '').toLowerCase();
      if (awardRole === 'driver') {
        return r === 'driver';
      }
      // Reporter: residents / general citizens
      return r === 'user' || r === 'resident' || (!r && !desig.includes('admin'));
    });
  }, [directoryUsers, awardRole]);

  // Filtered candidates by search term
  const filteredCandidates = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return candidateUsers.slice(0, 8);
    return candidateUsers
      .filter((u) => {
        const name = (u.displayName || u.name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const emp = (u.employeeId || '').toLowerCase();
        return name.includes(q) || email.includes(q) || emp.includes(q);
      })
      .slice(0, 10);
  }, [candidateUsers, recipientSearch]);

  const handleSelectCandidate = (u: DirectoryUser) => {
    setSelectedUser(u);
    setCustomRecipientName(u.displayName || u.name || u.email || 'User');
    setRecipientEmail(u.email || '');
    setRecipientSearch('');
    setIsUserDropdownOpen(false);
  };

  const handleConferAward = async () => {
    if (!db) return;
    const finalRecipientName = customRecipientName.trim() || recipientSearch.trim();
    if (!finalRecipientName) {
      Alert.alert('Validation Error', 'Please select or enter the recipient name or employee ID.');
      return;
    }
    const tokensNum = parseInt(awardTokens, 10);
    if (isNaN(tokensNum) || tokensNum <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid positive token amount.');
      return;
    }

    setIsConferring(true);
    try {
      const targetUserId = selectedUser?.id || '';
      const targetEmployeeId = selectedUser?.employeeId || '';
      const finalEmail = selectedUser?.email || recipientEmail.trim();

      const currentYear = new Date().getFullYear();
      const resolvedAwardKind = awardKind === 'Other'
        ? (customAwardTitle.trim() || 'Other Distinction')
        : awardKind;
      const awardPayload = {
        recipientRole: awardRole,
        awardKind: resolvedAwardKind,
        recipientName: finalRecipientName,
        recipientEmail: finalEmail,
        employeeId: targetEmployeeId,
        userId: targetUserId,
        recipientUid: targetUserId,
        tokens: tokensNum,
        fiscalYear: currentYear,
        reason: `Official Distinction: ${resolvedAwardKind}${citationNote ? ` • ${citationNote.trim()}` : ''}`,
        conferredBy: auth.currentUser?.email || 'CICTO & CENRO Governance',
        conferredByUid: auth.currentUser?.uid || '',
        awardedAt: serverTimestamp(),
      };

      // 1. Write award record to ledger
      await addDoc(collection(db, 'reward_awards'), awardPayload);

      // 2. Credit tokens directly to user profile if linked
      if (targetUserId) {
        const userRef = doc(db, 'users', targetUserId);
        await updateDoc(userRef, {
          points: increment(tokensNum),
          rewardTokens: increment(tokensNum),
          updatedAt: serverTimestamp(),
        }).catch((uErr) => console.warn('User points increment notice:', uErr));

        // 3. Dispatch user notification
        const awardMsg = `You received "${resolvedAwardKind}" (+${tokensNum} pts) from Danao City CICTO Oversight.`;
        await addDoc(collection(db, 'userNotifications'), {
          userId: targetUserId,
          title: '🏅 Official Distinction Awarded!',
          body: awardMsg,
          message: awardMsg,
          type: 'award',
          read: false,
          createdAt: serverTimestamp(),
        }).catch(() => undefined);
      }

      Alert.alert(
        'Award Conferred',
        `Officially granted "${resolvedAwardKind}" (+${tokensNum} pts) to ${finalRecipientName} (${awardRole.toUpperCase()}).${targetUserId ? ' Tokens credited directly to user account.' : ''}`
      );

      setConferModalOpen(false);
      setSelectedUser(null);
      setCustomRecipientName('');
      setRecipientSearch('');
      setRecipientEmail('');
      setCitationNote('');
      setCustomAwardTitle('');
    } catch (err: any) {
      console.error('Error conferring award:', err);
      Alert.alert('Failed to Confer Award', err?.message || 'Please check your permissions.');
    } finally {
      setIsConferring(false);
    }
  };

  // Merchandise Catalog Handlers
  const handleOpenAddMerch = () => {
    setEditingMerch(null);
    setMerchName('');
    setMerchCategory('Merchandise');
    setMerchType('');
    setMerchCost('1000');
    setMerchStock('50');
    setMerchImage('');
    setShowImageUrlInput(false);
    setMerchModalOpen(true);
  };

  const handleOpenEditMerch = (item: RewardSouvenir) => {
    setEditingMerch(item);
    setMerchName(item.name || '');
    setMerchCategory(item.category || 'Merchandise');
    setMerchType(item.type || '');
    setMerchCost(String(item.cost || 0));
    setMerchStock(String(item.stock ?? 50));
    setMerchImage(item.imageUrl || '');
    setShowImageUrlInput(false);
    setMerchModalOpen(true);
  };

  const handlePickMerchImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const check = isImageFile(asset);
      if (!check.isValid) {
        Alert.alert(
          'Invalid File Type',
          check.error || 'Only image files (JPG, PNG, WebP, GIF, etc.) are allowed to be uploaded.'
        );
        return;
      }

      setIsUploadingImage(true);
      const localUri = asset.uri;
      try {
        const uploadRes = await cloudinaryService.uploadImage(localUri, {
          folder: 'rewards',
        });
        if (uploadRes.success && uploadRes.url) {
          setMerchImage(uploadRes.url);
        } else {
          Alert.alert('Upload Failed', uploadRes.error || 'Could not upload image to cloud storage.');
        }
      } catch (uploadErr: any) {
        console.warn('Cloudinary upload error:', uploadErr);
        Alert.alert('Upload Error', uploadErr?.message || 'Failed to upload image.');
      }
    } catch (err: any) {
      console.error('Error selecting image:', err);
      Alert.alert('Image Selection Error', err?.message || 'Could not pick image.');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleRemoveMerchImage = () => {
    setMerchImage('');
  };

  const handleSaveMerch = async () => {
    if (!merchName.trim()) {
      Alert.alert('Validation Error', 'Please enter a name for the merchandise item.');
      return;
    }
    const costNum = parseInt(merchCost, 10);
    if (isNaN(costNum) || costNum <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid positive point cost.');
      return;
    }
    const stockNum = parseInt(merchStock, 10);
    if (isNaN(stockNum) || stockNum < 0) {
      Alert.alert('Validation Error', 'Please enter a valid stock quantity.');
      return;
    }

    if (merchImage.trim()) {
      const imgCheck = isImageFile(merchImage.trim());
      if (!imgCheck.isValid) {
        Alert.alert(
          'Invalid Image',
          imgCheck.error || 'Please provide a valid image URL (e.g. JPG, PNG, WebP) or upload an image file.'
        );
        return;
      }
    }

    setIsSavingMerch(true);
    try {
      const payload = {
        name: merchName.trim(),
        category: merchCategory,
        type: merchType.trim(),
        cost: costNum,
        stock: stockNum,
        imageUrl: merchImage.trim() || undefined,
      };

      if (editingMerch) {
        await updateRewardCatalogItem(editingMerch.id, payload);
        Alert.alert('Catalog Updated', `Updated "${merchName.trim()}" in the Eco-Store.`);
      } else {
        await addRewardCatalogItem(payload);
        Alert.alert('Merchandise Added', `"${merchName.trim()}" is now published to the resident Eco-Store.`);
      }
      setMerchModalOpen(false);
      setEditingMerch(null);
    } catch (err: any) {
      console.error('Error saving merch item:', err);
      Alert.alert('Error', err?.message || 'Failed to save merchandise item.');
    } finally {
      setIsSavingMerch(false);
    }
  };

  const handleDeleteMerch = (item: RewardSouvenir) => {
    const confirmDelete = () => {
      deleteRewardCatalogItem(item.id)
        .then(() => {
          Alert.alert('Deleted', `Removed "${item.name}" from catalog.`);
        })
        .catch((err) => {
          Alert.alert('Error', err?.message || 'Could not delete item.');
        });
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`Are you sure you want to remove "${item.name}" from the Eco-Store catalog?`)) {
        confirmDelete();
      }
    } else {
      Alert.alert(
        'Delete Merchandise Item',
        `Are you sure you want to remove "${item.name}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: confirmDelete },
        ]
      );
    }
  };

  // Helper to resolve Fiscal Year
  const getItemFiscalYear = (item: any): string => {
    if (item.fiscalYear) return String(item.fiscalYear);
    const dateObj = item.awardedAt?.toDate ? item.awardedAt.toDate() :
      item.redeemedAt?.toDate ? item.redeemedAt.toDate() :
        item.issuedAt?.toDate ? item.issuedAt.toDate() :
          item.createdAt?.toDate ? item.createdAt.toDate() :
            item.awardedAt ? new Date(item.awardedAt) :
              item.redeemedAt ? new Date(item.redeemedAt) :
                item.createdAt ? new Date(item.createdAt) : null;
    if (dateObj && !isNaN(dateObj.getTime())) {
      return String(dateObj.getFullYear());
    }
    return String(new Date().getFullYear());
  };

  const getItemDateObj = (item: any): Date | null => {
    const dateObj = item.awardedAt?.toDate ? item.awardedAt.toDate() :
      item.redeemedAt?.toDate ? item.redeemedAt.toDate() :
        item.issuedAt?.toDate ? item.issuedAt.toDate() :
          item.createdAt?.toDate ? item.createdAt.toDate() :
            item.awardedAt ? new Date(item.awardedAt) :
              item.redeemedAt ? new Date(item.redeemedAt) :
                item.createdAt ? new Date(item.createdAt) : null;
    if (dateObj && !isNaN(dateObj.getTime())) {
      return dateObj;
    }
    return null;
  };

  const isItemInCustomRange = (item: any): boolean => {
    if (!customStartDate && !customEndDate) return true;
    const itemDate = getItemDateObj(item);
    if (!itemDate) return false;

    if (customStartDate) {
      const start = new Date(customStartDate);
      start.setHours(0, 0, 0, 0);
      if (!isNaN(start.getTime()) && itemDate < start) return false;
    }
    if (customEndDate) {
      const end = new Date(customEndDate);
      end.setHours(23, 59, 59, 999);
      if (!isNaN(end.getTime()) && itemDate > end) return false;
    }
    return true;
  };

  const availableFiscalYears = useMemo(() => {
    const current = new Date().getFullYear();
    const years = [current + 1, current, current - 1, current - 2, current - 3];
    [2027, 2026, 2025, 2024, 2023].forEach((y) => {
      if (!years.includes(y)) years.push(y);
    });
    years.sort((a, b) => b - a);
    return ['all', ...years.map(String), 'custom'];
  }, []);

  // Filtered transactions for main ledger table
  const displayedAwards = useMemo(() => {
    if (filter === 'catalog') return [];
    return awards.filter((a) => {
      const roleMatch =
        filter === 'all' ||
        a.recipientRole === filter ||
        (filter === 'reporter' && (a.recipientRole === 'user' || a.recipientRole === 'resident'));

      if (!roleMatch) return false;

      // Year / Custom Date Check
      if (selectedFiscalYear === 'custom') {
        if (!isItemInCustomRange(a)) return false;
      } else if (selectedFiscalYear !== 'all') {
        const fy = getItemFiscalYear(a);
        if (fy !== selectedFiscalYear) return false;
      }

      if (!searchFilter.trim()) return true;
      const q = searchFilter.toLowerCase();
      return (
        (a.awardKind || '').toLowerCase().includes(q) ||
        (a.recipientName || '').toLowerCase().includes(q) ||
        (a.recipientEmail || '').toLowerCase().includes(q) ||
        (a.employeeId || '').toLowerCase().includes(q) ||
        (a.reason || '').toLowerCase().includes(q)
      );
    });
  }, [awards, filter, searchFilter, selectedFiscalYear, customStartDate, customEndDate]);

  const displayedRedemptions = useMemo(() => {
    if (filter === 'catalog') return [];
    if (filter !== 'all' && filter !== 'redemptions') return [];
    return redemptions.filter((r) => {
      // Year / Custom Date Check
      if (selectedFiscalYear === 'custom') {
        if (!isItemInCustomRange(r)) return false;
      } else if (selectedFiscalYear !== 'all') {
        const fy = getItemFiscalYear(r);
        if (fy !== selectedFiscalYear) return false;
      }

      if (!searchFilter.trim()) return true;
      const q = searchFilter.toLowerCase();
      return (
        (r.souvenirName || '').toLowerCase().includes(q) ||
        (r.userName || '').toLowerCase().includes(q)
      );
    });
  }, [redemptions, filter, searchFilter, selectedFiscalYear, customStartDate, customEndDate]);

  // Count completed redemptions per souvenir
  const redemptionsCountBySouvenir = useMemo(() => {
    const map: Record<string, number> = {};
    redemptions.forEach((r: any) => {
      const idKey = r.souvenirId;
      const nameKey = (r.souvenirName || '').toLowerCase().trim();
      if (idKey) map[idKey] = (map[idKey] || 0) + 1;
      if (nameKey) map[`name_${nameKey}`] = (map[`name_${nameKey}`] || 0) + 1;
    });
    return map;
  }, [redemptions]);

  const getRedemptionCount = (item: RewardSouvenir): number => {
    if (redemptionsCountBySouvenir[item.id]) return redemptionsCountBySouvenir[item.id];
    const nameKey = `name_${(item.name || '').toLowerCase().trim()}`;
    return redemptionsCountBySouvenir[nameKey] || 0;
  };

  const totalRedemptionsCount = useMemo(() => {
    return redemptions.length;
  }, [redemptions]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    catalogItems.forEach((i) => {
      if (i.category && i.category.trim()) {
        set.add(i.category.trim());
      }
    });
    ['Merchandise', 'Apparel', 'Eco Kit', 'Voucher', 'Household'].forEach((c) => set.add(c));
    return ['all', ...Array.from(set)];
  }, [catalogItems]);

  const getItemCreatedDateText = (item: RewardSouvenir): string => {
    if (!item.createdAt) return '';
    try {
      const d = item.createdAt.toDate ? item.createdAt.toDate() : new Date(item.createdAt);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    } catch {}
    return '';
  };

  const displayedCatalog = useMemo(() => {
    let list = [...catalogItems];

    // 1. Search text filter
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter((i) =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q) ||
        (i.type || '').toLowerCase().includes(q)
      );
    }

    // 2. Category filter
    if (catalogCategoryFilter !== 'all') {
      list = list.filter((i) => (i.category || '').toLowerCase() === catalogCategoryFilter.toLowerCase());
    }

    // 3. Stock filter
    if (catalogStockFilter === 'in_stock') {
      list = list.filter((i) => (i.stock ?? 50) > 0);
    } else if (catalogStockFilter === 'out_of_stock') {
      list = list.filter((i) => (i.stock ?? 50) <= 0);
    }

    // 4. Sort
    list.sort((a, b) => {
      if (catalogSort === 'most_redeemed') {
        const diff = getRedemptionCount(b) - getRedemptionCount(a);
        if (diff !== 0) return diff;
        return (a.name || '').localeCompare(b.name || '');
      }
      if (catalogSort === 'least_redeemed') {
        const diff = getRedemptionCount(a) - getRedemptionCount(b);
        if (diff !== 0) return diff;
        return (a.name || '').localeCompare(b.name || '');
      }
      if (catalogSort === 'newest') {
        const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        if (tB !== tA) return tB - tA;
        return (b.id || '').localeCompare(a.id || '');
      }
      if (catalogSort === 'cost_desc') {
        return (b.cost || 0) - (a.cost || 0);
      }
      if (catalogSort === 'cost_asc') {
        return (a.cost || 0) - (b.cost || 0);
      }
      if (catalogSort === 'stock_desc') {
        return (b.stock ?? 50) - (a.stock ?? 50);
      }
      if (catalogSort === 'stock_asc') {
        return (a.stock ?? 50) - (b.stock ?? 50);
      }
      if (catalogSort === 'name_asc') {
        return (a.name || '').localeCompare(b.name || '');
      }
      return 0;
    });

    return list;
  }, [catalogItems, searchFilter, catalogCategoryFilter, catalogStockFilter, catalogSort, redemptionsCountBySouvenir]);

  // User Leaderboard Processed Data
  const processedLeaderboard = useMemo<LeaderboardUserEntry[]>(() => {
    return directoryUsers.map((u) => {
      const uRole = (u.role || '').toLowerCase();
      const uDesig = (u.designation || '').toLowerCase();
      let roleType: 'citizen' | 'driver' | 'admin' = 'citizen';
      let roleLabel = 'Citizen / Reporter';

      if (uRole === 'driver') {
        roleType = 'driver';
        roleLabel = 'Collection Driver';
      } else if (uRole.includes('admin') || uDesig.includes('admin') || uRole.includes('cicto') || uRole.includes('cenro')) {
        roleType = 'admin';
        roleLabel = 'Admin / Staff';
      }

      const name =
        u.displayName ||
        u.name ||
        `${u.firstName || ''} ${u.lastName || ''}`.trim() ||
        u.email?.split('@')[0] ||
        'Verified User';

      const email = u.email || '';
      const barangay = u.barangay || u.assignedBarangay || 'Danao City';

      // Correlate citizen waste reports and cleanup points
      const userReports = reports.filter((r) => {
        if (r.userId && r.userId === u.id) return true;
        if (r.reportedByUid && r.reportedByUid === u.id) return true;
        if (email && r.userEmail && r.userEmail.toLowerCase() === email.toLowerCase()) return true;
        return false;
      });
      const userResolvedReports = userReports.filter((r) => {
        const s = String(r.status || '').toLowerCase();
        return s === 'resolved' || s === 'completed' || s === 'cleaned' || s === 'done';
      });
      const resolvedReportsCount = userResolvedReports.length;
      const reportPoints = userResolvedReports.reduce(
        (acc, r) => acc + (Number(r.rewardPoints) || 50),
        0
      );

      // Correlate awards from ledger
      const userAwards = awards.filter((a) => {
        if (a.userId && a.userId === u.id) return true;
        if (a.recipientUid && a.recipientUid === u.id) return true;
        if (email && a.recipientEmail && a.recipientEmail.toLowerCase() === email.toLowerCase()) return true;
        if (u.employeeId && a.employeeId && a.employeeId.toLowerCase() === u.employeeId.toLowerCase()) return true;
        if (name && a.recipientName && a.recipientName.toLowerCase() === name.toLowerCase()) return true;
        return false;
      });
      const awardsCount = userAwards.length;
      const conferredTokens = userAwards.reduce((acc, a) => acc + (Number(a.tokens) || 0), 0);

      // Correlate redemptions from ledger
      const userRedemptions = redemptions.filter((r) => {
        if (r.userId && r.userId === u.id) return true;
        if (email && r.userEmail && r.userEmail.toLowerCase() === email.toLowerCase()) return true;
        return false;
      });
      const redemptionsCount = userRedemptions.length;
      const redeemedCost = userRedemptions.reduce((acc, r) => acc + (Number(r.cost) || 0), 0);

      // Stored profile balance (if points were explicitly credited in users collection)
      const stored = Math.max(
        Number(u.points || 0),
        Number(u.rewardTokens || 0),
        Number(u.tokens || 0),
        Number(u.ecoPoints || 0)
      );

      // Total balance: combines stored/conferred points + citizen reporting points - spent redemptions
      const grossPoints = Math.max(stored, conferredTokens) + reportPoints;
      const points = Math.max(0, grossPoints - redeemedCost);

      return {
        id: u.id,
        name,
        email,
        role: roleType,
        roleLabel,
        employeeId: u.employeeId,
        barangay,
        points,
        awardsCount,
        conferredTokens,
        resolvedReportsCount,
        reportPoints,
        redemptionsCount,
        redeemedCost,
        userAwards,
        userReports,
        userRedemptions,
        rawUser: u,
      };
    });
  }, [directoryUsers, awards, redemptions, reports]);

  const filteredLeaderboard = useMemo(() => {
    let list = [...processedLeaderboard];

    // 1. Search text filter
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter((u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.employeeId && u.employeeId.toLowerCase().includes(q)) ||
        u.barangay.toLowerCase().includes(q) ||
        u.roleLabel.toLowerCase().includes(q)
      );
    }

    // 2. Role filter
    if (leaderboardRoleFilter !== 'all') {
      list = list.filter((u) => u.role === leaderboardRoleFilter);
    }

    // 3. Barangay filter
    if (leaderboardBarangayFilter !== 'all') {
      list = list.filter((u) => u.barangay.toLowerCase() === leaderboardBarangayFilter.toLowerCase());
    }

    // 4. Sort
    list.sort((a, b) => {
      if (leaderboardSort === 'points_desc') {
        if (b.points !== a.points) return b.points - a.points;
        return b.awardsCount - a.awardsCount;
      }
      if (leaderboardSort === 'points_asc') {
        if (a.points !== b.points) return a.points - b.points;
        return a.awardsCount - b.awardsCount;
      }
      if (leaderboardSort === 'awards_desc') {
        if (b.awardsCount !== a.awardsCount) return b.awardsCount - a.awardsCount;
        return b.points - a.points;
      }
      if (leaderboardSort === 'name_asc') {
        return a.name.localeCompare(b.name);
      }
      return 0;
    });

    return list;
  }, [processedLeaderboard, searchFilter, leaderboardRoleFilter, leaderboardBarangayFilter, leaderboardSort]);

  const totalCommunityPoints = useMemo(
    () => processedLeaderboard.reduce((acc, u) => acc + u.points, 0),
    [processedLeaderboard]
  );
  const leaderboardCitizenCount = useMemo(
    () => processedLeaderboard.filter((u) => u.role === 'citizen').length,
    [processedLeaderboard]
  );
  const leaderboardDriverCount = useMemo(
    () => processedLeaderboard.filter((u) => u.role === 'driver').length,
    [processedLeaderboard]
  );

  const handleQuickConferFromLeaderboard = (entry: LeaderboardUserEntry) => {
    setAwardRole(entry.role === 'driver' ? 'driver' : 'reporter');
    setSelectedUser(entry.rawUser);
    setCustomRecipientName(entry.name);
    setRecipientEmail(entry.email);
    setRecipientSearch('');
    setIsUserDropdownOpen(false);

    const defaultPreset = entry.role === 'driver' ? AWARD_PRESETS.driver[0] : AWARD_PRESETS.reporter[0];
    setAwardKind(defaultPreset.title);
    setAwardTokens(String(defaultPreset.tokens));
    setConferModalOpen(true);
  };

  // Export Report Handler (3 Formats: PDF, Excel, CSV via ExportModal)
  const handleExport = async (format: ExportFormat) => {
    if (filter === 'catalog') {
      const headers = ['Item ID', 'Item Name', 'Category', 'Specifications / Type', 'Cost (Tokens)', 'Available Stock', 'Status'];
      const rows = displayedCatalog.map((item) => [
        item.id ? `ITM-${item.id.slice(-6).toUpperCase()}` : 'N/A',
        item.name || 'N/A',
        item.category || 'General',
        item.type || 'Standard',
        item.cost != null ? Number(item.cost) : 0,
        item.stock ?? 50,
        (item.stock ?? 50) > 0 ? 'In Stock' : 'Out of Stock',
      ]);
      const totalStock = displayedCatalog.reduce((sum, item) => sum + (item.stock ?? 50), 0);

      await exportReport({
        format,
        filename: `danao_eco_merchandise_catalog_${new Date().toISOString().split('T')[0]}`,
        title: 'Eco-Merchandise Inventory Catalog',
        subtitle: 'City Information & Communications Technology Office Official Rewards Catalog',
        jurisdiction: 'City of Danao - CICTO Oversight',
        generatedBy: auth.currentUser?.email || 'CICTO Administrator',
        headers,
        rows,
        summaryCards: [
          { label: 'Catalog Items', value: displayedCatalog.length },
          { label: 'Total In-Stock Units', value: totalStock.toLocaleString() },
          { label: 'Categories', value: Array.from(new Set(displayedCatalog.map((i) => i.category || 'General'))).length },
        ],
        sheetName: 'Catalog_Inventory',
      });
    } else if (filter === 'leaderboard') {
      const headers = [
        'Rank',
        'User Name',
        'Email',
        'Role',
        'Employee ID',
        'Barangay Sector',
        'Total Eco-Points',
        'Awards Conferred',
        'Conferred Tokens',
        'Redemptions Claimed',
      ];
      const rows = filteredLeaderboard.map((u, idx) => [
        idx + 1,
        u.name || 'Anonymous User',
        u.email || 'N/A',
        u.roleLabel,
        u.employeeId || 'N/A',
        u.barangay || 'Danao City',
        u.points || 0,
        u.awardsCount || 0,
        u.conferredTokens || 0,
        u.redemptionsCount || 0,
      ]);
      const totalPoints = filteredLeaderboard.reduce((sum, u) => sum + (u.points || 0), 0);

      await exportReport({
        format,
        filename: `danao_points_leaderboard_${new Date().toISOString().split('T')[0]}`,
        title: 'Danao City Eco-Points Leaderboard & Rankings',
        subtitle: 'Official Citizen & Personnel Eco-Token Governance Standings',
        jurisdiction: 'City of Danao - CICTO Oversight',
        generatedBy: auth.currentUser?.email || 'CICTO Administrator',
        headers,
        rows,
        summaryCards: [
          { label: 'Ranked Participants', value: filteredLeaderboard.length },
          { label: 'Total Points Distributed', value: `${totalPoints.toLocaleString()} pts` },
          { label: 'Top Contributor', value: filteredLeaderboard[0]?.name || 'N/A' },
        ],
        sheetName: 'Points_Leaderboard',
      });
    } else {
      const fyTag = selectedFiscalYear === 'all' ? 'ALL_FY' : `FY${selectedFiscalYear}`;
      const headers = [
        'Transaction ID',
        'Date',
        'Fiscal Year',
        'Type',
        'Award / Merch Item',
        'Recipient Name',
        'Role',
        'Recipient Email',
        'Employee ID',
        'Tokens Delta',
        'Conferred By / Issuer',
        'Citation / Notes',
      ];

      const awardRows = (filter === 'redemptions' ? [] : displayedAwards).map((a) => {
        const dateStr = a.awardedAt?.toDate ? a.awardedAt.toDate().toLocaleDateString() : 'N/A';
        const fy = getItemFiscalYear(a);
        return [
          a.id ? `AWD-${a.id.slice(-6).toUpperCase()}` : 'N/A',
          dateStr,
          `FY ${fy}`,
          'Distinction Award',
          a.awardKind || 'Distinction',
          a.recipientName || 'Citizen',
          (a.recipientRole || 'Citizen').toUpperCase(),
          a.recipientEmail || 'N/A',
          a.employeeId || 'N/A',
          `+${a.tokens || 50}`,
          a.conferredBy || 'CICTO & CENRO',
          a.reason || 'Official Recognition',
        ];
      });

      const redemptionRows = ((filter as string) === 'awards' ? [] : displayedRedemptions).map((r) => {
        const dateStr = r.redeemedAt?.toDate ? r.redeemedAt.toDate().toLocaleDateString() :
          r.issuedAt?.toDate ? r.issuedAt.toDate().toLocaleDateString() : 'N/A';
        const fy = getItemFiscalYear(r);
        return [
          r.id ? `RED-${r.id.slice(-6).toUpperCase()}` : 'N/A',
          dateStr,
          `FY ${fy}`,
          'Eco-Store Redemption',
          r.souvenirName || 'Eco Souvenir',
          r.userName || 'Resident',
          'RESIDENT',
          'N/A',
          'N/A',
          `-${r.cost || 0}`,
          'Danao Eco-Store Portal',
          'Citizen souvenir claim',
        ];
      });

      const rows = [...awardRows, ...redemptionRows];
      const totalAwardsTokens = displayedAwards.reduce((sum, a) => sum + (Number(a.tokens) || 0), 0);
      const totalRedemptionsCost = displayedRedemptions.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);

      await exportReport({
        format,
        filename: `rewards_ledger_${fyTag}_${new Date().toISOString().split('T')[0]}`,
        title: 'Token Ledger & Distinction Awards Register',
        subtitle: `Official Token Ledger, Citations & Souvenir Redemptions Register (${selectedFiscalYear === 'all' ? 'All Fiscal Years' : `FY ${selectedFiscalYear}`})`,
        jurisdiction: 'City of Danao - CICTO Oversight',
        generatedBy: auth.currentUser?.email || 'CICTO Administrator',
        headers,
        rows,
        summaryCards: [
          { label: 'Total Transactions', value: rows.length },
          { label: 'Awards Conferred', value: displayedAwards.length },
          { label: 'Tokens Conferred', value: `+${totalAwardsTokens.toLocaleString()}` },
          { label: 'Redemptions Claimed', value: displayedRedemptions.length },
          { label: 'Tokens Redeemed', value: `-${totalRedemptionsCost.toLocaleString()}` },
        ],
        sheetName: 'Rewards_Ledger',
      });
    }
  };

  const exportModalTitle =
    filter === 'catalog'
      ? 'Export Eco-Merchandise Catalog'
      : filter === 'leaderboard'
      ? 'Export Eco-Points Leaderboard'
      : 'Export Token Ledger & Awards';

  const exportModalCount =
    filter === 'catalog'
      ? displayedCatalog.length
      : filter === 'leaderboard'
      ? filteredLeaderboard.length
      : (displayedAwards.length + displayedRedemptions.length);

  const exportModalDescription =
    filter === 'catalog'
      ? 'Export the complete list of municipal eco-store items, stock counts, and point costs in PDF, Excel, or CSV format.'
      : filter === 'leaderboard'
      ? 'Export official citizen and personnel eco-point rankings, awards, and redemptions in PDF, Excel, or CSV format.'
      : 'Export distinction awards, recognition citations, and citizen souvenir redemptions ledger in PDF, Excel, or CSV format.';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>CICTO / REWARDS & RECOGNITION</Text>
          <Text style={styles.title}>Token Ledger & Distinction Awards</Text>
          <Text style={styles.sub}>
            Official governance awards, merchandise catalog, and token records for reporters and collection drivers.
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <TouchableOpacity
            style={styles.exportBtn}
            onPress={() => setIsExportModalVisible(true)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="file-download" size={17} color="#0D9488" />
            <Text style={styles.exportBtnText}>Export</Text>
          </TouchableOpacity>

          {/* <TouchableOpacity
            style={styles.addMerchBtn}
            onPress={handleOpenAddMerch}
            activeOpacity={0.8}
          >
            <MaterialIcons name="add-shopping-cart" size={17} color="#0D9488" />
            <Text style={styles.addMerchBtnText}>+ Upload Merch</Text>
          </TouchableOpacity> */}

          <TouchableOpacity
            style={styles.conferBtn}
            onPress={() => setConferModalOpen(true)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="emoji-events" size={18} color="#FFFFFF" />
            <Text style={styles.conferBtnText}>Confer Award</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Metric Counters */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>TOTAL AWARDS CONFERRED</Text>
          <Text style={[styles.statValue, { color: '#0D9488' }]}>{awards.length}</Text>
          <Text style={styles.statSub}>Drivers & Citizens</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>COMMUNITY REDEMPTIONS</Text>
          <Text style={[styles.statValue, { color: '#D97706' }]}>{redemptions.length}</Text>
          <Text style={styles.statSub}>Eco-store Souvenirs Claimed</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>ECO-MERCH IN STORE</Text>
          <Text style={[styles.statValue, { color: '#059669' }]}>{catalogItems.length}</Text>
          <Text style={styles.statSub}>Active Redeemable Souvenirs</Text>
        </View>
        <TouchableOpacity
          style={[styles.statCard, filter === 'leaderboard' && { borderColor: '#2563EB', borderWidth: 1.5 }]}
          onPress={() => setFilter('leaderboard')}
          activeOpacity={0.8}
        >
          <Text style={styles.statLabel}>ELIGIBLE PARTICIPANTS</Text>
          <Text style={[styles.statValue, { color: '#2563EB' }]}>{directoryUsers.length}</Text>
          <Text style={styles.statSub}>Verified Municipal Accounts</Text>
        </TouchableOpacity>
      </View>

      {/* Ledger Table Section */}
      <View style={styles.section}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <Text style={styles.sectionTitle}>
            {filter === 'catalog'
              ? 'Official Eco-Store Merchandise Catalog'
              : filter === 'leaderboard'
              ? 'Municipal User Points Leaderboard'
              : 'Recent Reward & Distinction Transactions'}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Year Filter (when viewing records) */}
            {filter !== 'catalog' && filter !== 'leaderboard' && (
              <View style={styles.fyFilterRow}>
                <Text style={styles.fyFilterLabel}>Year:</Text>
                {availableFiscalYears.map((fy) => {
                  const active = selectedFiscalYear === fy;
                  return (
                    <TouchableOpacity
                      key={fy}
                      style={[styles.fyPill, active && styles.fyPillActive]}
                      onPress={() => setSelectedFiscalYear(fy)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.fyPillText, active && styles.fyPillTextActive]}>
                        {fy === 'all' ? 'All' : fy === 'custom' ? 'Custom' : fy}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Search Box */}
            <View style={styles.searchBox}>
              <MaterialIcons name="search" size={16} color="#94A3B8" />
              <TextInput
                style={styles.searchInput}
                placeholder={
                  filter === 'catalog'
                    ? "Search merch item..."
                    : filter === 'leaderboard'
                    ? "Search user name, email, barangay..."
                    : "Search recipient, award..."
                }
                placeholderTextColor="#94A3B8"
                value={searchFilter}
                onChangeText={setSearchFilter}
              />
              {searchFilter.length > 0 && (
                <TouchableOpacity onPress={() => setSearchFilter('')}>
                  <MaterialIcons name="close" size={14} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Custom Date Range Bar */}
        {filter !== 'catalog' && filter !== 'leaderboard' && selectedFiscalYear === 'custom' && (
          <View style={styles.customDateBar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="date-range" size={16} color="#0D9488" />
              <Text style={styles.customDateBarTitle}>Custom Range:</Text>
            </View>
            <View style={styles.customDateInputGroup}>
              <Text style={styles.customDateInputLabel}>FROM</Text>
              {Platform.OS === 'web' ? (
                React.createElement('input', {
                  type: 'date',
                  value: customStartDate,
                  onChange: (e: any) => setCustomStartDate(e.target.value),
                  onClick: (e: any) => {
                    if (e.target && typeof e.target.showPicker === 'function') {
                      try { e.target.showPicker(); } catch {}
                    }
                  },
                  style: {
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#0F172A',
                    backgroundColor: '#FFFFFF',
                    outline: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    height: '30px',
                    boxSizing: 'border-box',
                  },
                }) as any
              ) : (
                <TouchableOpacity
                  style={styles.customDateNativeBtn}
                  onPress={() => setNativePickerTarget('from')}
                >
                  <MaterialIcons name="calendar-today" size={13} color="#0D9488" />
                  <Text style={styles.customDateNativeBtnText}>
                    {customStartDate || 'YYYY-MM-DD'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.customDateToText}>to</Text>
            <View style={styles.customDateInputGroup}>
              <Text style={styles.customDateInputLabel}>TO</Text>
              {Platform.OS === 'web' ? (
                React.createElement('input', {
                  type: 'date',
                  value: customEndDate,
                  onChange: (e: any) => setCustomEndDate(e.target.value),
                  onClick: (e: any) => {
                    if (e.target && typeof e.target.showPicker === 'function') {
                      try { e.target.showPicker(); } catch {}
                    }
                  },
                  style: {
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#0F172A',
                    backgroundColor: '#FFFFFF',
                    outline: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    height: '30px',
                    boxSizing: 'border-box',
                  },
                }) as any
              ) : (
                <TouchableOpacity
                  style={styles.customDateNativeBtn}
                  onPress={() => setNativePickerTarget('to')}
                >
                  <MaterialIcons name="calendar-today" size={13} color="#0D9488" />
                  <Text style={styles.customDateNativeBtnText}>
                    {customEndDate || 'YYYY-MM-DD'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Quick Presets */}
            <View style={styles.customDatePresetsRow}>
              <TouchableOpacity
                style={styles.customPresetChip}
                onPress={() => {
                  const now = new Date();
                  const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                  setCustomStartDate(d.toISOString().split('T')[0]);
                  setCustomEndDate(now.toISOString().split('T')[0]);
                }}
              >
                <Text style={styles.customPresetChipText}>Last 30 Days</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.customPresetChip}
                onPress={() => {
                  const now = new Date();
                  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
                  setCustomStartDate(firstDay.toISOString().split('T')[0]);
                  setCustomEndDate(now.toISOString().split('T')[0]);
                }}
              >
                <Text style={styles.customPresetChipText}>This Month</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.customPresetChip}
                onPress={() => {
                  const now = new Date();
                  const firstDayOfYear = new Date(now.getFullYear(), 0, 1);
                  setCustomStartDate(firstDayOfYear.toISOString().split('T')[0]);
                  setCustomEndDate(now.toISOString().split('T')[0]);
                }}
              >
                <Text style={styles.customPresetChipText}>Year to Date</Text>
              </TouchableOpacity>
              {(customStartDate || customEndDate) && (
                <TouchableOpacity
                  style={styles.customPresetChipClear}
                  onPress={() => {
                    setCustomStartDate('');
                    setCustomEndDate('');
                  }}
                >
                  <MaterialIcons name="close" size={13} color="#EF4444" />
                  <Text style={styles.customPresetChipClearText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Native Mobile Date Picker */}
        {Platform.OS !== 'web' && nativePickerTarget && (
          <DateTimePicker
            value={
              nativePickerTarget === 'from' && customStartDate
                ? new Date(customStartDate)
                : nativePickerTarget === 'to' && customEndDate
                ? new Date(customEndDate)
                : new Date()
            }
            mode="date"
            display="default"
            onChange={handleNativeDateChange}
          />
        )}

        {/* Filter Chips */}
        <View style={styles.filterChipsRow}>
          {[
            { id: 'all', label: 'All Records', count: awards.length + redemptions.length },
            { id: 'driver', label: 'Drivers', count: awards.filter((a) => a.recipientRole === 'driver').length },
            { id: 'reporter', label: 'Reporters', count: awards.filter((a) => a.recipientRole === 'reporter' || a.recipientRole === 'user' || a.recipientRole === 'resident').length },
            { id: 'redemptions', label: 'Redemptions', count: redemptions.length },
            { id: 'catalog', label: 'Eco-Merch Catalog', count: catalogItems.length },
            { id: 'leaderboard', label: 'User Leaderboard', count: directoryUsers.length },
          ].map((c) => {
            const active = filter === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setFilter(c.id as any)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {c.label} ({c.count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Dedicated User Leaderboard Filter & Sort Bar */}
        {filter === 'leaderboard' && (
          <View style={styles.leaderboardToolbar}>
            {/* Row 1: Role Filters & Barangay Sector Filter */}
            <View style={styles.leaderboardFilterRow}>
              <View style={styles.leaderboardRolesScroll}>
                <Text style={styles.catalogFilterHeading}>Role:</Text>
                {[
                  { id: 'all', label: 'All Participants', count: processedLeaderboard.length },
                  { id: 'citizen', label: 'Citizens & Reporters', count: leaderboardCitizenCount },
                  { id: 'driver', label: 'Drivers', count: leaderboardDriverCount },
                ].map((r) => {
                  const active = leaderboardRoleFilter === r.id;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={[styles.catalogCategoryChip, active && styles.catalogCategoryChipActive]}
                      onPress={() => setLeaderboardRoleFilter(r.id as any)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.catalogCategoryChipText, active && styles.catalogCategoryChipTextActive]}>
                        {r.label} ({r.count})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.barangayPickerWrap}>
                <MaterialIcons name="place" size={15} color="#0D9488" />
                <Text style={styles.catalogSortLabel}>Sector:</Text>
                <View style={styles.sortPickerWrap}>
                  <Picker
                    selectedValue={leaderboardBarangayFilter}
                    onValueChange={(val) => setLeaderboardBarangayFilter(val)}
                    style={styles.sortPicker}
                  >
                    <Picker.Item label="📍 All Barangays" value="all" />
                    {DANAO_BARANGAYS.map((b) => (
                      <Picker.Item key={b} label={`Brgy. ${b}`} value={b} />
                    ))}
                  </Picker>
                </View>
              </View>
            </View>

            {/* Row 2: Sort Control & Stats Count */}
            <View style={styles.catalogSortRow}>
              <View style={styles.catalogSortControl}>
                <MaterialIcons name="sort" size={16} color="#0D9488" />
                <Text style={styles.catalogSortLabel}>Sort by:</Text>
                <View style={styles.sortPickerWrap}>
                  <Picker
                    selectedValue={leaderboardSort}
                    onValueChange={(val) => setLeaderboardSort(val as any)}
                    style={styles.sortPicker}
                  >
                    <Picker.Item label="💎 Highest Points (Default)" value="points_desc" />
                    <Picker.Item label="📉 Lowest Points First" value="points_asc" />
                    <Picker.Item label="🏅 Most Awards Conferred" value="awards_desc" />
                    <Picker.Item label="🔤 Name (A - Z)" value="name_asc" />
                  </Picker>
                </View>
              </View>

              <View style={styles.catalogCountBadge}>
                <MaterialIcons name="military-tech" size={14} color="#0F766E" />
                <Text style={styles.catalogCountText}>
                  {filteredLeaderboard.length} Ranked User{filteredLeaderboard.length === 1 ? '' : 's'} · {totalCommunityPoints.toLocaleString()} Total pts
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Dedicated Catalog Filter & Sort Bar */}
        {filter === 'catalog' && (
          <View style={styles.catalogToolbar}>
            {/* Row 1: Category Filter Chips & Add Merch Action */}
            <View style={styles.catalogFilterRow}>
              <View style={styles.catalogCategoriesScroll}>
                <Text style={styles.catalogFilterHeading}>Category:</Text>
                {availableCategories.map((cat) => {
                  const active = catalogCategoryFilter === cat;
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.catalogCategoryChip, active && styles.catalogCategoryChipActive]}
                      onPress={() => setCatalogCategoryFilter(cat)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.catalogCategoryChipText, active && styles.catalogCategoryChipTextActive]}>
                        {cat === 'all' ? 'All' : cat}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={styles.addMerchTopBtn}
                onPress={handleOpenAddMerch}
                activeOpacity={0.8}
              >
                <MaterialIcons name="add-circle" size={16} color="#FFFFFF" />
                <Text style={styles.addMerchTopBtnText}>+ New Item</Text>
              </TouchableOpacity>
            </View>

            {/* Row 2: Sort Selection & Stock Filter */}
            <View style={styles.catalogSortRow}>
              <View style={styles.catalogSortControl}>
                <MaterialIcons name="sort" size={16} color="#0D9488" />
                <Text style={styles.catalogSortLabel}>Sort by:</Text>
                <View style={styles.sortPickerWrap}>
                  <Picker
                    selectedValue={catalogSort}
                    onValueChange={(val) => setCatalogSort(val as any)}
                    style={styles.sortPicker}
                  >
                    <Picker.Item label="🆕 Newly Added (Latest)" value="newest" />
                    <Picker.Item label="🔥 Most Redeemed" value="most_redeemed" />
                    <Picker.Item label="📉 Least Redeemed" value="least_redeemed" />
                    <Picker.Item label="💎 Points: High to Low" value="cost_desc" />
                    <Picker.Item label="🏷️ Points: Low to High" value="cost_asc" />
                    <Picker.Item label="📦 Stock: High to Low" value="stock_desc" />
                    <Picker.Item label="⚠️ Low Stock First" value="stock_asc" />
                    <Picker.Item label="🔤 Name (A - Z)" value="name_asc" />
                  </Picker>
                </View>
              </View>

              <View style={styles.catalogStockPills}>
                <Text style={styles.catalogSortLabel}>Stock:</Text>
                {[
                  { id: 'all', label: 'All' },
                  { id: 'in_stock', label: 'In Stock' },
                  { id: 'out_of_stock', label: 'Out of Stock' },
                ].map((st) => {
                  const active = catalogStockFilter === st.id;
                  return (
                    <TouchableOpacity
                      key={st.id}
                      style={[styles.catalogStockChip, active && styles.catalogStockChipActive]}
                      onPress={() => setCatalogStockFilter(st.id as any)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.catalogStockChipText, active && styles.catalogStockChipTextActive]}>
                        {st.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.catalogCountBadge}>
                <MaterialIcons name="inventory-2" size={13} color="#0F766E" />
                <Text style={styles.catalogCountText}>
                  {displayedCatalog.length} item{displayedCatalog.length === 1 ? '' : 's'} · {totalRedemptionsCount} claimed
                </Text>
              </View>
            </View>
          </View>
        )}

        {loading ? (
          <ActivityIndicator size="large" color="#0D9488" style={{ marginVertical: 24 }} />
        ) : filter === 'catalog' ? (
          /* Merchandise Catalog Grid */
          displayedCatalog.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <MaterialIcons name="storefront" size={40} color="#CBD5E1" />
              <Text style={styles.emptyText}>No merchandise items found matching current criteria.</Text>
              <TouchableOpacity
                style={[styles.addMerchBtn, { marginTop: 12 }]}
                onPress={handleOpenAddMerch}
              >
                <MaterialIcons name="add" size={16} color="#0D9488" />
                <Text style={styles.addMerchBtnText}>Upload First Merch Item</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View
              style={[
                styles.merchGrid,
                Platform.OS === 'web'
                  ? ({
                      display: 'grid',
                      gridTemplateColumns: `repeat(${numColumns}, minmax(0, 1fr))`,
                      gap: '14px',
                      alignItems: 'stretch',
                    } as any)
                  : {},
              ]}
            >
              {displayedCatalog.map((item) => {
                const isOutOfStock = (item.stock ?? 50) <= 0;
                const redeemedCount = getRedemptionCount(item);
                const createdDateStr = getItemCreatedDateText(item);

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.merchAdminCard,
                      Platform.OS !== 'web'
                        ? {
                            width: numColumns > 1 ? `${Math.floor(100 / numColumns) - 2}%` : '100%',
                            flexGrow: 0,
                            flexShrink: 0,
                          }
                        : {
                            width: '100%',
                            minWidth: 0,
                            maxWidth: '100%',
                          },
                    ]}
                  >
                    <View style={styles.merchAdminCardHeader}>
                      <View style={styles.merchAdminCategoryBadge}>
                        <Text style={styles.merchAdminCategoryText}>{item.category || 'General'}</Text>
                      </View>
                      <View style={styles.merchHeaderRightBadges}>
                        <View style={[styles.merchRedeemedBadge, redeemedCount > 0 ? styles.merchRedeemedBadgeActive : null]}>
                          <MaterialIcons
                            name={redeemedCount > 0 ? "local-fire-department" : "redeem"}
                            size={11}
                            color={redeemedCount > 0 ? "#D97706" : "#64748B"}
                          />
                          <Text style={[styles.merchRedeemedText, redeemedCount > 0 ? styles.merchRedeemedTextActive : null]}>
                            {redeemedCount} claimed
                          </Text>
                        </View>
                        <View style={[styles.merchStockBadge, isOutOfStock ? styles.merchStockBadgeOut : styles.merchStockBadgeIn]}>
                          <Text style={[styles.merchStockText, isOutOfStock ? styles.merchStockTextOut : styles.merchStockTextIn]}>
                            {isOutOfStock ? 'Out of Stock' : `${item.stock ?? 50} in stock`}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginVertical: 8, flex: 1 }}>
                      <View style={styles.merchAdminIconWrap}>
                        {item.imageUrl ? (
                          <Image
                            source={{ uri: item.imageUrl }}
                            style={styles.merchAdminCardImg}
                            resizeMode="cover"
                          />
                        ) : (
                          <MaterialIcons
                            name={
                              item.category === 'Apparel' ? 'checkroom' :
                                item.category === 'Eco Kit' ? 'eco' :
                                  item.category === 'Household' ? 'home' :
                                    item.category === 'Voucher' ? 'confirmation-number' :
                                      'card-giftcard'
                            }
                            size={24}
                            color="#0D9488"
                          />
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.merchAdminTitle} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.merchAdminDesc} numberOfLines={2}>{item.type || 'Official Eco-Reward'}</Text>
                        {createdDateStr ? (
                          <Text style={styles.merchAdminDate}>Added {createdDateStr}</Text>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.merchAdminCardFooter}>
                      <View style={styles.merchAdminCostPill}>
                        <MaterialIcons name="stars" size={15} color="#0D9488" />
                        <Text style={styles.merchAdminCostText}>{item.cost?.toLocaleString() || 0} pts</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          style={styles.merchActionBtn}
                          onPress={() => handleOpenEditMerch(item)}
                          accessibilityLabel={`Edit ${item.name}`}
                        >
                          <MaterialIcons name="edit" size={16} color="#475569" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.merchActionBtn, styles.merchDeleteBtn]}
                          onPress={() => handleDeleteMerch(item)}
                          accessibilityLabel={`Delete ${item.name}`}
                        >
                          <MaterialIcons name="delete-outline" size={16} color="#DC2626" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )
        ) : filter === 'leaderboard' ? (
          filteredLeaderboard.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 36 }}>
              <MaterialIcons name="emoji-events" size={44} color="#CBD5E1" />
              <Text style={styles.emptyText}>
                {searchFilter
                  ? `No participants found matching "${searchFilter}".`
                  : 'No municipal participant accounts found.'}
              </Text>
              {(searchFilter || leaderboardBarangayFilter !== 'all' || leaderboardRoleFilter !== 'all') && (
                <TouchableOpacity
                  style={[styles.customPresetChipClear, { marginTop: 12, paddingHorizontal: 12, paddingVertical: 6 }]}
                  onPress={() => {
                    setSearchFilter('');
                    setLeaderboardBarangayFilter('all');
                    setLeaderboardRoleFilter('all');
                  }}
                >
                  <MaterialIcons name="refresh" size={14} color="#DC2626" />
                  <Text style={styles.customPresetChipClearText}>Reset All Filters</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View>
              {/* Podium View for Top 3 (Visible when viewing standard high-to-low ranking without search/filter) */}
              {leaderboardSort === 'points_desc' && !searchFilter && leaderboardBarangayFilter === 'all' && leaderboardRoleFilter === 'all' && (
                <View style={styles.podiumContainer}>
                  {/* Rank 2 (Silver) */}
                  {filteredLeaderboard.length >= 2 && (
                    <TouchableOpacity
                      style={[styles.podiumCol, styles.podiumColSilver]}
                      onPress={() => {
                        setInspectedParticipant(filteredLeaderboard[1]);
                        setDetailModalOpen(true);
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={styles.podiumAvatarWrap}>
                        <View style={[styles.podiumAvatar, { borderColor: '#94A3B8' }]}>
                          <Text style={[styles.podiumAvatarInitials, { color: '#475569' }]}>
                            {filteredLeaderboard[1].name.slice(0, 2).toUpperCase()}
                          </Text>
                        </View>
                        <View style={[styles.podiumRankCircle, { backgroundColor: '#94A3B8' }]}>
                          <Text style={styles.podiumRankText}>2</Text>
                        </View>
                      </View>
                      <Text style={styles.podiumName} numberOfLines={1}>{filteredLeaderboard[1].name}</Text>
                      <Text style={styles.podiumBarangay} numberOfLines={1}>Brgy. {filteredLeaderboard[1].barangay}</Text>
                      <View style={[styles.podiumPointsBadge, { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' }]}>
                        <MaterialIcons name="stars" size={13} color="#64748B" />
                        <Text style={[styles.podiumPointsText, { color: '#334155' }]}>{filteredLeaderboard[1].points.toLocaleString()} pts</Text>
                      </View>
                      <View style={[styles.podiumPillar, styles.podiumPillarSilver]}>
                        <MaterialIcons name="military-tech" size={24} color="#64748B" />
                        <Text style={[styles.podiumPillarText, { color: '#64748B' }]}>2nd Place · Tap for Details</Text>
                      </View>
                    </TouchableOpacity>
                  )}

                  {/* Rank 1 (Gold Champion) */}
                  {filteredLeaderboard.length >= 1 && (
                    <TouchableOpacity
                      style={[styles.podiumCol, styles.podiumColGold]}
                      onPress={() => {
                        setInspectedParticipant(filteredLeaderboard[0]);
                        setDetailModalOpen(true);
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={styles.podiumCrownWrap}>
                        <MaterialIcons name="emoji-events" size={26} color="#F59E0B" />
                      </View>
                      <View style={styles.podiumAvatarWrap}>
                        <View style={[styles.podiumAvatar, { borderColor: '#F59E0B', width: 60, height: 60, borderRadius: 30 }]}>
                          <Text style={[styles.podiumAvatarInitials, { color: '#D97706', fontSize: 18 }]}>
                            {filteredLeaderboard[0].name.slice(0, 2).toUpperCase()}
                          </Text>
                        </View>
                        <View style={[styles.podiumRankCircle, { backgroundColor: '#F59E0B' }]}>
                          <Text style={styles.podiumRankText}>1</Text>
                        </View>
                      </View>
                      <Text style={[styles.podiumName, { fontSize: 14, fontWeight: '800' }]} numberOfLines={1}>{filteredLeaderboard[0].name}</Text>
                      <Text style={styles.podiumBarangay} numberOfLines={1}>Brgy. {filteredLeaderboard[0].barangay}</Text>
                      <View style={[styles.podiumPointsBadge, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                        <MaterialIcons name="stars" size={14} color="#D97706" />
                        <Text style={[styles.podiumPointsText, { color: '#B45309', fontWeight: '900' }]}>{filteredLeaderboard[0].points.toLocaleString()} pts</Text>
                      </View>
                      <View style={[styles.podiumPillar, styles.podiumPillarGold]}>
                        <MaterialIcons name="workspace-premium" size={26} color="#D97706" />
                        <Text style={[styles.podiumPillarText, { color: '#B45309', fontWeight: '900' }]}>Champion · Tap for Details</Text>
                      </View>
                    </TouchableOpacity>
                  )}

                  {/* Rank 3 (Bronze) */}
                  {filteredLeaderboard.length >= 3 && (
                    <TouchableOpacity
                      style={[styles.podiumCol, styles.podiumColBronze]}
                      onPress={() => {
                        setInspectedParticipant(filteredLeaderboard[2]);
                        setDetailModalOpen(true);
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={styles.podiumAvatarWrap}>
                        <View style={[styles.podiumAvatar, { borderColor: '#D97706' }]}>
                          <Text style={[styles.podiumAvatarInitials, { color: '#B45309' }]}>
                            {filteredLeaderboard[2].name.slice(0, 2).toUpperCase()}
                          </Text>
                        </View>
                        <View style={[styles.podiumRankCircle, { backgroundColor: '#D97706' }]}>
                          <Text style={styles.podiumRankText}>3</Text>
                        </View>
                      </View>
                      <Text style={styles.podiumName} numberOfLines={1}>{filteredLeaderboard[2].name}</Text>
                      <Text style={styles.podiumBarangay} numberOfLines={1}>Brgy. {filteredLeaderboard[2].barangay}</Text>
                      <View style={[styles.podiumPointsBadge, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
                        <MaterialIcons name="stars" size={13} color="#D97706" />
                        <Text style={[styles.podiumPointsText, { color: '#92400E' }]}>{filteredLeaderboard[2].points.toLocaleString()} pts</Text>
                      </View>
                      <View style={[styles.podiumPillar, styles.podiumPillarBronze]}>
                        <MaterialIcons name="military-tech" size={24} color="#D97706" />
                        <Text style={[styles.podiumPillarText, { color: '#B45309' }]}>3rd Place · Tap for Details</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Detailed Ranked Table */}
              <ScrollView
                horizontal={true}
                showsHorizontalScrollIndicator={true}
                style={{ width: '100%' }}
                contentContainerStyle={{ width: '100%', minWidth: 960, flexGrow: 1 }}
              >
                <View style={styles.leaderboardTable}>
                  {/* Table Header */}
                  <View style={styles.leaderboardTableHeader}>
                    <Text style={[styles.leaderboardColHeader, { width: 50, textAlign: 'center' }]}>RANK</Text>
                    <Text style={[styles.leaderboardColHeader, { flex: 2.5, minWidth: 180 }]}>MUNICIPAL PARTICIPANT</Text>
                    <Text style={[styles.leaderboardColHeader, { flex: 1.2, minWidth: 110 }]}>ROLE / SECTOR</Text>
                    <Text style={[styles.leaderboardColHeader, { flex: 1.2, minWidth: 110 }]}>BARANGAY</Text>
                    <Text style={[styles.leaderboardColHeader, { flex: 1.0, minWidth: 85, textAlign: 'center' }]}>REPORTS</Text>
                    <Text style={[styles.leaderboardColHeader, { flex: 0.9, minWidth: 80, textAlign: 'center' }]}>AWARDS</Text>
                    <Text style={[styles.leaderboardColHeader, { flex: 1.0, minWidth: 85, textAlign: 'center' }]}>REDEMPTIONS</Text>
                    <Text style={[styles.leaderboardColHeader, { flex: 1.1, minWidth: 105, textAlign: 'center' }]}>ECO-POINTS</Text>
                    <Text style={[styles.leaderboardColHeader, { flex: 1.4, minWidth: 140, textAlign: 'center' }]}>ACTIONS</Text>
                  </View>

                  {/* Rows */}
                  {filteredLeaderboard.map((u, idx) => {
                    const rank = idx + 1;
                    const isTop1 = rank === 1;
                    const isTop2 = rank === 2;
                    const isTop3 = rank === 3;
                    const roleColor = u.role === 'driver' ? '#2563EB' : u.role === 'admin' ? '#7C3AED' : '#0D9488';
                    const roleBg = u.role === 'driver' ? '#EFF6FF' : u.role === 'admin' ? '#F5F3FF' : '#F0FDFA';

                    return (
                      <TouchableOpacity
                        key={u.id}
                        style={[styles.leaderboardRow, isTop1 && styles.leaderboardRowTop1]}
                        onPress={() => {
                          setInspectedParticipant(u);
                          setDetailModalOpen(true);
                        }}
                        activeOpacity={0.7}
                      >
                        {/* Rank */}
                        <View style={{ width: 50, alignItems: 'center' }}>
                          <View style={[
                            styles.rankBadge,
                            isTop1 ? styles.rankBadgeGold : isTop2 ? styles.rankBadgeSilver : isTop3 ? styles.rankBadgeBronze : null
                          ]}>
                            <Text style={[
                              styles.rankBadgeText,
                              isTop1 || isTop2 || isTop3 ? { color: '#FFFFFF', fontWeight: '900' } : null
                            ]}>
                              #{rank}
                            </Text>
                          </View>
                        </View>

                        {/* Participant Details */}
                        <View style={{ flex: 2.5, minWidth: 180, flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 8 }}>
                          <View style={[styles.userAvatarInitials, { backgroundColor: roleBg, borderColor: roleColor }]}>
                            <Text style={[styles.userAvatarInitialsText, { color: roleColor }]}>
                              {u.name.slice(0, 2).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.leaderboardUserName} numberOfLines={1}>{u.name}</Text>
                            <Text style={styles.leaderboardUserSub} numberOfLines={1}>
                              {u.email || (u.employeeId ? `Employee ID: ${u.employeeId}` : 'Verified Citizen Account')}
                            </Text>
                          </View>
                        </View>

                        {/* Role */}
                        <View style={{ flex: 1.2, minWidth: 110 }}>
                          <View style={[styles.leaderboardRoleBadge, { backgroundColor: roleBg }]}>
                            <Text style={[styles.leaderboardRoleBadgeText, { color: roleColor }]} numberOfLines={1}>
                              {u.roleLabel}
                            </Text>
                          </View>
                        </View>

                        {/* Barangay */}
                        <View style={{ flex: 1.2, minWidth: 110, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <MaterialIcons name="place" size={13} color="#64748B" />
                          <Text style={styles.leaderboardBarangayText} numberOfLines={1}>
                            Brgy. {u.barangay}
                          </Text>
                        </View>

                        {/* Citizen Waste Reports */}
                        <View style={{ flex: 1.0, minWidth: 85, alignItems: 'center' }}>
                          {u.resolvedReportsCount > 0 ? (
                            <View style={[styles.awardsConferredBadge, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                              <MaterialIcons name="check-circle" size={12} color="#059669" />
                              <Text style={[styles.awardsConferredBadgeText, { color: '#047857' }]}>
                                {u.resolvedReportsCount} ({u.reportPoints} pts)
                              </Text>
                            </View>
                          ) : (
                            <Text style={styles.noAwardsText}>—</Text>
                          )}
                        </View>

                        {/* Awards Count */}
                        <View style={{ flex: 0.9, minWidth: 80, alignItems: 'center' }}>
                          {u.awardsCount > 0 ? (
                            <View style={styles.awardsConferredBadge}>
                              <MaterialIcons name="military-tech" size={12} color="#0D9488" />
                              <Text style={styles.awardsConferredBadgeText}>{u.awardsCount} Award{u.awardsCount === 1 ? '' : 's'}</Text>
                            </View>
                          ) : (
                            <Text style={styles.noAwardsText}>—</Text>
                          )}
                        </View>

                        {/* Redemptions Count */}
                        <View style={{ flex: 1.0, minWidth: 85, alignItems: 'center' }}>
                          {u.redemptionsCount > 0 ? (
                            <View style={[styles.awardsConferredBadge, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                              <MaterialIcons name="redeem" size={12} color="#D97706" />
                              <Text style={[styles.awardsConferredBadgeText, { color: '#B45309' }]}>
                                {u.redemptionsCount} Claimed
                              </Text>
                            </View>
                          ) : (
                            <Text style={styles.noAwardsText}>0</Text>
                          )}
                        </View>

                        {/* Points */}
                        <View style={{ flex: 1.1, minWidth: 105, alignItems: 'center' }}>
                          <View style={styles.leaderboardPointsPill}>
                            <MaterialIcons name="stars" size={14} color="#0D9488" />
                            <Text style={styles.leaderboardPointsText}>
                              {u.points.toLocaleString()} pts
                            </Text>
                          </View>
                        </View>

                        {/* Actions */}
                        <View style={{ flex: 1.4, minWidth: 140, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          <TouchableOpacity
                            style={styles.quickDetailsBtn}
                            onPress={() => {
                              setInspectedParticipant(u);
                              setDetailModalOpen(true);
                            }}
                            activeOpacity={0.8}
                            accessibilityLabel={`View details for ${u.name}`}
                          >
                            <MaterialIcons name="visibility" size={13} color="#475569" />
                            <Text style={styles.quickDetailsBtnText}>Details</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.quickConferBtn}
                            onPress={() => handleQuickConferFromLeaderboard(u)}
                            activeOpacity={0.8}
                            accessibilityLabel={`Confer award to ${u.name}`}
                          >
                            <MaterialIcons name="emoji-events" size={13} color="#0D9488" />
                            <Text style={styles.quickConferBtnText}>Award</Text>
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )
        ) : displayedAwards.length === 0 && displayedRedemptions.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 32 }}>
            <MaterialIcons name="military-tech" size={40} color="#CBD5E1" />
            <Text style={styles.emptyText}>No reward transactions found matching current criteria.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {/* Awards */}
            {displayedAwards.map((a) => {
              const roleTag = a.recipientRole || (a.reason?.includes('driver') ? 'driver' : 'reporter');
              const roleColor = roleTag === 'driver' ? '#2563EB' : '#0D9488';
              const roleBg = roleTag === 'driver' ? '#EFF6FF' : '#F0FDFA';
              const fy = getItemFiscalYear(a);
              return (
                <View key={a.id} style={styles.txRow}>
                  <View style={[styles.txIconWrap, { backgroundColor: roleBg }]}>
                    <MaterialIcons name="military-tech" size={24} color={roleColor} />
                  </View>
                  <View style={styles.txInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.txTitle}>{a.awardKind || `Tokens Awarded: +${a.tokens || 50}`}</Text>
                      <View style={[styles.roleMiniTag, { backgroundColor: roleBg }]}>
                        <Text style={[styles.roleMiniTagText, { color: roleColor }]}>
                          {roleTag.toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.fyBadge}>
                        <Text style={styles.fyBadgeText}>FY {fy}</Text>
                      </View>
                    </View>
                    <Text style={styles.txSub}>
                      {a.recipientName ? `Recipient: ${a.recipientName} ` : ''}
                      {a.employeeId ? `(ID: ${a.employeeId}) · ` : '· '}
                      {a.reason || 'Verified Waste Stewardship'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.tokenPointsBadge, { color: roleColor }]}>+{a.tokens || 50} pts</Text>
                    <Text style={[styles.txBadgeAward, { backgroundColor: roleBg, color: roleColor }]}>
                      OFFICIAL AWARD
                    </Text>
                  </View>
                </View>
              );
            })}

            {/* Redemptions */}
            {displayedRedemptions.map((r) => {
              const fy = getItemFiscalYear(r);
              return (
                <View key={r.id} style={styles.txRow}>
                  <View style={[styles.txIconWrap, { backgroundColor: '#FEF3C7' }]}>
                    <MaterialIcons name="redeem" size={22} color="#D97706" />
                  </View>
                  <View style={styles.txInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.txTitle}>Redeemed: {r.souvenirName || 'Souvenir'}</Text>
                      <View style={styles.fyBadge}>
                        <Text style={styles.fyBadgeText}>FY {fy}</Text>
                      </View>
                    </View>
                    <Text style={styles.txSub}>Cost: -{r.cost || 500} pts · Recipient: {r.userName || 'Resident'}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.tokenPointsBadge, { color: '#D97706' }]}>-{r.cost || 500} pts</Text>
                    <Text style={styles.txBadgeRedeem}>REDEEMED</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Confer Official Distinction Award Modal */}
      {conferModalOpen && (
        <Modal
          visible={conferModalOpen}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setConferModalOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, isMobile && { width: '96%', maxHeight: '92%' }]}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={styles.modalHeaderIconBadge}>
                    <MaterialIcons name="emoji-events" size={22} color="#0D9488" />
                  </View>
                  <View>
                    <Text style={styles.modalTitle}>Confer Official Distinction Award</Text>
                    <Text style={styles.modalHeaderSub}>Grant official municipal tokens and recognition citation</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setConferModalOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="close" size={22} color="#64748B" />
                </TouchableOpacity>
              </View>

              {/* Pinned Role Picker */}
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.inputLabel}>RECIPIENT CATEGORY / ROLE *</Text>
                <View style={styles.rolePickerRow}>
                  {(['driver', 'reporter'] as const).map((r) => {
                    const active = awardRole === r;
                    return (
                      <TouchableOpacity
                        key={r}
                        style={[styles.rolePickerBtn, active && styles.rolePickerBtnActive]}
                        onPress={() => handleSelectRole(r)}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons
                          name={r === 'driver' ? 'local-shipping' : 'person'}
                          size={16}
                          color={active ? '#FFFFFF' : '#475569'}
                        />
                        <Text style={[styles.rolePickerBtnText, active && styles.rolePickerBtnTextActive]}>
                          {r === 'driver' ? 'Collection Driver' : 'Resident Reporter'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <ScrollView style={{ flexShrink: 1, maxHeight: 420 }} showsVerticalScrollIndicator={true}>
                {/* Award Kind Presets */}
                <Text style={styles.inputLabel}>SELECT KIND OF AWARD</Text>
                <View style={styles.presetList}>
                  {AWARD_PRESETS[awardRole].map((p) => {
                    const isSelected = awardKind === p.title;
                    const isOtherPreset = p.title === 'Other';
                    return (
                      <TouchableOpacity
                        key={p.title}
                        style={[styles.presetCard, isSelected && styles.presetCardActive]}
                        onPress={() => {
                          setAwardKind(p.title);
                          if (isOtherPreset) {
                            if (!awardTokens || awardTokens === '0' || ['100', '200', '250', '300'].includes(awardTokens)) {
                              setAwardTokens('150');
                            }
                          } else {
                            setAwardTokens(String(p.tokens));
                            setCustomAwardTitle('');
                          }
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.presetTitle, isSelected && styles.presetTitleActive]}>
                            {p.title}
                          </Text>
                          <Text style={styles.presetDesc}>{p.desc}</Text>
                        </View>
                        <View style={[styles.presetPointsBadge, isSelected && styles.presetPointsBadgeActive]}>
                          <Text style={[styles.presetPointsText, isSelected && styles.presetPointsTextActive]}>
                            {isOtherPreset ? 'Custom' : `+${p.tokens} pts`}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {awardKind === 'Other' && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.inputLabel}>CUSTOM AWARD TITLE (OPTIONAL)</Text>
                    <TextInput
                      style={styles.modalInput}
                      placeholder="e.g. Special Community Service Honor..."
                      placeholderTextColor="#94A3B8"
                      value={customAwardTitle}
                      onChangeText={setCustomAwardTitle}
                    />
                  </View>
                )}

                {/* Recipient Selection from System Directory */}
                <View style={{ marginTop: 14 }}>
                  <Text style={styles.inputLabel}>SELECT RECIPIENT FROM DIRECTORY *</Text>

                  {/* Active Selected User Card */}
                  {selectedUser ? (
                    <View style={styles.selectedUserCard}>
                      <View style={styles.selectedUserAvatar}>
                        <Text style={styles.selectedUserAvatarText}>
                          {(selectedUser.displayName || selectedUser.name || selectedUser.email || 'U').substring(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedUserName}>
                          {selectedUser.displayName || selectedUser.name || 'Unnamed Recipient'}
                        </Text>
                        <Text style={styles.selectedUserEmail}>{selectedUser.email}</Text>
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                          {selectedUser.employeeId ? (
                            <Text style={styles.selectedUserMeta}>ID: {selectedUser.employeeId}</Text>
                          ) : null}
                          <Text style={styles.selectedUserMeta}>
                            Current Balance: {(selectedUser.points || selectedUser.rewardTokens || 0).toLocaleString()} pts
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedUser(null);
                          setCustomRecipientName('');
                        }}
                        style={styles.clearSelectedUserBtn}
                      >
                        <MaterialIcons name="close" size={16} color="#64748B" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View>
                      {/* Search / Manual Input Field */}
                      <View style={styles.recipientInputWrap}>
                        <MaterialIcons name="person-search" size={18} color="#94A3B8" style={{ marginRight: 8 }} />
                        <TextInput
                          style={styles.recipientTextInput}
                          placeholder={
                            awardRole === 'driver'
                              ? 'Search driver name or ID (or type custom)...'
                              : 'Search resident reporter name...'
                          }
                          placeholderTextColor="#94A3B8"
                          value={customRecipientName || recipientSearch}
                          onChangeText={(val) => {
                            setCustomRecipientName(val);
                            setRecipientSearch(val);
                            setIsUserDropdownOpen(true);
                          }}
                          onFocus={() => setIsUserDropdownOpen(true)}
                        />
                        {(customRecipientName || recipientSearch) ? (
                          <TouchableOpacity
                            onPress={() => {
                              setCustomRecipientName('');
                              setRecipientSearch('');
                              setSelectedUser(null);
                            }}
                          >
                            <MaterialIcons name="close" size={16} color="#94A3B8" />
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      {/* Candidate Suggestions Dropdown */}
                      {(isUserDropdownOpen || recipientSearch.length > 0) && (
                        <View style={styles.candidateDropdown}>
                          <View style={styles.candidateHeader}>
                            <Text style={styles.candidateHeaderText}>
                              REGISTERED {awardRole.toUpperCase()}S IN DANAO DIRECTORY ({candidateUsers.length})
                            </Text>
                            <TouchableOpacity onPress={() => setIsUserDropdownOpen(false)}>
                              <Text style={{ fontSize: 11, color: '#0D9488', fontWeight: '700' }}>Done</Text>
                            </TouchableOpacity>
                          </View>
                          {filteredCandidates.length === 0 ? (
                            <View style={{ padding: 12 }}>
                              <Text style={{ fontSize: 12, color: '#64748B', fontStyle: 'italic' }}>
                                No matching {awardRole}s found in database. Using &quot;{customRecipientName || recipientSearch}&quot; as manual recipient.
                              </Text>
                            </View>
                          ) : (
                            filteredCandidates.map((u) => (
                              <TouchableOpacity
                                key={u.id}
                                style={styles.candidateItem}
                                onPress={() => handleSelectCandidate(u)}
                                activeOpacity={0.7}
                              >
                                <View style={styles.candidateAvatar}>
                                  <Text style={styles.candidateAvatarText}>
                                    {(u.displayName || u.name || u.email || 'U').charAt(0).toUpperCase()}
                                  </Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.candidateName}>{u.displayName || u.name || 'Unnamed'}</Text>
                                  <Text style={styles.candidateEmail}>{u.email}</Text>
                                </View>
                                {u.employeeId ? (
                                  <View style={styles.candidateEmpBadge}>
                                    <Text style={styles.candidateEmpText}>{u.employeeId}</Text>
                                  </View>
                                ) : null}
                              </TouchableOpacity>
                            ))
                          )}
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {/* Token Reward Amount */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                  <Text style={styles.inputLabel}>
                    {awardKind === 'Other' ? 'TOKEN REWARD AMOUNT (EDITABLE)' : 'TOKEN REWARD AMOUNT (FIXED)'}
                  </Text>
                  {awardKind !== 'Other' && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                      <MaterialIcons name="lock" size={12} color="#94A3B8" />
                      <Text style={{ fontSize: 11, color: '#94A3B8', fontWeight: '600' }}>Locked to preset</Text>
                    </View>
                  )}
                </View>
                <View style={[
                  styles.tokenInputWrap,
                  awardKind !== 'Other' && { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' }
                ]}>
                  <MaterialIcons
                    name={awardKind === 'Other' ? "stars" : "lock"}
                    size={18}
                    color={awardKind === 'Other' ? "#0D9488" : "#94A3B8"}
                    style={{ marginRight: 8 }}
                  />
                  <TextInput
                    style={[
                      styles.tokenTextInput,
                      awardKind !== 'Other' && { color: '#64748B' }
                    ]}
                    keyboardType="numeric"
                    editable={awardKind === 'Other'}
                    placeholder={awardKind === 'Other' ? "Tokens (e.g. 150)" : "Points"}
                    placeholderTextColor="#94A3B8"
                    value={awardTokens}
                    onChangeText={setAwardTokens}
                  />
                  <Text style={[styles.tokenPointsUnit, awardKind !== 'Other' && { color: '#94A3B8' }]}>POINTS</Text>
                </View>

                {/* Commendation Note */}
                <Text style={[styles.inputLabel, { marginTop: 12 }]}>OFFICIAL COMMENDATION / CITATION NOTE (OPTIONAL)</Text>
                <TextInput
                  style={[styles.modalInput, { height: 64, textAlignVertical: 'top' }]}
                  multiline
                  placeholder="Specific operational achievement, field performance, or excellence note..."
                  placeholderTextColor="#94A3B8"
                  value={citationNote}
                  onChangeText={setCitationNote}
                />
              </ScrollView>

              {/* Modal Actions */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setConferModalOpen(false)}
                  disabled={isConferring}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveBtn, isConferring && { opacity: 0.7 }]}
                  onPress={handleConferAward}
                  disabled={isConferring}
                  activeOpacity={0.85}
                >
                  {isConferring ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.saveBtnText}>Conferring…</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="verified" size={16} color="#FFFFFF" />
                      <Text style={styles.saveBtnText}>Confer Distinction</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Upload / Edit Merchandise Item Modal */}
      {merchModalOpen && (
        <Modal
          visible={merchModalOpen}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setMerchModalOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, isMobile && { width: '96%', maxHeight: '92%' }]}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={styles.modalHeaderIconBadge}>
                    <MaterialIcons name="shopping-bag" size={22} color="#0D9488" />
                  </View>
                  <View>
                    <Text style={styles.modalTitle}>
                      {editingMerch ? 'Edit Merchandise Item' : 'Upload Eco-Store Merchandise'}
                    </Text>
                    <Text style={styles.modalHeaderSub}>
                      Item will be instantly visible to residents for token redemptions
                    </Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setMerchModalOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="close" size={22} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flexShrink: 1, maxHeight: isMobile ? 440 : 520 }} showsVerticalScrollIndicator={true}>
                {/* Photo / Image Upload Section */}
                <Text style={styles.inputLabel}>MERCHANDISE PHOTO (OPTIONAL)</Text>
                {isUploadingImage ? (
                  <View style={styles.imageUploadingCard}>
                    <ActivityIndicator size="small" color="#0D9488" />
                    <Text style={styles.imageUploadingText}>Uploading photo to cloud…</Text>
                  </View>
                ) : merchImage ? (
                  <View style={styles.imagePreviewCard}>
                    <Image source={{ uri: merchImage }} style={styles.imagePreviewThumb} resizeMode="cover" />
                    <View style={styles.imagePreviewInfo}>
                      <View style={styles.imagePreviewBadge}>
                        <MaterialIcons name="check-circle" size={12} color="#15803D" />
                        <Text style={styles.imagePreviewBadgeText}>Photo Ready</Text>
                      </View>
                      <Text style={styles.imagePreviewTitle} numberOfLines={1}>
                        {merchName.trim() || 'Merchandise Preview'}
                      </Text>
                      <View style={styles.imagePreviewActions}>
                        <TouchableOpacity
                          style={styles.imageActionBtn}
                          onPress={handlePickMerchImage}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons name="photo-camera" size={13} color="#0D9488" />
                          <Text style={styles.imageActionBtnText}>Change</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.imageActionBtn, styles.imageRemoveBtn]}
                          onPress={handleRemoveMerchImage}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons name="delete-outline" size={13} color="#DC2626" />
                          <Text style={[styles.imageActionBtnText, styles.imageRemoveBtnText]}>Remove</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.imageActionBtn}
                          onPress={() => setShowImageUrlInput(!showImageUrlInput)}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons name="link" size={13} color="#64748B" />
                          <Text style={styles.imageActionBtnText}>Edit URL</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.imageDropzone}
                    onPress={handlePickMerchImage}
                    activeOpacity={0.7}
                  >
                    <View style={styles.imageDropzoneIconWrap}>
                      <MaterialIcons name="add-photo-alternate" size={24} color="#0D9488" />
                    </View>
                    <Text style={styles.imageDropzoneTitle}>Upload Item Photo</Text>
                    <Text style={styles.imageDropzoneSub}>Tap to browse photo from gallery or files (1:1 recommended)</Text>
                  </TouchableOpacity>
                )}

                {/* Optional direct URL input */}
                {(!merchImage || showImageUrlInput) && (
                  <View style={{ marginTop: 6, marginBottom: 4 }}>
                    <TouchableOpacity
                      style={styles.imageUrlToggleBtn}
                      onPress={() => setShowImageUrlInput(!showImageUrlInput)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name={showImageUrlInput ? "unfold-less" : "link"} size={14} color="#0D9488" />
                      <Text style={styles.imageUrlToggleText}>
                        {showImageUrlInput ? 'Hide image link input' : 'Or paste direct image web link'}
                      </Text>
                    </TouchableOpacity>
                    {showImageUrlInput && (
                      <TextInput
                        style={[styles.modalInput, { marginTop: 6 }]}
                        placeholder="https://images.example.com/item.jpg"
                        placeholderTextColor="#94A3B8"
                        value={merchImage}
                        onChangeText={setMerchImage}
                        autoCapitalize="none"
                      />
                    )}
                  </View>
                )}

                {/* Item Name */}
                <Text style={[styles.inputLabel, { marginTop: 12 }]}>MERCHANDISE / SOUVENIR NAME *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. Eco-Friendly Tumbler, Canvas Tote, Bamboo Utensils..."
                  placeholderTextColor="#94A3B8"
                  value={merchName}
                  onChangeText={setMerchName}
                />

                {/* Category Picker */}
                <Text style={[styles.inputLabel, { marginTop: 14 }]}>CATEGORY *</Text>
                <View style={styles.merchCategoryRow}>
                  {['Merchandise', 'Apparel', 'Eco Kit', 'Household', 'Voucher'].map((cat) => {
                    const active = merchCategory === cat;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.merchCategoryPill, active && styles.merchCategoryPillActive]}
                        onPress={() => setMerchCategory(cat)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.merchCategoryPillText, active && styles.merchCategoryPillTextActive]}>
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Item Details / Specifications */}
                <Text style={[styles.inputLabel, { marginTop: 14 }]}>SPECIFICATION / DESCRIPTION (OPTIONAL)</Text>
                <TextInput
                  style={[styles.modalInput, styles.modalInputMultiline]}
                  multiline
                  placeholder="e.g. Matte Green, Double-walled insulation, 500ml capacity..."
                  placeholderTextColor="#94A3B8"
                  value={merchType}
                  onChangeText={setMerchType}
                />

                {/* Cost and Stock row */}
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>TOKEN COST (PTS) *</Text>
                    <View style={styles.tokenInputWrap}>
                      <MaterialIcons name="stars" size={18} color="#0D9488" style={{ marginRight: 6 }} />
                      <TextInput
                        style={styles.tokenTextInput}
                        keyboardType="numeric"
                        placeholder="Cost (e.g. 1000)"
                        placeholderTextColor="#94A3B8"
                        value={merchCost}
                        onChangeText={setMerchCost}
                      />
                      <Text style={styles.tokenPointsUnit}>PTS</Text>
                    </View>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>AVAILABLE STOCK *</Text>
                    <View style={styles.tokenInputWrap}>
                      <MaterialIcons name="inventory" size={18} color="#64748B" style={{ marginRight: 6 }} />
                      <TextInput
                        style={styles.tokenTextInput}
                        keyboardType="numeric"
                        placeholder="Stock (e.g. 50)"
                        placeholderTextColor="#94A3B8"
                        value={merchStock}
                        onChangeText={setMerchStock}
                      />
                      <Text style={[styles.tokenPointsUnit, { color: '#64748B' }]}>UNITS</Text>
                    </View>
                  </View>
                </View>
              </ScrollView>

              {/* Modal Actions */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setMerchModalOpen(false)}
                  disabled={isSavingMerch}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveBtn, isSavingMerch && { opacity: 0.7 }]}
                  onPress={handleSaveMerch}
                  disabled={isSavingMerch}
                  activeOpacity={0.85}
                >
                  {isSavingMerch ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.saveBtnText}>Saving…</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name={editingMerch ? "save" : "publish"} size={16} color="#FFFFFF" />
                      <Text style={styles.saveBtnText}>
                        {editingMerch ? 'Save Changes' : 'Publish to Eco-Store'}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Participant Details & Eco-Points Ledger Modal */}
      {detailModalOpen && inspectedParticipant && (
        <Modal
          visible={detailModalOpen}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setDetailModalOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.detailModalBox, isMobile && { width: '96%', maxHeight: '92%' }]}>
              {/* Header */}
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={[styles.modalHeaderIconBadge, { backgroundColor: '#F0FDFA', borderColor: '#CCFBF1' }]}>
                    <MaterialIcons name="badge" size={22} color="#0D9488" />
                  </View>
                  <View>
                    <Text style={styles.modalTitle}>Participant Profile & Ledger</Text>
                    <Text style={styles.modalHeaderSub}>Official points breakdown, distinction history, and redemptions</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setDetailModalOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="close" size={22} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={true}>
                {/* User Identity Header Card */}
                <View style={styles.detailUserCard}>
                  <View style={[
                    styles.detailUserAvatar,
                    inspectedParticipant.role === 'driver'
                      ? { backgroundColor: '#EFF6FF', borderColor: '#2563EB' }
                      : inspectedParticipant.role === 'admin'
                      ? { backgroundColor: '#F5F3FF', borderColor: '#7C3AED' }
                      : { backgroundColor: '#F0FDFA', borderColor: '#0D9488' }
                  ]}>
                    <Text style={[
                      styles.detailUserAvatarText,
                      inspectedParticipant.role === 'driver'
                        ? { color: '#2563EB' }
                        : inspectedParticipant.role === 'admin'
                        ? { color: '#7C3AED' }
                        : { color: '#0D9488' }
                    ]}>
                      {inspectedParticipant.name.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={styles.detailUserName}>{inspectedParticipant.name}</Text>
                      <View style={[
                        styles.leaderboardRoleBadge,
                        inspectedParticipant.role === 'driver'
                          ? { backgroundColor: '#EFF6FF' }
                          : inspectedParticipant.role === 'admin'
                          ? { backgroundColor: '#F5F3FF' }
                          : { backgroundColor: '#F0FDFA' }
                      ]}>
                        <Text style={[
                          styles.leaderboardRoleBadgeText,
                          inspectedParticipant.role === 'driver'
                            ? { color: '#2563EB' }
                            : inspectedParticipant.role === 'admin'
                            ? { color: '#7C3AED' }
                            : { color: '#0D9488' }
                        ]}>
                          {inspectedParticipant.roleLabel}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.detailUserEmail}>{inspectedParticipant.email || 'No registered email'}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <MaterialIcons name="place" size={13} color="#64748B" />
                        <Text style={styles.detailUserMeta}>Brgy. {inspectedParticipant.barangay}</Text>
                      </View>
                      {inspectedParticipant.employeeId ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <MaterialIcons name="badge" size={13} color="#64748B" />
                          <Text style={styles.detailUserMeta}>ID: {inspectedParticipant.employeeId}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>

                {/* 5-Item Metric Summary Grid */}
                <View style={styles.detailMetricsGrid}>
                  <View style={styles.detailMetricCard}>
                    <Text style={styles.detailMetricLabel}>CURRENT BALANCE</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <MaterialIcons name="stars" size={18} color="#0D9488" />
                      <Text style={[styles.detailMetricValue, { color: '#0D9488' }]}>
                        {inspectedParticipant.points.toLocaleString()} pts
                      </Text>
                    </View>
                    <Text style={styles.detailMetricSub}>Active Available Tokens</Text>
                  </View>

                  <View style={styles.detailMetricCard}>
                    <Text style={styles.detailMetricLabel}>WASTE REPORTS</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <MaterialIcons name="check-circle" size={18} color="#059669" />
                      <Text style={[styles.detailMetricValue, { color: '#059669' }]}>
                        {inspectedParticipant.resolvedReportsCount}
                      </Text>
                    </View>
                    <Text style={styles.detailMetricSub}>+{inspectedParticipant.reportPoints} pts earned</Text>
                  </View>

                  <View style={styles.detailMetricCard}>
                    <Text style={styles.detailMetricLabel}>AWARDS CONFERRED</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <MaterialIcons name="military-tech" size={18} color="#2563EB" />
                      <Text style={[styles.detailMetricValue, { color: '#2563EB' }]}>
                        {inspectedParticipant.awardsCount}
                      </Text>
                    </View>
                    <Text style={styles.detailMetricSub}>+{inspectedParticipant.conferredTokens} pts granted</Text>
                  </View>

                  <View style={styles.detailMetricCard}>
                    <Text style={styles.detailMetricLabel}>REDEMPTIONS</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <MaterialIcons name="redeem" size={18} color="#D97706" />
                      <Text style={[styles.detailMetricValue, { color: '#D97706' }]}>
                        {inspectedParticipant.redemptionsCount}
                      </Text>
                    </View>
                    <Text style={styles.detailMetricSub}>-{inspectedParticipant.redeemedCost} pts spent</Text>
                  </View>

                  <View style={styles.detailMetricCard}>
                    <Text style={styles.detailMetricLabel}>CITY STANDING</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <MaterialIcons name="leaderboard" size={18} color="#7C3AED" />
                      <Text style={[styles.detailMetricValue, { color: '#7C3AED' }]}>
                        #{filteredLeaderboard.findIndex(p => p.id === inspectedParticipant.id) + 1}
                      </Text>
                    </View>
                    <Text style={styles.detailMetricSub}>of {filteredLeaderboard.length} Ranked Users</Text>
                  </View>
                </View>

                {/* Section 0: Citizen Waste Reports & Cleanups */}
                {inspectedParticipant.role !== 'driver' && (
                  <View style={[styles.detailSectionWrap, { marginBottom: 16 }]}>
                    <View style={styles.detailSectionHeaderRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <MaterialIcons name="fact-check" size={18} color="#059669" />
                        <Text style={styles.detailSectionTitle}>Citizen Waste Reports & Cleanups</Text>
                      </View>
                      <View style={[styles.awardsConferredBadge, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                        <Text style={[styles.awardsConferredBadgeText, { color: '#047857' }]}>
                          {inspectedParticipant.resolvedReportsCount} Resolved (+{inspectedParticipant.reportPoints} pts)
                        </Text>
                      </View>
                    </View>

                    {inspectedParticipant.userReports.length === 0 ? (
                      <View style={styles.detailEmptyCard}>
                        <MaterialIcons name="fact-check" size={28} color="#CBD5E1" />
                        <Text style={styles.detailEmptyText}>No citizen waste reports recorded yet.</Text>
                      </View>
                    ) : (
                      <View style={{ gap: 8 }}>
                        {inspectedParticipant.userReports.map((rep: any, rIdx: number) => {
                          const isResolved = ['resolved', 'completed', 'cleaned', 'done'].includes(String(rep.status || '').toLowerCase());
                          const dateStr = rep.createdAt?.toDate ? rep.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
                          return (
                            <View key={rep.id || rIdx} style={styles.detailAwardRow}>
                              <View style={[styles.detailAwardIconWrap, { backgroundColor: isResolved ? '#ECFDF5' : '#FEF3C7' }]}>
                                <MaterialIcons name={isResolved ? "check-circle" : "pending"} size={18} color={isResolved ? "#059669" : "#D97706"} />
                              </View>
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <Text style={styles.detailAwardTitle}>{rep.title || rep.wasteCategory || 'Waste Pickup Report'}</Text>
                                  <View style={[styles.fyBadge, { backgroundColor: isResolved ? '#ECFDF5' : '#FEF3C7' }]}>
                                    <Text style={[styles.fyBadgeText, { color: isResolved ? '#047857' : '#B45309' }]}>
                                      {isResolved ? 'Resolved' : (rep.status || 'Pending')}
                                    </Text>
                                  </View>
                                </View>
                                <Text style={styles.detailAwardReason}>{rep.street ? `${rep.street}, Brgy. ${rep.barangay || ''}` : `Brgy. ${rep.barangay || ''}`}</Text>
                                <Text style={styles.detailAwardMeta}>Reported {dateStr}</Text>
                              </View>
                              <View style={[styles.detailAwardPointsWrap, { backgroundColor: isResolved ? '#ECFDF5' : '#F1F5F9' }]}>
                                <Text style={[styles.detailAwardPointsText, { color: isResolved ? '#047857' : '#94A3B8' }]}>
                                  {isResolved ? `+${rep.rewardPoints || 50} pts` : '+0 pts'}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}

                {/* Section 1: Official Distinction Citations History */}
                <View style={styles.detailSectionWrap}>
                  <View style={styles.detailSectionHeaderRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="military-tech" size={18} color="#0D9488" />
                      <Text style={styles.detailSectionTitle}>Official Distinction Citations</Text>
                    </View>
                    <View style={[styles.awardsConferredBadge, { backgroundColor: '#F0FDFA' }]}>
                      <Text style={styles.awardsConferredBadgeText}>{inspectedParticipant.awardsCount} Conferred</Text>
                    </View>
                  </View>

                  {inspectedParticipant.userAwards.length === 0 ? (
                    <View style={styles.detailEmptyCard}>
                      <MaterialIcons name="military-tech" size={28} color="#CBD5E1" />
                      <Text style={styles.detailEmptyText}>No official distinction awards recorded yet.</Text>
                      <TouchableOpacity
                        style={[styles.quickConferBtn, { marginTop: 8 }]}
                        onPress={() => {
                          const target = inspectedParticipant;
                          setDetailModalOpen(false);
                          handleQuickConferFromLeaderboard(target);
                        }}
                      >
                        <MaterialIcons name="emoji-events" size={14} color="#0D9488" />
                        <Text style={styles.quickConferBtnText}>Confer First Award</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {inspectedParticipant.userAwards.map((a: any, aIdx: number) => {
                        const dateStr = a.awardedAt?.toDate ? a.awardedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
                        const fy = getItemFiscalYear(a);
                        return (
                          <View key={a.id || aIdx} style={styles.detailAwardRow}>
                            <View style={styles.detailAwardIconWrap}>
                              <MaterialIcons name="emoji-events" size={20} color="#0D9488" />
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <Text style={styles.detailAwardTitle}>{a.awardKind || 'Distinction Award'}</Text>
                                <View style={styles.fyBadge}>
                                  <Text style={styles.fyBadgeText}>FY {fy}</Text>
                                </View>
                              </View>
                              <Text style={styles.detailAwardReason}>{a.reason || 'Official Stewardship Distinction'}</Text>
                              <Text style={styles.detailAwardMeta}>Awarded {dateStr} by {a.conferredBy || 'CICTO & CENRO'}</Text>
                            </View>
                            <View style={styles.detailAwardPointsWrap}>
                              <Text style={styles.detailAwardPointsText}>+{a.tokens || 0} pts</Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>

                {/* Section 2: Store Merchandise Redemptions */}
                <View style={[styles.detailSectionWrap, { marginTop: 16 }]}>
                  <View style={styles.detailSectionHeaderRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="storefront" size={18} color="#D97706" />
                      <Text style={styles.detailSectionTitle}>Eco-Store Redemptions</Text>
                    </View>
                    <View style={[styles.awardsConferredBadge, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                      <Text style={[styles.awardsConferredBadgeText, { color: '#B45309' }]}>
                        {inspectedParticipant.redemptionsCount} Claimed
                      </Text>
                    </View>
                  </View>

                  {inspectedParticipant.userRedemptions.length === 0 ? (
                    <View style={styles.detailEmptyCard}>
                      <MaterialIcons name="redeem" size={28} color="#CBD5E1" />
                      <Text style={styles.detailEmptyText}>No merchandise items redeemed yet.</Text>
                    </View>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {inspectedParticipant.userRedemptions.map((r: any, rIdx: number) => {
                        const dateStr = r.redeemedAt?.toDate ? r.redeemedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
                        return (
                          <View key={r.id || rIdx} style={styles.detailRedeemRow}>
                            <View style={[styles.detailAwardIconWrap, { backgroundColor: '#FEF3C7' }]}>
                              <MaterialIcons name="redeem" size={18} color="#D97706" />
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={styles.detailAwardTitle}>{r.souvenirName || 'Eco-Reward Souvenir'}</Text>
                              <Text style={styles.detailAwardMeta}>Claimed {dateStr} · Status: Verified</Text>
                            </View>
                            <View style={[styles.detailAwardPointsWrap, { backgroundColor: '#FEF3C7' }]}>
                              <Text style={[styles.detailAwardPointsText, { color: '#B45309' }]}>-{r.cost || 0} pts</Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              </ScrollView>

              {/* Modal Actions */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setDetailModalOpen(false)}
                >
                  <Text style={styles.cancelBtnText}>Close</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={() => {
                    const target = inspectedParticipant;
                    setDetailModalOpen(false);
                    handleQuickConferFromLeaderboard(target);
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="emoji-events" size={16} color="#FFFFFF" />
                    <Text style={styles.saveBtnText}>Confer Distinction Award</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* 3-Format Export Modal (PDF, Excel, CSV) */}
      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title={exportModalTitle}
        dataCount={exportModalCount}
        onExport={handleExport}
        description={exportModalDescription}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 28 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 22,
    flexWrap: 'wrap',
  },
  eyebrow: {
    fontSize: 10.5,
    fontWeight: '900',
    color: '#0D9488',
    letterSpacing: 1.1,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 5,
  },
  sub: { fontSize: 12.5, color: '#64748B', marginTop: 4 },
  statsRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  statCard: {
    flex: 1,
    minWidth: 180,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 18,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#64748B',
    letterSpacing: 0.8,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '900',
    marginTop: 6,
  },
  statSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 240,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    color: '#0F172A',
    padding: 0,
  },
  filterChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  filterChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  list: {
    gap: 10,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    gap: 12,
  },
  txIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txInfo: {
    flex: 1,
  },
  txTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  txSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  txBadgeAward: {
    fontSize: 9.5,
    fontWeight: '900',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
    letterSpacing: 0.4,
  },
  txBadgeRedeem: {
    fontSize: 9.5,
    fontWeight: '900',
    color: '#D97706',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
    letterSpacing: 0.4,
  },
  emptyText: {
    fontSize: 12.5,
    color: '#94A3B8',
    fontStyle: 'italic',
    marginTop: 8,
  },
  conferBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0D9488',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 9,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  conferBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  roleMiniTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleMiniTagText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  tokenPointsBadge: {
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalBox: {
    width: '100%',
    maxWidth: 540,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalHeaderIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  modalHeaderSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  inputLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  rolePickerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  rolePickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  rolePickerBtnActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  rolePickerBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  rolePickerBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  presetList: {
    gap: 8,
  },
  presetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  presetCardActive: {
    borderColor: '#0D9488',
    backgroundColor: '#F0FDFA',
  },
  presetTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  presetTitleActive: {
    color: '#0F766E',
  },
  presetDesc: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 14,
  },
  presetPointsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
    marginLeft: 8,
  },
  presetPointsBadgeActive: {
    backgroundColor: '#CCFBF1',
  },
  presetPointsText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  presetPointsTextActive: {
    color: '#0F766E',
  },
  selectedUserCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F0FDFA',
    borderWidth: 1.5,
    borderColor: '#99F6E4',
  },
  selectedUserAvatar: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#0D9488',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedUserAvatarText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  selectedUserName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  selectedUserEmail: {
    fontSize: 11,
    color: '#64748B',
  },
  selectedUserMeta: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#0D9488',
  },
  clearSelectedUserBtn: {
    padding: 6,
  },
  recipientInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recipientTextInput: {
    flex: 1,
    fontSize: 12.5,
    color: '#0F172A',
    padding: 0,
  },
  candidateDropdown: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 160,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  candidateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  candidateHeaderText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
  },
  candidateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  candidateAvatar: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  candidateAvatarText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  candidateName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  candidateEmail: {
    fontSize: 10.5,
    color: '#64748B',
  },
  candidateEmpBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  candidateEmpText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  tokenInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  tokenTextInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  tokenPointsUnit: {
    fontSize: 10.5,
    fontWeight: '900',
    color: '#0D9488',
    letterSpacing: 0.4,
    flexShrink: 0,
    marginLeft: 4,
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 12.5,
    color: '#0F172A',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  modalInputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
    paddingTop: 10,
    paddingBottom: 10,
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  saveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#0D9488',
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  // Export and Add Merch Buttons
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#0D9488',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
  },
  exportBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0D9488',
  },
  addMerchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDFA',
    borderWidth: 1.5,
    borderColor: '#0D9488',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
  },
  addMerchBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0D9488',
  },
  // Fiscal Year Filter Controls
  fyFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  fyFilterLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    marginRight: 2,
  },
  fyPill: {
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  fyPillActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  fyPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  fyPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  fyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  fyBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
  },
  // Custom Date Range Bar Styles
  customDateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  customDateBarTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#0F766E',
  },
  customDateInputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  customDateInputLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  customDateInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    fontSize: 12,
    color: '#0F172A',
    minWidth: 115,
  },
  customDateToText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '700',
  },
  customDateNativeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    minWidth: 110,
  },
  customDateNativeBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#0F172A',
  },
  customDatePresetsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginLeft: 4,
  },
  customPresetChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  customPresetChipText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#0369A1',
  },
  customPresetChipClear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  customPresetChipClearText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#DC2626',
  },
  // Merch Admin Cards & Grid
  merchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  merchAdminCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    boxSizing: 'border-box' as any,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  merchHeaderRightBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  merchRedeemedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  merchRedeemedBadgeActive: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  merchRedeemedText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
  },
  merchRedeemedTextActive: {
    color: '#B45309',
  },
  merchAdminDate: {
    fontSize: 9.5,
    color: '#94A3B8',
    marginTop: 2,
    fontWeight: '600',
  },
  // Catalog Toolbar Styles
  catalogToolbar: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  catalogFilterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  catalogCategoriesScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  catalogFilterHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
    marginRight: 4,
  },
  catalogCategoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  catalogCategoryChipActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  catalogCategoryChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  catalogCategoryChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  addMerchTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0D9488',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  addMerchTopBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  catalogSortRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  catalogSortControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  catalogSortLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  sortPickerWrap: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 7,
    overflow: 'hidden',
    minWidth: 200,
    height: 34,
    justifyContent: 'center',
  },
  sortPicker: {
    height: 34,
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '700',
    paddingHorizontal: 8,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  catalogStockPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  catalogStockChip: {
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  catalogStockChipActive: {
    backgroundColor: '#1E293B',
    borderColor: '#1E293B',
  },
  catalogStockChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  catalogStockChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  catalogCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 6,
  },
  catalogCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
  },
  merchAdminCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  merchAdminCategoryBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
  },
  merchAdminCategoryText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0369A1',
  },
  merchStockBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
  },
  merchStockBadgeIn: {
    backgroundColor: '#DCFCE7',
  },
  merchStockBadgeOut: {
    backgroundColor: '#FEE2E2',
  },
  merchStockText: {
    fontSize: 10,
    fontWeight: '800',
  },
  merchStockTextIn: {
    color: '#15803D',
  },
  merchStockTextOut: {
    color: '#B91C1C',
  },
  merchAdminIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  merchAdminTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  merchAdminDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 14,
  },
  merchAdminCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  merchAdminCostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  merchAdminCostText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0F766E',
  },
  merchActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 7,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  merchDeleteBtn: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  // Merch Modal Category Pills
  merchCategoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  merchCategoryPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  merchCategoryPillActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  merchCategoryPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  merchCategoryPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  // Image Upload & Preview Styles
  imageDropzone: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  imageDropzoneIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  imageDropzoneTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  imageDropzoneSub: {
    fontSize: 11,
    color: '#64748B',
  },
  imageUploadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    borderRadius: 12,
    paddingVertical: 18,
  },
  imageUploadingText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F766E',
  },
  imagePreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 10,
  },
  imagePreviewThumb: {
    width: 66,
    height: 66,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
  },
  imagePreviewInfo: {
    flex: 1,
  },
  imagePreviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  imagePreviewBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
  },
  imagePreviewTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1E293B',
  },
  imagePreviewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  imageActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  imageActionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  imageRemoveBtn: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  imageRemoveBtnText: {
    color: '#DC2626',
  },
  imageUrlToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  imageUrlToggleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0D9488',
  },
  merchAdminCardImg: {
    width: '100%',
    height: '100%',
    borderRadius: 9,
  },
  // Leaderboard Toolbar & Podium
  leaderboardToolbar: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  leaderboardFilterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  leaderboardRolesScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  barangayPickerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  podiumContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 14,
    paddingVertical: 18,
    paddingHorizontal: 8,
    marginBottom: 20,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  podiumCol: {
    flex: 1,
    maxWidth: 180,
    alignItems: 'center',
  },
  podiumColGold: {
    maxWidth: 200,
  },
  podiumColSilver: {},
  podiumColBronze: {},
  podiumCrownWrap: {
    marginBottom: 4,
  },
  podiumAvatarWrap: {
    position: 'relative',
    marginBottom: 8,
  },
  podiumAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  podiumAvatarInitials: {
    fontSize: 16,
    fontWeight: '800',
  },
  podiumRankCircle: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  podiumRankText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  podiumName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 2,
  },
  podiumBarangay: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 6,
  },
  podiumPointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  podiumPointsText: {
    fontSize: 11.5,
    fontWeight: '800',
  },
  podiumPillar: {
    width: '100%',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 2,
  },
  podiumPillarGold: {
    height: 96,
    backgroundColor: '#FEF3C7',
    borderWidth: 1.5,
    borderColor: '#FDE68A',
  },
  podiumPillarSilver: {
    height: 76,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  podiumPillarBronze: {
    height: 64,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  podiumPillarText: {
    fontSize: 11,
    fontWeight: '800',
  },
  leaderboardTable: {
    width: '100%',
    minWidth: 960,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  leaderboardTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  leaderboardColHeader: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  leaderboardRowTop1: {
    backgroundColor: '#FEFCE815',
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeGold: {
    backgroundColor: '#F59E0B',
  },
  rankBadgeSilver: {
    backgroundColor: '#94A3B8',
  },
  rankBadgeBronze: {
    backgroundColor: '#D97706',
  },
  rankBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
  },
  userAvatarInitials: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  userAvatarInitialsText: {
    fontSize: 12,
    fontWeight: '800',
  },
  leaderboardUserName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  leaderboardUserSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  leaderboardRoleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  leaderboardRoleBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  leaderboardBarangayText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  awardsConferredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  awardsConferredBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#0D9488',
  },
  noAwardsText: {
    fontSize: 12,
    color: '#CBD5E1',
    fontWeight: '600',
  },
  leaderboardPointsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  leaderboardPointsText: {
    fontSize: 12.5,
    fontWeight: '900',
    color: '#0F766E',
  },
  quickConferBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#0D9488',
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 6,
  },
  quickConferBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0D9488',
  },
  quickDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 6,
  },
  quickDetailsBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  detailModalBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: 640,
    maxWidth: '96%',
    maxHeight: '90%',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  detailUserCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  detailUserAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailUserAvatarText: {
    fontSize: 18,
    fontWeight: '800',
  },
  detailUserName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  detailUserEmail: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  detailUserMeta: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  detailMetricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18,
  },
  detailMetricCard: {
    flex: 1,
    minWidth: 130,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
  },
  detailMetricLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  detailMetricValue: {
    fontSize: 15,
    fontWeight: '900',
  },
  detailMetricSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  detailSectionWrap: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 14,
  },
  detailSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  detailSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  detailEmptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  detailEmptyText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  detailAwardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  detailAwardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0FDFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailAwardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  detailAwardReason: {
    fontSize: 11,
    color: '#334155',
    marginTop: 1,
  },
  detailAwardMeta: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  detailAwardPointsWrap: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#F0FDFA',
  },
  detailAwardPointsText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0D9488',
  },
  detailRedeemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
});
