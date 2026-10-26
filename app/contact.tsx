import { useAuthContext } from '@/components/AuthContext';
import app, { auth, db } from '@/config/firebase';
import { trackFunnelEvent } from '@/services/analyticsService';
import { sanitizeUserError } from '@/utils/errorSanitizer';
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Official Contact & Municipal Support Screen (#19)
 * Provides direct CENRO & CICTO Danao City contact channels and an in-app
 * server-validated support ticket form.
 */
export default function ContactSupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();

  const [name, setName] = useState(user?.displayName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [category, setCategory] = useState<'collection' | 'account' | 'rewards' | 'technical'>('collection');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);

  const handleSubmit = async () => {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();

    if (cleanName.length < 2) {
      Alert.alert('Missing Name', 'Please enter your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address so we can reply to you.');
      return;
    }
    if (cleanSubject.length < 4) {
      Alert.alert('Missing Subject', 'Please provide a brief subject (at least 4 characters).');
      return;
    }
    if (cleanMessage.length < 10) {
      Alert.alert('Message Too Short', 'Please describe your concern in at least 10 characters.');
      return;
    }

    setSubmitting(true);
    try {
      let referenceCode = `TT-SUP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      try {
        if (app) {
          const fn = httpsCallable<any, { referenceCode?: string }>(getFunctions(app), 'submitSupportTicket');
          const res = await fn({
            name: cleanName,
            email: cleanEmail,
            category,
            subject: cleanSubject,
            message: cleanMessage,
          });
          if (res?.data?.referenceCode) {
            referenceCode = res.data.referenceCode;
          }
        }
      } catch {
        // Fallback direct Firestore write if Cloud Function is unreachable
        if (db) {
          await addDoc(collection(db, 'support_tickets'), {
            referenceCode,
            uid: auth?.currentUser?.uid || user?.uid || null,
            name: cleanName.slice(0, 100),
            email: cleanEmail.slice(0, 150),
            category,
            subject: cleanSubject.slice(0, 150),
            message: cleanMessage.slice(0, 2000),
            status: 'open',
            createdAt: serverTimestamp(),
          });
        }
      }

      await trackFunnelEvent('support_ticket_submitted', { category, referenceCode });
      setSubmittedRef(referenceCode);
      setSubject('');
      setMessage('');
    } catch (error) {
      Alert.alert('Submission Failed', sanitizeUserError(error, 'Could not submit your support ticket right now.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: 'Contact Support • TrashTrack Danao City', headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        >
          <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>DANAO CITY CENRO & CICTO HELP DESK</Text>
          <Text style={styles.headerTitle}>Contact & Support</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.maxWrap}>
          {/* Direct Municipal Channels */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Official Municipal Channels</Text>
            <Text style={styles.sectionSub}>
              Reach the City Environment and Natural Resources Office (CENRO) or CICTO Technical Oversight Desk:
            </Text>

            <View style={styles.channelGrid}>
              <TouchableOpacity
                style={styles.channelItem}
                onPress={() => Linking.openURL('mailto:cenro@danao.gov.ph')}
              >
                <View style={styles.channelIcon}>
                  <MaterialIcons name="email" size={20} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.channelLabel}>CENRO Operations Email</Text>
                  <Text style={styles.channelValue}>cenro@danao.gov.ph</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.channelItem}
                onPress={() => Linking.openURL('mailto:cicto@danao.gov.ph')}
              >
                <View style={styles.channelIcon}>
                  <MaterialIcons name="security" size={20} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.channelLabel}>CICTO Technical Support</Text>
                  <Text style={styles.channelValue}>cicto@danao.gov.ph</Text>
                </View>
              </TouchableOpacity>

              <View style={styles.channelItem}>
                <View style={styles.channelIcon}>
                  <MaterialIcons name="location-city" size={20} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.channelLabel}>Municipal Office Address</Text>
                  <Text style={styles.channelValue}>Danao City Hall Compound, Poblacion, Danao City, Cebu 6004</Text>
                </View>
              </View>
            </View>
          </View>

          {/* In-App Support Ticket Form */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Submit a Support Ticket</Text>
            <Text style={styles.sectionSub}>
              Have an issue with waste collection, your account, or Eco-Rewards? Send us a ticket and receive a tracking
              reference code immediately.
            </Text>

            {submittedRef ? (
              <View style={styles.successBox}>
                <MaterialIcons name="check-circle" size={36} color="#059669" />
                <Text style={styles.successTitle}>Support Ticket Received</Text>
                <Text style={styles.successDesc}>
                  Your ticket reference ID is <Text style={{ fontWeight: '800' }}>{submittedRef}</Text>. Our CENRO/CICTO
                  team will respond to <Text style={{ fontWeight: '700' }}>{email}</Text>.
                </Text>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setSubmittedRef(null)}>
                  <Text style={styles.secondaryBtnText}>Submit Another Inquiry</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.label}>Category</Text>
                <View style={styles.categoryRow}>
                  {[
                    { id: 'collection', label: 'Collection Issue' },
                    { id: 'account', label: 'Account / Login' },
                    { id: 'rewards', label: 'Eco-Rewards' },
                    { id: 'technical', label: 'Bug / Technical' },
                  ].map((item) => {
                    const active = category === item.id;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.categoryChip, active && styles.categoryChipActive]}
                        onPress={() => setCategory(item.id as any)}
                      >
                        <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.label}>Your Name</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Juan Dela Cruz"
                  placeholderTextColor="#9CA3AF"
                  maxLength={100}
                />

                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  maxLength={150}
                />

                <Text style={styles.label}>Subject</Text>
                <TextInput
                  style={styles.input}
                  value={subject}
                  onChangeText={setSubject}
                  placeholder="Brief summary of your concern"
                  placeholderTextColor="#9CA3AF"
                  maxLength={150}
                />

                <Text style={styles.label}>Message Details</Text>
                <TextInput
                  style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]}
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Provide details such as your barangay, street, or truck plate number if applicable..."
                  placeholderTextColor="#9CA3AF"
                  multiline
                  maxLength={2000}
                />

                <TouchableOpacity
                  style={[styles.submitBtn, submitting && { opacity: 0.7 }]}
                  onPress={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <MaterialIcons name="send" size={18} color="#FFFFFF" />
                      <Text style={styles.submitBtnText}>Submit Support Ticket</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
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
  headerEyebrow: { fontSize: 10, fontWeight: '800', color: '#A7F3D0', letterSpacing: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  content: { padding: 20, paddingBottom: 48, alignItems: 'center' },
  maxWrap: { width: '100%', maxWidth: 680, gap: 18 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 6 },
  sectionSub: { fontSize: 13.5, color: '#4B5563', lineHeight: 20, marginBottom: 16 },
  channelGrid: { gap: 10 },
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  channelIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelLabel: { fontSize: 11.5, fontWeight: '700', color: '#6B7280' },
  channelValue: { fontSize: 14, fontWeight: '700', color: '#111827', marginTop: 2 },
  label: { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 6 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
  },
  categoryChipActive: { backgroundColor: '#ECFDF5', borderColor: '#059669' },
  categoryChipText: { fontSize: 12.5, fontWeight: '600', color: '#4B5563' },
  categoryChipTextActive: { color: '#065F46', fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  submitBtn: {
    marginTop: 20,
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  successBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  successTitle: { fontSize: 17, fontWeight: '800', color: '#065F46' },
  successDesc: { fontSize: 13.5, color: '#047857', textAlign: 'center', lineHeight: 20 },
  secondaryBtn: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#059669',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  secondaryBtnText: { color: '#065F46', fontSize: 13, fontWeight: '700' },
});
