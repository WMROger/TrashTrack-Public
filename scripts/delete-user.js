const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');

if (!fs.existsSync(keyPath)) {
  console.error('❌ serviceAccountKey.json was not found in the root directory.');
  console.log('To run admin CLI scripts, download serviceAccountKey.json from Firebase Console.');
  process.exit(1);
}

const serviceAccount = require(keyPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

async function deleteUserAccount(identifier) {
  if (!identifier) {
    console.error('❌ Please provide an email or UID to delete:');
    console.log('   Usage: node scripts/delete-user.js <email_or_uid>');
    process.exit(1);
  }

  const cleanIdentifier = identifier.trim();
  let userRecord;

  try {
    if (cleanIdentifier.includes('@')) {
      userRecord = await auth.getUserByEmail(cleanIdentifier);
    } else {
      userRecord = await auth.getUser(cleanIdentifier);
    }
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.warn(`⚠️ User "${cleanIdentifier}" not found in Firebase Auth. Searching Firestore only...`);
    } else {
      console.error(`❌ Error fetching user from Firebase Auth:`, err.message);
      process.exit(1);
    }
  }

  const uid = userRecord ? userRecord.uid : cleanIdentifier;
  const email = userRecord ? userRecord.email : cleanIdentifier;

  console.log(`\n🚨 Starting deletion for user: ${email} (UID: ${uid})`);

  // 1. Delete from Firebase Authentication
  if (userRecord) {
    try {
      await auth.deleteUser(uid);
      console.log('✅ 1. Deleted from Firebase Authentication.');
    } catch (authDeleteErr) {
      console.warn('⚠️ Could not delete from Firebase Auth:', authDeleteErr.message);
    }
  }

  // 2. Delete from Firestore
  try {
    const batch = db.batch();

    // Delete user profile doc
    const userDocRef = db.collection('users').doc(uid);
    batch.delete(userDocRef);

    // Delete user settings and driver credentials
    batch.delete(db.collection('user_settings').doc(uid));
    batch.delete(db.collection('driver_qr_credentials').doc(uid));

    // Delete user notifications
    const notifSnap = await db.collection('userNotifications').where('userId', '==', uid).get();
    notifSnap.forEach((nDoc) => {
      batch.delete(nDoc.ref);
    });

    // Delete any matching employee_ids (legacy)
    const empSnap = await db.collection('employee_ids').where('userId', '==', uid).get();
    empSnap.forEach((doc) => {
      console.log(`   - Removing linked employee ID record: ${doc.id}`);
      batch.delete(doc.ref);
    });

    // Delete identifiers in all subcollections where userId matches or by user doc
    const uData = userDocSnap.exists ? userDocSnap.data() : null;
    const uEmpId = uData?.employeeId;
    const uLic = uData?.licenseNumber;
    const uName = uData?.displayName || uData?.name;
    const uBrgy = uData?.assignedBarangay || uData?.barangay;

    if (uEmpId) {
      batch.delete(db.collection('identifiers').doc('driver').collection('items').doc(String(uEmpId)));
      batch.delete(db.collection('identifiers').doc('coordinator').collection('items').doc(String(uEmpId)));
      batch.delete(db.collection('identifiers').doc('cenro').collection('items').doc(String(uEmpId)));
      batch.delete(db.collection('coordinator_employee_ids').doc(String(uEmpId)));
    }
    if (uLic) {
      batch.delete(db.collection('identifiers').doc('license').collection('items').doc(String(uLic)));
      batch.delete(db.collection('license_numbers').doc(String(uLic)));
    }
    if (uBrgy) {
      const normB = String(uBrgy).trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
      batch.delete(db.collection('identifiers').doc('coordinator_barangays').collection('items').doc(normB));
    }

    // Unassign from trucks
    const truckSnap = await db.collection('trucks').where('assignedDriverId', '==', uid).get();
    truckSnap.forEach((tDoc) => {
      console.log(`   - Releasing truck assignment: ${tDoc.id}`);
      batch.update(tDoc.ref, {
        assignedDriverId: null,
        assignedDriverName: null,
        shiftStartedAt: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Unassign from schedules (both weekly and specific one-off pickups)
    const schedSnap = await db.collection('barangay_schedules').get();
    schedSnap.forEach((sDoc) => {
      const sData = sDoc.data();
      let changed = false;
      const updates = {};

      if (sData.assignedDriverId === uid || (uName && sData.assignedDriverName === uName)) {
        updates.assignedDriverId = null;
        updates.assignedDriverName = null;
        updates.assignedDriverEmail = null;
        changed = true;
      }

      if (Array.isArray(sData.specificSchedules) && sData.specificSchedules.length > 0) {
        const hasSpecific = sData.specificSchedules.some(
          (ss) => ss.assignedDriverId === uid || (uName && ss.assignedDriverName === uName)
        );
        if (hasSpecific) {
          updates.specificSchedules = sData.specificSchedules.map((ss) => {
            if (ss.assignedDriverId === uid || (uName && ss.assignedDriverName === uName)) {
              return { ...ss, assignedDriverId: null, assignedDriverName: null };
            }
            return ss;
          });
          changed = true;
        }
      }

      if (changed) {
        console.log(`   - Releasing schedule assignment: ${sDoc.id}`);
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        batch.update(sDoc.ref, updates);
      }
    });

    // Remove from group chat channels
    const chanSnap = await db.collection('interagency_channels').where('memberUids', 'array-contains', uid).get();
    chanSnap.forEach((cDoc) => {
      console.log(`   - Removing from interagency channel: ${cDoc.id}`);
      batch.update(cDoc.ref, {
        memberUids: admin.firestore.FieldValue.arrayRemove(uid),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Record audit log
    const auditDocRef = db.collection('audit_logs').doc();
    batch.set(auditDocRef, {
      event: 'user.deleted',
      actorUid: 'cli-admin-script',
      targetType: 'user',
      targetId: uid,
      metadata: {
        email,
        deletedVia: 'CLI delete-user script',
      },
      source: 'cli',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();
    console.log('✅ 2. Deleted from Cloud Firestore (users & employee_ids).');
    console.log(`🎉 Account ${email} was completely wiped in both Auth and Firestore!\n`);
  } catch (firestoreErr) {
    console.error('❌ Error deleting from Firestore:', firestoreErr.message);
  }
}

deleteUserAccount(process.argv[2]).catch(console.error);
