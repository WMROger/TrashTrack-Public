import { useRouter } from 'expo-router';
import React from 'react';
import SplashScreen from '@/components/SplashScreen';

export default function SplashScreenRoute() {
  const router = useRouter();

  const handleGetStarted = () => {
    // Navigate to the authentication page (not directly to login)
    router.replace('/auth');
  };

  return <SplashScreen onGetStarted={handleGetStarted} />;
}
