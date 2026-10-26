import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
// @ts-ignore
import { browserLocalPersistence, getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore, initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

// ─── 1. Validate env vars ──────────────────────────────────────────────────
// Expo replaces EXPO_PUBLIC_* values in web bundles only when they are
// referenced with direct dot notation. Destructuring process.env works during
// server-side export but leaves the browser bundle with undefined values.
const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const authDomain = process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN;
const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;
const messagingSenderId = process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID;

console.log('Firebase Config Check:');
console.log('  apiKey:', !!apiKey);
console.log('  authDomain:', !!authDomain);
console.log('  projectId:', !!projectId);
console.log('  storageBucket:', !!storageBucket);
console.log('  messagingSenderId:', !!messagingSenderId);
console.log('  appId:', !!appId);

let app: any = null;
let db: any = null;
let auth: any = null;
let storage: any = null;

  const firebaseConfig = {
    apiKey: apiKey as string,
    authDomain: authDomain as string,
    projectId: projectId as string,
    storageBucket: storageBucket as string,
    messagingSenderId: messagingSenderId as string,
    appId: appId as string,
  };

  // ─── 2. App ───────────────────────────────────────────────────────────────
  // getApps().length > 0 means the module was already evaluated (lazy-bundle
  // or hot-reload). Calling initializeApp again would throw "already exists".
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    console.log('Firebase: App ready');
  } catch (e: any) {
    console.error('Firebase: App initialization error:', e.message);
  }

  // ─── 3. Firestore ─────────────────────────────────────────────────────────
  if (app) {
    try {
      // Use initializeFirestore with memoryLocalCache (in-memory only, no stale disk caching)
      // Enable auto-detect long polling on mobile to seamlessly select the optimal WebChannel transport
      db = initializeFirestore(app, {
        localCache: memoryLocalCache(),
        experimentalAutoDetectLongPolling: true,
      });
      console.log('Firebase: Firestore ready (memory cache / auto long-polling)');
    } catch {
      // Fallback to getFirestore if initializeFirestore throws (e.g. unsupported environment)
      try {
        db = getFirestore(app);
        console.log('Firebase: Firestore ready (fallback to memory cache)');
      } catch (fallbackError: any) {
        console.error('Firebase: Firestore initialization error:', fallbackError.message);
      }
    }
  }

  // ─── 4. Functions ─────────────────────────────────────────────────────────
  // ─── 5. Storage ───────────────────────────────────────────────────────────
  if (app) {
    try {
      storage = getStorage(app);
      console.log('Firebase: Storage ready');
    } catch (e: any) {
      console.error('Firebase: Storage error:', e.message);
    }
  }

  // ─── 6. Auth ──────────────────────────────────────────────────────────────
  // Web  → initializeAuth + browserLocalPersistence (explicit, no AsyncStorage)
  // Native → getAuth (Firebase SDK automatically uses AsyncStorage on native)
  //
  // NOTE: firebase/auth/react-native was REMOVED in Firebase v9+. Do NOT import
  // getReactNativePersistence — it does not exist in firebase v12. The default
  // getAuth() on native already uses the correct AsyncStorage persistence.
  if (app) {
    try {
      if (Platform.OS === 'web') {
        try {
          auth = initializeAuth(app, { persistence: browserLocalPersistence });
          console.log('Firebase: Auth ready (web / browserLocalPersistence)');
        } catch (e: any) {
          // "auth/already-initialized" → module re-evaluated, reuse existing instance
          if (
            e?.code === 'auth/already-initialized' ||
            String(e?.message).includes('already')
          ) {
            auth = getAuth(app);
            console.log('Firebase: Auth ready (web / getAuth — already initialized)');
          } else {
            throw e;
          }
        }
      } else {
        // Native: configure AsyncStorage persistence explicitly to ensure auth persistence and prevent hanging
        try {
          let nativePersistence: any = undefined;
          try {
            if (typeof getReactNativePersistence === 'function') {
              nativePersistence = getReactNativePersistence(AsyncStorage);
            }
          } catch (pErr) {
            console.warn('Firebase: persistence setup note:', pErr);
          }

          if (nativePersistence) {
            auth = initializeAuth(app, { persistence: nativePersistence });
            console.log('Firebase: Auth ready (native / AsyncStorage persistence)');
          } else {
            auth = getAuth(app);
            console.log('Firebase: Auth ready (native / getAuth fallback)');
          }
        } catch (nativeAuthErr: any) {
          if (
            nativeAuthErr?.code === 'auth/already-initialized' ||
            String(nativeAuthErr?.message).includes('already')
          ) {
            auth = getAuth(app);
            console.log('Firebase: Auth ready (native / getAuth — already initialized)');
          } else {
            auth = getAuth(app);
            console.log('Firebase: Auth ready (native / getAuth error fallback):', nativeAuthErr?.message);
          }
        }
      }
    } catch (e: any) {
      console.error('Firebase: Auth initialization failed:', e.message);
      auth = null;
    }
  }

  console.log('Firebase: Initialization complete. auth:', auth ? 'OK' : 'NULL');

export { auth, db, storage, firebaseConfig };
export default app;
