import { auth, db, firebaseConfig } from '@/config/firebase';
import { isCictoEmail } from '@/constants/cictoConfig';
import { createDriverQrToken } from '@/services/driverQrService';
import { deleteApp, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, deleteUser, getAuth, updateProfile } from 'firebase/auth';
import { addDoc, arrayRemove, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

export type DriverProvisionInput = {
  mode: 'create' | 'upgrade';
  email?: string;
  password?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  middleInitial?: string;
  contactInfo?: string;
  phoneNumber?: string;
  existingUserId?: string;
  employeeId: string;
  licenseNumber: string;
  truckId?: string;
  assignedBarangay?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_PATTERN = /^[A-Z0-9-]{4,40}$/i;

const normalize = (input: DriverProvisionInput) => {
  const getFullName = () => {
    if (input.fullName && input.fullName.trim()) return input.fullName.trim();
    const fn = String(input.firstName || '').trim();
    const mi = String(input.middleInitial || '').trim() ? `${String(input.middleInitial || '').trim().replace(/\.$/, '')}. ` : '';
    const ln = String(input.lastName || '').trim();
    return `${fn} ${mi}${ln}`.trim() || `${ln}, ${fn}`.trim();
  };

  const formattedName = getFullName();

  const value = {
    ...input,
    email: String(input.email || '').trim().toLowerCase(),
    password: String(input.password || ''),
    fullName: formattedName,
    firstName: String(input.firstName || '').trim(),
    lastName: String(input.lastName || '').trim(),
    middleInitial: String(input.middleInitial || '').trim(),
    contactInfo: String(input.contactInfo || input.phoneNumber || '').trim().slice(0, 100),
    phoneNumber: String(input.phoneNumber || input.contactInfo || '').trim().slice(0, 100),
    existingUserId: String(input.existingUserId || '').trim(),
    employeeId: String(input.employeeId || '').trim().toUpperCase(),
    licenseNumber: String(input.licenseNumber || '').trim().toUpperCase(),
    truckId: String(input.truckId || '').trim(),
    assignedBarangay: String(input.assignedBarangay || '').trim(),
  };
  if (!ID_PATTERN.test(value.employeeId)) throw new Error('Enter a valid employee ID using letters, numbers, or hyphens.');
  if (!ID_PATTERN.test(value.licenseNumber)) throw new Error('Enter a valid license number using letters, numbers, or hyphens.');
  if (value.fullName.length < 2 || value.fullName.length > 100) throw new Error('Enter the driver’s full name.');
  if (value.mode === 'create') {
    if (!EMAIL_PATTERN.test(value.email)) throw new Error('Enter a valid driver email address.');
    if (value.password.length < 8 || value.password.length > 24) throw new Error('The temporary password must contain 8 to 24 characters.');
  } else if (!value.existingUserId) throw new Error('Select a resident or driver account to modify.');
  return value;
};

async function writeDriverRecords(uid: string, input: ReturnType<typeof normalize>) {
  if (!db) throw new Error('Firestore is unavailable.');
  const userRef = doc(db, 'users', uid);
  const qrCredentialRef = doc(db, 'driver_qr_credentials', uid);
  const identifierRef = doc(db, 'identifiers', 'driver', 'items', input.employeeId);
  const truckRef = input.truckId ? doc(db, 'trucks', input.truckId) : null;
  const newQrLoginToken = createDriverQrToken(input.employeeId);

  // Enforce unique license number in identifiers collection
  if (input.licenseNumber) {
    const licSnap = await getDocs(query(collection(db, 'identifiers', 'license', 'items'), where('id', '==', input.licenseNumber)));
    const conflicting = licSnap.docs.find(d => d.data().userId !== uid && d.data().employeeId !== input.employeeId);
    if (conflicting) {
      throw new Error(`LTO License Number "${input.licenseNumber}" is already registered to employee ${conflicting.data().employeeId || conflicting.id}.`);
    }
  }

  return runTransaction(db, async transaction => {
    const [profile, identifierDoc, truck] = await Promise.all([
      transaction.get(userRef),
      transaction.get(identifierRef),
      truckRef ? transaction.get(truckRef) : Promise.resolve(null),
    ]);
    const profileRole = String(profile.data()?.role || '').toLowerCase();
    const isResidentOrDriver = !profileRole || ['user', 'resident', 'driver'].includes(profileRole);
    if (input.mode === 'upgrade' && (!profile.exists() || !isResidentOrDriver)) {
      throw new Error('Only an existing resident or driver account can be modified.');
    }
    if (identifierDoc.exists() && identifierDoc.data()?.userId !== uid) throw new Error('This employee ID is already assigned.');
    if (truckRef && (!truck?.exists() || !['active', 'available', 'assigned'].includes(String(truck.data()?.status || 'active').toLowerCase().trim()) || (truck.data()?.assignedDriverId && truck.data()?.assignedDriverId !== uid))) {
      throw new Error('The selected truck is no longer available.');
    }

    const previousTruckId = profile.data()?.currentTruckId;
    if (previousTruckId && previousTruckId !== input.truckId) {
      const prevTruckRef = doc(db, 'trucks', previousTruckId);
      transaction.update(prevTruckRef, {
        assignedDriverId: null,
        assignedDriverName: null,
        updatedAt: serverTimestamp(),
      });
    }

    const timestamp = serverTimestamp();
    const assignedBarangay = input.assignedBarangay || profile.data()?.assignedBarangay || profile.data()?.barangay || '';
    const qrLoginToken = newQrLoginToken;

    transaction.set(userRef, {
      uid,
      email: input.email || profile.data()?.email || '',
      displayName: input.fullName || profile.data()?.displayName || '',
      firstName: input.firstName || profile.data()?.firstName || '',
      lastName: input.lastName || profile.data()?.lastName || '',
      middleInitial: input.middleInitial || profile.data()?.middleInitial || '',
      contactInfo: input.contactInfo || profile.data()?.contactInfo || '',
      phoneNumber: input.phoneNumber || profile.data()?.phoneNumber || '',
      employeeId: input.employeeId,
      licenseNumber: input.licenseNumber,
      barangay: assignedBarangay,
      assignedBarangay: assignedBarangay,
      role: 'driver',
      disabled: false,
      status: 'active',
      currentTruckId: input.truckId || null,
      currentTruckPlate: truck?.data()?.plateNumber || null,
      provider: profile.data()?.provider || 'password',
      verified: true,
      mustChangePassword: input.mode === 'create' ? true : (profile.data()?.mustChangePassword === true),
      qrLoginToken: deleteField(),
      updatedAt: timestamp,
      ...(profile.exists() ? {} : { createdAt: timestamp }),
    }, { merge: true });

    transaction.set(identifierRef, {
      id: input.employeeId,
      type: 'driver',
      userId: uid,
      licenseNumber: input.licenseNumber,
      driverName: input.fullName || profile.data()?.displayName || '',
      assignedBarangay: assignedBarangay,
      assignedTruckId: input.truckId || null,
      assignedTruckPlate: truck?.data()?.plateNumber || null,
      role: 'driver',
      status: 'active',
      assignedAt: timestamp,
      updatedAt: timestamp,
    }, { merge: true });

    transaction.set(qrCredentialRef, {
      uid,
      token: qrLoginToken,
      email: input.email || profile.data()?.email || '',
      ...(input.password ? { authKey: input.password } : {}),
      qrGeneratedAt: timestamp,
      updatedAt: timestamp,
    }, { merge: true });

    if (input.licenseNumber) {
      const unifiedLicRef = doc(db, 'identifiers', 'license', 'items', input.licenseNumber);
      transaction.set(unifiedLicRef, {
        id: input.licenseNumber,
        type: 'license',
        employeeId: input.employeeId,
        userId: uid,
        assignedAt: timestamp,
      }, { merge: true });
    }

    if (truckRef) transaction.update(truckRef, {
      assignedDriverId: uid,
      assignedDriverName: input.fullName,
      updatedAt: timestamp,
    });
    return {
      uid,
      email: input.email || profile.data()?.email || '',
      truckId: input.truckId || null,
      qrLoginToken,
      employeeId: input.employeeId,
      name: input.fullName,
      licenseNumber: input.licenseNumber,
      assignedBarangay,
      authKey: input.password || undefined,
    };
  });
}

export async function provisionDriverOnSpark(rawInput: DriverProvisionInput) {
  const input = normalize(rawInput);
  if (input.mode === 'upgrade') return writeDriverRecords(input.existingUserId, input);

  const secondaryApp = initializeApp(firebaseConfig, `driver-provision-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const secondaryAuth = getAuth(secondaryApp);
  let createdUser: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>['user'] | null = null;
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, input.email, input.password);
    createdUser = credential.user;
    await updateProfile(createdUser, { displayName: input.fullName });
    try {
      const { sendDriverWelcomeEmail } = await import('@/services/emailNotificationService');
      await sendDriverWelcomeEmail({
        toEmail: input.email,
        driverName: input.fullName,
        temporaryPassword: input.password,
        employeeId: input.employeeId,
        truckId: input.truckId || undefined,
      });
    } catch { }
    return await writeDriverRecords(createdUser.uid, input);
  } catch (error) {
    if (createdUser) await deleteUser(createdUser).catch(() => undefined);
    throw error;
  } finally {
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}

/**
 * Demotes / degrades an active driver back to a standard resident (role: 'user').
 * Unassigns any assigned truck, removes driver employee & license identifier records,
 * deletes driver QR bearer credentials, and updates the user record back to resident status.
 */
export async function demoteDriverToResident(userId: string) {
  if (!db) throw new Error('Firestore is unavailable.');
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    throw new Error('User record not found in directory.');
  }

  const userData = userSnap.data();
  const truckId = userData.currentTruckId || userData.assignedTruckId;
  const employeeId = userData.employeeId;
  const licenseNumber = userData.licenseNumber;

  // 1. Unassign truck in 'trucks' collection if known by ID
  if (truckId) {
    const truckRef = doc(db, 'trucks', truckId);
    await updateDoc(truckRef, {
      assignedDriverId: null,
      assignedDriverName: null,
      updatedAt: serverTimestamp(),
    }).catch(err => console.warn('Could not unassign truck by ID:', err));
  }

  // Also query trucks where assignedDriverId == userId to guarantee no orphaned assignment
  try {
    const truckQuery = query(collection(db, 'trucks'), where('assignedDriverId', '==', userId));
    const truckSnaps = await getDocs(truckQuery);
    for (const tDoc of truckSnaps.docs) {
      if (tDoc.id !== truckId) {
        await updateDoc(tDoc.ref, {
          assignedDriverId: null,
          assignedDriverName: null,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
      }
    }
  } catch (err) {
    console.warn('Could not query assigned trucks:', err);
  }

  // Unassign from barangay schedules
  try {
    const schedQ = query(collection(db, 'barangay_schedules'), where('assignedDriverId', '==', userId));
    const schedSnaps = await getDocs(schedQ);
    for (const sDoc of schedSnaps.docs) {
      await updateDoc(sDoc.ref, {
        assignedDriverId: null,
        assignedDriverName: null,
        assignedDriverEmail: null,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }
  } catch (err) {
    console.warn('Could not unassign schedules on demotion:', err);
  }

  // 2. Remove employee ID from identifiers if present
  if (employeeId) {
    await deleteDoc(doc(db, 'identifiers', 'driver', 'items', employeeId)).catch(() => undefined);
    await deleteDoc(doc(db, 'employee_ids', employeeId)).catch(() => undefined);
  }

  // 3. Remove license number from identifiers if present
  if (licenseNumber) {
    await deleteDoc(doc(db, 'identifiers', 'license', 'items', licenseNumber)).catch(() => undefined);
    await deleteDoc(doc(db, 'license_numbers', licenseNumber)).catch(() => undefined);
  }

  // 4. Delete driver QR credentials
  await deleteDoc(doc(db, 'driver_qr_credentials', userId)).catch(() => undefined);

  // 5. Update user document back to resident role ('user')
  await updateDoc(userRef, {
    role: 'user',
    currentTruckId: null,
    currentTruckPlate: null,
    assignedTruckId: null,
    assignedTruckPlate: null,
    employeeId: null,
    licenseNumber: null,
    updatedAt: serverTimestamp(),
  });

  return { success: true, userId };
}

/**
 * Deletes an account (driver, coordinator, resident) by a CENRO administrator.
 * Unassigns any trucks, removes identifier records, wipes driver credentials,
 * calls Cloud Function to remove from Firebase Auth, and deletes the Firestore user doc.
 */
export async function deleteAccountByCenro(targetUser: {
  id: string;
  email?: string;
  displayName?: string;
  role?: string;
  currentTruckId?: string;
  assignedTruckId?: string;
  employeeId?: string;
  licenseNumber?: string;
  assignedBarangay?: string;
  barangay?: string;
}): Promise<{ success: boolean; message: string }> {
  if (!db) throw new Error('Database is currently unavailable.');
  if (!auth.currentUser) throw new Error('CENRO administrator authentication is required.');

  // Guard: Protect CICTO accounts
  if (targetUser.role === 'cicto' || (targetUser.email && isCictoEmail(targetUser.email))) {
    throw new Error('CICTO Super Administrator accounts cannot be deleted.');
  }

  // Guard: Protect CENRO admins from other CENROs deleting them
  if (targetUser.role === 'admin' || targetUser.role === 'cenro') {
    throw new Error('CENRO Administrator accounts can only be managed and deleted by CICTO.');
  }

  // Guard: Cannot delete self
  if (targetUser.id === auth.currentUser.uid) {
    throw new Error('You cannot delete your own administrator account.');
  }

  const targetUid = targetUser.id;

  // Retrieve user document to inspect active barangay and identifiers if not passed
  let activeBarangay = targetUser.assignedBarangay || targetUser.barangay;
  let activeEmployeeId = targetUser.employeeId;
  let activeLicenseNumber = targetUser.licenseNumber;
  let activeRole = targetUser.role;

  try {
    const uSnap = await getDoc(doc(db, 'users', targetUid));
    if (uSnap.exists()) {
      const uData = uSnap.data();
      if (!activeBarangay) activeBarangay = uData?.assignedBarangay || uData?.barangay;
      if (!activeEmployeeId) activeEmployeeId = uData?.employeeId;
      if (!activeLicenseNumber) activeLicenseNumber = uData?.licenseNumber;
      if (!activeRole) activeRole = uData?.role;
    }
  } catch { }

  // 1. Unassign truck in 'trucks' collection if known or assigned
  const truckId = targetUser.currentTruckId || targetUser.assignedTruckId;
  if (truckId) {
    await updateDoc(doc(db, 'trucks', truckId), {
      assignedDriverId: null,
      assignedDriverName: null,
      updatedAt: serverTimestamp(),
    }).catch(err => console.warn('Could not unassign truck:', err));
  }

  // Also query any truck where assignedDriverId == targetUid
  try {
    const truckQuery = query(collection(db, 'trucks'), where('assignedDriverId', '==', targetUid));
    const truckSnaps = await getDocs(truckQuery);
    for (const tDoc of truckSnaps.docs) {
      await updateDoc(tDoc.ref, {
        assignedDriverId: null,
        assignedDriverName: null,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }
  } catch (err) {
    console.warn('Truck query warning:', err);
  }

  // Delete user settings
  await deleteDoc(doc(db, 'user_settings', targetUid)).catch(() => undefined);

  // Delete user notifications
  try {
    const notifQ = query(collection(db, 'userNotifications'), where('userId', '==', targetUid));
    const notifSnaps = await getDocs(notifQ);
    for (const nDoc of notifSnaps.docs) {
      await deleteDoc(nDoc.ref).catch(() => undefined);
    }
  } catch (notifErr) {
    console.warn('Could not delete user notifications on CENRO delete:', notifErr);
  }

  // Unassign from barangay schedules (both weekly and specific one-off pickups)
  try {
    const schedSnap = await getDocs(collection(db, 'barangay_schedules'));
    for (const sDoc of schedSnap.docs) {
      const sData = sDoc.data();
      let changed = false;
      const updates: any = {};

      if (
        sData.assignedDriverId === targetUid ||
        (targetUser.displayName && sData.assignedDriverName === targetUser.displayName)
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
            (targetUser.displayName && ss.assignedDriverName === targetUser.displayName)
        );
        if (hasSpecific) {
          updates.specificSchedules = sData.specificSchedules.map((ss: any) => {
            if (
              ss.assignedDriverId === targetUid ||
              (targetUser.displayName && ss.assignedDriverName === targetUser.displayName)
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
        await updateDoc(sDoc.ref, updates).catch(() => undefined);
      }
    }
  } catch (err) {
    console.warn('Could not unassign schedules on CENRO delete:', err);
  }

  // Remove from interagency group chats
  try {
    const chanQ = query(collection(db, 'interagency_channels'), where('memberUids', 'array-contains', targetUid));
    const chanSnaps = await getDocs(chanQ);
    for (const cDoc of chanSnaps.docs) {
      await updateDoc(cDoc.ref, {
        memberUids: arrayRemove(targetUid),
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }
  } catch (chanErr) {
    console.warn('Could not remove user from channels on CENRO delete:', chanErr);
  }

  // 2. Remove identifier records (drivers and coordinators)
  if (activeEmployeeId) {
    const empId = activeEmployeeId;
    await deleteDoc(doc(db, 'identifiers', 'driver', 'items', empId)).catch(() => undefined);
    await deleteDoc(doc(db, 'identifiers', 'coordinator', 'items', empId)).catch(() => undefined);
    await deleteDoc(doc(db, 'coordinator_employee_ids', empId)).catch(() => undefined);
    await deleteDoc(doc(db, 'employee_ids', empId)).catch(() => undefined);
  }

  // Sweep any coordinator identifier documents referencing this targetUid
  try {
    const coordIdentQ = query(collection(db, 'identifiers', 'coordinator', 'items'), where('userId', '==', targetUid));
    const coordIdentSnap = await getDocs(coordIdentQ);
    for (const cDoc of coordIdentSnap.docs) {
      await deleteDoc(cDoc.ref).catch(() => undefined);
    }
  } catch {}

  // Sweep coordinator barangay locks
  if (activeBarangay && typeof activeBarangay === 'string') {
    const normalizedBrgyKey = activeBarangay.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    await deleteDoc(doc(db, 'identifiers', 'coordinator_barangays', 'items', normalizedBrgyKey)).catch(() => undefined);
  }

  try {
    const brgyIdentQ = query(collection(db, 'identifiers', 'coordinator_barangays', 'items'), where('userId', '==', targetUid));
    const brgyIdentSnap = await getDocs(brgyIdentQ);
    for (const bDoc of brgyIdentSnap.docs) {
      await deleteDoc(bDoc.ref).catch(() => undefined);
    }
  } catch {}

  if (activeLicenseNumber) {
    const lic = activeLicenseNumber;
    await deleteDoc(doc(db, 'identifiers', 'license', 'items', lic)).catch(() => undefined);
    await deleteDoc(doc(db, 'license_numbers', lic)).catch(() => undefined);
  }

  // 3. Delete driver QR credentials
  await deleteDoc(doc(db, 'driver_qr_credentials', targetUid)).catch(() => undefined);

  // 4. Attempt Cloud Function Auth deletion
  try {
    const functionsInstance = getFunctions(undefined, 'us-central1');
    const deleteCallable = httpsCallable(functionsInstance, 'cenroDeleteAccount');
    await deleteCallable({ targetUid });
  } catch (cloudFnError: any) {
    console.warn('cenroDeleteAccount Auth warning (proceeding with database purge):', cloudFnError?.message || cloudFnError);
  }

  // 5. Delete Firestore user document
  await deleteDoc(doc(db, 'users', targetUid));

  // 6. Record audit log
  try {
    await addDoc(collection(db, 'admin_audit_logs'), {
      action: 'account_deleted_by_cenro',
      targetUid,
      targetEmail: targetUser.email || '',
      targetRole: activeRole || targetUser.role || 'resident',
      performedByUid: auth.currentUser.uid,
      performedByEmail: auth.currentUser.email || 'cenro@trashtrack.gov.ph',
      timestamp: serverTimestamp(),
      details: `Account ${targetUser.displayName || targetUser.email} (${activeRole || targetUser.role || 'user'}) deleted by CENRO.`,
    });
  } catch (auditErr) {
    console.warn('Audit log write warning:', auditErr);
  }

  return {
    success: true,
    message: `Account for ${targetUser.displayName || targetUser.email || targetUid} has been permanently deleted.`,
  };
}

