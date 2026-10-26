import { getTransitionConfig } from '@/utils/transitions';
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={getTransitionConfig('auth')}
    >
      <Stack.Screen 
        name="login" 
        options={{ 
          headerShown: false,
          title: 'Login',
          ...getTransitionConfig('auth'),
        }} 
      />
      <Stack.Screen 
        name="signup" 
        options={{ 
          headerShown: false,
          title: 'Sign Up',
          ...getTransitionConfig('auth'),
        }} 
      />
      <Stack.Screen 
        name="loading" 
        options={{ 
          headerShown: false,
          title: 'Loading',
          ...getTransitionConfig('fade'),
        }} 
      />
    </Stack>
  );
}
