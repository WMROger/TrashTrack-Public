import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { db } from '../../../config/firebase';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import LiveOperationsMap, { LiveMapReport, LiveMapTruck } from './LiveOperationsMap';
import ExportModal from './ExportModal';
import { exportReport, ExportFormat } from '@/services/reportExportService';

export interface LogItem {
  id: string;
  timestamp: any;
  source: string;
  action: string;
  category: 'system' | 'driver' | 'dispatch' | 'report' | 'other';
  confidence?: string;
  details?: string;
}

export default function OperationalLogsTab({
  isReadOnly = false,
}: {
  isReadOnly?: boolean;
} = {}) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [overrideLogs, setOverrideLogs] = useState<LogItem[]>([]);
  const [clientLogs, setClientLogs] = useState<LogItem[]>([]);
  const [liveTrucks, setLiveTrucks] = useState<LiveMapTruck[]>([]);
  const [openReports, setOpenReports] = useState<(LiveMapReport & { barangay: string })[]>([]);
  const [loading, setLoading] = useState(true);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'system' | 'driver' | 'dispatch' | 'report'>('all');

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    // 1. Listen to system override activity logs
    const logsRef = collection(db, 'system_settings', 'overrides', 'activity_logs');
    const qLogs = query(logsRef, orderBy('timestamp', 'desc'), limit(50));
    const unsubLogs = onSnapshot(
      qLogs,
      (snap) => {
        const fetched = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: `override-${d.id}`,
            timestamp: data.timestamp,
            source: data.source || 'Admin',
            action: data.action || 'System Override Event',
            category: 'system' as const,
            confidence: data.confidence || 'Manual',
            details: data.details || '',
          };
        });
        setOverrideLogs(fetched);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching activity_logs:', error);
        setLoading(false);
      }
    );

    // 2. Listen to client/driver operational activity logs
    const clientRef = collection(db, 'client_activity');
    const qClient = query(clientRef, orderBy('createdAt', 'desc'), limit(80));
    const unsubClient = onSnapshot(
      qClient,
      (snap) => {
        const fetched = snap.docs.map((d) => {
          const data = d.data();
          const evt = String(data.event || '');
          let cat: LogItem['category'] = 'other';
          if (evt.startsWith('pickup')) cat = 'driver';
          else if (evt.startsWith('route')) cat = 'dispatch';
          else if (evt.startsWith('report')) cat = 'report';
          else if (evt.startsWith('user') || evt.startsWith('override')) cat = 'system';
          else cat = 'driver';

          const actionLabel = evt
            .replace(/\./g, ' ')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());

          return {
            id: `client-${d.id}`,
            timestamp: data.createdAt,
            source: data.actorEmail || data.actorUid || 'Driver Terminal',
            action: actionLabel || 'Field Operation Event',
            category: cat,
            confidence: 'Verified',
            details: data.targetId ? `Target: ${data.targetId}` : (data.metadata?.targetEmail ? `Target: ${data.metadata.targetEmail}` : ''),
          };
        });
        setClientLogs(fetched);
      },
      (error) => {
        console.error('Error fetching client_activity:', error);
      }
    );

    // 3. Listen to Live Truck Locations and inventory
    let truckPlatesMap: Record<string, string> = {};
    const unsubTrucks = onSnapshot(collection(db, 'trucks'), (snap) => {
      const map: Record<string, string> = {};
      snap.forEach((d) => {
        const data = d.data();
        if (data.plateNumber) {
          map[d.id] = data.plateNumber;
        }
      });
      truckPlatesMap = map;
      setLiveTrucks((prev) =>
        prev.map((t) => ({
          ...t,
          label: truckPlatesMap[t.id] || truckPlatesMap[t.label] || t.label,
        }))
      );
    });

    const unsubLocations = onSnapshot(
      collection(db, 'truck_locations'),
      (snapshot) => {
        setLiveTrucks(
          snapshot.docs
            .map((item) => {
              const data = item.data();
              const rawTruckId = String(data.truckId || item.id);
              const plate = truckPlatesMap[rawTruckId] || truckPlatesMap[item.id] || rawTruckId;
              return {
                id: item.id,
                latitude: Number(data.lat ?? data.latitude),
                longitude: Number(data.lng ?? data.longitude),
                label: plate,
                active: String(data.status || '').toLowerCase() === 'active',
              };
            })
            .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
        );
      },
      (error) => console.error('Error fetching live truck locations:', error)
    );

    // 4. Listen to Reports
    const unsubReports = onSnapshot(
      collection(db, 'reports'),
      (snapshot) => {
        setOpenReports(
          snapshot.docs
            .map((item) => {
              const data = item.data();
              const location = data.location || {};
              return {
                id: item.id,
                latitude: Number(location.lat ?? location.latitude ?? data.lat ?? data.latitude),
                longitude: Number(location.lng ?? location.longitude ?? data.lng ?? data.longitude),
                label: String(data.title || data.barangay || 'Open report'),
                barangay: String(data.barangay || 'Unspecified'),
                status: String(data.status || 'pending'),
              };
            })
            .filter(
              (item) =>
                !['resolved', 'completed', 'done', 'rejected'].includes(item.status.toLowerCase()) &&
                Number.isFinite(item.latitude) &&
                Number.isFinite(item.longitude)
            )
        );
      },
      (error) => console.error('Error fetching report locations:', error)
    );

    return () => {
      unsubLogs();
      unsubClient();
      unsubTrucks();
      unsubLocations();
      unsubReports();
    };
  }, []);

  // Combine and sort logs
  const allLogs = useMemo(() => {
    const combined = [...overrideLogs, ...clientLogs];
    return combined.sort((a, b) => {
      const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp instanceof Date ? a.timestamp.getTime() : 0);
      const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp instanceof Date ? b.timestamp.getTime() : 0);
      return timeB - timeA;
    });
  }, [overrideLogs, clientLogs]);

  // Filter logs based on search query and category filter
  const filteredLogs = useMemo(() => {
    return allLogs.filter((log) => {
      if (categoryFilter !== 'all' && log.category !== categoryFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesSource = log.source.toLowerCase().includes(q);
        const matchesAction = log.action.toLowerCase().includes(q);
        const matchesDetails = (log.details || '').toLowerCase().includes(q);
        return matchesSource || matchesAction || matchesDetails;
      }
      return true;
    });
  }, [allLogs, categoryFilter, searchQuery]);

  const riskHotspots = useMemo(() => {
    const counts = openReports.reduce<Record<string, number>>((result, report) => {
      result[report.barangay] = (result[report.barangay] || 0) + 1;
      return result;
    }, {});
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [openReports]);

  const [isExportModalVisible, setIsExportModalVisible] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    const headers = [
      'Timestamp',
      'Category',
      'Source',
      'Action',
      'Details',
      'Telemetry / Confidence',
    ];
    const rows = filteredLogs.map((row) => [
      row.timestamp?.toDate ? row.timestamp.toDate().toLocaleString('en-US') : 'N/A',
      row.category.toUpperCase(),
      row.source,
      row.action,
      row.details || '',
      row.confidence || 'Logged',
    ]);

    await exportReport({
      format,
      filename: `trashtrack_operational_logs_${new Date().toISOString().slice(0, 10)}`,
      title: 'Municipal Operations & Telemetry Audit Log',
      subtitle: 'City Environment & Natural Resources Office Real-time Telemetry & Audit Ledger',
      jurisdiction: 'City of Danao (All Operations)',
      generatedBy: 'CENRO Audit Officer',
      headers,
      rows,
      summaryCards: [
        { label: 'Total Events', value: filteredLogs.length },
        { label: 'Category Filter', value: categoryFilter.toUpperCase() },
        { label: 'Search Filter', value: searchQuery || 'All' },
      ],
      sheetName: 'Activity_Logs',
    });
  };

  const getCategoryBadge = (category: LogItem['category']) => {
    switch (category) {
      case 'system':
        return { label: 'SYSTEM', bg: '#FEF3C7', color: '#B45309', icon: 'settings' };
      case 'driver':
        return { label: 'DRIVER', bg: '#DCFCE7', color: '#15803D', icon: 'local-shipping' };
      case 'dispatch':
        return { label: 'DISPATCH', bg: '#E0E7FF', color: '#4338CA', icon: 'alt-route' };
      case 'report':
        return { label: 'REPORT', bg: '#FEE2E2', color: '#B91C1C', icon: 'report-problem' };
      default:
        return { label: 'LOG', bg: '#F1F5F9', color: '#475569', icon: 'info' };
    }
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return '--:--';
    try {
      const date = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Just now';
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#1B4D3E" />
        <Text style={{ marginTop: 12, color: '#6B7280', fontSize: 13, fontWeight: '600' }}>Loading activity logs...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, isMobile && { padding: 16 }]} showsVerticalScrollIndicator={false}>
      {/* Header Row */}
      <View style={[styles.headerRow, isMobile && { flexDirection: 'column', gap: 12, marginBottom: 16 }]}>
        <View style={[styles.headerTextContainer, isMobile && { paddingRight: 0 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Text style={styles.headerTitle}>System & Operational Logs</Text>
            <View style={styles.readOnlyBadge}>
              <MaterialIcons name="history" size={12} color="#047857" />
              <Text style={styles.readOnlyBadgeText}>AUDIT LEDGER</Text>
            </View>
          </View>
          <Text style={styles.headerDesc}>
            Real-time, comprehensive audit trail of municipal collection telemetry, driver completions, route dispatches, and administrative events.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.exportTopBtn}
          onPress={() => setIsExportModalVisible(true)}
          activeOpacity={0.8}
        >
          <MaterialIcons name="file-download" size={18} color="#FFFFFF" />
          <Text style={styles.exportTopBtnText}>Export Logs</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.mainRow, isMobile && { flexDirection: 'column', gap: 20 }]}>
        {/* Left Column: Filterable Activity Logs */}
        <View style={[styles.leftColumn, isMobile && { flex: undefined, width: '100%' }]}>
          {/* Activity Log Section with Search & Filters */}
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="history" size={18} color="#1B4D3E" />
              <Text style={styles.sectionTitle}>Activity & Telemetry Log</Text>
            </View>
            <Text style={styles.sectionCount}>
              {filteredLogs.length} OF {allLogs.length} LOGS
            </Text>
          </View>

          {/* Search Input Bar */}
          <View style={styles.searchBar}>
            <MaterialIcons name="search" size={18} color="#94A3B8" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search logs by actor, action, or target..."
              placeholderTextColor="#94A3B8"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <MaterialIcons name="close" size={16} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Category Filter Pills */}
          <ScrollView
            horizontal={true}
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 0, height: 42 }}
            contentContainerStyle={styles.filterPillsRow}
          >
            {[
              { key: 'all', label: 'All Logs' },
              { key: 'system', label: 'System & Overrides' },
              { key: 'driver', label: 'Driver Operations' },
              { key: 'dispatch', label: 'Route Dispatches' },
              { key: 'report', label: 'Citizen Reports' },
            ].map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.filterPill,
                  categoryFilter === item.key && styles.filterPillActive,
                ]}
                onPress={() => setCategoryFilter(item.key as any)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    categoryFilter === item.key && styles.filterPillTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Logs Table Card */}
          <View style={styles.logCard}>
            <View style={styles.tableHead}>
              <Text style={[styles.th, { flex: 1.2 }]}>TIMESTAMP</Text>
              <Text style={[styles.th, { flex: 0.9 }]}>CATEGORY</Text>
              <Text style={[styles.th, { flex: 1.4 }]}>SOURCE / ACTOR</Text>
              <Text style={[styles.th, { flex: 2 }]}>EVENT ACTION</Text>
              <Text style={[styles.th, { flex: 0.8, textAlign: 'right' }]}>STATUS</Text>
            </View>

            {filteredLogs.length === 0 ? (
              <View style={styles.emptyLogsContainer}>
                <MaterialIcons name="filter-list-off" size={32} color="#CBD5E1" />
                <Text style={styles.emptyLogsText}>No activity logs match your filter criteria.</Text>
              </View>
            ) : (
              filteredLogs.map((row) => {
                const badge = getCategoryBadge(row.category);
                return (
                  <View key={row.id} style={styles.tableRow}>
                    <Text style={[styles.td, { flex: 1.2, color: '#64748B', fontSize: 11 }]}>
                      {formatTimestamp(row.timestamp)}
                    </Text>

                    <View style={{ flex: 0.9, justifyContent: 'center' }}>
                      <View style={[styles.categoryBadge, { backgroundColor: badge.bg }]}>
                        <Text style={[styles.categoryBadgeText, { color: badge.color }]}>
                          {badge.label}
                        </Text>
                      </View>
                    </View>

                    <Text
                      style={[styles.td, { flex: 1.4, color: '#334155', fontWeight: '600' }]}
                      numberOfLines={1}
                    >
                      {row.source}
                    </Text>

                    <View style={{ flex: 2, paddingRight: 4 }}>
                      <Text style={[styles.td, { color: '#0F172A', fontWeight: '600' }]} numberOfLines={1}>
                        {row.action}
                      </Text>
                      {Boolean(row.details) && (
                        <Text style={{ fontSize: 10, color: '#64748B' }} numberOfLines={1}>
                          {row.details}
                        </Text>
                      )}
                    </View>

                    <View style={{ flex: 0.8, alignItems: 'flex-end', justifyContent: 'center' }}>
                      <View style={styles.verifiedRow}>
                        <MaterialIcons name="check" size={11} color="#059669" />
                        <Text style={styles.verifiedText}>Logged</Text>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>

        {/* Right Column: Live Operations Telemetry Map */}
        <View style={[styles.rightColumn, isMobile && { flex: undefined, width: '100%' }]}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="map" size={18} color="#1B4D3E" />
              <Text style={styles.sectionTitle}>Live Telemetry Map</Text>
            </View>
            <Text style={styles.sectionCount}>
              {openReports.length} OPEN REPORT{openReports.length === 1 ? '' : 'S'}
            </Text>
          </View>

          <View style={styles.mapContainer}>
            <LiveOperationsMap trucks={liveTrucks} reports={openReports} />

            <View style={styles.mapBadge}>
              <View style={styles.pulsingDot} />
              <Text style={styles.mapBadgeText}>
                {liveTrucks.filter((item) => item.active).length} ACTIVE TRUCK
                {liveTrucks.filter((item) => item.active).length === 1 ? '' : 'S'}
              </Text>
            </View>

            {/* Risk Hotspots Overlay */}
            <View style={styles.riskCard}>
              <Text style={styles.riskTitle}>GEOTAGGED RISK HOTSPOTS</Text>
              {riskHotspots.length === 0 ? (
                <Text style={styles.noRisk}>No unresolved geotagged reports.</Text>
              ) : (
                riskHotspots.map(([barangay, count]) => (
                  <View style={styles.riskRow} key={barangay}>
                    <Text style={styles.riskBrgy}>{barangay}</Text>
                    <Text style={count >= 4 ? styles.riskHigh : styles.riskModerate}>
                      {count} OPEN · {count >= 4 ? 'HIGH' : 'MONITOR'}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Export Report Modal */}
      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="Municipal Operations & Telemetry Log"
        dataCount={filteredLogs.length}
        onExport={handleExport}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerTextContainer: {
    flex: 1,
    paddingRight: 24,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  headerDesc: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 20,
    maxWidth: 700,
  },
  readOnlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  readOnlyBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.5,
  },
  exportTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1B4D3E',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    shadowColor: '#1B4D3E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  exportTopBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    paddingBottom: 40,
  },
  leftColumn: {
    flex: 1.4,
    gap: 12,
    alignSelf: 'flex-start',
    width: '100%',
  },
  rightColumn: {
    flex: 1,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  sectionCount: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    color: '#0F172A',
    padding: 0,
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
    alignSelf: 'center',
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
  logCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  tableHead: {
    flexDirection: 'row',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 4,
  },
  th: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  td: {
    fontSize: 12,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  verifiedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
  },
  emptyLogsContainer: {
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyLogsText: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
  },
  mapContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    minHeight: 520,
    overflow: 'hidden',
    position: 'relative',
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  mapBadge: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  pulsingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
  },
  mapBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1E293B',
    letterSpacing: 0.5,
  },
  riskCard: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  riskTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  riskRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  riskBrgy: {
    fontSize: 13,
    color: '#1E293B',
    fontWeight: '600',
  },
  riskHigh: {
    fontSize: 11,
    fontWeight: '800',
    color: '#EF4444',
  },
  riskModerate: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  noRisk: {
    color: '#94A3B8',
    fontSize: 12,
  },
});
