import { getTransitionConfig } from '@/utils/transitions';
import { Stack } from 'expo-router';

export default function AdminLayout() {
  return (
    <Stack
      screenOptions={getTransitionConfig('admin')}
    >
      <Stack.Screen
        name="splash"
        options={{
          title: 'Admin Portal',
          headerShown: false,
          ...getTransitionConfig('fade'),
        }}
      />
      <Stack.Screen
        name="login"
        options={{
          title: 'Admin Login',
          headerShown: false,
          ...getTransitionConfig('admin'),
        }}
      />
      <Stack.Screen
        name="dashboard"
        options={{
          title: 'Admin Dashboard',
          headerShown: false,
          ...getTransitionConfig('admin'),
        }}
      />
    </Stack>
  );
} 