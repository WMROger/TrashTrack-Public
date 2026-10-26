import { auth, db } from '@/config/firebase';
import { setPendingEmailAuth, setPendingSocialAuth } from '@/services/pendingAuthService';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
// Note: Using basic state management for remember me functionality
import { storage } from '@/utils/storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { HARDCODED_CICTO_ACCOUNT, isCictoEmail, isCictoIdentifier } from '@/constants/cictoConfig';
import { setDriverSessionOrigin, clearDriverSessionOrigin } from '@/services/driverQrService';
import ErrorModal from './ErrorModal';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [errorModal, setErrorModal] = useState({
    visible: false,
    title: 'Error',
    message: '',
    type: 'error' as 'error' | 'warning' | 'info' | 'success',
  });


  // Driver QR Badge Scanner State
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [QrScannerComponent, setQrScannerComponent] = useState<React.ComponentType<any> | null>(null);
  const [isLoadingQrScanner, setIsLoadingQrScanner] = useState(false);

  const openDriverQrScanner = async () => {
    setIsLoadingQrScanner(true);
    try {
      const scannerModule = await import('@/components/driver/DriverQrScannerModal');
      setQrScannerComponent(() => scannerModule.default);
      setShowQrScanner(true);
    } catch (error) {
      console.error('Driver QR scanner could not load:', error);
      showError('Could not open camera scanner. Please ensure camera permissions are enabled.', 'Scanner Unavailable');
    } finally {
      setIsLoadingQrScanner(false);
    }
  };

  // Email validation
  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Clear specific error
  const clearError = (field: string) => {
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });
  };

  // Show error modal
  const showError = (message: string, title = 'Error', type: 'error' | 'warning' | 'info' | 'success' = 'error') => {
    setErrorModal({
      visible: true,
      title,
      message,
      type,
    });
  };

  // Close error modal
  const closeErrorModal = () => {
    setErrorModal(prev => ({ ...prev, visible: false }));
  };

  // Remember credentials (email & password) using secure storage
  const CREDENTIALS_KEY = 'rememberedLogin';

  // SEC-08 FIX: Never persist plaintext passwords in client storage.
  // Remember Me safely stores only the email/username identifier.
  const saveRememberedCredentials = async (savedEmail: string) => {
    try {
      await storage.setItem(
        CREDENTIALS_KEY,
        JSON.stringify({ email: savedEmail })
      );
    } catch (error) {
      console.error('Failed to remember credentials:', error);
    }
  };

  const loadRememberedCredentials = async () => {
    try {
      const remembered = await storage.getItem(CREDENTIALS_KEY);
      if (remembered) {
        const parsed = JSON.parse(remembered);
        if (parsed.email) {
          setEmail(parsed.email);
          setRememberMe(true);
        }
      }
    } catch (error) {
      console.error('Failed to load remembered credentials:', error);
    }
  };

  const clearRememberedCredentials = async () => {
    try {
      await storage.deleteItem(CREDENTIALS_KEY);
    } catch (error) {
      console.error('Failed to clear remembered credentials:', error);
    }
  };

  const upsertUserProfile = async (provider: string) => {
    try {
      if (!auth || !db) return;
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      // Ensure a fresh token for Firestore security rules
      try { await currentUser.getIdToken(true); } catch {}
      const rawEmail = (currentUser.email || email || '').trim().toLowerCase();
      const userRef = doc(db, 'users', currentUser.uid);
      const snap = await getDoc(userRef);
      const writeOnce = async () => {
        if (!snap.exists()) {
          await setDoc(userRef, {
            uid: currentUser.uid,
            email: rawEmail || '',
            displayName: currentUser.displayName || '',
            photoURL: currentUser.photoURL || '',
            verified: currentUser.emailVerified === true,
            role: 'user',
            provider,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          const existingData = snap.data();
          const emailCheck = (existingData?.email || rawEmail || '').toLowerCase();
          const isSeedResident = emailCheck.startsWith('luthar') && emailCheck.includes('trashtrack.com');
          const isSpecialVerified = existingData?.verified === true || existingData?.role === 'driver' || existingData?.role === 'admin' || existingData?.role === 'cenro' || existingData?.role === 'cicto' || existingData?.role === 'coordinator' || isSeedResident;
          await setDoc(
            userRef,
            {
              email: rawEmail || '',
              displayName: currentUser.displayName || '',
              photoURL: currentUser.photoURL || '',
              verified: isSpecialVerified ? true : currentUser.emailVerified === true,
              provider,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      };
      try {
        await writeOnce();
      } catch (err: any) {
        if (err?.code === 'permission-denied' || /Missing or insufficient permissions/.test(String(err?.message))) {
          try { await currentUser.getIdToken(true); } catch {}
          await new Promise(r => setTimeout(r, 300));
          await writeOnce();
        } else {
          throw err;
        }
      }
    } catch (e) {
      console.error('Failed to upsert user profile:', e);
    }
  };

  // Configure authentication on component mount
  useEffect(() => {
    loadRememberedCredentials();
  }, []);

  const handleLogin = async () => {
    // Clear previous errors
    setErrors({});

    // Support username / Employee ID without @ by looking up registered email in Firestore
    let loginEmail = (email || '').trim();
    const rawInputEmail = (email || '').trim();
    if (loginEmail && !loginEmail.includes('@')) {
      if (isCictoIdentifier(loginEmail)) {
        loginEmail = HARDCODED_CICTO_ACCOUNT.email;
      } else if (db) {
        try {
          const empQuery = query(
            collection(db, 'users'),
            where('employeeId', '==', loginEmail.toUpperCase()),
            limit(1)
          );
          const empSnap = await getDocs(empQuery);
          if (!empSnap.empty) {
            const foundEmail = empSnap.docs[0].data()?.email;
            if (foundEmail) loginEmail = foundEmail;
          }
        } catch (lookupErr) {
          console.warn('Driver employeeId lookup note:', lookupErr);
        }
      }
      if (!loginEmail.includes('@')) {
        loginEmail = `${loginEmail}@driver.com`;
      }
    }
    // Validate email if it includes '@'
    if (!loginEmail) {
      showError('Please enter your email or username');
      return;
    }
    if (loginEmail.includes('@') && !validateEmail(loginEmail)) {
      showError('Please enter a valid email address');
      return;
    }

    // Validate password (with fallback for hardcoded CICTO master account)
    let loginPassword = password;
    if (!loginPassword && isCictoEmail(loginEmail)) {
      loginPassword = HARDCODED_CICTO_ACCOUNT.password;
    }

    if (!loginPassword) {
      showError('Please enter your password');
      return;
    }

    // Save email/username securely if rememberMe is enabled (never store password)
    if (rememberMe) {
      await saveRememberedCredentials(rawInputEmail);
    } else {
      await clearRememberedCredentials();
    }

    setPendingEmailAuth(loginEmail, loginPassword);

    // Immediately redirect to loading page
    router.replace('/(auth)/loading' as any);
  };

  const handleGoogleLogin = async () => {
    setPendingSocialAuth('google');
    // Immediately redirect to loading page
    router.replace('/(auth)/loading' as any);
  };

  const handleFacebookLogin = async () => {
    setPendingSocialAuth('facebook');
    // Immediately redirect to loading page
    router.replace('/(auth)/loading' as any);
  };

  const handleForgotPassword = async () => {
    const resetEmail = email.trim().toLowerCase();
    if (!validateEmail(resetEmail)) {
      showError('Enter your registered email address first.', 'Password Reset', 'warning');
      return;
    }
    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      showError('Password reset instructions have been sent to your email.', 'Check Your Email', 'success');
    } catch (error: any) {
      const message = error?.code === 'auth/too-many-requests'
        ? 'Too many reset attempts. Please wait and try again.'
        : error?.code === 'auth/network-request-failed'
          ? 'Check your internet connection and try again.'
          : 'The reset email could not be sent. Verify the address and try again.';
      showError(message, 'Password Reset Failed', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = () => {
    router.push('/(auth)/signup');
  };

  const handleBack = () => {
    router.back();
  };

  const handleRememberMeToggle = async () => {
    const newRememberMe = !rememberMe;
    setRememberMe(newRememberMe);

    // If unchecking remember me, clear saved credentials
    if (!newRememberMe) {
      await clearRememberedCredentials();
    } else if (email) {
      await saveRememberedCredentials(email.trim());
    }
  };

  return (
    <LinearGradient
      colors={['#C1E1C1', '#F5F5F5']}
      style={styles.container}
    >
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 30 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                <Ionicons name="arrow-back-circle-outline" size={32} color="#6B705C" />
              </TouchableOpacity>
            </View>

            {/* Content */}
            <View style={styles.content}>
              {/* Top Section - Title and Inputs */}
              <View style={styles.topSection}>
                <Text style={styles.title}>
                  Login to <Text style={styles.titleHighlight}>TrashTrack</Text>
                </Text>
                <Text style={styles.subtitle}>Enter your email and password to login</Text>

                {/* Input Fields */}
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Email</Text>
                  <TextInput
                    style={[
                      styles.input,
                      email.length > 0 && email.includes('@') && !validateEmail(email) && styles.inputError
                    ]}
                    placeholder=""
                    placeholderTextColor="#999"
                    value={email}
                    onChangeText={(text) => {
                      setEmail(text);
                      clearError('email');
                    }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {errors.email ? (
                    <View style={styles.errorContainer}>
                      <Ionicons name="alert-circle" size={16} color="#EF4444" />
                      <Text style={styles.errorText}>{errors.email}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Password</Text>
                  <View style={[
                    styles.passwordInputContainer,
                    errors.password && styles.inputError
                  ]}>
                    <TextInput
                      style={styles.passwordInput}
                      placeholder=""
                      placeholderTextColor="#999"
                      value={password}
                      onChangeText={(text) => {
                        setPassword(text);
                        clearError('password');
                      }}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword(!showPassword)}
                    >
                      <Ionicons
                        name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                        size={20}
                        color="#666"
                      />
                    </TouchableOpacity>
                  </View>
                  {errors.password ? (
                    <View style={styles.errorContainer}>
                      <Ionicons name="alert-circle" size={16} color="#EF4444" />
                      <Text style={styles.errorText}>{errors.password}</Text>
                    </View>
                  ) : null}
                </View>

                {/* Remember Me and Forgot Password */}
                <View style={styles.rememberForgotContainer}>
                  <TouchableOpacity
                    style={styles.rememberMeContainer}
                    onPress={handleRememberMeToggle}
                  >
                    <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                      {rememberMe && <Ionicons name="checkmark" size={12} color="#FFF" />}
                    </View>
                    <Text style={styles.rememberMeText}>Remember me</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={handleForgotPassword}>
                    <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Bottom Section - Buttons */}
              <View style={styles.bottomSection}>
                {/* Login Button */}
                <TouchableOpacity
                  style={[styles.primaryButton, isLoading && styles.disabledButton]}
                  onPress={handleLogin}
                  disabled={isLoading}
                >
                  <Text style={styles.primaryButtonText}>
                    {isLoading ? 'Signing In...' : 'Login'}
                  </Text>
                </TouchableOpacity>

                {/* Separator */}
                <View style={styles.separatorContainer}>
                  <View style={styles.separatorLine} />
                  <Text style={styles.separatorText}>or</Text>
                  <View style={styles.separatorLine} />
                </View>

                {/* Social Login Buttons */}
                <View style={styles.socialButtons}>
                  <TouchableOpacity
                    style={styles.socialButton}
                    onPress={handleGoogleLogin}
                    disabled={isLoading}
                  >
                    <View style={styles.socialIconCircle}>
                      <Text style={{fontWeight: 'bold', color: '#DB4437'}}>G</Text>
                    </View>
                    <Text style={styles.socialButtonText}>Continue with Google</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.socialButton}
                    onPress={handleFacebookLogin}
                    disabled={isLoading}
                  >
                    <Ionicons name="logo-facebook" size={20} color="#1877F2" style={{marginRight: 8}} />
                    <Text style={styles.socialButtonText}>Continue with Facebook</Text>
                  </TouchableOpacity>
                </View>

                {/* Driver QR Login Option */}
                <TouchableOpacity
                  style={styles.driverQrButton}
                  onPress={openDriverQrScanner}
                  disabled={isLoading || isLoadingQrScanner}
                  activeOpacity={0.85}
                >
                  {isLoadingQrScanner ? (
                    <ActivityIndicator size="small" color="#1B5E20" style={{ marginRight: 8 }} />
                  ) : (
                    <MaterialIcons name="qr-code-scanner" size={20} color="#1B5E20" style={{ marginRight: 8 }} />
                  )}
                  <Text style={styles.driverQrButtonText}>Sign In via Driver QR Badge</Text>
                </TouchableOpacity>

                {/* Sign Up Link */}
                <View style={styles.signUpContainer}>
                  <Text style={styles.signUpText}>Don’t have an account? </Text>
                  <TouchableOpacity onPress={handleSignUp}>
                    <Text style={styles.signUpLink}>Signup</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Error Modal */}
          <ErrorModal
            visible={errorModal.visible}
            title={errorModal.title}
            message={errorModal.message}
            type={errorModal.type}
            onClose={closeErrorModal}
            autoClose={true}
            autoCloseDelay={4000}
          />

          {/* Driver QR Scanner Modal */}
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
                  try {
                    await auth.signOut();
                  } catch {}
                  await clearDriverSessionOrigin();
                  return;
                }
                await setDriverSessionOrigin('login');
                router.replace('/(driver)');
              }}
            />
          )}

        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 20,
  },
  backButton: {
    padding: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  topSection: {
    marginBottom: 30,
  },
  bottomSection: {
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  titleHighlight: {
    color: '#6A9955', // Lighter green for TrashTrack
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 40,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F3FAF3',
    borderWidth: 1,
    borderColor: '#D4E8D4',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#333',
  },
  passwordInputContainer: {
    backgroundColor: '#F3FAF3',
    borderWidth: 1,
    borderColor: '#D4E8D4',
    borderRadius: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 50,
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    paddingRight: 8,
    paddingVertical: 14,
  },
  rememberForgotContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
  },
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderColor: '#999',
    borderRadius: 4,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#6A9955',
    borderColor: '#6A9955',
  },
  rememberMeText: {
    fontSize: 13,
    color: '#555',
  },
  forgotPasswordText: {
    fontSize: 13,
    color: '#4A76FF',
  },
  primaryButton: {
    backgroundColor: '#5C7C54',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 30,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
  separatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#A3A3A3',
  },
  separatorText: {
    marginHorizontal: 12,
    fontSize: 13,
    color: '#666',
  },
  socialButtons: {
    flexDirection: 'column',
    gap: 12,
    marginBottom: 30,
  },
  socialButton: {
    width: '100%',
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  socialIconCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  socialButtonText: {
    fontSize: 15,
    color: '#555',
    fontWeight: '600',
  },
  signUpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signUpText: {
    fontSize: 14,
    color: '#666',
  },
  signUpLink: {
    fontSize: 14,
    color: '#4A76FF',
  },
  inputError: {
    borderColor: '#EF4444',
    borderWidth: 1,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    marginLeft: 6,
    fontWeight: '500',
  },
  driverQrButton: {
    width: '100%',
    backgroundColor: '#DCFCE7',
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
    marginTop: -10,
  },
  driverQrButtonText: {
    fontSize: 14,
    color: '#15803D',
    fontWeight: '700',
  },
});
