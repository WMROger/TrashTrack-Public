const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Check for service account key in root or via env
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '..', 'serviceAccountKey.json');

if (!fs.existsSync(keyPath)) {
  console.log('\n=============================================================');
  console.log('⚠️  serviceAccountKey.json not found in project root.');
  console.log('=============================================================');
  console.log('To wipe users & identifiers via this script:');
  console.log('1. Go to Firebase Console -> Project Settings -> Service accounts');
  console.log('2. Click "Generate new private key"');
  console.log('3. Save the file as "serviceAccountKey.json" in the project root.\n');
  console.log('OR use the Firebase Web Console manually:');
  console.log('1. Authentication -> Users -> Select all -> Delete');
  console.log('2. Firestore -> Delete collections: "users", "identifiers", etc.\n');
  process.exit(1);
}

const serviceAccount = require(keyPath);
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const auth = admin.auth();
const db = admin.firestore();

// Helper to safely delete an entire collection or document recursively
async function safeRecursiveDelete(ref, label = 'collection') {
  try {
    if (typeof db.recursiveDelete === 'function') {
      await db.recursiveDelete(ref);
      console.log(`   🗑️ Recursively deleted ${label}.`);
      return;
    }
  } catch (err) {
    console.warn(`   ⚠️ Recursive delete warning on ${label}: ${err.message}. Falling back to manual batch delete...`);
  }

  // Fallback manual batch delete if recursiveDelete throws
  try {
    const snap = await ref.get();
    if (snap && snap.docs && snap.docs.length > 0) {
      const CHUNK_SIZE = 400;
      for (let i = 0; i < snap.docs.length; i += CHUNK_SIZE) {
        const chunk = snap.docs.slice(i, i + CHUNK_SIZE);
        const batch = db.batch();
        for (const doc of chunk) {
          batch.delete(doc.ref);
        }
        await batch.commit();
      }
      console.log(`   🗑️ Batch deleted ${snap.docs.length} docs from ${label}.`);
    }
  } catch (manualErr) {
    console.warn(`   ⚠️ Could not delete ${label}:`, manualErr.message);
  }
}

// Helper to batch-delete any Firestore query/collection in chunks of 400
async function batchDeleteQuery(querySnapshot, label = 'documents') {
  const docs = querySnapshot.docs;
  if (!docs || docs.length === 0) return 0;
  
  const CHUNK_SIZE = 400;
  let deletedCount = 0;

  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const doc of chunk) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deletedCount += chunk.length;
  }
  return deletedCount;
}

async function wipeAll() {
  console.log('\n=============================================================');
  console.log('🧹 TRASHTRACK COMPLETE SYSTEM WIPE: AUTHENTICATION & PROFILES');
  console.log('   Target: 100% of Firebase Authentication (CENRO, CICTO, Drivers,');
  console.log('           Coordinators, Residents, and all Test Accounts)');
  console.log('   Target: All Identifiers (CENRO, Driver, License, Coordinator)');
  console.log('   Target: User Collections (users, userNotifications, user_settings)');
  console.log('=============================================================\n');

  // 1. Delete ALL users from Firebase Authentication (No exceptions)
  console.log('1️⃣ Wiping Firebase Authentication (100% of accounts)...');
  let nextPageToken;
  let totalAuthDeleted = 0;

  do {
    const listResult = await auth.listUsers(1000, nextPageToken);
    const uidsToDelete = listResult.users.map((u) => u.uid);

    if (uidsToDelete.length > 0) {
      // Revoke refresh tokens so active browser/app sessions immediately invalidate
      await Promise.allSettled(uidsToDelete.map((uid) => auth.revokeRefreshTokens(uid)));
      const deleteResult = await auth.deleteUsers(uidsToDelete);
      const successCount = uidsToDelete.length - deleteResult.errors.length;
      totalAuthDeleted += successCount;
      console.log(`   🗑️ Batch deleted ${successCount} auth account(s).`);
      if (deleteResult.errors.length > 0) {
        console.warn(`   ⚠️ ${deleteResult.errors.length} deletion errors:`, deleteResult.errors);
      }
    }

    nextPageToken = listResult.pageToken;
  } while (nextPageToken);

  console.log(`✅ Authentication wipe complete: Deleted ${totalAuthDeleted} total account(s).\n`);

  // 2. Wipe Firestore "users" collection (including all subcollections like devices)
  console.log('2️⃣ Cleaning Firestore "users" collection...');
  await safeRecursiveDelete(db.collection('users'), 'Firestore "users" collection');
  console.log(`✅ All user profiles wiped from Firestore.\n`);

  // 3. Wipe Firestore "identifiers" collection and ALL nested items
  console.log('3️⃣ Wiping Firestore "identifiers" (CENRO, Driver, License, Coordinator)...');
  
  // Specific known subcollections cleanup as explicit safeguard
  const knownIdentifierSubcollections = [
    ['cenro', 'items'],
    ['driver', 'items'],
    ['license', 'items'],
    ['coordinator', 'items'],
    ['coordinator_barangays', 'items'],
  ];

  for (const [docName, subColName] of knownIdentifierSubcollections) {
    try {
      const subSnap = await db.collection('identifiers').doc(docName).collection(subColName).get();
      const count = await batchDeleteQuery(subSnap, `identifiers/${docName}/${subColName}`);
      if (count > 0) {
        console.log(`   🗑️ Deleted ${count} item(s) from identifiers/${docName}/${subColName}`);
      }
    } catch (e) {
      console.warn(`   ⚠️ Note on identifiers/${docName}/${subColName}:`, e.message);
    }
  }

  // Recursive delete on the entire identifiers collection
  await safeRecursiveDelete(db.collection('identifiers'), 'Firestore "identifiers" collection');

  // Also wipe legacy identifier collections if they exist
  const legacyCollections = ['employee_ids', 'license_numbers', 'coordinator_employee_ids'];
  for (const colName of legacyCollections) {
    try {
      const snap = await db.collection(colName).get();
      if (!snap.empty) {
        const count = await batchDeleteQuery(snap, colName);
        console.log(`   🗑️ Removed ${count} legacy record(s) from "${colName}".`);
      }
    } catch {}
  }
  console.log(`✅ All identifiers completely wiped.\n`);

  // 4. Clear driver QR credentials, OTP verifications, and truck locations
  console.log('4️⃣ Cleaning driver credentials, live locations, & temporary OTPs...');
  const qrSnap = await db.collection('driver_qr_credentials').get();
  const qrDeleted = await batchDeleteQuery(qrSnap, 'driver QR credentials');
  console.log(`   🗑️ Removed ${qrDeleted} driver QR credential(s).`);

  const locSnap = await db.collection('truck_locations').get();
  const locDeleted = await batchDeleteQuery(locSnap, 'truck locations');
  console.log(`   🗑️ Removed ${locDeleted} active truck GPS location entries.`);

  const otpSnap = await db.collection('cicto_otp_verifications').get();
  const otpDeleted = await batchDeleteQuery(otpSnap, 'OTP verifications');
  console.log(`   🗑️ Removed ${otpDeleted} pending OTP verification(s).\n`);

  // 5. Clear user-centric collections: userNotifications & user_settings
  console.log('5️⃣ Wiping "userNotifications" and "user_settings" collections...');
  await safeRecursiveDelete(db.collection('userNotifications'), 'Firestore "userNotifications" collection');
  await safeRecursiveDelete(db.collection('user_settings'), 'Firestore "user_settings" collection');
  console.log(`✅ "userNotifications" and "user_settings" collections wiped.\n`);

  // 6. Reset Truck Assignments in 'trucks'
  console.log('6️⃣ Releasing truck assignments in "trucks" collection...');
  const trucksSnapshot = await db.collection('trucks').get();
  let resetTruckCount = 0;
  const truckBatch = db.batch();

  for (const tDoc of trucksSnapshot.docs) {
    const tData = tDoc.data();
    if (tData.assignedDriverId || tData.shiftStartedAt) {
      truckBatch.update(tDoc.ref, {
        assignedDriverId: null,
        assignedDriverName: null,
        shiftStartedAt: null,
        status: 'active',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      resetTruckCount++;
    }
  }

  if (resetTruckCount > 0) {
    await truckBatch.commit();
  }
  console.log(`✅ Reset ${resetTruckCount} truck(s) back to unassigned inventory.\n`);

  // 7. Clear driver assignments in 'barangay_schedules'
  console.log('7️⃣ Clearing driver assignments in "barangay_schedules"...');
  const schedSnap = await db.collection('barangay_schedules').get();
  let resetSchedCount = 0;
  const schedBatch = db.batch();

  for (const sDoc of schedSnap.docs) {
    const sData = sDoc.data();
    let changed = false;
    const updates = {};
    if (sData.assignedDriverId || sData.assignedDriverName || sData.assignedDriverEmail) {
      updates.assignedDriverId = null;
      updates.assignedDriverName = null;
      updates.assignedDriverEmail = null;
      changed = true;
    }
    if (Array.isArray(sData.specificSchedules) && sData.specificSchedules.length > 0) {
      updates.specificSchedules = sData.specificSchedules.map((ss) => ({
        ...ss,
        assignedDriverId: null,
        assignedDriverName: null,
      }));
      changed = true;
    }
    if (changed) {
      updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      schedBatch.update(sDoc.ref, updates);
      resetSchedCount++;
    }
  }
  if (resetSchedCount > 0) {
    await schedBatch.commit();
  }
  console.log(`✅ Cleared driver assignments from ${resetSchedCount} schedule(s).\n`);

  console.log('=============================================================');
  console.log('🎉 COMPLETE RESET SUCCESSFUL!');
  console.log('   All Firebase Authentication users have been wiped.');
  console.log('   All identifiers (CENRO, driver, license, coordinator) cleared.');
  console.log('   All user notifications and user settings cleared.');
  console.log('=============================================================');
  console.log('\n💡 Next steps to re-populate:');
  console.log('   • To re-provision master CICTO & demo data:   npm run db:seed');
  console.log('   • To seed 5 pre-verified resident accounts:    npm run seed:accounts\n');
}

wipeAll().catch((err) => {
  console.error('\n❌ Wipe failed:', err);
  process.exit(1);
});

