import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import DieselEstimateTab from '@/components/admin/cenro/DieselEstimateTab';

export default function DriverDieselLog() {
  const router = useRouter();
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#F3F6F4' }} edges={['top', 'left', 'right']}>
    <TouchableOpacity accessibilityRole="button" onPress={() => router.replace('/(driver)' as any)} style={{ padding: 16 }}><Text style={{ color: '#166534', fontWeight: '700' }}>← Driver home</Text></TouchableOpacity>
    <DieselEstimateTab userRole="driver" />
  </SafeAreaView>;
}
