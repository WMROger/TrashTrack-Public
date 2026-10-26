import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  Image,
  ActivityIndicator,
  Platform,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { auth, db } from '../../../config/firebase';
import {
  collection,
  query,
  onSnapshot,
  doc,
  getDoc,
  limit,
} from 'firebase/firestore';
import { DANAO_CITY_BARANGAYS } from '../../../constants/danaoBarangays';
import {
  RewardRequest,
  RewardSouvenir,
  confirmRewardRequest,
  declineRewardRequest,
} from '../../../services/rewardService';
import ExportModal from './ExportModal';
import { exportReport, ExportFormat } from '@/services/reportExportService';
import UserLeaderboardView from '../UserLeaderboardView';

export default function CenroRewardsTab({
  userRole,
  assignedBarangay,
  isReadOnly = false,
}: {
  userRole?: string;
  assignedBarangay?: string;
  isReadOnly?: boolean;
} = {}) {
  const isCoordinator =
    userRole === 'coordinator' ||
    userRole === 'barangay_coordinator' ||
    userRole === 'cenro_coordinator';
  const effectiveBarangay = (assignedBarangay || '').trim();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<RewardRequest[]>([]);
  const [catalogItems, setCatalogItems] = useState<RewardSouvenir[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'pending' | 'confirmed' | 'declined' | 'all' | 'catalog' | 'leaderboard'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBarangayFilter, setSelectedBarangayFilter] = useState<string>(
    isCoordinator && effectiveBarangay ? effectiveBarangay : 'all'
  );
  const [showBarangayDropdown, setShowBarangayDropdown] = useState(false);
  const [barangayFilterSearch, setBarangayFilterSearch] = useState('');

  const filteredBarangayList = useMemo(() => {
    const q = barangayFilterSearch.trim().toLowerCase();
    if (!q) return DANAO_CITY_BARANGAYS;
    return DANAO_CITY_BARANGAYS.filter((b) => b.toLowerCase().includes(q));
  }, [barangayFilterSearch]);

  // Confirmation Modal State
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RewardRequest | null>(null);
  const [userBalanceMap, setUserBalanceMap] = useState<Record<string, number>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (feedbackMessage) {
      const timer = setTimeout(() => setFeedbackMessage(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [feedbackMessage]);

  // Decline Modal State
  const [declineModalVisible, setDeclineModalVisible] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  // 1. Live subscription to reward_requests
  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const unsubRequests = onSnapshot(
      collection(db, 'reward_requests'),
      (snapshot) => {
        const items = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as RewardRequest[];

        // Sort: newest first
        items.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          return tB - tA;
        });

        setRequests(items);
        setLoading(false);
      },
      (err) => {
        console.warn('Error loading reward requests:', err);
        setLoading(false);
      }
    );

    // Live subscription to reward_catalog
    const unsubCatalog = onSnapshot(
      collection(db, 'reward_catalog'),
      (snapshot) => {
        if (!snapshot.empty) {
          const items = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          })) as RewardSouvenir[];
          setCatalogItems(items);
        } else {
          setCatalogItems([]);
        }
      },
      (err) => console.warn('Error loading reward catalog in CENRO:', err)
    );

    return () => {
      unsubRequests();
      unsubCatalog();
    };
  }, []);

  // 2. Fetch live balances for pending request users
  useEffect(() => {
    if (!db || requests.length === 0) return;

    const userIds = Array.from(new Set(requests.map((r) => r.userId).filter(Boolean)));
    userIds.forEach(async (uid) => {
      if (userBalanceMap[uid] !== undefined) return;
      try {
        const uSnap = await getDoc(doc(db, 'users', uid));
        if (uSnap.exists()) {
          const uData = uSnap.data();
          const tokens = Number(uData.points || uData.rewardTokens || 0);
          setUserBalanceMap((prev) => ({ ...prev, [uid]: tokens }));
        }
      } catch {}
    });
  }, [requests]);

  // Filter requests based on role, barangay, sub-tab, and search
  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      // 1. Role / Barangay scoping
      if (isCoordinator && effectiveBarangay) {
        if ((r.barangay || '').toLowerCase() !== effectiveBarangay.toLowerCase()) {
          return false;
        }
      } else if (selectedBarangayFilter !== 'all') {
        if ((r.barangay || '').toLowerCase() !== selectedBarangayFilter.toLowerCase()) {
          return false;
        }
      }

      // 2. Sub-tab status filter
      if (activeSubTab === 'pending' && r.status !== 'pending') return false;
      if (activeSubTab === 'confirmed' && r.status !== 'confirmed') return false;
      if (activeSubTab === 'declined' && r.status !== 'declined' && r.status !== 'cancelled') return false;

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = (r.userName || '').toLowerCase().includes(q);
        const emailMatch = (r.userEmail || '').toLowerCase().includes(q);
        const itemMatch = (r.souvenirName || '').toLowerCase().includes(q);
        const brgyMatch = (r.barangay || '').toLowerCase().includes(q);
        if (!nameMatch && !emailMatch && !itemMatch && !brgyMatch) return false;
      }

      return true;
    });
  }, [requests, isCoordinator, effectiveBarangay, selectedBarangayFilter, activeSubTab, searchQuery]);

  // Counts for tabs & badges
  const stats = useMemo(() => {
    const scoped = requests.filter((r) => {
      if (isCoordinator && effectiveBarangay) {
        return (r.barangay || '').toLowerCase() === effectiveBarangay.toLowerCase();
      }
      if (selectedBarangayFilter !== 'all') {
        return (r.barangay || '').toLowerCase() === selectedBarangayFilter.toLowerCase();
      }
      return true;
    });

    const pending = scoped.filter((r) => r.status === 'pending');
    const confirmed = scoped.filter((r) => r.status === 'confirmed');
    const declined = scoped.filter((r) => r.status === 'declined' || r.status === 'cancelled');
    const tokensTaken = confirmed.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);

    return {
      pendingCount: pending.length,
      confirmedCount: confirmed.length,
      declinedCount: declined.length,
      totalTokensTaken: tokensTaken,
    };
  }, [requests, isCoordinator, effectiveBarangay, selectedBarangayFilter]);

  // Handlers
  const handleOpenConfirm = (req: RewardRequest) => {
    if (!isCoordinator) {
      const msg = 'Physical merchandise must be released and confirmed in-person by the assigned Barangay Coordinator.';
      setFeedbackMessage({ text: `Coordinator Handover Required: ${msg}`, type: 'error' });
      if (Platform.OS === 'web') {
        window.alert(`Coordinator Handover Required\n\n${msg}`);
      } else {
        Alert.alert('Coordinator Handover Required', msg);
      }
      return;
    }
    setSelectedRequest(req);
    setConfirmModalVisible(true);
  };

  const handleExecuteConfirm = async () => {
    if (!selectedRequest || !auth.currentUser) return;
    if (!isCoordinator) {
      const msg = 'Only the assigned Barangay Coordinator can confirm physical item handover.';
      setFeedbackMessage({ text: `Action Restricted: ${msg}`, type: 'error' });
      if (Platform.OS === 'web') {
        window.alert(`Action Restricted\n\n${msg}`);
      } else {
        Alert.alert('Action Restricted', msg);
      }
      return;
    }
    setIsProcessing(true);

    try {
      const staffInfo = {
        uid: auth.currentUser.uid,
        name: auth.currentUser.displayName || auth.currentUser.email || 'Barangay Coordinator',
        role: 'coordinator',
        email: auth.currentUser.email || '',
        barangay: effectiveBarangay || selectedRequest.barangay,
      };

      const souvenirName = selectedRequest.souvenirName;
      const residentName = selectedRequest.userName;
      const tokensDeducted = selectedRequest.cost;

      await confirmRewardRequest(selectedRequest, staffInfo);

      const title = 'Reward Confirmed & Released!';
      const msg = `Successfully released "${souvenirName}" to ${residentName}. ${tokensDeducted.toLocaleString()} tokens were deducted from their account.`;

      setFeedbackMessage({
        text: `✓ ${title} ${msg}`,
        type: 'success',
      });

      if (Platform.OS === 'web') {
        window.alert(`✓ ${title}\n\n${msg}`);
      } else {
        Alert.alert(title, msg);
      }

      setConfirmModalVisible(false);
      setSelectedRequest(null);
    } catch (err: any) {
      console.error('Error confirming reward:', err);
      const errMsg = err?.message || 'Could not confirm reward release.';
      setFeedbackMessage({ text: `Confirmation Failed: ${errMsg}`, type: 'error' });
      if (Platform.OS === 'web') {
        window.alert(`Confirmation Failed\n\n${errMsg}`);
      } else {
        Alert.alert('Confirmation Failed', errMsg);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenDecline = (req: RewardRequest) => {
    setSelectedRequest(req);
    setDeclineReason(
      isCoordinator
        ? 'Out of stock at barangay hall / desk'
        : 'Administrative cancellation by CENRO Central'
    );
    setDeclineModalVisible(true);
  };

  const handleExecuteDecline = async () => {
    if (!selectedRequest || !auth.currentUser) return;
    setIsProcessing(true);

    try {
      const staffInfo = {
        uid: auth.currentUser.uid,
        name: auth.currentUser.displayName || auth.currentUser.email || (isCoordinator ? 'Barangay Coordinator' : 'CENRO Officer'),
      };

      const souvenirName = selectedRequest.souvenirName;

      await declineRewardRequest(selectedRequest, declineReason, staffInfo);

      const title = 'Request Declined';
      const msg = `Declined request for "${souvenirName}". No tokens were deducted.`;

      setFeedbackMessage({
        text: `${title}: ${msg}`,
        type: 'success',
      });

      if (Platform.OS === 'web') {
        window.alert(`${title}\n\n${msg}`);
      } else {
        Alert.alert(title, msg);
      }

      setDeclineModalVisible(false);
      setSelectedRequest(null);
    } catch (err: any) {
      console.error('Error declining request:', err);
      const errMsg = err?.message || 'Could not decline request.';
      setFeedbackMessage({ text: `Action Failed: ${errMsg}`, type: 'error' });
      if (Platform.OS === 'web') {
        window.alert(`Action Failed\n\n${errMsg}`);
      } else {
        Alert.alert('Action Failed', errMsg);
      }
    } finally {
      setIsProcessing(false);
    }
  };

    const formatTimestamp = (val: any) => {
    if (!val) return 'Recently';
    const date = val?.toDate ? val.toDate() : new Date(val);
    return isNaN(date.getTime()) ? 'Recently' : `${date.toLocaleDateString()} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const [isExportModalVisible, setIsExportModalVisible] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    const headers = [
      'Request ID',
      'Resident Name',
      'Resident Email',
      'Barangay',
      'Souvenir Item',
      'Cost (Tokens)',
      'Status',
      'Request Date',
    ];

    const rows = filteredRequests.map((r) => [
      r.id ? `REQ-${r.id.slice(-6).toUpperCase()}` : 'N/A',
      r.userName || 'Resident',
      r.userEmail || 'N/A',
      r.barangay || 'Poblacion',
      r.souvenirName || 'Souvenir',
      r.cost != null ? `${r.cost} pts` : '0 pts',
      r.status ? r.status.toUpperCase() : 'PENDING',
      formatTimestamp(r.createdAt),
    ]);

    const jurisdictionScope =
      isCoordinator && effectiveBarangay
        ? `Brgy. ${effectiveBarangay}`
        : selectedBarangayFilter !== 'all'
        ? `Brgy. ${selectedBarangayFilter}`
        : 'City of Danao (All Barangays)';

    await exportReport({
      format,
      filename: `danao_rewards_redemptions_${new Date().toISOString().slice(0, 10)}`,
      title: 'Eco-Rewards & Souvenir Redemptions Registry',
      subtitle: 'City Environment & Natural Resources Office Citizen Merch Clearinghouse',
      jurisdiction: jurisdictionScope,
      generatedBy: isCoordinator ? 'Barangay Coordinator' : 'CENRO Rewards Administrator',
      headers,
      rows,
      summaryCards: [
        { label: 'Total Requests', value: filteredRequests.length },
        { label: 'Pending Release', value: stats.pendingCount },
        { label: 'Released & Confirmed', value: stats.confirmedCount },
        { label: 'Tokens Taken', value: `${stats.totalTokensTaken.toLocaleString()} pts` },
      ],
      sheetName: 'Reward_Redemptions',
    });
  };

  return (
    <View style={styles.container}>
      {/* ================= HEADER SECTION ================= */}
      <View style={styles.header}>
        {/* Feedback / Acknowledgment Banner */}
        {feedbackMessage && (
          <View style={{
            marginBottom: 14,
            padding: 12,
            borderRadius: 8,
            backgroundColor: feedbackMessage.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            borderColor: feedbackMessage.type === 'success' ? '#10B981' : '#EF4444',
            borderWidth: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <MaterialIcons
                name={feedbackMessage.type === 'success' ? 'check-circle' : 'error-outline'}
                size={18}
                color={feedbackMessage.type === 'success' ? '#059669' : '#DC2626'}
              />
              <Text style={{
                color: feedbackMessage.type === 'success' ? '#065F46' : '#991B1B',
                fontSize: 13,
                fontWeight: '600',
                flex: 1,
              }}>
                {feedbackMessage.text}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setFeedbackMessage(null)} style={{ padding: 4 }}>
              <MaterialIcons name="close" size={16} color={feedbackMessage.type === 'success' ? '#059669' : '#DC2626'} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.headerTitleRow}>
          <View style={styles.headerIconWrapper}>
            <MaterialIcons name="stars" size={28} color="#0D9488" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={styles.headerTitle}>Eco-Rewards & Merch Distribution</Text>
              <View style={styles.barangayBadge}>
                <MaterialIcons name={isCoordinator ? "location-city" : "hub"} size={13} color="#065F46" />
                <Text style={styles.barangayBadgeText}>
                  {isCoordinator && effectiveBarangay ? `Brgy. ${effectiveBarangay} Desk` : 'Danao City CENRO Central · Citywide Registry'}
                </Text>
              </View>
            </View>
            <Text style={styles.headerSubtitle}>
              {isCoordinator && effectiveBarangay
                ? `Review and verify souvenir requests from residents of Brgy. ${effectiveBarangay}. Confirming releases the item and takes the resident's tokens upon physical handover.`
                : 'Central eco-rewards clearinghouse & oversight registry. Monitor resident eco-merch redemptions verified and released on-site by Barangay Coordinators.'}
            </Text>
          </View>
        </View>

        {/* Stats Row */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { borderLeftColor: '#F59E0B' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.statLabel}>
                {isCoordinator ? 'PENDING RELEASE' : 'AWAITING BRGY RELEASE'}
              </Text>
              <MaterialIcons
                name={isCoordinator ? 'hourglass-top' : 'storefront'}
                size={18}
                color="#D97706"
              />
            </View>
            <Text style={[styles.statValue, { color: '#B45309' }]}>{stats.pendingCount}</Text>
            <Text style={styles.statHint}>
              {isCoordinator ? 'Tokens held until confirmed' : 'Held in reserve by Coordinators'}
            </Text>
          </View>

          <View style={[styles.statCard, { borderLeftColor: '#10B981' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.statLabel}>
                {isCoordinator ? 'RELEASED & CONFIRMED' : 'DISTRIBUTED & CONFIRMED'}
              </Text>
              <MaterialIcons name="check-circle" size={18} color="#059669" />
            </View>
            <Text style={[styles.statValue, { color: '#047857' }]}>{stats.confirmedCount}</Text>
            <Text style={styles.statHint}>
              {isCoordinator ? 'Merchandise handed out' : 'Handed out across Barangays'}
            </Text>
          </View>

          <View style={[styles.statCard, { borderLeftColor: '#0EA5E9' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.statLabel}>
                {isCoordinator ? 'TOKENS TAKEN' : 'TOTAL TOKENS DEDUCTED'}
              </Text>
              <MaterialIcons name="toll" size={18} color="#0284C7" />
            </View>
            <Text style={[styles.statValue, { color: '#0369A1' }]}>{stats.totalTokensTaken.toLocaleString()} pts</Text>
            <Text style={styles.statHint}>
              {isCoordinator ? 'Deducted on confirmation' : 'Settled on Coordinator release'}
            </Text>
          </View>
        </View>
      </View>

      {/* ================= CONTROLS & SUB-TABS ================= */}
      <View style={styles.controlsBar}>
        {/* Navigation Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subTabsContainer}>
          <TouchableOpacity
            style={[styles.subTab, activeSubTab === 'pending' && styles.subTabActive]}
            onPress={() => setActiveSubTab('pending')}
          >
            <Text style={[styles.subTabText, activeSubTab === 'pending' && styles.subTabTextActive]}>
              {isCoordinator ? 'Pending Confirmation' : 'Awaiting Brgy Handover'}
            </Text>
            {stats.pendingCount > 0 && (
              <View style={[styles.countPill, activeSubTab === 'pending' ? styles.countPillActive : null]}>
                <Text style={styles.countPillText}>{stats.pendingCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subTab, activeSubTab === 'confirmed' && styles.subTabActive]}
            onPress={() => setActiveSubTab('confirmed')}
          >
            <Text style={[styles.subTabText, activeSubTab === 'confirmed' && styles.subTabTextActive]}>Confirmed & Released</Text>
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{stats.confirmedCount}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subTab, activeSubTab === 'declined' && styles.subTabActive]}
            onPress={() => setActiveSubTab('declined')}
          >
            <Text style={[styles.subTabText, activeSubTab === 'declined' && styles.subTabTextActive]}>Declined</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subTab, activeSubTab === 'all' && styles.subTabActive]}
            onPress={() => setActiveSubTab('all')}
          >
            <Text style={[styles.subTabText, activeSubTab === 'all' && styles.subTabTextActive]}>All Requests</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subTab, activeSubTab === 'catalog' && styles.subTabActive]}
            onPress={() => setActiveSubTab('catalog')}
          >
            <Text style={[styles.subTabText, activeSubTab === 'catalog' && styles.subTabTextActive]}>Souvenir Catalog</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subTab, activeSubTab === 'leaderboard' && styles.subTabActive]}
            onPress={() => setActiveSubTab('leaderboard')}
          >
            <MaterialIcons
              name="leaderboard"
              size={15}
              color={activeSubTab === 'leaderboard' ? '#FFFFFF' : '#0D9488'}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.subTabText, activeSubTab === 'leaderboard' && styles.subTabTextActive]}>User Leaderboard</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Filter & Search Bar */}
        {activeSubTab !== 'catalog' && activeSubTab !== 'leaderboard' && (
          <View style={styles.filterRow}>
            {/* Search Input */}
            <View style={styles.searchBox}>
              <MaterialIcons name="search" size={18} color="#64748B" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search resident name, email, or souvenir..."
                placeholderTextColor="#94A3B8"
                style={styles.searchInput}
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <MaterialIcons name="close" size={16} color="#64748B" />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Barangay Filter (For CENRO) */}
            {!isCoordinator && (
              <View style={styles.barangayDropdownWrap}>
                <TouchableOpacity
                  style={styles.barangayDropdownBtn}
                  onPress={() => {
                    setBarangayFilterSearch('');
                    setShowBarangayDropdown(true);
                  }}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="filter-list" size={16} color="#0D9488" />
                  <Text style={styles.barangayDropdownBtnText} numberOfLines={1}>
                    {selectedBarangayFilter === 'all'
                      ? `All ${DANAO_CITY_BARANGAYS.length} Barangays`
                      : `Brgy. ${selectedBarangayFilter}`}
                  </Text>
                  <MaterialIcons name="arrow-drop-down" size={20} color="#64748B" />
                </TouchableOpacity>

                <Modal
                  visible={showBarangayDropdown}
                  transparent={true}
                  animationType="fade"
                  onRequestClose={() => setShowBarangayDropdown(false)}
                >
                  <TouchableOpacity
                    style={styles.dropdownModalBackdrop}
                    activeOpacity={1}
                    onPress={() => setShowBarangayDropdown(false)}
                  >
                    <View
                      style={styles.dropdownModalCard}
                      onStartShouldSetResponder={() => true}
                    >
                      <View style={styles.dropdownModalHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <MaterialIcons name="filter-list" size={20} color="#0D9488" />
                          <Text style={styles.dropdownModalTitle}>Filter by Barangay Jurisdiction</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => setShowBarangayDropdown(false)}
                          style={styles.dropdownModalCloseBtn}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons name="close" size={20} color="#6B7280" />
                        </TouchableOpacity>
                      </View>

                      {/* Search Bar for 42 Barangays */}
                      <View style={styles.dropdownSearchBox}>
                        <MaterialIcons name="search" size={18} color="#94A3B8" />
                        <TextInput
                          style={styles.dropdownSearchInput}
                          placeholder="Search among 42 barangays..."
                          placeholderTextColor="#94A3B8"
                          value={barangayFilterSearch}
                          onChangeText={setBarangayFilterSearch}
                        />
                        {barangayFilterSearch ? (
                          <TouchableOpacity onPress={() => setBarangayFilterSearch('')}>
                            <MaterialIcons name="close" size={16} color="#94A3B8" />
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={true}>
                        {/* Option: All 42 Barangays */}
                        {!barangayFilterSearch.trim() && (
                          <TouchableOpacity
                            style={[
                              styles.dropdownItem,
                              selectedBarangayFilter === 'all' && styles.dropdownItemActive,
                            ]}
                            onPress={() => {
                              setSelectedBarangayFilter('all');
                              setShowBarangayDropdown(false);
                            }}
                            activeOpacity={0.7}
                          >
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.dropdownItemText,
                                  selectedBarangayFilter === 'all' && styles.dropdownItemTextActive,
                                ]}
                              >
                                All 42 Barangays (City-Wide)
                              </Text>
                              <Text style={styles.dropdownItemSub}>
                                View rewards and redemptions across all 42 municipal barangays
                              </Text>
                            </View>
                            {selectedBarangayFilter === 'all' && (
                              <MaterialIcons name="check-circle" size={18} color="#0D9488" />
                            )}
                          </TouchableOpacity>
                        )}

                        {filteredBarangayList.map((b) => {
                          const isSelected = selectedBarangayFilter === b;
                          return (
                            <TouchableOpacity
                              key={b}
                              style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                              onPress={() => {
                                setSelectedBarangayFilter(b);
                                setShowBarangayDropdown(false);
                              }}
                              activeOpacity={0.7}
                            >
                              <Text
                                style={[
                                  styles.dropdownItemText,
                                  isSelected && styles.dropdownItemTextActive,
                                ]}
                              >
                                Barangay {b}
                              </Text>
                              {isSelected && (
                                <MaterialIcons name="check-circle" size={18} color="#0D9488" />
                              )}
                            </TouchableOpacity>
                          );
                        })}

                        {filteredBarangayList.length === 0 && (
                          <View style={{ padding: 20, alignItems: 'center' }}>
                            <Text style={{ fontSize: 13, color: '#64748B' }}>
                              No barangay matching &quot;{barangayFilterSearch}&quot;
                            </Text>
                          </View>
                        )}
                      </ScrollView>
                    </View>
                  </TouchableOpacity>
                </Modal>
              </View>
            )}

            {/* Export Button */}
            <TouchableOpacity
              style={styles.exportBtn}
              onPress={() => setIsExportModalVisible(true)}
              activeOpacity={0.8}
            >
              <MaterialIcons name="file-download" size={16} color="#FFFFFF" />
              <Text style={styles.exportBtnText}>Export</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ================= CONTENT BODY ================= */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0D9488" />
          <Text style={styles.loadingText}>Loading eco-merchandise requests...</Text>
        </View>
      ) : activeSubTab === 'catalog' ? (
        /* SOUVENIR CATALOG PREVIEW */
        <ScrollView contentContainerStyle={styles.catalogGrid} showsVerticalScrollIndicator={false}>
          {catalogItems.map((item) => (
            <View key={item.id} style={styles.catalogPreviewCard}>
              <View style={styles.catalogImgWrap}>
                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={styles.catalogImg} resizeMode="cover" />
                ) : (
                  <MaterialIcons name="card-giftcard" size={36} color="#0D9488" />
                )}
                <View style={styles.catalogCategoryBadge}>
                  <Text style={styles.catalogCategoryText}>{item.category || 'General'}</Text>
                </View>
              </View>
              <View style={styles.catalogDetails}>
                <Text style={styles.catalogTitle}>{item.name}</Text>
                <Text style={styles.catalogType} numberOfLines={2}>{item.type || 'Official Danao City Souvenir'}</Text>
                <View style={styles.catalogBottomRow}>
                  <View style={styles.tokenPill}>
                    <MaterialIcons name="stars" size={14} color="#0D9488" />
                    <Text style={styles.tokenPillText}>{item.cost.toLocaleString()} tokens</Text>
                  </View>
                  <Text style={styles.stockLabel}>Stock: {item.stock ?? 50} units</Text>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      ) : activeSubTab === 'leaderboard' ? (
        /* USER & CITIZEN POINTS LEADERBOARD */
        <View style={{ flex: 1, minHeight: 0 }}>
          <UserLeaderboardView
            userRole={userRole}
            assignedBarangay={assignedBarangay}
            canConferAwards={!isCoordinator}
          />
        </View>
      ) : filteredRequests.length === 0 ? (
        /* EMPTY STATE */
        <View style={styles.emptyContainer}>
          <MaterialIcons name="inventory-2" size={48} color="#94A3B8" />
          <Text style={styles.emptyTitle}>
            {activeSubTab === 'pending'
              ? 'No Pending Requests'
              : activeSubTab === 'confirmed'
              ? 'No Confirmed Releases Yet'
              : 'No Requests Found'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {activeSubTab === 'pending'
              ? `There are currently no eco-reward requests awaiting confirmation for ${isCoordinator ? `Brgy. ${effectiveBarangay}` : 'this selection'}.`
              : 'When residents request eco-souvenirs, they will appear here for barangay verification and token release.'}
          </Text>
        </View>
      ) : (
        /* REQUESTS LIST */
        <ScrollView contentContainerStyle={styles.requestsList} showsVerticalScrollIndicator={false}>
          {filteredRequests.map((req) => {
            const isPending = req.status === 'pending';
            const isConfirmed = req.status === 'confirmed';
            const userTokens = userBalanceMap[req.userId];
            const hasSufficient = userTokens !== undefined ? userTokens >= req.cost : true;

            return (
              <View
                key={req.id}
                style={[
                  styles.requestCard,
                  isPending && styles.requestCardPending,
                  isConfirmed && styles.requestCardConfirmed,
                ]}
              >
                {/* Card Top: Souvenir & Resident info */}
                <View style={styles.cardHeaderRow}>
                  {/* Souvenir Icon / Image */}
                  <View style={styles.souvenirThumbWrap}>
                    {req.imageUrl ? (
                      <Image source={{ uri: req.imageUrl }} style={styles.souvenirThumb} resizeMode="cover" />
                    ) : (
                      <MaterialIcons name="card-giftcard" size={26} color="#0D9488" />
                    )}
                  </View>

                  {/* Souvenir Details */}
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <Text style={styles.cardSouvenirTitle}>{req.souvenirName}</Text>
                    <Text style={styles.cardSouvenirType}>{req.souvenirType || 'Official Eco-Reward'}</Text>
                    <View style={styles.cardCostPill}>
                      <MaterialIcons name="stars" size={13} color="#0D9488" />
                      <Text style={styles.cardCostText}>{req.cost.toLocaleString()} tokens</Text>
                    </View>
                  </View>

                  {/* Status Pill */}
                  <View
                    style={[
                      styles.statusPill,
                      isPending ? styles.statusPillPending :
                      isConfirmed ? styles.statusPillConfirmed :
                      styles.statusPillDeclined,
                    ]}
                  >
                    <MaterialIcons
                      name={
                        isPending ? (isCoordinator ? 'hourglass-top' : 'storefront') :
                        isConfirmed ? 'check-circle' :
                        'cancel'
                      }
                      size={13}
                      color={
                        isPending ? '#B45309' :
                        isConfirmed ? '#047857' :
                        '#B91C1C'
                      }
                    />
                    <Text
                      style={[
                        styles.statusPillText,
                        isPending ? styles.statusPillTextPending :
                        isConfirmed ? styles.statusPillTextConfirmed :
                        styles.statusPillTextDeclined,
                      ]}
                    >
                      {isPending
                        ? (isCoordinator ? 'PENDING RELEASE' : 'AWAITING BRGY HANDOVER')
                        : isConfirmed
                        ? 'CONFIRMED & DEDUCTED'
                        : 'DECLINED'}
                    </Text>
                  </View>
                </View>

                {/* Divider */}
                <View style={styles.cardDivider} />

                {/* Card Body: Resident & Verification Info */}
                <View style={styles.cardBodyRow}>
                  {/* Left: Resident Profile & Barangay */}
                  <View style={{ flex: 1 }}>
                    <View style={styles.infoRow}>
                      <MaterialIcons name="person" size={16} color="#64748B" />
                      <Text style={styles.residentNameText}>{req.userName}</Text>
                      <View style={styles.residentBrgyBadge}>
                        <Text style={styles.residentBrgyText}>Brgy. {req.barangay || 'Poblacion'}</Text>
                      </View>
                    </View>

                    <View style={[styles.infoRow, { marginTop: 4 }]}>
                      <MaterialIcons name="email" size={14} color="#94A3B8" />
                      <Text style={styles.residentEmailText}>{req.userEmail || 'No email registered'}</Text>
                    </View>

                    {req.notes ? (
                      <View style={styles.notesBox}>
                        <Text style={styles.notesLabel}>Resident Pickup Note:</Text>
                        <Text style={styles.notesText}>&quot;{req.notes}&quot;</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Right: Balance & Audit Metadata */}
                  <View style={styles.auditColumn}>
                    <Text style={styles.metaLabel}>REQUESTED</Text>
                    <Text style={styles.metaVal}>{formatTimestamp(req.createdAt)}</Text>

                    {isPending ? (
                      <View style={[styles.balanceIndicator, hasSufficient ? styles.balanceOk : styles.balanceLow]}>
                        <MaterialIcons
                          name={hasSufficient ? 'check' : 'warning'}
                          size={13}
                          color={hasSufficient ? '#047857' : '#B45309'}
                        />
                        <Text style={[styles.balanceIndicatorText, { color: hasSufficient ? '#047857' : '#B45309' }]}>
                          Balance: {userTokens !== undefined ? `${userTokens.toLocaleString()} pts` : 'Checking...'}
                        </Text>
                      </View>
                    ) : isConfirmed ? (
                      <View style={styles.confirmedAuditBox}>
                        <Text style={styles.confirmedAuditText}>
                          Released by {req.confirmedByName || 'Coordinator'} ({req.confirmedBarangay || req.barangay})
                        </Text>
                        <Text style={styles.confirmedDateText}>{formatTimestamp(req.confirmedAt)}</Text>
                      </View>
                    ) : (
                      <View style={styles.declinedAuditBox}>
                        <Text style={styles.declinedAuditText}>
                          Reason: {req.declinedReason || 'Cancelled / Declined'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Card Actions (For Pending Items) */}
                {isPending && (
                  !isCoordinator ? (
                    /* CENRO CENTRAL OVERSIGHT ROW (NO CONFIRM BUTTON) */
                    <View style={styles.cenroOversightActionRow}>
                      <View style={styles.cenroOversightBanner}>
                        <View style={styles.cenroOversightIconWrap}>
                          <MaterialIcons name="storefront" size={20} color="#0D9488" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={styles.cenroOversightTitle}>Awaiting Barangay Desk Handover</Text>
                            <View style={styles.cenroDeskBadge}>
                              <MaterialIcons name="location-pin" size={12} color="#065F46" />
                              <Text style={styles.cenroDeskBadgeText}>Brgy. {req.barangay || 'Cabungahan'} Hall</Text>
                            </View>
                          </View>
                          <Text style={styles.cenroOversightText}>
                            Item will be released in person by the <Text style={{ fontWeight: '700', color: '#0F172A' }}>Brgy. {req.barangay || 'assigned'} Coordinator</Text>. Resident tokens ({req.cost.toLocaleString()} pts) are held in reserve and will deduct upon physical handover.
                          </Text>
                        </View>
                      </View>

                      <View style={styles.cenroActionButtons}>
                        <TouchableOpacity
                          style={styles.cenroDeclineBtn}
                          onPress={() => handleOpenDecline(req)}
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="cancel" size={14} color="#DC2626" />
                          <Text style={styles.cenroDeclineBtnText}>Administrative Void</Text>
                        </TouchableOpacity>

                        <View style={styles.cenroCoordinatorRolePill}>
                          <MaterialIcons name="how-to-reg" size={14} color="#0284C7" />
                          <Text style={styles.cenroCoordinatorRoleText}>Coordinator Release Only</Text>
                        </View>
                      </View>
                    </View>
                  ) : (
                    /* COORDINATOR OPERATIONAL ROW (WITH CONFIRM & RELEASE) */
                    <View style={styles.cardActionsRow}>
                      <View style={styles.pendingNotice}>
                        <MaterialIcons name="info-outline" size={14} color="#64748B" />
                        <Text style={styles.pendingNoticeText}>
                          Resident tokens are NOT taken yet. Confirming will deduct {req.cost.toLocaleString()} tokens upon handover.
                        </Text>
                      </View>

                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity
                          style={styles.declineBtn}
                          onPress={() => handleOpenDecline(req)}
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="close" size={16} color="#DC2626" />
                          <Text style={styles.declineBtnText}>Decline</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.confirmBtn}
                          onPress={() => handleOpenConfirm(req)}
                          activeOpacity={0.85}
                        >
                          <MaterialIcons name="check" size={16} color="#FFFFFF" />
                          <Text style={styles.confirmBtnText}>Confirm & Release</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* ================= CONFIRM RELEASE MODAL ================= */}
      <Modal visible={confirmModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconWrap}>
                <MaterialIcons name="stars" size={28} color="#059669" />
              </View>
              <Text style={styles.modalTitle}>Confirm & Release Eco-Reward</Text>
              <Text style={styles.modalSubtitle}>
                Danao City Barangay Rewards Handover Clearance
              </Text>
            </View>

            {selectedRequest && (
              <View style={styles.modalCard}>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>RECIPIENT RESIDENT</Text>
                  <Text style={styles.modalSummaryVal}>{selectedRequest.userName} (Brgy. {selectedRequest.barangay})</Text>
                </View>

                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>ECO-SOUVENIR</Text>
                  <Text style={[styles.modalSummaryVal, { color: '#0F172A', fontWeight: '800' }]}>
                    {selectedRequest.souvenirName}
                  </Text>
                </View>

                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>TOKEN DEDUCTION</Text>
                  <Text style={[styles.modalSummaryVal, { color: '#047857', fontWeight: '800' }]}>
                    -{selectedRequest.cost.toLocaleString()} tokens
                  </Text>
                </View>

                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>HANDOVER DESK</Text>
                  <Text style={styles.modalSummaryVal}>
                    {isCoordinator ? `Brgy. ${effectiveBarangay} Coordinator Desk` : `CENRO Central Desk (${selectedRequest.barangay})`}
                  </Text>
                </View>
              </View>
            )}

            <Text style={styles.modalAlertNotice}>
              ⚠️ By confirming, you verify that the resident has received the physical merchandise. The <Text style={{ fontWeight: '700' }}>{selectedRequest?.cost.toLocaleString()} tokens</Text> will be immediately deducted from their account and recorded into the municipal ledger.
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setConfirmModalVisible(false)}
                disabled={isProcessing}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalExecuteBtn}
                onPress={handleExecuteConfirm}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialIcons name="check" size={16} color="#FFFFFF" />
                    <Text style={styles.modalExecuteBtnText}>Confirm Handover</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ================= DECLINE MODAL ================= */}
      <Modal visible={declineModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconWrap, { backgroundColor: '#FEE2E2', borderColor: '#FECACA' }]}>
                <MaterialIcons name="close" size={28} color="#DC2626" />
              </View>
              <Text style={styles.modalTitle}>
                {isCoordinator ? 'Decline Reward Request' : 'Administrative Void / Decline'}
              </Text>
              <Text style={styles.modalSubtitle}>
                {isCoordinator
                  ? 'No tokens will be deducted from the resident'
                  : 'Cancels this request in the central registry. No tokens will be deducted.'}
              </Text>
            </View>

            <Text style={styles.inputLabel}>
              {isCoordinator ? 'Reason for Declining:' : 'Administrative Cancellation Note:'}
            </Text>
            <TextInput
              style={styles.reasonInput}
              value={declineReason}
              onChangeText={setDeclineReason}
              placeholder={
                isCoordinator
                  ? 'e.g. Out of stock at barangay hall, please select another item.'
                  : 'e.g. Duplicate request or resident cancellation.'
              }
              placeholderTextColor="#94A3B8"
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setDeclineModalVisible(false)}
                disabled={isProcessing}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalExecuteBtn, { backgroundColor: '#DC2626' }]}
                onPress={handleExecuteDecline}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalExecuteBtnText}>
                    {isCoordinator ? 'Decline Request' : 'Confirm Cancellation'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="Eco-Rewards & Merch Redemptions"
        dataCount={filteredRequests.length}
        onExport={handleExport}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 20,
  },
  headerIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F0FDFA',
    borderWidth: 1.5,
    borderColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  barangayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  barangayBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 18,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 14,
    flexWrap: 'wrap',
  },
  statCard: {
    flex: 1,
    minWidth: 180,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
    padding: 14,
  },
  statLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
    marginVertical: 4,
  },
  statHint: {
    fontSize: 11,
    color: '#94A3B8',
  },
  controlsBar: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  subTabsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  subTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  subTabActive: {
    backgroundColor: '#0D9488',
  },
  subTabText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#475569',
  },
  subTabTextActive: {
    color: '#FFFFFF',
  },
  countPill: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countPillActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  countPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0D9488',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  exportBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  searchBox: {
    flex: 1,
    minWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    padding: 0,
  },
  barangayDropdownWrap: {
    position: 'relative',
    zIndex: 100,
  },
  barangayDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  barangayDropdownBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F766E',
  },
  dropdownModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
  },
  dropdownModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxWidth: 440,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 12,
    overflow: 'hidden',
  },
  dropdownModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownModalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  dropdownModalCloseBtn: {
    padding: 4,
  },
  dropdownSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dropdownSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    padding: 0,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownItemActive: {
    backgroundColor: '#F0FDFA',
  },
  dropdownItemText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  dropdownItemTextActive: {
    color: '#0D9488',
    fontWeight: '800',
  },
  dropdownItemSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 420,
    lineHeight: 18,
  },
  requestsList: {
    padding: 20,
    gap: 14,
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  requestCardPending: {
    borderColor: '#FDE68A',
    backgroundColor: '#FFFDF5',
  },
  requestCardConfirmed: {
    borderColor: '#BBF7D0',
    backgroundColor: '#FFFFFF',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  souvenirThumbWrap: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  souvenirThumb: {
    width: '100%',
    height: '100%',
  },
  cardSouvenirTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSouvenirType: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  cardCostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
  },
  cardCostText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillPending: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  statusPillConfirmed: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  statusPillDeclined: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusPillTextPending: { color: '#92400E' },
  statusPillTextConfirmed: { color: '#065F46' },
  statusPillTextDeclined: { color: '#991B1B' },
  cardDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 12,
  },
  cardBodyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  residentNameText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#1E293B',
  },
  residentBrgyBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  residentBrgyText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#475569',
  },
  residentEmailText: {
    fontSize: 12,
    color: '#64748B',
  },
  notesBox: {
    marginTop: 8,
    backgroundColor: '#F8FAFC',
    borderLeftWidth: 3,
    borderLeftColor: '#0D9488',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 4,
  },
  notesLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  notesText: {
    fontSize: 11.5,
    color: '#334155',
    fontStyle: 'italic',
    marginTop: 1,
  },
  auditColumn: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  metaLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  metaVal: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    marginTop: 1,
  },
  balanceIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
  },
  balanceOk: {
    backgroundColor: '#ECFDF5',
  },
  balanceLow: {
    backgroundColor: '#FEF3C7',
  },
  balanceIndicatorText: {
    fontSize: 11,
    fontWeight: '700',
  },
  confirmedAuditBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 6,
    alignItems: 'flex-end',
  },
  confirmedAuditText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#065F46',
  },
  confirmedDateText: {
    fontSize: 10,
    color: '#15803D',
    marginTop: 1,
  },
  declinedAuditBox: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 6,
  },
  declinedAuditText: {
    fontSize: 10.5,
    color: '#B91C1C',
    fontWeight: '600',
  },
  cardActionsRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  pendingNotice: {
    flex: 1,
    minWidth: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pendingNoticeText: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 15,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0D9488',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  confirmBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  declineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  declineBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#DC2626',
  },
  cenroOversightActionRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    flexWrap: 'wrap',
  },
  cenroOversightBanner: {
    flex: 1,
    minWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  cenroOversightIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cenroOversightTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F766E',
  },
  cenroDeskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  cenroDeskBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#0369A1',
  },
  cenroOversightText: {
    fontSize: 11.5,
    color: '#475569',
    marginTop: 3,
    lineHeight: 16,
  },
  cenroActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cenroCoordinatorRolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0F9FF',
    borderWidth: 1.5,
    borderColor: '#BAE6FD',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
  },
  cenroCoordinatorRoleText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0284C7',
    letterSpacing: 0.2,
  },
  cenroDeclineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cenroDeclineBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E11D48',
  },
  catalogGrid: {
    padding: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  catalogPreviewCard: {
    width: 260,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  catalogImgWrap: {
    width: '100%',
    height: 140,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  catalogImg: {
    width: '100%',
    height: '100%',
  },
  catalogCategoryBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(15,23,42,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  catalogCategoryText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  catalogDetails: {
    padding: 12,
  },
  catalogTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  catalogType: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 16,
  },
  catalogBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  tokenPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDFA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tokenPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
  },
  stockLabel: {
    fontSize: 10.5,
    color: '#64748B',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  modalIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#ECFDF5',
    borderWidth: 1.5,
    borderColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    textAlign: 'center',
  },
  modalCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  modalSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalSummaryLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#64748B',
  },
  modalSummaryVal: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#1E293B',
  },
  modalAlertNotice: {
    fontSize: 11.5,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 18,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  modalExecuteBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#0D9488',
  },
  modalExecuteBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  reasonInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: '#0F172A',
    minHeight: 70,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
});
