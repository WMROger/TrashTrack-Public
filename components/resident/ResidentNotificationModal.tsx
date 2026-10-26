import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { collection, query, where, orderBy, limit, onSnapshot, writeBatch, doc } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { useRouter } from 'expo-router';
import { residentNotificationService } from '@/services/residentNotificationService';

interface ResidentNotificationModalProps {
  visible: boolean;
  onClose: () => void;
}

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type?: string;
  imageUrl?: string | null;
  completionImage?: string | null;
  completionNotes?: string | null;
  reportId?: string | null;
  scheduleId?: string | null;
  read?: boolean;
  createdAt?: any;
  collectedAt?: any;
}

export default function ResidentNotificationModal({
  visible,
  onClose,
}: ResidentNotificationModalProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const user = auth.currentUser;
    if (!visible || !user?.uid || !db) {
      return;
    }

    setLoading(true);
    const notifsRef = collection(db, 'userNotifications');
    const q = query(
      notifsRef,
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(40)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: NotificationItem[] = [];
        const seenSignatures = new Set<string>();
        snapshot.forEach((d) => {
          const data = d.data() as any;
          const createdSec = data.createdAt?.seconds || (data.createdAt ? Math.floor(new Date(data.createdAt).getTime() / 1000) : 0);
          const timeWindow = createdSec ? Math.floor(createdSec / 180) : 0; // 3-minute deduplication window
          const bodyVal = data.body || data.message || '';
          const sig = `${data.title || ''}_${bodyVal}_${timeWindow}`;
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            items.push({ id: d.id, ...data, body: bodyVal } as NotificationItem);
          }
        });
        setNotifications(items);
        setLoading(false);
      },
      (error) => {
        console.warn('ResidentNotificationModal error loading notifications:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [visible]);

  const markNotificationRead = async (item: NotificationItem) => {
    if (!item.read) {
      await residentNotificationService.markNotificationAsRead(item.id);
    }
  };

  const markAllAsRead = async () => {
    const user = auth.currentUser;
    if (!user?.uid || !db) return;
    try {
      const unread = notifications.filter((n) => !n.read);
      if (unread.length === 0) return;
      const batch = writeBatch(db);
      unread.forEach((n) => {
        batch.update(doc(db, 'userNotifications', n.id), { read: true, readAt: new Date().toISOString() });
      });
      await batch.commit();
    } catch (err) {
      console.warn('Could not mark all notifications as read:', err);
    }
  };

  const formatNotificationTime = (timestamp: any) => {
    if (!timestamp) return 'Recently';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return 'Recently';
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconBg}>
                <Ionicons name="notifications" size={20} color="#15803D" />
              </View>
              <Text style={styles.modalTitle}>Notifications</Text>
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{unreadCount} new</Text>
                </View>
              )}
            </View>

            <View style={styles.headerRight}>
              {unreadCount > 0 && (
                <TouchableOpacity onPress={markAllAsRead} style={styles.markAllBtn}>
                  <Text style={styles.markAllText}>Mark all read</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color="#4B5563" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Body */}
          {loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#16A34A" />
              <Text style={styles.loadingText}>Loading notifications...</Text>
            </View>
          ) : notifications.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBg}>
                <Ionicons name="notifications-off-outline" size={42} color="#9CA3AF" />
              </View>
              <Text style={styles.emptyTitle}>No notifications yet</Text>
              <Text style={styles.emptySubtitle}>
                You will be notified here with driver photos when your trash is collected, or when collection trucks are nearby!
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scrollList}
              showsVerticalScrollIndicator={false}
            >
              {notifications.map((item) => {
                const img = item.imageUrl || item.completionImage;
                const isPickupCompleted = item.type === 'pickup_completed' || Boolean(img);
                const isRewardConfirmed = item.type === 'reward_confirmed';
                const isRewardDeclined = item.type === 'reward_declined';
                const isRewardCancelled = item.type === 'reward_cancelled';
                const isRewardPending = item.type === 'reward_pending';
                const isAward = item.type === 'award' || item.type === 'reward_award';
                const isRewardRelated = isRewardConfirmed || isRewardDeclined || isRewardCancelled || isRewardPending || isAward;

                let iconName: any = 'notifications';
                let iconColor = '#2563EB';
                let iconBgStyle = styles.typeIconBgBlue;

                if (isPickupCompleted) {
                  iconName = 'checkmark-circle';
                  iconColor = '#16A34A';
                  iconBgStyle = styles.typeIconBgGreen;
                } else if (isRewardConfirmed || isAward) {
                  iconName = 'gift';
                  iconColor = '#16A34A';
                  iconBgStyle = styles.typeIconBgGreen;
                } else if (isRewardDeclined) {
                  iconName = 'close-circle';
                  iconColor = '#DC2626';
                  iconBgStyle = styles.typeIconBgRed;
                } else if (isRewardCancelled) {
                  iconName = 'alert-circle';
                  iconColor = '#D97706';
                  iconBgStyle = styles.typeIconBgAmber;
                } else if (isRewardPending) {
                  iconName = 'time';
                  iconColor = '#2563EB';
                  iconBgStyle = styles.typeIconBgBlue;
                }

                return (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.88}
                    style={[
                      styles.notificationCard,
                      !item.read && styles.unreadCard,
                      isPickupCompleted && styles.pickupCompletedCard,
                    ]}
                    onPress={() => markNotificationRead(item)}
                  >
                    <View style={styles.cardHeader}>
                      <View style={styles.cardHeaderLeft}>
                        <View style={[styles.typeIconBg, iconBgStyle]}>
                          <Ionicons
                            name={iconName}
                            size={16}
                            color={iconColor}
                          />
                        </View>
                        <Text style={styles.cardTitle}>{item.title}</Text>
                      </View>
                      <View style={styles.cardHeaderRight}>
                        <Text style={styles.cardTime}>{formatNotificationTime(item.createdAt)}</Text>
                        {!item.read && <View style={styles.unreadDot} />}
                      </View>
                    </View>

                    <Text style={styles.cardBody}>{item.body}</Text>

                    {/* Quick Link to Eco-Rewards & Redemptions */}
                    {isRewardRelated ? (
                      <TouchableOpacity
                        style={styles.viewRewardBtn}
                        onPress={() => {
                          onClose();
                          router.push('/rewards');
                        }}
                      >
                        <Ionicons name="gift-outline" size={14} color="#15803D" />
                        <Text style={styles.viewRewardBtnText}>View Eco-Store & Redemptions</Text>
                        <MaterialIcons name="arrow-forward" size={14} color="#15803D" />
                      </TouchableOpacity>
                    ) : null}

                    {/* Driver Proof Photo Preview */}
                    {img ? (
                      <View style={styles.proofCardContainer}>
                        <View style={styles.proofLabelRow}>
                          <Ionicons name="camera" size={14} color="#059669" />
                          <Text style={styles.proofLabelText}>Photo proof from driver</Text>
                        </View>
                        <TouchableOpacity
                          activeOpacity={0.9}
                          style={styles.proofImageWrapper}
                          onPress={() => setZoomImageUrl(img)}
                        >
                          <Image source={{ uri: img }} style={styles.proofImage} resizeMode="cover" />
                          <View style={styles.proofZoomPill}>
                            <Ionicons name="expand" size={12} color="#FFFFFF" />
                            <Text style={styles.proofZoomText}>Tap to view full photo</Text>
                          </View>
                        </TouchableOpacity>

                        {item.completionNotes ? (
                          <View style={styles.driverNotesBox}>
                            <Text style={styles.driverNotesLabel}>Driver note:</Text>
                            <Text style={styles.driverNotesText}>&quot;{item.completionNotes}&quot;</Text>
                          </View>
                        ) : null}

                        {item.reportId ? (
                          <TouchableOpacity
                            style={styles.viewReportBtn}
                            onPress={() => {
                              onClose();
                              router.push('/my-reports');
                            }}
                          >
                            <Text style={styles.viewReportBtnText}>View in My Reports</Text>
                            <MaterialIcons name="arrow-forward" size={14} color="#15803D" />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : null}

                    {!img && item.reportId ? (
                      <TouchableOpacity
                        style={styles.viewReportBtn}
                        onPress={() => {
                          onClose();
                          router.push('/my-reports');
                        }}
                      >
                        <Text style={styles.viewReportBtnText}>View in My Reports</Text>
                        <MaterialIcons name="arrow-forward" size={14} color="#15803D" />
                      </TouchableOpacity>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Full Screen Photo Zoom Modal */}
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
              accessibilityLabel="Close photo"
            >
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </TouchableOpacity>
            {!!zoomImageUrl && (
              <Image
                source={{ uri: zoomImageUrl }}
                style={styles.zoomModalImage}
                resizeMode="contain"
              />
            )}
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '84%',
    paddingBottom: Platform.OS === 'ios' ? 30 : 16,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  unreadBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  markAllBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  markAllText: {
    fontSize: 12,
    color: '#16A34A',
    fontWeight: '700',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#6B7280',
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 36,
  },
  emptyIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 19,
  },
  scrollList: {
    padding: 16,
    gap: 14,
  },
  notificationCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
  },
  unreadCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#86EFAC',
    borderWidth: 1.5,
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  pickupCompletedCard: {
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  typeIconBg: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeIconBgGreen: {
    backgroundColor: '#DCFCE7',
  },
  typeIconBgBlue: {
    backgroundColor: '#DBEAFE',
  },
  typeIconBgRed: {
    backgroundColor: '#FEE2E2',
  },
  typeIconBgAmber: {
    backgroundColor: '#FEF3C7',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    flex: 1,
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTime: {
    fontSize: 11,
    color: '#6B7280',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16A34A',
  },
  cardBody: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
    marginTop: 2,
  },
  proofCardContainer: {
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#86EFAC',
    padding: 10,
  },
  proofLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  proofLabelText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  proofImageWrapper: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E5E7EB',
  },
  proofImage: {
    width: '100%',
    height: '100%',
  },
  proofZoomPill: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  proofZoomText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  driverNotesBox: {
    marginTop: 8,
    backgroundColor: '#F9FAFB',
    borderRadius: 6,
    padding: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#16A34A',
  },
  driverNotesLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16A34A',
    textTransform: 'uppercase',
  },
  driverNotesText: {
    fontSize: 12,
    color: '#374151',
    fontStyle: 'italic',
    marginTop: 2,
  },
  viewReportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 7,
    backgroundColor: '#DCFCE7',
    borderRadius: 8,
  },
  viewReportBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
  },
  viewRewardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 7,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
  },
  viewRewardBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
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
});
