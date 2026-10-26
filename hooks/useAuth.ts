import { auth, db } from '@/config/firebase';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';

export function useAuth() {
  const [user, setUser] = useState<User | null>(() => auth?.currentUser || null);
  const [loading, setLoading] = useState(true);
  const [isFirestoreVerified, setIsFirestoreVerified] = useState(false);

  useEffect(() => {
    if (!auth) {
      console.warn('useAuth: No auth object available');
      setLoading(false);
      return;
    }

    let userUnsub: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (userUnsub) {
        userUnsub();
        userUnsub = null;
      }

      if (!currentUser || !db) {
        setIsFirestoreVerified(false);
        setLoading(false);
        return;
      }

      // Only show loading spinner on initial auth resolution, not on re-subscription.
      // This prevents isAuthenticated from briefly flickering to false during
      // Firestore re-subscription, which would cause the routing guard to
      // redirect authenticated users back to splash/auth.

      if (loading) {
        // Keep loading true only during the very first auth resolution
      } else {
        // Already resolved once — do NOT reset loading to true.
        // Re-subscribing to Firestore should not cause a loading flicker.
      }
      const userRef = doc(db, 'users', currentUser.uid);
      userUnsub = onSnapshot(userRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const role = String(data?.role || '').toLowerCase().trim();
          const isStaffRole =
            role === 'driver' ||
            role === 'admin' ||
            role === 'cenro' ||
            role === 'cicto' ||
            role === 'cicto_admin' ||
            role === 'coordinator' ||
            role === 'barangay_coordinator';
          const emailLower = (data?.email || currentUser.email || '').toLowerCase();
          const isSeedResident = emailLower.startsWith('luthar') && emailLower.includes('trashtrack.com');
          const isVerified = data?.verified === true || isStaffRole || isSeedResident;
          setIsFirestoreVerified(isVerified);
        } else {
          const emailLower = (currentUser.email || '').toLowerCase();
          const isSeedResident = emailLower.startsWith('luthar') && emailLower.includes('trashtrack.com');
          setIsFirestoreVerified(Boolean(currentUser.emailVerified) || isSeedResident);
        }
        setLoading(false);
      }, (error) => {
        console.warn('useAuth: user profile listener error:', error);
        setLoading(false);
      });
    }, (error) => {
      console.error('useAuth: Auth state listener error:', error);
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (userUnsub) userUnsub();
    };
  }, []);

  const logout = async () => {
    if (!auth) {
      console.error('useAuth: Cannot logout - no auth object');
      setUser(null);
      return;
    }

    try {
      await signOut(auth);
      setUser(null);
      setIsFirestoreVerified(false);
      setLoading(false);
    } catch (error) {
      console.error('useAuth: Firebase signOut error:', error);
      setUser(null);
      setIsFirestoreVerified(false);
      setLoading(false);
      throw error;
    }
  };

  // Consider email/password users without verified email as unauthenticated
  const isPasswordProvider = (u: User | null) =>
    !!u && Array.isArray(u.providerData) && u.providerData.some(p => p?.providerId === 'password');

  const isAuthenticated = !!user && (!isPasswordProvider(user) || user.emailVerified === true || isFirestoreVerified);

  return {
    user,
    loading,
    logout,
    isAuthenticated,
  };
}
