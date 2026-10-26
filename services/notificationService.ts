import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { auth } from '@/config/firebase';
import { IncomingCollectionService, isRawFirestoreIdOrUuid } from './incomingCollectionService';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export class NotificationService {
  static async requestPermissions(): Promise<boolean> {
    // Notifications are not supported on web
    if (Platform.OS === 'web') {
      console.log('Notifications not supported on web platform');
      return false;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return false;
    }

    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Collection Alerts',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#2E7D32',
          sound: 'default',
        });
        await Notifications.setNotificationChannelAsync('emergency_alerts', {
          name: 'Emergency Advisories',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 500, 200, 500, 200, 500],
          lightColor: '#DC2626',
          sound: 'default',
          bypassDnd: true,
        });
      } catch (err) {
        console.warn('Failed to configure Android notification channel:', err);
      }
    }
    
    return true;
  }

  static async scheduleAnnouncementNotification(announcement: {
    id: string;
    title: string;
    description: string;
    priority: string;
  }) {
    // Notifications are not supported on web
    if (Platform.OS === 'web') {
      console.log('Announcement notification skipped on web platform:', announcement.title);
      return null;
    }

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    // Use deterministic identifier to deduplicate notifications on device
    const identifier = `announcement_${announcement.id}`;
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    } catch {}

    const notificationId = await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: 'New Announcement',
        body: `${announcement.title} - ${announcement.description.substring(0, 100)}...`,
        data: { 
          type: 'announcement',
          announcementId: announcement.id,
          priority: announcement.priority
        },
        sound: 'default',
      },
      trigger: null, // Show immediately
    });

    return notificationId;
  }

  static async scheduleScheduleAlertNotification(details: {
    scheduleId: string;
    barangay: string;
    title?: string;
    body?: string;
  }) {
    if (Platform.OS === 'web') return null;

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return null;

    const identifier = `schedule_alert_${details.scheduleId}_${Date.now()}`;
    const title = details.title || '📅 Waste Collection Schedule Alert';
    const body = details.body || `New collection schedule update for Brgy. ${details.barangay}. Check your Schedule tab!`;

    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title,
          body,
          data: {
            type: 'schedule_alert',
            scheduleId: details.scheduleId,
            barangay: details.barangay,
          },
          sound: 'default',
          ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
        },
        trigger: null,
      });
      return notificationId;
    } catch (e) {
      console.warn('Failed to schedule schedule alert notification:', e);
      return null;
    }
  }

  static async scheduleIncomingTruckNotification(details: {
    truckId: string;
    truckPlate?: string;
    barangay: string;
    etaMinutes: number;
    distanceMeters?: number;
  }) {
    if (Platform.OS === 'web') {
      console.log('Incoming truck notification skipped on web');
      return null;
    }

    const currentUid = auth?.currentUser?.uid;
    const currentRole = currentUid ? IncomingCollectionService.getUserRole(currentUid) : undefined;
    if (currentRole === 'driver' || currentRole === 'cenro' || currentRole === 'cicto' || currentRole === 'coordinator') {
      return null;
    }

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return null;

    const todayKey = new Date().toISOString().split('T')[0];
    const identifier = `truck_incoming_${details.truckId}_${todayKey}`;
    const hasValidPlate = details.truckPlate && !isRawFirestoreIdOrUuid(details.truckPlate);
    const truckLabel = hasValidPlate
      ? (details.truckPlate!.toLowerCase().includes('truck') ? details.truckPlate! : `Truck ${details.truckPlate}`)
      : 'Collection truck';
    const title = `🚛 Incoming Trash Collection (~${details.etaMinutes} mins)`;
    const body = `AI Prediction: ${truckLabel} is approaching Brgy. ${details.barangay}. Estimated arrival in ~${details.etaMinutes} minutes. Please prepare your segregated waste!`;

    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title,
          body,
          data: {
            type: 'truck_incoming',
            truckId: details.truckId,
            barangay: details.barangay,
            etaMinutes: details.etaMinutes,
            distanceMeters: details.distanceMeters,
          },
          sound: 'default',
          ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
        },
        trigger: null, // Fire immediately
      });
      return notificationId;
    } catch (e) {
      console.warn('Failed to schedule incoming truck notification:', e);
      return null;
    }
  }

  static async scheduleProximityAlertNotification(details: {
    truckId: string;
    truckPlate?: string;
    barangay: string;
    distanceMeters: number;
  }) {
    if (Platform.OS === 'web') return null;

    const currentUid = auth?.currentUser?.uid;
    const currentRole = currentUid ? IncomingCollectionService.getUserRole(currentUid) : undefined;
    if (currentRole === 'driver' || currentRole === 'cenro' || currentRole === 'cicto' || currentRole === 'coordinator') {
      return null;
    }

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return null;

    const todayKey = new Date().toISOString().split('T')[0];
    const nearbyBucket = Math.floor(Date.now() / (3 * 60 * 1000));
    const identifier = `truck_proximity_${details.truckId}_${todayKey}_${nearbyBucket}`;
    const hasValidPlate = details.truckPlate && !isRawFirestoreIdOrUuid(details.truckPlate);
    const truckLabel = hasValidPlate
      ? (details.truckPlate!.toLowerCase().includes('truck') ? details.truckPlate! : `Truck ${details.truckPlate}`)
      : 'Collection truck';
    const distText = Math.max(10, Math.round(details.distanceMeters / 10) * 10);
    const title = '🔔 Collection Truck Nearby!';
    const body = `${truckLabel} is now in your immediate sector (~${distText}m away) in Brgy. ${details.barangay}. Collection is underway!`;

    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title,
          body,
          data: {
            type: 'truck_proximity',
            truckId: details.truckId,
            barangay: details.barangay,
            distanceMeters: details.distanceMeters,
          },
          sound: 'default',
          ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
        },
        trigger: null,
      });
      return notificationId;
    } catch (e) {
      console.warn('Failed to schedule proximity alert notification:', e);
      return null;
    }
  }

  static async scheduleEmergencyNotification(details: {
    broadcastId: string;
    title: string;
    message: string;
    priority?: string;
  }) {
    if (Platform.OS === 'web') return null;

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return null;

    const identifier = `emergency_broadcast_${details.broadcastId}`;
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    } catch {}

    const title = details.title || '🚨 EMERGENCY ADVISORY';
    const body = details.message;

    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title,
          body,
          data: {
            type: 'emergency_broadcast',
            broadcastId: details.broadcastId,
            priority: details.priority || 'urgent',
          },
          sound: 'default',
          ...(Platform.OS === 'android' ? { channelId: 'emergency_alerts' } : {}),
        },
        trigger: null,
      });
      return notificationId;
    } catch (e) {
      console.warn('Failed to schedule emergency notification:', e);
      return null;
    }
  }

  static async dismissDriverProximityAlerts() {
    if (Platform.OS === 'web') return;
    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch (e) {
      // safe ignore
    }
  }

  static async schedulePickupReminder(schedule: {
    id: string;
    date: Date;
    time: string;
    type: string;
  }) {
    // Notifications are not supported on web
    if (Platform.OS === 'web') {
      console.log('Pickup reminder notification skipped on web platform for:', schedule.id);
      return;
    }

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    const scheduleDate = new Date(schedule.date);
    const [hours, minutes] = schedule.time.split(':').map(Number);
    scheduleDate.setHours(hours, minutes, 0, 0);

    const now = new Date();
    const timeDiff = scheduleDate.getTime() - now.getTime();

    // Don't schedule if the time has already passed
    if (timeDiff <= 0) return;

    // Schedule notification for 1 hour before
    const oneHourBefore = new Date(scheduleDate.getTime() - 60 * 60 * 1000);
    if (oneHourBefore > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Pickup Reminder',
          body: `Your ${schedule.type} pickup is in 1 hour`,
          data: { 
            type: 'pickup_reminder',
            scheduleId: schedule.id,
            reminderType: '1hour'
          },
          sound: 'default',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: oneHourBefore },
      });
    }

    // Schedule notification for tomorrow (24 hours before)
    const tomorrow = new Date(scheduleDate.getTime() - 24 * 60 * 60 * 1000);
    if (tomorrow > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Pickup Tomorrow',
          body: `Your ${schedule.type} pickup is scheduled for tomorrow`,
          data: { 
            type: 'pickup_reminder',
            scheduleId: schedule.id,
            reminderType: 'tomorrow'
          },
          sound: 'default',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: tomorrow },
      });
    }

    console.log('Scheduled pickup reminders for:', schedule.id);
  }

  static async cancelNotification(notificationId: string) {
    // Notifications are not supported on web
    if (Platform.OS === 'web') {
      console.log('Cancel notification skipped on web platform');
      return;
    }
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  }

  static async cancelAllNotifications() {
    // Notifications are not supported on web
    if (Platform.OS === 'web') {
      console.log('Cancel all notifications skipped on web platform');
      return;
    }
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  static async getScheduledNotifications() {
    // Notifications are not supported on web
    if (Platform.OS === 'web') {
      console.log('Get scheduled notifications skipped on web platform');
      return [];
    }
    return await Notifications.getAllScheduledNotificationsAsync();
  }

  static buildReminderIds(scheduleId: string) {
    return {
      tomorrowId: `sched_${scheduleId}_tomorrow`,
      oneHourId: `sched_${scheduleId}_1hour`,
    };
  }

  static async cancelReminderById(identifier: string) {
    if (Platform.OS === 'web') return;
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    } catch {}
  }

  static async getAllScheduledIdentifiers(): Promise<string[]> {
    if (Platform.OS === 'web') return [];
    const list = await Notifications.getAllScheduledNotificationsAsync();
    return list.map(n => n.identifier);
  }

  static async upsertPickupReminders(schedule: { id: string; date: Date; time: string; type: string; }) {
    if (Platform.OS === 'web') return;

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    const { tomorrowId, oneHourId } = this.buildReminderIds(schedule.id);

    // Cancel existing ones for this schedule
    await this.cancelReminderById(tomorrowId);
    await this.cancelReminderById(oneHourId);

    const scheduleDate = new Date(schedule.date);
    const [hours, minutes] = schedule.time.split(':').map(Number);
    scheduleDate.setHours(hours, minutes, 0, 0);

    const now = new Date();
    if (scheduleDate <= now) return;

    // 1 hour before
    const oneHourBefore = new Date(scheduleDate.getTime() - 60 * 60 * 1000);
    if (oneHourBefore > now) {
      await Notifications.scheduleNotificationAsync({
        identifier: oneHourId,
        content: {
          title: 'Pickup Reminder',
          body: `Your ${schedule.type} pickup is in 1 hour`,
          data: { type: 'pickup_reminder', scheduleId: schedule.id, reminderType: '1hour' },
          sound: 'default',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: oneHourBefore },
      });
    }

    // 24 hours before
    const tomorrow = new Date(scheduleDate.getTime() - 24 * 60 * 60 * 1000);
    if (tomorrow > now) {
      await Notifications.scheduleNotificationAsync({
        identifier: tomorrowId,
        content: {
          title: 'Pickup Tomorrow',
          body: `Your ${schedule.type} pickup is scheduled for tomorrow`,
          data: { type: 'pickup_reminder', scheduleId: schedule.id, reminderType: 'tomorrow' },
          sound: 'default',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: tomorrow },
      });
    }
  }
}
