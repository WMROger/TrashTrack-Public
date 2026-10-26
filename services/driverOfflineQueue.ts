import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { auth, db } from '@/config/firebase';
import { cloudinaryService, UPLOAD_FOLDERS } from '@/services/cloudinaryService';
import { writeAuditLog } from '@/services/auditLogService';
import { awardVerifiedCompletion } from '@/services/rewardService';
import { addDoc, collection, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const QUEUE_KEY = 'trashtrack.driver.offline-actions.v1';

type Measurement = { value: number; unit: 'kg' | 'ton' | 'm3'; bagCount: number | null };
type QueueItem = {
  id: string;
  action: 'completion' | 'issue';
  driverUid: string;
  scheduleId: string;
  reportId?: string;
  imageUri?: string;
  uploadedUrl?: string;
  location: { lat: number; lng: number };
  description: string;
  measurement?: Measurement;
  queuedAt: string;
  attempts: number;
};

export type DriverEvidencePayload = Omit<QueueItem, 'id' | 'action' | 'driverUid' | 'queuedAt' | 'attempts' | 'uploadedUrl'>;

const readQueue = async (): Promise<QueueItem[]> => {
  try {
    return JSON.parse(await AsyncStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
};

const saveQueue = (items: QueueItem[]) => AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));

const enqueue = async (action: QueueItem['action'], payload: DriverEvidencePayload, uploadedUrl?: string) => {
  const queue = await readQueue();
  const driverUid = auth.currentUser?.uid;
  if (!driverUid) throw new Error('An authenticated driver is required to queue evidence.');
  queue.push({
    ...payload,
    action,
    driverUid,
    uploadedUrl,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  await saveQueue(queue);
};

const notifyResidentCompletion = async (params: {
  userId: string;
  reportId?: string | null;
  scheduleId?: string | null;
  imageUrl: string;
  notes?: string | null;
  locationText?: string | null;
  weightTons?: number | null;
}) => {
  if (!params.userId || !db) return;
  try {
    const loc = params.locationText?.trim();
    const weightLabel = params.weightTons ? ` (${params.weightTons >= 1 ? `${params.weightTons.toFixed(2)} tons` : `${Math.round(params.weightTons * 1000)} kg`})` : '';
    const body = loc
      ? `Your reported trash at ${loc} has been collected${weightLabel}. Tap to view the driver's photo proof.`
      : `Your trash has been collected${weightLabel}. Tap to view the driver's verified photo proof.`;

    const payload = {
      userId: params.userId,
      title: '✅ Trash Collected!',
      body,
      type: 'pickup_completed',
      reportId: params.reportId || null,
      scheduleId: params.scheduleId || null,
      imageUrl: params.imageUrl,
      completionImage: params.imageUrl,
      completionNotes: params.notes || null,
      collectedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      read: false,
    };

    await addDoc(collection(db, 'userNotifications'), payload);

    try {
      await addDoc(collection(db, 'notifications'), payload);
    } catch {
      // safe fallback
    }
  } catch (err) {
    console.warn('Could not send resident completion notification:', err);
  }
};

const persist = async (item: QueueItem, imageUrl: string) => {
  if (item.action === 'completion') {
    const notifiedReportIds = new Set<string>();

    // 1. If schedule document exists or needs creation (e.g. for bs_ or custom schedules)
    if (item.scheduleId && !item.scheduleId.startsWith('rep_') && !item.scheduleId.startsWith('report_')) {
      try {
        const rawScheduleId = item.scheduleId;
        const cleanScheduleId = rawScheduleId.includes('_stop_') ? rawScheduleId.split('_stop_')[0] : rawScheduleId;
        const stopPart = rawScheduleId.includes('_stop_') ? rawScheduleId.split('_stop_')[1] : null;
        const stopOrderNum = stopPart ? parseInt(stopPart, 10) : null;

        const scheduleRef = doc(db, 'schedules', cleanScheduleId);
        const txResult = await runTransaction(db, async (tx) => {
          const scheduleSnap = await tx.get(scheduleRef);
          if (!scheduleSnap.exists()) {
            tx.set(scheduleRef, {
              scheduleId: rawScheduleId,
              status: 'completed',
              completionImage: imageUrl,
              completionLocation: item.location,
              completionNotes: item.description,
              collectionMeasurement: item.measurement,
              completedByUid: item.driverUid,
              assignedDriverId: item.driverUid,
              completedAt: serverTimestamp(),
              dieselClosedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }, { merge: true });
            return { exists: false, schedData: null as any, updatedStops: [] as any[] };
          }

          const schedData = scheduleSnap.data();
          if (Array.isArray(schedData.stops) && schedData.stops.length > 0) {
            let allStopsDone = true;
            let matchedAny = false;
            const updatedStops = schedData.stops.map((s: any, idx: number) => {
              const isMatch = (item.reportId && s.reportId === item.reportId) ||
                (stopOrderNum !== null && (s.order === stopOrderNum || idx + 1 === stopOrderNum)) ||
                (s.order && rawScheduleId.endsWith(`_stop_${s.order}`));
              if (isMatch && !matchedAny) {
                matchedAny = true;
                return {
                  ...s,
                  completed: true,
                  completedAt: new Date().toISOString(),
                  completionImage: imageUrl,
                  completionNotes: item.description,
                };
              }
              if (!s.completed) {
                allStopsDone = false;
              }
              return s;
            });

            if (!matchedAny) {
              let markedFirst = false;
              allStopsDone = true;
              for (let i = 0; i < updatedStops.length; i++) {
                if (!markedFirst && !updatedStops[i].completed) {
                  updatedStops[i] = {
                    ...updatedStops[i],
                    completed: true,
                    completedAt: new Date().toISOString(),
                    completionImage: imageUrl,
                    completionNotes: item.description,
                  };
                  markedFirst = true;
                } else if (!updatedStops[i].completed) {
                  allStopsDone = false;
                }
              }
            }

            tx.set(scheduleRef, {
              stops: updatedStops,
              status: allStopsDone ? 'completed' : 'in_progress',
              completionImage: imageUrl,
              completionLocation: item.location,
              completionNotes: item.description,
              collectionMeasurement: item.measurement,
              completedByUid: item.driverUid,
              assignedDriverId: item.driverUid,
              ...(allStopsDone ? { completedAt: serverTimestamp(), dieselClosedAt: serverTimestamp() } : {}),
              updatedAt: serverTimestamp(),
            }, { merge: true });

            return { exists: true, schedData, updatedStops };
          }

          tx.set(scheduleRef, {
            status: 'completed',
            completionImage: imageUrl,
            completionLocation: item.location,
            completionNotes: item.description,
            collectionMeasurement: item.measurement,
            completedByUid: item.driverUid,
            assignedDriverId: item.driverUid,
            completedAt: serverTimestamp(),
            dieselClosedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });

          return { exists: true, schedData, updatedStops: [] as any[] };
        });

        if (txResult.exists) {
          const { schedData, updatedStops } = txResult;
          if (updatedStops.length > 0) {
            // If any completed stop is linked to a citizen report, resolve it and notify resident
            for (const s of updatedStops) {
              if (s.completed && s.reportId) {
                try {
                  const repRef = doc(db, 'reports', s.reportId);
                  const repSnap = await getDoc(repRef);
                  const repData = repSnap.exists() ? repSnap.data() : null;

                  await setDoc(repRef, {
                    status: 'resolved',
                    completionImage: imageUrl,
                    completionNotes: item.description,
                    collectedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    resolvedByUid: item.driverUid,
                    assignedDriverId: item.driverUid,
                  }, { merge: true });

                  notifiedReportIds.add(s.reportId);

                  const citizenUid = repData?.userId || (repData as any)?.reportedByUid || s.userId;
                  if (citizenUid) {
                    await notifyResidentCompletion({
                      userId: citizenUid,
                      reportId: s.reportId,
                      scheduleId: cleanScheduleId,
                      imageUrl,
                      notes: item.description,
                      locationText: repData?.street ? `${repData.street}, ${repData.barangay || ''}` : (s.street || s.address || s.barangay || ''),
                      weightTons: item.measurement?.value,
                    });
                  }
                } catch (repErr) {
                  console.warn('Could not update citizen report for stop:', repErr);
                }
              }
            }
          } else if (schedData?.userId && !schedData?.reportId && !item.reportId) {
            await notifyResidentCompletion({
              userId: schedData.userId,
              scheduleId: cleanScheduleId,
              imageUrl,
              notes: item.description,
              locationText: schedData.street ? `${schedData.street}, ${schedData.barangay || ''}` : (schedData.barangay || ''),
              weightTons: item.measurement?.value,
            });
          }
        }

        if (cleanScheduleId.startsWith('spec_')) {
          try {
            const parts = cleanScheduleId.split('_');
            const idxStr = parts[parts.length - 1];
            const idx = parseInt(idxStr, 10);
            let barangaySchedId = '';
            if (parts.length >= 4 && (parts[1] === 'today' || parts[1] === 'tmrw' || parts[1] === 'upcoming')) {
              barangaySchedId = parts.slice(2, parts.length - 1).join('_');
            } else if (parts.length >= 3) {
              barangaySchedId = parts.slice(1, parts.length - 1).join('_');
            }
            if (barangaySchedId && !isNaN(idx)) {
              const bRef = doc(db, 'barangay_schedules', barangaySchedId);
              const bSnap = await getDoc(bRef);
              if (bSnap.exists()) {
                const bData = bSnap.data();
                const specific = bData.specificSchedules || bData.pickups || [];
                if (Array.isArray(specific) && specific[idx]) {
                  const updatedSpecific = [...specific];
                  updatedSpecific[idx] = {
                    ...updatedSpecific[idx],
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    completionImage: imageUrl,
                    completionNotes: item.description,
                  };
                  await updateDoc(bRef, {
                    specificSchedules: updatedSpecific,
                    pickups: updatedSpecific,
                    updatedAt: serverTimestamp(),
                  });
                }
              }
            }
          } catch (bErr) {
            console.warn('Could not update barangay_schedules doc for specific pickup:', bErr);
          }
        }
      } catch (schedErr) {
        console.warn('Could not update schedules doc on completion:', schedErr);
      }
    }

    // 2. If pickup was linked to a citizen report (or item.scheduleId itself is a report)
    const targetReportId = item.reportId ||
      (item.scheduleId?.startsWith('rep_') ? item.scheduleId.replace('rep_', '') :
       item.scheduleId?.startsWith('report_') ? item.scheduleId.replace('report_', '') : null);

    if (targetReportId) {
      try {
        const repRef = doc(db, 'reports', targetReportId);
        const repSnap = await getDoc(repRef);
        const repData = repSnap.exists() ? repSnap.data() : null;

        await setDoc(repRef, {
          status: 'resolved',
          completionImage: imageUrl,
          completionNotes: item.description,
          collectedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          resolvedByUid: item.driverUid,
          assignedDriverId: item.driverUid,
        }, { merge: true });

        if (!notifiedReportIds.has(targetReportId)) {
          notifiedReportIds.add(targetReportId);
          const citizenUid = repData?.userId || (repData as any)?.reportedByUid;
          if (citizenUid) {
            await notifyResidentCompletion({
              userId: citizenUid,
              reportId: targetReportId,
              scheduleId: item.scheduleId,
              imageUrl,
              notes: item.description,
              locationText: repData?.street ? `${repData.street}, ${repData.barangay || ''}` : (repData?.barangay || ''),
              weightTons: item.measurement?.value,
            });
          }
        }
      } catch (err) {
        console.warn('Could not update citizen report to resolved:', err);
      }
    }

    try {
      await awardVerifiedCompletion(item.scheduleId);
    } catch (error) {
      // Completion evidence is more important than the derived reward ledger.
      // CICTO can safely reconcile a missed deterministic award later.
      console.warn('Reward award will require CICTO reconciliation:', error);
    }
    await writeAuditLog('pickup.completed', 'schedule', item.scheduleId, { measurement: item.measurement, offline: item.attempts > 0 });
  } else {
    try {
      await setDoc(doc(db, 'schedules', item.scheduleId), {
        status: 'issue',
        issueImage: imageUrl,
        issueLocation: item.location,
        issueDescription: item.description,
        issueReportedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        reportedByUid: item.driverUid,
      }, { merge: true });
    } catch (issueErr) {
      console.warn('Could not record schedule issue:', issueErr);
    }
    await writeAuditLog('pickup.issue_reported', 'schedule', item.scheduleId, { offline: item.attempts > 0 });
  }
};

async function submit(action: QueueItem['action'], payload: DriverEvidencePayload): Promise<{ queued: boolean; imageUrl?: string }> {
  const network = await NetInfo.fetch();
  if (network.isConnected === false) {
    await enqueue(action, payload);
    return { queued: true };
  }

  let imageUrl: string = '';
  try {
    if (payload.imageUri && payload.imageUri.trim()) {
      const upload = await cloudinaryService.uploadImage(payload.imageUri, { folder: UPLOAD_FOLDERS.REPORTS });
      if (!upload.success || !upload.url) throw new Error(upload.error || 'Evidence upload failed');
      imageUrl = upload.url;
    }
    await persist({ ...payload, action, driverUid: auth.currentUser?.uid || '', id: '', queuedAt: '', attempts: 0 }, imageUrl);
    return { queued: false, imageUrl };
  } catch (submitErr) {
    console.warn('Direct evidence submit failed, queuing offline:', submitErr);
    await enqueue(action, payload, imageUrl);
    return { queued: true, imageUrl };
  }
}

export const submitPickupCompletion = (payload: DriverEvidencePayload) => submit('completion', payload);
export const submitPickupIssue = (payload: DriverEvidencePayload) => submit('issue', payload);

export async function syncOfflineDriverActions(): Promise<{ synced: number; remaining: number }> {
  const network = await NetInfo.fetch();
  const queue = await readQueue();
  const driverUid = auth.currentUser?.uid;
  if (network.isConnected === false || queue.length === 0) return { synced: 0, remaining: queue.length };

  const remaining: QueueItem[] = [];
  let synced = 0;
  for (const item of queue) {
    if (!driverUid || item.driverUid !== driverUid) {
      remaining.push(item);
      continue;
    }
    try {
      let imageUrl = item.uploadedUrl || '';
      if (!imageUrl && item.imageUri && item.imageUri.trim()) {
        const upload = await cloudinaryService.uploadImage(item.imageUri, { folder: UPLOAD_FOLDERS.REPORTS });
        if (!upload.success || !upload.url) throw new Error('Evidence upload failed');
        imageUrl = upload.url;
      }
      await persist({ ...item, attempts: item.attempts + 1 }, imageUrl);
      await writeAuditLog('offline_action.synced', 'schedule', item.scheduleId, { action: item.action, queuedAt: item.queuedAt });
      synced += 1;
    } catch {
      remaining.push({ ...item, attempts: item.attempts + 1 });
    }
  }
  await saveQueue(remaining);
  return { synced, remaining: remaining.length };
}

export const getOfflineQueueCount = async () => (await readQueue()).length;
