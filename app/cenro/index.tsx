import React from 'react';
import { useAuthContext } from '@/components/AuthContext';
import PortalLoginForm from '@/components/admin/PortalLoginForm';
import { PortalLoadingScreen } from '@/components/admin';

export default function CenroPortalPage() {
  return <PortalLoginForm portal="cenro" />;
}
