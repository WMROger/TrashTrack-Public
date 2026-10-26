import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useAuthContext } from '@/components/AuthContext';
import PortalLoginForm from '@/components/admin/PortalLoginForm';
import { PortalLoadingScreen } from '@/components/admin';

export default function AdminLoginPage() {
  const params = useLocalSearchParams<{ portal?: string }>();
  const isCicto = params.portal === 'cicto';

  return <PortalLoginForm portal={isCicto ? 'cicto' : 'cenro'} />;
}
