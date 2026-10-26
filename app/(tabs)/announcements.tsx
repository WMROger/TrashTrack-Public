import { useAuthContext } from '@/components/AuthContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { auth, db } from '@/config/firebase';
import { residentNotificationService } from '@/services/residentNotificationService';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const FILTER_CATEGORIES = [
  'All',
  'General',
  'Schedule Change',
  'Service Update',
  'Emergency',
  'Maintenance',
  'Holiday Notice',
  'Policy Update'
];

const isEnviroHeroAnnouncement = (a: any): boolean => {
  if (!a) return false;
  if (a.isEnviroHero === true) return true;
  const title = (a.title || '').toLowerCase();
  const desc = (a.description || a.content || a.details || a.message || '').toLowerCase();
  return title.includes('envirohero') || desc.includes('envirohero');
};

export const isCityWideAnnouncement = (a: any): boolean => {
  if (!a) return false;
  const scope = String(a.targetScope || '').toLowerCase().trim();
  const brgy = String(a.barangay || '').toLowerCase().trim();
  if (scope === 'barangay' || scope === 'specific') {
    return false;
  }
  if (
    brgy &&
    brgy !== 'all' &&
    brgy !== 'city' &&
    brgy !== 'city-wide' &&
    brgy !== 'citywide' &&
    brgy !== 'danao city-wide' &&
    !brgy.includes('all 42')
  ) {
    return false;
  }
  return (
    scope === 'all' ||
    scope === 'city' ||
    scope === 'city-wide' ||
    scope === 'citywide' ||
    brgy === 'all' ||
    brgy === 'city' ||
    brgy === 'city-wide' ||
    brgy === 'citywide' ||
    brgy === 'danao city-wide' ||
    brgy.includes('all 42') ||
    brgy === '' ||
    !a.barangay
  );
};

export const isCenroAnnouncement = (a: any): boolean => {
  if (!a) return false;
  const role = String(a.postedByRole || '').toLowerCase().trim();
  const author = String(a.author || a.authorRole || a.postedBy || '').toLowerCase().trim();
  return (
    role === 'cenro' ||
    role === 'admin' ||
    author.includes('cenro') ||
    author.includes('city') ||
    isCityWideAnnouncement(a)
  );
};

export const getAnnouncementTimestamp = (item: any): number => {
  if (!item) return 0;
  if (item.createdAt?.toMillis) return item.createdAt.toMillis();
  if (item.createdAt?.toDate) return item.createdAt.toDate().getTime();
  if (item.createdAt?.seconds) return item.createdAt.seconds * 1000;
  if (item.createdAt) {
    const parsed = new Date(item.createdAt).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
};

export const sortAnnouncementsWithCityWideFirst = (list: any[]): any[] => {
  if (!Array.isArray(list) || list.length === 0) return [];

  const sorted = [...list].sort(
    (a, b) => getAnnouncementTimestamp(b) - getAnnouncementTimestamp(a)
  );

  const cityWideList: any[] = [];
  const barangayList: any[] = [];

  for (const item of sorted) {
    if (isCityWideAnnouncement(item)) {
      cityWideList.push(item);
    } else {
      barangayList.push(item);
    }
  }

  // Position 0 (Card 2 directly below EnviroHero): newest city-wide announcement
  // Position 1 (Card 3): newest barangay announcement
  // Position 2+ (Card 4+): all remaining announcements sorted newest first
  const result: any[] = [];
  const topCityWide = cityWideList[0];
  const topBarangay = barangayList[0];

  if (topCityWide) {
    result.push(topCityWide);
  }

  if (topBarangay) {
    result.push(topBarangay);
  }

  const remaining = [
    ...cityWideList.slice(topCityWide ? 1 : 0),
    ...barangayList.slice(topBarangay ? 1 : 0),
  ].sort((a, b) => getAnnouncementTimestamp(b) - getAnnouncementTimestamp(a));

  result.push(...remaining);

  return result;
};

export default function AnnouncementsPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const params = useLocalSearchParams<{ id?: string }>();
  const [allAnnouncements, setAllAnnouncements] = useState<any[]>([]);
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(5);
  const [likingId, setLikingId] = useState<string | null>(null);
  const openedParamIdRef = useRef<string | null>(null);
  const [sessionNewIds, setSessionNewIds] = useState<Set<string>>(new Set());
  const [userBarangay, setUserBarangay] = useState<string>('');

  // EnviroHero of the Month state (Section 8 Gamification & Recognition)
  const [enviroHero, setEnviroHero] = useState<{
    name: string;
    barangay: string;
    month: string;
    tokens: number;
    pickups: number;
    citation: string;
    cheersCount: number;
  } | null>(null);
  const [hasCheered, setHasCheered] = useState(false);
  const [isCheering, setIsCheering] = useState(false);
  const [isHeroLoading, setIsHeroLoading] = useState(true);

  // Fetch resident's barangay to filter announcements
  useEffect(() => {
    if (!db || !user?.uid) return;
    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (docSnap) => {
        if (docSnap.exists()) {
          const d = docSnap.data();
          setUserBarangay((d.barangay || d.assignedBarangay || '').trim());
        }
      },
      (err) => {
        if (err?.code !== 'permission-denied') {
          console.warn('AnnouncementsPage: user profile error:', err);
        }
      }
    );
    return () => unsub();
  }, [user?.uid]);

  // Listen to monthly EnviroHero proclamation
  useEffect(() => {
    if (!db || !user?.uid) {
      setEnviroHero(null);
      setIsHeroLoading(false);
      return;
    }
    setIsHeroLoading(true);
    const unsub = onSnapshot(
      doc(db, 'public_data', 'envirohero_monthly'),
      (snap) => {
        setIsHeroLoading(false);
        if (snap.exists()) {
          const d = snap.data();
          setEnviroHero({
            name: d.name || '',
            barangay: d.barangay || '',
            month: d.month || '',
            tokens: Number(d.tokens ?? 0),
            pickups: Number(d.pickups ?? 0),
            citation: d.citation || '',
            cheersCount: Number(d.cheersCount ?? 0),
          });
        } else {
          setEnviroHero(null);
        }
      },
      (err) => {
        setIsHeroLoading(false);
        setEnviroHero(null);
        if (err?.code !== 'permission-denied') console.warn('EnviroHero fetch failed:', err);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  const handleCheerHero = async () => {
    if (hasCheered || isCheering || !enviroHero || !user?.uid || !db) return;
    setIsCheering(true);
    try {
      await updateDoc(doc(db, 'public_data', 'envirohero_monthly'), {
        cheersCount: increment(1),
      });
      setHasCheered(true);
    } catch (err: any) {
      Alert.alert('Could not send cheer', err?.code === 'permission-denied'
        ? 'Please update the app security rules before cheering for the EnviroHero.'
        : 'Please try again in a moment.');
    } finally {
      setIsCheering(false);
    }
  };

  useEffect(() => {
    setHasCheered(false);
  }, [enviroHero?.month]);

  // Mark all announcements as seen when screen is focused to clear tab badge,
  // but capture which were new to highlight them with 'NEW' badges during this session.
  useFocusEffect(
    React.useCallback(() => {
      const activeUid = user?.uid || auth.currentUser?.uid || 'resident';

      const newIds = new Set<string>();
      allAnnouncements.forEach((a) => {
        if (residentNotificationService.isAnnouncementNew(a.id)) {
          newIds.add(a.id);
        }
      });

      if (newIds.size > 0) {
        setSessionNewIds((prev) => new Set([...Array.from(prev), ...Array.from(newIds)]));
      }

      residentNotificationService.markAllAnnouncementsAsSeen(
        activeUid,
        allAnnouncements.map((a) => a.id)
      );
    }, [user?.uid, allAnnouncements])
  );

  const handleOpenAnnouncement = useCallback((announcementId: string) => {
    setSelectedAnnouncementId(announcementId);
    const activeUid = user?.uid || auth.currentUser?.uid || 'resident';
    residentNotificationService.markAnnouncementAsSeen(announcementId, activeUid);
    setSessionNewIds((prev) => {
      const next = new Set(prev);
      next.delete(announcementId);
      return next;
    });
  }, [user?.uid]);

  useEffect(() => {
    if (params.id && params.id !== openedParamIdRef.current) {
      openedParamIdRef.current = params.id;
      handleOpenAnnouncement(params.id);
    }
  }, [params.id, handleOpenAnnouncement]);

  const handleCloseDetailsModal = () => {
    setSelectedAnnouncementId(null);
    try {
      router.setParams({ id: '' });
    } catch { }
  };

  useEffect(() => {
    if (!db) return;
    const announcementsRef = collection(db, "announcements");
    const q = query(announcementsRef, where("isPublished", "==", true));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        data.sort((a: any, b: any) => getAnnouncementTimestamp(b) - getAnnouncementTimestamp(a));
        setAllAnnouncements(data);
      },
      (error) => {
        console.warn("Announcements snapshot warning:", error);
      }
    );
    return () => unsubscribe();
  }, []);

  const selectedAnnouncement = allAnnouncements.find(a => a.id === selectedAnnouncementId) || null;

  const handleToggleLike = async (announcement: any) => {
    if (!user) {
      Alert.alert('Sign In Required', 'Please sign in to like announcements.');
      return;
    }

    if (!db || !announcement?.id) return;
    if (likingId === announcement.id) return;

    const announcementId = announcement.id;
    const likedByList: string[] = Array.isArray(announcement.likedBy) ? announcement.likedBy : [];
    const isCurrentlyLiked = likedByList.includes(user.uid);
    const currentCount = typeof announcement.likesCount === 'number'
      ? announcement.likesCount
      : likedByList.length;

    const nextLiked = !isCurrentlyLiked;
    const nextLikedBy = nextLiked
      ? [...likedByList, user.uid]
      : likedByList.filter((uid: string) => uid !== user.uid);
    const nextCount = Math.max(0, nextLiked ? currentCount + 1 : currentCount - 1);

    // Optimistic update
    setAllAnnouncements(prev =>
      prev.map(item =>
        item.id === announcementId
          ? { ...item, likedBy: nextLikedBy, likesCount: nextCount }
          : item
      )
    );

    setLikingId(announcementId);

    try {
      const docRef = doc(db, 'announcements', announcementId);
      if (nextLiked) {
        await updateDoc(docRef, {
          likedBy: arrayUnion(user.uid),
          likesCount: increment(1),
        });
      } else {
        await updateDoc(docRef, {
          likedBy: arrayRemove(user.uid),
          likesCount: increment(-1),
        });
      }
    } catch (error: any) {
      console.error('Error toggling like:', error);
      // Roll back optimistic update
      setAllAnnouncements(prev =>
        prev.map(item =>
          item.id === announcementId
            ? { ...item, likedBy: likedByList, likesCount: currentCount }
            : item
        )
      );
      Alert.alert('Unable to Like', error?.message || 'Could not update your like. Please try again.');
    } finally {
      setLikingId(null);
    }
  };

  const normalizeBrgy = (str?: string) => {
    if (!str) return '';
    return str.toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim();
  };

  const filteredAnnouncements = useMemo(() => {
    const matching = allAnnouncements.filter((announcement) => {
      // If the top EnviroHero spotlight widget is active or other announcements exist, omit duplicate proclamation bulletin
      // so Card 2 is dedicated to the latest official CENRO city-wide announcement
      if ((enviroHero || allAnnouncements.length > 1) && isEnviroHeroAnnouncement(announcement)) {
        return false;
      }

      // 1. Jurisdiction scoping: must be city-wide or match resident's barangay
      const isCityWide = isCityWideAnnouncement(announcement);
      const normResident = normalizeBrgy(userBarangay);
      const isMyBarangay = normResident && normalizeBrgy(announcement.barangay) === normResident;

      if (!isCityWide && !isMyBarangay) {
        return false;
      }

      // 2. Category filter
      if (selectedFilter === 'All') return true;
      return announcement.category === selectedFilter;
    });

    return sortAnnouncementsWithCityWideFirst(matching);
  }, [allAnnouncements, enviroHero, userBarangay, selectedFilter]);

  const displayedAnnouncements = filteredAnnouncements.slice(0, displayCount);
  const hasMore = displayCount < filteredAnnouncements.length;

  // Selected announcement like status
  const isSelectedLiked = !!(
    selectedAnnouncement &&
    user?.uid &&
    Array.isArray(selectedAnnouncement.likedBy) &&
    selectedAnnouncement.likedBy.includes(user.uid)
  );

  const selectedLikesCount = selectedAnnouncement
    ? typeof selectedAnnouncement.likesCount === 'number'
      ? selectedAnnouncement.likesCount
      : (Array.isArray(selectedAnnouncement.likedBy) ? selectedAnnouncement.likedBy.length : 0)
    : 0;

  const formatFullDateTime = (dateVal: any) => {
    if (!dateVal) return 'Recent update';
    const d = dateVal?.toDate
      ? dateVal.toDate()
      : (dateVal?.seconds ? new Date(dateVal.seconds * 1000) : new Date(dateVal));
    if (isNaN(d.getTime())) return 'Recent update';
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getPriorityBadgeStyle = (priority: string = 'Normal') => {
    const p = (priority || '').toLowerCase();
    if (p === 'urgent') return { bg: '#FEE2E2', text: '#DC2626', border: '#FCA5A5', icon: 'error' as const };
    if (p === 'high') return { bg: '#FEF3C7', text: '#D97706', border: '#FCD34D', icon: 'warning' as const };
    if (p === 'low') return { bg: '#F1F5F9', text: '#64748B', border: '#CBD5E1', icon: 'info' as const };
    return { bg: '#E0F2FE', text: '#0284C7', border: '#BAE6FD', icon: 'info' as const };
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 12) + 16 }}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Announcements</Text>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setShowFilterModal(true)}
            activeOpacity={0.8}
          >
            <IconSymbol name="line.3.horizontal.decrease" size={15} color="#4A6741" />
            <Text style={styles.filterText}>{selectedFilter === 'All' ? 'Filter' : selectedFilter}</Text>
          </TouchableOpacity>
        </View>

        {/* 🌟 EnviroHero of the Month Spotlight (Manuscript Section 8 Requirement) */}
        {isHeroLoading ? (
          <View style={styles.heroLoadingCard}>
            <ActivityIndicator size="small" color="#A16207" />
            <Text style={styles.heroEmptyText}>Loading this month’s EnviroHero…</Text>
          </View>
        ) : enviroHero ? (
          <View style={styles.heroCard}>
            <View style={styles.heroHeaderRow}>
              <View style={styles.heroBadge}>
                <MaterialIcons name="emoji-events" size={13} color="#B45309" />
                <Text style={styles.heroBadgeText} numberOfLines={1}>
                  ENVIROHERO OF THE MONTH
                </Text>
              </View>
              <View style={styles.heroOfficialTag}>
                <MaterialIcons name="verified" size={11} color="#059669" />
                <Text style={styles.heroOfficialTagText}>CENRO COMMENDATION</Text>
              </View>
            </View>

            <View style={styles.heroMainRow}>
              <View style={styles.heroAvatarBox}>
                <MaterialIcons name="star" size={26} color="#D97706" />
              </View>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.heroNameText} numberOfLines={1}>{enviroHero.name}</Text>
                <Text style={styles.heroSubText} numberOfLines={1}>
                  {enviroHero.month ? `${enviroHero.month} Honoree · ` : ''}Brgy. {enviroHero.barangay || 'Danao City'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.heroTokensText}>
                  +{Number(enviroHero.tokens || 0).toLocaleString()} pts
                </Text>
                <Text style={styles.heroPickupsText}>
                  {enviroHero.pickups || 0} verified {Number(enviroHero.pickups) === 1 ? 'stop' : 'stops'}
                </Text>
              </View>
            </View>

            <View style={styles.heroCitationBox}>
              <MaterialIcons name="format-quote" size={16} color="#B45309" />
              <Text style={styles.heroCitationText}>
                &ldquo;{(enviroHero.citation || '').trim().replace(/^["“”']+|["“”']+$/g, '')}&rdquo;
              </Text>
            </View>

          <View style={styles.heroFooterRow}>
            <TouchableOpacity
              style={[styles.cheerBtn, hasCheered && styles.cheerBtnDone]}
              onPress={handleCheerHero}
              disabled={hasCheered || isCheering || !user?.uid}
              activeOpacity={0.8}
            >
              {isCheering ? <ActivityIndicator size="small" color="#B45309" /> : (
                <MaterialIcons
                  name={hasCheered ? "favorite" : "thumb-up"}
                  size={14}
                  color={hasCheered ? "#DC2626" : "#B45309"}
                />
              )}
              <Text style={[styles.cheerBtnText, hasCheered && { color: "#DC2626" }]}>
                {hasCheered ? `Cheered! (${enviroHero.cheersCount})` : `Cheer Hero 👏 (${enviroHero.cheersCount})`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.heroInfoLink}
              onPress={() => router.push('/rewards')}
              activeOpacity={0.7}
            >
              <Text style={styles.heroInfoLinkText}>How to Qualify →</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
          <View style={styles.heroEmptyCard}>
            <View style={styles.heroEmptyIcon}>
              <MaterialIcons name="emoji-events" size={24} color="#A16207" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroEmptyTitle}>EnviroHero of the Month</Text>
              <Text style={styles.heroEmptyText}>CENRO has not announced this month’s honoree yet. Check back soon.</Text>
            </View>
          </View>
        )}

        {/* Dynamic Announcements List */}
        {displayedAnnouncements.length > 0 ? (
          displayedAnnouncements.map((announcement) => {
            const isCardLiked = !!(
              user?.uid &&
              Array.isArray(announcement.likedBy) &&
              announcement.likedBy.includes(user.uid)
            );
            const cardLikesCount = typeof announcement.likesCount === 'number'
              ? announcement.likesCount
              : (Array.isArray(announcement.likedBy) ? announcement.likedBy.length : 0);
            const isThisLiking = likingId === announcement.id;
            const cardDescription = (
              announcement.description ||
              announcement.content ||
              announcement.message ||
              announcement.details ||
              announcement.body ||
              ''
            );

            const isHeroCard = isEnviroHeroAnnouncement(announcement);
            const isCityWide = isCityWideAnnouncement(announcement);
            const isUrgent = announcement.priority === "Urgent" || announcement.priority === "High";

            return (
              <View
                key={announcement.id}
                style={[
                  styles.card,
                  isCityWide && styles.cityWideCard,
                  isHeroCard && styles.heroProclamationCard,
                ]}
              >
                {/* Official Municipal Seal & Ribbon for City-Wide Announcements */}
                {isCityWide && (
                  <View style={styles.cityWideHeaderBanner}>
                    <View style={styles.cityWideBannerLeft}>
                      <View style={styles.citySealBadge}>
                        <MaterialIcons name="account-balance" size={13} color="#FFFFFF" />
                      </View>
                      <View>
                        <Text style={styles.cityWideGovText}>CITY GOVERNMENT OF DANAO</Text>
                        <Text style={styles.cityWideDeptText}>CENRO · Environmental Services</Text>
                      </View>
                    </View>
                    <View style={styles.cityWideBroadcastPill}>
                      <MaterialIcons name="public" size={11} color="#0284C7" />
                      <Text style={styles.cityWideBroadcastPillText}>CITY-WIDE</Text>
                    </View>
                  </View>
                )}

                <View style={isCityWide ? styles.cityWideCardBody : undefined}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => handleOpenAnnouncement(announcement.id)}
                  >
                    <View style={styles.cardHeader}>
                      <View style={styles.cardHeaderLeft}>
                        {isCityWide ? (
                          <>
                            <MaterialIcons name="verified" size={15} color="#0284C7" />
                            <Text style={styles.cityWideVerifiedText}>Official Advisory</Text>
                            <Text style={styles.cardDateDot}>•</Text>
                            <Text style={styles.cardDate}>
                              {formatFullDateTime(announcement.createdAt)}
                            </Text>
                          </>
                        ) : (
                          <>
                            <IconSymbol
                              name={isUrgent ? "exclamationmark.triangle" : "info.circle"}
                              size={18}
                              color={isUrgent ? "#B56576" : "#4A6741"}
                            />
                            <Text style={styles.cardDate}>
                              {formatFullDateTime(announcement.createdAt)}
                            </Text>
                          </>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {isHeroCard && (
                          <View style={styles.heroBadge}>
                            <MaterialIcons name="emoji-events" size={12} color="#B45309" />
                            <Text style={styles.heroBadgeText}>
                              ENVIROHERO
                            </Text>
                          </View>
                        )}
                        {(sessionNewIds.has(announcement.id) || residentNotificationService.isAnnouncementNew(announcement.id)) && (
                          <View style={styles.newBadge}>
                            <View style={styles.newRedDot} />
                            <Text style={styles.newBadgeText}>NEW</Text>
                          </View>
                        )}
                        {isUrgent && (
                          <View style={styles.urgentBadge}>
                            <Text style={styles.urgentText}>{announcement.priority.toUpperCase()}</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    <Text style={[styles.cardTitle, isCityWide && styles.cityWideTitle]}>{announcement.title}</Text>

                    {/* Truncated Description Preview */}
                    <Text
                      style={[styles.cardDescription, isCityWide && styles.cityWideDescription]}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                    >
                      {cardDescription}
                    </Text>

                    <View style={styles.tagGroup}>
                      {/* Jurisdiction Scope Badge */}
                      {isCityWide ? (
                        <View style={styles.cityWideScopeTag}>
                          <MaterialIcons name="public" size={12} color="#0369A1" />
                          <Text style={styles.cityWideScopeTagText}>
                            Danao City-Wide · All 42 Barangays
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.barangayScopeTag}>
                          <MaterialIcons name="place" size={12} color="#059669" />
                          <Text style={styles.barangayScopeTagText}>
                            Brgy. {announcement.barangay}
                          </Text>
                        </View>
                      )}
                      {Boolean(announcement.category) && (
                        <View style={[
                          styles.tag,
                          isCityWide
                            ? { backgroundColor: '#F0F9FF', borderColor: '#BAE6FD', borderWidth: 1 }
                            : { backgroundColor: '#E8F5E9' }
                        ]}>
                          <Text style={[
                            styles.tagText,
                            isCityWide ? { color: '#0369A1' } : { color: '#4A6741' }
                          ]}>
                            {announcement.category}
                          </Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>

                  <View style={styles.cardDivider} />
                  <View style={styles.cardFooter}>
                    {/* Dynamic Likes Counter & Interactive Button */}
                    <TouchableOpacity
                      style={[
                        styles.cardLikeButton,
                        isCardLiked && styles.cardLikeButtonActive,
                        isCityWide && !isCardLiked && styles.cityWideLikeButton,
                      ]}
                      onPress={() => handleToggleLike(announcement)}
                      activeOpacity={0.7}
                      disabled={isThisLiking}
                    >
                      <MaterialIcons
                        name={isCardLiked ? "favorite" : "favorite-border"}
                        size={18}
                        color={isCardLiked ? "#EF4444" : (isCityWide ? "#0284C7" : "#4A6741")}
                      />
                      <Text style={[
                        styles.cardLikeText,
                        isCardLiked && styles.cardLikeTextActive,
                        isCityWide && !isCardLiked && { color: '#0369A1' },
                      ]}>
                        {cardLikesCount} {cardLikesCount === 1 ? 'like' : 'likes'}
                      </Text>
                    </TouchableOpacity>

                    {/* "More details" or "Read Official Bulletin" Button */}
                    <TouchableOpacity
                      style={styles.detailsButton}
                      onPress={() => setSelectedAnnouncementId(announcement.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.detailsText,
                        isCityWide && styles.cityWideDetailsText
                      ]}>
                        {isCityWide ? 'Read Official Bulletin' : 'More details'}
                      </Text>
                      <IconSymbol
                        name="arrow.right"
                        size={14}
                        color={isCityWide ? "#0284C7" : "#4A6741"}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })
        ) : (
          <View style={styles.emptyStateCard}>
            <View style={styles.emptyIconBg}>
              <MaterialIcons name="campaign" size={36} color="#4A6741" />
            </View>
            <Text style={styles.emptyStateTitle}>No Announcements</Text>
            <Text style={styles.emptyStateDescription}>
              {selectedFilter === 'All'
                ? 'Check back later for upcoming barangay schedules and advisories.'
                : `No announcements found for category "${selectedFilter}".`}
            </Text>
          </View>
        )}

        {/* Show Older Updates Button */}
        {hasMore && (
          <TouchableOpacity
            style={styles.olderButton}
            onPress={() => setDisplayCount(prev => prev + 5)}
          >
            <IconSymbol name="chevron.down" size={16} color="#4A6741" />
            <Text style={styles.olderButtonText}>Show Older Updates</Text>
          </TouchableOpacity>
        )}

      </ScrollView>

      {/* Filter Dropdown Modal (at root level) */}
      <Modal
        visible={showFilterModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setShowFilterModal(false)}
          />
          <View style={styles.dropdownMenu}>
            <Text style={styles.dropdownHeader}>Filter by Category</Text>
            {FILTER_CATEGORIES.map(category => (
              <TouchableOpacity
                key={category}
                style={[styles.dropdownItem, selectedFilter === category && styles.dropdownItemActive]}
                onPress={() => {
                  setSelectedFilter(category);
                  setDisplayCount(5);
                  setShowFilterModal(false);
                }}
              >
                <Text style={[styles.dropdownItemText, selectedFilter === category && styles.dropdownItemTextActive]}>
                  {category}
                </Text>
                {selectedFilter === category && (
                  <IconSymbol name="checkmark" size={16} color="#4A6741" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Details Modal (at root level) */}
      <Modal
        visible={!!selectedAnnouncement}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseDetailsModal}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleCloseDetailsModal}
          />
          <View style={styles.detailsModalContent}>
            {selectedAnnouncement && (() => {
              const priorityCfg = getPriorityBadgeStyle(selectedAnnouncement.priority);
              const fullText = (
                selectedAnnouncement.description ||
                selectedAnnouncement.content ||
                selectedAnnouncement.message ||
                selectedAnnouncement.details ||
                selectedAnnouncement.body ||
                'No additional details provided.'
              );
              const hasImage = !!(selectedAnnouncement.imageUrl || selectedAnnouncement.imageURL);

              return (
                <>
                  {/* Fixed Top Header */}
                  <View style={styles.detailsModalHeader}>
                    <View style={styles.detailsModalHeaderBadges}>
                      <View style={[styles.priorityPill, { backgroundColor: priorityCfg.bg, borderColor: priorityCfg.border }]}>
                        <MaterialIcons name={priorityCfg.icon} size={14} color={priorityCfg.text} />
                        <Text style={[styles.priorityPillText, { color: priorityCfg.text }]}>
                          {(selectedAnnouncement.priority || 'Normal').toUpperCase()}
                        </Text>
                      </View>
                      {Boolean(selectedAnnouncement.category) && (
                        <View style={styles.detailsModalCategoryBadge}>
                          <Text style={styles.detailsModalCategoryText}>{selectedAnnouncement.category}</Text>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={handleCloseDetailsModal}
                      style={styles.closeButton}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                      <IconSymbol name="xmark" size={18} color="#6B7280" />
                    </TouchableOpacity>
                  </View>

                  {/* Scrollable Announcement Body - Displays Everything */}
                  <ScrollView
                    style={styles.detailsModalScroll}
                    contentContainerStyle={styles.detailsModalScrollContent}
                    showsVerticalScrollIndicator={true}
                    bounces={true}
                  >
                    {isCityWideAnnouncement(selectedAnnouncement) && (
                      <View style={styles.modalCityWideBanner}>
                        <View style={styles.modalCityWideBadgeRow}>
                          <View style={styles.modalCityWideBadge}>
                            <MaterialIcons name="account-balance" size={13} color="#FFFFFF" />
                            <Text style={styles.modalCityWideBadgeText}>OFFICIAL CITY BROADCAST</Text>
                          </View>
                          <View style={styles.modalScopePill}>
                            <MaterialIcons name="public" size={12} color="#0369A1" />
                            <Text style={styles.modalScopePillText}>ALL 42 BARANGAYS</Text>
                          </View>
                        </View>
                        <Text style={styles.modalCityWideGov}>CITY GOVERNMENT OF DANAO</Text>
                        <Text style={styles.modalCityWideSub}>
                          City Environment and Natural Resources Office (CENRO)
                        </Text>
                      </View>
                    )}

                    <Text style={styles.detailsModalTitle}>{selectedAnnouncement.title}</Text>

                    {/* Official Information Card */}
                    <View style={styles.detailsMetaCard}>
                      <View style={styles.detailsMetaItem}>
                        <MaterialIcons name="schedule" size={16} color="#64748B" />
                        <Text style={styles.detailsMetaText}>
                          {formatFullDateTime(selectedAnnouncement.createdAt)}
                        </Text>
                      </View>
                      <View style={styles.detailsMetaItem}>
                        <MaterialIcons name="account-balance" size={16} color="#64748B" />
                        <Text style={styles.detailsMetaText}>
                          Issued by: {selectedAnnouncement.author || selectedAnnouncement.authorRole || selectedAnnouncement.postedBy || 'CENRO Danao City'}
                        </Text>
                      </View>
                      {(() => {
                        const isCityWide = isCityWideAnnouncement(selectedAnnouncement);
                        return (
                          <View style={styles.detailsMetaItem}>
                            <MaterialIcons
                              name={isCityWide ? "public" : "place"}
                              size={16}
                              color={isCityWide ? "#0284C7" : "#059669"}
                            />
                            <Text style={[styles.detailsMetaText, { color: isCityWide ? "#0284C7" : "#059669", fontWeight: '700' }]}>
                              {isCityWide
                                ? 'Broadcast: All Barangays (City-Wide)'
                                : `Jurisdiction: Brgy. ${selectedAnnouncement.barangay}`}
                            </Text>
                          </View>
                        );
                      })()}
                    </View>

                    {/* Attached Announcement Image if available */}
                    {hasImage && (
                      <Image
                        source={{ uri: selectedAnnouncement.imageUrl || selectedAnnouncement.imageURL }}
                        style={styles.detailsModalImage}
                        resizeMode="cover"
                      />
                    )}

                    {/* Complete Announcement Content */}
                    <Text style={styles.detailsModalDescription}>{fullText}</Text>

                    {/* Community Engagement Note */}
                    <View style={styles.detailsLikesNote}>
                      <MaterialIcons
                        name={isSelectedLiked ? "favorite" : "favorite-border"}
                        size={15}
                        color={isSelectedLiked ? "#EF4444" : "#6B7280"}
                      />
                      <Text style={styles.detailsLikesNoteText}>
                        {selectedLikesCount} {selectedLikesCount === 1 ? 'resident found' : 'residents found'} this announcement helpful
                      </Text>
                    </View>
                  </ScrollView>

                  {/* Fixed Modal Action Row: Close button on the left, Like button beside it */}
                  <View style={styles.detailsModalActionsRow}>
                    <TouchableOpacity
                      style={styles.detailsModalCloseButton}
                      onPress={handleCloseDetailsModal}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.detailsModalCloseButtonText}>Close</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.detailsModalLikeButton,
                        isSelectedLiked && styles.detailsModalLikeButtonActive
                      ]}
                      onPress={() => handleToggleLike(selectedAnnouncement)}
                      activeOpacity={0.7}
                      disabled={likingId === selectedAnnouncement.id}
                    >
                      <MaterialIcons
                        name={isSelectedLiked ? "favorite" : "favorite-border"}
                        size={20}
                        color={isSelectedLiked ? "#EF4444" : "#4A6741"}
                      />
                      <Text style={[
                        styles.detailsModalLikeButtonText,
                        isSelectedLiked && styles.detailsModalLikeButtonTextActive
                      ]}>
                        {isSelectedLiked ? "Liked" : "Like"} ({selectedLikesCount})
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
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
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  timeText: {
    fontSize: 15,
    fontWeight: '600',
  },
  timeTextRight: {
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 4,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1B3828',
    letterSpacing: -0.5,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D8E2D8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  filterText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3B5E36',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownMenu: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '80%',
    maxWidth: 320,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  dropdownHeader: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#6B7280',
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingBottom: 8,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  dropdownItemActive: {
    backgroundColor: '#F0FDF4',
  },
  dropdownItemText: {
    fontSize: 16,
    color: '#374151',
  },
  dropdownItemTextActive: {
    color: '#4A6741',
    fontWeight: '600',
  },
  detailsModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    width: '92%',
    maxWidth: 500,
    maxHeight: '86%',
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
    borderWidth: 1,
  },
  priorityPillText: {
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.4,
  },
  detailsModalCategoryBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  detailsModalCategoryText: {
    color: '#4A6741',
    fontSize: 11,
    fontWeight: '700',
  },
  closeButton: {
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
  detailsLikesNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  detailsLikesNoteText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
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
  detailsModalLikeButton: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#A5D6A7',
    paddingVertical: 12,
    borderRadius: 14,
  },
  detailsModalLikeButtonActive: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
  },
  detailsModalLikeButtonText: {
    color: '#4A6741',
    fontSize: 15,
    fontWeight: 'bold',
  },
  detailsModalLikeButtonTextActive: {
    color: '#EF4444',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    marginHorizontal: 20,
    marginBottom: 14,
    shadowColor: '#1A3322',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E6EFE6',
  },
  cityWideCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#BAE6FD',
    borderWidth: 1.5,
    borderLeftWidth: 5,
    borderLeftColor: '#0284C7',
    padding: 0,
    overflow: 'hidden',
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  heroProclamationCard: {
    backgroundColor: '#FFFDF5',
    borderColor: '#FDE68A',
    borderWidth: 1.5,
  },
  cityWideHeaderBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E0F2FE',
  },
  cityWideBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  citySealBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0284C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cityWideGovText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0369A1',
    letterSpacing: 0.8,
  },
  cityWideDeptText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#64748B',
  },
  cityWideBroadcastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  cityWideBroadcastPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0284C7',
    letterSpacing: 0.4,
  },
  cityWideCardBody: {
    padding: 16,
  },
  cityWideVerifiedText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#0284C7',
  },
  cardDateDot: {
    fontSize: 12,
    color: '#94A3B8',
    marginHorizontal: 2,
  },
  cityWideTitle: {
    color: '#0F172A',
    fontSize: 16.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  cityWideDescription: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
  },
  cityWideScopeTag: {
    backgroundColor: '#E0F2FE',
    borderColor: '#BAE6FD',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  cityWideScopeTagText: {
    color: '#0369A1',
    fontWeight: '700',
    fontSize: 10,
  },
  barangayScopeTag: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  barangayScopeTagText: {
    color: '#059669',
    fontWeight: '700',
    fontSize: 10,
  },
  cityWideLikeButton: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#E0F2FE',
  },
  cityWideDetailsText: {
    color: '#0284C7',
    fontWeight: '700',
  },
  modalCityWideBanner: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    gap: 4,
  },
  modalCityWideBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  modalCityWideBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0284C7',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modalCityWideBadgeText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  modalScopePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  modalScopePillText: {
    color: '#0369A1',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  modalCityWideGov: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0369A1',
    letterSpacing: 0.5,
  },
  modalCityWideSub: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardDate: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4B5563',
  },
  newBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    gap: 4,
  },
  newRedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  newBadgeText: {
    color: '#DC2626',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  urgentBadge: {
    backgroundColor: '#B56576',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  urgentText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
    marginBottom: 6,
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLikeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
  },
  cardLikeButtonActive: {
    backgroundColor: '#FEE2E2',
  },
  cardLikeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4B5563',
  },
  cardLikeTextActive: {
    color: '#EF4444',
  },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailsText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#4A6741',
  },
  tagGroup: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  olderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: '#4A6741',
    marginTop: 8,
  },
  olderButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#4A6741',
  },
  emptyStateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 32,
    marginHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E6EFE6',
    marginTop: 20,
  },
  emptyIconBg: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#EBF4EA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1B3828',
    marginBottom: 8,
  },
  emptyStateDescription: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
  heroCard: {
    backgroundColor: '#FFFDF5',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    shadowColor: '#D97706',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  heroLoadingCard: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFDF5',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  heroEmptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFDF5',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  heroEmptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF3C7',
  },
  heroEmptyTitle: {
    color: '#713F12',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 3,
  },
  heroEmptyText: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 18,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FCD34D',
    flexShrink: 1,
  },
  heroBadgeText: {
    fontSize: 9.5,
    fontWeight: '900',
    color: '#B45309',
    letterSpacing: 0.3,
  },
  heroOfficialTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    flexShrink: 0,
  },
  heroOfficialTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.2,
  },
  heroMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  heroAvatarBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FDE68A',
  },
  heroNameText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#78350F',
  },
  heroSubText: {
    fontSize: 11.5,
    color: '#92400E',
    marginTop: 1,
  },
  heroTokensText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#059669',
  },
  heroPickupsText: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 1,
  },
  heroCitationBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#FEF9C3',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FEF08A',
    marginBottom: 12,
  },
  heroCitationText: {
    fontSize: 11.5,
    color: '#713F12',
    fontStyle: 'italic',
    flex: 1,
    lineHeight: 16,
  },
  heroFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cheerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  cheerBtnDone: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FECACA',
  },
  cheerBtnText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#B45309',
  },
  heroInfoLink: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  heroInfoLinkText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#0D9488',
  },
});


