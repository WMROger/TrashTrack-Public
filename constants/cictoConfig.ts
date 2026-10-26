import { auth, db } from "@/config/firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

/**
 * CICTO (City Information and Communications Technology Office)
 * Governance Configurations.
 * Hardcoded official master account credentials and municipal oversight configuration.
 */
export const HARDCODED_CICTO_ACCOUNT = Object.freeze({
  email: "cicto@trashtrack.gov.ph",
  password: "CICTOAdmin2026!",
  username: "cicto",
  displayName: "CICTO Super Administrator",
  role: "cicto" as const,
  employeeId: "CICTO-001",
  department:
    "City Information and Communications Technology Office (CICTO Danao)",
  agency: "CICTO Danao City",
});

export const CICTO_ADMIN_CONFIG = Object.freeze({
  primaryEmail:
    process.env.EXPO_PUBLIC_CICTO_ADMIN_EMAIL || HARDCODED_CICTO_ACCOUNT.email,
  defaultPassword:
    process.env.EXPO_PUBLIC_CICTO_ADMIN_PASSWORD || HARDCODED_CICTO_ACCOUNT.password,
  knownEmails: [
    process.env.EXPO_PUBLIC_CICTO_ADMIN_EMAIL || HARDCODED_CICTO_ACCOUNT.email,
    HARDCODED_CICTO_ACCOUNT.email,
    "cicto@trashtrack.com",
    "cicto.admin@danao.gov.ph",
    "cicto@danao.gov.ph",
    "cictoadmin@trashtrack.gov.ph",
  ],
  knownUsernames: [
    "cicto",
    "cictoadmin",
    "cicto_admin",
    "superadmin",
  ],
  displayName: HARDCODED_CICTO_ACCOUNT.displayName,
  role: HARDCODED_CICTO_ACCOUNT.role,
});

/**
 * Checks if a given email is a recognized CICTO Super Admin email.
 */
export function isCictoEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const isGovOrSystemDomain =
    normalized.endsWith("@danao.gov.ph") ||
    normalized.endsWith("@trashtrack.gov.ph") ||
    normalized.endsWith("@trashtrack.com");

  return (
    CICTO_ADMIN_CONFIG.knownEmails.includes(normalized) ||
    normalized === HARDCODED_CICTO_ACCOUNT.email ||
    (isGovOrSystemDomain &&
      (normalized.startsWith("cicto@") ||
        normalized.startsWith("cicto.") ||
        normalized.startsWith("cicto_") ||
        normalized.startsWith("cictoadmin@")))
  );
}

/**
 * Checks if a given string looks like a CICTO username, employee ID, or email.
 */
export function isCictoIdentifier(identifier?: string | null): boolean {
  if (!identifier) return false;
  const trimmed = identifier.trim();
  const normalized = trimmed.toLowerCase();
  if (isCictoEmail(normalized)) return true;
  if (trimmed.toUpperCase().startsWith("CICTO-")) return true;
  return CICTO_ADMIN_CONFIG.knownUsernames.includes(normalized);
}

/**
 * Ensures the CICTO Super Admin profile document exists in Firestore `/users/{uid}`.
 * Self-healing mechanism: when the master CICTO account logs in after a database wipe,
 * this function automatically reconstructs the master profile document.
 */
export async function ensureCictoProfileInFirestore(
  uid: string,
  email: string = HARDCODED_CICTO_ACCOUNT.email,
  displayName: string = HARDCODED_CICTO_ACCOUNT.displayName,
): Promise<void> {
  if (!db) return;
  const normEmail = email.toLowerCase().trim();
  // Refuse to create a CICTO profile for CENRO accounts
  if (
    normEmail.startsWith('admin@') ||
    normEmail.startsWith('cenro@') ||
    normEmail.includes('cenro') ||
    normEmail.includes('coord') ||
    (!isCictoEmail(normEmail) && !normEmail.includes('cicto'))
  ) {
    console.warn('ensureCictoProfileInFirestore: Refusing to create CICTO profile for non-CICTO email:', email);
    return;
  }
  try {
    const userRef = doc(db, "users", uid);
    await setDoc(
      userRef,
      {
        uid,
        email: normEmail,
        displayName,
        name: displayName,
        role: "cicto",
        verified: true,
        status: "active",
        employeeId: HARDCODED_CICTO_ACCOUNT.employeeId,
        barangay: 'CITY',
        assignedBarangay: 'CITY',
        department:
          HARDCODED_CICTO_ACCOUNT.department,
        agency: HARDCODED_CICTO_ACCOUNT.agency,
        permissions: [
          "system.oversight",
          "fleet.audit",
          "users.manage",
          "data.export",
          "cenro.command",
          "rewards.reconcile",
        ],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
      },
      { merge: true },
    );
    console.log(
      "✅ CICTO Admin profile successfully self-healed in Firestore:",
      email,
    );
  } catch (error) {
    console.warn("Could not ensure CICTO profile in Firestore:", error);
  }
}

/**
 * Logs in and self-heals the CICTO Super Administrator account.
 * Automatically bootstraps/creates the hardcoded master account if it doesn't exist yet.
 */
export async function loginOrBootstrapCictoAccount(
  customEmail?: string,
  customPassword?: string,
) {
  if (!auth) {
    throw new Error("Firebase Auth is not initialized.");
  }

  const rawEmail = (customEmail || HARDCODED_CICTO_ACCOUNT.email).trim().toLowerCase();

  // Strictly forbid CENRO accounts from authenticating via CICTO bootstrap
  if (
    rawEmail === 'admin' ||
    rawEmail === 'cenro' ||
    rawEmail.startsWith('admin@') ||
    rawEmail.startsWith('cenro@') ||
    rawEmail.includes('cenro') ||
    rawEmail.includes('coord')
  ) {
    throw new Error('Access Denied: CENRO credentials cannot be used to log in to the CICTO portal. Please use the dedicated CENRO portal at /cenro.');
  }

  // Must be a recognized CICTO username, identifier, or email
  if (!isCictoIdentifier(rawEmail) && !isCictoEmail(rawEmail)) {
    throw new Error('Access Denied: Invalid CICTO administrator credentials. Please use the dedicated CICTO portal.');
  }

  const emailToUse = rawEmail.includes('@') ? rawEmail : HARDCODED_CICTO_ACCOUNT.email;
  if (!isCictoEmail(emailToUse)) {
    throw new Error('Access Denied: CENRO credentials cannot be used to log in to the CICTO portal.');
  }

  // Use provided password or fallback to hardcoded master password
  const passwordToUse = (customPassword && customPassword.trim().length > 0)
    ? customPassword
    : HARDCODED_CICTO_ACCOUNT.password;

  try {
    let cred;
    try {
      cred = await signInWithEmailAndPassword(
        auth,
        emailToUse,
        passwordToUse,
      );
    } catch (signInError: any) {
      // If user does not exist in Firebase Auth yet, automatically bootstrap / create on the fly
      const isMissingUser =
        signInError?.code === 'auth/user-not-found' ||
        signInError?.code === 'auth/invalid-credential';

      if (isMissingUser) {
        try {
          cred = await createUserWithEmailAndPassword(
            auth,
            emailToUse,
            passwordToUse,
          );
          if (cred.user) {
            await updateProfile(cred.user, {
              displayName: HARDCODED_CICTO_ACCOUNT.displayName,
            });
          }
        } catch (createErr: any) {
          if (createErr?.code === 'auth/email-already-in-use') {
            throw signInError;
          }
          throw createErr;
        }
      } else {
        throw signInError;
      }
    }

    if (!isCictoEmail(cred.user.email)) {
      await signOut(auth);
      throw new Error('Access Denied: This account does not have CICTO administrative privileges.');
    }

    await ensureCictoProfileInFirestore(
      cred.user.uid,
      cred.user.email || emailToUse,
      cred.user.displayName || HARDCODED_CICTO_ACCOUNT.displayName,
    );
    return { user: cred.user, isNewUser: false };
  } catch (signInError: any) {
    throw signInError;
  }
}

/**
 * Ensures a valid CENRO Admin profile exists in Firestore for authorized personnel.
 */
export async function ensureCenroProfileInFirestore(
  uid: string,
  email: string,
  displayName: string = 'CENRO Admin',
): Promise<void> {
  if (!db) return;
  const isCenroCicto = isCictoEmail(email) || email.toLowerCase().includes('cicto');
  if (isCenroCicto) {
    console.warn('ensureCenroProfileInFirestore: Refusing to create CENRO profile for CICTO email:', email);
    return;
  }
  try {
    const userRef = doc(db, 'users', uid);
    await setDoc(
      userRef,
      {
        uid,
        email: email.toLowerCase().trim(),
        role: 'admin',
        displayName,
        department: 'Waste Management Operations',
        designation: 'CENRO Officer',
        employeeId: `CENRO-${Math.floor(1000 + Math.random() * 9000)}`,
        status: 'active',
        isCenro: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.warn('Failed to ensure CENRO profile in Firestore:', error);
  }
}

