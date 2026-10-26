import { db, firebaseConfig } from '@/config/firebase';
import { deleteApp, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, updateProfile } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

export type ResidentProvisionInput = {
  firstName: string;
  lastName: string;
  middleInitial?: string;
  email: string;
  password?: string;
  phoneNumber?: string;
  barangay: string;
  street?: string;
  initialPoints?: number;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function provisionResidentOnSpark(input: ResidentProvisionInput) {
  if (!db) throw new Error('Firestore is unavailable.');

  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '').trim() || 'Danao2026!';
  const fn = String(input.firstName || '').trim();
  const ln = String(input.lastName || '').trim();
  const mi = input.middleInitial ? `${String(input.middleInitial).trim().replace(/\.$/, '')}. ` : '';
  const fullName = `${fn} ${mi}${ln}`.trim() || `${ln}, ${fn}`.trim();
  const barangay = String(input.barangay || '').trim();

  if (!email || !EMAIL_PATTERN.test(email)) {
    throw new Error('Please enter a valid resident email address.');
  }
  if (password.length < 8 || password.length > 32) {
    throw new Error('Temporary password must be between 8 and 32 characters.');
  }
  if (!fn || !ln) {
    throw new Error('First Name and Last Name are required.');
  }
  if (!barangay) {
    throw new Error('Please select a Danao City barangay.');
  }

  // Use secondary app to prevent admin from being logged out
  const secondaryApp = initializeApp(
    firebaseConfig,
    `resident-provision-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const user = credential.user;
    await updateProfile(user, { displayName: fullName });

    const userDocRef = doc(db, 'users', user.uid);
    const initialPoints = Math.max(0, Number(input.initialPoints ?? 50));

    await setDoc(userDocRef, {
      uid: user.uid,
      email,
      displayName: fullName,
      name: fullName,
      firstName: fn,
      lastName: ln,
      middleInitial: input.middleInitial?.trim()?.toUpperCase() || '',
      phoneNumber: input.phoneNumber?.trim() || '',
      contactInfo: input.phoneNumber?.trim() || '',
      barangay,
      assignedBarangay: barangay,
      street: input.street?.trim() || '',
      role: 'user', // Standard resident role
      status: 'active',
      verified: true,
      verificationStatus: 'verified',
      verificationIdType: 'CENRO Municipal Onboarding',
      verificationSubmittedAt: serverTimestamp(),
      points: initialPoints,
      rewardTokens: initialPoints,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      registeredByCenro: true,
    });

    return {
      uid: user.uid,
      email,
      displayName: fullName,
      barangay,
      password,
      points: initialPoints,
    };
  } finally {
    try {
      await deleteApp(secondaryApp);
    } catch {}
  }
}
