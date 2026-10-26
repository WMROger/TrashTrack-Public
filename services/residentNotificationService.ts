import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { IncomingCollectionService } from './incomingCollectionService';
import { NotificationService } from './notificationService';

const SEEN_ANNOUNCEMENTS_KEY_PREFIX = '@trashtrack_seen_announcements_';
const HAS_INITIALIZED_KEY_PREFIX = '@trashtrack_notif_initialized_';

type NotificationListener = (count: number) => void;

const normalizeBrgy = (str?: string) => {
  if (!str) return '';
  return str.toLowerCase().replace(/^(brgy\.?|barangay)\s*/i, '').trim();
};

class ResidentNotificationService {
  private activeUserId: string | null = null;
  private userBarangay: string = '';
  private activeUserRole: string = '';
  private seenAnnouncementIds: Set<string> = new Set();
  private publishedAnnouncementIds: string[] = [];
  private rawAnnouncements: Array<{ id: string; createdAt: any; targetScope?: string; barangay?: string }> = [];
  private unreadUserNotifsCount: number = 0;
  private hasActiveScheduleAlert: boolean = false;
  private listeners: Set<NotificationListener> = new Set();
  private announcementListeners: Set<NotificationListener> = new Set();
  private scheduleAlertListeners: Set<(hasAlert: boolean) => void> = new Set();
  private unsubscribeAnnouncements: (() => void) | null = null;
  private unsubscribeUserNotifs: (() => void) | null = null;
  private unsubscribeUser: (() => void) | null = null;
  private unsubscribeIncomingTruck: (() => void) | null = null;
  private unsubscribeBarangaySchedules: (() => void) | null = null;
  private seenScheduleIds: Set<string> = new Set();
  private isStorageLoaded: boolean = false;

  public setUserRole(role: string) {
    this.activeUserRole = (role || '').toLowerCase().trim();
    if (
      this.activeUserRole === 'driver' ||
      this.activeUserRole === 'cenro' ||
      this.activeUserRole === 'cicto' ||
      this.activeUserRole === 'coordinator'
    ) {
      if (this.unsubscribeIncomingTruck) {
        this.unsubscribeIncomingTruck();
        this.unsubscribeIncomingTruck = null;
      }
      this.setScheduleAlert(false);
    }
  }

  /**
   * Start listening for unread counts (all notifications + announcements) for a specific resident.
   */
  public subscribe(userId: string | undefined | null, callback: NotificationListener): () => void {
    const effectiveUid = userId || auth.currentUser?.uid || 'resident_device';
    this.listeners.add(callback);

    callback(this.getUnreadCount());

    // If userId changed or not initialized, set up subscriptions
    if (this.activeUserId !== effectiveUid) {
      this.initForUser(effectiveUid);
    }

    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0 && this.announcementListeners.size === 0) {
        this.cleanup();
      }
    };
  }

  /**
   * Start listening specifically for unread announcements count for the tab bar badge.
   */
  public subscribeAnnouncements(userId: string | undefined | null, callback: NotificationListener): () => void {
    const effectiveUid = userId || auth.currentUser?.uid || 'resident_device';
    this.announcementListeners.add(callback);

    callback(this.getUnreadAnnouncementsCount());

    if (this.activeUserId !== effectiveUid) {
      this.initForUser(effectiveUid);
    }

    return () => {
      this.announcementListeners.delete(callback);
      if (this.listeners.size === 0 && this.announcementListeners.size === 0 && this.scheduleAlertListeners.size === 0) {
        this.cleanup();
      }
    };
  }

  /**
   * Start listening specifically for incoming/nearby truck alert (+1 on Schedule tab).
   */
  public subscribeScheduleAlert(userId: string | undefined | null, callback: (hasAlert: boolean) => void): () => void {
    const effectiveUid = userId || auth.currentUser?.uid || 'resident_device';
    this.scheduleAlertListeners.add(callback);

    callback(this.getScheduleAlert());

    if (this.activeUserId !== effectiveUid) {
      this.initForUser(effectiveUid);
    }

    return () => {
      this.scheduleAlertListeners.delete(callback);
      if (this.listeners.size === 0 && this.announcementListeners.size === 0 && this.scheduleAlertListeners.size === 0) {
        this.cleanup();
      }
    };
  }

  public getScheduleAlert(): boolean {
    return this.hasActiveScheduleAlert || this.unreadUserNotifsCount > 0;
  }

  public setScheduleAlert(hasAlert: boolean): void {
    if (this.hasActiveScheduleAlert !== hasAlert) {
      this.hasActiveScheduleAlert = hasAlert;
      this.notifyScheduleListeners();
    }
  }

  public async clearScheduleAlert(): Promise<void> {
    this.hasActiveScheduleAlert = false;
    this.unreadUserNotifsCount = 0;
    this.notifyScheduleListeners();

    // Mark current barangay schedules as seen
    if (db) {
      try {
        const schedRef = collection(db, 'barangay_schedules');
        const snap = await getDocs(schedRef);
        snap.forEach((d) => this.seenScheduleIds.add(d.id));
      } catch {}
    }

    // Mark userNotifications as read in Firestore
    const targetUid = this.activeUserId || auth.currentUser?.uid;
    if (db && targetUid && targetUid !== 'resident_device') {
      try {
        const notifsRef = collection(db, 'userNotifications');
        const qNotifs = query(notifsRef, where('userId', '==', targetUid), where('read', '==', false));
        const snap = await getDocs(qNotifs);
        const batchWrites = snap.docs.map((d) =>
          updateDoc(doc(db, 'userNotifications', d.id), {
            read: true,
            readAt: serverTimestamp(),
          })
        );
        await Promise.all(batchWrites);
      } catch (e) {
        console.warn('ResidentNotificationService: clearScheduleAlert error marking read:', e);
      }
    }
  }

  private notifyScheduleListeners() {
    const hasAlert = this.getScheduleAlert();
    this.scheduleAlertListeners.forEach((cb) => {
      try {
        cb(hasAlert);
      } catch (e) {
        console.warn('ResidentNotificationService: schedule listener error:', e);
      }
    });
  }

  /**
   * Get current unread notification + announcement count.
   */
  public getUnreadCount(): number {
    return this.getUnreadAnnouncementsCount() + this.unreadUserNotifsCount;
  }

  /**
   * Get current unseen announcements count only.
   */
  public getUnreadAnnouncementsCount(): number {
    return this.publishedAnnouncementIds.filter(
      (id) => !this.seenAnnouncementIds.has(id)
    ).length;
  }

  /**
   * Check if a specific announcement is unread/new by this user.
   */
  public isAnnouncementNew(announcementId: string): boolean {
    return !this.seenAnnouncementIds.has(announcementId);
  }

  /**
   * Mark all current announcements as seen (e.g. when visiting Announce tab).
   */
  public async markAllAnnouncementsAsSeen(userId?: string, extraIds?: string[]): Promise<void> {
    const uid = userId || this.activeUserId || 'resident_device';

    this.publishedAnnouncementIds.forEach((id) => this.seenAnnouncementIds.add(id));
    this.rawAnnouncements.forEach((item) => this.seenAnnouncementIds.add(item.id));
    if (Array.isArray(extraIds)) {
      extraIds.forEach((id) => {
        if (id) this.seenAnnouncementIds.add(id);
      });
    }

    this.notifyListeners();

    try {
      const serialized = JSON.stringify(Array.from(this.seenAnnouncementIds));
      const writes = [
        AsyncStorage.setItem(`${SEEN_ANNOUNCEMENTS_KEY_PREFIX}${uid}`, serialized),
        AsyncStorage.setItem(`${SEEN_ANNOUNCEMENTS_KEY_PREFIX}resident_device`, serialized),
      ];
      if (this.activeUserId && this.activeUserId !== uid) {
        writes.push(AsyncStorage.setItem(`${SEEN_ANNOUNCEMENTS_KEY_PREFIX}${this.activeUserId}`, serialized));
      }
      await Promise.all(writes);
    } catch (e) {
      console.warn('ResidentNotificationService: Error saving seen announcements:', e);
    }
  }

  /**
   * Mark a single announcement as seen.
   */
  public async markAnnouncementAsSeen(announcementId: string, userId?: string): Promise<void> {
    const uid = userId || this.activeUserId || 'resident_device';

    this.seenAnnouncementIds.add(announcementId);
    this.notifyListeners();

    try {
      const serialized = JSON.stringify(Array.from(this.seenAnnouncementIds));
      await Promise.all([
        AsyncStorage.setItem(`${SEEN_ANNOUNCEMENTS_KEY_PREFIX}${uid}`, serialized),
        AsyncStorage.setItem(`${SEEN_ANNOUNCEMENTS_KEY_PREFIX}resident_device`, serialized),
      ]);
    } catch (e) {
      console.warn('ResidentNotificationService: Error saving seen announcement:', e);
    }
  }

  /**
   * Mark a userNotification document in Firestore as read.
   */
  public async markNotificationAsRead(notificationId: string): Promise<void> {
    if (!db || !notificationId) return;
    try {
      const notifRef = doc(db, 'userNotifications', notificationId);
      await updateDoc(notifRef, {
        read: true,
        readAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('ResidentNotificationService: Error marking notification read:', e);
    }
  }

  private filterRelevantAnnouncements(): Array<{ id: string; createdAt: any; targetScope?: string; barangay?: string }> {
    const normResident = normalizeBrgy(this.userBarangay);
    return this.rawAnnouncements.filter((item) => {
      const isCityWide =
        !item.barangay ||
        item.targetScope === 'all' ||
        item.barangay.toLowerCase() === 'all' ||
        item.barangay.trim() === '';
      if (isCityWide) return true;
      if (!normResident) return false;
      return normalizeBrgy(item.barangay) === normResident;
    });
  }

  private async initForUser(userId: string) {
    this.unsubscribeAllFirestore();
    this.activeUserId = userId;
    this.userBarangay = '';
    this.activeUserRole = '';
    this.seenAnnouncementIds = new Set();
    this.publishedAnnouncementIds = [];
    this.rawAnnouncements = [];
    this.unreadUserNotifsCount = 0;
    this.isStorageLoaded = false;

    // Load persisted seen IDs
    const storageKey = `${SEEN_ANNOUNCEMENTS_KEY_PREFIX}${userId}`;
    const initKey = `${HAS_INITIALIZED_KEY_PREFIX}${userId}`;

    try {
      const [storedSeen, hasInitialized] = await Promise.all([
        AsyncStorage.getItem(storageKey),
        AsyncStorage.getItem(initKey),
      ]);

      if (storedSeen) {
        const parsed = JSON.parse(storedSeen);
        if (Array.isArray(parsed)) {
          this.seenAnnouncementIds = new Set(parsed);
        }
      }

      this.isStorageLoaded = true;

      // Listen to resident profile to get their barangay
      const profileUid = (userId && userId !== 'resident' && userId !== 'resident_device')
        ? userId
        : auth.currentUser?.uid;

      if (db && profileUid) {
        const userRef = doc(db, 'users', profileUid);
        this.unsubscribeUser = onSnapshot(
          userRef,
          (userSnap) => {
            if (userSnap.exists()) {
              const data = userSnap.data();
              const role = (data.role || '').toLowerCase().trim();
              this.activeUserRole = role;

              // Drivers, CENRO dispatchers, and coordinators must NEVER receive residential arrival alerts
              if (role === 'driver' || role === 'cenro' || role === 'cicto' || role === 'coordinator') {
                if (this.unsubscribeIncomingTruck) {
                  this.unsubscribeIncomingTruck();
                  this.unsubscribeIncomingTruck = null;
                }
                this.setScheduleAlert(false);
                return;
              }

              const nextBrgy = (data.barangay || data.assignedBarangay || '').trim();
              if (this.userBarangay !== nextBrgy || !this.unsubscribeIncomingTruck) {
                this.userBarangay = nextBrgy;
                const relevant = this.filterRelevantAnnouncements();
                this.publishedAnnouncementIds = relevant.map((i) => i.id);
                this.notifyListeners();
                this.setupIncomingTruckSubscription(profileUid);
              }
            }
          },
          (err) => {
            if (err?.code !== 'permission-denied') {
              console.warn('ResidentNotificationService: user profile listener error:', err);
            }
          }
        );
      }

      // Listen to published announcements in real-time
      if (db) {
        const announcementsRef = collection(db, 'announcements');
        const qAnnounce = query(announcementsRef, where('isPublished', '==', true));

        this.unsubscribeAnnouncements = onSnapshot(
          qAnnounce,
          async (snapshot) => {
            const items = snapshot.docs.map((d) => {
              const data = d.data();
              return {
                id: d.id,
                createdAt: data.createdAt,
                targetScope: data.targetScope,
                barangay: data.barangay,
              };
            });

            // Sort newest first
            items.sort((a: any, b: any) => {
              const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
              const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
              return timeB - timeA;
            });

            this.rawAnnouncements = items;
            const relevant = this.filterRelevantAnnouncements();
            this.publishedAnnouncementIds = relevant.map((i) => i.id);

            // If user has NEVER opened the app before on this device:
            // Mark older announcements as seen so we only show +1 (for the latest 1 announcement)
            // instead of a huge backlog.
            if (!hasInitialized && !storedSeen && relevant.length > 1) {
              const latestId = relevant[0].id;
              // Mark all older ones as seen, keep only the newest 1 as new
              relevant.slice(1).forEach((item) => this.seenAnnouncementIds.add(item.id));
              await AsyncStorage.setItem(initKey, 'true');
              await AsyncStorage.setItem(
                storageKey,
                JSON.stringify(Array.from(this.seenAnnouncementIds))
              );
            } else if (!hasInitialized) {
              await AsyncStorage.setItem(initKey, 'true');
            }

            this.notifyListeners();
          },
          (err) => {
            console.warn('ResidentNotificationService: announcements error:', err);
          }
        );

        // Listen to personal userNotifications
        const targetNotifsUid = (userId && userId !== 'resident' && userId !== 'resident_device')
          ? userId
          : auth.currentUser?.uid;

        if (targetNotifsUid) {
          const userNotifsRef = collection(db, 'userNotifications');
          const qNotifs = query(
            userNotifsRef,
            where('userId', '==', targetNotifsUid)
          );

          this.unsubscribeUserNotifs = onSnapshot(
            qNotifs,
            (snapshot) => {
              const seenSignatures = new Set<string>();
              let count = 0;
              snapshot.docs.forEach((d) => {
                const data = d.data() as any;
                if (data.read) return;
                const createdSec = data.createdAt?.seconds || (data.createdAt ? Math.floor(new Date(data.createdAt).getTime() / 1000) : 0);
                const timeWindow = createdSec ? Math.floor(createdSec / 180) : 0;
                const sig = `${data.title || ''}_${data.body || ''}_${timeWindow}`;
                if (!seenSignatures.has(sig)) {
                  seenSignatures.add(sig);
                  count++;
                }
              });
              this.unreadUserNotifsCount = count;
              this.notifyListeners();
              this.notifyScheduleListeners();
            },
            (err) => {
              console.warn('ResidentNotificationService: userNotifications listener warning:', err);
            }
          );
        }

        // Listen to barangay collection schedules
        const schedRef = collection(db, 'barangay_schedules');
        this.unsubscribeBarangaySchedules = onSnapshot(
          schedRef,
          (snapshot) => {
            const cleanUser = normalizeBrgy(this.userBarangay);
            let hasUnseenSched = false;

            snapshot.docChanges().forEach((change) => {
              if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                const cleanSched = normalizeBrgy(data.barangayName);
                if (cleanUser && (cleanSched === cleanUser || !cleanSched)) {
                  if (!this.seenScheduleIds.has(change.doc.id)) {
                    hasUnseenSched = true;
                    // Trigger native phone notification
                    NotificationService.scheduleScheduleAlertNotification({
                      scheduleId: change.doc.id,
                      barangay: this.userBarangay || data.barangayName || 'Danao City',
                      title: '📅 Waste Collection Schedule Updated',
                      body: `Collection schedule for ${data.barangayName || this.userBarangay} is available. Tap Schedule to view!`,
                    }).catch(() => {});
                  }
                }
              }
            });

            if (hasUnseenSched) {
              this.setScheduleAlert(true);
            }
          },
          (err) => {
            console.warn('ResidentNotificationService: barangay_schedules listener warning:', err);
          }
        );
      }
    } catch (e) {
      console.warn('ResidentNotificationService: Error initializing for user:', e);
      this.isStorageLoaded = true;
    }
  }

  private notifyListeners() {
    const totalCount = this.getUnreadCount();
    const annCount = this.getUnreadAnnouncementsCount();

    this.listeners.forEach((callback) => {
      try {
        callback(totalCount);
      } catch (e) {
        console.warn('ResidentNotificationService: listener error:', e);
      }
    });

    this.announcementListeners.forEach((callback) => {
      try {
        callback(annCount);
      } catch (e) {
        console.warn('ResidentNotificationService: announcement listener error:', e);
      }
    });
  }

  private setupIncomingTruckSubscription(userId: string) {
    if (this.unsubscribeIncomingTruck) {
      this.unsubscribeIncomingTruck();
      this.unsubscribeIncomingTruck = null;
    }

    if (
      this.activeUserRole === 'driver' ||
      this.activeUserRole === 'cenro' ||
      this.activeUserRole === 'cicto' ||
      this.activeUserRole === 'coordinator'
    ) {
      return;
    }

    try {
      this.unsubscribeIncomingTruck = IncomingCollectionService.subscribeToResidentIncomingTruck(
        userId,
        this.userBarangay || 'Baliang',
        (state) => {
          const shouldAlert = Boolean(state.hasActiveTruck);
          this.setScheduleAlert(shouldAlert);
        },
        undefined,
        this.activeUserRole
      );
    } catch (e) {
      console.warn('ResidentNotificationService: error subscribing to incoming truck:', e);
    }
  }

  private unsubscribeAllFirestore() {
    if (this.unsubscribeIncomingTruck) {
      this.unsubscribeIncomingTruck();
      this.unsubscribeIncomingTruck = null;
    }
    if (this.unsubscribeBarangaySchedules) {
      this.unsubscribeBarangaySchedules();
      this.unsubscribeBarangaySchedules = null;
    }
    if (this.unsubscribeAnnouncements) {
      this.unsubscribeAnnouncements();
      this.unsubscribeAnnouncements = null;
    }
    if (this.unsubscribeUserNotifs) {
      this.unsubscribeUserNotifs();
      this.unsubscribeUserNotifs = null;
    }
    if (this.unsubscribeUser) {
      this.unsubscribeUser();
      this.unsubscribeUser = null;
    }
  }

  private cleanup() {
    this.unsubscribeAllFirestore();
    this.activeUserId = null;
    this.userBarangay = '';
    this.rawAnnouncements = [];
    this.publishedAnnouncementIds = [];
    this.seenAnnouncementIds.clear();
    this.seenScheduleIds.clear();
    this.hasActiveScheduleAlert = false;
    this.listeners.clear();
    this.announcementListeners.clear();
    this.scheduleAlertListeners.clear();
  }
}

export const residentNotificationService = new ResidentNotificationService();
