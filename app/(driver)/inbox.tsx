import { Feather, MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useAuthContext } from '@/components/AuthContext';
import { db } from '@/config/firebase';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { announceEmergencyBroadcast, speakDirective } from '@/services/voiceAnnouncementService';


type DriverNotification = { id: string; type: string; title: string; body: string; read: boolean; createdAt: any };

export default function DriverInbox() {
  const { theme } = useTheme();
  const { user } = useAuthContext();
  const isDark = theme === 'dark';
  const [notifications, setNotifications] = useState<DriverNotification[]>([]);

  useEffect(() => {
    if (!user?.uid || !db) return;
    const notificationsQuery = query(collection(db, 'userNotifications'), where('userId', '==', user.uid));
    return onSnapshot(
      notificationsQuery,
      (snapshot: any) => {
        const rows = snapshot.docs.map((item: any) => ({ id: item.id, ...item.data() } as DriverNotification));
        rows.sort((a: any, b: any) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setNotifications(rows);
      },
      (error: any) => {
        if (error?.code !== 'permission-denied') {
          console.warn('DriverInbox: notifications listener error:', error);
        }
      }
    );
  }, [user?.uid]);

  const markRead = (id: string) => updateDoc(doc(db, 'userNotifications', id), { read: true, readAt: serverTimestamp() });
  const markAllRead = async () => {
    const unread = notifications.filter(item => !item.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach(item => batch.update(doc(db, 'userNotifications', item.id), { read: true, readAt: serverTimestamp() }));
    await batch.commit();
  };

  const formatTime = (value: any) => {
    const date = value?.toDate?.();
    return date ? date.toLocaleString() : 'Recently';
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'emergency_broadcast':
        return <MaterialIcons name="campaign" size={22} color="#DC2626" />;
      case 'emergency_pause':
      case 'emergency_override':
        return <Feather name="alert-octagon" size={20} color="#DC2626" />;
      case 'emergency_resumed':
        return <Feather name="check-circle" size={20} color="#059669" />;
      case 'weather_alert':
        return <Feather name="cloud-rain" size={20} color="#0284C7" />;
      case 'weather_normal':
        return <Feather name="sun" size={20} color="#D97706" />;
      case 'fleet_backup':
        return <Feather name="truck" size={20} color="#16A34A" />;
      case 'surge_priority':
        return <Feather name="zap" size={20} color="#EA580C" />;
      case 'pickup': return <Feather name="truck" size={20} color={isDark ? "#FCD34D" : "#92400E"} />;
      case 'route': return <Feather name="map" size={20} color={isDark ? "#34D399" : "#065F46"} />;
      case 'maintenance': return <Feather name="tool" size={20} color={isDark ? "#34D399" : "#065F46"} />;
      default: return <Feather name="bell" size={20} color={isDark ? "#F9FAFB" : "#1F2937"} />;
    }
  };

  const getIconBgColor = (type: string) => {
    switch (type) {
      case 'emergency_broadcast':
      case 'emergency_pause':
      case 'emergency_override':
        return isDark ? '#7F1D1D' : '#FEE2E2';
      case 'emergency_resumed':
        return isDark ? '#064E3B' : '#DCFCE7';
      case 'weather_alert':
        return isDark ? '#0C4A6E' : '#E0F2FE';
      case 'weather_normal':
        return isDark ? '#78350F' : '#FEF3C7';
      case 'surge_priority':
        return isDark ? '#7C2D12' : '#FFEDD5';
      case 'pickup': return isDark ? '#78350F' : '#FEF3C7';
      case 'route': return isDark ? '#064E3B' : '#D1FAE5';
      case 'maintenance': return isDark ? '#064E3B' : '#D1FAE5';
      default: return isDark ? '#374151' : '#F3F4F6';
    }
  };

  const getCardBgColor = (type: string, isNew: boolean) => {
    if (isNew && (type === 'emergency_broadcast' || type === 'emergency_pause' || type === 'emergency_override')) {
      return isDark ? '#450A0A' : '#FEF2F2';
    }
    if (isNew && type === 'weather_alert') {
      return isDark ? '#082F49' : '#F0F9FF';
    }
    if (isNew && type === 'emergency_resumed') {
      return isDark ? '#052E16' : '#F0FDF4';
    }
    if (isNew && type === 'pickup') return isDark ? '#451A03' : '#FEF3C7';
    return isDark ? '#1F2937' : '#F9FAFB';
  };

  return (
    <ScrollView style={[styles.container, isDark && styles.containerDark]} showsVerticalScrollIndicator={false}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={isDark ? "#111827" : "#F4FBF1"} />
      
      <View style={styles.header}>
        <Text style={[styles.headerTitle, isDark && styles.textLight]}>Notifications</Text>
        {notifications.some(item => !item.read) && <TouchableOpacity onPress={markAllRead}><Text style={[styles.markAllText, isDark && { color: '#86EFAC' }]}>Mark all read</Text></TouchableOpacity>}
      </View>

      <Text style={[styles.statusFeed, isDark && {color: '#86EFAC'}]}>STATUS FEED</Text>
      <Text style={[styles.stayUpdated, isDark && styles.textLight]}>Stay Updated</Text>

      <View style={styles.notificationList}>
        {notifications.length > 0 ? (
          notifications.map(notif => (
            <TouchableOpacity
              key={notif.id} 
              onPress={() => {
                if (!notif.read) markRead(notif.id);
                if (notif.type === 'emergency_broadcast') {
                  announceEmergencyBroadcast(notif.title, notif.body);
                }
              }}
              style={[
                styles.notificationCard, 
                isDark && styles.cardDark,
                { backgroundColor: getCardBgColor(notif.type, !notif.read) }
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.iconWrapper, { backgroundColor: getIconBgColor(notif.type) }]}>
                  {getIcon(notif.type)}
                </View>
                <View style={styles.titleWrapper}>
                  <Text style={[styles.cardTitle, isDark && styles.textLight]}>{notif.title}</Text>
                  {!notif.read && (
                    <View style={styles.newBadge}>
                      <Text style={styles.newBadgeText}>NEW</Text>
                    </View>
                  )}
                </View>
              </View>
              <Text style={[styles.cardBody, isDark && styles.textMuted]}>{notif.body}</Text>
              {notif.type === 'emergency_broadcast' && (
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 8,
                    alignSelf: 'flex-start',
                    backgroundColor: isDark ? '#7F1D1D' : '#FEE2E2',
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: '#FCA5A5',
                  }}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    if (!notif.read) markRead(notif.id);
                    announceEmergencyBroadcast(notif.title, notif.body);
                  }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="volume-up" size={16} color="#DC2626" />
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#DC2626' }}>Listen Announcement</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.cardTime}>{formatTime(notif.createdAt)}</Text>
            </TouchableOpacity>
          ))

        ) : (
          <View style={[styles.emptyCard, isDark && styles.emptyCardDark]}>
            <Feather name="bell-off" size={48} color={isDark ? "#4B5563" : "#9CA3AF"} />
            <Text style={[styles.emptyText, isDark && styles.textLight]}>No notifications yet</Text>
            <Text style={[styles.emptySubtext, isDark && styles.textMuted]}>You will see new updates and alerts here.</Text>
          </View>
        )}
      </View>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4FBF1',
    paddingHorizontal: 20,
  },
  containerDark: {
    backgroundColor: '#111827',
  },
  textLight: {
    color: '#F9FAFB',
  },
  textMuted: {
    color: '#9CA3AF',
  },
  header: {
    marginTop: 60,
    marginBottom: 24,
  },
  markAllText: { color: '#2E8B57', fontSize: 13, fontWeight: '700', marginTop: 8 },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
  },
  statusFeed: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#5A755E',
    letterSpacing: 1,
    marginBottom: 4,
  },
  stayUpdated: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 24,
  },
  notificationList: {
    gap: 16,
  },
  notificationCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardDark: {
    borderColor: '#374151',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  titleWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  newBadge: {
    backgroundColor: '#92400E',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  newBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  cardBody: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
    marginBottom: 16,
  },
  cardTime: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#9CA3AF',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    marginTop: 20,
  },
  emptyCardDark: {
    backgroundColor: '#1F2937',
    borderColor: '#374151',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4B5563',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'center',
  },
});
