import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

/**
 * Branded 404 Not Found Page (#11)
 * Replaces the default template with an official TrashTrack Danao City 404 screen.
 */
export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ title: '404 • Page Not Found', headerShown: false }} />
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <MaterialIcons name="explore-off" size={15} color="#059669" />
            <Text style={styles.badgeText}>TRASHTRACK DANAO CITY • NAVIGATION</Text>
          </View>

          <View style={styles.iconCircle}>
            <MaterialIcons name="wrong-location" size={44} color="#059669" />
          </View>

          <Text style={styles.errorCode}>ERROR 404 • ROUTE NOT FOUND</Text>
          <Text style={styles.title}>Page Not Found</Text>
          <Text style={styles.subtitle}>
            The page or route you are looking for doesn&apos;t exist, may have been moved, or requires a different municipal portal role.
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.replace('/')}
              activeOpacity={0.85}
            >
              <MaterialIcons name="home" size={18} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>Return to Dashboard</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.push('/contact' as any)}
              activeOpacity={0.85}
            >
              <MaterialIcons name="support-agent" size={18} color="#1B4D3E" />
              <Text style={styles.secondaryBtnText}>Contact CENRO / CICTO Support</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#064E3B',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 450,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 20,
  },
  badgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.6,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#ECFDF5',
    borderWidth: 2,
    borderColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorCode: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingVertical: 13,
    borderRadius: 12,
    width: '100%',
  },
  secondaryBtnText: {
    color: '#1B4D3E',
    fontSize: 14,
    fontWeight: '700',
  },
});
