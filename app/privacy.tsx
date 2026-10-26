import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Official Privacy Policy Page (#15)
 * Compliant with the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).
 */
export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Privacy Policy • TrashTrack Danao City', headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        >
          <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>REPUBLIC ACT NO. 10173 COMPLIANT</Text>
          <Text style={styles.headerTitle}>Privacy Policy</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.updatedText}>Effective Date: October 2026 • Local Government of Danao City, Cebu</Text>
          <Text style={styles.lead}>
            The City Environment and Natural Resources Office (CENRO) and the City Information and Communications
            Technology Office (CICTO) of Danao City are committed to protecting your personal data in strict compliance
            with the <Text style={styles.bold}>Philippine Data Privacy Act of 2012 (RA 10173)</Text>.
          </Text>

          <Text style={styles.sectionTitle}>1. Personal Information We Collect</Text>
          <Text style={styles.paragraph}>
            • <Text style={styles.bold}>Account & Identity Data:</Text> Full name, email address, phone number, and
            assigned barangay when registering as a Citizen, Driver, Barangay Coordinator, or Administrator.{'\n'}
            • <Text style={styles.bold}>Geolocation Data:</Text> GPS coordinates captured only while submitting a waste
            report, verifying a collection pickup, or operating a municipal garbage truck on an active shift.{'\n'}
            • <Text style={styles.bold}>Visual Evidence & Media:</Text> Photos of waste piles or collection completion
            sites uploaded for verification and AI waste classification.{'\n'}
            • <Text style={styles.bold}>Device & Diagnostic Logs:</Text> Push notification tokens, crash reference IDs,
            and anonymized funnel events used to maintain service reliability.
          </Text>

          <Text style={styles.sectionTitle}>2. How We Use Your Data</Text>
          <Text style={styles.paragraph}>
            Your information is processed exclusively for official municipal solid waste management operations:{'\n'}
            • Dispatching CENRO collection trucks to reported waste hotspots across Danao City&apos;s 42 barangays.{'\n'}
            • Sending real-time collection schedule notifications and truck arrival proximity alerts.{'\n'}
            • Awarding and verifying Eco-Reward points and souvenir redemptions.{'\n'}
            • Maintaining security audit trails and preventing fraudulent or automated abuse.
          </Text>

          <Text style={styles.sectionTitle}>3. Data Storage, Security & Retention</Text>
          <Text style={styles.paragraph}>
            • All data is transmitted over TLS 256-bit encryption and protected by strict role-based security rules so
            citizens can only view their own private records.{'\n'}
            • API keys and AI processing credentials are isolated on secure backend servers.{'\n'}
            • Resident accounts inactive for more than six (6) months are automatically placed in deactivated status and
            may be reactivated upon request or permanently deleted by the account owner at any time in Settings.
          </Text>

          <Text style={styles.sectionTitle}>4. Your Rights Under RA 10173</Text>
          <Text style={styles.paragraph}>
            As a data subject, you have the right to be informed, to access and update your profile, to object to
            processing, to export your reports, and to permanently delete your account directly from the TrashTrack
            Settings page.
          </Text>

          <Text style={styles.sectionTitle}>5. Contact Our Data Protection Office</Text>
          <Text style={styles.paragraph}>
            For privacy inquiries, data access requests, or concerns, please contact:{'\n'}
            • <Text style={styles.bold}>CICTO Data Protection Desk:</Text> cicto@danao.gov.ph{'\n'}
            • <Text style={styles.bold}>CENRO Operations Desk:</Text> cenro@danao.gov.ph{'\n'}
            • <Text style={styles.bold}>Office Address:</Text> Danao City Hall Compound, Poblacion, Danao City, Cebu 6004
          </Text>

          <View style={styles.footerActions}>
            <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/terms' as any)}>
              <MaterialIcons name="gavel" size={16} color="#059669" />
              <Text style={styles.linkBtnText}>View Terms of Service</Text>
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

