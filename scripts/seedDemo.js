/**
 * Danao City Municipal Database Bootstrap & Seeder Script
 * Office of the City Information and Communications Technology Officer (CICTO)
 * 
 * Usage:
 *   npm run db:seed
 * 
 * Purpose:
 *   Initializes a freshly wiped database for defense presentation:
 *   1. Provisions master CICTO account (cicto@trashtrack.gov.ph / CICTOAdmin2026!) with Super Admin custom claims.
 *   2. Seeds 21 primary Danao City Barangays (leaving the other 21 for live creation demonstration).
 *   3. Seeds the official CENRO Souvenir Rewards Catalog.
 *   4. Seeds initial Municipal Truck Fleet.
 *   5. Configures core system settings (AI Auto-Dispatch).
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');

if (!fs.existsSync(keyPath)) {
  console.log('\n🏛️ =========================================================');
  console.log('🏛️  DANAO CITY MUNICIPAL DATABASE BOOTSTRAPPER (CICTO)');
  console.log('🏛️ =========================================================\n');
  console.error('⚠️  serviceAccountKey.json was not found in the root directory.');
  console.log('\n👉 To run the CLI seeder via terminal:');
  console.log('   1. Open Firebase Console (https://console.firebase.google.com)');
  console.log('   2. Select trashtruck-swu-98ce9 ➔ Project Settings ➔ Service accounts');
  console.log('   3. Click "Generate new private key"');
  console.log('   4. Save the downloaded file as "serviceAccountKey.json" in the project root.\n');
  console.log('💡 PRO-TIP FOR DEFENSE:');
  console.log('   You can also bootstrap directly from the web browser with 1 click!');
  console.log('   Log into http://localhost:8081/cicto ➔ Data Governance ➔ "Bootstrap Danao Data"\n');
  process.exit(0);
}

const serviceAccount = require(keyPath);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id || 'trashtruck-swu-98ce9',
});

const db = admin.firestore();
const auth = admin.auth();

// Initial 21 Danao City Barangays (Half of the 42 total barangays)
const INITIAL_DANAO_BARANGAYS = [
  'Poblacion',
  'Suba',
  'Looc',
  'Sabang',
  'Guinsay',
  'Maslog',
  'Taytay',
  'Tuburan Sur',
  'Cogon-Cruz',
  'Baliang',
  'Cabungahan',
  'Cambanay',
  'Dunggoan',
  'Guinacot',
  'Ibo',
  'Lawaan',
  'Malapoc',
  'Manlayag',
  'Mantija',
  'Quisol',
  'Santican',
];

// Official CENRO Souvenirs
const SOUVENIR_CATALOG = [
  {
    id: 'tumbler',
    name: 'Eco-Friendly Tumbler',
    type: 'Matte Green, Double-walled insulation',
    cost: 1000,
    stock: 50,
    category: 'Merchandise',
  },
  {
    id: 'tote',
    name: 'CENRO Tote Bag',
    type: 'Canvas, Heavy Duty',
    cost: 500,
    stock: 100,
    category: 'Apparel',
  },
  {
    id: 'kit',
    name: 'Reusable Utensil Kit',
    type: 'Bamboo with pouch',
    cost: 2000,
    stock: 30,
    category: 'Eco Kit',
  },
  {
    id: 'seedling_pack',
    name: 'Native Tree Seedling Pack',
    type: 'Narra & Mahogany Seedlings (Set of 3)',
    cost: 300,
    stock: 75,
    category: 'Eco Initiative',
  },
];

// Municipal Fleet Inventory
const INITIAL_TRUCKS = [
  {
    id: 'TRK-01',
    plateNumber: 'GA-2026-01',
    model: 'Isuzu Elf 6-Wheeler Compactor (10m³)',
    capacityKg: 5000,
    status: 'available',
    currentBarangay: 'Poblacion',
    fuelLevelPercent: 95,
  },
  {
    id: 'TRK-02',
    plateNumber: 'GA-2026-02',
    model: 'Hino 500 Heavy Compactor (16m³)',
    capacityKg: 8000,
    status: 'available',
    currentBarangay: 'Sabang',
    fuelLevelPercent: 88,
  },
  {
    id: 'TRK-03',
    plateNumber: 'GA-2026-03',
    model: 'Fuso Canter Mini-Compactor (6m³)',
    capacityKg: 3500,
    status: 'available',
    currentBarangay: 'Suba',
    fuelLevelPercent: 92,
  },
];

async function seedDatabase() {
  console.log('\n🏛️ =========================================================');
  console.log('🏛️  DANAO CITY MUNICIPAL DATABASE BOOTSTRAPPER (CICTO)');
  console.log('🏛️ =========================================================\n');

  // 1. Provision / Verify CICTO Master Super Administrator
  const cictoEmail = 'cicto@trashtrack.gov.ph';
  const cictoPassword = 'CICTOAdmin2026!';
  const cictoDisplayName = 'CICTO Super Administrator';

  console.log(`🔑 [1/5] Setting up CICTO Master Super Admin (${cictoEmail})...`);
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(cictoEmail);
    console.log(`   ℹ️ Existing Auth account found (UID: ${userRecord.uid}). Updating password and claims...`);
    await auth.updateUser(userRecord.uid, {
      password: cictoPassword,
      displayName: cictoDisplayName,
      emailVerified: true,
      disabled: false,
    });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.log(`   ➕ Creating new Firebase Auth master user...`);
      userRecord = await auth.createUser({
        email: cictoEmail,
        password: cictoPassword,
        displayName: cictoDisplayName,
        emailVerified: true,
        disabled: false,
      });
    } else {
      throw err;
    }
  }

  // Set Custom Claims for CICTO
  await auth.setCustomUserClaims(userRecord.uid, {
    cicto: true,
    admin: true,
    role: 'cicto',
  });
  console.log(`   🛡️ Custom Claims minted: { cicto: true, admin: true, role: 'cicto' }`);

  // Write master profile to Firestore
  await db.collection('users').doc(userRecord.uid).set({
    uid: userRecord.uid,
    email: cictoEmail,
    displayName: cictoDisplayName,
    name: cictoDisplayName,
    role: 'cicto',
    verified: true,
    status: 'active',
    department: 'City Information and Communications Technology Office (CICTO Danao)',
    agency: 'CICTO Danao City',
    permissions: [
      'system.oversight',
      'fleet.audit',
      'users.manage',
      'data.export',
      'cenro.command',
      'rewards.reconcile',
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastLogin: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`   ✅ CICTO Super Admin profile registered in Firestore.`);

  // 2. Seed 21 Primary Barangays
  console.log(`\n📍 [2/5] Seeding ${INITIAL_DANAO_BARANGAYS.length} Danao City Barangays (Half of 42)...`);
  const barangayBatch = db.batch();
  for (const bName of INITIAL_DANAO_BARANGAYS) {
    const docId = bName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const docRef = db.collection('barangays').doc(docId);
    barangayBatch.set(docRef, {
      name: bName,
      slug: docId,
      city: 'Danao City',
      province: 'Cebu',
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      seededBy: 'CICTO Master Bootstrap',
    }, { merge: true });
  }
  await barangayBatch.commit();
  console.log(`   ✅ 21 Barangays successfully seeded into /barangays collection.`);
  console.log(`   ℹ️ Note: 21 remaining barangays left unseeded for live creation demo during defense.`);

  // 3. Seed CENRO Souvenir Reward Catalog
  console.log(`\n🎁 [3/5] Seeding Official CENRO Souvenir Rewards Catalog...`);
  const rewardBatch = db.batch();
  for (const item of SOUVENIR_CATALOG) {
    const catalogRef = db.collection('reward_catalog').doc(item.id);
    rewardBatch.set(catalogRef, {
      ...item,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Also mirror into app_config/rewards
    const appConfigRef = db.collection('app_config').doc('rewards');
    rewardBatch.set(appConfigRef, {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      items: SOUVENIR_CATALOG,
    }, { merge: true });
  }
  await rewardBatch.commit();
  console.log(`   ✅ Souvenir catalog initialized in /reward_catalog and /app_config/rewards.`);

  // 4. Seed Municipal Trucks Fleet
  console.log(`\n🚛 [4/5] Seeding Municipal Fleet Inventory...`);
  const truckBatch = db.batch();
  for (const truck of INITIAL_TRUCKS) {
    const truckRef = db.collection('trucks').doc(truck.id);
    truckBatch.set(truckRef, {
      ...truck,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await truckBatch.commit();
  console.log(`   ✅ ${INITIAL_TRUCKS.length} Municipal trucks registered in /trucks collection.`);

  // 5. Seed Core System Settings (Auto-Dispatch Enabled)
  console.log(`\n⚙️  [5/5] Configuring Core Municipal System Settings...`);
  await db.collection('system_settings').doc('auto_dispatch').set({
    enabled: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedByEmail: cictoEmail,
    updatedByUid: userRecord.uid,
    systemMode: 'autonomous_ai_routing',
    city: 'Danao City',
  }, { merge: true });
  console.log(`   ✅ AI Auto-Dispatch enabled in /system_settings/auto_dispatch.`);

  console.log('\n🎉 =========================================================');
  console.log('🎉  MUNICIPAL DATABASE SEEDING COMPLETED SUCCESSFULLY!');
  console.log('🎉  CICTO Login:    cicto@trashtrack.gov.ph');
  console.log('🎉  CICTO Password: CICTOAdmin2026!');
  console.log('🎉 =========================================================\n');
}

seedDatabase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Seeder encountered an error:', err);
    process.exit(1);
  });
