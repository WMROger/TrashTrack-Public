import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  CictoNotification,
  dismissCictoNotification,
  clearAllCictoNotifications,
} from '@/services/cictoAccountService';

interface CictoNotificationDropdownProps {
  visible: boolean;
  notifications: CictoNotification[];
  unreadCount?: number;
  onClose: () => void;
  onSelectOtp?: (pin: string) => void;
  onClearAll?: () => void;
}

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
  if (!d) return 'Recently';

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

export default function CictoNotificationDropdown({
  visible,
  notifications,
  unreadCount = 0,
  onClose,
  onSelectOtp,
  onClearAll,
}: CictoNotificationDropdownProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [clearedLocally, setClearedLocally] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Reset local cleared state when new notifications arrive
  useEffect(() => {
    if (clearedLocally && notifications.length > 0) {
      setClearedLocally(false);
    }
  }, [notifications.length]);

  if (!visible) return null;

  const handleCopyPin = async (notifId: string, pin?: string) => {
    if (!pin) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(pin);
      }
      setCopiedId(notifId);
      if (onSelectOtp) onSelectOtp(pin);
      setTimeout(() => setCopiedId(null), 3000);
    } catch {
      setCopiedId(notifId);
      if (onSelectOtp) onSelectOtp(pin);
      setTimeout(() => setCopiedId(null), 3000);
    }
  };

  const handleDismiss = async (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
    await dismissCictoNotification(id);
  };

  const handleClearHistory = async () => {
    setIsClearing(true);
    setClearedLocally(true);
    setDismissedIds(new Set());
    try {
      await clearAllCictoNotifications();
      if (onClearAll) onClearAll();
    } finally {
      setIsClearing(false);
    }
  };

  const activeNotifs = clearedLocally
    ? []
    : notifications.filter((n) => n.status !== 'dismissed' && !dismissedIds.has(n.id) && n.type !== 'otp_pin' && !n.otpPin);

  return (
    <View style={styles.dropdownContainer}>
      {/* Header */}
      <View style={styles.dropdownHeader}>
        <View style={styles.headerTitleRow}>
          <View style={styles.headerShieldBadge}>
            <MaterialIcons name="security" size={15} color="#0D9488" />
          </View>
          <Text style={styles.dropdownTitle}>CICTO Security & Oversight Feed</Text>
          {unreadCount > 0 ? (
            <View style={styles.notifCountBadge}>
              <Text style={styles.notifCountText}>{unreadCount} new</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.headerActionRow}>
          {activeNotifs.length > 0 && (
            <TouchableOpacity
              onPress={handleClearHistory}
              disabled={isClearing}
              style={styles.clearBtn}
              activeOpacity={0.7}
            >
              <MaterialIcons name="clear-all" size={14} color="#0D9488" />
              <Text style={styles.clearBtnText}>Clear All</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <MaterialIcons name="close" size={16} color="#64748B" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Notifications List */}
      <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={true}>
        {activeNotifs.length === 0 ? (
          <View style={styles.emptyWrap}>
            <MaterialIcons name="notifications-none" size={32} color="#CBD5E1" />
            <Text style={styles.emptyText}>No active security alerts</Text>
            <Text style={styles.emptySub}>
              Real-time account deletion records and governance audit notices appear here.
            </Text>
          </View>
        ) : (
          activeNotifs.map((notif) => {
            const isDeleted = notif.type === 'account_deleted';
            // Clean up any leaked raw UIDs or technical terms from description with proper spacing
            const cleanDesc = (notif.description || '')
              .replace(/\s*\([A-Za-z0-9_-]{20,}\)/g, '')
              .replace(/\s*from\s+Authentication\s+and\s+Firestore\.?/gi, ' from system directory.')
              .replace(/\s+/g, ' ')
              .trim();

            return (
              <View
                key={notif.id}
                style={[
                  styles.notifCard,
                  isDeleted && styles.notifCardDeleted,
                ]}
              >
                <View
                  style={[
                    styles.notifIconWrap,
                    isDeleted && styles.notifIconWrapDeleted,
                  ]}
                >
                  <MaterialIcons
                    name={isDeleted ? 'delete-forever' : 'notifications-active'}
                    size={18}
                    color={isDeleted ? '#EF4444' : '#0D9488'}
                  />
                </View>

                <View style={styles.notifContent}>
                  <View style={styles.notifTitleRow}>
                    <Text
                      style={[
                        styles.notifTitle,
                        isDeleted && styles.notifTitleDeleted,
                      ]}
                    >
                      {notif.title}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleDismiss(notif.id)}
                      style={styles.dismissBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="close" size={14} color="#94A3B8" />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.notifDesc}>{cleanDesc}</Text>

                  <View style={styles.notifFooterRow}>
                    <MaterialIcons name="schedule" size={11} color="#94A3B8" />
                    <Text style={styles.notifTime}>
                      {formatNotificationTime(notif.createdAt)}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  dropdownContainer: {
    position: 'absolute',
    top: 56,
    right: 16,
    width: 390,
    maxHeight: 500,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 12,
    zIndex: 9999,
    overflow: 'hidden',
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#F8FAFC',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerShieldBadge: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  notifCountBadge: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 10,
  },
  notifCountText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#F0FDFA',
  },
  clearBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0D9488',
  },
  closeBtn: {
    padding: 4,
    borderRadius: 6,
  },
  listScroll: {
    maxHeight: 430,
    padding: 12,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 44,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#64748B',
  },
  emptySub: {
    fontSize: 11.5,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 16,
  },
  notifCard: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
    gap: 10,
  },
  notifCardDeleted: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FECDD3',
  },
  notifCardOtp: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  notifIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#E6FFFA',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  notifIconWrapDeleted: {
    backgroundColor: '#FEE2E2',
  },
  notifIconWrapOtp: {
    backgroundColor: '#FEF3C7',
  },
  notifContent: {
    flex: 1,
  },
  notifTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  notifTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  notifTitleDeleted: {
    color: '#991B1B',
  },
  notifTitleOtp: {
    color: '#92400E',
  },
  dismissBtn: {
    padding: 3,
    borderRadius: 4,
  },
  notifDesc: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 17,
  },
  pinChipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  pinDisplayBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  pinDisplayText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 14,
    fontWeight: '800',
    color: '#92400E',
    letterSpacing: 2,
  },
  copyPinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF9C3',
    borderWidth: 1,
    borderColor: '#FDE047',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
  },
  copiedPinBtn: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  copyPinBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  copiedPinBtnText: {
    color: '#15803D',
  },
  notifFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  notifTime: {
    fontSize: 10.5,
    color: '#94A3B8',
    fontWeight: '500',
  },
});
