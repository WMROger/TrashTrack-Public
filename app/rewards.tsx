import { useAuthContext } from '@/components/AuthContext';
import { db } from '@/config/firebase';
import {
  RewardRequest,
  RewardSouvenir,
  cancelRewardRequest,
  submitRewardRequest,
} from '@/services/rewardService';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type AwardEntry = { id: string; tokens: number; reportId: string; reason?: string; awardedAt?: any };
type RedemptionEntry = { id: string; cost: number; souvenirName: string; issuedAt?: any; confirmedBarangay?: string };

const dateLabel = (value: any) => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Processing';
};

export default function ResidentRewardsPage() {
  const router = useRouter();
  const { user } = useAuthContext();
  const { autoOpen } = useLocalSearchParams<{ autoOpen?: string }>();

  const [awards, setAwards] = useState<AwardEntry[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionEntry[]>([]);
  const [requests, setRequests] = useState<RewardRequest[]>([]);
  const [catalogItems, setCatalogItems] = useState<RewardSouvenir[]>([]);
  const [userReports, setUserReports] = useState<any[]>([]);
  const [profileTokens, setProfileTokens] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const [userBarangay, setUserBarangay] = useState<string>('');
  const [userName, setUserName] = useState<string>('');

  // Tab View: 'catalog' | 'requests' | 'history'
  const [viewTab, setViewTab] = useState<'catalog' | 'requests' | 'history'>('catalog');

  // Request Modal State
  const [selectedItemForRequest, setSelectedItemForRequest] = useState<RewardSouvenir | null>(null);
  const [requestModalVisible, setRequestModalVisible] = useState(false);
  const [requestNotes, setRequestNotes] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [autoOpenedId, setAutoOpenedId] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState<string>('');

  // Fetch Resident Profile (Barangay, Display Name, Verification Status & Direct Token Balances)
  useEffect(() => {
    if (!db || !user?.uid) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.barangay) setUserBarangay(data.barangay);
        if (data.displayName || data.name) setUserName(data.displayName || data.name);
        setVerificationStatus(data.verificationStatus || '');
        setRejectionReason(data.rejectionReason || '');
        const directTokens = Number(data.rewardTokens ?? data.points ?? data.tokens ?? 0);
        setProfileTokens(directTokens);
      }
    }, (err) => console.warn('Could not fetch user profile in rewards:', err));
    return () => unsub();
  }, [user?.uid]);

  // Real-time Firestore Subscriptions
  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    const unsubscribeCatalog = onSnapshot(collection(db, 'reward_catalog'), (snapshot) => {
      if (!snapshot.empty) {
        const customItems = snapshot.docs.map((d) => ({
          id: d.id,
          name: d.data().name || 'Souvenir',
          type: d.data().type || '',
          cost: Number(d.data().cost || 0),
          category: d.data().category || 'General',
          imageUrl: d.data().imageUrl || '',
          stock: d.data().stock !== undefined ? Number(d.data().stock) : undefined,
          createdAt: d.data().createdAt,
        }));
        setCatalogItems(customItems);
      } else {
        setCatalogItems([]);
      }
    });

    if (!user?.uid) {
      setLoading(false);
      return () => unsubscribeCatalog();
    }

    let loadedAwards = false;
    let loadedRedemptions = false;
    let loadedRequests = false;
    let loadedReports = false;
    const finish = () => {
      if (loadedAwards && loadedRedemptions && loadedRequests && loadedReports) setLoading(false);
    };

    const unsubscribeAwards = onSnapshot(
      query(collection(db, 'reward_awards'), where('userId', '==', user.uid)),
      (snapshot) => {
        setAwards(
          snapshot.docs.map((item) => ({
            id: item.id,
            tokens: Math.max(0, Number(item.data().tokens || 0)),
            reportId: String(item.data().reportId || ''),
            reason: item.data().reason || '',
            awardedAt: item.data().awardedAt,
          }))
        );
        loadedAwards = true;
        finish();
      },
      () => {
        loadedAwards = true;
        finish();
      }
    );

    const unsubscribeRedemptions = onSnapshot(
      query(collection(db, 'reward_redemptions'), where('userId', '==', user.uid)),
      (snapshot) => {
        setRedemptions(
          snapshot.docs.map((item) => ({
            id: item.id,
            cost: Math.max(0, Number(item.data().cost || 0)),
            souvenirName: String(item.data().souvenirName || 'Souvenir'),
            issuedAt: item.data().issuedAt,
            confirmedBarangay: item.data().confirmedBarangay,
          }))
        );
        loadedRedemptions = true;
        finish();
      },
      () => {
        loadedRedemptions = true;
        finish();
      }
    );

    const unsubscribeRequests = onSnapshot(
      query(collection(db, 'reward_requests'), where('userId', '==', user.uid)),
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        })) as RewardRequest[];
        items.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tB - tA;
        });
        setRequests(items);
        loadedRequests = true;
        finish();
      },
      () => {
        loadedRequests = true;
        finish();
      }
    );

    const unsubscribeReports = onSnapshot(
      query(collection(db, 'reports'), where('userId', '==', user.uid)),
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));
        setUserReports(items);
        loadedReports = true;
        finish();
      },
      () => {
        loadedReports = true;
        finish();
      }
    );

    return () => {
      unsubscribeCatalog();
      unsubscribeAwards();
      unsubscribeRedemptions();
      unsubscribeRequests();
      unsubscribeReports();
    };
  }, [user?.uid]);

  // Auto-open modal if navigated with autoOpen query param
  useEffect(() => {
    if (autoOpen && catalogItems.length > 0 && autoOpenedId !== autoOpen) {
      const target = catalogItems.find((i) => i.id === autoOpen);
      if (target) {
        setAutoOpenedId(autoOpen);
        setSelectedItemForRequest(target);
        setRequestNotes('');
        setRequestModalVisible(true);
      }
    }
  }, [autoOpen, catalogItems, autoOpenedId]);

  // Token calculations
  // 1. Tokens from reward_awards collection
  const awardsTokens = useMemo(() => awards.reduce((sum, item) => sum + item.tokens, 0), [awards]);

  // 2. Resolved & pending trash reports
  const resolvedReports = useMemo(
    () => userReports.filter((r) => r.status === 'resolved' || r.status === 'completed'),
    [userReports]
  );
  const pendingReports = useMemo(
    () => userReports.filter((r) => r.status !== 'resolved' && r.status !== 'completed' && r.status !== 'declined'),
    [userReports]
  );

  // Avoid double-counting: only add report points if not already explicitly awarded in reward_awards
  const reportsEarnedTokens = useMemo(() => {
    return resolvedReports.reduce((sum, r) => {
      const hasAward = awards.some((a) => a.reportId === r.id || a.id === `report_${r.id}`);
      if (hasAward) return sum;
      return sum + Math.max(0, Number(r.rewardPoints || 50));
    }, 0);
  }, [resolvedReports, awards]);

  // Total lifetime earned tokens (consistent with Profile and Home tabs)
  const computedEarned = awardsTokens + reportsEarnedTokens;
  const earned = useMemo(() => Math.max(computedEarned, profileTokens), [computedEarned, profileTokens]);

  const spent = useMemo(() => redemptions.reduce((sum, item) => sum + item.cost, 0), [redemptions]);
  const balance = Math.max(0, earned - spent);

  const pendingRequests = useMemo(() => requests.filter((r) => r.status === 'pending'), [requests]);
  const pendingTokens = useMemo(() => pendingRequests.reduce((sum, r) => sum + Number(r.cost || 0), 0), [pendingRequests]);

  const handleOpenRequest = (item: RewardSouvenir) => {
    if (verificationStatus === 'rejected') {
      Alert.alert(
        'Eco-Store Locked',
        `Your residency verification document was rejected by City Administration.\n\nReason: ${rejectionReason || 'Document does not verify Danao City residency'}\n\nEco-merch redemptions are strictly reserved for verified Danao City residents. Please update your document in Profile to unlock store redemptions.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Fix in Profile', onPress: () => router.push('/(tabs)/profile?reupload=true' as any) },
        ]
      );
      return;
    }
    if (item.stock !== undefined && item.stock <= 0) {
      Alert.alert('Out of Stock', `"${item.name}" is currently out of stock. Please check back later.`);
      return;
    }
    setSelectedItemForRequest(item);
    setRequestNotes('');
    setRequestModalVisible(true);
  };

  const handleConfirmSubmitRequest = async () => {
    if (!selectedItemForRequest || !user?.uid) return;
    if (verificationStatus === 'rejected') {
      Alert.alert('Verification Required', 'Your proof of residency was rejected. Please re-upload a valid ID in your Profile.');
      return;
    }

    if (balance < selectedItemForRequest.cost) {
      Alert.alert(
        'Insufficient Tokens',
        `You have ${balance.toLocaleString()} eco tokens available. This souvenir requires ${selectedItemForRequest.cost.toLocaleString()} tokens.\n\nKeep reporting waste pickups to earn more tokens!`
      );
      return;
    }

    try {
      setSubmittingRequest(true);
      await submitRewardRequest({
        userId: user.uid,
        userName: userName || user.displayName || 'Resident',
        userEmail: user.email || '',
        barangay: userBarangay || 'Poblacion',
        souvenir: selectedItemForRequest,
        notes: requestNotes,
      });

      setRequestModalVisible(false);
      setViewTab('requests'); // Switch to requests tab to see it
      Alert.alert(
        'Request Submitted!',
        `Your request for "${selectedItemForRequest.name}" has been forwarded to your Brgy. ${userBarangay || 'Poblacion'} Coordinator and CENRO.\n\nNotice: Zero tokens have been deducted now. Tokens will only be taken once your coordinator confirms and releases the item to you.`,
        [{ text: 'OK' }]
      );
    } catch (err: any) {
      console.error('Error submitting reward request:', err);
      Alert.alert('Submission Failed', err?.message || 'Could not submit your request. Please try again.');
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handleCancelRequest = (req: RewardRequest) => {
    if (!user?.uid) return;
    Alert.alert(
      'Cancel Request',
      `Are you sure you want to cancel your request for "${req.souvenirName}"?`,
      [
        { text: 'Keep Request', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelRewardRequest(req, user.uid);
              Alert.alert('Request Cancelled', 'Your reward request has been cancelled.');
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not cancel request.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.screen}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color="#1F4D35" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>TRASHTRACK ECO-STORE</Text>
          <Text style={styles.title}>Eco-Souvenirs & Merch</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} size="large" color="#2E7D32" />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Rejection Alert Banner if rejected */}
          {verificationStatus === 'rejected' && (
            <View style={{
              backgroundColor: '#FEF2F2',
              borderColor: '#FECACA',
              borderWidth: 1.5,
              borderRadius: 14,
              padding: 14,
              marginBottom: 16,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 12,
            }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="gpp-bad" size={20} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: '#991B1B', marginBottom: 2 }}>
                  Eco-Store Redemption Restricted
                </Text>
                <Text style={{ fontSize: 12, color: '#B91C1C', lineHeight: 16, marginBottom: 8 }}>
                  Your proof of residency was rejected ({rejectionReason || 'document unverified'}). You cannot claim eco-souvenirs until a valid Danao City ID is approved.
                </Text>
                <TouchableOpacity
                  style={{
                    backgroundColor: '#DC2626',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 6,
                    alignSelf: 'flex-start',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                  onPress={() => router.push('/(tabs)/profile?reupload=true' as any)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="upload-file" size={14} color="#FFFFFF" />
                  <Text style={{ color: '#FFFFFF', fontSize: 11.5, fontWeight: '700' }}>Re-upload Proof of Residency</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Available Balance Card */}
          <View style={styles.balanceCard}>
            <View style={styles.balanceHeader}>
              <MaterialIcons name="stars" size={18} color="#A7F3D0" />
              <Text style={styles.balanceLabel}>AVAILABLE ECO-TOKENS</Text>
            </View>
            <Text style={styles.balanceValue}>{balance.toLocaleString()}</Text>
            <Text style={styles.balanceUnit}>spendable tokens</Text>

            {pendingTokens > 0 && (
              <View style={styles.pendingBadge}>
                <MaterialIcons name="hourglass-empty" size={14} color="#FEF08A" />
                <Text style={styles.pendingBadgeText}>
                  {pendingTokens.toLocaleString()} tokens reserved for pending requests
                </Text>
              </View>
            )}

            {pendingReports.length > 0 && (
              <View style={[styles.pendingBadge, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0', marginTop: pendingTokens > 0 ? 6 : 10 }]}>
                <MaterialIcons name="schedule" size={14} color="#15803D" />
                <Text style={[styles.pendingBadgeText, { color: '#15803D' }]}>
                  {pendingReports.length * 50} tokens pending ({pendingReports.length} report{pendingReports.length > 1 ? 's' : ''} awaiting collection)
                </Text>
              </View>
            )}

            <View style={styles.balanceRow}>
              <View style={styles.balanceSubItem}>
                <Text style={styles.balanceSubLabel}>Lifetime Earned</Text>
                <Text style={styles.balanceMeta}>+{earned.toLocaleString()}</Text>
              </View>
              <View style={styles.balanceDivider} />
              <View style={styles.balanceSubItem}>
                <Text style={styles.balanceSubLabel}>Released & Redeemed</Text>
                <Text style={styles.balanceMeta}>-{spent.toLocaleString()}</Text>
              </View>
            </View>
          </View>

          {/* Barangay Routing Notice Banner */}
          <View style={styles.infoBanner}>
            <MaterialIcons name="location-on" size={20} color="#047857" style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoBannerTitle}>
                Assigned Barangay: Brgy. {userBarangay || 'Poblacion'}
              </Text>
              <Text style={styles.infoBannerText}>
                Eco-souvenirs are distributed directly through your Barangay Hall Coordinator & CENRO. Zero tokens are deducted when submitting a request; tokens will only be taken once your Coordinator or CENRO confirms and releases the item to you.
              </Text>
            </View>
          </View>

          {/* Segmented Control Tabs */}
          <View style={styles.segmentedContainer}>
            <TouchableOpacity
              style={[styles.segmentBtn, viewTab === 'catalog' && styles.segmentBtnActive]}
              onPress={() => setViewTab('catalog')}
            >
              <MaterialIcons
                name="storefront"
                size={15}
                color={viewTab === 'catalog' ? '#065F46' : '#64748B'}
              />
              <Text style={[styles.segmentText, viewTab === 'catalog' && styles.segmentTextActive]} numberOfLines={1}>
                Catalog ({catalogItems.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.segmentBtn, viewTab === 'requests' && styles.segmentBtnActive]}
              onPress={() => setViewTab('requests')}
            >
              <MaterialIcons
                name="schedule"
                size={15}
                color={viewTab === 'requests' ? '#065F46' : '#64748B'}
              />
              <Text style={[styles.segmentText, viewTab === 'requests' && styles.segmentTextActive]} numberOfLines={1}>
                Requests ({requests.length})
              </Text>
              {pendingRequests.length > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{pendingRequests.length}</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.segmentBtn, viewTab === 'history' && styles.segmentBtnActive]}
              onPress={() => setViewTab('history')}
            >
              <MaterialIcons
                name="history"
                size={15}
                color={viewTab === 'history' ? '#065F46' : '#64748B'}
              />
              <Text style={[styles.segmentText, viewTab === 'history' && styles.segmentTextActive]} numberOfLines={1}>
                History ({awards.length + redemptions.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* 1. SOUVENIR CATALOG TAB */}
          {viewTab === 'catalog' && (
            <View>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Eco-Souvenirs & Merch</Text>
                <Text style={styles.catalogCount}>{catalogItems.length} items available</Text>
              </View>
              <Text style={styles.sectionHelp}>
                Tap any souvenir below to submit a request to your Barangay Coordinator.
              </Text>

              {catalogItems.map((item) => {
                const eligible = balance >= item.cost;
                const pointsNeeded = Math.max(0, item.cost - balance);
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.catalogCard, eligible && styles.catalogCardEligible]}
                    onPress={() => handleOpenRequest(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.giftIcon}>
                      {item.imageUrl ? (
                        <Image
                          source={{ uri: item.imageUrl }}
                          style={{ width: '100%', height: '100%', borderRadius: 12 }}
                          resizeMode="cover"
                        />
                      ) : (
                        <MaterialIcons
                          name={
                            item.category === 'Apparel'
                              ? 'checkroom'
                              : item.category === 'Eco Kit'
                              ? 'eco'
                              : item.category === 'Household'
                              ? 'home'
                              : 'card-giftcard'
                          }
                          size={24}
                          color={eligible ? '#059669' : '#64748B'}
                        />
                      )}
                    </View>

                    <View style={{ flex: 1, paddingHorizontal: 4 }}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemType}>{item.type || item.category || 'Eco Item'}</Text>
                      <View style={styles.eligibilityRow}>
                        <MaterialIcons
                          name={eligible ? 'check-circle' : 'lock'}
                          size={13}
                          color={eligible ? '#059669' : '#94A3B8'}
                        />
                        <Text style={[styles.eligibilityText, eligible ? styles.eligibleText : styles.ineligibleText]}>
                          {eligible ? 'Eligible to request' : `Need ${pointsNeeded.toLocaleString()} more tokens`}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.cardRightCol}>
                      <View style={[styles.costBadge, eligible && styles.costBadgeReady]}>
                        <Text style={[styles.costText, eligible && styles.costTextReady]}>
                          {item.cost.toLocaleString()}
                        </Text>
                        <Text style={[styles.costUnit, eligible && styles.costTextReady]}>TOKENS</Text>
                      </View>
                      <View style={[styles.requestActionBtn, eligible && styles.requestActionBtnActive]}>
                        <Text style={[styles.requestActionBtnText, eligible && styles.requestActionBtnTextActive]}>
                          Request
                        </Text>
                        <MaterialIcons
                          name="arrow-forward"
                          size={12}
                          color={eligible ? '#FFFFFF' : '#64748B'}
                        />
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* 2. MY REQUESTS TAB */}
          {viewTab === 'requests' && (
            <View>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>My Reward Requests</Text>
                <Text style={styles.catalogCount}>{requests.length} requests</Text>
              </View>
              <Text style={styles.sectionHelp}>
                Track your requests. Tokens are taken only after your Brgy. Coordinator or CENRO confirms handover.
              </Text>

              {requests.length === 0 ? (
                <View style={styles.emptyCard}>
                  <MaterialIcons name="card-giftcard" size={40} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>No requests submitted yet</Text>
                  <Text style={styles.emptyText}>
                    Browse our Eco-Souvenirs Catalog and click on any item to request it!
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyActionBtn}
                    onPress={() => setViewTab('catalog')}
                  >
                    <Text style={styles.emptyActionBtnText}>Browse Souvenirs</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                requests.map((req) => {
                  const isPending = req.status === 'pending';
                  const isConfirmed = req.status === 'confirmed';
                  const isDeclined = req.status === 'declined';
                  const isCancelled = req.status === 'cancelled';

                  return (
                    <View
                      key={req.id}
                      style={[
                        styles.requestCard,
                        isPending && styles.requestCardPending,
                        isConfirmed && styles.requestCardConfirmed,
                        isDeclined && styles.requestCardDeclined,
                      ]}
                    >
                      <View style={styles.requestCardHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.requestItemName}>{req.souvenirName}</Text>
                          <Text style={styles.requestDateText}>
                            Requested on {dateLabel(req.createdAt)} · Brgy. {req.barangay || 'Poblacion'}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.statusBadge,
                            isPending && styles.statusBadgePending,
                            isConfirmed && styles.statusBadgeConfirmed,
                            isDeclined && styles.statusBadgeDeclined,
                            isCancelled && styles.statusBadgeCancelled,
                          ]}
                        >
                          <MaterialIcons
                            name={
                              isPending
                                ? 'hourglass-empty'
                                : isConfirmed
                                ? 'check-circle'
                                : isDeclined
                                ? 'cancel'
                                : 'do-not-disturb'
                            }
                            size={12}
                            color={
                              isPending
                                ? '#B45309'
                                : isConfirmed
                                ? '#15803D'
                                : isDeclined
                                ? '#B91C1C'
                                : '#64748B'
                            }
                          />
                          <Text
                            style={[
                              styles.statusBadgeText,
                              isPending && styles.statusTextPending,
                              isConfirmed && styles.statusTextConfirmed,
                              isDeclined && styles.statusTextDeclined,
                              isCancelled && styles.statusTextCancelled,
                            ]}
                          >
                            {isPending
                              ? 'PENDING REVIEW'
                              : isConfirmed
                              ? 'CONFIRMED & RELEASED'
                              : isDeclined
                              ? 'DECLINED'
                              : 'CANCELLED'}
                          </Text>
                        </View>
                      </View>

                      {/* Request Details & Status Explanations */}
                      <View style={styles.requestBody}>
                        <View style={styles.requestBodyRow}>
                          <Text style={styles.requestBodyLabel}>Token Cost:</Text>
                          <Text style={styles.requestCostValue}>{req.cost} tokens</Text>
                        </View>

                        {isPending && (
                          <View style={styles.pendingNoticeBox}>
                            <MaterialIcons name="info-outline" size={16} color="#B45309" />
                            <Text style={styles.pendingNoticeText}>
                              Tokens reserved: Zero tokens deducted yet. Tokens will be deducted once confirmed by your Brgy. {req.barangay || 'Poblacion'} Coordinator or CENRO.
                            </Text>
                          </View>
                        )}

                        {isConfirmed && (
                          <View style={styles.confirmedNoticeBox}>
                            <MaterialIcons name="verified" size={16} color="#15803D" />
                            <Text style={styles.confirmedNoticeText}>
                              Confirmed & released on {dateLabel(req.confirmedAt)} by {req.confirmedByName || 'Barangay Staff'}. {req.cost} tokens deducted.
                            </Text>
                          </View>
                        )}

                        {isDeclined && (
                          <View style={styles.declinedNoticeBox}>
                            <MaterialIcons name="error-outline" size={16} color="#B91C1C" />
                            <Text style={styles.declinedNoticeText}>
                              Reason: {req.declinedReason || 'Item currently out of stock at barangay hall'}. Zero tokens were deducted.
                            </Text>
                          </View>
                        )}

                        {req.notes ? (
                          <Text style={styles.requestNotesText}>
                            Note: &quot;{req.notes}&quot;
                          </Text>
                        ) : null}
                      </View>

                      {/* Cancel Action for Pending */}
                      {isPending && (
                        <View style={styles.requestFooter}>
                          <TouchableOpacity
                            style={styles.cancelRequestBtn}
                            onPress={() => handleCancelRequest(req)}
                          >
                            <MaterialIcons name="close" size={14} color="#EF4444" />
                            <Text style={styles.cancelRequestBtnText}>Cancel Request</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          )}

          {/* 3. ACTIVITY HISTORY TAB */}
          {viewTab === 'history' && (
            <View>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Verified Activity</Text>
                <Text style={styles.catalogCount}>
                  {awards.length + redemptions.length + resolvedReports.length} records
                </Text>
              </View>

              {awards.length === 0 && redemptions.length === 0 && resolvedReports.length === 0 ? (
                <View style={styles.emptyCard}>
                  <MaterialIcons name="eco" size={34} color="#86A88F" />
                  <Text style={styles.emptyTitle}>No reward activity yet</Text>
                  <Text style={styles.emptyText}>
                    A resolved trash report or verified completed pickup earns 50 tokens automatically.
                  </Text>
                </View>
              ) : (
                <>
                  {/* Resolved Trash Reports with +50 points */}
                  {resolvedReports.map((report) => {
                    const hasAward = awards.some((a) => a.reportId === report.id || a.id === `report_${report.id}`);
                    if (hasAward) return null; // already accounted for in awards list
                    const points = Number(report.rewardPoints || 50);
                    const repDate = report.resolvedAt || report.collectedAt || report.updatedAt || report.createdAt;
                    return (
                      <View key={`report_${report.id}`} style={styles.activityRow}>
                        <MaterialIcons name="task-alt" size={22} color="#059669" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.activityTitle}>Report Resolved · {report.title || 'Trash Report'}</Text>
                          <Text style={styles.activityMeta}>
                            {dateLabel(repDate)} · Brgy. {report.barangay || userBarangay || 'Danao'} · Cleaned
                          </Text>
                        </View>
                        <Text style={styles.earned}>+{points}</Text>
                      </View>
                    );
                  })}

                  {awards.map((item) => (
                    <View key={item.id} style={styles.activityRow}>
                      <MaterialIcons name="add-circle" size={22} color="#15803D" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.activityTitle}>{item.reason || 'Verified pickup reward'}</Text>
                        <Text style={styles.activityMeta}>
                          {dateLabel(item.awardedAt)} {item.reportId ? `· Report ${item.reportId}` : ''}
                        </Text>
                      </View>
                      <Text style={styles.earned}>+{item.tokens}</Text>
                    </View>
                  ))}
                  {redemptions.map((item) => (
                    <View key={item.id} style={styles.activityRow}>
                      <MaterialIcons name="redeem" size={22} color="#B45309" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.activityTitle}>{item.souvenirName}</Text>
                        <Text style={styles.activityMeta}>
                          {dateLabel(item.issuedAt)} · Confirmed at Brgy. {item.confirmedBarangay || 'Hall'}
                        </Text>
                      </View>
                      <Text style={styles.spent}>-{item.cost}</Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* REQUEST CONFIRMATION MODAL */}
      <Modal
        visible={requestModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !submittingRequest && setRequestModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedItemForRequest && (
              <>
                {/* Modal Header */}
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalEyebrow}>CONFIRM REWARD REQUEST</Text>
                    <Text style={styles.modalTitle}>{selectedItemForRequest.name}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.modalCloseBtn}
                    onPress={() => !submittingRequest && setRequestModalVisible(false)}
                    disabled={submittingRequest}
                  >
                    <MaterialIcons name="close" size={22} color="#475569" />
                  </TouchableOpacity>
                </View>

                {/* Modal Body */}
                <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                  {/* Item Preview */}
                  <View style={styles.modalItemPreview}>
                    <View style={styles.modalItemIconWrap}>
                      {selectedItemForRequest.imageUrl ? (
                        <Image
                          source={{ uri: selectedItemForRequest.imageUrl }}
                          style={{ width: '100%', height: '100%', borderRadius: 12 }}
                          resizeMode="cover"
                        />
                      ) : (
                        <MaterialIcons name="card-giftcard" size={32} color="#059669" />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalItemCategory}>
                        {selectedItemForRequest.category || 'Eco-Reward'}
                      </Text>
                      <Text style={styles.modalItemType}>{selectedItemForRequest.type}</Text>
                      <View style={styles.modalCostRow}>
                        <Text style={styles.modalCostNumber}>{selectedItemForRequest.cost}</Text>
                        <Text style={styles.modalCostLabel}>Tokens Required</Text>
                      </View>
                    </View>
                  </View>

                  {/* Token Balance Summary Box */}
                  <View style={styles.modalBalanceBox}>
                    <View style={styles.modalBalanceRow}>
                      <Text style={styles.modalBalanceTextLabel}>Your Available Balance:</Text>
                      <Text style={styles.modalBalanceTextVal}>{balance.toLocaleString()} tokens</Text>
                    </View>
                    <View style={styles.modalBalanceRow}>
                      <Text style={styles.modalBalanceTextLabel}>Item Cost:</Text>
                      <Text style={styles.modalBalanceCostVal}>-{selectedItemForRequest.cost.toLocaleString()} tokens</Text>
                    </View>
                    <View style={styles.modalBalanceDivider} />
                    <View style={styles.modalBalanceRow}>
                      <Text style={styles.modalBalanceTextLabelTotal}>Remaining Balance upon Release:</Text>
                      <Text
                        style={[
                          styles.modalBalanceTextValTotal,
                          balance < selectedItemForRequest.cost && { color: '#DC2626' },
                        ]}
                      >
                        {Math.max(0, balance - selectedItemForRequest.cost).toLocaleString()} tokens
                      </Text>
                    </View>
                  </View>

                  {/* Barangay & Token Timing Disclosure */}
                  <View style={styles.modalRoutingBox}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <MaterialIcons name="verified-user" size={18} color="#059669" />
                      <Text style={styles.modalRoutingTitle}>Barangay Verification Notice</Text>
                    </View>
                    <Text style={styles.modalRoutingText}>
                      • Pick-up Station: <Text style={{ fontWeight: '700' }}>Brgy. {userBarangay || 'Poblacion'} Hall</Text>
                    </Text>
                    <Text style={styles.modalRoutingText}>
                      • <Text style={{ fontWeight: '700', color: '#047857' }}>Token Policy:</Text> Zero tokens will be taken right now. Your tokens will be deducted only AFTER your Brgy. Coordinator or CENRO verifies and hands over the souvenir.
                    </Text>
                  </View>

                  {/* Optional Notes */}
                  <View style={styles.modalInputWrap}>
                    <Text style={styles.inputLabel}>Special Instructions or Size (Optional):</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="e.g., Size Medium, will claim on Friday afternoon"
                      placeholderTextColor="#94A3B8"
                      value={requestNotes}
                      onChangeText={setRequestNotes}
                      maxLength={120}
                    />
                  </View>
                </ScrollView>

                {/* Modal Footer Actions */}
                <View style={styles.modalFooter}>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    onPress={() => setRequestModalVisible(false)}
                    disabled={submittingRequest}
                  >
                    <Text style={styles.modalCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.modalSubmitBtn,
                      (submittingRequest || balance < selectedItemForRequest.cost) &&
                        styles.modalSubmitBtnDisabled,
                    ]}
                    onPress={handleConfirmSubmitRequest}
                    disabled={submittingRequest || balance < selectedItemForRequest.cost}
                  >
                    {submittingRequest ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <MaterialIcons name="send" size={16} color="#FFFFFF" />
                        <Text style={styles.modalSubmitBtnText}>
                          {balance < selectedItemForRequest.cost
                            ? 'Insufficient Balance'
                            : 'Submit Request'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F0FDF4' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 18,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#D1FAE5',
  },
  back: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: { color: '#047857', fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: '#064E3B', fontSize: 22, fontWeight: '900', marginTop: 2 },
  content: { padding: 18, paddingBottom: 48 },

  // Balance Card
  balanceCard: {
    borderRadius: 22,
    backgroundColor: '#064E3B',
    padding: 22,
    alignItems: 'center',
    shadowColor: '#064E3B',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 6,
  },
  balanceHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  balanceLabel: { color: '#A7F3D0', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  balanceValue: { color: '#FFFFFF', fontSize: 44, fontWeight: '900', marginTop: 4 },
  balanceUnit: { color: '#D1FAE5', fontSize: 13, marginTop: -3, fontWeight: '600' },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(254, 240, 138, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 12,
  },
  pendingBadgeText: { color: '#FEF08A', fontSize: 11, fontWeight: '700' },
  balanceRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.18)',
    marginTop: 18,
    paddingTop: 14,
  },
  balanceSubItem: { alignItems: 'center' },
  balanceSubLabel: { color: '#A7F3D0', fontSize: 10, fontWeight: '600' },
  balanceMeta: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', marginTop: 2 },
  balanceDivider: { width: 1, height: 26, backgroundColor: 'rgba(255,255,255,0.2)' },

  // Barangay Notice Banner
  infoBanner: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
  },
  infoBannerTitle: { color: '#065F46', fontSize: 13, fontWeight: '800', marginBottom: 2 },
  infoBannerText: { color: '#047857', fontSize: 11, lineHeight: 16 },

  // Segmented Control
  segmentedContainer: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 14,
    padding: 4,
    gap: 4,
    marginTop: 16,
    marginBottom: 16,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 11,
    position: 'relative',
  },
  segmentBtnActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  segmentText: { color: '#64748B', fontSize: 11.5, fontWeight: '700' },
  segmentTextActive: { color: '#065F46', fontWeight: '800' },
  tabBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#F59E0B',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    zIndex: 10,
  },
  tabBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900', lineHeight: 11 },
  tabCountPill: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
  },
  tabCountPillText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  sectionTitle: { color: '#064E3B', fontSize: 18, fontWeight: '800' },
  catalogCount: { color: '#059669', fontSize: 12, fontWeight: '700' },
  sectionHelp: { color: '#4B5563', fontSize: 11, lineHeight: 16, marginTop: 2, marginBottom: 14 },

  // Catalog Card
  catalogCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 2,
  },
  catalogCardEligible: { borderColor: '#A7F3D0' },
  giftIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemName: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  itemType: { color: '#64748B', fontSize: 11, marginTop: 2 },
  eligibilityRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  eligibilityText: { fontSize: 10, fontWeight: '700' },
  eligibleText: { color: '#059669' },
  ineligibleText: { color: '#94A3B8' },

  cardRightCol: { alignItems: 'flex-end', gap: 8 },
  costBadge: {
    minWidth: 72,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  costBadgeReady: { backgroundColor: '#DCFCE7' },
  costText: { color: '#475569', fontSize: 13, fontWeight: '900' },
  costTextReady: { color: '#15803D' },
  costUnit: { color: '#64748B', fontSize: 8, fontWeight: '800' },

  requestActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  requestActionBtnActive: { backgroundColor: '#059669' },
  requestActionBtnText: { color: '#64748B', fontSize: 11, fontWeight: '800' },
  requestActionBtnTextActive: { color: '#FFFFFF' },

  // Requests Tab Cards
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  requestCardPending: { borderColor: '#FDE68A', backgroundColor: '#FFFDF5' },
  requestCardConfirmed: { borderColor: '#BBF7D0', backgroundColor: '#F9FDF9' },
  requestCardDeclined: { borderColor: '#FECACA', backgroundColor: '#FEF8F8' },

  requestCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  requestItemName: { color: '#0F172A', fontSize: 15, fontWeight: '800' },
  requestDateText: { color: '#64748B', fontSize: 11, marginTop: 2 },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgePending: { backgroundColor: '#FEF3C7' },
  statusBadgeConfirmed: { backgroundColor: '#DCFCE7' },
  statusBadgeDeclined: { backgroundColor: '#FEE2E2' },
  statusBadgeCancelled: { backgroundColor: '#F1F5F9' },
  statusBadgeText: { fontSize: 10, fontWeight: '800' },
  statusTextPending: { color: '#B45309' },
  statusTextConfirmed: { color: '#15803D' },
  statusTextDeclined: { color: '#B91C1C' },
  statusTextCancelled: { color: '#64748B' },

  requestBody: { marginTop: 12 },
  requestBodyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  requestBodyLabel: { color: '#64748B', fontSize: 12, fontWeight: '600' },
  requestCostValue: { color: '#0F172A', fontSize: 13, fontWeight: '800' },

  pendingNoticeBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FEF3C7',
    padding: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  pendingNoticeText: { color: '#92400E', fontSize: 11, lineHeight: 15, flex: 1 },

  confirmedNoticeBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#DCFCE7',
    padding: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  confirmedNoticeText: { color: '#166534', fontSize: 11, lineHeight: 15, flex: 1 },

  declinedNoticeBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FEE2E2',
    padding: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  declinedNoticeText: { color: '#991B1B', fontSize: 11, lineHeight: 15, flex: 1 },

  requestNotesText: { color: '#475569', fontSize: 11, fontStyle: 'italic', marginTop: 8 },

  requestFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  cancelRequestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
  },
  cancelRequestBtnText: { color: '#DC2626', fontSize: 11, fontWeight: '800' },

  // Activity History
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  activityTitle: { color: '#1E293B', fontSize: 13, fontWeight: '800' },
  activityMeta: { color: '#64748B', fontSize: 10, marginTop: 3 },
  earned: { color: '#15803D', fontSize: 15, fontWeight: '900' },
  spent: { color: '#B45309', fontSize: 15, fontWeight: '900' },

  // Empty State
  emptyCard: {
    alignItems: 'center',
    borderRadius: 18,
    padding: 32,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 8,
  },
  emptyTitle: { color: '#1E293B', fontSize: 15, fontWeight: '800', marginTop: 10 },
  emptyText: { color: '#64748B', fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  emptyActionBtn: {
    marginTop: 18,
    backgroundColor: '#059669',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  emptyActionBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalEyebrow: { color: '#059669', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  modalTitle: { color: '#0F172A', fontSize: 18, fontWeight: '900', marginTop: 2 },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: { paddingHorizontal: 22, paddingVertical: 14 },
  modalItemPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  modalItemIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalItemCategory: { color: '#059669', fontSize: 11, fontWeight: '800' },
  modalItemType: { color: '#64748B', fontSize: 11, marginTop: 2 },
  modalCostRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 },
  modalCostNumber: { color: '#0F172A', fontSize: 18, fontWeight: '900' },
  modalCostLabel: { color: '#64748B', fontSize: 11, fontWeight: '700' },

  modalBalanceBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  modalBalanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 2,
  },
  modalBalanceTextLabel: { color: '#334155', fontSize: 12, fontWeight: '600' },
  modalBalanceTextVal: { color: '#059669', fontSize: 12, fontWeight: '800' },
  modalBalanceCostVal: { color: '#B45309', fontSize: 12, fontWeight: '800' },
  modalBalanceDivider: { height: 1, backgroundColor: '#DCFCE7', marginVertical: 6 },
  modalBalanceTextLabelTotal: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  modalBalanceTextValTotal: { color: '#0F172A', fontSize: 14, fontWeight: '900' },

  modalRoutingBox: {
    backgroundColor: '#ECFDF5',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#059669',
  },
  modalRoutingTitle: { color: '#065F46', fontSize: 12, fontWeight: '800' },
  modalRoutingText: { color: '#047857', fontSize: 11, lineHeight: 16, marginTop: 4 },

  modalInputWrap: { marginBottom: 16 },
  inputLabel: { color: '#334155', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
  },

  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: { color: '#475569', fontSize: 13, fontWeight: '800' },
  modalSubmitBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#059669',
  },
  modalSubmitBtnDisabled: { backgroundColor: '#94A3B8' },
  modalSubmitBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});
