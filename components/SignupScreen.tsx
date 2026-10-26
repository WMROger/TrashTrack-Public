import { auth, db } from '@/config/firebase';
import { DANAO_CITY_BARANGAYS, mergeDanaoBarangays } from '@/constants/danaoBarangays';
import { signInWithFacebook, signInWithGoogle } from '@/config/socialAuth';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword, sendEmailVerification, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import DropDownPicker from 'react-native-dropdown-picker';
import ErrorModal from './ErrorModal';
import EmailVerificationModal from './EmailVerificationModal';
import TermsAndConsentModal, { LegalTabType } from './TermsAndConsentModal';
import { sendResidentWelcomeEmail } from '@/services/emailNotificationService';
import cloudinaryService from '@/services/cloudinaryService';
import { isImageFile } from '@/utils/cloudinaryHelpers';

export const VERIFICATION_DOCUMENT_TYPES = [
  'Barangay Certificate of Residency',
  'Barangay ID (Danao City)',
  'PhilSys National ID (Philippine ID)',
  'Voter\'s ID / COMELEC Certification',
  'Driver\'s License',
  'Utility Bill (Water / Electricity with Danao Address)',
  'Student / School ID (Danao City Campus)',
  'Postal ID / Senior Citizen / PWD ID',
  'Passport / UMID / SSS ID',
];

export default function SignupScreen() {
  const router = useRouter();
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleInitial, setMiddleInitial] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedBarangay, setSelectedBarangay] = useState('');
  const [barangayOpen, setBarangayOpen] = useState(false);
  const [availableBarangays, setAvailableBarangays] = useState<string[]>([...DANAO_CITY_BARANGAYS]);

  // Resident verification document & image upload state
  const [idType, setIdType] = useState(VERIFICATION_DOCUMENT_TYPES[0]);
  const [idTypeModalVisible, setIdTypeModalVisible] = useState(false);
  const [idNumber, setIdNumber] = useState('');
  const [verificationImageUri, setVerificationImageUri] = useState<string | null>(null);
  const [isUploadingVerification, setIsUploadingVerification] = useState(false);

  const getFormattedFullName = () => {
    const fn = firstName.trim();
    const mi = middleInitial.trim() ? `${middleInitial.trim().replace(/\.$/, '')}. ` : '';
    const ln = lastName.trim();
    return `${fn} ${mi}${ln}`.trim() || `${ln}, ${fn}`.trim();
  };
  
  React.useEffect(() => {
    const fetchBarangays = async () => {
      try {
        const { collection, getDocs } = require('firebase/firestore');
        const snap = await getDocs(collection(db, 'barangay_schedules'));
        const barangayNames = new Set<string>();
        snap.forEach((doc: any) => {
          const data = doc.data();
          if (data.barangayName) {
            barangayNames.add(data.barangayName);
          }
        });
        setAvailableBarangays(mergeDanaoBarangays(Array.from(barangayNames)));
      } catch (err) {
        console.error('Error fetching available barangays:', err);
      }
    };
    fetchBarangays();
  }, []);
  const [consent, setConsent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [errorModal, setErrorModal] = useState({
    visible: false,
    title: 'Error',
    message: '',
    type: 'error' as 'error' | 'warning' | 'info' | 'success',
  });
  const [legalModal, setLegalModal] = useState<{
    visible: boolean;
    tab: LegalTabType;
  }>({
    visible: false,
    tab: 'consent',
  });

  const [verificationModalVisible, setVerificationModalVisible] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [verificationPin, setVerificationPin] = useState('');
  const [registeredUid, setRegisteredUid] = useState('');

  const handleVerificationModalClose = async () => {
    setVerificationModalVisible(false);
    try {
      if (auth) await signOut(auth);
    } catch {}
    router.replace('/(auth)/login' as any);
  };

  const handleVerificationSuccess = () => {
    setVerificationModalVisible(false);
    router.replace('/(tabs)' as any);
  };

  const handleResendPin = async () => {
    if (!registeredEmail || !registeredUid) return;
    const newPin = Math.floor(100000 + Math.random() * 900000).toString();
    setVerificationPin(newPin);

    if (db) {
      try {
        const { updateDoc } = require('firebase/firestore');
        await updateDoc(doc(db, 'users', registeredUid), {
          verificationCode: newPin,
          verificationCodeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn('Failed to update verification code in Firestore:', err);
      }
    }

    const formattedName = getFormattedFullName();
    await sendResidentWelcomeEmail({
      toEmail: registeredEmail,
      residentName: formattedName,
      barangay: selectedBarangay,
      verificationCode: newPin,
      uid: registeredUid,
    });
  };

  const openLegalModal = (tab: LegalTabType) => {
    setLegalModal({ visible: true, tab });
  };

  const closeLegalModal = () => {
    setLegalModal(prev => ({ ...prev, visible: false }));
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

  // Password strength validation and character analysis
  const validatePasswordStrength = (password: string) => {
    const uppercaseCount = (password.match(/[A-Z]/g) || []).length;
    const lowercaseCount = (password.match(/[a-z]/g) || []).length;
    const lettersCount = uppercaseCount + lowercaseCount;
    const numbersCount = (password.match(/[0-9]/g) || []).length;
    const specialCharsCount = (password.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/g) || []).length;

    const requirements = {
      length: password.length >= 8,
      uppercase: uppercaseCount >= 1,
      lowercase: lowercaseCount >= 1,
      number: numbersCount >= 1,
      special: specialCharsCount >= 1,
    };
    
    const isValid = Object.values(requirements).every(req => req);
    const strength = Object.values(requirements).filter(req => req).length;
    
    return {
      requirements,
      isValid,
      strength,
      uppercaseCount,
      lowercaseCount,
      lettersCount,
      numbersCount,
      specialCharsCount,
      length: password.length,
    };
  };

  const getPasswordStrengthText = (strength: number) => {
    switch (strength) {
      case 0:
      case 1:
        return { text: 'WEAK', color: '#EF4444' };
      case 2:
        return { text: 'FAIR', color: '#F97316' };
      case 3:
        return { text: 'MEDIUM', color: '#EAB308' };
      case 4:
        return { text: 'GOOD', color: '#3B82F6' };
      case 5:
        return { text: 'STRONG', color: '#22C55E' };
      default:
        return { text: 'WEAK', color: '#EF4444' };
    }
  };

  const handlePickDocumentFromLibrary = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Photo library access is needed to select your proof of residency document.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const check = isImageFile(asset);
        if (!check.isValid) {
          Alert.alert('Invalid File', check.error || 'Only image files (JPG, PNG, WebP, etc.) are allowed.');
          return;
        }
        setVerificationImageUri(asset.uri);
      }
    } catch (err) {
      console.warn('Error selecting document image:', err);
    }
  };

  const handleCaptureDocumentPhoto = async () => {
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Camera permission is needed to take a photo of your document.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setVerificationImageUri(result.assets[0].uri);
      }
    } catch (err) {
      console.warn('Error launching camera:', err);
    }
  };

  const handleChooseVerificationDocument = () => {
    if (Platform.OS === 'web') {
      handlePickDocumentFromLibrary();
      return;
    }
    Alert.alert(
      'Attach Proof of Residency / ID',
      'Please attach a clear photo of your Danao City Barangay Certificate, Barangay ID, or Government ID to validate your registration.',
      [
        { text: 'Take Photo', onPress: handleCaptureDocumentPhoto },
        { text: 'Choose from Gallery', onPress: handlePickDocumentFromLibrary },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const upsertUserProfile = async (
    provider: string,
    displayNameParam?: string,
    verificationUrlParam?: string,
    verificationCodeParam?: string
  ) => {
    try {
      if (!auth || !db) return;
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      // Ensure fresh auth token is available to Firestore right after signup
      try {
        await currentUser.getIdToken(true);
      } catch {}
      const rawEmail = (currentUser.email || email || '').trim().toLowerCase();
      const userId = currentUser.uid; // Firestore rules expect userId to equal auth.uid
      const userRef = doc(db, 'users', userId);
      const snap = await getDoc(userRef);
      const computedName = getFormattedFullName();
      const finalDisplayName = displayNameParam || currentUser.displayName || computedName || '';
      const finalVerificationUrl = verificationUrlParam || '';

      const baseData: Record<string, any> = {
        uid: currentUser.uid,
        email: rawEmail || '',
        displayName: finalDisplayName,
        name: finalDisplayName,
        photoURL: currentUser.photoURL || '',
        verified: currentUser.emailVerified === true,
        role: 'user',
        provider,
        barangay: selectedBarangay,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        verificationImageUrl: finalVerificationUrl,
        verificationIdType: idType || 'Barangay Certificate of Residency',
        verificationIdNumber: idNumber.trim(),
        verificationStatus: finalVerificationUrl ? 'pending' : 'unsubmitted',
        verificationSubmittedAt: finalVerificationUrl ? serverTimestamp() : null,
        agreedToTermsAndPrivacyAt: serverTimestamp(),
        complianceVersion: 'RA10173-2026.1',
      };

      if (verificationCodeParam) {
        baseData.verificationCode = verificationCodeParam;
        baseData.verificationCodeExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      }

      const fullData: Record<string, any> = {
        ...baseData,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleInitial: middleInitial.trim().toUpperCase(),
      };

      const writeAttempt = async (data: any) => {
        if (!snap.exists()) {
          await setDoc(userRef, data);
        } else {
          await setDoc(userRef, data, { merge: true });
        }
      };

      try {
        await writeAttempt(fullData);
      } catch (err: any) {
        if (err?.code === 'permission-denied' || /permission/i.test(String(err?.message))) {
          try {
            // Retry with base schema in case cloud firestore rules restrict keys strictly
            await currentUser.getIdToken(true);
            await writeAttempt(baseData);
          } catch (retryErr) {
            console.warn('Base profile write failed after permission error:', retryErr);
          }
        } else {
          console.error('Failed to write user profile:', err);
        }
      }
    } catch (e) {
      console.error('Failed to upsert user profile:', e);
    }
  };

  const uploadResidentVerificationImage = async () => {
    if (!verificationImageUri) {
      throw new Error('Please attach a photo of your valid ID or Barangay Proof of Residency.');
    }

    setIsUploadingVerification(true);
    try {
      const uploadRes = await cloudinaryService.uploadImage(verificationImageUri, {
        folder: 'trashtruck/resident-verifications',
        preset: 'trashtrack_reports',
      });
      if (!uploadRes.success || !uploadRes.url) {
        throw new Error('We could not upload your verification image. Check your connection and try again. Your account was not created.');
      }
      return uploadRes.url;
    } catch (uploadErr: any) {
      console.warn('Verification image upload error:', uploadErr);
      throw new Error(uploadErr?.message || 'We could not upload your verification image. Please try again.');
    } finally {
      setIsUploadingVerification(false);
    }
  };

  const validateSocialSignup = () => {
    if (!selectedBarangay) {
      showError('Please select your Danao City barangay before creating your account.');
      return false;
    }
    if (!verificationImageUri) {
      showError('Please attach a photo of your valid ID or Barangay Proof of Residency to validate your registration.');
      return false;
    }
    if (!consent) {
      showError('Please review and agree to the Terms & Conditions and the Data Privacy Act of 2012 (RA 10173) to create your account.');
      return false;
    }
    return true;
  };

  const handleSignUp = async () => {
    // Clear previous errors
    setErrors({});

    // Validate Last Name
    if (!lastName.trim()) {
      showError('Please enter your last name');
      return;
    }

    // Validate First Name
    if (!firstName.trim()) {
      showError('Please enter your first name');
      return;
    }

    if (!selectedBarangay) {
      showError('Please select your Danao City barangay');
      return;
    }

    // Validate email
    if (!email) {
      showError('Please enter your email address');
      return;
    }
    if (!validateEmail(email)) {
      showError('Please enter a valid email address');
      return;
    }

    // Validate password
    if (!password) {
      showError('Please enter a password');
      return;
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      showError('Password must contain at least 8 characters, 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character');
      return;
    }

    // Validate Proof of Residency / Valid ID upload
    if (!verificationImageUri) {
      showError('Please attach a photo of your valid ID or Barangay Proof of Residency to validate your registration in Danao City.');
      return;
    }

    if (!consent) {
      showError('Please review and agree to the Terms & Conditions and the Data Privacy Act of 2012 (RA 10173) to create your account.');
      return;
    }

    setIsLoading(true);
    try {
      // Do not create the account until the document is safely available for review.
      const uploadedDocUrl = await uploadResidentVerificationImage();

      // 2. Use Firebase authentication
      if (auth) {
        const generatedPin = Math.floor(100000 + Math.random() * 900000).toString();
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        console.log('User created successfully:', user.email);
        
        // Update user profile with formatted full name
        const formattedName = getFormattedFullName();
        const { updateProfile } = require('firebase/auth');
        await updateProfile(user, { displayName: formattedName });

        await upsertUserProfile('password', formattedName, uploadedDocUrl, generatedPin);
        
        // Dispatch branded welcome & activation email via Google Apps Script Webhook
        try {
          await sendResidentWelcomeEmail({
            toEmail: email,
            residentName: formattedName,
            barangay: selectedBarangay,
            verificationCode: generatedPin,
            uid: user.uid,
          });
        } catch (mailErr) {
          console.warn('Could not dispatch resident welcome email via webhook:', mailErr);
        }

        // Open the custom Danao City PIN activation modal
        setRegisteredEmail(email);
        setVerificationPin(generatedPin);
        setRegisteredUid(user.uid);
        setVerificationModalVisible(true);
      } else {
        throw new Error('Firebase authentication is unavailable. Check the app configuration and connection.');
      }
    } catch (error: any) {
      console.log('Signup failed:', error.code);
      let errorMessage = 'Sign up failed. Please try again.';
      
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'An account with this email already exists.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password is too weak. Please choose a stronger password.';
      } else if (error.code === 'auth/network-request-failed') {
        errorMessage = 'Network error. Please check your internet connection.';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many attempts. Please try again later.';
      }
      
      showError(errorMessage === 'Sign up failed. Please try again.' ? (error?.message || errorMessage) : errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    if (!validateSocialSignup()) return;
    try {
      setIsLoading(true);
      const verificationUrl = await uploadResidentVerificationImage();
      const result = await signInWithGoogle();
      
      if (result.success) {
        const socialUser = auth?.currentUser;
        const profileBeforeSignup = socialUser && db ? await getDoc(doc(db, 'users', socialUser.uid)).catch(() => null) : null;
        await upsertUserProfile('google', undefined, verificationUrl);
        if (socialUser?.email && profileBeforeSignup && !profileBeforeSignup.exists()) {
          await sendResidentWelcomeEmail({
            toEmail: socialUser.email,
            residentName: socialUser.displayName || getFormattedFullName(),
            barangay: selectedBarangay,
          }).catch((mailErr) => console.warn('Could not dispatch resident welcome email:', mailErr));
        }
        console.log('Google signup successful');
        router.replace('/(tabs)' as any);
      } else {
        Alert.alert('Google Sign Up Error', result.error || 'Failed to sign up with Google. Please try again.');
      }
    } catch (error: any) {
      console.log('Google signup failed:', error.code);
      Alert.alert('Google Sign Up Error', error?.message || 'Failed to sign up with Google. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFacebookSignUp = async () => {
    if (!validateSocialSignup()) return;
    try {
      setIsLoading(true);
      const verificationUrl = await uploadResidentVerificationImage();
      const result = await signInWithFacebook();
      
      if (result.success) {
        const socialUser = auth?.currentUser;
        const profileBeforeSignup = socialUser && db ? await getDoc(doc(db, 'users', socialUser.uid)).catch(() => null) : null;
        await upsertUserProfile('facebook', undefined, verificationUrl);
        if (socialUser?.email && profileBeforeSignup && !profileBeforeSignup.exists()) {
          await sendResidentWelcomeEmail({
            toEmail: socialUser.email,
            residentName: socialUser.displayName || getFormattedFullName(),
            barangay: selectedBarangay,
          }).catch((mailErr) => console.warn('Could not dispatch resident welcome email:', mailErr));
        }
        console.log('Facebook signup successful');
        router.replace('/(tabs)' as any);
      } else {
        Alert.alert('Facebook Sign Up Error', result.error || 'Failed to sign up with Facebook. Please try again.');
      }
    } catch (error: any) {
      console.log('Facebook signup failed:', error.code);
      Alert.alert('Facebook Sign Up Error', error?.message || 'Failed to sign up with Facebook. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = () => {
    router.push('/(auth)/login');
  };

  const handleBack = () => {
    router.back();
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
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled={true}
          >
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                <Ionicons name="arrow-back-circle-outline" size={32} color="#6B705C" />
              </TouchableOpacity>
            </View>

            {/* Content Card Overlay */}
            <View style={styles.contentCard}>
              <Ionicons name="leaf" size={100} color="#F2F8F2" style={styles.leafWatermark} />
              
              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>
                Join our mission to keep the neighborhood clean and earn rewards for sustainable waste disposal.
              </Text>

              <View style={styles.formContainer}>
                {/* Last Name */}
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>
                    Last Name <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Dela Cruz"
                      placeholderTextColor="#999"
                      value={lastName}
                      onChangeText={setLastName}
                      autoCapitalize="words"
                    />
                  </View>
                </View>

                {/* First Name & Middle Initial */}
                <View style={styles.nameRow}>
                  <View style={[styles.inputContainer, { flex: 2.5, marginBottom: 0 }]}>
                    <Text style={styles.inputLabel}>
                      First Name <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="e.g. Juan"
                        placeholderTextColor="#999"
                        value={firstName}
                        onChangeText={setFirstName}
                        autoCapitalize="words"
                      />
                    </View>
                  </View>

                  <View style={[styles.inputContainer, { flex: 1, marginBottom: 0 }]}>
                    <Text style={styles.inputLabel}>M.I.</Text>
                    <View style={styles.inputWrapper}>
                      <TextInput
                        style={[styles.input, { textAlign: 'center' }]}
                        placeholder="A."
                        placeholderTextColor="#999"
                        value={middleInitial}
                        onChangeText={(val) => setMiddleInitial(val.toUpperCase().slice(0, 3))}
                        autoCapitalize="characters"
                        maxLength={3}
                      />
                    </View>
                  </View>
                </View>

                {/* Barangay */}
                <View style={[styles.inputContainer, { zIndex: 1000 }]}>
                  <Text style={styles.inputLabel}>
                    Barangay (Danao City) <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <View style={[styles.inputWrapper, { padding: 0, borderWidth: 0 }]}>
                    <DropDownPicker
                      open={barangayOpen}
                      value={selectedBarangay}
                      items={availableBarangays.map(b => ({ label: b, value: b }))}
                      setOpen={setBarangayOpen}
                      setValue={setSelectedBarangay}
                      placeholder="Select a barangay"
                      placeholderStyle={{ color: '#999' }}
                      maxHeight={200}
                      style={{
                        backgroundColor: '#F9FAFB',
                        borderWidth: 1,
                        borderColor: '#E5E7EB',
                        minHeight: 50,
                        borderRadius: 12,
                        paddingLeft: 44,
                      }}
                      dropDownContainerStyle={{
                        backgroundColor: '#F9FAFB',
                        borderColor: '#E5E7EB',
                        borderRadius: 12,
                        maxHeight: 200,
                      }}
                      textStyle={{
                        fontSize: 15,
                        color: '#333'
                      }}
                      zIndex={1000}
                      listMode={Platform.OS === 'web' ? 'FLATLIST' : 'SCROLLVIEW'}
                      scrollViewProps={{
                        nestedScrollEnabled: true,
                      }}
                    />
                    <View style={{ position: 'absolute', left: 16, top: 15, zIndex: 1001 }}>
                      <Ionicons name="location-outline" size={20} color="#999" />
                    </View>
                  </View>
                </View>

                {/* Email Address */}
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>
                    Email Address <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <View style={[styles.inputWrapper, email.length > 0 && !validateEmail(email) && styles.inputError]}>
                    <Ionicons name="mail-outline" size={20} color="#999" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="john@example.com"
                      placeholderTextColor="#999"
                      value={email}
                      onChangeText={(text) => {
                        setEmail(text);
                        if (text.length > 0 && !validateEmail(text)) {
                          setErrors(prev => ({ ...prev, email: 'Invalid email format' }));
                        } else {
                          clearError('email');
                        }
                      }}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                  {Boolean(errors.email) && (
                    <View style={styles.errorContainer}>
                      <Ionicons name="alert-circle" size={16} color="#EF4444" />
                      <Text style={styles.errorText}>{errors.email}</Text>
                    </View>
                  )}
                </View>

                {/* Secure Password */}
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>
                    Secure Password <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="lock-closed-outline" size={20} color="#999" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="••••••••"
                      placeholderTextColor="#999"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                    />
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                      <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color="#999" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Password Strength & Verification Helper */}
                {password.length > 0 && (() => {
                  const analysis = validatePasswordStrength(password);
                  const strengthInfo = getPasswordStrengthText(analysis.strength);
                  return (
                    <View style={styles.passwordVerificationWrapper}>
                      {/* Strength Bar */}
                      <View style={styles.passwordStrengthRow}>
                        <View style={styles.passwordStrengthBar}>
                          <View
                            style={[
                              styles.passwordStrengthFill,
                              {
                                width: `${(analysis.strength / 5) * 100}%`,
                                backgroundColor: strengthInfo.color,
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.passwordStrengthText, { color: strengthInfo.color }]}>
                          {strengthInfo.text}
                        </Text>
                      </View>

                      {/* Verification Card */}
                      <View style={styles.verificationCard}>
                        {/* Requirements List */}
                        <View style={styles.reqList}>
                          <View style={styles.reqItem}>
                            <Ionicons
                              name={analysis.requirements.length ? "checkmark-circle" : "ellipse-outline"}
                              size={15}
                              color={analysis.requirements.length ? "#22C55E" : "#9CA3AF"}
                            />
                            <Text style={[styles.reqItemText, analysis.requirements.length && styles.reqItemTextMet]}>
                              At least 8 characters
                            </Text>
                          </View>

                          <View style={styles.reqItem}>
                            <Ionicons
                              name={analysis.requirements.uppercase ? "checkmark-circle" : "ellipse-outline"}
                              size={15}
                              color={analysis.requirements.uppercase ? "#22C55E" : "#9CA3AF"}
                            />
                            <Text style={[styles.reqItemText, analysis.requirements.uppercase && styles.reqItemTextMet]}>
                              At least 1 uppercase letter (A-Z)
                            </Text>
                          </View>

                          <View style={styles.reqItem}>
                            <Ionicons
                              name={analysis.requirements.lowercase ? "checkmark-circle" : "ellipse-outline"}
                              size={15}
                              color={analysis.requirements.lowercase ? "#22C55E" : "#9CA3AF"}
                            />
                            <Text style={[styles.reqItemText, analysis.requirements.lowercase && styles.reqItemTextMet]}>
                              At least 1 lowercase letter (a-z)
                            </Text>
                          </View>

                          <View style={styles.reqItem}>
                            <Ionicons
                              name={analysis.requirements.number ? "checkmark-circle" : "ellipse-outline"}
                              size={15}
                              color={analysis.requirements.number ? "#22C55E" : "#9CA3AF"}
                            />
                            <Text style={[styles.reqItemText, analysis.requirements.number && styles.reqItemTextMet]}>
                              At least 1 number (0-9)
                            </Text>
                          </View>

                          <View style={styles.reqItem}>
                            <Ionicons
                              name={analysis.requirements.special ? "checkmark-circle" : "ellipse-outline"}
                              size={15}
                              color={analysis.requirements.special ? "#22C55E" : "#9CA3AF"}
                            />
                            <Text style={[styles.reqItemText, analysis.requirements.special && styles.reqItemTextMet]}>
                              At least 1 special character (!@#$%^&*...)
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })()}

                {/* Proof of Residency / Valid ID Validation Section */}
                <View style={styles.verificationDocCard}>
                  <View style={styles.verificationDocHeader}>
                    <Ionicons name="shield-checkmark" size={20} color="#1B4D3E" style={{ marginRight: 8 }} />
                    <Text style={styles.verificationDocTitle}>
                      Proof of Residency / Valid ID <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                  </View>
                  <Text style={styles.verificationDocSub}>
                    Required by Danao City Solid Waste Management to validate your resident registration and barangay address.
                  </Text>

                  {/* Document Type Selector */}
                  <View style={styles.docTypeGroup}>
                    <Text style={styles.docFieldLabel}>DOCUMENT TYPE</Text>
                    <TouchableOpacity
                      style={styles.docTypeSelector}
                      onPress={() => setIdTypeModalVisible(true)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="document-text-outline" size={18} color="#1B4D3E" style={{ marginRight: 8 }} />
                      <Text style={styles.docTypeSelectorText} numberOfLines={1}>
                        {idType}
                      </Text>
                      <Ionicons name="chevron-down" size={18} color="#6B7280" />
                    </TouchableOpacity>
                  </View>

                  {/* ID / Document Reference Number (Optional) */}
                  <View style={styles.docTypeGroup}>
                    <Text style={styles.docFieldLabel}>ID / REFERENCE NUMBER (OPTIONAL)</Text>
                    <View style={styles.docInputWrapper}>
                      <Ionicons name="card-outline" size={18} color="#9CA3AF" style={{ marginRight: 8 }} />
                      <TextInput
                        style={styles.docInput}
                        placeholder="e.g. 1234-5678-9012 or Brgy Cert No."
                        placeholderTextColor="#9CA3AF"
                        value={idNumber}
                        onChangeText={setIdNumber}
                        autoCapitalize="characters"
                      />
                    </View>
                  </View>

                  {/* Document Upload Area */}
                  <View style={styles.docUploadSection}>
                    <Text style={styles.docFieldLabel}>PHOTO OF DOCUMENT / ID <Text style={styles.requiredAsterisk}>*</Text></Text>
                    
                    {verificationImageUri ? (
                      <View style={styles.previewContainer}>
                        <Image source={{ uri: verificationImageUri }} style={styles.docPreviewImage} resizeMode="cover" />
                        <View style={styles.previewMeta}>
                          <View style={styles.previewBadge}>
                            <Ionicons name="checkmark-circle" size={13} color="#166534" style={{ marginRight: 4 }} />
                            <Text style={styles.previewBadgeText}>Document Attached</Text>
                          </View>
                          <Text style={styles.previewSubtext} numberOfLines={1}>
                            {idType}
                          </Text>
                          <View style={styles.previewActions}>
                            <TouchableOpacity
                              style={styles.previewChangeBtn}
                              onPress={handleChooseVerificationDocument}
                              activeOpacity={0.7}
                            >
                              <Ionicons name="camera-reverse-outline" size={13} color="#1B4D3E" style={{ marginRight: 4 }} />
                              <Text style={styles.previewChangeText} numberOfLines={1}>Change Photo</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.previewRemoveBtn}
                              onPress={() => setVerificationImageUri(null)}
                              activeOpacity={0.7}
                            >
                              <Ionicons name="trash-outline" size={13} color="#EF4444" style={{ marginRight: 4 }} />
                              <Text style={styles.previewRemoveText} numberOfLines={1}>Remove</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.uploadDottedBox}
                        onPress={handleChooseVerificationDocument}
                        activeOpacity={0.7}
                      >
                        <View style={styles.uploadIconCircle}>
                          <Ionicons name="cloud-upload-outline" size={24} color="#1B4D3E" />
                        </View>
                        <Text style={styles.uploadBoxTitle}>Upload Valid ID or Barangay Proof</Text>
                        <Text style={styles.uploadBoxSubtitle}>
                          Tap to select from gallery or take a clear photo
                        </Text>
                        <View style={styles.uploadBadgePill}>
                          <Text style={styles.uploadBadgeText}>JPG, PNG up to 10MB</Text>
                        </View>
                      </TouchableOpacity>
                    )}

                    {isUploadingVerification && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#F0FDF4', borderRadius: 8, borderWidth: 1, borderColor: '#BBF7D0' }}>
                        <ActivityIndicator size="small" color="#1B4D3E" />
                        <Text style={{ color: '#1B4D3E', fontSize: 12.5, fontWeight: '600' }}>Uploading verification document…</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Consent Checkbox */}
                <View style={styles.consentContainer}>
                  <TouchableOpacity
                    style={[styles.checkbox, consent && styles.checkboxChecked]}
                    onPress={() => {
                      if (!consent) {
                        openLegalModal('terms');
                      } else {
                        setConsent(false);
                      }
                    }}
                    activeOpacity={0.8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: consent }}
                  >
                    {consent && <Ionicons name="checkmark" size={14} color="white" />}
                  </TouchableOpacity>
                  <View style={styles.consentNotice}>
                    <View style={styles.consentNoticeHeading}>
                      <Ionicons name="shield-checkmark-outline" size={18} color="#1B4D3E" />
                      <Text style={styles.consentNoticeTitle}>Privacy and consent</Text>
                      <Text style={styles.requiredAsterisk}>*</Text>
                    </View>
                    <Text style={styles.consentText}>
                      Your name, contact details, barangay, and submitted verification image are used to manage your account and municipal waste services under the Data Privacy Act of 2012 (RA 10173).
                    </Text>
                    <Text style={styles.consentNoticeInstruction}>Review each notice before agreeing:</Text>
                    <View style={styles.legalLinksRow}>
                      <TouchableOpacity style={styles.legalLinkButton} onPress={() => openLegalModal('terms')}>
                        <Text style={styles.linkText}>Terms</Text>
                        <Ionicons name="open-outline" size={13} color="#176B52" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.legalLinkButton} onPress={() => openLegalModal('privacy')}>
                        <Text style={styles.linkText}>Privacy notice</Text>
                        <Ionicons name="open-outline" size={13} color="#176B52" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.legalLinkButton} onPress={() => openLegalModal('consent')}>
                        <Text style={styles.linkText}>Informed consent</Text>
                        <Ionicons name="open-outline" size={13} color="#176B52" />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.consentAgreementText}>I have read the notices above and agree to the Terms and Conditions and Informed Consent.</Text>
                  </View>
                </View>

                {/* Sign Up Button */}
                <TouchableOpacity 
                  style={[styles.primaryButton, isLoading && styles.disabledButton]}
                  onPress={handleSignUp}
                  disabled={isLoading}
                >
                  <Text style={styles.primaryButtonText}>
                    {isLoading ? 'Signing up...' : 'Create Account'}
                  </Text>
                </TouchableOpacity>

                {/* Separator */}
                <View style={styles.separatorContainer}>
                  <View style={styles.separatorLine} />
                  <Text style={styles.separatorText}>OR CONTINUE WITH</Text>
                  <View style={styles.separatorLine} />
                </View>

                {/* Social Buttons (Side by side) */}
                <View style={styles.socialButtonsRow}>
                  <TouchableOpacity style={styles.socialButtonHalf} onPress={handleGoogleSignUp} disabled={isLoading}>
                    <View style={styles.socialIconCircle}>
                      <Text style={{fontWeight: 'bold', color: '#DB4437'}}>G</Text>
                    </View>
                    <Text style={styles.socialButtonText}>Google</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.socialButtonHalf} onPress={handleFacebookSignUp} disabled={isLoading}>
                    <Ionicons name="logo-facebook" size={18} color="#1877F2" style={{marginRight: 6}} />
                    <Text style={styles.socialButtonText}>Facebook</Text>
                  </TouchableOpacity>
                </View>

                {/* Login Link */}
                <View style={styles.loginContainer}>
                  <Text style={styles.loginText}>Already have an account? </Text>
                  <TouchableOpacity onPress={handleLogin}>
                    <Text style={styles.loginLink}>Login</Text>
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

          {/* Email Verification Sent Modal */}
          <EmailVerificationModal
            visible={verificationModalVisible}
            email={registeredEmail}
            expectedCode={verificationPin}
            userId={registeredUid}
            onClose={handleVerificationModalClose}
            onVerified={handleVerificationSuccess}
            onResend={handleResendPin}
          />

          {/* Terms & Consent Modal */}
          <TermsAndConsentModal
            visible={legalModal.visible}
            initialTab={legalModal.tab}
            alreadyAccepted={consent}
            onClose={closeLegalModal}
            onAccept={() => {
              setConsent(true);
              closeLegalModal();
            }}
          />

          {/* Document Type Selection Modal */}
          <Modal visible={idTypeModalVisible} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <View style={styles.docTypeModalCard}>
                <View style={styles.docTypeModalHeader}>
                  <Text style={styles.docTypeModalTitle}>Select Document Type</Text>
                  <TouchableOpacity onPress={() => setIdTypeModalVisible(false)} style={{ padding: 4 }}>
                    <Ionicons name="close" size={22} color="#4B5563" />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 350 }}>
                  {VERIFICATION_DOCUMENT_TYPES.map(type => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.docTypeItem,
                        idType === type && styles.docTypeItemActive,
                      ]}
                      onPress={() => {
                        setIdType(type);
                        setIdTypeModalVisible(false);
                      }}
                    >
                      <Ionicons
                        name={idType === type ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={idType === type ? '#1B4D3E' : '#9CA3AF'}
                        style={{ marginRight: 10 }}
                      />
                      <Text
                        style={[
                          styles.docTypeItemText,
                          idType === type && styles.docTypeItemTextActive,
                        ]}
                      >
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          </Modal>
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
    paddingBottom: 10,
    zIndex: 1,
  },
  backButton: {
    padding: 4,
  },
  contentCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 20,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    position: 'relative',
    overflow: 'hidden',
  },
  leafWatermark: {
    position: 'absolute',
    top: -10,
    right: -10,
    transform: [{ rotate: '15deg' }],
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#4A6B48', // Darker green
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
    marginBottom: 24,
    paddingRight: 20,
  },
  formContainer: {
    // Form wrapper
  },
  inputContainer: {
    marginBottom: 16,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  requiredAsterisk: {
    color: '#EF4444',
    fontWeight: '700',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFAFA', // Very light grey/white background inside card
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#333',
  },
  eyeButton: {
    padding: 4,
  },
  inputError: {
    borderColor: '#EF4444',
  },
  passwordVerificationWrapper: {
    marginTop: 4,
    marginBottom: 8,
  },
  passwordStrengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  passwordStrengthBar: {
    flex: 1,
    height: 5,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  passwordStrengthFill: {
    height: '100%',
    borderRadius: 3,
  },
  passwordStrengthText: {
    fontSize: 11,
    fontWeight: '700',
    minWidth: 55,
    textAlign: 'right',
  },
  verificationCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 10,
  },
  charCountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  charBadge: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  charBadgeActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  charBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  charBadgeTextActive: {
    color: '#059669',
  },
  reqList: {
    gap: 5,
  },
  reqItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reqItemText: {
    fontSize: 12,
    color: '#6B7280',
  },
  reqItemTextMet: {
    color: '#1F2937',
    fontWeight: '600',
  },
  consentContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    marginBottom: 24,
  },
  consentNotice: {
    flex: 1,
    backgroundColor: '#F4F8F5',
    borderWidth: 1,
    borderColor: '#D5E5D9',
    borderRadius: 14,
    padding: 14,
  },
  consentNoticeHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 7,
  },
  consentNoticeTitle: {
    flex: 1,
    color: '#173F31',
    fontSize: 14.5,
    fontWeight: '700',
  },
  consentNoticeInstruction: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 11,
    marginBottom: 8,
  },
  legalLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  legalLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C9DDD0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  consentAgreementText: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 11,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderColor: '#CCC',
    borderRadius: 4,
    marginRight: 12,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#5C7C54',
    borderColor: '#5C7C54',
  },
  consentText: {
    flex: 1,
    fontSize: 13.5,
    color: '#334155',
    lineHeight: 21,
  },
  linkText: {
    color: '#176B52',
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  primaryButton: {
    backgroundColor: '#5C7C54',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
  separatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  separatorText: {
    marginHorizontal: 12,
    fontSize: 11,
    fontWeight: '600',
    color: '#A3A3A3',
    letterSpacing: 1,
  },
  socialButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 24,
  },
  socialButtonHalf: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  socialIconCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  socialButtonText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginText: {
    fontSize: 13,
    color: '#666',
  },
  loginLink: {
    fontSize: 13,
    color: '#4A76FF',
    fontWeight: '600',
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
  verificationDocCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 16,
    marginTop: 14,
    marginBottom: 8,
    overflow: 'hidden',
  },
  verificationDocHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  verificationDocTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  verificationDocSub: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 14,
  },
  docTypeGroup: {
    marginBottom: 12,
  },
  docFieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  docTypeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 46,
  },
  docTypeSelectorText: {
    flex: 1,
    fontSize: 13.5,
    color: '#1F2937',
    fontWeight: '600',
  },
  docInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 46,
  },
  docInput: {
    flex: 1,
    fontSize: 13.5,
    color: '#1F2937',
  },
  docUploadSection: {
    marginTop: 4,
  },
  uploadDottedBox: {
    borderWidth: 2,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  uploadBoxTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 2,
    textAlign: 'center',
  },
  uploadBoxSubtitle: {
    fontSize: 11.5,
    color: '#64748B',
    marginBottom: 8,
    textAlign: 'center',
  },
  uploadBadgePill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  uploadBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#475569',
  },
  previewContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  docPreviewImage: {
    width: 68,
    height: 68,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
    flexShrink: 0,
  },
  previewMeta: {
    flex: 1,
    marginLeft: 10,
    minWidth: 0,
    justifyContent: 'center',
  },
  previewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 3,
  },
  previewBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#166534',
  },
  previewSubtext: {
    fontSize: 11.5,
    color: '#334155',
    fontWeight: '600',
    marginBottom: 6,
  },
  previewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  previewChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  previewChangeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1B4D3E',
  },
  previewRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  previewRemoveText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#EF4444',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  docTypeModalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  docTypeModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    marginBottom: 8,
  },
  docTypeModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  docTypeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 2,
  },
  docTypeItemActive: {
    backgroundColor: '#F0FDF4',
  },
  docTypeItemText: {
    fontSize: 13.5,
    color: '#334155',
    fontWeight: '500',
    flex: 1,
  },
  docTypeItemTextActive: {
    color: '#1B4D3E',
    fontWeight: '700',
  },
});
