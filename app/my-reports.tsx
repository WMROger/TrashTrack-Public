import React, { useState, useEffect, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  Image, 
  ActivityIndicator, 
  Modal, 
  RefreshControl,
  Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { getOptimizedReportImageUrl } from '@/config/cloudinary';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { formatWasteAmount } from '@/utils/wasteUnits';
import ExportModal from '@/components/admin/cenro/ExportModal';
import { exportReport, ExportFormat } from '@/services/reportExportService';

interface Report {
  id: string;
  title: string;
  description: string;
  barangay: string;
  street: string;
  landmark: string;
  imageURL: string | null;
  completionImage?: string | null;
  completionNotes?: string | null;
  collectedAt?: any;
  resolvedAt?: any;
  location: { latitude: number; longitude: number } | null;
  userId: string;
  userEmail: string;
  createdAt: any;
  status: 'pending' | 'acknowledged' | 'in-progress' | 'resolved' | 'declined' | 'pickup_not_successful' | 'pickup-not-successful';
  aiAnalysis: { 
    wasteType: string; 
    estimatedWeight: string; 
    confidence: string; 
    details: string;
  } | null;
  updatedAt?: any;
  statusHistory?: Array<{ status: string; notes: string; timestamp: any; adminEmail: string }>;
}

const parseDateSafe = (raw: any): Date | null => {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'object' && typeof raw.toDate === 'function') {
    try {
      const d = raw.toDate();
      if (!isNaN(d.getTime())) return d;
    } catch {}
  }
  if (typeof raw === 'object' && typeof raw.seconds === 'number') {
    const d = new Date(raw.seconds * 1000);
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof raw === 'number') {
    const d = new Date(raw > 1e11 ? raw : raw * 1000);
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof raw === 'string') {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
};

const formatDate = (timestamp: any, includeTime = true): string => {
  const d = parseDateSafe(timestamp);
  if (!d) return 'Recently';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
};

export default function MyReportsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isExportModalVisible, setIsExportModalVisible] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    const headers = ['Report Title', 'Description', 'Barangay', 'Street / Location', 'Waste Category', 'Status', 'Date Submitted'];
    const rows = reports.map((r) => [
      r.title || 'N/A',
      r.description || 'N/A',
      r.barangay || 'Danao City',
      r.street || 'N/A',
      r.aiAnalysis?.wasteType || 'General Waste',
      r.status.toUpperCase(),
      formatDate(r.createdAt, false),
    ]);

    await exportReport({
      format,
      filename: `my_trash_reports_${new Date().toISOString().slice(0, 10)}`,
      title: 'Citizen Trash Incident Report History',
      subtitle: 'Personal Waste Reporting & Clean-up Tracking Record',
      jurisdiction: 'City of Danao',
      generatedBy: auth.currentUser?.email || 'Citizen Resident',
      headers,
      rows,
      summaryCards: [
        { label: 'Total Submitted', value: reports.length },
        { label: 'Resolved', value: reports.filter((r) => r.status === 'resolved').length },
        { label: 'Pending / Active', value: reports.filter((r) => r.status !== 'resolved').length },
      ],
      sheetName: 'My_Reports',
    });
  };

  useEffect(() => {
    if (!auth.currentUser?.uid) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'reports'),
      where('userId', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedReports: Report[] = [];
      snapshot.forEach((doc) => {
        fetchedReports.push({ id: doc.id, ...doc.data() } as Report);
      });
      
      // Sort client-side to avoid requiring composite indexes initially
      fetchedReports.sort((a, b) => {
        const timeA = parseDateSafe(a.createdAt)?.getTime() || 0;
        const timeB = parseDateSafe(b.createdAt)?.getTime() || 0;
        return timeB - timeA;
      });
      
      setReports(fetchedReports);
      setLoading(false);
      setRefreshing(false);
    }, (error) => {
      console.error("Error fetching reports:", error);
      setLoading(false);
      setRefreshing(false);
    });

    return () => unsubscribe();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    // onSnapshot automatically updates, but we can simulate a refresh state
    setTimeout(() => setRefreshing(false), 1000);
  };

  const statusCounts = useMemo(() => {
    return reports.reduce(
      (acc, report) => {
        const s = report.status || 'pending';
        if (acc[s] !== undefined) {
          acc[s]++;
        }
        return acc;
      },
      { pending: 0, acknowledged: 0, 'in-progress': 0, resolved: 0, declined: 0 } as Record<string, number>
    );
  }, [reports]);

  const openReport = (report: Report) => {
    setSelectedReport(report);
    setModalVisible(true);
  };

  const closeReport = () => {
    setModalVisible(false);
    setSelectedReport(null);
  };

  const getStatusDetails = (status: string) => {
    switch (status) {
      case 'pending': return { label: 'Pending', color: '#F59E0B', icon: 'time-outline' };
      case 'acknowledged': return { label: 'Acknowledged', color: '#3B82F6', icon: 'checkmark-circle-outline' };
      case 'in-progress': return { label: 'In Progress', color: '#F97316', icon: 'bicycle-outline' };
      case 'resolved': return { label: 'Resolved', color: '#10B981', icon: 'checkmark-done-circle' };
      case 'declined': return { label: 'Declined', color: '#EF4444', icon: 'close-circle-outline' };
      case 'pickup_not_successful':
      case 'pickup-not-successful':
        return { label: 'Pickup Not Successful', color: '#EF4444', icon: 'alert-circle-outline' };
      default: return { label: 'Unknown', color: '#6B7280', icon: 'help-circle-outline' };
    }
  };

  const renderTimeline = (report: Report) => {
    if (report.status === 'declined') {
      const declineItem = report.statusHistory?.slice().reverse().find(h => h.status === 'declined');
      const timestamp = declineItem?.timestamp ? formatDate(declineItem.timestamp) : null;

      return (
        <View style={styles.timelineContainer}>
          <Text style={styles.sectionTitle}>Status Timeline</Text>
          <View style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 10, padding: 14, marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Ionicons name="close-circle" size={20} color="#DC2626" />
              <Text style={{ color: '#991B1B', fontWeight: 'bold', fontSize: 15 }}>Report Declined</Text>
            </View>
            <Text style={{ color: '#7F1D1D', fontSize: 13, lineHeight: 18 }}>
              This report was reviewed by the coordinator and marked as not legitimate or ineligible.
            </Text>
            {declineItem?.notes ? (
              <View style={{ marginTop: 10, backgroundColor: '#FFFFFF', padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#FEE2E2' }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#991B1B', marginBottom: 2 }}>COORDINATOR NOTE:</Text>
                <Text style={{ fontSize: 13, color: '#374151', fontStyle: 'italic' }}>&quot;{declineItem.notes}&quot;</Text>
              </View>
            ) : null}
            {timestamp ? (
              <Text style={{ fontSize: 11, color: '#9CA3AF', marginTop: 8 }}>{timestamp}</Text>
            ) : null}
          </View>
        </View>
      );
    }

    if (report.status === 'pickup_not_successful' || (report.status as string) === 'pickup-not-successful') {
      const timestamp = formatDate(report.updatedAt || report.createdAt);

      return (
        <View style={styles.timelineContainer}>
          <Text style={styles.sectionTitle}>Status Timeline</Text>
          <View style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 10, padding: 14, marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Ionicons name="alert-circle" size={20} color="#DC2626" />
              <Text style={{ color: '#991B1B', fontWeight: 'bold', fontSize: 15 }}>Pickup Not Successful</Text>
            </View>
            <Text style={{ color: '#7F1D1D', fontSize: 13, lineHeight: 18 }}>
              {(report as any).unsuccessfulReason || 'The scheduled pickup for this report was not successful as the assigned driver was reassigned. CENRO has been alerted to review and reschedule this collection.'}
            </Text>
            {timestamp ? (
              <Text style={{ fontSize: 11, color: '#9CA3AF', marginTop: 8 }}>{timestamp}</Text>
            ) : null}
          </View>
        </View>
      );
    }

    const steps = [
      { id: 'pending', label: 'Submitted' },
      { id: 'acknowledged', label: 'Acknowledged' },
      { id: 'in-progress', label: 'In Progress' },
      { id: 'resolved', label: 'Resolved' }
    ];

    const currentStatusIndex = steps.findIndex(s => s.id === report.status);
    // If status is somehow unknown, default to first step
    const currentIndex = currentStatusIndex >= 0 ? currentStatusIndex : 0;

    return (
      <View style={styles.timelineContainer}>
        <Text style={styles.sectionTitle}>Status Timeline</Text>
        {steps.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isFuture = index > currentIndex;

          let iconColor = '#9CA3AF'; // Future (Grey)
          if (isCompleted) iconColor = '#10B981'; // Green check
          if (isCurrent) iconColor = getStatusDetails(report.status).color; // Highlight current

          // Find history item for this step if it exists
          const historyItem = report.statusHistory?.find(h => h.status === step.id);
          const rawTimestamp = historyItem?.timestamp || (step.id === 'pending' ? (report.createdAt || (report as any).createdAtIso) : null);
          const timestamp = rawTimestamp ? formatDate(rawTimestamp) : null;

          return (
            <View key={step.id} style={styles.timelineStep}>
              <View style={styles.timelineIconContainer}>
                {isCompleted ? (
                  <View style={[styles.timelineDot, { backgroundColor: '#10B981' }]}>
                    <Ionicons name="checkmark" size={14} color="white" />
                  </View>
                ) : isCurrent ? (
                  <View style={[styles.timelineDot, { backgroundColor: iconColor, transform: [{ scale: 1.2 }] }]}>
                    <Ionicons name="radio-button-on" size={14} color="white" />
                  </View>
                ) : (
                  <View style={[styles.timelineDot, { backgroundColor: '#E5E7EB', borderWidth: 2, borderColor: '#D1D5DB' }]} />
                )}
                {index < steps.length - 1 && (
                  <View style={[styles.timelineLine, { backgroundColor: isCompleted ? '#10B981' : '#E5E7EB' }]} />
                )}
              </View>
              
              <View style={styles.timelineContent}>
                <Text style={[
                  styles.timelineLabel, 
                  isCurrent && styles.timelineLabelCurrent,
                  isFuture && styles.timelineLabelFuture
                ]}>
                  {step.label}
                </Text>
                {timestamp ? <Text style={styles.timelineDate}>{timestamp}</Text> : null}
                {historyItem?.notes ? (
                  <View style={styles.timelineNotes}>
                    <Text style={styles.timelineNotesText}>Note: {historyItem.notes}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#1F2937" />
          </TouchableOpacity>
          <View style={styles.headerTitles}>
            <Text style={styles.headerTitle}>My Reports</Text>
            <Text style={styles.headerSubtitle}>{reports.length} total report{reports.length !== 1 ? 's' : ''}</Text>
          </View>
          {reports.length > 0 ? (
            <TouchableOpacity
              onPress={() => setIsExportModalVisible(true)}
              style={styles.headerExportBtn}
              activeOpacity={0.8}
            >
              <Ionicons name="download-outline" size={20} color="#059669" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>
      </View>

      <ScrollView 
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4A6741']} />}
      >
        {/* Summary Cards */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.summaryContainer}>
          <View style={[styles.summaryCard, { borderBottomColor: '#F59E0B' }]}>
            <Text style={styles.summaryCount}>{statusCounts['pending']}</Text>
            <Text style={styles.summaryLabel}>Pending</Text>
          </View>
          <View style={[styles.summaryCard, { borderBottomColor: '#3B82F6' }]}>
            <Text style={styles.summaryCount}>{statusCounts['acknowledged']}</Text>
            <Text style={styles.summaryLabel}>Acknowledged</Text>
          </View>
          <View style={[styles.summaryCard, { borderBottomColor: '#F97316' }]}>
            <Text style={styles.summaryCount}>{statusCounts['in-progress']}</Text>
            <Text style={styles.summaryLabel}>In Progress</Text>
          </View>
          <View style={[styles.summaryCard, { borderBottomColor: '#10B981' }]}>
            <Text style={styles.summaryCount}>{statusCounts['resolved']}</Text>
            <Text style={styles.summaryLabel}>Resolved</Text>
          </View>
        </ScrollView>

        {/* Reports List */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#4A6741" />
            <Text style={styles.loadingText}>Loading your reports...</Text>
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconBg}>
              <Ionicons name="document-text-outline" size={64} color="#4A6741" />
            </View>
            <Text style={styles.emptyTitle}>No reports yet</Text>
            <Text style={styles.emptyText}>You haven’t submitted any trash reports.</Text>
            <TouchableOpacity 
              style={styles.emptyButton} 
              onPress={() => router.push('/(tabs)/report')}
            >
              <Text style={styles.emptyButtonText}>Report Trash</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.reportsList}>
            {reports.map((report) => {
              const statusDetails = getStatusDetails(report.status);
              
              return (
                <TouchableOpacity 
                  key={report.id} 
                  style={styles.reportCard}
                  activeOpacity={0.7}
                  onPress={() => openReport(report)}
                >
                  {report.imageURL ? (
                    <Image source={{ uri: getOptimizedReportImageUrl(report.imageURL) || report.imageURL }} style={styles.reportImage} />
                  ) : (
                    <View style={[styles.reportImage, styles.reportImagePlaceholder]}>
                      <Ionicons name="image-outline" size={24} color="#9CA3AF" />
                    </View>
                  )}
                  
                  <View style={styles.reportCardContent}>
                    <View style={styles.reportHeader}>
                      <Text style={styles.reportTitle} numberOfLines={1}>{report.title}</Text>
                      <View style={[styles.statusBadge, { backgroundColor: `${statusDetails.color}15` }]}>
                        <Ionicons name={statusDetails.icon as any} size={12} color={statusDetails.color} />
                        <Text style={[styles.statusText, { color: statusDetails.color }]}>{statusDetails.label}</Text>
                      </View>
                    </View>
                    
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <Ionicons name="location-outline" size={12} color="#6B7280" /> 
                      <Text style={[styles.reportLocation, { marginTop: 0, marginLeft: 4, flex: 1 }]} numberOfLines={1}>
                        {report.street}, {report.barangay}
                      </Text>
                    </View>
                    
                    <View style={styles.reportFooter}>
                      <Text style={styles.reportDate}>{formatDate(report.createdAt, false)}</Text>
                      {report.aiAnalysis?.wasteType && report.aiAnalysis.wasteType !== 'Not waste' ? (
                        <View style={styles.aiBadge}>
                          <Ionicons name="sparkles" size={10} color="#4A6741" />
                          <Text style={styles.aiBadgeText} numberOfLines={1} ellipsizeMode="tail">
                            {report.aiAnalysis.wasteType}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Report Details Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeReport}
      >
        {selectedReport && (
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Report Details</Text>
              <TouchableOpacity onPress={closeReport} style={styles.closeButton}>
                <Ionicons name="close" size={24} color="#1F2937" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              {selectedReport.imageURL ? (
                <TouchableOpacity activeOpacity={0.9} onPress={() => setZoomImageUrl(selectedReport.imageURL)}>
                  <Image source={{ uri: getOptimizedReportImageUrl(selectedReport.imageURL) || selectedReport.imageURL }} style={styles.modalImage} />
                  <View style={styles.driverProofZoomPill}>
                    <Ionicons name="expand" size={13} color="#FFFFFF" />
                    <Text style={styles.driverProofZoomText}>Tap to enlarge</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={[styles.modalImage, styles.reportImagePlaceholder]}>
                  <Ionicons name="image-outline" size={48} color="#9CA3AF" />
                  <Text style={{ color: '#9CA3AF', marginTop: 8 }}>No photo attached</Text>
                </View>
              )}

              <View style={styles.modalDetails}>
                <Text style={styles.modalReportTitle}>{selectedReport.title}</Text>
                
                <View style={styles.modalInfoRow}>
                  <Ionicons name="location" size={18} color="#4A6741" />
                  <Text style={styles.modalInfoText}>{selectedReport.street}, {selectedReport.barangay}</Text>
                </View>
                
                {selectedReport.landmark ? (
                  <View style={styles.modalInfoRow}>
                    <Ionicons name="business" size={18} color="#4A6741" />
                    <Text style={styles.modalInfoText}>Near {selectedReport.landmark}</Text>
                  </View>
                ) : null}

                <View style={styles.modalInfoRow}>
                  <Ionicons name="calendar" size={18} color="#4A6741" />
                  <Text style={styles.modalInfoText}>Submitted on {formatDate(selectedReport.createdAt)}</Text>
                </View>

                {/* Eco Points Status Banner */}
                <View style={[styles.modalPointsBadge, selectedReport.status === 'resolved' ? styles.modalPointsEarned : styles.modalPointsPending]}>
                  <Ionicons 
                    name={selectedReport.status === 'resolved' ? 'star' : 'time-outline'} 
                    size={16} 
                    color={selectedReport.status === 'resolved' ? '#059669' : '#D97706'} 
                  />
                  <Text style={[styles.modalPointsText, { color: selectedReport.status === 'resolved' ? '#059669' : '#D97706' }]}>
                    {selectedReport.status === 'resolved'
                      ? '50 Eco Points Credited (Report Resolved)'
                      : 'Points Pending: 50 Eco Points will be added once resolved'}
                  </Text>
                </View>

                {/* Driver Verified Collection Proof Card */}
                {selectedReport.completionImage ? (
                  <View style={styles.driverProofContainer}>
                    <View style={styles.driverProofHeader}>
                      <View style={styles.driverProofBadge}>
                        <Ionicons name="checkmark-done-circle" size={18} color="#059669" />
                        <Text style={styles.driverProofBadgeText}>DRIVER COLLECTION PROOF</Text>
                      </View>
                      {selectedReport.collectedAt ? (
                        <Text style={styles.driverProofDate}>
                          {formatDate(selectedReport.collectedAt)}
                        </Text>
                      ) : null}
                    </View>

                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setZoomImageUrl(selectedReport.completionImage || null)}
                      style={styles.driverProofImageWrapper}
                    >
                      <Image source={{ uri: selectedReport.completionImage }} style={styles.driverProofImage} resizeMode="cover" />
                      <View style={styles.driverProofZoomPill}>
                        <Ionicons name="expand" size={13} color="#FFFFFF" />
                        <Text style={styles.driverProofZoomText}>Tap to enlarge driver photo</Text>
                      </View>
                    </TouchableOpacity>

                    {selectedReport.completionNotes ? (
                      <View style={styles.driverNotesBox}>
                        <Text style={styles.driverNotesLabel}>DRIVER NOTE:</Text>
                        <Text style={styles.driverNotesText}>&quot;{selectedReport.completionNotes}&quot;</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {selectedReport.description ? (
                  <View style={styles.descriptionContainer}>
                    <Text style={styles.sectionTitle}>Description</Text>
                    <Text style={styles.descriptionText}>{selectedReport.description}</Text>
                  </View>
                ) : null}

                {selectedReport.aiAnalysis && selectedReport.aiAnalysis.wasteType !== 'Not waste' ? (
                  <View style={styles.aiAnalysisContainer}>
                    <View style={styles.aiHeader}>
                      <Ionicons name="sparkles" size={16} color="#4A6741" />
                      <Text style={styles.sectionTitle}>AI Analysis</Text>
                    </View>
                    <View style={styles.aiGrid}>
                      <View style={styles.aiGridItem}>
                        <Text style={styles.aiGridLabel}>Waste Type</Text>
                        <Text style={styles.aiGridValue} numberOfLines={2} ellipsizeMode="tail">{selectedReport.aiAnalysis.wasteType}</Text>
                      </View>
                      <View style={styles.aiGridItem}>
                        <Text style={styles.aiGridLabel}>Est. Weight</Text>
                        <Text style={styles.aiGridValue}>{formatWasteAmount(selectedReport.aiAnalysis.estimatedWeight)}</Text>
                      </View>
                    </View>
                    {selectedReport.aiAnalysis.details ? (
                      <Text style={styles.aiDetailsText}>{selectedReport.aiAnalysis.details}</Text>
                    ) : null}
                  </View>
                ) : null}

                {renderTimeline(selectedReport)}
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>

      {/* Full-Screen Image Zoom Modal */}
      <Modal
        visible={!!zoomImageUrl}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setZoomImageUrl(null)}
      >
        <View style={styles.zoomModalBackdrop}>
          <TouchableOpacity 
            style={styles.zoomCloseButton}
            onPress={() => setZoomImageUrl(null)}
            accessibilityLabel="Close full screen photo"
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>
          {zoomImageUrl && (
            <Image
              source={{ uri: zoomImageUrl }}
              style={styles.zoomModalImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Export Report Modal */}
      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="My Trash Incident Reports"
        dataCount={reports.length}
        onExport={handleExport}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#E8F5E9',
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerExportBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitles: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingTop: 16,
  },
  summaryContainer: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 12,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    minWidth: 110,
    alignItems: 'center',
    borderBottomWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryCount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    fontWeight: '500',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#4A6741',
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
  },
  emptyIconBg: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#C8E6C9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  emptyButton: {
    backgroundColor: '#4A6741',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  reportsList: {
    paddingHorizontal: 16,
    gap: 12,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    flexDirection: 'row',
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  reportImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  reportImagePlaceholder: {
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportCardContent: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reportTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    gap: 4,
    flexShrink: 0,
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  reportLocation: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  reportFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  reportDate: {
    fontSize: 11,
    color: '#9CA3AF',
    flexShrink: 0,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 4,
    flexShrink: 1,
    maxWidth: '65%',
  },
  aiBadgeText: {
    fontSize: 10,
    color: '#4A6741',
    fontWeight: '600',
    flexShrink: 1,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  closeButton: {
    padding: 4,
  },
  modalContent: {
    paddingBottom: 40,
  },
  modalImage: {
    width: '100%',
    height: 250,
  },
  modalDetails: {
    padding: 20,
  },
  modalReportTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 16,
  },
  modalInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  modalInfoText: {
    fontSize: 14,
    color: '#4B5563',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 12,
  },
  descriptionContainer: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  descriptionText: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 22,
  },
  aiAnalysisContainer: {
    marginTop: 20,
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    padding: 16,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  aiGridItem: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 8,
    overflow: 'hidden',
  },
  aiGridLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 4,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  aiGridValue: {
    fontSize: 14,
    color: '#4A6741',
    fontWeight: 'bold',
    flexShrink: 1,
  },
  aiDetailsText: {
    fontSize: 13,
    color: '#4B5563',
    fontStyle: 'italic',
  },
  timelineContainer: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  timelineStep: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  timelineIconContainer: {
    alignItems: 'center',
    marginRight: 16,
  },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    marginTop: -4,
    marginBottom: -24,
    zIndex: 1,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 16,
  },
  timelineLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
  },
  timelineLabelCurrent: {
    color: '#1F2937',
  },
  timelineLabelFuture: {
    color: '#9CA3AF',
  },
  timelineDate: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  timelineNotes: {
    marginTop: 8,
    backgroundColor: '#F3F4F6',
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4A6741',
  },
  timelineNotesText: {
    fontSize: 13,
    color: '#4B5563',
    fontStyle: 'italic',
  },
  driverProofContainer: {
    marginTop: 18,
    marginBottom: 10,
    backgroundColor: '#F0FDF4',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    padding: 14,
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  driverProofHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  driverProofBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  driverProofBadgeText: {
    color: '#15803D',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  driverProofDate: {
    fontSize: 11,
    color: '#4B5563',
    fontWeight: '500',
  },
  driverProofImageWrapper: {
    width: '100%',
    height: 190,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E5E7EB',
  },
  driverProofImage: {
    width: '100%',
    height: '100%',
  },
  driverProofZoomPill: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  driverProofZoomText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  driverNotesBox: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#22C55E',
  },
  driverNotesLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#16A34A',
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  driverNotesText: {
    fontSize: 13,
    color: '#374151',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  zoomModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  zoomCloseButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomModalImage: {
    width: '94%',
    height: '80%',
  },
  pointsIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  pointsEarned: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  pointsPending: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  pointsIndicatorText: {
    fontSize: 10,
    fontWeight: '700',
  },
  modalPointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginTop: 8,
    marginBottom: 6,
    gap: 8,
  },
  modalPointsEarned: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  modalPointsPending: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  modalPointsText: {
    fontSize: 12.5,
    fontWeight: '700',
    flex: 1,
  },
});
