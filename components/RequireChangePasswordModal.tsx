import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, User } from 'firebase/auth';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { takePendingAuthRequest } from '@/services/pendingAuthService';
import TermsAndConsentModal, { LegalTabType } from './TermsAndConsentModal';

interface RequireChangePasswordModalProps {
  visible: boolean;
  user: User | null;
  onSuccess?: () => void;
  onSnooze?: () => void;
}

export default function RequireChangePasswordModal({
  visible,
  user,
  onSuccess,
  onSnooze,
}: RequireChangePasswordModalProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [currentPassword, setCurrentPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mandatory Terms & Conditions + Data Privacy Act of 2012 Compliance
  const [agreedToCompliance, setAgreedToCompliance] = useState(false);
  const [legalModalVisible, setLegalModalVisible] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<LegalTabType>('terms');

  // Reset state when modal becomes visible
  useEffect(() => {
    if (visible) {
      setCurrentPassword('');
      setShowCurrentPassword(false);
      setNewPassword('');
      setConfirmPassword('');
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setIsSubmitting(false);
      setIsSnoozing(false);
      setErrorMessage(null);
      setAgreedToCompliance(false);
      setLegalModalVisible(false);
    }
  }, [visible]);

  // Adjust Android system navigation bar button contrast when modal is visible
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    try {
      if (visible) {
        NavigationBar.setButtonStyleAsync('light').catch(() => {});
      } else {
        NavigationBar.setButtonStyleAsync('dark').catch(() => {});
      }
    } catch {}
  }, [visible]);

  // Password verification procedure & requirements analysis
  const requirements = useMemo(() => {
    const hasLength = newPassword.length >= 8;
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(newPassword);
    const matchesConfirm = confirmPassword.length > 0 && newPassword === confirmPassword;

    return {
      hasLength,
      hasUpper,
      hasLower,
      hasNumber,
      hasSpecial,
      matchesConfirm,
    };
  }, [newPassword, confirmPassword]);

  const strengthScore = useMemo(() => {
    let score = 0;
    if (requirements.hasLength) score++;
    if (requirements.hasUpper) score++;
    if (requirements.hasLower) score++;
    if (requirements.hasNumber) score++;
    if (requirements.hasSpecial) score++;
    return score;
  }, [requirements]);

  const strengthMeta = useMemo(() => {
    if (newPassword.length === 0) return { text: 'ENTER PASSWORD', color: '#94A3B8', bg: '#F1F5F9' };
    if (strengthScore <= 2) return { text: 'WEAK', color: '#EF4444', bg: '#FEE2E2' };
    if (strengthScore <= 3) return { text: 'FAIR', color: '#F97316', bg: '#FFEDD5' };
    if (strengthScore <= 4) return { text: 'GOOD', color: '#EAB308', bg: '#FEF9C3' };
    return { text: 'STRONG', color: '#059669', bg: '#D1FAE5' };
  }, [strengthScore, newPassword.length]);

  const isFormValid =
    requirements.hasLength &&
    requirements.hasUpper &&
    requirements.hasLower &&
    requirements.hasNumber &&
    requirements.hasSpecial &&
    requirements.matchesConfirm &&
    agreedToCompliance;

  const handleSubmit = async () => {
    setErrorMessage(null);

    if (!agreedToCompliance) {
      setErrorMessage('You must review and agree to the Terms & Conditions and Data Privacy Act of 2012 before saving your password.');
      return;
    }

    if (!isFormValid) {
      setErrorMessage('Please satisfy all password security requirements and confirm matching.');
      return;
    }

    const currentUser = user || auth?.currentUser;
    if (!currentUser || !db) {
      setErrorMessage('Authentication session is unavailable. Please try again.');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. If current password is provided, re-authenticate to refresh the auth timestamp
      if (currentPassword.trim() && currentUser.email) {
        try {
          const cred = EmailAuthProvider.credential(currentUser.email, currentPassword.trim());
          await reauthenticateWithCredential(currentUser, cred);
        } catch (reauthErr: any) {
          if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-mismatch'].includes(reauthErr?.code)) {
            setErrorMessage('The current / temporary password entered is incorrect.');
            setIsSubmitting(false);
            return;
          }
          throw reauthErr;
        }
      } else {
        // Attempt automatic reauth if a recent credential was stored in memory
        const pending = takePendingAuthRequest();
        if (pending?.kind === 'email' && pending.password && currentUser.email) {
          try {
            const cred = EmailAuthProvider.credential(currentUser.email, pending.password);
            await reauthenticateWithCredential(currentUser, cred);
          } catch {}
        }
      }

      // 2. Update Firebase Auth password
      await updatePassword(currentUser, newPassword);

      // 3. Mark mustChangePassword as false and record compliance acceptance in Firestore
      try {
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
          mustChangePassword: false,
          passwordChangeSnoozedUntil: null,
          agreedToTermsAndPrivacyAt: serverTimestamp(),
          complianceVersion: 'RA10173-2026.1',
          updatedAt: serverTimestamp(),
        });
      } catch (firestoreErr) {
        console.warn('Could not update Firestore mustChangePassword flag:', firestoreErr);
      }

      // 4. Clear local storage snooze
      try {
        await AsyncStorage.removeItem(`@trashtrack_pwd_snooze_${currentUser.uid}`);
      } catch {}

      Alert.alert(
        'Password Updated Successfully',
        'Your permanent password has been set. You can now use your new password for future sign-ins.',
        [{ text: 'Continue', onPress: () => onSuccess?.() }]
      );

      if (onSuccess) {
        onSuccess();
      }
    } catch (error: any) {
      console.error('Failed to update permanent password:', error);
      let msg = 'Failed to update password. Please check your connection and try again.';
      if (error?.code === 'auth/weak-password') {
        msg = 'The password chosen does not satisfy Firebase security strength requirements.';
      } else if (error?.code === 'auth/requires-recent-login') {
        msg = 'Please enter your current temporary password in the top field to confirm this change.';
      } else if (error?.code === 'auth/wrong-password' || error?.code === 'auth/invalid-credential') {
        msg = 'The current temporary password entered is incorrect.';
      }
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSnoozeLater = async () => {
    const currentUser = user || auth?.currentUser;
    const snoozeUntil = Date.now() + 24 * 60 * 60 * 1000; // 1 day = 24 hours

    setIsSnoozing(true);
    try {
      if (currentUser?.uid) {
        // 1. Persist snooze locally in AsyncStorage for immediate device checks
        try {
          await AsyncStorage.setItem(`@trashtrack_pwd_snooze_${currentUser.uid}`, String(snoozeUntil));
        } catch {}

        // 2. Persist snooze to Firestore
        if (db) {
          try {
            const userRef = doc(db, 'users', currentUser.uid);
            await updateDoc(userRef, {
              passwordChangeSnoozedUntil: snoozeUntil,
              updatedAt: serverTimestamp(),
            });
          } catch (e) {
            console.warn('Could not persist snooze timestamp to Firestore:', e);
          }
        }
      }

      if (onSnooze) {
        onSnooze();
      }
    } catch (err) {
      console.error('Error postponing password change:', err);
    } finally {
      setIsSnoozing(false);
    }
  };

  if (!visible) return null;

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent hardwareAccelerated>
        <StatusBar backgroundColor="rgba(15, 23, 42, 0.75)" barStyle="light-content" />
        <View style={styles.fullScreenOverlay}>
          <KeyboardAvoidingView
            style={styles.centeredContent}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
          >
          <View style={[styles.card, isMobile && { width: '92%' }]}>
            <ScrollView
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.scrollContent,
                isMobile && { paddingHorizontal: 18, paddingTop: 20 },
              ]}
              bounces={false}
            >
              {/* Header Badge & Title */}
              <View style={styles.headerIconContainer}>
                <View style={styles.iconCircle}>
                  <MaterialIcons name="lock-reset" size={32} color="#1B4D3E" />
                </View>
              </View>

              <Text style={styles.title}>Set Permanent Password</Text>
              <Text style={styles.subtitle}>
                Your account currently has a temporary password. Please create a permanent password to secure your account.
              </Text>

              {/* Error Banner */}
              {errorMessage ? (
                <View style={styles.errorBanner}>
                  <MaterialIcons name="error-outline" size={18} color="#DC2626" style={{ marginRight: 6 }} />
                  <Text style={styles.errorBannerText}>{errorMessage}</Text>
                </View>
              ) : null}

              {/* Form Fields */}
              <View style={styles.formContainer}>
                {/* Current / Temporary Password Field */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>
                    CURRENT / TEMPORARY PASSWORD
                  </Text>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      placeholder="Enter current / temporary password"
                      placeholderTextColor="#94A3B8"
                      value={currentPassword}
                      onChangeText={t => {
                        setCurrentPassword(t);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      secureTextEntry={!showCurrentPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={styles.eyeBtn}
                      onPress={() => setShowCurrentPassword(prev => !prev)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name={showCurrentPassword ? 'visibility-off' : 'visibility'}
                        size={20}
                        color="#64748B"
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* New Password Field */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>
                    NEW PASSWORD <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      placeholder="Enter new password"
                      placeholderTextColor="#94A3B8"
                      value={newPassword}
                      onChangeText={t => {
                        setNewPassword(t);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      secureTextEntry={!showNewPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={styles.eyeBtn}
                      onPress={() => setShowNewPassword(prev => !prev)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name={showNewPassword ? 'visibility-off' : 'visibility'}
                        size={20}
                        color="#64748B"
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Password Strength Indicator */}
                {newPassword.length > 0 ? (
                  <View style={styles.strengthRow}>
                    <View style={styles.strengthBarsContainer}>
                      {[1, 2, 3, 4, 5].map(step => (
                        <View
                          key={step}
                          style={[
                            styles.strengthBar,
                            {
                              backgroundColor:
                                step <= strengthScore ? strengthMeta.color : '#E2E8F0',
                            },
                          ]}
                        />
                      ))}
                    </View>
                    <View style={[styles.strengthBadge, { backgroundColor: strengthMeta.bg }]}>
                      <Text style={[styles.strengthBadgeText, { color: strengthMeta.color }]}>
                        {strengthMeta.text}
                      </Text>
                    </View>
                  </View>
                ) : null}

                {/* Confirm Password Field */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>
                    CONFIRM NEW PASSWORD <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      placeholder="Re-enter new password"
                      placeholderTextColor="#94A3B8"
                      value={confirmPassword}
                      onChangeText={t => {
                        setConfirmPassword(t);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      secureTextEntry={!showConfirmPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={styles.eyeBtn}
                      onPress={() => setShowConfirmPassword(prev => !prev)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name={showConfirmPassword ? 'visibility-off' : 'visibility'}
                        size={20}
                        color="#64748B"
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Verification Checklist */}
                <View style={styles.checklistCard}>
                  <Text style={styles.checklistTitle}>Security Verification Requirements:</Text>
                  <View style={styles.checkItem}>
                    <MaterialIcons
                      name={requirements.hasLength ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={requirements.hasLength ? '#059669' : '#94A3B8'}
                    />
                    <Text style={[styles.checkText, requirements.hasLength && styles.checkTextMet]}>
                      At least 8 characters long
                    </Text>
                  </View>

                  <View style={styles.checkItem}>
                    <MaterialIcons
                      name={requirements.hasUpper ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={requirements.hasUpper ? '#059669' : '#94A3B8'}
                    />
                    <Text style={[styles.checkText, requirements.hasUpper && styles.checkTextMet]}>
                      At least 1 uppercase letter (A-Z)
                    </Text>
                  </View>

                  <View style={styles.checkItem}>
                    <MaterialIcons
                      name={requirements.hasLower ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={requirements.hasLower ? '#059669' : '#94A3B8'}
                    />
                    <Text style={[styles.checkText, requirements.hasLower && styles.checkTextMet]}>
                      At least 1 lowercase letter (a-z)
                    </Text>
                  </View>

                  <View style={styles.checkItem}>
                    <MaterialIcons
                      name={requirements.hasNumber ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={requirements.hasNumber ? '#059669' : '#94A3B8'}
                    />
                    <Text style={[styles.checkText, requirements.hasNumber && styles.checkTextMet]}>
                      At least 1 number (0-9)
                    </Text>
                  </View>

                  <View style={styles.checkItem}>
                    <MaterialIcons
                      name={requirements.hasSpecial ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={requirements.hasSpecial ? '#059669' : '#94A3B8'}
                    />
                    <Text style={[styles.checkText, requirements.hasSpecial && styles.checkTextMet]}>
                      At least 1 special character (!@#$%^&*...)
                    </Text>
                  </View>

                  <View style={styles.checkItem}>
                    <MaterialIcons
                      name={requirements.matchesConfirm ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={requirements.matchesConfirm ? '#059669' : '#94A3B8'}
                    />
                    <Text style={[styles.checkText, requirements.matchesConfirm && styles.checkTextMet]}>
                      Passwords match exactly
                    </Text>
                  </View>
                </View>

                {/* Mandatory Terms & Conditions + Data Privacy Act (RA 10173) Agreement */}
                <View style={styles.complianceCard}>
                  <TouchableOpacity
                    style={styles.complianceCheckboxRow}
                    onPress={() => {
                      if (!agreedToCompliance) {
                        setLegalModalTab('terms');
                        setLegalModalVisible(true);
                      } else {
                        setAgreedToCompliance(false);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <View
                      style={[
                        styles.complianceCheckbox,
                        agreedToCompliance && styles.complianceCheckboxChecked,
                      ]}
                    >
                      {agreedToCompliance && (
                        <MaterialIcons name="check" size={16} color="#FFFFFF" />
                      )}
                    </View>
                    <View style={styles.complianceTextWrapper}>
                      <Text style={styles.complianceText}>
                        I have read, understood, and agree to the{' '}
                        <Text
                          style={styles.legalLink}
                          onPress={() => {
                            setLegalModalTab('terms');
                            setLegalModalVisible(true);
                          }}
                        >
                          Terms and Conditions
                        </Text>{' '}
                        and consent to data processing under the{' '}
                        <Text
                          style={styles.legalLink}
                          onPress={() => {
                            setLegalModalTab('privacy');
                            setLegalModalVisible(true);
                          }}
                        >
                          Republic Act No. 10173 (Data Privacy Act of 2012)
                        </Text>
                        . <Text style={styles.requiredAsterisk}>*</Text>
                      </Text>
                      <Text style={styles.complianceSubtext}>
                        Required for administrative officers and authorized personnel before finalizing account credentials.
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>

                {/* Submit Button */}
                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    (!isFormValid || isSubmitting) && styles.submitButtonDisabled,
                  ]}
                  onPress={handleSubmit}
                  disabled={!isFormValid || isSubmitting}
                  activeOpacity={0.8}
                >
                  {isSubmitting ? (
                    <View style={styles.buttonInner}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.submitButtonText}>Updating Password...</Text>
                    </View>
                  ) : (
                    <View style={styles.buttonInner}>
                      <MaterialIcons name="verified-user" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                      <Text style={styles.submitButtonText}>Save Permanent Password</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {/* "I'll do it later" / Snooze for 1 Day Button */}
                <TouchableOpacity
                  style={styles.laterButton}
                  onPress={handleSnoozeLater}
                  disabled={isSubmitting || isSnoozing}
                  activeOpacity={0.7}
                >
                  {isSnoozing ? (
                    <ActivityIndicator size="small" color="#64748B" />
                  ) : (
                    <>
                      <MaterialIcons name="schedule" size={16} color="#64748B" style={{ marginRight: 6 }} />
                      <Text style={styles.laterButtonText}>I&apos;ll do this later (Remind in 1 day)</Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Extra bottom spacing so content is reachable above the keyboard */}
                <View style={{ height: 40 }} />
              </View>
            </ScrollView>
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <TermsAndConsentModal
        visible={legalModalVisible}
        initialTab={legalModalTab}
        alreadyAccepted={agreedToCompliance}
        onClose={() => setLegalModalVisible(false)}
        onAccept={() => {
          setAgreedToCompliance(true);
          setLegalModalVisible(false);
        }}
        acceptButtonText="I Agree & Confirm"
      />
    </>
  );
}

const styles = StyleSheet.create({
  fullScreenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    zIndex: 9999,
    elevation: 50,
  },
  centeredContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 12,
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 26,
    paddingTop: 26,
    paddingBottom: 24,
  },
  headerIconContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#A7F3D0',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 18,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
    width: '100%',
  },
  errorBannerText: {
    fontSize: 12.5,
    color: '#DC2626',
    fontWeight: '600',
    flex: 1,
  },
  formContainer: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 12,
    width: '100%',
  },
  inputLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#475569',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  requiredAsterisk: {
    color: '#EF4444',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: '#0F172A',
    ...Platform.select({
      web: { outlineStyle: 'none' } as any,
    }),
  },
  eyeBtn: {
    padding: 6,
  },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: -4,
  },
  strengthBarsContainer: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    marginRight: 10,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  strengthBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  strengthBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  checklistCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 18,
    width: '100%',
  },
  checklistTitle: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  checkText: {
    fontSize: 12,
    color: '#94A3B8',
    marginLeft: 6,
    fontWeight: '500',
  },
  checkTextMet: {
    color: '#059669',
    fontWeight: '700',
  },
  submitButton: {
    backgroundColor: '#1B4D3E',
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    shadowColor: '#1B4D3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  submitButtonDisabled: {
    backgroundColor: '#CBD5E1',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  laterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '100%',
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  laterButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  complianceCard: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1.5,
    borderColor: '#A7F3D0',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    width: '100%',
  },
  complianceCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  complianceCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#94A3B8',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  complianceCheckboxChecked: {
    backgroundColor: '#1B4D3E',
    borderColor: '#1B4D3E',
  },
  complianceTextWrapper: {
    flex: 1,
  },
  complianceText: {
    fontSize: 12.5,
    color: '#1E293B',
    lineHeight: 18,
    fontWeight: '500',
  },
  complianceSubtext: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 5,
    lineHeight: 16,
  },
  legalLink: {
    color: '#1B4D3E',
    fontWeight: '700',
    textDecorationLine: 'underline',
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
});
