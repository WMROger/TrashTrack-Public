import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import React from 'react';
import { Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function SplashScreen({ onGetStarted }: { onGetStarted: () => void }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Image
          source={require('@/assets/images/trashtrack_logo_driver.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Welcome to TrashTrack</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Know the Waste, Clean with Haste</Text>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.getStartedButton, { backgroundColor: colors.primary }]}
          onPress={onGetStarted}
          activeOpacity={0.85}
        >
          <Text style={[styles.getStartedText, { color: colors.surface }]}>Get Started</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 240,
    height: 240,
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    fontFamily: Platform.select({ ios: 'System', android: 'Roboto' }),
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: Platform.select({ ios: 'System', android: 'Roboto' }),
    textAlign: 'center',
  },
  footer: {
    paddingTop: 12,
  },
  getStartedButton: {
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  getStartedText: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: Platform.select({ ios: 'System', android: 'Roboto' }),
  },
});
