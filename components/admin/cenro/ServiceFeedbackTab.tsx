import React, { useState, useEffect, useMemo } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  Modal,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { collection, doc, getDoc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { DANAO_CITY_BARANGAYS } from '../../../constants/danaoBarangays';
import ExportModal from './ExportModal';
import { exportReport, ExportFormat } from '@/services/reportExportService';

interface Feedback {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  userRole: 'resident' | 'driver' | string;
  barangay: string;
  photoURL?: string;
  rating: string;
  title: string;
  message: string;
  createdAt: any;
  street?: string;
}

interface ServiceFeedbackTabProps {
  userRole?: string;
  assignedBarangay?: string;
  isReadOnly?: boolean;
}

export default function ServiceFeedbackTab({
  userRole = 'admin',
  assignedBarangay = '',
  isReadOnly = false,
}: ServiceFeedbackTabProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const isCoordinator = userRole === 'coordinator';
  const effectiveCoordinatorBarangay = (assignedBarangay || '').trim();

  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'loved it' | 'good' | 'bad' | 'terrible'>('all');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<'all' | 'resident' | 'driver'>('all');

  // Barangay filter: If coordinator, strictly locked to their assigned barangay
  const [selectedBarangayFilter, setSelectedBarangayFilter] = useState<string>(
    isCoordinator && effectiveCoordinatorBarangay ? effectiveCoordinatorBarangay : 'all'
  );
  const [isBarangayModalVisible, setIsBarangayModalVisible] = useState(false);
  const [barangaySearchQuery, setBarangaySearchQuery] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const itemsPerPage = 10;

  const normalizeBrgy = (str?: string) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/^brgy\.?\s*/i, '')
      .replace(/^barangay\s*/i, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  };

  // Sync coordinator assigned barangay
  useEffect(() => {
    if (isCoordinator && effectiveCoordinatorBarangay) {
      setSelectedBarangayFilter(effectiveCoordinatorBarangay);
    }
  }, [isCoordinator, effectiveCoordinatorBarangay]);

  useEffect(() => {
    if (!db) return;

    const feedbacksRef = collection(db, 'feedback');
    const q = query(feedbacksRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const feedbacksData: Feedback[] = [];
      const userCache = new Map<string, any>();

      for (const docSnapshot of snapshot.docs) {
        const data = docSnapshot.data();
        let userName = 'User';
        let userEmail = data.userEmail || '';
        let photoURL: string | undefined = undefined;
        let role = (data.userRole || data.role || '').toLowerCase();
        let brgy = (data.barangay || '').trim();

        // Resolve user info from users collection
        try {
          let userData: any = null;
          if (data.userId) {
            if (!userCache.has(data.userId)) {
              const userDoc = await getDoc(doc(db, 'users', data.userId));
              if (userDoc.exists()) userCache.set(data.userId, userDoc.data());
            }
            userData = userCache.get(data.userId);
          }

          // Fallback search in userCache by userEmail if userId did not resolve
          if (!userData && userEmail) {
            for (const cached of userCache.values()) {
              if (cached?.email && cached.email.toLowerCase() === userEmail.toLowerCase()) {
                userData = cached;
                break;
              }
            }
          }

          if (userData) {
            userName =
              data.userName ||
              userData.displayName ||
              userData.name ||
              userData.fullName ||
              userData.email?.split('@')[0] ||
              'User';
            userEmail = userData.email || userEmail;
            photoURL = userData.photoURL || undefined;

            // Live user account role takes priority (e.g. resident upgraded to driver)
            const uRole = (userData.role || '').toLowerCase();
            if (uRole === 'driver') {
              role = 'driver';
            } else if (uRole === 'user' || uRole === 'resident') {
              role = role === 'driver' ? 'driver' : 'resident';
            } else {
              role = role === 'driver' ? 'driver' : 'resident';
            }

            if (!brgy) {
              brgy = (userData.assignedBarangay || userData.barangay || '').trim();
            }
          } else {
            userName = data.userName || userEmail?.split('@')[0] || 'User';
            if (role !== 'driver') {
              role = 'resident';
            }
          }
        } catch {
          userName = data.userName || userEmail?.split('@')[0] || 'User';
          if (role !== 'driver') {
            role = 'resident';
          }
        }

        // Standardize role to 'driver' or 'resident'
        if (role !== 'driver') {
          role = 'resident';
        }

        // Self-heal / sync feedback record in Firestore if role changed (e.g. resident upgraded to driver)
        if (data.userRole !== role) {
          updateDoc(doc(db, 'feedback', docSnapshot.id), {
            userRole: role,
            userName,
          }).catch(() => undefined);
        }

        // Fallback for barangay from street if applicable
        if (!brgy && data.street && data.street !== 'unknown') {
          const matchBrgy = DANAO_CITY_BARANGAYS.find(
            (b) => normalizeBrgy(b) === normalizeBrgy(data.street)
          );
          if (matchBrgy) {
            brgy = matchBrgy;
          } else {
            brgy = data.street;
          }
        }

        feedbacksData.push({
          id: docSnapshot.id,
          userId: data.userId || '',
          userEmail,
          userName,
          userRole: role,
          barangay: brgy,
          photoURL,
          rating: data.rating || 'Good',
          title: data.title || '',
          message: data.description || data.message || '',
          createdAt: data.createdAt,
          street: data.street || '',
        });
      }

      setFeedbacks(feedbacksData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Compute counts per barangay across all feedbacks (for CENRO filter modal)
  const barangayFeedbackCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    feedbacks.forEach((f) => {
      const b = f.barangay;
      if (b) {
        counts[b] = (counts[b] || 0) + 1;
      }
    });
    return counts;
  }, [feedbacks]);

  // 1. Scope feedback by Barangay first (strict isolation for coordinators)
  const barangayScopedFeedbacks = useMemo(() => {
    // If Coordinator: strictly lock to their barangay
    if (isCoordinator && effectiveCoordinatorBarangay) {
      const normCoord = normalizeBrgy(effectiveCoordinatorBarangay);
      return feedbacks.filter((f) => normalizeBrgy(f.barangay) === normCoord);
    }

    // If CENRO Admin: apply barangay filter
    if (selectedBarangayFilter === 'all') {
      return feedbacks;
    }
    if (selectedBarangayFilter === 'unassigned') {
      return feedbacks.filter((f) => !f.barangay);
    }
    const normFilter = normalizeBrgy(selectedBarangayFilter);
    return feedbacks.filter((f) => normalizeBrgy(f.barangay) === normFilter);
  }, [feedbacks, isCoordinator, effectiveCoordinatorBarangay, selectedBarangayFilter]);

  // Stats computed on the barangay-scoped feedbacks
  const totalCount = barangayScopedFeedbacks.length;
  const lovedCount = barangayScopedFeedbacks.filter((f) => f.rating.toLowerCase() === 'loved it').length;
  const goodCount = barangayScopedFeedbacks.filter((f) => f.rating.toLowerCase() === 'good').length;
  const badCount = barangayScopedFeedbacks.filter((f) => f.rating.toLowerCase() === 'bad').length;
  const terribleCount = barangayScopedFeedbacks.filter((f) => f.rating.toLowerCase() === 'terrible').length;
  const positiveRate = totalCount > 0 ? Math.round(((lovedCount + goodCount) / totalCount) * 100) : 0;

  const residentCount = barangayScopedFeedbacks.filter((f) => f.userRole !== 'driver').length;
  const driverCount = barangayScopedFeedbacks.filter((f) => f.userRole === 'driver').length;

  const getRatingEmoji = (rating: string) => {
    switch (rating.toLowerCase()) {
      case 'loved it':
        return '😍';
      case 'good':
        return '😊';
      case 'bad':
        return '😕';
      case 'terrible':
        return '😣';
      default:
        return '😐';
    }
  };

  const getRatingColor = (rating: string) => {
    switch (rating.toLowerCase()) {
      case 'loved it':
        return { text: '#059669', bg: '#ECFDF5' };
      case 'good':
        return { text: '#2563EB', bg: '#EFF6FF' };
      case 'bad':
        return { text: '#D97706', bg: '#FFFBEB' };
      case 'terrible':
        return { text: '#DC2626', bg: '#FEF2F2' };
      default:
        return { text: '#6B7280', bg: '#F3F4F6' };
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'Unknown';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'Unknown';
    }
  };

  const formatDateFull = (timestamp: any) => {
    if (!timestamp) return 'Unknown';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Unknown';
    }
  };

  // 2. Further filter by search, rating filter, and sender role filter
  const filtered = useMemo(() => {
    return barangayScopedFeedbacks.filter((f) => {
      const matchesSearch =
        searchText === '' ||
        f.userName.toLowerCase().includes(searchText.toLowerCase()) ||
        f.message.toLowerCase().includes(searchText.toLowerCase()) ||
        f.userEmail.toLowerCase().includes(searchText.toLowerCase()) ||
        f.barangay.toLowerCase().includes(searchText.toLowerCase());

      const matchesRating = selectedFilter === 'all' || f.rating.toLowerCase() === selectedFilter;

      const matchesRole =
        selectedRoleFilter === 'all' ||
        (selectedRoleFilter === 'driver' ? f.userRole === 'driver' : f.userRole !== 'driver');

      return matchesSearch && matchesRating && matchesRole;
    });
  }, [barangayScopedFeedbacks, searchText, selectedFilter, selectedRoleFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const paginatedFeedbacks = filtered.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const [isExportModalVisible, setIsExportModalVisible] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    const headers = [
      'Citizen / Driver',
      'Role',
      'Barangay',
      'Email Address',
      'Star Rating',
      'Feedback Message',
      'Street / Location',
      'Date Submitted',
    ];

    const rows = filtered.map((item) => [
      item.userName || 'Anonymous',
      item.userRole === 'driver' ? 'Driver' : 'Resident',
      item.barangay || 'Danao City',
      item.userEmail || 'N/A',
      `${item.rating} / 5 Stars`,
      item.message || '',
      item.street || 'N/A',
      formatDateFull(item.createdAt),
    ]);

    const jurisdictionScope =
      isCoordinator && effectiveCoordinatorBarangay
        ? `Brgy. ${effectiveCoordinatorBarangay}`
        : selectedBarangayFilter !== 'all'
        ? `Brgy. ${selectedBarangayFilter}`
        : 'City of Danao (All Barangays)';

    await exportReport({
      format,
      filename: `trashtrack-service-feedback-${new Date().toISOString().slice(0, 10)}`,
      title: 'Citizen Service & Route Feedback Report',
      subtitle: 'City Environment & Natural Resources Office Public Satisfaction Ratings',
      jurisdiction: jurisdictionScope,
      generatedBy: isCoordinator ? 'Barangay Coordinator' : 'CENRO Public Relations',
      headers,
      rows,
      summaryCards: [
        { label: 'Total Feedback', value: filtered.length },
        { label: 'Positive (Loved/Good)', value: filtered.filter((f) => ['loved it', 'good'].includes((f.rating || '').toLowerCase())).length },
        { label: 'Critical (Bad/Terrible)', value: filtered.filter((f) => ['bad', 'terrible'].includes((f.rating || '').toLowerCase())).length },
      ],
      sheetName: 'Feedback_Records',
    });
  };

  const getRatingBarWidth = (rating: string) => {
    if (totalCount === 0) return 0;
    const count = barangayScopedFeedbacks.filter(
      (f) => f.rating.toLowerCase() === rating.toLowerCase()
    ).length;
    return Math.round((count / totalCount) * 100);
  };

  const filteredBarangayList = DANAO_CITY_BARANGAYS.filter((b) =>
    b.toLowerCase().includes(barangaySearchQuery.trim().toLowerCase())
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Loading feedback...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, isMobile && { padding: 16 }]}>
      {/* Header */}
      <View style={[styles.headerRow, isMobile && { flexDirection: 'column', gap: 12 }]}>
        <View>
          <Text style={styles.headerTitle}>
            {isCoordinator && effectiveCoordinatorBarangay
              ? `Service Feedback • Brgy. ${effectiveCoordinatorBarangay}`
              : 'Service Feedback'}
          </Text>
          <Text style={styles.headerDesc}>
            {isCoordinator && effectiveCoordinatorBarangay
              ? `Monitor resident and driver satisfaction ratings for Brgy. ${effectiveCoordinatorBarangay}.`
              : 'Monitor resident and municipal driver satisfaction and service quality ratings.'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.outlineBtn}
            onPress={() => setIsExportModalVisible(true)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="file-download" size={18} color="#059669" />
            <Text style={[styles.outlineBtnText, { color: '#065F46' }]}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Coordinator Locked Banner */}
      {Boolean(isCoordinator && effectiveCoordinatorBarangay) && (
        <View style={styles.coordinatorLockedBanner}>
          <MaterialIcons name="verified-user" size={20} color="#065F46" />
          <View style={{ flex: 1 }}>
            <Text style={styles.coordinatorLockedTitle}>
              Barangay Coordinator Jurisdiction: Brgy. {effectiveCoordinatorBarangay}
            </Text>
            <Text style={styles.coordinatorLockedSubtitle}>
              You are strictly restricted to feedback submissions from your assigned barangay.
            </Text>
          </View>
        </View>
      )}

      {/* CENRO Barangay Filter Card */}
      {!isCoordinator && (
        <View style={styles.barangayFilterCard}>
          <View style={styles.barangayFilterLeft}>
            <MaterialIcons name="filter-list" size={18} color="#059669" />
            <Text style={styles.barangayFilterTitle}>FILTER FEEDBACK BY BARANGAY</Text>
          </View>
          <TouchableOpacity
            style={styles.barangayFilterBtn}
            onPress={() => {
              setBarangaySearchQuery('');
              setIsBarangayModalVisible(true);
            }}
          >
            <MaterialIcons name="place" size={16} color="#059669" />
            <Text style={styles.barangayFilterBtnText}>
              {selectedBarangayFilter === 'all'
                ? 'All Barangays (Browse 42)'
                : selectedBarangayFilter === 'unassigned'
                ? 'Unassigned Barangay'
                : `Brgy. ${selectedBarangayFilter}`}
            </Text>
            <MaterialIcons name="arrow-drop-down" size={20} color="#059669" />
          </TouchableOpacity>
        </View>
      )}

      {/* Summary Cards */}
      <View style={[styles.summaryRow, isMobile && { flexWrap: 'wrap', gap: 10 }]}>
        <View style={[styles.summaryCard, isMobile && { width: '48%', minWidth: 130 }]}>
          <View style={[styles.summaryIconBg, { backgroundColor: '#EFF6FF' }]}>
            <MaterialIcons name="chat-bubble-outline" size={22} color="#2563EB" />
          </View>
          <Text style={styles.summaryValue}>{totalCount}</Text>
          <Text style={styles.summaryLabel}>Total Feedback</Text>
        </View>
        <View style={[styles.summaryCard, isMobile && { width: '48%', minWidth: 130 }]}>
          <View style={[styles.summaryIconBg, { backgroundColor: '#ECFDF5' }]}>
            <MaterialIcons name="thumb-up" size={22} color="#059669" />
          </View>
          <Text style={styles.summaryValue}>{positiveRate}%</Text>
          <Text style={styles.summaryLabel}>Positive Rate</Text>
        </View>
        <View style={[styles.summaryCard, isMobile && { width: '48%', minWidth: 130 }]}>
          <View style={[styles.summaryIconBg, { backgroundColor: '#ECFDF5' }]}>
            <MaterialIcons name="sentiment-very-satisfied" size={22} color="#059669" />
          </View>
          <Text style={styles.summaryValue}>{lovedCount}</Text>
          <Text style={styles.summaryLabel}>Loved It</Text>
        </View>
        <View style={[styles.summaryCard, isMobile && { width: '48%', minWidth: 130 }]}>
          <View style={[styles.summaryIconBg, { backgroundColor: '#FEF2F2' }]}>
            <MaterialIcons name="sentiment-very-dissatisfied" size={22} color="#DC2626" />
          </View>
          <Text style={styles.summaryValue}>{terribleCount}</Text>
          <Text style={styles.summaryLabel}>Terrible</Text>
        </View>
      </View>

      {/* Rating Breakdown */}
      <View style={[styles.card, isMobile && { padding: 14 }]}>
        <Text style={styles.cardTitle}>
          Rating Breakdown
          {!isCoordinator && selectedBarangayFilter !== 'all' ? ` • Brgy. ${selectedBarangayFilter}` : ''}
          {isCoordinator && effectiveCoordinatorBarangay ? ` • Brgy. ${effectiveCoordinatorBarangay}` : ''}
        </Text>
        {['Loved it', 'Good', 'Bad', 'Terrible'].map((rating) => {
          const color = getRatingColor(rating);
          const width = getRatingBarWidth(rating);
          const count = barangayScopedFeedbacks.filter(
            (f) => f.rating.toLowerCase() === rating.toLowerCase()
          ).length;
          return (
            <View key={rating} style={styles.ratingBarRow}>
              <Text style={styles.ratingBarEmoji}>{getRatingEmoji(rating)}</Text>
              <Text style={[styles.ratingBarLabel, { width: 70 }]}>{rating}</Text>
              <View style={styles.ratingBarBg}>
                <View
                  style={[
                    styles.ratingBarFill,
                    { width: `${width}%`, backgroundColor: color.text },
                  ]}
                />
              </View>
              <Text style={styles.ratingBarCount}>{count}</Text>
              <Text style={styles.ratingBarPercent}>{width}%</Text>
            </View>
          );
        })}
      </View>

      {/* Feedback List */}
      <View style={[styles.card, isMobile && { padding: 14 }]}>
        {/* Role Filters & Rating Filters */}
        <View style={styles.filterSectionContainer}>
          {/* Sender Role Filter Chips */}
          <View style={styles.roleFilterRow}>
            <Text style={styles.filterSectionLabel}>Sender Role:</Text>
            {(['all', 'resident', 'driver'] as const).map((role) => (
              <TouchableOpacity
                key={role}
                style={[
                  styles.roleChip,
                  selectedRoleFilter === role &&
                    (role === 'driver' ? styles.roleChipActiveDriver : styles.roleChipActiveResident),
                ]}
                onPress={() => {
                  setSelectedRoleFilter(role);
                  setCurrentPage(1);
                }}
              >
                <MaterialIcons
                  name={role === 'driver' ? 'local-shipping' : role === 'resident' ? 'person' : 'people'}
                  size={14}
                  color={
                    selectedRoleFilter === role
                      ? role === 'driver'
                        ? '#6D28D9'
                        : '#059669'
                      : '#6B7280'
                  }
                />
                <Text
                  style={[
                    styles.roleChipText,
                    selectedRoleFilter === role &&
                      (role === 'driver'
                        ? styles.roleChipTextActiveDriver
                        : styles.roleChipTextActiveResident),
                  ]}
                >
                  {role === 'all'
                    ? `All Roles (${totalCount})`
                    : role === 'resident'
                    ? `Residents (${residentCount})`
                    : `Drivers (${driverCount})`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Search Box & Rating Chips */}
          <View
            style={[
              styles.filtersRow,
              isMobile && { flexDirection: 'column', alignItems: 'stretch', gap: 12 },
            ]}
          >
            <View style={[styles.searchBox, isMobile && { width: '100%' }]}>
              <MaterialIcons name="search" size={20} color="#9CA3AF" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name, email, message, barangay..."
                placeholderTextColor="#9CA3AF"
                value={searchText}
                onChangeText={(text) => {
                  setSearchText(text);
                  setCurrentPage(1);
                }}
              />
              {searchText ? (
                <TouchableOpacity onPress={() => setSearchText('')}>
                  <MaterialIcons name="close" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={[styles.filterChips, isMobile && { flexWrap: 'wrap', gap: 6 }]}>
              {(['all', 'loved it', 'good', 'bad', 'terrible'] as const).map((filter) => (
                <TouchableOpacity
                  key={filter}
                  style={[
                    styles.filterChip,
                    selectedFilter === filter && styles.filterChipActive,
                  ]}
                  onPress={() => {
                    setSelectedFilter(filter);
                    setCurrentPage(1);
                  }}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      selectedFilter === filter && styles.filterChipTextActive,
                    ]}
                  >
                    {filter === 'all'
                      ? 'All Ratings'
                      : filter === 'loved it'
                      ? '😍 Loved'
                      : filter === 'good'
                      ? '😊 Good'
                      : filter === 'bad'
                      ? '😕 Bad'
                      : '😣 Terrible'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Table */}
        <ScrollView
          horizontal={isMobile}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, minWidth: '100%' }}
          style={{ width: '100%' }}
        >
          <View style={{ minWidth: isMobile ? 850 : '100%', width: '100%' }}>
            <View style={styles.tableHead}>
              <Text style={[styles.th, { flex: 2.2 }]}>USER & SENDER ROLE</Text>
              <Text style={[styles.th, { flex: 1.3 }]}>BARANGAY</Text>
              <Text style={[styles.th, { flex: 1 }]}>RATING</Text>
              <Text style={[styles.th, { flex: 2.8 }]}>MESSAGE</Text>
              <Text style={[styles.th, { flex: 1 }]}>DATE</Text>
              <Text style={[styles.th, { flex: 0.5, textAlign: 'center' }]}>ACTIONS</Text>
            </View>

            {paginatedFeedbacks.length === 0 ? (
              <View style={styles.emptyRow}>
                <MaterialIcons name="inbox" size={40} color="#D1D5DB" />
                <Text style={styles.emptyText}>
                  {isCoordinator
                    ? `No feedback submissions found for Brgy. ${effectiveCoordinatorBarangay || 'your barangay'}.`
                    : selectedBarangayFilter !== 'all'
                    ? `No feedback found for Brgy. ${selectedBarangayFilter}.`
                    : 'No feedback found matching the selected filters.'}
                </Text>
                {!isCoordinator && selectedBarangayFilter !== 'all' && (
                  <TouchableOpacity
                    style={[styles.outlineBtn, { marginTop: 8 }]}
                    onPress={() => setSelectedBarangayFilter('all')}
                  >
                    <Text style={styles.outlineBtnText}>View All Barangays</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              paginatedFeedbacks.map((feedback) => {
                const ratingColor = getRatingColor(feedback.rating);
                const isDriver = feedback.userRole === 'driver';

                return (
                  <TouchableOpacity
                    key={feedback.id}
                    style={styles.tableRow}
                    onPress={() => {
                      setSelectedFeedback(feedback);
                      setShowDetailModal(true);
                    }}
                  >
                    {/* User & Sender Role */}
                    <View
                      style={[
                        styles.td,
                        { flex: 2.2, flexDirection: 'row', alignItems: 'center', gap: 10 },
                      ]}
                    >
                      <View
                        style={[
                          styles.avatarPlaceholder,
                          isDriver && { backgroundColor: '#EDE9FE' },
                        ]}
                      >
                        {feedback.photoURL ? (
                          <Image source={{ uri: feedback.photoURL }} style={styles.avatarImage} />
                        ) : (
                          <MaterialIcons
                            name={isDriver ? 'local-shipping' : 'person'}
                            size={18}
                            color={isDriver ? '#7C3AED' : '#059669'}
                          />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={styles.userName} numberOfLines={1}>{feedback.userName}</Text>
                          {/* Sender Role Badge */}
                          <View
                            style={[
                              styles.roleBadge,
                              isDriver ? styles.roleBadgeDriver : styles.roleBadgeResident,
                            ]}
                          >
                            <MaterialIcons
                              name={isDriver ? 'local-shipping' : 'person'}
                              size={10}
                              color={isDriver ? '#6D28D9' : '#047857'}
                            />
                            <Text
                              style={[
                                styles.roleBadgeText,
                                isDriver ? styles.roleBadgeTextDriver : styles.roleBadgeTextResident,
                              ]}
                            >
                              {isDriver ? 'Driver' : 'Resident'}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.userEmail} numberOfLines={1}>
                          {feedback.userEmail}
                        </Text>
                      </View>
                    </View>

                    {/* Barangay */}
                    <View style={[styles.td, { flex: 1.3, justifyContent: 'center' }]}>
                      {feedback.barangay ? (
                        <View style={styles.barangayBadge}>
                          <MaterialIcons name="place" size={12} color="#059669" />
                          <Text style={styles.barangayBadgeText} numberOfLines={1}>
                            Brgy. {feedback.barangay}
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.unassignedBarangayText}>General / City</Text>
                      )}
                    </View>

                    {/* Rating */}
                    <View style={[styles.td, { flex: 1 }]}>
                      <View style={[styles.ratingBadge, { backgroundColor: ratingColor.bg }]}>
                        <Text style={{ fontSize: 13 }}>{getRatingEmoji(feedback.rating)}</Text>
                        <Text style={[styles.ratingBadgeText, { color: ratingColor.text }]}>
                          {feedback.rating}
                        </Text>
                      </View>
                    </View>

                    {/* Message */}
                    <View style={[styles.td, { flex: 2.8 }]}>
                      <Text style={styles.messageText} numberOfLines={2}>
                        {feedback.message}
                      </Text>
                    </View>

                    {/* Date */}
                    <Text style={[styles.td, { flex: 1, color: '#6B7280', fontSize: 13 }]}>
                      {formatDate(feedback.createdAt)}
                    </Text>

                    {/* Action */}
                    <View style={[styles.td, { flex: 0.5, alignItems: 'center' }]}>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedFeedback(feedback);
                          setShowDetailModal(true);
                        }}
                        style={styles.actionBtn}
                        accessibilityLabel="View Feedback"
                      >
                        <MaterialIcons name="visibility" size={18} color="#4B5563" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </ScrollView>

        {/* Pagination */}
        {totalPages > 1 && (
          <View style={styles.paginationRow}>
            <Text style={styles.paginationInfo}>
              Showing {(currentPage - 1) * itemsPerPage + 1}-
              {Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length} feedback
            </Text>
            <View style={styles.paginationButtons}>
              <TouchableOpacity
                style={[styles.pageBtn, currentPage === 1 && styles.pageBtnDisabled]}
                disabled={currentPage === 1}
                onPress={() => setCurrentPage((p) => p - 1)}
              >
                <MaterialIcons
                  name="chevron-left"
                  size={20}
                  color={currentPage === 1 ? '#D1D5DB' : '#374151'}
                />
              </TouchableOpacity>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const page = i + 1;
                return (
                  <TouchableOpacity
                    key={page}
                    style={[styles.pageBtn, currentPage === page && styles.pageBtnActive]}
                    onPress={() => setCurrentPage(page)}
                  >
                    <Text
                      style={[
                        styles.pageBtnText,
                        currentPage === page && styles.pageBtnTextActive,
                      ]}
                    >
                      {page}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.pageBtn, currentPage === totalPages && styles.pageBtnDisabled]}
                disabled={currentPage === totalPages}
                onPress={() => setCurrentPage((p) => p + 1)}
              >
                <MaterialIcons
                  name="chevron-right"
                  size={20}
                  color={currentPage === totalPages ? '#D1D5DB' : '#374151'}
                />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Detail Modal */}
      <Modal
        visible={showDetailModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedFeedback && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Feedback Details</Text>
                  <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                    <MaterialIcons name="close" size={24} color="#6B7280" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                  {/* User Info */}
                  <View style={styles.detailUserRow}>
                    <View
                      style={[
                        styles.detailAvatarBg,
                        selectedFeedback.userRole === 'driver' && { backgroundColor: '#EDE9FE' },
                      ]}
                    >
                      {selectedFeedback.photoURL ? (
                        <Image
                          source={{ uri: selectedFeedback.photoURL }}
                          style={styles.detailAvatarImage}
                        />
                      ) : (
                        <MaterialIcons
                          name={selectedFeedback.userRole === 'driver' ? 'local-shipping' : 'person'}
                          size={30}
                          color={selectedFeedback.userRole === 'driver' ? '#7C3AED' : '#059669'}
                        />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Text style={styles.detailUserName}>{selectedFeedback.userName}</Text>
                        {/* Role Badge */}
                        <View
                          style={[
                            styles.roleBadge,
                            selectedFeedback.userRole === 'driver'
                              ? styles.roleBadgeDriver
                              : styles.roleBadgeResident,
                            { paddingHorizontal: 8, paddingVertical: 3 },
                          ]}
                        >
                          <MaterialIcons
                            name={selectedFeedback.userRole === 'driver' ? 'local-shipping' : 'person'}
                            size={12}
                            color={selectedFeedback.userRole === 'driver' ? '#6D28D9' : '#047857'}
                          />
                          <Text
                            style={[
                              styles.roleBadgeText,
                              selectedFeedback.userRole === 'driver'
                                ? styles.roleBadgeTextDriver
                                : styles.roleBadgeTextResident,
                            ]}
                          >
                            {selectedFeedback.userRole === 'driver' ? 'Driver' : 'Resident'}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.detailUserEmail}>{selectedFeedback.userEmail}</Text>

                      {/* Barangay Tag */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                        <MaterialIcons name="place" size={14} color="#059669" />
                        <Text style={{ fontSize: 12.5, fontWeight: '600', color: '#059669' }}>
                          Brgy. {selectedFeedback.barangay || 'Danao City'}
                        </Text>
                        {selectedFeedback.street && selectedFeedback.street !== selectedFeedback.barangay ? (
                          <Text style={{ fontSize: 12, color: '#6B7280' }}>
                            ({selectedFeedback.street})
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  {/* Rating */}
                  <View style={styles.detailRatingRow}>
                    <Text style={{ fontSize: 36 }}>{getRatingEmoji(selectedFeedback.rating)}</Text>
                    <View>
                      <Text style={styles.detailRatingLabel}>RATING GIVEN</Text>
                      <Text
                        style={[
                          styles.detailRatingValue,
                          { color: getRatingColor(selectedFeedback.rating).text },
                        ]}
                      >
                        {selectedFeedback.rating}
                      </Text>
                    </View>
                  </View>

                  {/* Message */}
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>MESSAGE CONTENT</Text>
                    <Text style={styles.detailMessage}>{selectedFeedback.message}</Text>
                  </View>

                  {/* Date */}
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>SUBMISSION TIMESTAMP</Text>
                    <Text style={styles.detailDate}>{formatDateFull(selectedFeedback.createdAt)}</Text>
                  </View>
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* CENRO: Filter Feedback by Barangay Modal */}
      <Modal
        visible={isBarangayModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsBarangayModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 480 }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Filter Feedback by Barangay</Text>
                <Text style={styles.modalSubtitle}>Select an operational barangay jurisdiction</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsBarangayModalVisible(false)}
                style={styles.modalCloseBtn}
              >
                <MaterialIcons name="close" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View style={styles.modalSearchContainer}>
              <MaterialIcons name="search" size={18} color="#6B7280" />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search barangay..."
                placeholderTextColor="#9CA3AF"
                value={barangaySearchQuery}
                onChangeText={setBarangaySearchQuery}
              />
              {barangaySearchQuery ? (
                <TouchableOpacity onPress={() => setBarangaySearchQuery('')}>
                  <MaterialIcons name="close" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              ) : null}
            </View>

            <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
              {/* Option: All Barangays */}
              <TouchableOpacity
                style={[
                  styles.barangayModalRow,
                  selectedBarangayFilter === 'all' && styles.barangayModalRowActive,
                ]}
                onPress={() => {
                  setSelectedBarangayFilter('all');
                  setCurrentPage(1);
                  setIsBarangayModalVisible(false);
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <MaterialIcons
                    name="location-city"
                    size={18}
                    color={selectedBarangayFilter === 'all' ? '#059669' : '#6B7280'}
                  />
                  <Text
                    style={[
                      styles.barangayModalRowText,
                      selectedBarangayFilter === 'all' && styles.barangayModalRowTextActive,
                    ]}
                  >
                    All Barangays (Whole City)
                  </Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{feedbacks.length} feedbacks</Text>
                </View>
              </TouchableOpacity>

              {/* 42 Danao City Barangays */}
              {filteredBarangayList.map((b) => {
                const isSelected = normalizeBrgy(selectedBarangayFilter) === normalizeBrgy(b);
                const count = barangayFeedbackCounts[b] || 0;
                return (
                  <TouchableOpacity
                    key={b}
                    style={[
                      styles.barangayModalRow,
                      isSelected && styles.barangayModalRowActive,
                    ]}
                    onPress={() => {
                      setSelectedBarangayFilter(b);
                      setCurrentPage(1);
                      setIsBarangayModalVisible(false);
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <MaterialIcons
                        name="holiday-village"
                        size={18}
                        color={isSelected ? '#059669' : '#6B7280'}
                      />
                      <Text
                        style={[
                          styles.barangayModalRowText,
                          isSelected && styles.barangayModalRowTextActive,
                        ]}
                      >
                        Brgy. {b}
                      </Text>
                    </View>
                    {count > 0 ? (
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>{count} feedbacks</Text>
                      </View>
                    ) : (
                      <Text style={{ fontSize: 11, color: '#9CA3AF' }}>0 feedbacks</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Service Feedback Export Modal */}
      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="Citizen Service & Feedback Registry"
        dataCount={filtered.length}
        onExport={handleExport}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB', padding: 24 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },

  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 4 },
  headerDesc: { fontSize: 14, color: '#6B7280' },
  headerActions: { flexDirection: 'row', gap: 10 },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
  },
  outlineBtnText: { fontSize: 13, fontWeight: '600', color: '#374151' },

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
  coordinatorLockedTitle: { fontSize: 14, fontWeight: '700', color: '#065F46' },
  coordinatorLockedSubtitle: { fontSize: 12, color: '#047857', marginTop: 2 },

  // CENRO Barangay Filter Card
  barangayFilterCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  barangayFilterLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barangayFilterTitle: { fontSize: 11.5, fontWeight: '800', color: '#065F46', letterSpacing: 0.5 },
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
  barangayFilterBtnText: { fontSize: 13, fontWeight: '700', color: '#065F46' },

  // Summary cards
  summaryRow: { flexDirection: 'row', gap: 16, marginBottom: 20 },
  summaryCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  summaryIconBg: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  summaryValue: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 2 },
  summaryLabel: { fontSize: 12, fontWeight: '600', color: '#6B7280', letterSpacing: 0.3 },

  // Rating breakdown card
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 16 },
  ratingBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  ratingBarEmoji: { fontSize: 18, width: 24 },
  ratingBarLabel: { fontSize: 13, color: '#374151', fontWeight: '500' },
  ratingBarBg: { flex: 1, height: 8, backgroundColor: '#F3F4F6', borderRadius: 4, overflow: 'hidden' },
  ratingBarFill: { height: '100%', borderRadius: 4 },
  ratingBarCount: { width: 28, textAlign: 'right', fontSize: 13, fontWeight: '700', color: '#374151' },
  ratingBarPercent: { width: 36, textAlign: 'right', fontSize: 12, color: '#9CA3AF' },

  // Filters Container
  filterSectionContainer: { marginBottom: 16 },
  roleFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  filterSectionLabel: { fontSize: 12.5, fontWeight: '700', color: '#4B5563', marginRight: 4 },
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  roleChipActiveResident: { backgroundColor: '#ECFDF5', borderColor: '#059669' },
  roleChipActiveDriver: { backgroundColor: '#F5F3FF', borderColor: '#7C3AED' },
  roleChipText: { fontSize: 12, fontWeight: '600', color: '#4B5563' },
  roleChipTextActiveResident: { color: '#047857', fontWeight: '700' },
  roleChipTextActiveDriver: { color: '#6D28D9', fontWeight: '700' },

  filtersRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    height: 40,
    minWidth: 260,
    flex: 1,
  },
  searchInput: { flex: 1, fontSize: 13, color: '#374151', marginLeft: 8 },
  filterChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  filterChipActive: { backgroundColor: '#4b6354', borderColor: '#4b6354' },
  filterChipText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  filterChipTextActive: { color: '#FFFFFF' },

  // Table
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', paddingBottom: 12, marginBottom: 4 },
  th: { fontSize: 11, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5, textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  td: { justifyContent: 'center' },
  avatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImage: { width: 36, height: 36, borderRadius: 18 },
  userName: { fontSize: 13.5, fontWeight: '700', color: '#111827' },
  userEmail: { fontSize: 11.5, color: '#9CA3AF', marginTop: 1 },

  // Role Badge
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  roleBadgeResident: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  roleBadgeDriver: { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' },
  roleBadgeText: { fontSize: 10, fontWeight: '700' },
  roleBadgeTextResident: { color: '#047857' },
  roleBadgeTextDriver: { color: '#6D28D9' },

  // Barangay Badge
  barangayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  barangayBadgeText: { fontSize: 11.5, fontWeight: '600', color: '#15803D', maxWidth: 120 },
  unassignedBarangayText: { fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' },

  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start' },
  ratingBadgeText: { fontSize: 12, fontWeight: '600' },
  messageText: { fontSize: 13, color: '#374151', lineHeight: 18 },
  actionBtn: { padding: 6, borderRadius: 6, backgroundColor: '#F3F4F6' },

  // Empty
  emptyRow: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center' },

  // Pagination
  paginationRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  paginationInfo: { fontSize: 13, color: '#6B7280' },
  paginationButtons: { flexDirection: 'row', gap: 4 },
  pageBtn: { width: 32, height: 32, borderRadius: 6, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  pageBtnActive: { backgroundColor: '#2E8B57', borderColor: '#2E8B57' },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  pageBtnTextActive: { color: '#FFFFFF' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#FFFFFF', borderRadius: 16, width: '90%', maxWidth: 520, maxHeight: '82%', overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  modalSubtitle: { fontSize: 12.5, color: '#6B7280', marginTop: 2 },
  modalCloseBtn: { padding: 4 },
  modalBody: { padding: 20 },

  // Detail modal contents
  detailUserRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  detailAvatarBg: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  detailAvatarImage: { width: 54, height: 54, borderRadius: 27 },
  detailUserName: { fontSize: 17, fontWeight: '700', color: '#111827' },
  detailUserEmail: { fontSize: 12.5, color: '#6B7280', marginTop: 1 },
  detailRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#F9FAFB', padding: 14, borderRadius: 12, marginBottom: 18 },
  detailRatingLabel: { fontSize: 11, color: '#6B7280', fontWeight: '700', letterSpacing: 0.5 },
  detailRatingValue: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  detailSection: { marginBottom: 18 },
  detailSectionLabel: { fontSize: 11.5, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  detailMessage: { fontSize: 14.5, color: '#374151', lineHeight: 22, backgroundColor: '#F9FAFB', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  detailDate: { fontSize: 13.5, color: '#374151' },

  // Barangay Modal
  modalSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    margin: 16,
    marginBottom: 8,
  },
  modalSearchInput: { flex: 1, fontSize: 13, color: '#111827' },
  barangayModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginHorizontal: 12,
    marginBottom: 4,
  },
  barangayModalRowActive: { backgroundColor: '#ECFDF5' },
  barangayModalRowText: { fontSize: 13.5, color: '#374151', fontWeight: '500' },
  barangayModalRowTextActive: { color: '#065F46', fontWeight: '700' },
  countBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  countBadgeText: { fontSize: 11, fontWeight: '700', color: '#2E8B57' },
});
