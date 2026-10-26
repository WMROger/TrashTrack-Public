import { useAuthContext } from '@/components/AuthContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { MaterialIcons } from '@expo/vector-icons';
import { db } from '@/config/firebase';
import {
  BarangayRankEntry,
  fetchBarangayLeaderboard,
  getBarangaySpotlight,
} from '@/services/barangayLeaderboardService';
import {
  RewardSouvenir,
} from '@/services/rewardService';
import { formatAdaptiveMassFromMetricTons } from '@/utils/wasteUnits';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where, updateDoc, serverTimestamp } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { isImageFile } from '@/utils/cloudinaryHelpers';
import { cloudinaryService } from '@/services/cloudinaryService';

export default function ProfilePage() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const router = useRouter();
  const { reupload } = useLocalSearchParams<{ reupload?: string }>();

  useEffect(() => {
    if (reupload === 'true') {
      setIsReuploadModalVisible(true);
    }
  }, [reupload]);

  const [leaderboardList, setLeaderboardList] = useState<BarangayRankEntry[]>([]);
  const [displayLimit, setDisplayLimit] = useState<number>(5);
  const [hasMoreData, setHasMoreData] = useState<boolean>(false);
  const [allBarangays, setAllBarangays] = useState<BarangayRankEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'myBarangay'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [userRank, setUserRank] = useState<{ rank: number; points: number; pointsToNext: number }>({
    rank: 0,
    points: 0,
    pointsToNext: 0,
  });
  const [recentActivity, setRecentActivity] = useState<any>(null);
  const [userBarangay, setUserBarangay] = useState<string>('');
  const [verificationStatus, setVerificationStatus] = useState<string>('unsubmitted');
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [isReuploadModalVisible, setIsReuploadModalVisible] = useState(false);
  const [reuploadImageUri, setReuploadImageUri] = useState<string>('');
  const [reuploadIdType, setReuploadIdType] = useState<string>('Barangay Certificate of Residency');
  const [reuploadIdNumber, setReuploadIdNumber] = useState<string>('');
  const [isUploadingReupload, setIsUploadingReupload] = useState(false);
  const [catalogSouvenirs, setCatalogSouvenirs] = useState<RewardSouvenir[]>([]);


  const fetchProfileAndLeaderboard = async () => {
    if (!db || !user?.uid) return;

    try {
      setLoadingLeaderboard(true);

      // 1. Fetch user's own reports (restricted by security rules)
      const reportsSnap = await getDocs(
        query(collection(db, 'reports'), where('userId', '==', user.uid))
      );
      const myReports: any[] = [];
      reportsSnap.forEach((d) => myReports.push(d.data()));

      // 2. Fetch user's reward awards for verified collections and deducted redemptions
      let earnedRewardTokens = 0;
      let spentRewardTokens = 0;
      try {
        const awardsSnap = await getDocs(
          query(collection(db, 'reward_awards'), where('userId', '==', user.uid))
        );
        awardsSnap.forEach((d) => {
          earnedRewardTokens += Math.max(0, Number(d.data().tokens || 0));
        });
      } catch {
        // reward_awards might be empty or restricted
      }
      try {
        const redemptionsSnap = await getDocs(
          query(collection(db, 'reward_redemptions'), where('userId', '==', user.uid))
        );
        redemptionsSnap.forEach((d) => {
          spentRewardTokens += Math.max(0, Number(d.data().cost || 0));
        });
      } catch {
        // reward_redemptions might be empty
      }

      // 3. User profile data
      const profileSnapshot = await getDoc(doc(db, 'users', user.uid));
      const profile = profileSnapshot.data();
      const residentBarangay = profile?.barangay || '';
      setUserBarangay(residentBarangay);
      setVerificationStatus(profile?.verificationStatus || (profile?.verificationImageUrl ? 'pending' : 'unsubmitted'));
      setRejectionReason(profile?.rejectionReason || '');
      if (profile?.verificationIdType) {
        setReuploadIdType(profile.verificationIdType);
      }
      if (profile?.verificationIdNumber) {
        setReuploadIdNumber(profile.verificationIdNumber);
      }

      const resolvedReports = myReports.filter((r) => r.status === 'resolved' || r.status === 'completed');
      const totalEarnedPoints = resolvedReports.length * 50 + earnedRewardTokens;
      const spendablePoints = Math.max(0, totalEarnedPoints - spentRewardTokens);
      const myPoints = totalEarnedPoints;
      setUserRank({
        rank: 1,
        points: spendablePoints,
        pointsToNext: Math.max(0, 500 - (spendablePoints % 500)),
      });

      // 4. Fetch the official actual-data leaderboard for Danao City (Top 5 if no/low data, Top 20 if more data)
      const leaderboardResult = await fetchBarangayLeaderboard(residentBarangay, myPoints);
      setLeaderboardList(leaderboardResult.displayList);
      setDisplayLimit(leaderboardResult.displayLimit);
      setHasMoreData(leaderboardResult.hasMoreData);
      setAllBarangays(leaderboardResult.allRanked);

      // Client-side sort for recent activity
      if (myReports.length > 0) {
        myReports.sort((a, b) => {
          const tA = (a.createdAt?.toDate ? a.createdAt.toDate().getTime() : a.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt || 0).getTime()) || 0;
          const tB = (b.createdAt?.toDate ? b.createdAt.toDate().getTime() : b.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt || 0).getTime()) || 0;
          return tB - tA;
        });
        setRecentActivity(myReports[0]);
      }
    } catch (error) {
      console.error('Error fetching profile & leaderboard data:', error);
    } finally {
      setLoadingLeaderboard(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchProfileAndLeaderboard();
  }, [user?.displayName, user?.uid]);

  // Real-time listener for current user's profile and ID verification updates
  useEffect(() => {
    if (!db || !user?.uid) return;
    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.barangay) setUserBarangay(data.barangay);
          setVerificationStatus(data.verificationStatus || (data.verificationImageUrl ? 'pending' : 'unsubmitted'));
          setRejectionReason(data.rejectionReason || '');
          if (data.verificationIdType) setReuploadIdType(data.verificationIdType);
          if (data.verificationIdNumber) setReuploadIdNumber(data.verificationIdNumber);
        }
      },
      (err) => console.warn('User profile live sync error:', err)
    );
    return () => unsub();
  }, [user?.uid]);

  // Real-time listener for available merchandise in Eco-Store
  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(
      collection(db, 'reward_catalog'),
      (snap) => {
        if (!snap.empty) {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RewardSouvenir));
          items.sort((a, b) => (a.cost || 0) - (b.cost || 0));
          setCatalogSouvenirs(items);
        } else {
          setCatalogSouvenirs([]);
        }
      },
      (err) => console.warn('Catalog live sync note:', err)
    );
    return () => unsub();
  }, []);

  const handlePickDocumentFromLibrary = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Photo library access is needed to select your proof of residency.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const check = isImageFile(asset);
        if (!check.isValid) {
          Alert.alert('Invalid File', check.error || 'Only image files (JPG, PNG, WebP) are allowed.');
          return;
        }
        setReuploadImageUri(asset.uri);
      }
    } catch (err) {
      console.warn('Error selecting document:', err);
    }
  };

  const handleCaptureDocumentPhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Camera permission is needed to photograph your proof of residency.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const check = isImageFile(asset);
        if (!check.isValid) {
          Alert.alert('Invalid File', check.error || 'Only image files (JPG, PNG, WebP) are allowed.');
          return;
        }
        setReuploadImageUri(asset.uri);
      }
    } catch (err) {
      console.warn('Error capturing document:', err);
    }
  };

  const handleReuploadDocument = async () => {
    if (!reuploadImageUri) {
      Alert.alert('Document Required', 'Please attach a photo of your valid ID or Barangay Proof of Residency.');
      return;
    }
    if (!user?.uid || !db) return;

    setIsUploadingReupload(true);
    try {
      const uploadRes = await cloudinaryService.uploadImage(reuploadImageUri, {
        folder: 'trashtruck/resident-verifications',
        preset: 'trashtrack_reports',
      });
      if (!uploadRes.success || !uploadRes.url) {
        throw new Error(uploadRes.error || 'Could not upload document. Check your internet connection and try again.');
      }

      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        verificationImageUrl: uploadRes.url,
        verificationIdType: reuploadIdType,
        verificationIdNumber: reuploadIdNumber.trim(),
        verificationStatus: 'pending',
        rejectionReason: null,
        verificationSubmittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setVerificationStatus('pending');
      setRejectionReason('');
      setIsReuploadModalVisible(false);
      setReuploadImageUri('');

      Alert.alert(
        'Document Submitted',
        'Your proof of residency has been submitted to CENRO for verification. You will see your badge update once reviewed.'
      );
    } catch (err: any) {
      console.error('Error submitting verification document:', err);
      Alert.alert('Submission Failed', err?.message || 'Failed to submit document. Please try again.');
    } finally {
      setIsUploadingReupload(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchProfileAndLeaderboard();
  };

  // Dynamic user data
  const userName = user?.displayName || 'Resident';
  const userLevel = `LEVEL ${Math.floor(userRank.points / 500) + 1}`;
  const tagline = 'Eco-Conscious Resident';
  const wasteDiverted = `${formatAdaptiveMassFromMetricTons((userRank.points / 50) * 0.0025)} Waste Diverted`;
  const userLocation = userBarangay ? `Barangay ${userBarangay}` : 'Local Community';
  const impactGoal =
    userRank.pointsToNext > 0
      ? Math.floor(100 - (userRank.pointsToNext / 500) * 100)
      : 100;

  // Filtered leaderboard: when searching, search all 42 barangays; otherwise strictly show displayList (top 5 or top 20)
  const filteredBarangays = useMemo(() => {
    if (!searchQuery.trim()) return leaderboardList;
    const q = searchQuery.toLowerCase().trim();
    return allBarangays.filter((b) => b.barangay.toLowerCase().includes(q));
  }, [leaderboardList, allBarangays, searchQuery]);

  // Podium top 3 (from overall unfiltered actual list)
  const topThree = useMemo(() => leaderboardList.slice(0, 3), [leaderboardList]);

  // Remaining list for display: ranks 4 through displayLimit (or matching search results)
  const remainingList = useMemo(() => {
    if (searchQuery.trim()) return filteredBarangays;
    return leaderboardList.slice(3); // Rank 4 to displayLimit (5 or 20)
  }, [leaderboardList, filteredBarangays, searchQuery]);

  // Spotlight for the user's barangay looks up from allBarangays for true city rank
  const spotlight = useMemo(() => {
    const brgyToFind = userBarangay || (allBarangays[0]?.barangay || 'Baliang');
    return getBarangaySpotlight(
      brgyToFind,
      allBarangays.length > 0 ? allBarangays : leaderboardList,
      userRank.points
    );
  }, [userBarangay, allBarangays, leaderboardList, userRank.points]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2E7D32']} />
        }
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 20),
          paddingBottom: Math.max(insets.bottom, 12) + 28,
        }}
      >
        {/* User Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.profileHeader}>
            <View>
              <Text style={styles.userName}>{userName}</Text>
              <Text style={styles.tagline}>{tagline}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={styles.levelBadge}>
                <Text style={styles.levelText}>{userLevel}</Text>
              </View>
            </View>
          </View>

          <View style={styles.statsContainer}>
            <View style={styles.statBadge}>
              <IconSymbol name="mappin.circle" size={16} color="#4A6741" />
              <Text style={styles.statText}>{userLocation}</Text>
            </View>
            <View style={styles.statBadge}>
              <IconSymbol name="leaf" size={16} color="#4A6741" />
              <Text style={styles.statText}>{wasteDiverted}</Text>
            </View>
            {verificationStatus !== 'unsubmitted' ? (
              <TouchableOpacity
                disabled={verificationStatus === 'verified'}
                onPress={() => {
                  if (verificationStatus === 'rejected') setIsReuploadModalVisible(true);
                  else if (verificationStatus === 'pending') {
                    Alert.alert('Under Review', 'Your verification document is currently being reviewed by CENRO officers.');
                  }
                }}
                activeOpacity={verificationStatus === 'rejected' ? 0.75 : 1}
                style={[
                  styles.statBadge,
                  verificationStatus === 'verified'
                    ? { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' }
                    : verificationStatus === 'rejected'
                    ? { backgroundColor: '#FEE2E2', borderColor: '#FECACA' }
                    : { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
                ]}
              >
                <IconSymbol
                  name={
                    verificationStatus === 'verified'
                      ? 'checkmark.seal.fill'
                      : verificationStatus === 'rejected'
                      ? 'xmark.seal.fill'
                      : 'clock.fill'
                  }
                  size={15}
                  color={
                    verificationStatus === 'verified'
                      ? '#15803D'
                      : verificationStatus === 'rejected'
                      ? '#B91C1C'
                      : '#B45309'
                  }
                />
                <Text
                  style={[
                    styles.statText,
                    {
                      color:
                        verificationStatus === 'verified'
                          ? '#15803D'
                          : verificationStatus === 'rejected'
                          ? '#B91C1C'
                          : '#B45309',
                      fontWeight: '700',
                    },
                  ]}
                >
                  {verificationStatus === 'verified'
                    ? 'Verified Resident'
                    : verificationStatus === 'rejected'
                    ? 'ID Rejected • Tap to Fix'
                    : 'ID Under Review'}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => setIsReuploadModalVisible(true)}
                activeOpacity={0.75}
                style={[styles.statBadge, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}
              >
                <IconSymbol name="plus.circle.fill" size={15} color="#15803D" />
                <Text style={[styles.statText, { color: '#15803D', fontWeight: '700' }]}>
                  Verify Resident ID
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Rejection Alert Banner if rejected by CENRO */}
          {verificationStatus === 'rejected' && (
            <View style={styles.rejectionNoticeCard}>
              <View style={styles.rejectionNoticeHeader}>
                <View style={styles.rejectionNoticeIconWrap}>
                  <MaterialIcons name="error-outline" size={20} color="#DC2626" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rejectionNoticeTitle}>Residency Verification Rejected</Text>
                  <Text style={styles.rejectionNoticeReason}>
                    {rejectionReason || 'Your previous document did not verify your Danao City residency.'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.reuploadActionBtn}
                onPress={() => setIsReuploadModalVisible(true)}
                activeOpacity={0.85}
              >
                <MaterialIcons name="upload-file" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.reuploadActionBtnText}>Re-upload Proof of Residency</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.goalContainer}>
            <Text style={styles.goalTitle}>Monthly Impact Goal</Text>
            <Text style={styles.goalPercentage}>{impactGoal}%</Text>
          </View>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${impactGoal}%` }]} />
          </View>
        </View>


        {/* Personal Impact Card */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your Eco Impact</Text>
          <Text style={styles.viewAllText}>Personal Points</Text>
        </View>

        <View style={styles.rankCard}>
          <View style={styles.rankCardTop}>
            <View style={styles.rankNumberBadge}>
              <Text style={styles.rankNumberText}>★</Text>
            </View>
            <View style={styles.rankDetails}>
              <Text style={styles.rankLabel}>YOUR IMPACT POINTS</Text>
              <Text style={styles.rankPoints}>{userRank.points.toLocaleString()} pts</Text>
            </View>
            <View style={styles.nextRankDetails}>
              <Text style={styles.nextRankLabel}>NEXT LEVEL</Text>
              <Text style={styles.pointsToGo}>
                {userRank.pointsToNext > 0 ? `${userRank.pointsToNext} pts to go` : 'Max Level'}
              </Text>
            </View>
          </View>
          <View style={styles.rankProgressBarContainer}>
            <View style={styles.rankProgressBarBg}>
              <View
                style={[
                  styles.rankProgressBarFill,
                  {
                    width: `${
                      userRank.pointsToNext > 0
                        ? ((500 - userRank.pointsToNext) / 500) * 100
                        : 100
                    }%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* ================= ECO-REWARDS & MERCHANDISE SECTION ================= */}
        <View style={styles.merchShowcaseContainer}>
          <View style={styles.merchShowcaseHeader}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="card-giftcard" size={20} color="#0D9488" />
                <Text style={styles.sectionTitle}>Eco-Souvenirs & Merch</Text>
              </View>
              <Text style={styles.merchShowcaseSubtitle}>
                What you can redeem with your {userRank.points.toLocaleString()} points
              </Text>
            </View>
            <TouchableOpacity
              style={styles.merchViewAllBtn}
              onPress={() => router.push('/rewards')}
              activeOpacity={0.7}
            >
              <Text style={styles.merchViewAllText}>View Store</Text>
              <MaterialIcons name="arrow-forward" size={14} color="#0D9488" />
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.merchCardsScroll}
          >
            {catalogSouvenirs.map((item) => {
              const canRedeem = userRank.points >= item.cost;
              const pointsNeeded = Math.max(0, item.cost - userRank.points);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.merchCard, canRedeem && styles.merchCardUnlocked]}
                  onPress={() => router.push({ pathname: '/rewards', params: { autoOpen: item.id } } as any)}
                  activeOpacity={0.8}
                >
                  <View style={styles.merchCardTop}>
                    <View style={[styles.merchIconWrap, canRedeem && styles.merchIconWrapUnlocked]}>
                      {item.imageUrl ? (
                        <Image
                          source={{ uri: item.imageUrl }}
                          style={{ width: '100%', height: '100%', borderRadius: 10 }}
                          resizeMode="cover"
                        />
                      ) : (
                        <MaterialIcons
                          name={
                            item.category === 'Apparel' ? 'checkroom' :
                            item.category === 'Eco Kit' ? 'eco' :
                            item.category === 'Household' ? 'home' :
                            'card-giftcard'
                          }
                          size={22}
                          color={canRedeem ? '#0D9488' : '#64748B'}
                        />
                      )}
                    </View>
                    <View style={[styles.merchPill, canRedeem ? styles.merchPillUnlocked : styles.merchPillLocked]}>
                      <Text style={[styles.merchPillText, canRedeem ? styles.merchPillTextUnlocked : styles.merchPillTextLocked]}>
                        {canRedeem ? 'Claimable' : `${pointsNeeded} pts left`}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.merchCardTitle} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.merchCardDesc} numberOfLines={1}>
                    {item.type || item.category || 'Official Reward'}
                  </Text>

                  <View style={styles.merchCardBottom}>
                    <View style={styles.merchCostBadge}>
                      <MaterialIcons name="stars" size={13} color="#0D9488" />
                      <Text style={styles.merchCostText}>{item.cost.toLocaleString()} pts</Text>
                    </View>
                    <Text style={[styles.merchActionLink, canRedeem && styles.merchActionLinkUnlocked]}>
                      {canRedeem ? 'Redeem →' : 'View'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ================= BARANGAY LEADERBOARD SECTION ================= */}
        <View style={styles.leaderboardSectionHeader}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <IconSymbol name="trophy.fill" size={20} color="#F59E0B" />
              <Text style={styles.sectionTitle}>Barangay Leaderboard</Text>
            </View>
            <Text style={styles.sectionSubtitle}>
              Danao City Top {displayLimit} Barangays ({hasMoreData ? 'Actual Operational Data' : 'Initial Municipal Roster'})
            </Text>
          </View>
        </View>

        {/* Segmented Tab Controls */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'all' && styles.activeTabButton]}
            onPress={() => setActiveTab('all')}
          >
            <IconSymbol
              name="trophy"
              size={16}
              color={activeTab === 'all' ? '#FFFFFF' : '#4B5563'}
            />
            <Text style={[styles.tabButtonText, activeTab === 'all' && styles.activeTabText]}>
              Top {displayLimit} Barangays
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'myBarangay' && styles.activeTabButton]}
            onPress={() => setActiveTab('myBarangay')}
          >
            <IconSymbol
              name="mappin.circle"
              size={16}
              color={activeTab === 'myBarangay' ? '#FFFFFF' : '#4B5563'}
            />
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'myBarangay' && styles.activeTabText,
              ]}
            >
              My Barangay {userBarangay ? `(${userBarangay})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Loading Indicator */}
        {loadingLeaderboard ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#2E7D32" />
            <Text style={styles.loadingText}>Loading Danao City Leaderboard...</Text>
          </View>
        ) : activeTab === 'all' ? (
          /* TAB 1: TOP 20 BARANGAYS RANKING */
          <View>
            {/* Sticky User Standing Banner */}
            {spotlight && (
              <TouchableOpacity
                style={styles.userBarangayBanner}
                onPress={() => setActiveTab('myBarangay')}
              >
                <View style={styles.bannerBadge}>
                  <Text style={styles.bannerBadgeText}>#{spotlight.rank}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerTitle}>
                    Brgy. {spotlight.barangay} is #{spotlight.rank} in Danao City
                  </Text>
                  <Text style={styles.bannerSubtitle}>
                    {spotlight.points.toLocaleString()} pts • {spotlight.cleanlinessScore}% Clean Coverage
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={18} color="#2E7D32" />
              </TouchableOpacity>
            )}

            {/* Quick Search Bar */}
            <View style={styles.searchContainer}>
              <IconSymbol name="magnifyingglass" size={18} color="#6B7280" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search Danao barangay (e.g. Baliang, Binaliw)..."
                placeholderTextColor="#9CA3AF"
                value={searchQuery}
                onChangeText={setSearchQuery}
                clearButtonMode="while-editing"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <IconSymbol name="xmark" size={16} color="#6B7280" />
                </TouchableOpacity>
              )}
            </View>

            {/* TOP 3 PODIUM (only shown when not searching) */}
            {!searchQuery.trim() && topThree.length === 3 && (
              <View style={styles.podiumContainer}>
                {/* #2 Silver (Left) */}
                <View style={[styles.podiumCard, styles.podiumSilver]}>
                  <View style={[styles.podiumMedalBadge, { backgroundColor: '#E0E0E0' }]}>
                    <Text style={styles.podiumMedalText}>🥈 2</Text>
                  </View>
                  <Text style={styles.podiumName} numberOfLines={1}>
                    {topThree[1].barangay}
                  </Text>
                  <Text style={styles.podiumPoints}>
                    {topThree[1].points.toLocaleString()}
                  </Text>
                  <Text style={styles.podiumUnit}>pts</Text>
                  <View style={styles.podiumScoreBadge}>
                    <Text style={styles.podiumScoreText}>{topThree[1].cleanlinessScore}%</Text>
                  </View>
                </View>

                {/* #1 Gold (Center, Elevated) */}
                <View style={[styles.podiumCard, styles.podiumGold]}>
                  <View style={[styles.podiumMedalBadge, { backgroundColor: '#FEF3C7' }]}>
                    <Text style={styles.podiumMedalText}>🥇 1</Text>
                  </View>
                  <Text style={[styles.podiumName, styles.podiumGoldName]} numberOfLines={1}>
                    {topThree[0].barangay}
                  </Text>
                  <Text style={[styles.podiumPoints, styles.podiumGoldPoints]}>
                    {topThree[0].points.toLocaleString()}
                  </Text>
                  <Text style={styles.podiumUnit}>pts</Text>
                  <View style={[styles.podiumScoreBadge, { backgroundColor: '#F59E0B' }]}>
                    <Text style={[styles.podiumScoreText, { color: '#FFFFFF' }]}>
                      {topThree[0].cleanlinessScore}%
                    </Text>
                  </View>
                </View>

                {/* #3 Bronze (Right) */}
                <View style={[styles.podiumCard, styles.podiumBronze]}>
                  <View style={[styles.podiumMedalBadge, { backgroundColor: '#FFEDD5' }]}>
                    <Text style={styles.podiumMedalText}>🥉 3</Text>
                  </View>
                  <Text style={styles.podiumName} numberOfLines={1}>
                    {topThree[2].barangay}
                  </Text>
                  <Text style={styles.podiumPoints}>
                    {topThree[2].points.toLocaleString()}
                  </Text>
                  <Text style={styles.podiumUnit}>pts</Text>
                  <View style={styles.podiumScoreBadge}>
                    <Text style={styles.podiumScoreText}>{topThree[2].cleanlinessScore}%</Text>
                  </View>
                </View>
              </View>
            )}

            {/* RANKED LIST OF BARANGAYS (Ranks 4 to displayLimit, or search results) */}
            <View style={styles.leaderboardList}>
              {remainingList.map((b) => (
                <View
                  key={b.barangay}
                  style={[
                    styles.barangayRow,
                    b.isUserBarangay && styles.userBarangayRowHighlight,
                  ]}
                >
                  <View
                    style={[
                      styles.rankBadge,
                      b.rank <= 3 && { backgroundColor: '#FEF3C7' },
                      b.isUserBarangay && { backgroundColor: '#C8E6C9' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.rankBadgeText,
                        b.rank <= 3 && { color: '#D97706' },
                        b.isUserBarangay && { color: '#1B5E20' },
                      ]}
                    >
                      {b.rank}
                    </Text>
                  </View>

                  <View style={styles.barangayInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.barangayName}>{b.barangay}</Text>
                      {b.isUserBarangay && (
                        <View style={styles.yourBrgyTag}>
                          <Text style={styles.yourBrgyTagText}>YOUR BRGY</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.barangaySubtext}>
                      {b.activeSchedules > 0
                        ? `${b.activeSchedules} sched · ${b.weeklyRuns} runs/wk`
                        : 'No active schedule'}
                      {b.fleetTrips > 0 ? ` · ${b.fleetTrips} trip(s)` : ''} · {b.divertedTons}t diverted
                    </Text>
                  </View>

                  <View style={styles.pointsColumn}>
                    <Text style={styles.barangayPoints}>
                      {b.points.toLocaleString()} pts
                    </Text>
                    <View style={styles.cleanRatePill}>
                      <IconSymbol name="leaf" size={11} color="#2E7D32" />
                      <Text style={styles.cleanRateText}>{b.cleanlinessScore}%</Text>
                    </View>
                  </View>
                </View>
              ))}

              {filteredBarangays.length === 0 && (
                <View style={styles.emptySearchResult}>
                  <IconSymbol name="questionmark.circle" size={32} color="#9CA3AF" />
                  <Text style={styles.emptySearchText}>No barangay found for &quot;{searchQuery}&quot;</Text>
                </View>
              )}

              {/* Informational banner if user's barangay is ranked outside the displayed list */}
              {spotlight && spotlight.rank > displayLimit && !searchQuery.trim() && (
                <TouchableOpacity
                  style={styles.outsideTop20Banner}
                  onPress={() => setActiveTab('myBarangay')}
                >
                  <IconSymbol name="mappin.circle" size={16} color="#2E7D32" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.outsideTop20Title}>
                      Your barangay ({spotlight.barangay}) is ranked #{spotlight.rank}
                    </Text>
                    <Text style={styles.outsideTop20Subtitle}>
                      {spotlight.points.toLocaleString()} pts • Tap to view community standing
                    </Text>
                  </View>
                  <IconSymbol name="chevron.right" size={16} color="#2E7D32" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          /* TAB 2: MY BARANGAY SPOTLIGHT */
          <View style={styles.myBarangayContainer}>
            {spotlight ? (
              <View>
                {/* Big Spotlight Card */}
                <View style={styles.spotlightCard}>
                  <View style={styles.spotlightTopRow}>
                    <View>
                      <Text style={styles.spotlightEyebrow}>DANAO CITY MUNICIPAL RANKING</Text>
                      <Text style={styles.spotlightTitle}>Barangay {spotlight.barangay}</Text>
                    </View>
                    <View style={styles.spotlightRankBadge}>
                      <Text style={styles.spotlightRankLabel}>RANK</Text>
                      <Text style={styles.spotlightRankNumber}>#{spotlight.rank}</Text>
                    </View>
                  </View>

                  <View style={styles.spotlightDivider} />

                  {/* 4-Box Key Metrics */}
                  <View style={styles.spotlightGrid}>
                    <View style={styles.spotlightMetricCard}>
                      <Text style={styles.spotlightMetricValue}>
                        {spotlight.points.toLocaleString()}
                      </Text>
                      <Text style={styles.spotlightMetricLabel}>Eco Points</Text>
                    </View>

                    <View style={styles.spotlightMetricCard}>
                      <Text style={[styles.spotlightMetricValue, { color: '#2E7D32' }]}>
                        {spotlight.cleanlinessScore}%
                      </Text>
                      <Text style={styles.spotlightMetricLabel}>Clean Score</Text>
                    </View>

                    <View style={styles.spotlightMetricCard}>
                      <Text style={styles.spotlightMetricValue}>
                        {spotlight.divertedTons} T
                      </Text>
                      <Text style={styles.spotlightMetricLabel}>Waste Diverted</Text>
                    </View>

                    <View style={styles.spotlightMetricCard}>
                      <Text style={styles.spotlightMetricValue}>
                        {spotlight.activeSchedules} Sched / {spotlight.weeklyRuns} Runs
                      </Text>
                      <Text style={styles.spotlightMetricLabel}>Operations / Wk</Text>
                    </View>
                  </View>

                  {/* Resident Personal Contribution */}
                  <View style={styles.contributionBox}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <IconSymbol name="star.fill" size={16} color="#F59E0B" />
                      <Text style={styles.contributionTitle}>Your Citizen Contribution</Text>
                    </View>
                    <Text style={styles.contributionText}>
                      You have contributed <Text style={{ fontWeight: 'bold' }}>{userRank.points} pts</Text>{' '}
                      ({spotlight.userContributionPct}% of Brgy. {spotlight.barangay}&apos;s total). Keep
                      reporting uncollected waste to boost your barangay&apos;s city rank!
                    </Text>
                  </View>
                </View>

                {/* Quick Action Buttons */}
                <View style={styles.actionButtonsContainer}>
                  <TouchableOpacity
                    style={styles.primaryActionButton}
                    onPress={() => router.push('/report')}
                  >
                    <IconSymbol name="camera.fill" size={18} color="#FFFFFF" />
                    <Text style={styles.primaryActionButtonText}>
                      Report Waste in {spotlight.barangay}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secondaryActionButton}
                    onPress={() => router.push('/(tabs)/schedule')}
                  >
                    <IconSymbol name="calendar" size={18} color="#2E7D32" />
                    <Text style={styles.secondaryActionButtonText}>
                      View {spotlight.barangay} Schedule
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.emptySearchResult}>
                <Text style={styles.emptySearchText}>
                  Please select your barangay in Settings to see your community rank.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ================= RECENT ACTIVITY SECTION ================= */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginHorizontal: 24,
            marginTop: 16,
            marginBottom: 12,
          }}
        >
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <TouchableOpacity onPress={() => router.push('/my-reports')}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#2E7D32' }}>
              View All →
            </Text>
          </TouchableOpacity>
        </View>

        {recentActivity ? (
          <TouchableOpacity
            style={styles.activityCard}
            onPress={() => router.push('/my-reports')}
          >
            <View style={styles.activityIconBg}>
              <IconSymbol
                name={recentActivity.imageURL ? 'camera.fill' : 'doc.text'}
                size={20}
                color="#2E7D32"
              />
            </View>
            <View style={styles.activityDetails}>
              <Text style={styles.activityTitle}>
                {recentActivity.title || 'Reported Trash Pile'}
              </Text>
              <Text style={styles.activityDate}>
                {(() => {
                  if (!recentActivity.createdAt) return 'Recently';
                  if (typeof recentActivity.createdAt?.toDate === 'function') return recentActivity.createdAt.toDate().toLocaleDateString();
                  if (recentActivity.createdAt?.seconds) return new Date(recentActivity.createdAt.seconds * 1000).toLocaleDateString();
                  const d = new Date(recentActivity.createdAt);
                  return isNaN(d.getTime()) ? 'Recently' : d.toLocaleDateString();
                })()} •{' '}
                {recentActivity.barangay}
              </Text>
            </View>
            <View style={styles.activityPointsContainer}>
              <Text style={[
                styles.activityPoints,
                recentActivity.status !== 'resolved' && recentActivity.status !== 'completed' && { color: '#6B7280' }
              ]}>
                {recentActivity.status === 'resolved' || recentActivity.status === 'completed' ? '+50 XP' : '+0 XP'}
              </Text>
              <Text style={styles.activityStatus}>
                {recentActivity.status || 'Pending'}
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.activityCard}
            onPress={() => router.push('/my-reports')}
          >
            <View style={styles.activityDetails}>
              <Text style={styles.activityDate}>No recent activity yet.</Text>
            </View>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Re-upload / Verification Document Modal */}
      <Modal
        visible={isReuploadModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          if (!isUploadingReupload) setIsReuploadModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.modalHeaderIconWrap}>
                <MaterialIcons name="verified-user" size={22} color="#0D9488" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Proof of Residency</Text>
                <Text style={styles.modalSubtitle}>Danao City Resident Verification</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (!isUploadingReupload) setIsReuploadModalVisible(false);
                }}
                disabled={isUploadingReupload}
                style={styles.modalCloseBtn}
              >
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
              {/* If previously rejected, display the official reason */}
              {Boolean(rejectionReason) && (
                <View style={styles.modalRejectionCallout}>
                  <MaterialIcons name="info" size={18} color="#DC2626" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalRejectionCalloutTitle}>Reason for Previous Rejection:</Text>
                    <Text style={styles.modalRejectionCalloutText}>{rejectionReason}</Text>
                  </View>
                </View>
              )}

              <Text style={styles.modalInstructionText}>
                Attach a clear photo of your Danao City Barangay Certificate of Residency, Barangay ID, or Government ID showing your address.
              </Text>

              {/* Document Type Selector */}
              <Text style={styles.modalInputLabel}>DOCUMENT TYPE</Text>
              <View style={styles.docTypePillsRow}>
                {[
                  'Barangay Certificate of Residency',
                  'Barangay ID',
                  'Government ID',
                  'Utility Bill',
                ].map((type) => {
                  const isSelected = reuploadIdType === type;
                  return (
                    <TouchableOpacity
                      key={type}
                      onPress={() => setReuploadIdType(type)}
                      style={[
                        styles.docTypePill,
                        isSelected && styles.docTypePillSelected,
                      ]}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.docTypePillText,
                          isSelected && styles.docTypePillTextSelected,
                        ]}
                      >
                        {type}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ID / Reference Number (Optional) */}
              <Text style={styles.modalInputLabel}>ID / REFERENCE NUMBER (OPTIONAL)</Text>
              <TextInput
                style={styles.modalTextInput}
                placeholder="e.g. BRGY-2026-00123"
                placeholderTextColor="#94A3B8"
                value={reuploadIdNumber}
                onChangeText={setReuploadIdNumber}
                autoCapitalize="characters"
              />

              {/* Document Photo Preview or Attachment Options */}
              <Text style={styles.modalInputLabel}>ATTACH VALID DOCUMENT PHOTO *</Text>
              {Boolean(reuploadImageUri) ? (
                <View style={styles.docPreviewCard}>
                  <Image source={{ uri: reuploadImageUri }} style={styles.docPreviewImage} resizeMode="contain" />
                  <View style={styles.docPreviewActions}>
                    <TouchableOpacity
                      style={styles.docChangeBtn}
                      onPress={handlePickDocumentFromLibrary}
                      disabled={isUploadingReupload}
                    >
                      <MaterialIcons name="photo-library" size={16} color="#0D9488" style={{ marginRight: 4 }} />
                      <Text style={styles.docChangeBtnText}>Change Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.docChangeBtn}
                      onPress={handleCaptureDocumentPhoto}
                      disabled={isUploadingReupload}
                    >
                      <MaterialIcons name="photo-camera" size={16} color="#0D9488" style={{ marginRight: 4 }} />
                      <Text style={styles.docChangeBtnText}>Take New</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.docPickActionsRow}>
                  <TouchableOpacity
                    style={styles.docPickBtn}
                    onPress={handleCaptureDocumentPhoto}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="photo-camera" size={24} color="#0D9488" />
                    <Text style={styles.docPickBtnTitle}>Take Photo</Text>
                    <Text style={styles.docPickBtnSub}>Using Camera</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.docPickBtn}
                    onPress={handlePickDocumentFromLibrary}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="photo-library" size={24} color="#0D9488" />
                    <Text style={styles.docPickBtnTitle}>Choose Photo</Text>
                    <Text style={styles.docPickBtnSub}>From Gallery</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={[styles.modalSubmitBtn, isUploadingReupload && { opacity: 0.6 }]}
                  onPress={handleReuploadDocument}
                  disabled={isUploadingReupload}
                  activeOpacity={0.85}
                >
                  {isUploadingReupload ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.modalSubmitBtnText}>Submitting to CENRO...</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="cloud-upload" size={18} color="#FFFFFF" />
                      <Text style={styles.modalSubmitBtnText}>Submit Document for Review</Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => {
                    if (!isUploadingReupload) setIsReuploadModalVisible(false);
                  }}
                  disabled={isUploadingReupload}
                >
                  <Text style={styles.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8F5E9',
  },
  scrollContent: {
    flex: 1,
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  profileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  userName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 4,
  },
  tagline: {
    fontSize: 12,
    color: '#6B7280',
    maxWidth: 160,
  },
  levelBadge: {
    backgroundColor: '#C8E6C9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  levelText: {
    color: '#2E7D32',
    fontWeight: 'bold',
    fontSize: 12,
  },
  statsContainer: {
    marginBottom: 20,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  statText: {
    color: '#4A6741',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
  goalContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  goalTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#4B5563',
  },
  goalPercentage: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2E7D32',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#4A6741',
    borderRadius: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1B5E20',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  viewAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A6741',
  },
  rankCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  rankCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  rankNumberBadge: {
    backgroundColor: '#A5D6A7',
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  rankNumberText: {
    color: '#1B5E20',
    fontSize: 20,
    fontWeight: 'bold',
  },
  rankDetails: {
    flex: 1,
  },
  rankLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#4A6741',
    letterSpacing: 0.5,
  },
  rankPoints: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  nextRankDetails: {
    alignItems: 'flex-end',
  },
  nextRankLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#4A6741',
    letterSpacing: 0.5,
  },
  pointsToGo: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  rankProgressBarContainer: {
    paddingHorizontal: 4,
  },
  rankProgressBarBg: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  rankProgressBarFill: {
    height: '100%',
    backgroundColor: '#4A6741',
    borderRadius: 4,
  },
  leaderboardSectionHeader: {
    marginHorizontal: 24,
    marginBottom: 12,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: '#D1E7DD',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  activeTabButton: {
    backgroundColor: '#2E7D32',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  activeTabText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  loadingContainer: {
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#4B5563',
  },
  userBarangayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    borderColor: '#81C784',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 14,
    gap: 12,
  },
  bannerBadge: {
    backgroundColor: '#2E7D32',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  bannerBadgeText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  bannerTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1B5E20',
  },
  bannerSubtitle: {
    fontSize: 11,
    color: '#388E3C',
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 20,
    marginBottom: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#1F2937',
    paddingVertical: 2,
  },
  podiumContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginHorizontal: 20,
    marginBottom: 18,
    gap: 8,
  },
  podiumCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
  },
  podiumGold: {
    borderColor: '#F59E0B',
    paddingVertical: 18,
    backgroundColor: '#FFFBEB',
  },
  podiumSilver: {
    borderColor: '#D1D5DB',
    paddingVertical: 14,
  },
  podiumBronze: {
    borderColor: '#FDBA74',
    paddingVertical: 12,
  },
  podiumMedalBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 6,
  },
  podiumMedalText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  podiumName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 4,
  },
  podiumGoldName: {
    fontSize: 13,
    color: '#92400E',
  },
  podiumPoints: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#374151',
  },
  podiumGoldPoints: {
    fontSize: 16,
    color: '#B45309',
  },
  podiumUnit: {
    fontSize: 10,
    color: '#6B7280',
    marginBottom: 6,
  },
  podiumScoreBadge: {
    backgroundColor: '#E5E7EB',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  podiumScoreText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#374151',
  },
  leaderboardList: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  barangayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  userBarangayRowHighlight: {
    borderColor: '#4CAF50',
    borderWidth: 1.5,
    backgroundColor: '#F1F8E9',
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rankBadgeText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#4B5563',
  },
  barangayInfo: {
    flex: 1,
  },
  barangayName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
  },
  yourBrgyTag: {
    backgroundColor: '#C8E6C9',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  yourBrgyTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#1B5E20',
  },
  barangaySubtext: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  pointsColumn: {
    alignItems: 'flex-end',
  },
  barangayPoints: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  cleanRatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#E8F5E9',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 3,
  },
  cleanRateText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#2E7D32',
  },
  outsideTop20Banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F8E9',
    borderColor: '#81C784',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    gap: 10,
  },
  outsideTop20Title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1B5E20',
  },
  outsideTop20Subtitle: {
    fontSize: 11,
    color: '#4A6741',
    marginTop: 1,
  },
  emptySearchResult: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptySearchText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  myBarangayContainer: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  spotlightCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1.5,
    borderColor: '#A5D6A7',
  },
  spotlightTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  spotlightEyebrow: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#2E7D32',
    letterSpacing: 0.6,
  },
  spotlightTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 2,
  },
  spotlightRankBadge: {
    backgroundColor: '#2E7D32',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  spotlightRankLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#C8E6C9',
  },
  spotlightRankNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  spotlightDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 16,
  },
  spotlightGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  spotlightMetricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  spotlightMetricValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  spotlightMetricLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  contributionBox: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 14,
  },
  contributionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#92400E',
  },
  contributionText: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 17,
  },
  actionButtonsContainer: {
    gap: 10,
  },
  primaryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2E7D32',
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryActionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  secondaryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#2E7D32',
  },
  secondaryActionButtonText: {
    color: '#2E7D32',
    fontSize: 14,
    fontWeight: 'bold',
  },
  activityCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  activityIconBg: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#C8E6C9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  activityDetails: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  activityDate: {
    fontSize: 12,
    color: '#6B7280',
  },
  activityPointsContainer: {
    alignItems: 'flex-end',
  },
  activityPoints: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F59E0B',
  },
  activityStatus: {
    fontSize: 12,
    color: '#4A6741',
    fontWeight: '500',
    marginTop: 2,
  },
  // Eco-Merchandise & Souvenirs Showcase Styles
  merchShowcaseContainer: {
    marginTop: 18,
    marginBottom: 4,
  },
  merchShowcaseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  merchShowcaseSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  merchViewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  merchViewAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0D9488',
  },
  merchCardsScroll: {
    paddingHorizontal: 20,
    gap: 12,
    paddingBottom: 6,
  },
  merchCard: {
    width: 175,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  merchCardUnlocked: {
    borderColor: '#99F6E4',
    backgroundColor: '#FAFDFA',
  },
  merchCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  merchIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  merchIconWrapUnlocked: {
    backgroundColor: '#F0FDFA',
  },
  merchPill: {
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 5,
  },
  merchPillUnlocked: {
    backgroundColor: '#DCFCE7',
  },
  merchPillLocked: {
    backgroundColor: '#FEF3C7',
  },
  merchPillText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  merchPillTextUnlocked: {
    color: '#15803D',
  },
  merchPillTextLocked: {
    color: '#B45309',
  },
  merchCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 2,
  },
  merchCardDesc: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 10,
  },
  merchCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 'auto',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  merchCostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  merchCostText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#0D9488',
  },
  merchActionLink: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  merchActionLinkUnlocked: {
    color: '#0D9488',
    fontWeight: '800',
  },
  rejectionNoticeCard: {
    marginTop: 14,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  rejectionNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  rejectionNoticeIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectionNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#991B1B',
    marginBottom: 2,
  },
  rejectionNoticeReason: {
    fontSize: 12,
    color: '#B91C1C',
    lineHeight: 16,
  },
  reuploadActionBtn: {
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  reuploadActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 14,
  },
  modalHeaderIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#CCFBF1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748B',
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  modalRejectionCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  modalRejectionCalloutTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#991B1B',
    marginBottom: 2,
  },
  modalRejectionCalloutText: {
    fontSize: 12,
    color: '#B91C1C',
    lineHeight: 16,
  },
  modalInstructionText: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 14,
  },
  modalInputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 6,
  },
  docTypePillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  docTypePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  docTypePillSelected: {
    backgroundColor: '#ECFDF5',
    borderColor: '#0D9488',
  },
  docTypePillText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  docTypePillTextSelected: {
    color: '#0D9488',
    fontWeight: '700',
  },
  modalTextInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
    marginBottom: 14,
  },
  docPreviewCard: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    marginBottom: 16,
  },
  docPreviewImage: {
    width: '100%',
    height: 180,
    backgroundColor: '#000000',
  },
  docPreviewActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  docChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  docChangeBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0D9488',
  },
  docPickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  docPickBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  docPickBtnTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 6,
  },
  docPickBtnSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  modalActionsRow: {
    gap: 8,
    marginTop: 6,
  },
  modalSubmitBtn: {
    backgroundColor: '#0D9488',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubmitBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalCancelBtn: {
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
});
