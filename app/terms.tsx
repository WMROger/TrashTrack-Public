import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Official Terms of Service Page (#15)
 * Governs the use of TrashTrack Danao City by Citizens, Drivers, Coordinators, and Administrators.
 */
export default function TermsOfServiceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Terms of Service • TrashTrack Danao City', headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        >
          <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>MUNICIPAL DIGITAL GOVERNANCE</Text>
          <Text style={styles.headerTitle}>Terms of Service</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.updatedText}>Effective Date: October 2026 • City of Danao, Province of Cebu</Text>
          <Text style={styles.lead}>
            By creating an account or using the <Text style={styles.bold}>TrashTrack Danao City</Text> mobile and web
            platform, you agree to abide by these official Terms of Service established by CENRO and CICTO Danao City.
          </Text>

          <Text style={styles.sectionTitle}>1. Authentic Waste Reporting & Citizen Conduct</Text>
          <Text style={styles.paragraph}>
            • Citizens must submit genuine photos and accurate locations of uncollected solid waste within Danao City.{'\n'}
            • Submitting fabricated, duplicate, offensive, or non-waste photos to manipulate Eco-Reward points is
            strictly prohibited and may result in point forfeiture or account suspension.{'\n'}
            • Proper waste segregation (Biodegradable vs. Non-Biodegradable) in accordance with Republic Act No. 9003
            (Ecological Solid Waste Management Act of 2000) is encouraged and rewarded.
          </Text>

          <Text style={styles.sectionTitle}>2. Eco-Rewards & Souvenir Redemptions</Text>
          <Text style={styles.paragraph}>
            • Eco-Reward points are non-monetary civic incentives awarded upon verified waste collection reports.{'\n'}
            • Points have no cash value, cannot be exchanged for currency, and are redeemable solely for official
            CENRO/LGU eco-souvenirs subject to available inventory.
          </Text>

          <Text style={styles.sectionTitle}>3. Driver & Coordinator Responsibilities</Text>
          <Text style={styles.paragraph}>
            • Official drivers and barangay coordinators are issued personal credentials and QR badges that must not be
            shared with unauthorized individuals.{'\n'}
            • Drivers must operate vehicles safely and only interact with the mobile app while the vehicle is safely
            parked.
          </Text>

          <Text style={styles.sectionTitle}>4. Fair Use, Rate Limits & System Integrity</Text>
          <Text style={styles.paragraph}>
            • Automated scraping, spamming AI image scans, or attempting to bypass security rules and rate limits is
            prohibited.{'\n'}
            • To protect municipal resources, AI waste analysis is subject to daily per-user and system-wide quotas,
            with automatic fallback to on-device classification.
          </Text>

          <Text style={styles.sectionTitle}>5. Service Availability & Emergency Overrides</Text>
          <Text style={styles.paragraph}>
            CICTO and CENRO reserve the right to temporarily place the platform into maintenance mode, adjust collection
            schedules during severe weather or emergencies, or update these terms as municipal operations evolve.
          </Text>

          <View style={styles.footerActions}>
            <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/privacy' as any)}>
              <MaterialIcons name="privacy-tip" size={16} color="#059669" />
              <Text style={styles.linkBtnText}>View Privacy Policy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/contact' as any)}>
              <MaterialIcons name="support-agent" size={16} color="#059669" />
              <Text style={styles.linkBtnText}>Contact Support</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  header: {
    backgroundColor: '#1B4D3E',
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: '#A7F3D0',
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 780,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  updatedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
    marginBottom: 12,
  },
  lead: {
    fontSize: 14.5,
    color: '#374151',
    lineHeight: 22,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginTop: 12,
    marginBottom: 8,
  },
  paragraph: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 22,
    marginBottom: 12,
  },
  bold: {
    fontWeight: '700',
    color: '#111827',
  },
  footerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  linkBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#065F46',
  },
});

