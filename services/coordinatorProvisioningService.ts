import { db, firebaseConfig } from '@/config/firebase';
import { deleteApp, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, deleteUser, getAuth, updateProfile } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where } from 'firebase/firestore';

export type CoordinatorProvisionInput = {
  mode: 'create' | 'upgrade';
  email?: string;
  password?: string;
  fullName: string;
  contactInfo?: string;
  existingUserId?: string;
  employeeId: string;
  barangay: string;
  zone?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_PATTERN = /^[A-Z0-9-]{4,40}$/i;

const normalize = (raw: CoordinatorProvisionInput) => {
  const input = {
    ...raw,
    email: String(raw.email || '').trim().toLowerCase(),
    password: String(raw.password || ''),
    fullName: String(raw.fullName || '').trim(),
    contactInfo: String(raw.contactInfo || '').trim().slice(0, 100),
    existingUserId: String(raw.existingUserId || '').trim(),
    employeeId: String(raw.employeeId || '').trim().toUpperCase(),
    barangay: String(raw.barangay || 'CITY').trim(),
    zone: String(raw.zone || '').trim().slice(0, 80),
  };
  if (!ID_PATTERN.test(input.employeeId)) throw new Error('Enter a valid coordinator employee ID.');
  if (input.fullName.length < 2 || input.fullName.length > 100) throw new Error("Enter the coordinator's full name.");
  if (!input.barangay) throw new Error('Select the assigned barangay.');
  if (input.mode === 'create') {
    if (!EMAIL_PATTERN.test(input.email)) throw new Error('Enter a valid coordinator email address.');
    if (input.password.length < 8 || input.password.length > 24) throw new Error('The temporary password must contain 8 to 24 characters.');
  } else if (!input.existingUserId) throw new Error('Select a resident account to upgrade.');
  return input;
};

async function writeCoordinatorRecords(uid: string, input: ReturnType<typeof normalize>) {
  if (!db) throw new Error('Firestore is unavailable.');

  const existingCoordsSnap = await getDocs(
    query(collection(db, 'users'), where('role', '==', 'coordinator'))
  );
  const isCityJurisdiction = input.barangay.trim().toUpperCase() === 'CITY';
  const conflictingUser = isCityJurisdiction ? null : existingCoordsSnap.docs.find((d) => {
    if (d.id === uid) return false;
    const data = d.data();
    const b = (data.assignedBarangay || data.barangay || '').trim().toLowerCase();
    return b === input.barangay.trim().toLowerCase();
  });

  const profileRef = doc(db, 'users', uid);
  const identifierRef = doc(db, 'identifiers', 'coordinator', 'items', input.employeeId);
  const normalizedBrgyKey = input.barangay.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
  const brgyIdentifierRef = doc(db, 'identifiers', 'coordinator_barangays', 'items', normalizedBrgyKey);

  return runTransaction(db, async transaction => {
    const [profile, identifierDoc, brgyIdentifierDoc] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(identifierRef),
      transaction.get(brgyIdentifierRef),
    ]);
    if (input.mode === 'upgrade' && !profile.exists()) {
      throw new Error('The selected user account could not be found.');
    }

    const existingData = profile.exists() ? profile.data() : null;

    // Clean up old CENRO identifier if upgrading from CENRO admin
    const oldEmpId = existingData?.employeeId;
    const oldRole = existingData?.role;
    if (oldEmpId && (oldRole === 'admin' || oldRole === 'cenro')) {
      try {
        const oldCenroIdent = doc(db, 'identifiers', 'cenro', 'items', oldEmpId);
        transaction.delete(oldCenroIdent);
      } catch {}
    }

    // Clean up previous barangay lock if this user already held another barangay
    const prevBrgy = existingData?.assignedBarangay || existingData?.barangay;
    if (prevBrgy && prevBrgy.trim().toLowerCase() !== input.barangay.trim().toLowerCase()) {
      const prevKey = prevBrgy.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
      const prevLockRef = doc(db, 'identifiers', 'coordinator_barangays', 'items', prevKey);
      transaction.delete(prevLockRef);
    }

    // If conflicting user had this barangay, transfer jurisdiction cleanly
    if (conflictingUser) {
      const conflictRef = doc(db, 'users', conflictingUser.id);
      transaction.set(conflictRef, {
        assignedBarangay: '',
        barangay: '',
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    // Verify if employee identifier was occupied by another user
    const idOwnerUid = identifierDoc.exists() && identifierDoc.data()?.userId !== uid
      ? identifierDoc.data()?.userId
      : null;
    if (idOwnerUid) {
      const idOwnerSnap = await transaction.get(doc(db, 'users', idOwnerUid));
      if (idOwnerSnap && idOwnerSnap.exists() && !idOwnerSnap.data()?.disabled) {
        throw new Error('This coordinator employee ID is already assigned to another active officer.');
      }
    }

    const timestamp = serverTimestamp();
    transaction.set(profileRef, {
      uid,
      email: input.email || existingData?.email || '',
      displayName: input.fullName || existingData?.displayName || existingData?.name || '',
      contactInfo: input.contactInfo || existingData?.contactInfo || '',
      employeeId: input.employeeId,
      barangay: input.barangay,
      assignedBarangay: input.barangay,
      department: 'Barangay Environmental Operations',
      designation: 'Barangay Environmental Coordinator',
      zone: input.zone,
      role: 'coordinator',
      status: 'active',
      disabled: false,
      verified: true,
      mustChangePassword: input.mode === 'create' ? true : (existingData?.mustChangePassword === true),
      updatedAt: timestamp,
      ...(profile.exists() ? {} : { createdAt: timestamp, provider: 'password' }),
    }, { merge: true });

    transaction.set(identifierRef, {
      id: input.employeeId,
      type: 'coordinator',
      userId: uid,
      barangay: input.barangay,
      zone: input.zone,
      role: 'coordinator',
      status: 'active',
      assignedAt: timestamp,
    }, { merge: true });

    if (!isCityJurisdiction) {
      transaction.set(brgyIdentifierRef, {
        barangay: input.barangay,
        userId: uid,
        fullName: input.fullName,
        employeeId: input.employeeId,
        assignedAt: timestamp,
      }, { merge: true });
    }

    return { uid, email: input.email || existingData?.email || '' };
  });
}

export async function provisionCoordinatorOnSpark(raw: CoordinatorProvisionInput) {
  const input = normalize(raw);
  if (input.mode === 'upgrade') {
    const result = await writeCoordinatorRecords(input.existingUserId, input);
    try {
      const { sendCoordinatorWelcomeEmail } = await import('@/services/emailNotificationService');
      await sendCoordinatorWelcomeEmail({
        toEmail: input.email || result.email,
        coordinatorName: input.fullName,
        employeeId: input.employeeId,
        barangay: input.barangay,
        zone: input.zone,
      });
    } catch (emailErr) {
      console.warn('Coordinator welcome email dispatch note:', emailErr);
    }
    return result;
  }

  const secondaryApp = initializeApp(firebaseConfig, `coordinator-provision-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const secondaryAuth = getAuth(secondaryApp);
  let createdUser: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>['user'] | null = null;
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, input.email, input.password);
    createdUser = credential.user;
    await updateProfile(createdUser, { displayName: input.fullName });

    try {
      const { sendCoordinatorWelcomeEmail } = await import('@/services/emailNotificationService');
      await sendCoordinatorWelcomeEmail({
        toEmail: input.email,
        coordinatorName: input.fullName,
        temporaryPassword: input.password,
        employeeId: input.employeeId,
        barangay: input.barangay,
        zone: input.zone,
      });
    } catch (emailErr) {
      console.warn('Coordinator welcome email dispatch note:', emailErr);
    }

    return await writeCoordinatorRecords(createdUser.uid, input);
  } catch (error: any) {
    if (error?.code === 'auth/email-already-in-use' && db) {
      try {
        const emailLower = input.email.toLowerCase().trim();
        const q = query(collection(db, 'users'), where('email', '==', emailLower));
        const snap = await getDocs(q);
        let targetUid = '';
        if (!snap.empty) {
          targetUid = snap.docs[0].id;
        } else {
          targetUid = input.employeeId.toLowerCase().replace(/[^a-z0-9]/g, '-');
        }

        const result = await writeCoordinatorRecords(targetUid, {
          ...input,
          mode: !snap.empty ? 'upgrade' : 'create',
          existingUserId: targetUid,
        });
        try {
          const { sendCoordinatorWelcomeEmail } = await import('@/services/emailNotificationService');
          await sendCoordinatorWelcomeEmail({
            toEmail: input.email,
            coordinatorName: input.fullName,
            temporaryPassword: input.password,
            employeeId: input.employeeId,
            barangay: input.barangay,
            zone: input.zone,
          });
        } catch { }
        return result;
      } catch (fallbackErr) {
        console.warn('Coordinator email-in-use fallback note:', fallbackErr);
      }
    }
    if (createdUser) await deleteUser(createdUser).catch(() => undefined);
    throw error;
  } finally {
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}

/**
 * Demotes / degrades an assigned coordinator back to a standard resident (role: 'user').
 * Clears coordinator employee ID locks and resets role back to resident.
 */
export async function demoteCoordinatorToResident(userId: string) {
  if (!db) throw new Error('Firestore is unavailable.');
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    throw new Error('User record not found in directory.');
  }
  const uData = userSnap.data();
  const employeeId = uData?.employeeId;
  const barangay = uData?.assignedBarangay || uData?.barangay;

  if (employeeId) {
    await deleteDoc(doc(db, 'coordinator_employee_ids', employeeId)).catch(() => undefined);
    await deleteDoc(doc(db, 'employee_ids', employeeId)).catch(() => undefined);
    await deleteDoc(doc(db, 'identifiers', 'coordinator', 'items', employeeId)).catch(() => undefined);
  }

  if (barangay && typeof barangay === 'string') {
    const normalizedBrgyKey = barangay.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    await deleteDoc(doc(db, 'identifiers', 'coordinator_barangays', 'items', normalizedBrgyKey)).catch(() => undefined);
  }

  await updateDoc(userRef, {
    role: 'user',
    employeeId: null,
    zone: null,
    updatedAt: serverTimestamp(),
  });
  return { success: true, userId };
}

