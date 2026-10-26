const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');

if (!fs.existsSync(keyPath)) {
  console.error('❌ serviceAccountKey.json was not found in the root directory.');
  console.log('To clear Firestore via script, download serviceAccountKey.json from Firebase Console.');
  process.exit(1);
}

const serviceAccount = require(keyPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function clearUsersCollection() {
  console.log('🧹 Clearing Firestore "users" collection...');
  const usersRef = db.collection('users');
  const snapshot = await usersRef.get();

  if (snapshot.empty) {
    console.log('ℹ️  No documents found in "users" collection.');
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
  console.log(`✅ Successfully deleted ${snapshot.size} user documents from Firestore.`);
}

clearUsersCollection().catch(console.error);
