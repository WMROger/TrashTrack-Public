import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { useAuthContext } from '@/components/AuthContext';
import { Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { PortalLoadingScreen } from '@/components/admin';

export default function Index() {
  const { user, loading, isAuthenticated } = useAuthContext();
  const [resolvedRole, setResolvedRole] = useState<string | null>(null);
  const [checkingRole, setCheckingRole] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      setResolvedRole(null);
      return;
    }

    let isMounted = true;
    setCheckingRole(true);

    const fetchRole = async () => {
      try {
        if (db) {
          const snap = await getDoc(doc(db, 'users', user.uid));
          if (snap.exists() && isMounted) {
            const r = String(snap.data()?.role || 'user').toLowerCase().trim();
            setResolvedRole(r);
            return;
          }
        }
        if (isMounted) setResolvedRole('user');
      } catch {
        if (isMounted) setResolvedRole('user');
      } finally {
        if (isMounted) setCheckingRole(false);
      }
    };

    fetchRole();
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, user?.uid]);

  if (loading || (isAuthenticated && checkingRole && !resolvedRole)) {
    return <PortalLoadingScreen portal="default" />;
  }

  if (isAuthenticated && user && resolvedRole) {
    if (resolvedRole === 'cicto' || resolvedRole === 'cicto_admin') {
      if (Platform.OS === 'web') {
        return <Redirect href="/cicto/dashboard" />;
      }
      return <Redirect href="/(tabs)/home" />;
    }

    if (
      resolvedRole === 'admin' ||
      resolvedRole === 'cenro' ||
      resolvedRole === 'coordinator' ||
      resolvedRole === 'barangay_coordinator' ||
      resolvedRole === 'cenro_officer' ||
      resolvedRole === 'mayor'
    ) {
      if (Platform.OS === 'web') {
        return <Redirect href="/admin/dashboard" />;
      }
      return <Redirect href="/(tabs)/home" />;
    }

    if (resolvedRole === 'driver') {
      return <Redirect href="/(driver)" />;
    }

    return <Redirect href="/(tabs)/home" />;
  }

  if (Platform.OS === 'web') {
    return <Redirect href="/cenro" />;
  }

  return <Redirect href="/splash" />;
}