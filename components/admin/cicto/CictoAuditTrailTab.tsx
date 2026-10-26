import { MaterialIcons } from '@expo/vector-icons';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { db } from '@/config/firebase';
import ExportModal from '../cenro/ExportModal';
import { exportReport, ExportFormat } from '@/services/reportExportService';

export interface AuditLogEntry {
  id: string;
  timestamp: string | number;
  timestampMs: number;
  actorEmail: string;
  actorUid?: string;
  action: string;
  category: 'security' | 'fleet' | 'dispatch' | 'report' | 'system' | 'error' | 'rewards';
  severity?: 'info' | 'warn' | 'error' | 'critical';
  details?: string;
  ipAddress?: string;
  deviceInfo?: string;
  metadata?: Record<string, any>;
  rawDoc?: any;
}

export function formatAuditDetails(rawDetails: any, metadata: any, action = ''): string {
  let parsed: any = null;

  // Try parsing rawDetails if it's a JSON string
  if (typeof rawDetails === 'string') {
    const trimmed = rawDetails.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = null;
      }
    } else if (trimmed.length > 0) {
      return trimmed;
    }
  } else if (rawDetails && typeof rawDetails === 'object') {
    parsed = rawDetails;
  }

  // If no details parsed, fallback to metadata
  if (!parsed && metadata && typeof metadata === 'object') {
    parsed = metadata;
  }

  if (parsed && typeof parsed === 'object') {
    // 1. System Overrides (label, setting, value, reason)
    if (parsed.label) {
      const reasonPart = parsed.reason ? ` · Reason: ${parsed.reason}` : '';
      return `${parsed.label}${reasonPart}`;
    }
    if (parsed.setting) {
      const settingName = String(parsed.setting)
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .trim();
      const capSetting = settingName.charAt(0).toUpperCase() + settingName.slice(1);
      const valText = typeof parsed.value === 'boolean' ? (parsed.value ? 'Enabled' : 'Deactivated') : parsed.value;
      const reasonPart = parsed.reason ? ` · Reason: ${parsed.reason}` : '';
      return `${capSetting}: ${valText}${reasonPart}`;
    }

    // 2. Emergency Broadcast (subject, priority, message)
    if (parsed.subject || parsed.message) {
      const parts: string[] = [];
      if (parsed.subject) parts.push(`"${parsed.subject}"`);
      if (parsed.message && parsed.message !== parsed.subject) parts.push(parsed.message);
      if (parsed.priority) {
        const p = String(parsed.priority).toUpperCase();
        parts.push(`Priority: ${p}`);
      }
      if (parts.length > 0) return parts.join(' · ');
    }

    // 3. Reports & Reassignments
    if (parsed.reportId || parsed.street || parsed.barangay) {
      const loc = [parsed.street, parsed.barangay ? `Brgy. ${parsed.barangay}` : '']
        .filter(Boolean)
        .join(', ');
      const statusPart = parsed.status ? ` · Status: ${parsed.status}` : '';
      const reasonPart = parsed.reason ? ` · ${parsed.reason}` : '';
      if (loc) return `Report at ${loc}${statusPart}${reasonPart}`;
    }

    // 4. Driver / Vehicle / Fleet operations
    if (parsed.driverName || parsed.plateNumber || parsed.truck) {
      const parts: string[] = [];
      if (parsed.driverName) parts.push(`Driver: ${parsed.driverName}`);
      if (parsed.plateNumber || parsed.truck) parts.push(`Truck: ${parsed.plateNumber || parsed.truck}`);
      if (parsed.assignedBarangay || parsed.barangay) parts.push(`Brgy. ${parsed.assignedBarangay || parsed.barangay}`);
      if (parsed.reason) parts.push(`Reason: ${parsed.reason}`);
      if (parts.length > 0) return parts.join(' · ');
    }

    // 5. General message / description property
    if (parsed.description) return String(parsed.description);
    if (parsed.message) return String(parsed.message);
    if (parsed.error || parsed.errorMessage) return `Error: ${parsed.error || parsed.errorMessage}`;

    // 6. Generic Object formatting: key-value pairs without JSON syntax
    const ignoredKeys = new Set(['rawDoc', 'createdAt', 'updatedAt', 'timestamp', 'actorUid', 'id', '_id']);
    const entries = Object.entries(parsed)
      .filter(([k, v]) => !ignoredKeys.has(k) && v !== null && v !== undefined && v !== '')
      .map(([k, v]) => {
        const readableKey = k.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').trim();
        const capKey = readableKey.charAt(0).toUpperCase() + readableKey.slice(1);
        if (typeof v === 'object') return `${capKey}: [Data]`;
        return `${capKey}: ${v}`;
      });

    if (entries.length > 0) {
      return entries.join(' · ');
    }
  }

  return '—';
}

function getPageNumbers(currentPage: number, totalPages: number): (number | string)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, '...', totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
}

export default function CictoAuditTrailTab() {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | '7d'>('all');
  const [isExportModalVisible, setIsExportModalVisible] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    const mapLogs = (docs: any[]): AuditLogEntry[] => {
      return docs.map((docSnap) => {
        const data = docSnap.data();
        const evt = String(data.event || data.action || 'system.event');
        let cat: AuditLogEntry['category'] = 'system';
        if (data.type === 'error' || evt.includes('error') || evt.includes('fail')) cat = 'error';
        else if (data.type === 'security' || evt.includes('login') || evt.includes('auth') || evt.includes('role') || evt.includes('user')) cat = 'security';
        else if (evt.includes('fleet') || evt.includes('truck') || evt.includes('gps') || evt.includes('location')) cat = 'fleet';
        else if (evt.includes('dispatch') || evt.includes('route') || evt.includes('schedule')) cat = 'dispatch';
        else if (evt.includes('report') || evt.includes('waste')) cat = 'report';
        else if (evt.includes('reward') || evt.includes('redeem')) cat = 'rewards';

        const rawTime = data.createdAt || data.timestamp;
        let tsMs = Date.now();
        if (rawTime?.toMillis) tsMs = rawTime.toMillis();
        else if (rawTime?.toDate) tsMs = rawTime.toDate().getTime();
        else if (typeof rawTime === 'number') tsMs = rawTime;
        else if (typeof rawTime === 'string') tsMs = new Date(rawTime).getTime() || Date.now();

        const formattedDetails = formatAuditDetails(
          data.description || data.details,
          data.metadata,
          data.action || evt
        );

        const cleanAction = data.action || evt
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/[._]/g, ' ')
          .toUpperCase();

        return {
          id: docSnap.id,
          timestamp: new Date(tsMs).toLocaleString(),
          timestampMs: tsMs,
          actorEmail: data.userEmail || data.actorEmail || data.actorUid || 'System Service',
          actorUid: data.actorUid || data.userId || data.targetId,
          action: cleanAction,
          category: cat,
          severity: data.severity || (cat === 'error' ? 'error' : cat === 'security' ? 'warn' : 'info'),
          details: formattedDetails,
          metadata: data.metadata || data,
          rawDoc: data,
        };
      });
    };

    let auditMap = new Map<string, AuditLogEntry>();
    let clientMap = new Map<string, AuditLogEntry>();

    const updateAllLogs = () => {
      const combined = new Map([...clientMap, ...auditMap]);
      const list = Array.from(combined.values()).sort((a, b) => b.timestampMs - a.timestampMs);
      setLogs(list);
      setLoading(false);
    };

    const auditQuery = query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(150));
    const unsubAudit = onSnapshot(auditQuery, (snap) => {
      auditMap.clear();
      mapLogs(snap.docs).forEach(item => auditMap.set(item.id, item));
      updateAllLogs();
    }, (err) => {
      console.warn('Audit logs listener error:', err);
      setLoading(false);
    });

    const clientQuery = query(collection(db, 'client_activity'), orderBy('createdAt', 'desc'), limit(150));
    const unsubClient = onSnapshot(clientQuery, (snap) => {
      clientMap.clear();
      mapLogs(snap.docs).forEach(item => clientMap.set(item.id, item));
      updateAllLogs();
    }, (err) => {
      console.warn('Client activity listener error:', err);
      setLoading(false);
    });

    return () => {
      unsubAudit();
      unsubClient();
    };
  }, []);

  // Filter logs
  const filteredLogs = useMemo(() => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDays = 7 * oneDay;

    return logs.filter((log) => {
      // Category filter
      if (selectedCategory !== 'all' && log.category !== selectedCategory) {
        return false;
      }

      // Time filter
      if (timeFilter === 'today' && now - log.timestampMs > oneDay) return false;
      if (timeFilter === '7d' && now - log.timestampMs > sevenDays) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchAction = log.action.toLowerCase().includes(q);
        const matchActor = log.actorEmail.toLowerCase().includes(q);
        const matchDetails = (log.details || '').toLowerCase().includes(q);
        const matchId = log.id.toLowerCase().includes(q);
        if (!matchAction && !matchActor && !matchDetails && !matchId) return false;
      }

      return true;
    });
  }, [logs, selectedCategory, timeFilter, searchQuery]);

  // Reset pagination to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCategory, timeFilter, searchQuery, itemsPerPage]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / itemsPerPage));

  // Keep currentPage bounded if totalPages shrinks
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredLogs.slice(start, start + itemsPerPage);
  }, [filteredLogs, currentPage, itemsPerPage]);

  // Statistics calculation
  const stats = useMemo(() => {
    const total = logs.length;
    const securityCount = logs.filter((l) => l.category === 'security').length;
    const fleetCount = logs.filter((l) => l.category === 'fleet').length;
    const dispatchCount = logs.filter((l) => l.category === 'dispatch').length;
    const errorCount = logs.filter((l) => l.category === 'error').length;
    return { total, securityCount, fleetCount, dispatchCount, errorCount };
  }, [logs]);

  const getCategoryBadgeStyle = (cat: AuditLogEntry['category']) => {
    switch (cat) {
      case 'security':
        return { bg: '#FDF2F8', text: '#9D174D', border: '#FBCFE8', icon: 'shield' };
      case 'fleet':
        return { bg: '#ECFDF5', text: '#065F46', border: '#A7F3D0', icon: 'local-shipping' };
      case 'dispatch':
        return { bg: '#EFF6FF', text: '#1E40AF', border: '#BFDBFE', icon: 'alt-route' };
      case 'report':
        return { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A', icon: 'report-problem' };
      case 'rewards':
        return { bg: '#FAF5FF', text: '#6B21A8', border: '#E9D5FF', icon: 'stars' };
      case 'error':
        return { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA', icon: 'error' };
      default:
        return { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1', icon: 'info' };
    }
  };

  const categories = [
    { id: 'all', label: 'All Events' },
    { id: 'security', label: 'Security & Auth' },
    { id: 'fleet', label: 'Fleet Telemetry' },
    { id: 'dispatch', label: 'Route Dispatch' },
    { id: 'report', label: 'Reports & Waste' },
    { id: 'rewards', label: 'Rewards' },
    { id: 'error', label: 'Errors & Alerts' },
  ];

  if (loading) {
    return (
      <View style={styles.centerLoading}>
        <ActivityIndicator size="large" color="#0D9488" />
        <Text style={styles.loadingText}>Fetching Immutable Audit Trail…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, isMobile && { padding: 14 }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>CICTO / SECURITY & COMPLIANCE</Text>
          <Text style={styles.title}>System Audit Trail</Text>
          <Text style={styles.subtitle}>
            Immutable forensic activity logs, security auth telemetry, and operational audit records.
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity
            style={styles.exportTopBtn}
            onPress={() => setIsExportModalVisible(true)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="file-download" size={16} color="#0D9488" />
            <Text style={styles.exportTopBtnText}>Export Audit Trail</Text>
          </TouchableOpacity>
          <View style={styles.liveIndicator}>
            <View style={styles.pulseDot} />
            <Text style={styles.liveText}>REAL-TIME LOG STREAM</Text>
          </View>
        </View>
      </View>

      {/* KPI Overview */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>TOTAL LOGGED EVENTS</Text>
          <Text style={styles.kpiValue}>{stats.total}</Text>
          <Text style={styles.kpiSub}>Persisted in immutable audit store</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiLabel, { color: '#9D174D' }]}>SECURITY & ACCESS</Text>
          <Text style={[styles.kpiValue, { color: '#9D174D' }]}>{stats.securityCount}</Text>
          <Text style={styles.kpiSub}>Auth logins, role updates & grants</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiLabel, { color: '#059669' }]}>FLEET TELEMETRY</Text>
          <Text style={[styles.kpiValue, { color: '#059669' }]}>{stats.fleetCount}</Text>
          <Text style={styles.kpiSub}>GPS points, trip starts & pickups</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiLabel, { color: '#2563EB' }]}>DISPATCH & AI ROUTING</Text>
          <Text style={[styles.kpiValue, { color: '#2563EB' }]}>{stats.dispatchCount}</Text>
          <Text style={styles.kpiSub}>Auto-dispatch & route optimization</Text>
        </View>
      </View>

      {/* Filter & Search Bar */}
      <View style={styles.filterCard}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <MaterialIcons name="search" size={20} color="#64748B" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by Actor Email, Action, Details, or Event ID…"
              placeholderTextColor="#94A3B8"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {!!searchQuery && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <MaterialIcons name="close" size={18} color="#64748B" />
              </TouchableOpacity>
            )}
          </View>

          {/* Time Filter Buttons */}
          <View style={styles.timeFilterGroup}>
            <TouchableOpacity
              style={[styles.timeBtn, timeFilter === 'all' && styles.timeBtnActive]}
              onPress={() => setTimeFilter('all')}
            >
              <Text style={[styles.timeBtnText, timeFilter === 'all' && styles.timeBtnTextActive]}>All Time</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.timeBtn, timeFilter === '7d' && styles.timeBtnActive]}
              onPress={() => setTimeFilter('7d')}
            >
              <Text style={[styles.timeBtnText, timeFilter === '7d' && styles.timeBtnTextActive]}>Past 7 Days</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.timeBtn, timeFilter === 'today' && styles.timeBtnActive]}
              onPress={() => setTimeFilter('today')}
            >
              <Text style={[styles.timeBtnText, timeFilter === 'today' && styles.timeBtnTextActive]}>Today Only</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Category Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryPills}>
          {categories.map((c) => {
            const isActive = selectedCategory === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.categoryPill, isActive && styles.categoryPillActive]}
                onPress={() => setSelectedCategory(c.id)}
              >
                <Text style={[styles.categoryPillText, isActive && styles.categoryPillTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Log Feed Table */}
      <View style={styles.logTableCard}>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { width: 150 }]}>TIMESTAMP</Text>
          <Text style={[styles.th, { width: 130 }]}>CATEGORY</Text>
          <Text style={[styles.th, { flex: 1.2 }]}>ACTION / EVENT</Text>
          <Text style={[styles.th, { flex: 1 }]}>ACTOR / SOURCE</Text>
          <Text style={[styles.th, { flex: 1.5 }]}>DETAILS</Text>
          <Text style={[styles.th, { width: 70, textAlign: 'center' }]}>INSPECT</Text>
        </View>

        {filteredLogs.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="find-in-page" size={40} color="#94A3B8" />
            <Text style={styles.emptyStateTitle}>No matching audit logs found</Text>
            <Text style={styles.emptyStateSub}>Try clearing search filters or changing the category.</Text>
          </View>
        ) : (
          paginatedLogs.map((item) => {
            const badge = getCategoryBadgeStyle(item.category);
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.tableRow}
                onPress={() => setSelectedLog(item)}
                activeOpacity={0.7}
              >
                <Text style={[styles.tdTime, { width: 150 }]}>{item.timestamp}</Text>
                <View style={{ width: 130 }}>
                  <View style={[styles.categoryBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
                    <MaterialIcons name={badge.icon as any} size={12} color={badge.text} style={{ marginRight: 4 }} />
                    <Text style={[styles.categoryBadgeText, { color: badge.text }]}>
                      {item.category.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.tdAction, { flex: 1.2 }]} numberOfLines={1}>
                  {item.action}
                </Text>
                <Text style={[styles.tdActor, { flex: 1 }]} numberOfLines={1}>
                  {item.actorEmail}
                </Text>
                <Text
                  style={[styles.tdDetails, { flex: 1.5 }]}
                  numberOfLines={1}
                  {...(Platform.OS === 'web' ? ({ title: item.details } as any) : {})}
                >
                  {item.details || '—'}
                </Text>
                <View style={{ width: 70, alignItems: 'center' }}>
                  <View style={styles.inspectBtn}>
                    <MaterialIcons name="code" size={15} color="#0D9488" />
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        {/* Pagination Footer */}
        {filteredLogs.length > 0 && (
          <View style={styles.paginationCard}>
            <View style={styles.paginationInfoWrap}>
              <Text style={styles.paginationInfo}>
                Showing{' '}
                <Text style={styles.paginationInfoBold}>
                  {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredLogs.length)}
                </Text>{' '}
                of <Text style={styles.paginationInfoBold}>{filteredLogs.length}</Text> events
              </Text>

              {/* Rows Per Page Selector */}
              <View style={styles.pageSizeSelector}>
                <Text style={styles.pageSizeLabel}>Rows:</Text>
                {[10, 20, 50].map((size) => (
                  <TouchableOpacity
                    key={size}
                    style={[styles.pageSizeBtn, itemsPerPage === size && styles.pageSizeBtnActive]}
                    onPress={() => {
                      setItemsPerPage(size);
                      setCurrentPage(1);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pageSizeBtnText, itemsPerPage === size && styles.pageSizeBtnTextActive]}>
                      {size}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {totalPages > 1 && (
              <View style={styles.paginationNav}>
                {/* Prev Button */}
                <TouchableOpacity
                  style={[styles.pageNavBtn, currentPage === 1 && styles.pageNavBtnDisabled]}
                  disabled={currentPage === 1}
                  onPress={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="chevron-left" size={18} color={currentPage === 1 ? '#CBD5E1' : '#0F766E'} />
                  <Text style={[styles.pageNavBtnText, currentPage === 1 && styles.pageNavBtnTextDisabled]}>
                    Prev
                  </Text>
                </TouchableOpacity>

                {/* Page Number Group */}
                <View style={styles.pageNumberGroup}>
                  {getPageNumbers(currentPage, totalPages).map((item, idx) => {
                    if (item === '...') {
                      return (
                        <View key={`ellipsis-${idx}`} style={styles.ellipsisWrap}>
                          <Text style={styles.ellipsisText}>…</Text>
                        </View>
                      );
                    }
                    const pageNum = Number(item);
                    const isActive = pageNum === currentPage;
                    return (
                      <TouchableOpacity
                        key={pageNum}
                        style={[styles.pageNumBtn, isActive && styles.pageNumBtnActive]}
                        onPress={() => setCurrentPage(pageNum)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.pageNumText, isActive && styles.pageNumTextActive]}>
                          {pageNum}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Next Button */}
                <TouchableOpacity
                  style={[styles.pageNavBtn, currentPage === totalPages && styles.pageNavBtnDisabled]}
                  disabled={currentPage === totalPages}
                  onPress={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pageNavBtnText, currentPage === totalPages && styles.pageNavBtnTextDisabled]}>
                    Next
                  </Text>
                  <MaterialIcons name="chevron-right" size={18} color={currentPage === totalPages ? '#CBD5E1' : '#0F766E'} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Raw Event Detail Modal */}
      <Modal visible={!!selectedLog} transparent animationType="fade" onRequestClose={() => setSelectedLog(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, isMobile && { width: '94%' }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="receipt-long" size={22} color="#0D9488" />
                <Text style={styles.modalTitle}>Audit Event Details</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedLog(null)} style={styles.closeBtn}>
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {!!selectedLog && (
              <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                <View style={styles.metaGrid}>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaKey}>Event ID</Text>
                    <Text style={styles.metaVal}>{selectedLog.id}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaKey}>Timestamp</Text>
                    <Text style={styles.metaVal}>{selectedLog.timestamp}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaKey}>Actor / Principal</Text>
                    <Text style={styles.metaVal}>{selectedLog.actorEmail}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaKey}>Action</Text>
                    <Text style={styles.metaVal}>{selectedLog.action}</Text>
                  </View>
                  <View style={[styles.metaItem, { minWidth: '95%' }]}>
                    <Text style={styles.metaKey}>Summary / Details</Text>
                    <Text style={[styles.metaVal, { color: '#0F766E', fontSize: 13 }]}>{selectedLog.details || '—'}</Text>
                  </View>
                </View>

                <Text style={styles.jsonSectionTitle}>RAW AUDIT JSON DATA</Text>
                <View style={styles.jsonBox}>
                  <Text style={styles.jsonText}>
                    {JSON.stringify(selectedLog.rawDoc || selectedLog, null, 2)}
                  </Text>
                </View>
              </ScrollView>
            )}

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setSelectedLog(null)}>
                <Text style={styles.modalCloseButtonText}>Close Inspector</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Audit Trail Export Modal */}
      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="CICTO Security & Infrastructure Audit Trail"
        dataCount={filteredLogs.length}
        onExport={async (format: ExportFormat) => {
          const headers = ['Timestamp', 'Actor / Principal', 'Action / Event', 'Category', 'Severity', 'Details'];
          const rows = filteredLogs.map((log) => [
            typeof log.timestamp === 'number'
              ? new Date(log.timestamp).toLocaleString('en-US')
              : String(log.timestamp || 'N/A'),
            log.actorEmail || 'System Agent',
            log.action,
            log.category.toUpperCase(),
            (log.severity || 'info').toUpperCase(),
            log.details || '',
          ]);

          await exportReport({
            format,
            filename: `cicto_audit_trail_${new Date().toISOString().slice(0, 10)}`,
            title: 'CICTO Security & Infrastructure Audit Trail',
            subtitle: 'City Information & Communications Technology Office Official Audit Register',
            jurisdiction: 'Danao City Enterprise System',
            generatedBy: 'CICTO Security Administrator',
            headers,
            rows,
            summaryCards: [
              { label: 'Total Events', value: filteredLogs.length },
              { label: 'Security Events', value: stats.securityCount },
              { label: 'Fleet Telemetry', value: stats.fleetCount },
              { label: 'Dispatch Events', value: stats.dispatchCount },
            ],
            sheetName: 'Audit_Trail',
          });
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 28 },
  centerLoading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  loadingText: { color: '#64748B', marginTop: 10, fontSize: 13, fontWeight: '600' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  eyebrow: { fontSize: 10, fontWeight: '900', color: '#0D9488', letterSpacing: 1.1 },
  title: { fontSize: 26, fontWeight: '900', color: '#0F172A', marginTop: 4 },
  subtitle: { fontSize: 12, color: '#64748B', marginTop: 4 },
  exportTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#99F6E4',
    backgroundColor: '#F0FDFA',
  },
  exportTopBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F766E',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pulseDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#10B981' },
  liveText: { fontSize: 9.5, fontWeight: '900', color: '#065F46', letterSpacing: 0.6 },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  kpiCard: {
    flex: 1,
    minWidth: 180,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  kpiLabel: { fontSize: 9.5, fontWeight: '900', color: '#64748B', letterSpacing: 0.8 },
  kpiValue: { fontSize: 26, fontWeight: '900', color: '#0F172A', marginVertical: 4 },
  kpiSub: { fontSize: 10.5, color: '#64748B' },
  filterCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  searchBox: {
    flex: 1,
    minWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 40,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 12, color: '#0F172A' },
  timeFilterGroup: { flexDirection: 'row', gap: 6 },
  timeBtn: {
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBtnActive: { backgroundColor: '#0D9488', borderColor: '#0F766E' },
  timeBtnText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  timeBtnTextActive: { color: '#FFFFFF' },
  categoryPills: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  categoryPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  categoryPillActive: { backgroundColor: '#0D9488', borderColor: '#0F766E' },
  categoryPillText: { fontSize: 11.5, fontWeight: '700', color: '#475569' },
  categoryPillTextActive: { color: '#FFFFFF' },
  logTableCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  th: { fontSize: 9.5, fontWeight: '900', color: '#64748B', letterSpacing: 0.7 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  tdTime: { fontSize: 10.5, color: '#64748B', fontWeight: '600' },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  categoryBadgeText: { fontSize: 9, fontWeight: '900' },
  tdAction: { fontSize: 11.5, fontWeight: '800', color: '#0F172A', paddingRight: 8 },
  tdActor: { fontSize: 11, color: '#475569', paddingRight: 8 },
  tdDetails: { fontSize: 11, color: '#64748B', paddingRight: 8 },
  inspectBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: { padding: 40, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyStateTitle: { fontSize: 14, fontWeight: '800', color: '#334155' },
  emptyStateSub: { fontSize: 12, color: '#64748B' },
  paginationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexWrap: 'wrap',
    gap: 12,
  },
  paginationInfoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  paginationInfo: {
    fontSize: 12,
    color: '#64748B',
  },
  paginationInfoBold: {
    fontWeight: '700',
    color: '#0F172A',
  },
  pageSizeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pageSizeLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  pageSizeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  pageSizeBtnActive: {
    backgroundColor: '#F0FDFA',
    borderColor: '#0D9488',
  },
  pageSizeBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  pageSizeBtnTextActive: {
    color: '#0F766E',
    fontWeight: '800',
  },
  paginationNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pageNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    gap: 4,
  },
  pageNavBtnDisabled: {
    opacity: 0.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  pageNavBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F766E',
  },
  pageNavBtnTextDisabled: {
    color: '#94A3B8',
  },
  pageNumberGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pageNumBtn: {
    minWidth: 32,
    height: 32,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNumBtnActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0F766E',
  },
  pageNumText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  pageNumTextActive: {
    color: '#FFFFFF',
  },
  ellipsisWrap: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ellipsisText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '700',
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.65)', justifyContent: 'center', alignItems: 'center' },
  modalCard: {
    width: 600,
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 16, fontWeight: '900', color: '#0F172A' },
  closeBtn: { padding: 4 },
  modalBody: { flex: 1 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  metaItem: { flex: 1, minWidth: '45%', backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8 },
  metaKey: { fontSize: 9.5, fontWeight: '900', color: '#64748B', letterSpacing: 0.6 },
  metaVal: { fontSize: 11.5, fontWeight: '700', color: '#0F172A', marginTop: 2 },
  jsonSectionTitle: { fontSize: 10, fontWeight: '900', color: '#475569', letterSpacing: 0.8, marginBottom: 6 },
  jsonBox: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    maxHeight: 220,
    overflow: 'hidden',
  },
  jsonText: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10.5, color: '#38BDF8' },
  modalFooter: { marginTop: 16, alignItems: 'flex-end' },
  modalCloseButton: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalCloseButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
