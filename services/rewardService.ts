import { auth, db } from '@/config/firebase';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

export type RewardSouvenir = {
  id: string;
  name: string;
  type: string;
  cost: number;
  stock?: number;
  category?: string;
  imageUrl?: string;
  createdAt?: any;
};

export const COMPLETION_REWARD_TOKENS = 50;
export const UNSEGREGATED_REWARD_TOKENS = 25;

export const DEFAULT_REWARD_SOUVENIRS: RewardSouvenir[] = [];

export const REWARD_SOUVENIRS = DEFAULT_REWARD_SOUVENIRS;

type ScheduleRewardSource = {
  status?: string;
  reportId?: string;
  userId?: string;
  completedByUid?: string;
  collectionMeasurement?: { value?: number };
  wasteCategory?: string;
  isUnsegregated?: boolean;
};

export type RewardReconciliation = {
  scanned: number;
  awarded: number;
  alreadyAwarded: number;
  ineligible: number;
};

export async function awardVerifiedCompletion(
  scheduleId: string,
  source?: ScheduleRewardSource,
): Promise<'awarded' | 'already-awarded' | 'ineligible'> {
  let schedule = source;
  if (!schedule) {
    try {
      const snap = await getDoc(doc(db, 'schedules', scheduleId));
      if (snap.exists()) {
        schedule = snap.data() as ScheduleRewardSource;
      }
    } catch (err: any) {
      if (err?.code !== 'permission-denied') {
        console.warn('Could not read schedule for reward award:', err);
      }
      return 'ineligible';
    }
  }
  const status = String(schedule?.status || '').toLowerCase();
  const reportId = String(schedule?.reportId || '').trim();
  const userId = String(schedule?.userId || '').trim();
  if (
    !['completed', 'done'].includes(status)
    || !reportId
    || !userId
    || !schedule?.completedByUid
    || !(Number(schedule?.collectionMeasurement?.value) > 0)
  ) return 'ineligible';

  const awardRef = doc(db, 'reward_awards', `report_${reportId}`);
  try {
    if ((await getDoc(awardRef)).exists()) return 'already-awarded';
  } catch (error: any) {
    // Drivers can create their assigned award but cannot browse citizen ledgers.
    if (error?.code !== 'permission-denied' && error?.code !== 'unavailable') throw error;
  }

  let tokensToAward = COMPLETION_REWARD_TOKENS;
  try {
    const repSnap = await getDoc(doc(db, 'reports', reportId));
    if (repSnap.exists()) {
      const repData = repSnap.data();
      const isUnseg =
        Boolean(repData.isUnsegregated) ||
        Boolean(repData.aiAnalysis?.isUnsegregated) ||
        String(repData.wasteCategory || repData.aiAnalysis?.collectionCategory || '').toLowerCase() === 'unsegregated' ||
        String(repData.aiAnalysis?.wasteType || '').toLowerCase().includes('unsegregated');
      if (isUnseg) {
        tokensToAward = UNSEGREGATED_REWARD_TOKENS;
      } else if (typeof repData.rewardPoints === 'number' && (repData.rewardPoints === 25 || repData.rewardPoints === 50)) {
        tokensToAward = repData.rewardPoints;
      }
    }
  } catch {}

  try {
    const payload = {
      userId,
      reportId,
      scheduleId,
      tokens: tokensToAward,
      reason: 'verified-collection-completed',
      createdByUid: auth.currentUser?.uid || schedule.completedByUid,
      awardedAt: serverTimestamp(),
    };
    await setDoc(awardRef, payload);
    try {
      await setDoc(doc(db, 'rewards', 'ledger', 'items', `report_${reportId}`), payload, { merge: true });
    } catch {}
  } catch (error: any) {
    // A deterministic award ID turns a second create into a denied update.
    if (error?.code === 'permission-denied') return 'already-awarded';
    throw error;
  }
  return 'awarded';
}

export async function reconcileCompletedRewardAwards(): Promise<RewardReconciliation> {
  if (!db) throw new Error('Firestore is unavailable.');
  const completed = await getDocs(query(
    collection(db, 'schedules'),
    where('status', 'in', ['completed', 'done']),
    limit(200),
  ));
  const summary: RewardReconciliation = { scanned: completed.size, awarded: 0, alreadyAwarded: 0, ineligible: 0 };
  for (const schedule of completed.docs) {
    try {
      const result = await awardVerifiedCompletion(schedule.id, schedule.data() as ScheduleRewardSource);
      if (result === 'awarded') summary.awarded += 1;
      else if (result === 'already-awarded') summary.alreadyAwarded += 1;
      else summary.ineligible += 1;
    } catch (error: any) {
      if (error?.code === 'permission-denied') throw error;
      summary.ineligible += 1;
    }
  }
  return summary;
}

export async function addRewardCatalogItem(item: {
  name: string;
  type: string;
  cost: number;
  stock?: number;
  category?: string;
  imageUrl?: string;
}) {
  if (!db) throw new Error('Firestore is unavailable.');
  const id = item.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36);
  
  const newItem: RewardSouvenir = {
    id,
    name: item.name.trim(),
    type: item.type.trim(),
    cost: Number(item.cost),
    stock: Number(item.stock || 50),
    category: item.category?.trim() || 'General',
    ...(item.imageUrl ? { imageUrl: item.imageUrl.trim() } : {}),
    createdAt: serverTimestamp(),
  };

  await setDoc(doc(db, 'reward_catalog', id), newItem);
  try {
    await setDoc(doc(db, 'rewards', 'catalog', 'items', id), newItem, { merge: true });
  } catch {}
  return newItem;
}

export async function updateRewardCatalogItem(id: string, updates: Partial<RewardSouvenir>) {
  if (!db) throw new Error('Firestore is unavailable.');
  const { updateDoc } = await import('firebase/firestore');
  const cleanUpdates = { ...updates, updatedAt: serverTimestamp() };
  await updateDoc(doc(db, 'reward_catalog', id), cleanUpdates);
  try {
    await updateDoc(doc(db, 'rewards', 'catalog', 'items', id), cleanUpdates);
  } catch {}
}

export async function deleteRewardCatalogItem(id: string) {
  if (!db) throw new Error('Firestore is unavailable.');
  const { deleteDoc } = await import('firebase/firestore');
  await deleteDoc(doc(db, 'reward_catalog', id));
  try {
    await deleteDoc(doc(db, 'rewards', 'catalog', 'items', id));
  } catch {}
}

export async function adjustCitizenPoints(
  userId: string,
  userName: string,
  deltaTokens: number,
  reason: string,
  currentBalance: number
) {
  if (!db || !auth.currentUser) throw new Error('Authentication required.');

  const awardDocRef = doc(collection(db, 'reward_awards'));
  const timestamp = serverTimestamp();

  const awardPayload = {
    userId,
    userName,
    tokens: deltaTokens,
    reason: `cicto_adjustment: ${reason.trim()}`,
    adjustedBy: 'CICTO Super Admin',
    createdByUid: auth.currentUser.uid,
    actorEmail: auth.currentUser.email || 'cicto@trashtrack.gov.ph',
    awardedAt: timestamp,
    previousBalance: currentBalance,
    newBalance: Math.max(0, currentBalance + deltaTokens),
  };

  await setDoc(awardDocRef, awardPayload);
  try {
    await setDoc(doc(db, 'rewards', 'ledger', 'items', awardDocRef.id), awardPayload, { merge: true });
  } catch {}

  // Record into client activity audit trail
  try {
    const { writeAuditLog } = await import('./auditLogService');
    await writeAuditLog('notification.preferences_updated' as any, 'citizen_points', userId, {
      action: 'cicto_adjust_points',
      actorEmail: auth.currentUser.email || 'cicto@trashtrack.gov.ph',
      deltaTokens,
      reason,
      previousBalance: currentBalance,
      newBalance: Math.max(0, currentBalance + deltaTokens),
    });
  } catch (auditErr) {
    console.warn('Audit logging note:', auditErr);
  }

  return {
    id: awardDocRef.id,
    deltaTokens,
    newBalance: Math.max(0, currentBalance + deltaTokens),
  };
}

export async function redeemRewardFromLedger(userId: string, userName: string, souvenir: RewardSouvenir) {
  if (!db || !auth.currentUser) throw new Error('An authenticated CICTO account is required.');
  const redemption = await addDoc(collection(db, 'reward_redemptions'), {
    userId,
    userName,
    souvenirId: souvenir.id,
    souvenirName: souvenir.name,
    cost: souvenir.cost,
    issuedByUid: auth.currentUser.uid,
    issuedAt: serverTimestamp(),
    status: 'completed',
    mode: 'spark-ledger',
  });

  if (souvenir.id) {
    try {
      const { runTransaction } = await import('firebase/firestore');
      const souvenirRef = doc(db, 'reward_catalog', souvenir.id);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(souvenirRef);
        if (snap.exists()) {
          const curStock = typeof snap.data()?.stock === 'number' ? snap.data().stock : 50;
          tx.update(souvenirRef, {
            stock: Math.max(0, curStock - 1),
            updatedAt: serverTimestamp(),
          });
        }
      });
    } catch (e) {
      console.warn('Could not decrement catalog stock:', e);
    }
  }

  return redemption.id;
}

export type RewardRequest = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  barangay: string;
  souvenirId: string;
  souvenirName: string;
  souvenirType?: string;
  cost: number;
  imageUrl?: string;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled';
  notes?: string;
  createdAt?: any;
  confirmedAt?: any;
  confirmedByUid?: string;
  confirmedByName?: string;
  confirmedByRole?: string;
  confirmedBarangay?: string;
  declinedAt?: any;
  declinedByUid?: string;
  declinedByName?: string;
  declinedReason?: string;
  redemptionId?: string;
};

export async function submitRewardRequest(params: {
  userId: string;
  userName: string;
  userEmail: string;
  barangay: string;
  souvenir: RewardSouvenir;
  notes?: string;
}) {
  if (!db || !auth.currentUser) throw new Error('Authentication required to submit request.');
  const { userId, userName, userEmail, barangay, souvenir, notes } = params;

  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists() && userSnap.data()?.verificationStatus === 'rejected') {
    const reason = userSnap.data()?.rejectionReason;
    throw new Error(`Your proof of residency was rejected${reason ? ` (${reason})` : ''}. Eco-merch redemptions are restricted until a valid Danao City ID is verified.`);
  }

  const docRef = await addDoc(collection(db, 'reward_requests'), {
    userId,
    userName: userName || 'Resident',
    userEmail: userEmail || auth.currentUser.email || '',
    barangay: barangay || 'Poblacion',
    souvenirId: souvenir.id,
    souvenirName: souvenir.name,
    souvenirType: souvenir.type || '',
    cost: Number(souvenir.cost || 0),
    imageUrl: souvenir.imageUrl || '',
    status: 'pending',
    notes: (notes || '').trim(),
    createdAt: serverTimestamp(),
  });

  // Dispatch in-app notification confirming submission
  if (userId) {
    const notifBody = `Your redemption request for "${souvenir.name}" (${Number(souvenir.cost || 0).toLocaleString()} tokens) has been submitted and is pending coordinator review at Brgy. ${barangay || 'Hall'}.`;
    await addDoc(collection(db, 'userNotifications'), {
      userId,
      title: '📋 Eco-Reward Request Submitted',
      body: notifBody,
      message: notifBody,
      type: 'reward_pending',
      read: false,
      createdAt: serverTimestamp(),
    }).catch(() => undefined);
  }

  return docRef.id;
}

export async function confirmRewardRequest(
  request: RewardRequest,
  staff: { uid: string; name: string; role: string; email?: string; barangay?: string }
) {
  if (!db || !auth.currentUser) throw new Error('Staff authentication required.');

  const { runTransaction } = await import('firebase/firestore');
  const reqRef = doc(db, 'reward_requests', request.id);
  const redemptionRef = doc(collection(db, 'reward_redemptions'));
  const cost = Number(request.cost || 0);

  await runTransaction(db, async (tx) => {
    // 1. ALL READS FIRST (Firestore transactions strictly require all reads before any writes)
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) {
      throw new Error('Reward request not found.');
    }
    if (reqSnap.data()?.status !== 'pending') {
      throw new Error('This reward request has already been processed.');
    }

    let userSnap = null;
    const userRef = request.userId ? doc(db, 'users', request.userId) : null;
    if (userRef) {
      userSnap = await tx.get(userRef);
    }

    let souvenirSnap = null;
    const souvenirRef = request.souvenirId ? doc(db, 'reward_catalog', request.souvenirId) : null;
    if (souvenirRef) {
      souvenirSnap = await tx.get(souvenirRef);
    }

    // 2. ALL WRITES AFTER ALL READS
    // A. Record in reward_redemptions (marks as official released redemption)
    tx.set(redemptionRef, {
      userId: request.userId,
      userName: request.userName,
      userEmail: request.userEmail || '',
      barangay: request.barangay || '',
      souvenirId: request.souvenirId,
      souvenirName: request.souvenirName,
      cost,
      requestId: request.id,
      issuedByUid: staff.uid,
      issuedByName: staff.name,
      issuedByRole: staff.role,
      confirmedBarangay: staff.barangay || request.barangay || '',
      issuedAt: serverTimestamp(),
      status: 'completed',
      mode: 'barangay-release',
    });

    // B. Update the reward_requests document to confirmed
    tx.update(reqRef, {
      status: 'confirmed',
      redemptionId: redemptionRef.id,
      confirmedByUid: staff.uid,
      confirmedByName: staff.name,
      confirmedByRole: staff.role,
      confirmedBarangay: staff.barangay || request.barangay || '',
      confirmedAt: serverTimestamp(),
    });

    // C. Decrement stock in reward_catalog if souvenir exists
    if (souvenirRef && souvenirSnap?.exists()) {
      const curStock = typeof souvenirSnap.data()?.stock === 'number' ? souvenirSnap.data().stock : 50;
      tx.update(souvenirRef, {
        stock: Math.max(0, curStock - 1),
        updatedAt: serverTimestamp(),
      });
    }

    // D. Synchronize tokens, points & rewardTokens on the resident's user document if present
    if (userRef && userSnap?.exists()) {
      const uData = userSnap.data() || {};
      const hasBalanceField =
        typeof uData.tokens === 'number' ||
        typeof uData.points === 'number' ||
        typeof uData.rewardTokens === 'number';
      if (hasBalanceField) {
        const currentBal = Number(uData.tokens ?? uData.points ?? uData.rewardTokens ?? 0);
        const nextBal = Math.max(0, currentBal - cost);
        tx.update(userRef, {
          tokens: nextBal,
          points: nextBal,
          rewardTokens: nextBal,
          updatedAt: serverTimestamp(),
        });
      }
    }
  });

  // 4. Dispatch in-app notification to the resident
  if (request.userId) {
    const brgyName = staff.barangay || request.barangay ? `Brgy. ${staff.barangay || request.barangay} Coordinator` : 'CENRO Officer';
    const notifBody = `Your request for "${request.souvenirName}" has been confirmed by your ${brgyName}. ${cost.toLocaleString()} tokens were deducted. Please claim your item at your Barangay Hall.`;
    await addDoc(collection(db, 'userNotifications'), {
      userId: request.userId,
      title: '🎁 Eco-Reward Confirmed & Released!',
      body: notifBody,
      message: notifBody,
      type: 'reward_confirmed',
      read: false,
      createdAt: serverTimestamp(),
    }).catch(() => undefined);
  }

  return redemptionRef.id;
}

export async function declineRewardRequest(
  requestOrId: string | RewardRequest,
  reason: string,
  staff: { uid: string; name: string; role?: string; barangay?: string },
  requestData?: Partial<RewardRequest>
) {
  if (!db || !auth.currentUser) throw new Error('Staff authentication required.');

  const requestId = typeof requestOrId === 'string' ? requestOrId : requestOrId.id;
  let reqData: any = typeof requestOrId === 'object' ? requestOrId : (requestData || null);

  if (!reqData && db) {
    try {
      const snap = await getDoc(doc(db, 'reward_requests', requestId));
      if (snap.exists()) {
        reqData = snap.data();
      }
    } catch (e) {
      console.warn('Could not fetch request details for decline notification:', e);
    }
  }

  await updateDoc(doc(db, 'reward_requests', requestId), {
    status: 'declined',
    declinedReason: (reason || 'Not available at barangay hall').trim(),
    declinedByUid: staff.uid,
    declinedByName: staff.name,
    declinedAt: serverTimestamp(),
  });

  // Dispatch in-app notification to the resident
  if (reqData?.userId) {
    const trimmedReason = (reason || '').trim();
    const reasonText = trimmedReason ? `: "${trimmedReason}"` : '.';
    const notifBody = `Your eco-reward request for "${reqData.souvenirName || 'Eco-Reward'}" was declined${reasonText} No tokens were deducted from your account.`;
    await addDoc(collection(db, 'userNotifications'), {
      userId: reqData.userId,
      title: '❌ Eco-Reward Request Declined',
      body: notifBody,
      message: notifBody,
      type: 'reward_declined',
      read: false,
      createdAt: serverTimestamp(),
    }).catch(() => undefined);
  }
}

export async function cancelRewardRequest(
  requestOrId: string | RewardRequest,
  userId?: string,
  requestData?: Partial<RewardRequest>
) {
  if (!db || !auth.currentUser) throw new Error('Authentication required.');

  const requestId = typeof requestOrId === 'string' ? requestOrId : requestOrId.id;
  let reqData: any = typeof requestOrId === 'object' ? requestOrId : (requestData || null);

  if (!reqData && db) {
    try {
      const snap = await getDoc(doc(db, 'reward_requests', requestId));
      if (snap.exists()) {
        reqData = snap.data();
      }
    } catch (e) {
      console.warn('Could not fetch request details for cancel notification:', e);
    }
  }

  const effectiveUserId = userId || reqData?.userId || auth.currentUser.uid;

  await updateDoc(doc(db, 'reward_requests', requestId), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
  });

  // Dispatch in-app notification to the resident
  if (effectiveUserId) {
    const souvenirName = reqData?.souvenirName || 'Eco-Reward';
    const notifBody = `Your redemption request for "${souvenirName}" has been cancelled. No tokens were deducted from your account.`;
    await addDoc(collection(db, 'userNotifications'), {
      userId: effectiveUserId,
      title: '⚠️ Eco-Reward Request Cancelled',
      body: notifBody,
      message: notifBody,
      type: 'reward_cancelled',
      read: false,
      createdAt: serverTimestamp(),
    }).catch(() => undefined);
  }
}

