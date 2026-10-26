import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
  Alert,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { auth, db } from '../../config/firebase';
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  limit,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { DANAO_CITY_BARANGAYS } from '../../constants/danaoBarangays';

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
  rawUser: any;
}

export interface UserLeaderboardViewProps {
  userRole?: string;
  assignedBarangay?: string;
  canConferAwards?: boolean;
}

const AWARD_PRESETS: Record<'reporter' | 'driver', Array<{ title: string; tokens: number; desc: string }>> = {
  reporter: [
    { title: 'Citizen Vigilance Citation', tokens: 200, desc: 'Timely and accurate geo-tagged reporting of illegal dumping.' },
    { title: 'Clean Barangay Advocate', tokens: 100, desc: 'Continuous active community participation in clean-up drives.' },
    { title: 'Zero Waste Champion', tokens: 250, desc: 'Exemplary household segregation and neighborhood waste stewardship.' },
    { title: 'Other', tokens: 0, desc: 'Custom distinction with user-defined eco-token reward amount.' },
  ],
  driver: [
    { title: 'Route Precision Distinction', tokens: 250, desc: '100% on-time route completion and waypoint adherence.' },
    { title: 'Safe Driving Honor', tokens: 200, desc: 'Zero incident municipal driving and safety compliance.' },
    { title: 'Heavy Volume Mastery Award', tokens: 300, desc: 'Excellence in high-tonnage sector collection operations.' },
    { title: 'Other', tokens: 0, desc: 'Custom distinction with user-defined eco-token reward amount.' },
  ],
};

export default function UserLeaderboardView({
  userRole,
  assignedBarangay,
  canConferAwards = true,
}: UserLeaderboardViewProps) {
  const isCoordinator = userRole === 'coordinator';
  const effectiveBarangay = (assignedBarangay || '').trim();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  // Data States
  const [loading, setLoading] = useState(true);
  const [directoryUsers, setDirectoryUsers] = useState<any[]>([]);
  const [awards, setAwards] = useState<any[]>([]);
  const [redemptions, setRedemptions] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);

  // Filter & Search States
  const [searchFilter, setSearchFilter] = useState('');
  const [leaderboardRoleFilter, setLeaderboardRoleFilter] = useState<'all' | 'citizen' | 'driver'>('all');
  const [leaderboardBarangayFilter, setLeaderboardBarangayFilter] = useState<string>(
    isCoordinator && effectiveBarangay ? effectiveBarangay : 'all'
  );
  const [leaderboardSort, setLeaderboardSort] = useState<'points_desc' | 'points_asc' | 'awards_desc' | 'reports_desc' | 'name_asc'>('points_desc');

  // Inspection Modal State
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [inspectedParticipant, setInspectedParticipant] = useState<LeaderboardUserEntry | null>(null);

  // Quick Confer Award Modal State
  const [conferModalOpen, setConferModalOpen] = useState(false);
  const [awardRole, setAwardRole] = useState<'driver' | 'reporter'>('driver');
  const [awardKind, setAwardKind] = useState('Route Precision Distinction');
  const [awardTokens, setAwardTokens] = useState('250');
  const [citationNote, setCitationNote] = useState('');
  const [customAwardTitle, setCustomAwardTitle] = useState('');
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [customRecipientName, setCustomRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [isConferring, setIsConferring] = useState(false);

  // Firestore Subscriptions
  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), limit(300)),
      (snap) => {
        const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setDirectoryUsers(users);
        setLoading(false);
      },
      (err) => {
        console.warn('Error loading users for leaderboard:', err);
        setLoading(false);
      }
    );

    const unsubAwards = onSnapshot(
      query(collection(db, 'reward_awards'), limit(300)),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setAwards(items);
      },
      (err) => console.warn('Error loading awards for leaderboard:', err)
    );

    const unsubRedemptions = onSnapshot(
      query(collection(db, 'reward_redemptions'), limit(300)),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRedemptions(items);
      },
      (err) => console.warn('Error loading redemptions for leaderboard:', err)
    );

    const unsubReports = onSnapshot(
      query(collection(db, 'reports'), limit(500)),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setReports(items);
      },
      (err) => console.warn('Error loading reports for leaderboard:', err)
    );

    return () => {
      unsubUsers();
      unsubAwards();
      unsubRedemptions();
      unsubReports();
    };
  }, []);

  // Processed Leaderboard Data
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

      // Correlate citizen reports and cleanup points
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

      // Stored profile balance
      const stored = Math.max(
        Number(u.points || 0),
        Number(u.rewardTokens || 0),
        Number(u.tokens || 0),
        Number(u.ecoPoints || 0)
      );

      // Total spendable balance
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

  // Filtered & Sorted Leaderboard
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
        return a.name.localeCompare(b.name);
      }
      if (leaderboardSort === 'points_asc') {
        if (a.points !== b.points) return a.points - b.points;
        return a.name.localeCompare(b.name);
      }
      if (leaderboardSort === 'awards_desc') {
        if (b.awardsCount !== a.awardsCount) return b.awardsCount - a.awardsCount;
        return b.points - a.points;
      }
      if (leaderboardSort === 'reports_desc') {
        if (b.resolvedReportsCount !== a.resolvedReportsCount) return b.resolvedReportsCount - a.resolvedReportsCount;
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

  // Candidate Users for Confer Modal
  const candidateUsers = useMemo(() => {
    return directoryUsers.filter((u) => {
      const r = (u.role || 'user').toLowerCase();
      const desig = (u.designation || '').toLowerCase();
      if (awardRole === 'driver') {
        return r === 'driver';
      }
      return r === 'user' || r === 'resident' || (!r && !desig.includes('admin'));
    });
  }, [directoryUsers, awardRole]);

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

  const handleSelectRole = (role: 'driver' | 'reporter') => {
    setAwardRole(role);
    setSelectedUser(null);
    setCustomRecipientName('');
    setRecipientEmail('');
    setRecipientSearch('');
    setCustomAwardTitle('');
    const defaultPreset = AWARD_PRESETS[role][0];
    setAwardKind(defaultPreset.title);
    setAwardTokens(String(defaultPreset.tokens));
  };

  const handleSelectCandidate = (u: any) => {
    setSelectedUser(u);
    setCustomRecipientName(u.displayName || u.name || u.email || 'User');
    setRecipientEmail(u.email || '');
    setRecipientSearch('');
    setIsUserDropdownOpen(false);
  };

  const handleQuickConferFromLeaderboard = (entry: LeaderboardUserEntry) => {
    setAwardRole(entry.role === 'driver' ? 'driver' : 'reporter');
    setSelectedUser(entry.rawUser);
    setCustomRecipientName(entry.name);
    setRecipientEmail(entry.email);
    setRecipientSearch('');
    setIsUserDropdownOpen(false);
    setCustomAwardTitle('');

    const defaultPreset = entry.role === 'driver' ? AWARD_PRESETS.driver[0] : AWARD_PRESETS.reporter[0];
    setAwardKind(defaultPreset.title);
    setAwardTokens(String(defaultPreset.tokens));
    setConferModalOpen(true);
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
        conferredBy: auth.currentUser?.email || 'CENRO & CICTO Governance',
        conferredByUid: auth.currentUser?.uid || '',
        awardedAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'reward_awards'), awardPayload);

      if (targetUserId) {
        const userRef = doc(db, 'users', targetUserId);
        await updateDoc(userRef, {
          points: increment(tokensNum),
          rewardTokens: increment(tokensNum),
          updatedAt: serverTimestamp(),
        }).catch((uErr) => console.warn('User points increment notice:', uErr));

        const awardMsg = `You received "${resolvedAwardKind}" (+${tokensNum} pts) from Danao City Waste Operations Oversight.`;
        await addDoc(collection(db, 'userNotifications'), {
          userId: targetUserId,
          title: '⭐ Official Distinction Awarded!',
          body: awardMsg,
          message: awardMsg,
          type: 'reward_award',
          createdAt: serverTimestamp(),
          read: false,
        }).catch(() => {});
      }

      setConferModalOpen(false);
      setSelectedUser(null);
      setCustomRecipientName('');
      setRecipientEmail('');
      setRecipientSearch('');
      setCitationNote('');
      setCustomAwardTitle('');
      Alert.alert('Success', `Distinction Citation and +${tokensNum} eco-tokens successfully recorded in municipal ledger.`);
    } catch (err: any) {
      console.error('Error conferring award:', err);
      Alert.alert('Error', err.message || 'Failed to record distinction award.');
    } finally {
      setIsConferring(false);
    }
  };

  const handleExportCsv = () => {
    const filename = `danao_eco_points_leaderboard_${new Date().toISOString().split('T')[0]}.csv`;
    const headers = isCoordinator
      ? ['"Rank"', '"Participant Name"', '"Role"', '"Email"', '"Reports Resolved"', '"Distinction Awards"', '"Redemptions Claimed"', '"Total Eco-Points"']
      : ['"Rank"', '"Participant Name"', '"Role"', '"Barangay"', '"Email"', '"Reports Resolved"', '"Distinction Awards"', '"Redemptions Claimed"', '"Total Eco-Points"'];
    const rows = filteredLeaderboard.map((u, idx) => isCoordinator ? [
      `"${idx + 1}"`,
      `"${u.name.replace(/"/g, '""')}"`,
      `"${u.roleLabel}"`,
      `"${u.email}"`,
      `"${u.resolvedReportsCount}"`,
      `"${u.awardsCount}"`,
      `"${u.redemptionsCount}"`,
      `"${u.points}"`,
    ] : [
      `"${idx + 1}"`,
      `"${u.name.replace(/"/g, '""')}"`,
      `"${u.roleLabel}"`,
      `"${u.barangay}"`,
      `"${u.email}"`,
      `"${u.resolvedReportsCount}"`,
      `"${u.awardsCount}"`,
      `"${u.redemptionsCount}"`,
      `"${u.points}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else {
      Alert.alert('CSV Exported', `Generated file ${filename}`);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        nestedScrollEnabled={true}
      >
        {/* Search & Filter Controls Bar */}
        <View style={styles.controlsCard}>
        {/* Role Filters & Barangay Sector Filter */}
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

          {!isCoordinator && (
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
                  {DANAO_CITY_BARANGAYS.map((b) => (
                    <Picker.Item key={b} label={`Brgy. ${b}`} value={b} />
                  ))}
                </Picker>
              </View>
            </View>
          )}
        </View>

        {/* Search, Sort & Export Actions */}
        <View style={[styles.leaderboardFilterRow, { marginTop: 10 }]}>
          <View style={styles.searchBox}>
            <MaterialIcons name="search" size={18} color="#64748B" />
            <TextInput
              style={styles.searchInput}
              placeholder={isCoordinator ? "Search by name, email, or employee ID..." : "Search by name, email, employee ID, or barangay..."}
              placeholderTextColor="#94A3B8"
              value={searchFilter}
              onChangeText={setSearchFilter}
            />
            {searchFilter ? (
              <TouchableOpacity onPress={() => setSearchFilter('')}>
                <MaterialIcons name="close" size={16} color="#64748B" />
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="sort" size={16} color="#64748B" />
              <Text style={styles.catalogSortLabel}>Sort by:</Text>
              <View style={styles.sortPickerWrap}>
                <Picker
                  selectedValue={leaderboardSort}
                  onValueChange={(val) => setLeaderboardSort(val as any)}
                  style={styles.sortPicker}
                >
                  <Picker.Item label="💎 Highest Points (Default)" value="points_desc" />
                  <Picker.Item label="📉 Lowest Points First" value="points_asc" />
                  <Picker.Item label="🧹 Most Reports Resolved" value="reports_desc" />
                  <Picker.Item label="🎖️ Most Awards Conferred" value="awards_desc" />
                  <Picker.Item label="🔤 Name (A - Z)" value="name_asc" />
                </Picker>
              </View>
            </View>

            <TouchableOpacity style={styles.exportBtn} onPress={handleExportCsv} activeOpacity={0.8}>
              <MaterialIcons name="file-download" size={15} color="#475569" />
              <Text style={styles.exportBtnText}>Export CSV</Text>
            </TouchableOpacity>

            <View style={styles.leaderboardStatSummary}>
              <MaterialIcons name="groups" size={14} color="#0D9488" />
              <Text style={styles.leaderboardStatSummaryText}>
                {filteredLeaderboard.length} Ranked Users · {totalCommunityPoints.toLocaleString()} Total pts
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Top 3 Podium Showcase */}
      {filteredLeaderboard.length >= 2 && !searchFilter && leaderboardRoleFilter === 'all' && leaderboardBarangayFilter === 'all' && (
        <View style={styles.podiumContainer}>
          {/* 2nd Place Silver */}
          {filteredLeaderboard[1] && (
            <TouchableOpacity
              style={[styles.podiumCard, styles.podiumCardSilver]}
              onPress={() => {
                setInspectedParticipant(filteredLeaderboard[1]);
                setDetailModalOpen(true);
              }}
              activeOpacity={0.85}
            >
              <View style={styles.podiumAvatarWrap}>
                <View style={[styles.podiumAvatar, { borderColor: '#94A3B8' }]}>
                  <Text style={[styles.podiumAvatarText, { color: '#475569' }]}>
                    {filteredLeaderboard[1].name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={[styles.podiumRankCircle, { backgroundColor: '#94A3B8' }]}>
                  <Text style={styles.podiumRankText}>2</Text>
                </View>
              </View>
              <Text style={styles.podiumName} numberOfLines={1}>{filteredLeaderboard[1].name}</Text>
              <Text style={styles.podiumBarangay} numberOfLines={1}>Brgy. {filteredLeaderboard[1].barangay}</Text>
              <View style={[styles.podiumPointsBadge, { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' }]}>
                <MaterialIcons name="stars" size={13} color="#64748B" />
                <Text style={[styles.podiumPointsText, { color: '#334155' }]}>{filteredLeaderboard[1].points.toLocaleString()} pts</Text>
              </View>
              <View style={[styles.podiumPillar, styles.podiumPillarSilver]}>
                <MaterialIcons name="military-tech" size={24} color="#94A3B8" />
                <Text style={[styles.podiumPillarText, { color: '#475569' }]}>2nd Place · Tap for Details</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* 1st Place Gold Champion */}
          {filteredLeaderboard[0] && (
            <TouchableOpacity
              style={[styles.podiumCard, styles.podiumCardGold]}
              onPress={() => {
                setInspectedParticipant(filteredLeaderboard[0]);
                setDetailModalOpen(true);
              }}
              activeOpacity={0.85}
            >
              <MaterialIcons name="emoji-events" size={28} color="#D97706" style={{ marginBottom: 4 }} />
              <View style={styles.podiumAvatarWrap}>
                <View style={[styles.podiumAvatar, { borderColor: '#F59E0B' }]}>
                  <Text style={[styles.podiumAvatarText, { color: '#B45309' }]}>
                    {filteredLeaderboard[0].name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={[styles.podiumRankCircle, { backgroundColor: '#F59E0B' }]}>
                  <Text style={styles.podiumRankText}>1</Text>
                </View>
              </View>
              <Text style={[styles.podiumName, { fontSize: 15, fontWeight: '900' }]} numberOfLines={1}>{filteredLeaderboard[0].name}</Text>
              <Text style={styles.podiumBarangay} numberOfLines={1}>Brgy. {filteredLeaderboard[0].barangay}</Text>
              <View style={[styles.podiumPointsBadge, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                <MaterialIcons name="stars" size={14} color="#D97706" />
                <Text style={[styles.podiumPointsText, { color: '#B45309', fontWeight: '900' }]}>{filteredLeaderboard[0].points.toLocaleString()} pts</Text>
              </View>
              <View style={[styles.podiumPillar, styles.podiumPillarGold]}>
                <MaterialIcons name="military-tech" size={28} color="#D97706" />
                <Text style={[styles.podiumPillarText, { color: '#B45309', fontWeight: '800' }]}>Champion · Tap for Details</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* 3rd Place Bronze */}
          {filteredLeaderboard[2] && (
            <TouchableOpacity
              style={[styles.podiumCard, styles.podiumCardBronze]}
              onPress={() => {
                setInspectedParticipant(filteredLeaderboard[2]);
                setDetailModalOpen(true);
              }}
              activeOpacity={0.85}
            >
              <View style={styles.podiumAvatarWrap}>
                <View style={[styles.podiumAvatar, { borderColor: '#D97706' }]}>
                  <Text style={[styles.podiumAvatarText, { color: '#92400E' }]}>
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

      {/* Leaderboard Table */}
      <ScrollView
        horizontal={true}
        showsHorizontalScrollIndicator={true}
        nestedScrollEnabled={true}
        style={{ width: '100%' }}
        contentContainerStyle={{ width: '100%', minWidth: isCoordinator ? 850 : 960, flexGrow: 1 }}
      >
        <View style={styles.leaderboardTable}>
          {/* Table Header */}
          <View style={styles.leaderboardTableHeader}>
            <Text style={[styles.leaderboardColHeader, { width: 50, textAlign: 'center' }]}>RANK</Text>
            <Text style={[styles.leaderboardColHeader, { flex: 2.5, minWidth: 180 }]}>MUNICIPAL PARTICIPANT</Text>
            <Text style={[styles.leaderboardColHeader, { flex: 1.2, minWidth: 110 }]}>ROLE / SECTOR</Text>
            {!isCoordinator && (
              <Text style={[styles.leaderboardColHeader, { flex: 1.2, minWidth: 110 }]}>BARANGAY</Text>
            )}
            <Text style={[styles.leaderboardColHeader, { flex: 1.0, minWidth: 85, textAlign: 'center' }]}>REPORTS</Text>
            <Text style={[styles.leaderboardColHeader, { flex: 0.9, minWidth: 80, textAlign: 'center' }]}>AWARDS</Text>
            <Text style={[styles.leaderboardColHeader, { flex: 1.0, minWidth: 85, textAlign: 'center' }]}>REDEMPTIONS</Text>
            <Text style={[styles.leaderboardColHeader, { flex: 1.1, minWidth: 105, textAlign: 'center' }]}>ECO-POINTS</Text>
            <Text style={[styles.leaderboardColHeader, { flex: 1.4, minWidth: 140, textAlign: 'center' }]}>ACTIONS</Text>
          </View>

          {/* Table Rows */}
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#0D9488" />
              <Text style={styles.loadingText}>Synchronizing municipal points...</Text>
            </View>
          ) : filteredLeaderboard.length === 0 ? (
            <View style={styles.emptyCard}>
              <MaterialIcons name="leaderboard" size={42} color="#CBD5E1" />
              <Text style={styles.emptyTitle}>No participants found</Text>
              <Text style={styles.emptySubtitle}>{isCoordinator ? 'Try adjusting your search query or role filter.' : 'Try adjusting your search query, role filter, or barangay sector.'}</Text>
            </View>
          ) : (
            filteredLeaderboard.map((u, idx) => {
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
                  {!isCoordinator && (
                    <View style={{ flex: 1.2, minWidth: 110, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <MaterialIcons name="place" size={13} color="#64748B" />
                      <Text style={styles.leaderboardBarangayText} numberOfLines={1}>
                        Brgy. {u.barangay}
                      </Text>
                    </View>
                  )}

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

                    {canConferAwards && (
                      <TouchableOpacity
                        style={styles.quickConferBtn}
                        onPress={() => handleQuickConferFromLeaderboard(u)}
                        activeOpacity={0.8}
                        accessibilityLabel={`Confer award to ${u.name}`}
                      >
                        <MaterialIcons name="emoji-events" size={13} color="#0D9488" />
                        <Text style={styles.quickConferBtnText}>Award</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
    </ScrollView>

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
                        #{filteredLeaderboard.findIndex((p) => p.id === inspectedParticipant.id) + 1}
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
                                <MaterialIcons name={isResolved ? 'check-circle' : 'pending'} size={18} color={isResolved ? '#059669' : '#D97706'} />
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
                      {canConferAwards && (
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
                      )}
                    </View>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {inspectedParticipant.userAwards.map((a: any, aIdx: number) => {
                        const dateStr = a.awardedAt?.toDate ? a.awardedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
                        return (
                          <View key={a.id || aIdx} style={styles.detailAwardRow}>
                            <View style={styles.detailAwardIconWrap}>
                              <MaterialIcons name="emoji-events" size={20} color="#0D9488" />
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <Text style={styles.detailAwardTitle}>{a.awardKind || 'Distinction Award'}</Text>
                                <View style={styles.fyBadge}>
                                  <Text style={styles.fyBadgeText}>FY {a.fiscalYear || '2026'}</Text>
                                </View>
                              </View>
                              <Text style={styles.detailAwardReason}>{a.reason || 'Official Stewardship Distinction'}</Text>
                              <Text style={styles.detailAwardMeta}>Awarded {dateStr} by {a.conferredBy || 'CENRO & CICTO'}</Text>
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

                {canConferAwards && (
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
                )}
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Quick Confer Distinction Modal */}
      {conferModalOpen && (
        <Modal
          visible={conferModalOpen}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setConferModalOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.conferModalBox, isMobile && { width: '96%', maxHeight: '92%' }]}>
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={styles.modalHeaderIconBadge}>
                    <MaterialIcons name="emoji-events" size={22} color="#0D9488" />
                  </View>
                  <View>
                    <Text style={styles.modalTitle}>Confer Official Distinction</Text>
                    <Text style={styles.modalHeaderSub}>Grant verified commendations and eco-token rewards</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setConferModalOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="close" size={22} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={true}>
                {/* Role Picker */}
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
                            color={active ? '#FFFFFF' : '#64748B'}
                          />
                          <Text style={[styles.rolePickerBtnText, active && styles.rolePickerBtnTextActive]}>
                            {r === 'driver' ? 'Collection Driver' : 'Resident Reporter'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Recipient Input */}
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.inputLabel}>SELECT RECIPIENT *</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Search candidate name, email, or employee ID..."
                    placeholderTextColor="#94A3B8"
                    value={customRecipientName || recipientSearch}
                    onChangeText={(txt) => {
                      setCustomRecipientName(txt);
                      setRecipientSearch(txt);
                      setSelectedUser(null);
                      setIsUserDropdownOpen(true);
                    }}
                    onFocus={() => setIsUserDropdownOpen(true)}
                  />

                  {isUserDropdownOpen && filteredCandidates.length > 0 && (
                    <View style={styles.userDropdownList}>
                      {filteredCandidates.map((u) => (
                        <TouchableOpacity
                          key={u.id}
                          style={styles.userDropdownItem}
                          onPress={() => handleSelectCandidate(u)}
                        >
                          <MaterialIcons name={awardRole === 'driver' ? 'badge' : 'person'} size={16} color="#0D9488" />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.userDropdownItemName}>{u.displayName || u.name || 'Verified User'}</Text>
                            <Text style={styles.userDropdownItemSub}>{u.email || (u.employeeId ? `ID: ${u.employeeId}` : 'Resident')}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {/* Distinction Award Type / Presets */}
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.inputLabel}>DISTINCTION CITATION PRESET *</Text>
                  <View style={{ gap: 8, marginTop: 4 }}>
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
                            <Text style={[styles.presetTitle, isSelected && styles.presetTitleActive]}>{p.title}</Text>
                            <Text style={styles.presetDesc}>{p.desc}</Text>
                          </View>
                          <View style={[styles.presetBadge, isSelected && styles.presetBadgeActive]}>
                            <Text style={[styles.presetBadgeText, isSelected && styles.presetBadgeTextActive]}>
                              {isOtherPreset ? 'Custom' : `+${p.tokens} pts`}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {awardKind === 'Other' && (
                  <View style={{ marginBottom: 14 }}>
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

                {/* Token Amount Input */}
                <View style={{ marginBottom: 14 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={styles.inputLabel}>
                      {awardKind === 'Other' ? 'ECO-TOKENS TO CONFER (EDITABLE) *' : 'ECO-TOKENS TO CONFER (FIXED) *'}
                    </Text>
                    {awardKind !== 'Other' && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <MaterialIcons name="lock" size={12} color="#94A3B8" />
                        <Text style={{ fontSize: 11, color: '#94A3B8', fontWeight: '600' }}>Locked to preset</Text>
                      </View>
                    )}
                  </View>
                  <TextInput
                    style={[
                      styles.modalInput,
                      awardKind !== 'Other' && { backgroundColor: '#F8FAFC', color: '#64748B', borderColor: '#E2E8F0' }
                    ]}
                    keyboardType="number-pad"
                    editable={awardKind === 'Other'}
                    value={awardTokens}
                    onChangeText={setAwardTokens}
                    placeholder={awardKind === 'Other' ? "Enter token amount (e.g. 150)" : "Tokens"}
                    placeholderTextColor="#94A3B8"
                  />
                </View>

                {/* Citation Note */}
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.inputLabel}>OFFICIAL CITATION NOTE (OPTIONAL)</Text>
                  <TextInput
                    style={[styles.modalInput, { minHeight: 60, textAlignVertical: 'top' }]}
                    multiline
                    value={citationNote}
                    onChangeText={setCitationNote}
                    placeholder="Add specific commendation remarks for official municipal audit..."
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setConferModalOpen(false)}
                  disabled={isConferring}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveBtn, isConferring && { opacity: 0.7 }]}
                  onPress={handleConferAward}
                  disabled={isConferring}
                >
                  {isConferring ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="emoji-events" size={16} color="#FFFFFF" />
                      <Text style={styles.saveBtnText}>Confer Distinction</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  scrollContainer: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 60,
  },
  controlsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  leaderboardFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  leaderboardRolesScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  catalogFilterHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginRight: 4,
  },
  catalogCategoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  catalogCategoryChipActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  catalogCategoryChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  catalogCategoryChipTextActive: {
    color: '#FFFFFF',
  },
  barangayPickerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  catalogSortLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  sortPickerWrap: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sortPicker: {
    height: 36,
    width: 170,
    fontSize: 12,
    color: '#0F172A',
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  searchBox: {
    flex: 1,
    minWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 36,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    color: '#0F172A',
    paddingVertical: 0,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  exportBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  leaderboardStatSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  leaderboardStatSummaryText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#0D9488',
  },
  podiumContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 14,
    marginVertical: 12,
    paddingHorizontal: 10,
    flexWrap: 'wrap',
  },
  podiumCard: {
    width: 210,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingTop: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  podiumCardGold: {
    borderColor: '#FDE68A',
    backgroundColor: '#FFFDF5',
  },
  podiumCardSilver: {
    borderColor: '#E2E8F0',
  },
  podiumCardBronze: {
    borderColor: '#FED7AA',
    backgroundColor: '#FFFBF5',
  },
  podiumAvatarWrap: {
    position: 'relative',
    marginBottom: 6,
  },
  podiumAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  podiumAvatarText: {
    fontSize: 18,
    fontWeight: '800',
  },
  podiumRankCircle: {
    position: 'absolute',
    bottom: -2,
    right: -2,
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
    fontSize: 11,
    fontWeight: '900',
  },
  podiumName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  podiumBarangay: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  podiumPointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
    marginBottom: 12,
  },
  podiumPointsText: {
    fontSize: 12,
    fontWeight: '800',
  },
  podiumPillar: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  podiumPillarGold: {
    backgroundColor: '#FEF3C7',
    minHeight: 88,
  },
  podiumPillarSilver: {
    backgroundColor: '#F1F5F9',
    minHeight: 70,
  },
  podiumPillarBronze: {
    backgroundColor: '#FFEDD5',
    minHeight: 56,
  },
  podiumPillarText: {
    fontSize: 11,
    fontWeight: '700',
  },
  leaderboardTable: {
    width: '100%',
    minWidth: 960,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  leaderboardTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#F8FAFC',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  leaderboardColHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  leaderboardRowTop1: {
    backgroundColor: '#FFFEFA',
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
    color: '#475569',
  },
  userAvatarInitials: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
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
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  leaderboardRoleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  leaderboardBarangayText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  awardsConferredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  awardsConferredBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0D9488',
  },
  noAwardsText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  leaderboardPointsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  leaderboardPointsText: {
    fontSize: 12,
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
  loadingBox: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  emptyCard: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 320,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 16,
  },
  modalHeaderIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalHeaderSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    marginTop: 16,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#0D9488',
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // Detail Modal Specific
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
    minWidth: 120,
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
    borderStyle: 'dashed',
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
  fyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: '#F1F5F9',
  },
  fyBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
  },

  // Confer Modal Specific
  conferModalBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: 540,
    maxWidth: '96%',
    maxHeight: '90%',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.4,
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
    backgroundColor: '#F8FAFC',
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
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0F172A',
  },
  userDropdownList: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 180,
    overflow: 'hidden',
  },
  userDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  userDropdownItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  userDropdownItemSub: {
    fontSize: 11,
    color: '#64748B',
  },
  presetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  presetCardActive: {
    backgroundColor: '#F0FDFA',
    borderColor: '#0D9488',
  },
  presetTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  presetTitleActive: {
    color: '#0D9488',
    fontWeight: '800',
  },
  presetDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  presetBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
  },
  presetBadgeActive: {
    backgroundColor: '#0D9488',
  },
  presetBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  presetBadgeTextActive: {
    color: '#FFFFFF',
  },
});

