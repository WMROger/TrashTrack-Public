import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, query, orderBy, limit, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';

export interface AdminNotificationItem {
  id: string;
  type: 'report' | 'dispatch' | 'driver' | 'system' | 'override';
  title: string;
  subtitle: string;
  timestamp: any;
  targetTab: string;
  isRead?: boolean;
}

interface AdminNotificationDropdownProps {
  visible: boolean;
  onClose: () => void;
  onNavigateTab: (tabKey: string) => void;
  onUnreadCountChange?: (count: number) => void;
}

const READ_STORAGE_KEY = '@cenro_notif_read_ids';

const TAB_ALIAS_MAP: Record<string, string> = {
  'reports': 'trash-reports',
  'trash-reports': 'trash-reports',
  'routes': 'route-optimization',
  'route-optimization': 'route-optimization',
  'fleet': 'fleet-monitoring',
  'fleet-monitoring': 'fleet-monitoring',
  'overrides': 'operational-overrides',
  'operational-overrides': 'operational-overrides',
  'logs': 'logs',
  'scheduler': 'collection-scheduler',
  'collection-scheduler': 'collection-scheduler',
  'inventory': 'truck-inventory',
  'truck-inventory': 'truck-inventory',
  'drivers': 'driver-accounts',
  'driver-accounts': 'driver-accounts',
  'feedback': 'service-feedback',
  'service-feedback': 'service-feedback',
  'announcements': 'announcements',
  'dashboard': 'dashboard',
};

export default function AdminNotificationDropdown({
  visible,
  onClose,
  onNavigateTab,
  onUnreadCountChange,
}: AdminNotificationDropdownProps) {
  const [notifications, setNotifications] = useState<AdminNotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const readIdsRef = useRef<Set<string>>(new Set());
  readIdsRef.current = readIds;

  // Load saved read IDs on mount
  useEffect(() => {
    AsyncStorage.getItem(READ_STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          try {
            const arr = JSON.parse(stored);
            if (Array.isArray(arr)) {
              const loadedSet = new Set(arr);
              setReadIds(loadedSet);
              readIdsRef.current = loadedSet;
            }
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  // Update parent unread count whenever notifications or readIds change
  useEffect(() => {
    const unread = notifications.filter(n => !readIds.has(n.id)).length;
    onUnreadCountChange?.(unread);
  }, [notifications, readIds, onUnreadCountChange]);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    // 1. Listen to pending citizen reports
    const reportsQuery = query(
      collection(db, 'reports'),
      where('status', 'in', ['pending', 'PENDING']),
      limit(10)
    );

    // 2. Listen to recent client activity
    const activityQuery = query(
      collection(db, 'client_activity'),
      orderBy('timestamp', 'desc'),
      limit(15)
    );

    // 3. Listen to official interagency command dispatches (from CENRO or CICTO)
    const messagesQuery = query(
      collection(db, 'interagency_messages'),
      where('channelId', 'in', ['general-command', 'urgent-advisories', 'fleet-dispatch', 'incident-escalation', 'system-governance']),
      limit(10)
    );

    let rawReports: AdminNotificationItem[] = [];
    let rawActivity: AdminNotificationItem[] = [];
    let rawMessages: AdminNotificationItem[] = [];

    const updateCombined = () => {
      const all = [...rawReports, ...rawActivity, ...rawMessages];
      all.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : (a.timestamp ? new Date(a.timestamp).getTime() : 0);
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : (b.timestamp ? new Date(b.timestamp).getTime() : 0);
        return timeB - timeA;
      });
      setNotifications(all);
      const unread = all.filter(n => !readIdsRef.current.has(n.id)).length;
      onUnreadCountChange?.(unread);
      setLoading(false);
    };

    const unsubReports = onSnapshot(reportsQuery, (snap) => {
      rawReports = snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: `rep_${doc.id}`,
          type: 'report',
          title: `New Report: ${data.barangay || 'Danao City'}`,
          subtitle: data.aiAnalysis?.wasteType || data.reportType || data.description || 'Pending waste inspection',
          timestamp: data.createdAt,
          targetTab: 'trash-reports',
        };
      });
      updateCombined();
    }, (err) => {
      console.warn('Reports notif stream note:', err?.message);
      setLoading(false);
    });

    const unsubActivity = onSnapshot(activityQuery, (snap) => {
      rawActivity = snap.docs.map(doc => {
        const data = doc.data();
        let notifType: AdminNotificationItem['type'] = 'system';
        let targetTab = 'logs';

        const cat = (data.category || '').toLowerCase();
        const action = (data.action || '').toLowerCase();

        if (cat.includes('dispatch') || action.includes('dispatch') || action.includes('route')) {
          notifType = 'dispatch';
          targetTab = 'route-optimization';
        } else if (cat.includes('driver') || action.includes('driver') || action.includes('shift') || cat.includes('fleet')) {
          notifType = 'driver';
          targetTab = 'fleet-monitoring';
        } else if (cat.includes('override')) {
          notifType = 'override';
          targetTab = 'operational-overrides';
        } else if (cat.includes('report')) {
          notifType = 'report';
          targetTab = 'trash-reports';
        }

        return {
          id: `act_${doc.id}`,
          type: notifType,
          title: data.action || 'System Event',
          subtitle: data.description || data.userEmail || data.actorEmail || 'Operational activity logged',
          timestamp: data.timestamp,
          targetTab,
        };
      });
      updateCombined();
    }, (err) => {
      console.warn('Activity notif stream note:', err?.message);
      setLoading(false);
    });

    const unsubMessages = onSnapshot(messagesQuery, (snap) => {
      rawMessages = snap.docs.map(doc => {
        const data = doc.data();
        const isCicto = data.senderRole === 'cicto';
        const isCenro = data.senderRole === 'cenro' || data.senderRole === 'admin';
        return {
          id: `cmd_${doc.id}`,
          type: 'override',
          title: isCicto ? 'CICTO Command' : isCenro ? 'CENRO Directive' : 'Command Dispatch',
          subtitle: data.subject || data.message || 'Inter-agency command message',
          timestamp: data.createdAt,
          targetTab: 'cicto-commands',
        };
      });
      updateCombined();
    }, (err) => {
      console.warn('Command messages notif stream note:', err?.message);
    });

    return () => {
      unsubReports();
      unsubActivity();
      unsubMessages();
    };
  }, []);

  const handleItemPress = (notif: AdminNotificationItem) => {
    const nextRead = new Set(readIds);
    nextRead.add(notif.id);
    setReadIds(nextRead);
    readIdsRef.current = nextRead;
    AsyncStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(nextRead))).catch(() => {});

    const resolvedTab = TAB_ALIAS_MAP[notif.targetTab] || notif.targetTab;
    onNavigateTab(resolvedTab);
    onClose();
  };

  const handleMarkAllAsRead = () => {
    const allIds = new Set(notifications.map(n => n.id));
    setReadIds(allIds);
    readIdsRef.current = allIds;
    AsyncStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(allIds))).catch(() => {});
    onUnreadCountChange?.(0);
  };

  const parseNotificationDate = (ts: any): Date | null => {
    if (!ts) return null;
    try {
      if (typeof ts?.toDate === 'function') {
        const d = ts.toDate();
        return isNaN(d.getTime()) ? null : d;
      }
      if (ts instanceof Date) {
        return isNaN(ts.getTime()) ? null : ts;
      }
      if (typeof ts === 'number') {
        const d = new Date(ts);
        return isNaN(d.getTime()) ? null : d;
      }
      if (typeof ts === 'string') {
        const d = new Date(ts);
        return isNaN(d.getTime()) ? null : d;
      }
      if (typeof ts?.seconds === 'number') {
        const d = new Date(ts.seconds * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
      return null;
    } catch {
      return null;
    }
  };

  const formatNotificationTime = (ts: any): string => {
    const d = parseNotificationDate(ts);
    if (!d) return 'Just now';

    const now = new Date();
    const targetMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const diffDays = Math.round((todayMidnight - targetMidnight) / oneDayMs);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (diffDays === 0) {
      return `Today, ${timeStr}`;
    } else if (diffDays === 1) {
      return `Yesterday, ${timeStr}`;
    } else {
      const month = d.toLocaleDateString([], { month: 'short' });
      const day = d.getDate();
      const isSameYear = d.getFullYear() === now.getFullYear();
      const datePrefix = isSameYear ? `${month} ${day}` : `${month} ${day}, ${d.getFullYear()}`;
      return `${datePrefix}, ${timeStr}`;
    }
  };

  interface NotificationGroup {
    key: string;
    label: string;
    isToday: boolean;
    isYesterday: boolean;
    items: AdminNotificationItem[];
  }

  const groupedNotifications = useMemo<NotificationGroup[]>(() => {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const groupMap = new Map<string, NotificationGroup>();

    notifications.forEach((item) => {
      const d = parseNotificationDate(item.timestamp);
      let key = 'today';
      let label = 'Today';
      let isToday = true;
      let isYesterday = false;

      if (d) {
        const targetMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diffDays = Math.round((todayMidnight - targetMidnight) / oneDayMs);

        if (diffDays === 0) {
          key = 'today';
          label = 'Today';
          isToday = true;
          isYesterday = false;
        } else if (diffDays === 1) {
          key = 'yesterday';
          label = 'Yesterday';
          isToday = false;
          isYesterday = true;
        } else {
          const month = d.toLocaleDateString([], { month: 'short' });
          const day = d.getDate();
          const isSameYear = d.getFullYear() === now.getFullYear();
          label = isSameYear ? `${month} ${day}` : `${month} ${day}, ${d.getFullYear()}`;
          key = `date_${d.getFullYear()}_${d.getMonth() + 1}_${day}`;
          isToday = false;
          isYesterday = false;
        }
      }

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          label,
          isToday,
          isYesterday,
          items: [],
        });
      }
      groupMap.get(key)!.items.push(item);
    });

    return Array.from(groupMap.values());
  }, [notifications]);

  const getTypeBadge = (type: AdminNotificationItem['type']) => {
    switch (type) {
      case 'report':
        return { bg: '#FEF3C7', color: '#B45309', icon: 'report-problem', label: 'REPORT' };
      case 'dispatch':
        return { bg: '#DBEAFE', color: '#1E40AF', icon: 'navigation', label: 'DISPATCH' };
      case 'driver':
        return { bg: '#DCFCE7', color: '#166534', icon: 'local-shipping', label: 'FLEET' };
      case 'override':
        return { bg: '#FEE2E2', color: '#991B1B', icon: 'warning', label: 'OVERRIDE' };
      default:
        return { bg: '#F1F5F9', color: '#475569', icon: 'info', label: 'SYSTEM' };
    }
  };

  if (!visible) return null;

  return (
    <View style={styles.dropdownContainer}>
      {/* Top Banner */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View style={styles.headerIconBox}>
            <MaterialIcons name="notifications-active" size={18} color="#10B981" />
          </View>
          <View>
            <Text style={styles.headerTitle}>CENRO NOTIFICATIONS</Text>
            <Text style={styles.headerSubtitle}>Real-time alerts, reports & dispatches</Text>
          </View>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
          <MaterialIcons name="close" size={18} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      {/* Notifications Scroll Area */}
      <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color="#1B4D3E" />
            <Text style={styles.loadingText}>Fetching updates...</Text>
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="check-circle" size={38} color="#10B981" />
            <Text style={styles.emptyTitle}>All Clear</Text>
            <Text style={styles.emptyText}>No pending citizen reports or urgent alerts.</Text>
          </View>
        ) : (
          <View style={styles.contentList}>
            {groupedNotifications.map((group) => (
              <View key={group.key} style={styles.groupSection}>
                <View style={styles.groupHeader}>
                  <View
                    style={[
                      styles.groupBadge,
                      group.isToday
                        ? styles.groupBadgeToday
                        : group.isYesterday
                        ? styles.groupBadgeYesterday
                        : styles.groupBadgeOlder,
                    ]}
                  >
                    <MaterialIcons
                      name={group.isToday ? 'today' : group.isYesterday ? 'history' : 'event'}
                      size={11}
                      color={group.isToday ? '#059669' : group.isYesterday ? '#D97706' : '#64748B'}
                    />
                    <Text
                      style={[
                        styles.groupBadgeText,
                        group.isToday
                          ? styles.groupBadgeTextToday
                          : group.isYesterday
                          ? styles.groupBadgeTextYesterday
                          : styles.groupBadgeTextOlder,
                      ]}
                    >
                      {group.label}
                    </Text>
                  </View>
                  <View style={styles.groupLine} />
                  <Text style={styles.groupCount}>{group.items.length}</Text>
                </View>

                <View style={styles.groupItemsList}>
                  {group.items.map((item) => {
                    const badge = getTypeBadge(item.type);
                    const isRead = readIds.has(item.id);

                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.notifCard, isRead && styles.notifCardRead]}
                        onPress={() => handleItemPress(item)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.cardHeader}>
                          <View style={[styles.typeBadge, { backgroundColor: badge.bg }]}>
                            <MaterialIcons name={badge.icon as any} size={12} color={badge.color} />
                            <Text style={[styles.typeBadgeText, { color: badge.color }]}>{badge.label}</Text>
                          </View>
                          <Text style={styles.timeText}>{formatNotificationTime(item.timestamp)}</Text>
                        </View>

                        <Text style={[styles.cardTitle, isRead && styles.cardTitleRead]}>
                          {item.title}
                        </Text>
                        <Text style={styles.cardSubtitle} numberOfLines={2}>
                          {item.subtitle}
                        </Text>

                        <View style={styles.actionRow}>
                          <Text style={styles.actionLink}>Open Tab →</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.markReadBtn}
          onPress={handleMarkAllAsRead}
          activeOpacity={0.7}
        >
          <MaterialIcons name="done-all" size={14} color="#64748B" />
          <Text style={styles.markReadBtnText}>Mark all as read</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.viewLogsBtn}
          onPress={() => {
            onNavigateTab('logs');
            onClose();
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.viewLogsBtnText}>All Activity Logs →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dropdownContainer: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 360,
    maxHeight: 520,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
    zIndex: 9999,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#F8FAFC',
  },
  headerSubtitle: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 1,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#334155',
  },
  scrollArea: {
    maxHeight: 380,
  },
  loadingState: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
  },
  contentList: {
    padding: 12,
    gap: 8,
  },
  emptyState: {
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 8,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 11.5,
    color: '#64748B',
    textAlign: 'center',
  },
  groupSection: {
    marginBottom: 10,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
    marginBottom: 6,
  },
  groupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
  },
  groupBadgeToday: {
    backgroundColor: '#ECFDF5',
  },
  groupBadgeYesterday: {
    backgroundColor: '#FEF3C7',
  },
  groupBadgeOlder: {
    backgroundColor: '#F1F5F9',
  },
  groupBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  groupBadgeTextToday: {
    color: '#059669',
  },
  groupBadgeTextYesterday: {
    color: '#B45309',
  },
  groupBadgeTextOlder: {
    color: '#475569',
  },
  groupLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  groupCount: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#94A3B8',
  },
  groupItemsList: {
    gap: 7,
  },
  notifCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  notifCardRead: {
    backgroundColor: '#FFFFFF',
    borderColor: '#F1F5F9',
    opacity: 0.75,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  timeText: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardTitleRead: {
    color: '#475569',
    fontWeight: '600',
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 15,
  },
  actionRow: {
    marginTop: 4,
    alignItems: 'flex-end',
  },
  actionLink: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#1B4D3E',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  markReadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  markReadBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  viewLogsBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  viewLogsBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1B4D3E',
  },
});
