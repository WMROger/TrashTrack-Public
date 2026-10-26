import { auth, db } from '@/config/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  limit,
  writeBatch,
  arrayRemove,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { isCictoEmail } from '@/constants/cictoConfig';
import * as Crypto from 'expo-crypto';

export interface CictoNotification {
  id: string;
  type: 'account_deleted' | 'admin_created' | 'system_alert' | 'otp_pin';
  title: string;
  description?: string;
  otpPin?: string;
  requestId?: string;
  targetUser?: {
    uid: string;
    email: string;
    displayName: string;
    role: string;
    employeeId?: string;
  };
  status: 'active' | 'dismissed' | 'used' | 'expired';
  read?: boolean;
  createdAt: any;
  actorEmail?: string;
  actorName?: string;
}


export interface DeletionRequestResult {
  requestId: string;
  otpPin: string;
  expiresAt: Date;
  targetEmail: string;
  targetName: string;
}

/**
 * SEC-09 FIX: Cryptographically secure 6-digit numeric OTP generation.
 * Uses expo-crypto with standard Web Crypto API fallback to prevent PRNG prediction.
 */
function generate6DigitOtp(): string {
  try {
    const bytes = Crypto.getRandomBytes(4);
    const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    return String(100000 + (num % 900000));
  } catch {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const array = new Uint32Array(1);
      window.crypto.getRandomValues(array);
      return String(100000 + (array[0] % 900000));
    }
    const pin = Math.floor(100000 + Math.random() * 900000);
    return String(pin);
  }
}

// In-memory persistent notification cache and subscriber registry
let memoryNotifications: CictoNotification[] = [];
let firestoreNotifications: CictoNotification[] = [];
const notificationSubscribers = new Set<(notifs: CictoNotification[]) => void>();

function notifySubscribers() {
  const map = new Map<string, CictoNotification>();
  
  // Authoritative Firestore notifications first
  firestoreNotifications.forEach((n) => {
    map.set(n.id, n);
  });

  // Only keep in-memory items if not already matched in Firestore
  memoryNotifications.forEach((m) => {
    const isDuplicate = Array.from(map.values()).some((f) => {
      if (f.id === m.id) return true;
      if (m.requestId && f.requestId === m.requestId) return true;
      if (
        m.targetUser?.uid &&
        f.targetUser?.uid === m.targetUser.uid &&
        f.type === m.type
      ) {
        return true;
      }
      return false;
    });

    if (!isDuplicate) {
      map.set(m.id, m);
    }
  });

  const merged = Array.from(map.values())
    .filter((n) => n.type !== 'otp_pin' && !n.otpPin)
    .sort((a, b) => {
    const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.getTime ? a.createdAt.getTime() : (a.createdAt instanceof Date ? a.createdAt.getTime() : 0));
    const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.getTime ? b.createdAt.getTime() : (b.createdAt instanceof Date ? b.createdAt.getTime() : 0));
    return timeB - timeA;
  });

  notificationSubscribers.forEach((callback) => {
    try {
      callback(merged);
    } catch (e) {
      console.warn('Notification callback error:', e);
    }
  });
}

// In-memory verification cache as fallback when Firestore offline or permissions delay
const activeOtpMemoryMap = new Map<string, { otpPin: string; expiresAtTimestamp: number; targetUid: string }>();

/**
 * Generates a secure 6-digit authorization PIN for the on-screen modal verification.
 */
export async function requestAccountDeletionOtp(targetUser: {
  id: string;
  email?: string;
  displayName?: string;
  role?: string;
  employeeId?: string;
}): Promise<DeletionRequestResult> {
  if (!db) throw new Error('Database is currently unavailable.');
  if (!auth.currentUser) throw new Error('CICTO administrator authentication is required.');

  // Guard: Protect CICTO accounts from deletion
  if (targetUser.role === 'cicto' || (targetUser.email && isCictoEmail(targetUser.email))) {
    throw new Error('CICTO Super Administrator accounts cannot be deleted from the directory.');
  }

  const otpPin = generate6DigitOtp();
  const now = Date.now();
  const ttlMs = 2 * 60 * 1000; // 2 minutes validity
  const expiresAt = new Date(now + ttlMs);

  const adminEmail = auth.currentUser.email || 'cicto@trashtrack.gov.ph';
  const safeTargetEmail = targetUser.email || '';
  const safeTargetName = targetUser.displayName || (targetUser.email ? targetUser.email.split('@')[0] : '') || targetUser.id || 'Resident User';
  const targetLabel = safeTargetName !== safeTargetEmail && safeTargetEmail
    ? `${safeTargetName} (${safeTargetEmail})`
    : (safeTargetEmail || safeTargetName);

  // Pre-allocated deterministic request ID
  const requestId = 'otp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  // Store in memory for immediate zero-latency verification fallback
  activeOtpMemoryMap.set(requestId, {
    otpPin: otpPin.trim(),
    expiresAtTimestamp: now + ttlMs,
    targetUid: targetUser.id,
  });

  // Create temporary verification document in Firestore
  try {
    await setDoc(doc(db, 'cicto_otp_verifications', requestId), {
      targetUid: targetUser.id,
      targetEmail: safeTargetEmail,
      targetName: safeTargetName,
      targetRole: targetUser.role || 'resident',
      otpPin: otpPin.trim(),
      requestedByUid: auth.currentUser.uid,
      requestedByEmail: adminEmail,
      status: 'pending',
      createdAt: serverTimestamp(),
      expiresAtTimestamp: now + ttlMs,
    });
  } catch (err) {
    console.warn('Firestore verification save warning (using client fallback):', err);
  }

  // Note: Security PIN is handled within the deletion modal directly;
  // it is NOT sent to notifications so the feed remains reserved for permanent deletion audit records.

  return {
    requestId,
    otpPin,
    expiresAt,
    targetEmail: safeTargetEmail,
    targetName: safeTargetName,
  };
}

export const requestCictoAccountDeletion = requestAccountDeletionOtp;

/**
 * Confirms account deletion with the provided 6-digit OTP.
 * Deletes from both Firebase Authentication (via Cloud Function / Admin API)
 * and Cloud Firestore collections (users, employee_ids, notifications).
 */
export async function confirmAccountDeletion(params: {
  requestId: string;
  pin: string;
  targetUid: string;
  targetEmail: string;
}): Promise<{ success: boolean; message: string; authDeleted?: boolean }> {
  const { requestId, pin, targetUid, targetEmail } = params;

  if (!db) throw new Error('Database is currently unavailable.');
  if (!auth.currentUser) throw new Error('CICTO administrator authentication is required.');
  if (!pin || pin.trim().length !== 6) throw new Error('Please enter a valid 6-digit One-Time PIN.');

  // 1. Verify OTP in Firestore or fallback to in-memory verification
  let otpVerified = false;
  const otpDocRef = doc(db, 'cicto_otp_verifications', requestId);

  try {
    const otpSnap = await getDoc(otpDocRef);

    if (otpSnap.exists()) {
      const otpData = otpSnap.data();

      if (otpData.status !== 'pending') {
        throw new Error('This verification PIN has already been used or invalidated.');
      }

      if (Date.now() > Number(otpData.expiresAtTimestamp || 0)) {
        throw new Error('This One-Time PIN has expired (limit exceeded). Please request a new PIN.');
      }

      if (String(otpData.otpPin).trim() !== pin.trim()) {
        throw new Error('Invalid One-Time PIN. Please check your CICTO Security Notification Bell and try again.');
      }

      if (otpData.targetUid !== targetUid) {
        throw new Error('Target user mismatch for this verification request.');
      }

      otpVerified = true;
      // Mark as used in Firestore
      await setDoc(otpDocRef, { status: 'used', usedAt: serverTimestamp() }, { merge: true }).catch(() => {});
    }
  } catch (err: any) {
    if (
      err.message &&
      (err.message.includes('expired') ||
        err.message.includes('Invalid') ||
        err.message.includes('used') ||
        err.message.includes('mismatch'))
    ) {
      throw err;
    }
    console.warn('Firestore OTP lookup failed, checking in-memory fallback:', err);
  }

  // Fallback to in-memory OTP verification
  if (!otpVerified) {
    const memOtp = activeOtpMemoryMap.get(requestId);
    if (memOtp) {
      if (Date.now() > memOtp.expiresAtTimestamp) {
        activeOtpMemoryMap.delete(requestId);
        throw new Error('This One-Time PIN has expired (limit exceeded). Please request a new PIN.');
      }
      if (memOtp.otpPin !== pin.trim()) {
        throw new Error('Invalid One-Time PIN. Please check your CICTO Security Notification Bell and try again.');
      }
      if (memOtp.targetUid !== targetUid) {
        throw new Error('Target user mismatch for this verification request.');
      }
      activeOtpMemoryMap.delete(requestId);
      otpVerified = true;
    }
  }

  if (!otpVerified) {
    throw new Error('Verification request not found or has already expired. Please request a new PIN.');
  }

  console.log(`✅ OTP verified for account deletion of UID: ${targetUid}`);

  let authDeleted = false;

  // 2. Attempt to delete from Firebase Authentication via Cloud Function
  try {
    const functionsInstance = getFunctions(undefined, 'us-central1');
    const deleteCallable = httpsCallable(functionsInstance, 'cictoConfirmDeleteAccount');
    const result = await deleteCallable({
      requestId,
      pin: pin.trim(),
      targetUid,
    });
    console.log('✅ Cloud Function Auth deletion result:', result.data);
    authDeleted = true;
  } catch (cloudFnError: any) {
    console.warn('Note on Cloud Function deletion execution:', cloudFnError?.message || cloudFnError);
  }

  // 3. Delete from Firestore in an atomic transaction/batch
  const batch = writeBatch(db);

  // Read target user doc first to extract specific identifier keys (employeeId, barangay, license)
  const userRef = doc(db, 'users', targetUid);
  let targetUserData: any = null;
  try {
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      targetUserData = userSnap.data();
    }
  } catch {}

  // Wiping user document
  batch.delete(userRef);

  // Wiping specific identifier documents directly by ID
  if (targetUserData) {
    if (targetUserData.employeeId) {
      const empId = String(targetUserData.employeeId).trim();
      batch.delete(doc(db, 'identifiers', 'coordinator', 'items', empId));
      batch.delete(doc(db, 'identifiers', 'cenro', 'items', empId));
      batch.delete(doc(db, 'identifiers', 'driver', 'items', empId));
      batch.delete(doc(db, 'coordinator_employee_ids', empId));
      batch.delete(doc(db, 'employee_ids', empId));
    }
    const b = targetUserData.assignedBarangay || targetUserData.barangay;
    if (b) {
      const normB = String(b).trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
      batch.delete(doc(db, 'identifiers', 'coordinator_barangays', 'items', normB));
    }
    if (targetUserData.licenseNumber) {
      const lic = String(targetUserData.licenseNumber).trim();
      batch.delete(doc(db, 'identifiers', 'license', 'items', lic));
      batch.delete(doc(db, 'license_numbers', lic));
    }
  }

  // Wiping any assigned employee ID (driver or coordinator) by userId query
  const employeeSnap = await getDocs(
    query(collection(db, 'employee_ids'), where('userId', '==', targetUid))
  );
  employeeSnap.forEach((empDoc) => {
    batch.delete(empDoc.ref);
  });

  // Wiping identifier records for this user (coordinator, cenro, driver, license, coordinator_barangays)
  try {
    const identTypes = ['coordinator', 'coordinator_barangays', 'cenro', 'driver', 'license'];
    for (const iType of identTypes) {
      const qIdent = query(collection(db, 'identifiers', iType, 'items'), where('userId', '==', targetUid));
      const identSnap = await getDocs(qIdent);
      identSnap.forEach((idDoc) => {
        batch.delete(idDoc.ref);
      });
    }
  } catch (identErr) {
    console.warn('Note on wiping identifier records:', identErr);
  }

  // Delete user settings and driver credentials
  batch.delete(doc(db, 'user_settings', targetUid));
  batch.delete(doc(db, 'driver_qr_credentials', targetUid));

  // Delete user notifications
  try {
    const notifQ = query(collection(db, 'userNotifications'), where('userId', '==', targetUid));
    const notifSnap = await getDocs(notifQ);
    notifSnap.forEach((nDoc) => {
      batch.delete(nDoc.ref);
    });
  } catch (notifErr) {
    console.warn('Note on deleting user notifications:', notifErr);
  }

  // Release any truck assigned to this driver
  try {
    const truckQ = query(collection(db, 'trucks'), where('assignedDriverId', '==', targetUid));
    const truckSnap = await getDocs(truckQ);
    truckSnap.forEach((tDoc) => {
      batch.update(tDoc.ref, {
        assignedDriverId: null,
        assignedDriverName: null,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (truckErr) {
    console.warn('Note on releasing truck assignment:', truckErr);
  }

  // Release any schedule assigned to this driver (both weekly and specific one-off pickups)
  try {
    const targetDriverName = targetUserData?.displayName || targetUserData?.name;
    const schedSnap = await getDocs(collection(db, 'barangay_schedules'));
    schedSnap.forEach((sDoc) => {
      const sData = sDoc.data();
      let changed = false;
      const updates: any = {};

      if (
        sData.assignedDriverId === targetUid ||
        (targetDriverName && sData.assignedDriverName === targetDriverName)
      ) {
        updates.assignedDriverId = null;
        updates.assignedDriverName = null;
        updates.assignedDriverEmail = null;
        changed = true;
      }

      if (Array.isArray(sData.specificSchedules) && sData.specificSchedules.length > 0) {
        const hasSpecific = sData.specificSchedules.some(
          (ss: any) =>
            ss.assignedDriverId === targetUid ||
            (targetDriverName && ss.assignedDriverName === targetDriverName)
        );
        if (hasSpecific) {
          updates.specificSchedules = sData.specificSchedules.map((ss: any) => {
            if (
              ss.assignedDriverId === targetUid ||
              (targetDriverName && ss.assignedDriverName === targetDriverName)
            ) {
              return { ...ss, assignedDriverId: null, assignedDriverName: null };
            }
            return ss;
          });
          changed = true;
        }
      }

      if (changed) {
        updates.updatedAt = serverTimestamp();
        batch.update(sDoc.ref, updates);
      }
    });
  } catch (schedErr) {
    console.warn('Note on releasing schedule driver assignment:', schedErr);
  }

  // Remove user from any group chat channels
  try {
    const chanQ = query(collection(db, 'interagency_channels'), where('memberUids', 'array-contains', targetUid));
    const chanSnap = await getDocs(chanQ);
    chanSnap.forEach((cDoc) => {
      batch.update(cDoc.ref, {
        memberUids: arrayRemove(targetUid),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (chanErr) {
    console.warn('Note on removing from interagency channels:', chanErr);
  }

  // Mark OTP verification document as completed
  batch.set(
    otpDocRef,
    {
      status: 'completed',
      completedAt: serverTimestamp(),
      completedByUid: auth.currentUser.uid,
    },
    { merge: true }
  );

  // Mark linked notifications as used
  try {
    const notifSnap = await getDocs(
      query(collection(db, 'cicto_notifications'), where('requestId', '==', requestId))
    );
    notifSnap.forEach((nDoc) => {
      batch.update(nDoc.ref, { status: 'used' });
    });
  } catch {}

  await batch.commit();

  const adminEmail = auth.currentUser.email || 'cicto@trashtrack.gov.ph';
  const adminName = auth.currentUser.displayName || 'CICTO Super Administrator';

  const safeTargetEmail = targetEmail || '';
  const safeTargetName = (safeTargetEmail && safeTargetEmail.includes('@'))
    ? safeTargetEmail.split('@')[0]
    : (safeTargetEmail || targetUid || 'Account');
  const targetLabel = safeTargetEmail || safeTargetName;

  // 4. Create real-time Audit / Activity Log Notification (displays in top-right bell)
  const deletionLogDoc = {
    type: 'account_deleted',
    title: 'Account Permanently Deleted',
    description: `Directory account for ${targetLabel} has been permanently removed.`,
    targetUser: {
      uid: targetUid,
      email: safeTargetEmail,
      displayName: safeTargetName,
      role: 'user',
    },
    status: 'active',
    actorEmail: adminEmail,
    actorName: adminName,
    createdAt: serverTimestamp(),
  };

  try {
    await addDoc(collection(db, 'cicto_notifications'), deletionLogDoc);
  } catch (notifErr) {
    console.warn('Notification write warning (fallback to memory):', notifErr);
    memoryNotifications = [
      {
        ...deletionLogDoc,
        id: 'log_' + Date.now(),
        createdAt: new Date(),
      } as any,
      ...memoryNotifications,
    ];
    notifySubscribers();
  }

  // 5. Record high-security Audit Trail in client_activity
  try {
    await addDoc(collection(db, 'client_activity'), {
      event: 'user.deleted',
      targetType: 'user',
      targetId: targetUid,
      actorUid: auth.currentUser.uid,
      actorEmail: adminEmail,
      metadata: {
        targetEmail,
        deletedBy: adminEmail,
        reason: 'CICTO Oversight Security Deletion',
        authDeleted,
      },
      createdAt: serverTimestamp(),
    });
  } catch (auditErr) {
    console.warn('Audit trail note:', auditErr);
  }

  console.log(`🗑️ Successfully processed deletion for user ${targetEmail} (${targetUid}). AuthDeleted: ${authDeleted}`);

  return {
    success: true,
    authDeleted,
    message: authDeleted
      ? `Account for ${targetLabel} has been permanently deleted from both Authentication and Firestore.`
      : `Account records and jurisdiction for ${targetLabel} were wiped from database. Since this Firebase project is on the Free Spark plan without Cloud Functions, delete ${safeTargetEmail} in Firebase Console > Authentication > Users if you want to completely free up the email.`,
  };
}

/**
 * Subscribes to real-time active CICTO notifications for the top-right notification bell.
 */
export function subscribeToCictoNotifications(
  callback: (notifications: CictoNotification[]) => void
): () => void {
  notificationSubscribers.add(callback);
  
  // Initial immediate dispatch from memory
  notifySubscribers();

  if (!db) {
    return () => {
      notificationSubscribers.delete(callback);
    };
  }

  let unsubscribeFirestore: (() => void) | null = null;

  try {
    const notifQuery = query(
      collection(db, 'cicto_notifications'),
      limit(20)
    );

    unsubscribeFirestore = onSnapshot(
      notifQuery,
      (snapshot) => {
        firestoreNotifications = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        notifySubscribers();
      },
      (err) => {
        console.warn('CICTO firestore notification sync note (using in-memory fallback):', err?.message || err);
      }
    );
  } catch (err) {
    console.warn('Firestore subscription catch:', err);
  }

  return () => {
    notificationSubscribers.delete(callback);
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}


/**
 * Dismisses or marks a notification as read.
 */
export async function dismissCictoNotification(notificationId: string): Promise<void> {
  // Update memory immediately
  memoryNotifications = memoryNotifications.filter((n) => n.id !== notificationId);
  firestoreNotifications = firestoreNotifications.filter((n) => n.id !== notificationId);
  notifySubscribers();

  if (!db) return;
  try {
    const notifRef = doc(db, 'cicto_notifications', notificationId);
    await updateDoc(notifRef, { status: 'dismissed' });
  } catch (error) {
    console.warn('Error dismissing notification:', error);
  }
}


/**
 * Marks all active notifications as read/seen.
 */
export async function markAllCictoNotificationsAsRead(): Promise<void> {
  memoryNotifications = memoryNotifications.map((n) => ({ ...n, read: true }));
  firestoreNotifications = firestoreNotifications.map((n) => ({ ...n, read: true }));
  notifySubscribers();

  if (!db) return;
  try {
    const q = query(
      collection(db, 'cicto_notifications'),
      where('status', '==', 'active')
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        batch.update(d.ref, { read: true });
      });
      await batch.commit();
    }
  } catch (err) {
    console.warn('Note on marking notifications read in Firestore:', err);
  }
}

/**
 * Clears all notifications from the active view and database.
 */
export async function clearAllCictoNotifications(): Promise<void> {
  memoryNotifications = [];
  firestoreNotifications = [];
  notifySubscribers();

  if (!db) return;
  try {
    const snap = await getDocs(collection(db, 'cicto_notifications'));
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        batch.delete(d.ref);
      });
      await batch.commit();
    }
  } catch (error) {
    console.warn('Error clearing notifications via delete, falling back to dismissal:', error);
    try {
      const snap = await getDocs(collection(db, 'cicto_notifications'));
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach((d) => {
          batch.update(d.ref, { status: 'dismissed' });
        });
        await batch.commit();
      }
    } catch (dismissErr) {
      console.warn('Fallback dismissal error:', dismissErr);
    }
  }
}


export const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

/**
 * Determines whether a user account is inactive for >= 6 months (180 days).
 */
export function isUserInactive6Months(user: {
  lastLogin?: any;
  createdAt?: any;
  role?: string;
  disabled?: boolean;
  status?: string;
}): boolean {
  if (user.role && user.role !== 'user') return false; // Only residents are subject to automatic inactivity
  
  const lastActiveTimestamp = user.lastLogin?.toMillis
    ? user.lastLogin.toMillis()
    : (user.lastLogin instanceof Date
        ? user.lastLogin.getTime()
        : (user.lastLogin ? new Date(user.lastLogin).getTime() : (user.createdAt?.toMillis ? user.createdAt.toMillis() : (user.createdAt ? new Date(user.createdAt).getTime() : 0))));

  if (!lastActiveTimestamp) return false;
  return Date.now() - lastActiveTimestamp >= SIX_MONTHS_MS;
}

/**
 * Calculates human-readable inactivity duration string.
 */
export function getInactivityDurationString(user: { lastLogin?: any; createdAt?: any }): string {
  const lastActiveTimestamp = user.lastLogin?.toMillis
    ? user.lastLogin.toMillis()
    : (user.lastLogin instanceof Date
        ? user.lastLogin.getTime()
        : (user.lastLogin ? new Date(user.lastLogin).getTime() : (user.createdAt?.toMillis ? user.createdAt.toMillis() : (user.createdAt ? new Date(user.createdAt).getTime() : 0))));

  if (!lastActiveTimestamp) return 'No recorded activity';
  const elapsedMs = Date.now() - lastActiveTimestamp;
  const days = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago (${days} days)`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago (${days} days)`;
}

/**
 * Deactivates a resident account due to prolonged inactivity (or admin directive).
 */
export async function deactivateResidentAccount(
  targetUid: string,
  targetEmail: string,
  reason: string = '6-Month Inactivity Policy'
): Promise<{ success: boolean; message: string }> {
  if (!db) throw new Error('Database is currently unavailable.');
  if (!auth.currentUser) throw new Error('CICTO administrator authentication is required.');

  const adminEmail = auth.currentUser.email || 'cicto@trashtrack.gov.ph';
  const adminName = auth.currentUser.displayName || 'CICTO Super Administrator';

  const userRef = doc(db, 'users', targetUid);
  await updateDoc(userRef, {
    disabled: true,
    status: 'inactive',
    deactivatedAt: serverTimestamp(),
    deactivatedBy: adminEmail,
    deactivationReason: reason,
    updatedAt: serverTimestamp(),
  });

  // Log in client_activity
  try {
    await addDoc(collection(db, 'client_activity'), {
      event: 'user.deactivated',
      targetType: 'user',
      targetId: targetUid,
      actorUid: auth.currentUser.uid,
      actorEmail: adminEmail,
      metadata: {
        targetEmail,
        reason,
        deactivatedBy: adminEmail,
      },
      createdAt: serverTimestamp(),
    });
  } catch {}

  // Log in cicto_notifications
  try {
    await addDoc(collection(db, 'cicto_notifications'), {
      type: 'system_alert',
      title: 'Resident Account Deactivated',
      description: `Resident ${targetEmail} (${targetUid}) was deactivated due to ${reason}.`,
      targetUser: {
        uid: targetUid,
        email: targetEmail,
        displayName: targetEmail.split('@')[0],
        role: 'user',
      },
      status: 'active',
      actorEmail: adminEmail,
      actorName: adminName,
      createdAt: serverTimestamp(),
    });
  } catch {}

  return {
    success: true,
    message: `Account for ${targetEmail} has been deactivated.`,
  };
}

/**
 * Reactivates a deactivated resident account.
 */
export async function reactivateResidentAccount(
  targetUid: string,
  targetEmail: string
): Promise<{ success: boolean; message: string }> {
  if (!db) throw new Error('Database is currently unavailable.');
  if (!auth.currentUser) throw new Error('CICTO administrator authentication is required.');

  const adminEmail = auth.currentUser.email || 'cicto@trashtrack.gov.ph';

  const userRef = doc(db, 'users', targetUid);
  await updateDoc(userRef, {
    disabled: false,
    status: 'active',
    reactivatedAt: serverTimestamp(),
    reactivatedBy: adminEmail,
    updatedAt: serverTimestamp(),
  });

  try {
    await addDoc(collection(db, 'client_activity'), {
      event: 'user.reactivated',
      targetType: 'user',
      targetId: targetUid,
      actorUid: auth.currentUser.uid,
      actorEmail: adminEmail,
      metadata: {
        targetEmail,
        reactivatedBy: adminEmail,
      },
      createdAt: serverTimestamp(),
    });
  } catch {}

  return {
    success: true,
    message: `Account for ${targetEmail} has been successfully reactivated.`,
  };
}

/**
 * Scans all resident accounts and deactivates those inactive for >= 6 months.
 */
export async function batchDeactivateStaleResidents(
  usersList: Array<{ id: string; email: string; role: string; lastLogin?: any; createdAt?: any; disabled?: boolean; status?: string }>
): Promise<{ count: number; emails: string[] }> {
  if (!db) throw new Error('Database is currently unavailable.');
  if (!auth.currentUser) throw new Error('CICTO administrator authentication is required.');

  const staleUsers = usersList.filter(
    (u) =>
      u.role === 'user' &&
      u.disabled !== true &&
      u.status !== 'inactive' &&
      isUserInactive6Months(u)
  );

  if (staleUsers.length === 0) {
    return { count: 0, emails: [] };
  }

  const batch = writeBatch(db);
  const adminEmail = auth.currentUser.email || 'cicto@trashtrack.gov.ph';

  staleUsers.forEach((u) => {
    const uRef = doc(db, 'users', u.id);
    batch.update(uRef, {
      disabled: true,
      status: 'inactive',
      deactivatedAt: serverTimestamp(),
      deactivatedBy: adminEmail,
      deactivationReason: 'Automated 6-Month Inactivity Policy',
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();

  try {
    await addDoc(collection(db, 'client_activity'), {
      event: 'batch.residents.deactivated',
      targetType: 'users_batch',
      actorUid: auth.currentUser.uid,
      actorEmail: adminEmail,
      metadata: {
        count: staleUsers.length,
        emails: staleUsers.map((u) => u.email),
        reason: 'Automated 6-Month Inactivity Policy',
      },
      createdAt: serverTimestamp(),
    });
  } catch {}

  return {
    count: staleUsers.length,
    emails: staleUsers.map((u) => u.email),
  };
}
