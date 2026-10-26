import { auth as firebaseAuth, db } from '@/config/firebase';
import { useAuth } from '@/hooks/useAuth';
import { signOut, updateProfile as updateFirebaseProfile, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import React, { createContext, ReactNode, useContext, useEffect } from 'react';
import { registerDeviceForFcm } from '@/services/pushTokenService';
import { ensureCictoProfileInFirestore, isCictoEmail, HARDCODED_CICTO_ACCOUNT } from '@/constants/cictoConfig';

export interface ProfileUpdateData {
  displayName?: string;
  photoURL?: string | null;
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  phoneNumber?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  updateProfile: (profileData: ProfileUpdateData) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  // Set of UIDs whose session lastLogin has already been updated to prevent repeated writes
  const recordedSessionLoginRef = React.useRef<Set<string>>(new Set());

  // Enforce account disabling/inactivity during an active session, not only at the next login.
  useEffect(() => {
    if (!auth.user?.uid || !db) return;
    const userDocRef = doc(db, 'users', auth.user.uid);

    return onSnapshot(
      userDocRef,
      snapshot => {
        const profile = snapshot.data();
        if (
          profile?.disabled === true ||
          profile?.status === 'disabled' ||
          (profile?.role === 'user' && profile?.status === 'inactive')
        ) {
          signOut(firebaseAuth).catch(error => console.warn('Unable to end deactivated account session:', error));
          return;
        }
      },
      error => {
        // Silently ignore permission-denied or resource-exhausted during session termination/quota
        if (error?.code !== 'permission-denied' && error?.code !== 'resource-exhausted') {
          console.warn('AuthContext profile listener warning:', error);
        }
      }
    );
  }, [auth.user?.uid]);

  // Strictly throttled once-per-session lastLogin timestamp write.
  // Uses updateDoc to NEVER create an empty phantom user document with only lastLogin.
  useEffect(() => {
    const currentUser = auth.user;
    const uid = currentUser?.uid;
    if (!uid || !db || recordedSessionLoginRef.current.has(uid)) return;
    recordedSessionLoginRef.current.add(uid);

    const syncSession = async () => {
      try {
        const userDocRef = doc(db, 'users', uid);
        const snap = await getDoc(userDocRef);

        if (!snap.exists()) {
          // If the profile document was wiped (e.g. via clean:auth):
          // Automatically heal the CICTO profile if this is the CICTO admin
          const email = (currentUser.email || '').toLowerCase().trim();
          if (isCictoEmail(email)) {
            await ensureCictoProfileInFirestore(
              uid,
              email,
              currentUser.displayName || HARDCODED_CICTO_ACCOUNT.displayName,
            );
          }
          // For regular accounts, do NOT create a bare document with only lastLogin!
          return;
        }

        // Document exists - update lastLogin safely
        await updateDoc(userDocRef, { lastLogin: serverTimestamp() });
      } catch (err) {
        // Silently catch permission or network errors
      }
    };

    syncSession();
  }, [auth.user]);

  useEffect(() => {
    if (!auth.user?.uid) return;
    registerDeviceForFcm(auth.user.uid).catch(error => console.warn('FCM device registration skipped:', error));
  }, [auth.user?.uid]);

  const updateProfile = async (profileData: ProfileUpdateData) => {
    if (!auth.user || !auth || !db) {
      throw new Error('User not authenticated or Firebase not available');
    }

    try {
      // Check if photoURL is a valid Cloudinary/HTTP URL (never allow local file paths)
      const isValidCloudinaryURL = profileData.photoURL && (
        profileData.photoURL.includes('cloudinary.com') || 
        profileData.photoURL.startsWith('https://') || 
        profileData.photoURL.startsWith('http://') ||
        profileData.photoURL.length > 2000
      );

      // Never allow local file paths to be saved
      const isLocalFilePath = profileData.photoURL && (
        profileData.photoURL.startsWith('file://') ||
        profileData.photoURL.startsWith('content://') ||
        profileData.photoURL.startsWith('asset://') ||
        profileData.photoURL.startsWith('blob:')
      );

      if (isLocalFilePath) {
        throw new Error('Cannot save local file path as profile URL. Please upload to Cloudinary first.');
      }

      // Update Firebase Auth profile (only displayName, skip photoURL for Cloudinary URLs)
      const authUpdateData: { displayName?: string; photoURL?: string | null } = {
        displayName: profileData.displayName,
      };
      
      // Only update Firebase Auth photoURL if it's a valid HTTP URL but not Cloudinary
      if (profileData.photoURL && !isValidCloudinaryURL && !isLocalFilePath) {
        authUpdateData.photoURL = profileData.photoURL;
      }

      await updateFirebaseProfile(auth.user, authUpdateData);

      // Get existing Firestore data to preserve Cloudinary URLs
      const userRef = doc(db, 'users', auth.user.uid);
      const existingDoc = await getDoc(userRef);
      const existingData = existingDoc.exists() ? existingDoc.data() : {};

      // Only update photoURL in Firestore if we have a valid Cloudinary URL
      // Otherwise, preserve existing Cloudinary URL
      let photoURLToSave = existingData.photoURL || '';
      
      if (isValidCloudinaryURL) {
        photoURLToSave = profileData.photoURL;
      } else if (!existingData.photoURL && profileData.photoURL && !isLocalFilePath) {
        // Only set non-Cloudinary URL if there's no existing URL
        photoURLToSave = profileData.photoURL;
      }

      const firestoreUpdate: Record<string, any> = {
        displayName: profileData.displayName || auth.user.displayName || '',
        name: profileData.displayName || auth.user.displayName || '',
        photoURL: photoURLToSave,
        updatedAt: serverTimestamp(),
      };
      if (profileData.firstName !== undefined) firestoreUpdate.firstName = profileData.firstName;
      if (profileData.middleInitial !== undefined) firestoreUpdate.middleInitial = profileData.middleInitial;
      if (profileData.lastName !== undefined) firestoreUpdate.lastName = profileData.lastName;
      if (profileData.phoneNumber !== undefined) {
        firestoreUpdate.phoneNumber = profileData.phoneNumber;
        firestoreUpdate.contactInfo = profileData.phoneNumber;
      }

      await setDoc(userRef, firestoreUpdate, { merge: true });

      if (isValidCloudinaryURL) {
        console.log('Profile updated: Cloudinary photo URL stored in Firestore');
      } else {
        console.log('Profile updated: Preserved existing Cloudinary URL in Firestore');
      }
    } catch (error) {
      console.error('Failed to update profile:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ ...auth, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
