import { db } from '@/config/firebase';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

export type OverrideKey =
  | 'forcePauseCollection'
  | 'activateBackupFleet'
  | 'severeWeatherProtocol'
  | 'surgePriorityMode';

export interface EmergencyBroadcastData {
  id: string;
  subject: string;
  message: string;
  priority: 'high' | 'urgent';
  senderName: string;
  senderEmail: string;
  senderRole?: string;
  sentBy?: string;
  createdAt?: any;
  active: boolean;
}


export interface SystemOverridesData {
  forcePauseCollection: boolean;
  activateBackupFleet: boolean;
  severeWeatherProtocol: boolean;
  surgePriorityMode: boolean;
  forcePauseReason?: string;
  pausedAt?: any;
  resumedAt?: any;
  updatedAt?: any;
  updatedBy?: string;
  updatedByUid?: string;
  activeEmergencyBroadcast?: EmergencyBroadcastData | null;
}

export const DEFAULT_OVERRIDES: SystemOverridesData = {
  forcePauseCollection: false,
  activateBackupFleet: true,
  severeWeatherProtocol: false,
  surgePriorityMode: false,
  activeEmergencyBroadcast: null,
};

/**
 * Subscribes to real-time system overrides from Firestore.
 */
export function subscribeToSystemOverrides(
  onUpdate: (overrides: SystemOverridesData) => void,
  onError?: (error: any) => void
): () => void {
  if (!db) {
    onUpdate(DEFAULT_OVERRIDES);
    return () => {};
  }

  const docRef = doc(db, 'system_settings', 'overrides');
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        onUpdate({
          forcePauseCollection: Boolean(data.forcePauseCollection),
          activateBackupFleet:
            data.activateBackupFleet !== undefined ? Boolean(data.activateBackupFleet) : true,
          severeWeatherProtocol: Boolean(data.severeWeatherProtocol),
          surgePriorityMode: Boolean(data.surgePriorityMode),
          forcePauseReason: data.forcePauseReason || '',
          pausedAt: data.pausedAt,
          resumedAt: data.resumedAt,
          updatedAt: data.updatedAt,
          updatedBy: data.updatedBy,
          updatedByUid: data.updatedByUid,
          activeEmergencyBroadcast: data.activeEmergencyBroadcast || null,
        });
      } else {
        onUpdate(DEFAULT_OVERRIDES);
      }
    },
    (error) => {
      if (error?.code !== 'permission-denied') {
        console.warn('SystemOverrides: listener error:', error);
      }
      if (onError) onError(error);
    }
  );
}

export interface ToggleOverrideParams {
  key: OverrideKey;
  newValue: boolean;
  actorEmail: string;
  actorUid: string;
  actorName?: string;
  reason?: string;
}

/**
 * Toggles a system override setting and immediately broadcasts alerts to:
 * 1. system_settings/overrides (real-time stream)
 * 2. userNotifications for all drivers (triggers FCM push notifications + Driver Inbox)
 * 3. notifications for all drivers (triggers real-time in-cab in-app toasts & alerts)
 * 4. interagency_messages (coordinators and CICTO alert channel)
 * 5. announcements (public/resident awareness)
 * 6. client_activity & activity_logs (audit trace)
 */
export async function toggleSystemOverrideAndNotify({
  key,
  newValue,
  actorEmail,
  actorUid,
  actorName = 'CENRO Administrator',
  reason,
}: ToggleOverrideParams): Promise<void> {
  if (!db) throw new Error('Firestore is not initialized');

  // 1. Determine titles, messages, and implication labels
  let notifTitle = '';
  let notifBody = '';
  let notifType = '';
  let priority: 'urgent' | 'high' | 'normal' = 'urgent';
  let activityLabel = '';

  switch (key) {
    case 'forcePauseCollection':
      if (newValue) {
        notifTitle = '🚨 EMERGENCY: Fleet Collection Force-Paused';
        notifBody =
          reason ||
          'CENRO has issued a critical fleet contingency pause due to emergency conditions (such as severe flooding or typhoon hazards). Safely pull over and standby at depot or designated safe zone until authorized to resume.';
        notifType = 'emergency_pause';
        priority = 'urgent';
        activityLabel = 'Collection Force-Paused by CENRO';
      } else {
        notifTitle = '✅ OPERATIONS RESUMED: Normal Dispatch Restored';
        notifBody =
          'CENRO has lifted the operational halt. Waste collection routes are authorized to resume. Please proceed with caution.';
        notifType = 'emergency_resumed';
        priority = 'high';
        activityLabel = 'Collection Resumed Normal Operation';
      }
      break;

    case 'severeWeatherProtocol':
      if (newValue) {
        notifTitle = '⚠️ SEVERE WEATHER & FLOOD HAZARD WARNING';
        notifBody =
          reason ||
          'PAGASA severe weather / flood hazard defense protocol active. Drivers must bypass low-elevation riverbanks and flood basins. Use elevated arterial road detours.';
        notifType = 'weather_alert';
        priority = 'urgent';
        activityLabel = 'Severe Weather Protocol Enabled';
      } else {
        notifTitle = '🌤️ Severe Weather Protocol Deactivated';
        notifBody =
          'CENRO has deactivated the severe weather flood defense protocol. Standard route adherence has been restored.';
        notifType = 'weather_normal';
        priority = 'normal';
        activityLabel = 'Severe Weather Protocol Deactivated';
      }
      break;

    case 'activateBackupFleet':
      if (newValue) {
        notifTitle = '🚛 Backup Fleet Mobilized';
        notifBody =
          'Secondary compactor units and standby driver shifts from the motor pool are mobilized to handle heavy waste build-up.';
        notifType = 'fleet_backup';
        priority = 'high';
        activityLabel = 'Backup Fleet Mobilized';
      } else {
        notifTitle = '🚛 Backup Fleet on Standby';
        notifBody = 'Reserve compactor shifts and auxiliary units have returned to depot standby.';
        notifType = 'fleet_standby';
        priority = 'normal';
        activityLabel = 'Backup Fleet on Standby';
      }
      break;

    case 'surgePriorityMode':
      if (newValue) {
        notifTitle = '⚡ Overload Surge Priority Mode Enabled';
        notifBody =
          'High-tonnage barangay hubs (Public Market, Commercial Port, Poblacion) are prioritized. Express turnaround dumping at MRF is authorized.';
        notifType = 'surge_priority';
        priority = 'high';
        activityLabel = 'Surge Dumpsite Priority Enabled';
      } else {
        notifTitle = '⚖️ Standard Routing Restored';
        notifBody =
          'Overload surge priority mode deactivated. Standard sequential collection schedule restored.';
        notifType = 'surge_normal';
        priority = 'normal';
        activityLabel = 'Standard Routing Restored';
      }
      break;
  }

  // 2. Update Firestore `system_settings/overrides`
  const docRef = doc(db, 'system_settings', 'overrides');
  const updatePayload: Record<string, any> = {
    [key]: newValue,
    updatedAt: serverTimestamp(),
    updatedBy: actorEmail,
    updatedByUid: actorUid,
  };

  if (key === 'forcePauseCollection') {
    if (newValue) {
      updatePayload.forcePauseReason = reason || 'Emergency Operations Pause (e.g. Flooding / Calamity)';
      updatePayload.pausedAt = serverTimestamp();
    } else {
      updatePayload.forcePauseReason = '';
      updatePayload.resumedAt = serverTimestamp();
    }
  }

  await setDoc(docRef, updatePayload, { merge: true });

  // 3. Log into overrides activity_logs
  try {
    await addDoc(collection(db, 'system_settings', 'overrides', 'activity_logs'), {
      source: actorEmail,
      action: activityLabel,
      timestamp: serverTimestamp(),
      confidence: 'Executive Override',
      details: notifBody,
    });
  } catch (e) {
    console.warn('SystemOverrides: Failed to write activity_log:', e);
  }

  // 4. Log into client_activity
  try {
    await addDoc(collection(db, 'client_activity'), {
      event: `override.${key}`,
      targetType: 'system_settings',
      targetId: 'overrides',
      actorUid,
      actorEmail,
      metadata: {
        setting: key,
        value: newValue,
        label: activityLabel,
        reason: reason || null,
      },
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('SystemOverrides: Failed to write client_activity:', e);
  }

  // 5. Query all drivers to broadcast push + in-cab notifications
  try {
    const driversQuery = query(collection(db, 'users'), where('role', '==', 'driver'));
    const driversSnap = await getDocs(driversQuery);

    if (!driversSnap.empty) {
      // Chunk batches of up to 250 ops (each driver gets 2 writes: userNotifications and notifications)
      const driverDocs = driversSnap.docs;
      const CHUNK_SIZE = 200;

      for (let i = 0; i < driverDocs.length; i += CHUNK_SIZE) {
        const slice = driverDocs.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);

        for (const driverDoc of slice) {
          const dData = driverDoc.data();
          if (dData.disabled === true || dData.status === 'disabled') continue;
          const driverId = driverDoc.id;

          // A. userNotifications (populates Driver Inbox + triggers FCM Cloud Function push notification)
          const userNotifRef = doc(collection(db, 'userNotifications'));
          batch.set(userNotifRef, {
            userId: driverId,
            title: notifTitle,
            body: notifBody,
            type: notifType,
            priority,
            read: false,
            createdAt: serverTimestamp(),
            data: {
              overrideKey: key,
              value: String(newValue),
              action: key === 'forcePauseCollection' ? (newValue ? 'pause' : 'resume') : 'alert',
            },
          });

          // B. notifications (triggers real-time in-cab toast banner in app/(driver)/index.tsx)
          const notifRef = doc(collection(db, 'notifications'));
          batch.set(notifRef, {
            userId: driverId,
            title: notifTitle,
            message: notifBody,
            type: key === 'forcePauseCollection' ? 'emergency_override' : (key === 'severeWeatherProtocol' ? 'weather_warning' : 'system_override'),
            read: false,
            priority,
            createdAt: serverTimestamp(),
            data: {
              overrideKey: key,
              value: String(newValue),
            },
          });
        }

        await batch.commit();
      }
    }
  } catch (err) {
    console.error('SystemOverrides: Error notifying drivers:', err);
  }

  // 6. If critical emergency (Collection Pause or Severe Weather), broadcast to interagency channel for CICTO & Barangay Coordinators
  if (key === 'forcePauseCollection' || key === 'severeWeatherProtocol') {
    try {
      await addDoc(collection(db, 'interagency_messages'), {
        subject: notifTitle,
        message: notifBody,
        priority: 'urgent',
        channelId: 'urgent-advisories',
        senderUid: actorUid,
        senderName: actorName,
        senderEmail: actorEmail,
        senderRole: 'cenro',
        status: 'sent',
        deliveryMode: 'spark-firestore',
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('SystemOverrides: Failed to dispatch interagency message:', e);
    }
  }
}

export interface DispatchBroadcastParams {
  subject: string;
  message: string;
  priority?: 'high' | 'urgent';
  actorEmail: string;
  actorUid: string;
  actorName?: string;
}

/**
 * Transmits an emergency broadcast directive to all active trucks, drivers, coordinators, and public streams:
 * 1. Writes activeEmergencyBroadcast to system_settings/overrides (real-time stream to all driver apps)
 * 2. Writes to emergency_broadcasts collection
 * 3. Writes to interagency_messages (coordinators and CENRO/CICTO channel)
 * 4. Batches userNotifications and notifications to all active drivers
 * 5. Adds public announcement in announcements
 * 6. Logs to client_activity audit trail
 */
export async function dispatchEmergencyBroadcastDirective({
  subject,
  message,
  priority = 'urgent',
  actorEmail,
  actorUid,
  actorName = 'CENRO Administrator',
}: DispatchBroadcastParams): Promise<void> {
  if (!db) throw new Error('Firestore is not initialized');

  const cleanSubject = subject.trim();
  const cleanMessage = message.trim();
  if (!cleanMessage) throw new Error('Broadcast message cannot be empty.');

  const broadcastId = `eb_${Date.now()}`;
  const broadcastPayload: EmergencyBroadcastData = {
    id: broadcastId,
    subject: cleanSubject,
    message: cleanMessage,
    priority,
    senderName: actorName,
    senderEmail: actorEmail,
    senderRole: 'cenro',
    active: true,
  };

  // 1. Update system_settings/overrides
  const overridesRef = doc(db, 'system_settings', 'overrides');
  await setDoc(
    overridesRef,
    {
      activeEmergencyBroadcast: {
        ...broadcastPayload,
        createdAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
      updatedBy: actorEmail,
      updatedByUid: actorUid,
    },
    { merge: true }
  );

  // 2. Add to emergency_broadcasts history collection
  try {
    await addDoc(collection(db, 'emergency_broadcasts'), {
      ...broadcastPayload,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Could not add to emergency_broadcasts collection:', err);
  }

  // 3. Add to interagency_messages
  try {
    await addDoc(collection(db, 'interagency_messages'), {
      subject: cleanSubject,
      message: cleanMessage,
      priority,
      channelId: 'urgent-advisories',
      senderUid: actorUid,
      senderName: actorName,
      senderEmail: actorEmail,
      senderRole: 'cenro',
      status: 'sent',
      deliveryMode: 'spark-firestore',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Could not add to interagency_messages:', err);
  }

  // 4. Batch notify all drivers
  try {
    const driversQuery = query(collection(db, 'users'), where('role', '==', 'driver'));
    const driversSnap = await getDocs(driversQuery);

    if (!driversSnap.empty) {
      const driverDocs = driversSnap.docs;
      const CHUNK_SIZE = 200;

      for (let i = 0; i < driverDocs.length; i += CHUNK_SIZE) {
        const slice = driverDocs.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);

        for (const driverDoc of slice) {
          const dData = driverDoc.data();
          if (dData.disabled === true || dData.status === 'disabled') continue;
          const driverId = driverDoc.id;

          const userNotifRef = doc(collection(db, 'userNotifications'));
          batch.set(userNotifRef, {
            userId: driverId,
            title: `🚨 ${cleanSubject}`,
            body: cleanMessage,
            type: 'emergency_broadcast',
            broadcastId,
            priority,
            read: false,
            createdAt: serverTimestamp(),
          });

          const liveNotifRef = doc(collection(db, 'notifications'));
          batch.set(liveNotifRef, {
            userId: driverId,
            driverId,
            title: `🚨 ${cleanSubject}`,
            body: cleanMessage,
            type: 'emergency_broadcast',
            broadcastId,
            priority,
            read: false,
            createdAt: serverTimestamp(),
          });
        }

        await batch.commit();
      }
    }
  } catch (err) {
    console.warn('Could not batch notify drivers:', err);
  }

  // 5. Add to public announcements
  try {
    await addDoc(collection(db, 'announcements'), {
      title: cleanSubject,
      content: cleanMessage,
      priority: priority === 'urgent' ? 'emergency' : 'important',
      category: 'emergency',
      author: actorName,
      authorEmail: actorEmail,
      date: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Could not write to announcements:', err);
  }

  // 6. Record audit log
  try {
    await addDoc(collection(db, 'client_activity'), {
      event: 'emergency.broadcast',
      targetType: 'fleet_broadcast',
      actorUid,
      actorEmail,
      metadata: { subject: cleanSubject, message: cleanMessage, priority },
      createdAt: serverTimestamp(),
    });
  } catch {}
}

/**
 * Dismisses or archives the current active emergency broadcast in system_settings/overrides.
 */
export async function clearActiveEmergencyBroadcast(actorEmail: string, actorUid: string): Promise<void> {
  if (!db) return;
  const overridesRef = doc(db, 'system_settings', 'overrides');
  await setDoc(
    overridesRef,
    {
      activeEmergencyBroadcast: null,
      updatedAt: serverTimestamp(),
      updatedBy: actorEmail,
      updatedByUid: actorUid,
    },
    { merge: true }
  );
}
