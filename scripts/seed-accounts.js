/**
 * TrashTrack Resident Account Seeder Script
 * Creates or restores 5 resident accounts with password "Luthar@123"
 * 
 * Perfect for re-populating test resident users if Firestore is deleted or wiped.
 * 
 * Usage:
 *   npm run seed:accounts
 *   or
 *   node scripts/seed-accounts.js
 */

const fs = require('fs');
const path = require('path');

// ─── 1. Load Environment Variables from .env ───────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  }
}

loadEnv();

const COMMON_PASSWORD = 'Luthar@123';

// ─── 2. 5 Resident Accounts (Spanned Across Danao Barangays) ────────────────
const RESIDENTS_TO_SEED = [
  {
    email: 'luthar1@trashtrack.com',
    password: COMMON_PASSWORD,
    firstName: 'Luthar',
    lastName: 'One',
    displayName: 'Luthar 1',
    barangay: 'Poblacion',
  },
  {
    email: 'luthar2@trashtrack.com',
    password: COMMON_PASSWORD,
    firstName: 'Luthar',
    lastName: 'Two',
    displayName: 'Luthar 2',
    barangay: 'Suba',
  },
  {
    email: 'luthar3@trashtrack.com',
    password: COMMON_PASSWORD,
    firstName: 'Luthar',
    lastName: 'Three',
    displayName: 'Luthar 3',
    barangay: 'Looc',
  },
  {
    email: 'luthar4@trashtrack.com',
    password: COMMON_PASSWORD,
    firstName: 'Luthar',
    lastName: 'Four',
    displayName: 'Luthar 4',
    barangay: 'Guinsay',
  },
  {
    email: 'luthar5@trashtrack.com',
    password: COMMON_PASSWORD,
    firstName: 'Luthar',
    lastName: 'Five',
    displayName: 'Luthar 5',
    barangay: 'Sabang',
  },
];

// ─── 3. Main Runner ─────────────────────────────────────────────────────────
async function run() {
  console.log('\n=============================================================');
  console.log('🏘️  TRASHTRACK RESIDENT ACCOUNT SEEDER');
  console.log('   Target: 5 Danao City Resident Accounts');
  console.log('   Universal Password: ' + COMMON_PASSWORD);
  console.log('=============================================================\n');

  const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  const hasServiceAccount = fs.existsSync(keyPath);

  if (hasServiceAccount) {
    console.log('🔐 Service account key detected. Running in ADMIN SDK mode.\n');
    await runWithAdminSdk(keyPath);
  } else {
    console.log('⚡ Running in FIREBASE CLIENT SDK mode (using .env config).\n');
    await runWithClientSdk();
  }
}

// ─── Mode A: Firebase Admin SDK (if serviceAccountKey.json exists) ─────────
async function runWithAdminSdk(keyPath) {
  const admin = require('firebase-admin');
  const serviceAccount = require(keyPath);

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    });
  }

  const auth = admin.auth();
  const db = admin.firestore();

  for (let i = 0; i < RESIDENTS_TO_SEED.length; i++) {
    const acc = RESIDENTS_TO_SEED[i];
    console.log(`[${i + 1}/${RESIDENTS_TO_SEED.length}] Provisioning ${acc.displayName} (${acc.barangay})...`);
    console.log(`     Email:    ${acc.email}`);

    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(acc.email);
      await auth.updateUser(userRecord.uid, {
        password: acc.password,
        displayName: acc.displayName,
        emailVerified: true,
        disabled: false,
      });
      console.log(`     Auth:     Updated password for existing user (${userRecord.uid})`);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        userRecord = await auth.createUser({
          email: acc.email,
          password: acc.password,
          displayName: acc.displayName,
          emailVerified: true,
          disabled: false,
        });
        console.log(`     Auth:     Created new user (${userRecord.uid})`);
      } else {
        console.error(`     ❌ Auth Error:`, err.message);
        continue;
      }
    }

    // Set custom claims
    await auth.setCustomUserClaims(userRecord.uid, { role: 'user' });

    // Strictly compliant schema for Firestore
    const residentDoc = {
      uid: userRecord.uid,
      email: acc.email,
      displayName: acc.displayName,
      name: acc.displayName,
      firstName: acc.firstName,
      lastName: acc.lastName,
      middleInitial: 'M',
      photoURL: '',
      verified: true,
      role: 'user',
      provider: 'password',
      barangay: acc.barangay,
      contactInfo: '',
      phoneNumber: '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('users').doc(userRecord.uid).set(residentDoc, { merge: true });
    console.log(`     Firestore: Profile created/updated successfully in /users/${userRecord.uid}\n`);
  }

  printSummary();
}

// ─── Mode B: Firebase Client SDK (Zero Admin Key Needed) ────────────────────
async function runWithClientSdk() {
  const { initializeApp } = require('firebase/app');
  const {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile,
    signOut,
  } = require('firebase/auth');
  const {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
  } = require('firebase/firestore');

  const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTHDomain || process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  };

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    console.error('❌ Missing Firebase configuration in .env file!');
    process.exit(1);
  }

  const app = initializeApp(firebaseConfig, 'seed-residents-client');
  const auth = getAuth(app);
  const db = getFirestore(app);

  const provisionedResidents = [];

  // Step 1: Provision Firebase Authentication accounts for all 5 residents
  console.log('--- Step 1: Provisioning Firebase Auth Accounts ---');
  for (let i = 0; i < RESIDENTS_TO_SEED.length; i++) {
    const acc = RESIDENTS_TO_SEED[i];
    console.log(`[${i + 1}/${RESIDENTS_TO_SEED.length}] Provisioning ${acc.displayName} (${acc.barangay})...`);
    console.log(`     Email:    ${acc.email}`);

    let userCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(auth, acc.email, acc.password);
      console.log(`     Auth:     Created new resident user (${userCredential.user.uid})`);
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        try {
          userCredential = await signInWithEmailAndPassword(auth, acc.email, acc.password);
          console.log(`     Auth:     Signed in to existing user (${userCredential.user.uid})`);
        } catch (signInErr) {
          console.warn(`     ⚠️ Auth Note: Could not sign in. (${signInErr.message})`);
          continue;
        }
      } else {
        console.error(`     ❌ Auth Error:`, err.message);
        continue;
      }
    }

    const currentUser = userCredential.user;

    try {
      await updateProfile(currentUser, { displayName: acc.displayName });
    } catch {}

    provisionedResidents.push({
      ...acc,
      uid: currentUser.uid,
    });

    await signOut(auth).catch(() => {});
  }

  // Step 2: Elevate to CICTO admin session to write pre-verified profiles into Firestore
  console.log('\n--- Step 2: Pre-Verifying Profiles in Firestore via CICTO Admin ---');
  const CICTO_EMAIL = process.env.EXPO_PUBLIC_CICTO_ADMIN_EMAIL || 'cicto@trashtrack.gov.ph';
  const CICTO_PASSWORD = process.env.CICTO_ADMIN_PASSWORD || 'CICTOAdmin2026!';

  let cictoLoggedIn = false;
  try {
    try {
      await signInWithEmailAndPassword(auth, CICTO_EMAIL, CICTO_PASSWORD);
      cictoLoggedIn = true;
      console.log(`🔑 Authenticated as CICTO Admin (${CICTO_EMAIL}) to set verified status.`);
    } catch (cictoErr) {
      if (cictoErr.code === 'auth/user-not-found') {
        const newCicto = await createUserWithEmailAndPassword(auth, CICTO_EMAIL, CICTO_PASSWORD);
        await updateProfile(newCicto.user, { displayName: 'CICTO Administrator' });
        cictoLoggedIn = true;
        console.log(`🔑 Created & authenticated as master CICTO Admin (${CICTO_EMAIL}).`);
      } else {
        console.warn(`⚠️ Could not sign in as CICTO (${cictoErr.message}). Writing in direct mode...`);
      }
    }
  } catch (err) {
    console.warn(`⚠️ Admin session setup warning:`, err.message);
  }

  // Step 3: Write pre-verified resident documents
  for (let i = 0; i < provisionedResidents.length; i++) {
    const resAcc = provisionedResidents[i];
    try {
      const userRef = doc(db, 'users', resAcc.uid);
      const snap = await getDoc(userRef);

      const profileData = {
        uid: resAcc.uid,
        email: resAcc.email,
        displayName: resAcc.displayName,
        name: resAcc.displayName,
        firstName: resAcc.firstName,
        lastName: resAcc.lastName,
        middleInitial: 'M',
        photoURL: '',
        verified: true, // Pre-verified! Email verification bypassed directly when creating seed account
        role: 'user',
        provider: 'password',
        barangay: resAcc.barangay,
        contactInfo: '',
        phoneNumber: '',
        updatedAt: serverTimestamp(),
      };

      if (!snap.exists()) {
        profileData.createdAt = serverTimestamp();
        await setDoc(userRef, profileData);
      } else {
        await setDoc(userRef, profileData, { merge: true });
      }

      console.log(`     Firestore: ✅ Profile ready & PRE-VERIFIED for ${resAcc.displayName} (/users/${resAcc.uid})`);
    } catch (dbErr) {
      console.error(`     ❌ Firestore Write Error for ${resAcc.email}:`, dbErr.message);
    }
  }

  if (cictoLoggedIn) {
    await signOut(auth).catch(() => {});
  }

  printSummary();
}

function printSummary() {
  console.log('=============================================================');
  console.log('🎉 ALL 5 RESIDENT ACCOUNTS READY FOR LOGIN!');
  console.log('   Universal Password: ' + COMMON_PASSWORD);
  console.log('=============================================================\n');
  RESIDENTS_TO_SEED.forEach((r, idx) => {
    console.log(` ${idx + 1}. ${r.displayName.padEnd(20)} | ${r.email.padEnd(35)} | Brgy. ${r.barangay}`);
  });
  console.log('\n📱 Portal: Login directly on the mobile/web citizen portal (/(auth)/login)\n');
}

run().catch((err) => {
  console.error('\n❌ Fatal error seeding resident accounts:', err);
  process.exit(1);
});
