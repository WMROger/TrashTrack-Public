import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  limit,
  addDoc,
} from 'firebase/firestore';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

import { auth, db } from '@/config/firebase';
import { setPendingEmailAuth } from '@/services/pendingAuthService';
import { autoAssignQueuedReportsOnDriverShiftStart } from '@/services/autoDispatchService';
import { setDriverSessionOrigin, clearDriverSessionOrigin } from '@/services/driverQrService';

export default function DriverLoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [QrScannerComponent, setQrScannerComponent] = useState<React.ComponentType<any> | null>(null);
  const [isLoadingQrScanner, setIsLoadingQrScanner] = useState(false);

  const openQrScanner = async () => {
    setIsLoadingQrScanner(true);
    try {
      const scannerModule = await import('@/components/driver/DriverQrScannerModal');
      setQrScannerComponent(() => scannerModule.default);
      setShowQrScanner(true);
    } catch (error) {
      console.error('Driver QR scanner could not load:', error);
      Alert.alert(
        'QR scanner needs an app update',
        'This installed app does not include the camera module. Install the latest TrashTrack mobile build, then try scanning again.',
      );
    } finally {
      setIsLoadingQrScanner(false);
    }
  };

  const activateDriverOnDutyIfAssigned = async (driverUid: string, profile: any) => {
    if (!db || !driverUid) return;
    try {
      let assignedTruckId = profile?.currentTruckId;
      let assignedTruckPlate = profile?.currentTruckPlate || profile?.assignedTruck;
      let driverBarangay = profile?.assignedBarangay || profile?.barangay || 'Poblacion';

      if (!assignedTruckId) {
        const truckQ = query(collection(db, 'trucks'), where('assignedDriverId', '==', driverUid), limit(1));
        const truckSnap = await getDocs(truckQ);
        if (!truckSnap.empty) {
          const trDoc = truckSnap.docs[0];
          assignedTruckId = trDoc.id;
          const trData = trDoc.data();
          assignedTruckPlate = trData.plateNumber;
          if (!driverBarangay && (trData.assignedBarangay || trData.barangay)) {
            driverBarangay = trData.assignedBarangay || trData.barangay;
          }
        }
      }

      if (assignedTruckId) {
        await updateDoc(doc(db, 'users', driverUid), {
          currentTruckId: assignedTruckId,
          currentTruckPlate: assignedTruckPlate || null,
          dutyStatus: 'on_duty',
          status: 'on_duty',
          shiftStartedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const truckRef = doc(db, 'trucks', assignedTruckId);
        const truckDoc = await getDoc(truckRef);
        if (truckDoc.exists()) {
          const trData = truckDoc.data();
          const truckUpdates: Record<string, any> = {
            assignedDriverId: driverUid,
            assignedDriverName: profile?.displayName || profile?.name || 'Assigned Driver',
            lastUsedAt: serverTimestamp(),
            status: 'active',
            updatedAt: serverTimestamp(),
          };
          if (!trData.shiftStartedAt) {
            truckUpdates.shiftStartedAt = serverTimestamp();
          }
          await updateDoc(truckRef, truckUpdates);
        }

        try {
          await addDoc(collection(db, 'truck_usage_history'), {
            truckId: assignedTruckId,
            truckPlate: assignedTruckPlate || '',
            driverId: driverUid,
            driverName: profile?.displayName || profile?.name || 'Driver',
            action: 'shift_started_login',
            timestamp: serverTimestamp(),
            createdAt: serverTimestamp(),
            status: 'active',
          });
        } catch (histErr) {
          console.warn('Could not record shift start history on login:', histErr);
        }

        autoAssignQueuedReportsOnDriverShiftStart(driverUid, driverBarangay, assignedTruckId, assignedTruckPlate).catch((err) => {
          console.warn('Auto assign error on login:', err);
        });
      }
    } catch (err) {
      console.error('activateDriverOnDutyIfAssigned error:', err);
    }
  };

  const handleLogin = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      Alert.alert('Missing credentials', 'Enter the email and password issued by CENRO.');
      return;
    }

    setIsSigningIn(true);
    try {
      setPendingEmailAuth(normalizedEmail, password);
      const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
      const profileSnapshot = await getDoc(doc(db, 'users', credential.user.uid));
      const profile = profileSnapshot.exists() ? profileSnapshot.data() : null;

      if (!profile || profile.role !== 'driver' || profile.disabled === true || profile.status === 'disabled') {
        await signOut(auth);
        Alert.alert('Driver access denied', 'This account is not an active driver account. Contact CENRO for assistance.');
        return;
      }

      // Auto-heal verified status for drivers if needed
      if (profile.verified !== true && db) {
        try {
          await updateDoc(doc(db, 'users', credential.user.uid), {
            verified: true,
            updatedAt: serverTimestamp(),
          });
        } catch {}
      }

      if (profile && db) {
        try {
          await updateDoc(doc(db, 'users', credential.user.uid), {
            dutyStatus: 'off_duty',
            currentTruckId: null,
            currentTruckPlate: null,
            updatedAt: serverTimestamp(),
          });
        } catch {}
      }

      await clearDriverSessionOrigin();
      Alert.alert(
        'QR Badge Verification Required',
        'Access to the Driver Cockpit is strictly restricted to scanning your official CENRO Driver QR Badge. You have been authenticated off-duty.',
        [
          {
            text: 'Scan QR Badge',
            onPress: () => openQrScanner(),
          },
          {
            text: 'Go to Resident Portal',
            onPress: () => router.replace('/(tabs)/home'),
          },
        ]
      );
    } catch (error: any) {
      const invalidCredentials = error?.code === 'auth/invalid-credential' ||
        error?.code === 'auth/user-not-found' || error?.code === 'auth/wrong-password';
      Alert.alert(
        'Unable to sign in',
        invalidCredentials
          ? 'The email or password is incorrect.'
          : 'Driver sign-in could not be completed. Check your connection and try again.'
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleForgotPassword = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      Alert.alert('Password reset', 'Enter the driver email address first.');
      return;
    }
    setIsSigningIn(true);
    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      Alert.alert('Check your email', 'Password reset instructions were sent to the driver email.');
    } catch (error: any) {
      Alert.alert(
        'Password reset failed',
        error?.code === 'auth/too-many-requests'
          ? 'Too many attempts. Please wait and try again.'
          : 'The reset email could not be sent. Verify the address and connection.',
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView 
        style={{ flex: 1, backgroundColor: '#F3F4F6' }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 50}
      >
        <ScrollView 
          contentContainerStyle={styles.container} 
          bounces={false}
          keyboardShouldPersistTaps="handled"
        >
        <StatusBar barStyle="light-content" backgroundColor="#1A3B2B" />
        
        {/* Top Header Background */}
        <View style={styles.topBackground}>
          <View style={styles.headerTop}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <MaterialIcons name="arrow-back" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Driver Portal</Text>
            <View style={{width: 40}} />
          </View>
          
          {/* Hero Illustration */}
          <View style={styles.heroSection}>
            <View style={styles.imageContainer}>
              <Image 
                source={{ uri: 'https://cdn-icons-png.flaticon.com/512/3063/3063822.png' }} 
                style={styles.truckImage} 
                resizeMode="contain" 
              />
            </View>
          </View>
        </View>

        {/* Main Login Card */}
        <View style={styles.cardContainer}>
          <View style={styles.badge}>
            <MaterialIcons name="verified-user" size={16} color="#10B981" />
            <Text style={styles.badgeText}>SECURE ACCESS</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Welcome Back</Text>
              <Text style={styles.cardSubtitle}>Enter your official credentials to access your daily routes and deployments.</Text>
            </View>

            {/* Inputs */}
            <View style={styles.inputSection}>
              <View style={styles.inputWrapper}>
                <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
                <View style={styles.inputContainer}>
                  <MaterialIcons name="person-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="driver@cenro.gov.ph"
                    placeholderTextColor="#9CA3AF"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSigningIn}
                  />
                </View>
              </View>

              <View style={styles.inputWrapper}>
                <Text style={styles.inputLabel}>PASSWORD</Text>
                <View style={styles.inputContainer}>
                  <MaterialIcons name="lock-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your password"
                    placeholderTextColor="#9CA3AF"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSigningIn}
                  />
                </View>
              </View>
            </View>

            <TouchableOpacity onPress={handleForgotPassword} disabled={isSigningIn} style={{ alignSelf: 'flex-end', marginTop: 12 }}>
              <Text style={{ color: '#2F6B4D', fontSize: 12, fontWeight: '700' }}>Forgot password?</Text>
            </TouchableOpacity>

            {/* Login Button */}
            <TouchableOpacity 
              style={[styles.loginButton, isSigningIn && { opacity: 0.65 }]}
              onPress={handleLogin}
              disabled={isSigningIn}
              activeOpacity={0.85}
            >
              {isSigningIn ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.loginButtonText}>Sign In to Fleet</Text>
                  <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" style={styles.buttonIcon}/>
                </>
              )}
            </TouchableOpacity>

            {/* QR Code Login Option */}
            <View style={styles.qrDividerContainer}>
              <View style={styles.qrDividerLine} />
              <Text style={styles.qrDividerText}>OR SCAN BADGE</Text>
              <View style={styles.qrDividerLine} />
            </View>

            <TouchableOpacity
              style={styles.qrScanButton}
              onPress={openQrScanner}
              disabled={isSigningIn || isLoadingQrScanner}
              activeOpacity={0.85}
            >
              {isLoadingQrScanner
                ? <ActivityIndicator size="small" color="#1A3B2B" style={{ marginRight: 8 }} />
                : <MaterialIcons name="qr-code-scanner" size={22} color="#1A3B2B" style={{ marginRight: 8 }} />}
              <Text style={styles.qrScanButtonText}>{isLoadingQrScanner ? 'Opening scanner…' : 'Sign In via Driver QR Badge'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {QrScannerComponent && (
          <QrScannerComponent
            visible={showQrScanner}
            source="login"
            onClose={() => setShowQrScanner(false)}
            onDriverAuthenticated={async (driverProfile: any) => {
            setShowQrScanner(false);
            if (driverProfile?.shiftAction === 'time_out') {
              Alert.alert(
                'Shift Ended (Time-Out Recorded)',
                `Truck ${driverProfile.currentTruckPlate || 'vehicle'} has been released.\n\nTotal Shift Duration: ${driverProfile.durationFormatted || 'Recorded'}\nTime In: ${driverProfile.timeInFormatted || 'N/A'}\nTime Out: ${driverProfile.timeOutFormatted || 'N/A'}`,
                [{ text: 'OK' }]
              );
              return;
            }
            if (driverProfile?.email) {
              setEmail(driverProfile.email);
            }

            // If the driver verified via Fleet Inventory QR (time_in), their shift is already started
            if (driverProfile?.shiftAction === 'time_in') {
              await setDriverSessionOrigin('login');
              if (driverProfile?.uid) {
                await activateDriverOnDutyIfAssigned(driverProfile.uid, driverProfile);
              }
              router.replace('/(driver)');
              return;
            }

            Alert.alert(
              'Driver Verified',
              `Welcome, ${driverProfile.displayName || driverProfile.name || 'Driver'}! Credentials confirmed via CENRO QR badge.`,
              [
                {
                  text: 'Proceed to Cockpit',
                  onPress: async () => {
                    await setDriverSessionOrigin('login');
                    if (driverProfile?.uid) {
                      await activateDriverOnDutyIfAssigned(driverProfile.uid, driverProfile);
                    }
                    router.replace('/(driver)');
                  },
                },
              ]
            );
            }}
          />
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Danao City Environment and Natural Resources Office</Text>
          <Text style={styles.footerSubText}>© 2026 TrashTrack Waste Management System</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#F3F4F6', // modern light gray
    paddingBottom: 200, // ensures the scrollview has enough room to scroll up when keyboard opens
  },
  topBackground: {
    backgroundColor: '#1A3B2B', // Deep elegant green
    paddingTop: 50,
    paddingBottom: 60,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    alignItems: 'center',
    position: 'relative',
    zIndex: 1,
  },
  headerTop: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageContainer: {
    width: 140,
    height: 140,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  truckImage: {
    width: 90,
    height: 90,
    tintColor: '#E8F5E9', // Optional: tint the placeholder image lightly to match theme
  },
  cardContainer: {
    paddingHorizontal: 20,
    marginTop: -40,
    zIndex: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: -16, // overlaps card
    zIndex: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  badgeText: {
    color: '#1F2937',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginLeft: 6,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 28,
    paddingTop: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 5,
  },
  cardHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  cardTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  inputSection: {
    gap: 20,
    marginBottom: 32,
  },
  inputWrapper: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#F3F4F6',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 56,
    backgroundColor: '#F9FAFB',
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#1F2937',
    fontWeight: '500',
  },
  loginButton: {
    backgroundColor: '#10B981', // vibrant green
    borderRadius: 16,
    height: 56,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  buttonIcon: {
    marginLeft: 8,
  },
  qrDividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  qrDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  qrDividerText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    marginHorizontal: 12,
    letterSpacing: 0.8,
  },
  qrScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1.5,
    borderColor: '#10B981',
    borderRadius: 16,
    paddingVertical: 15,
  },
  qrScanButtonText: {
    color: '#1A3B2B',
    fontSize: 15,
    fontWeight: '700',
  },
  footer: {
    marginTop: 'auto',
    paddingVertical: 32,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '600',
    marginBottom: 4,
  },
  footerSubText: {
    fontSize: 11,
    color: '#D1D5DB',
    fontWeight: '500',
  },
});

