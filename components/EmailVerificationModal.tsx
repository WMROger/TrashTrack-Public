import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Animated,
  Platform,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { db } from '@/config/firebase';
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';

interface EmailVerificationModalProps {
  visible: boolean;
  email: string;
  onClose: () => void;
  onResend?: () => Promise<void> | void;
  isResending?: boolean;
  expectedCode?: string;
  userId?: string;
  onVerified?: () => void;
  title?: string;
  description?: string;
}

export default function EmailVerificationModal({
  visible,
  email,
  onClose,
  onResend,
  isResending = false,
  expectedCode = '',
  userId = '',
  onVerified,
  title,
  description,
}: EmailVerificationModalProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const inputRef = useRef<TextInput>(null);

  // Animations on visible
  useEffect(() => {
    let focusTimer: any;
    if (visible) {
      setPin('');
      setPinError('');
      setIsSuccess(false);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 65,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();

      focusTimer = setTimeout(() => {
        inputRef.current?.focus();
      }, 400);
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
    return () => {
      if (focusTimer) clearTimeout(focusTimer);
    };
  }, [visible]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Real-time verification listener: If the account is already verified or gets verified, complete immediately
  useEffect(() => {
    if (!visible || !userId || !db) return;

    const unsub = onSnapshot(
      doc(db, 'users', userId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const isAlreadyVerified =
            data.verified === true ||
            data.verified === 'true' ||
            data.verificationStatus === 'verified' ||
            data.confirmedByCenro === true ||
            (data.verificationCode === null && data.verified !== false);

          if (isAlreadyVerified) {
            setIsSuccess(true);
            setTimeout(() => {
              if (onVerified) {
                onVerified();
              } else {
                onClose();
              }
            }, 600);
          }
        }
      },
      (err) => {
        console.warn('EmailVerificationModal listener error:', err);
      }
    );

    return () => unsub();
  }, [visible, userId, onVerified, onClose]);

  const handleVerify = async () => {
    const trimmedPin = pin.trim();
    if (trimmedPin.length < 6) {
      setPinError('Please enter all 6 digits of the activation PIN.');
      return;
    }

    setPinError('');
    setIsVerifying(true);

    try {
      let isCodeMatch = false;
      const targetCode = expectedCode ? expectedCode.trim() : '';

      if (targetCode && trimmedPin === targetCode) {
        isCodeMatch = true;
      } else if (userId && db) {
        try {
          const userSnap = await getDoc(doc(db, 'users', userId));
          if (userSnap.exists()) {
            const data = userSnap.data();
            const isAlreadyVerified =
              data.verified === true ||
              data.verified === 'true' ||
              data.verificationStatus === 'verified' ||
              data.confirmedByCenro === true ||
              (data.verificationCode === null && data.verified !== false);

            if (isAlreadyVerified) {
              isCodeMatch = true;
            } else {
              const storedCode = (data.verificationCode || '').toString().trim();
              if (storedCode && trimmedPin === storedCode) {
                isCodeMatch = true;
              }
            }
          }
        } catch (dbErr) {
          console.warn('Could not check verificationCode from Firestore:', dbErr);
        }
      }

      if (!isCodeMatch) {
        setPinError('Invalid activation PIN. Please verify the code sent to your email.');
        setIsVerifying(false);
        return;
      }

      // Update Firestore user document to verified: true
      if (userId && db) {
        await setDoc(
          doc(db, 'users', userId),
          {
            verified: true,
            verificationCode: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      setIsSuccess(true);
      setTimeout(() => {
        if (onVerified) {
          onVerified();
        } else {
          onClose();
        }
      }, 1200);
    } catch (err: any) {
      console.error('EmailVerificationModal verification error:', err);
      setPinError('Could not verify PIN. Please check your network and try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResendClick = async () => {
    if (resendCooldown > 0 || isResending) return;
    if (onResend) {
      setPinError('');
      await onResend();
      setResendCooldown(60);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardAvoiding}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={styles.modalWrapper}
          >
          <Animated.View
            style={[
              styles.card,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            {/* Top decorative header / Seal badge */}
            <View style={styles.badgeContainer}>
              <View style={[styles.iconCircleOuter, isSuccess && styles.iconCircleOuterSuccess]}>
                <View style={[styles.iconCircleInner, isSuccess && styles.iconCircleInnerSuccess]}>
                  <Ionicons
                    name={isSuccess ? 'checkmark' : 'mail-unread-outline'}
                    size={32}
                    color={isSuccess ? '#059669' : '#1B4D3E'}
                  />
                </View>
              </View>
            </View>

            {/* Header Text */}
            <Text style={styles.cityHeader}>REPUBLIC OF THE PHILIPPINES · DANAO CITY</Text>
            <Text style={styles.title}>
              {isSuccess ? 'Account Activated!' : title || 'Account Activation Required'}
            </Text>

            <Text style={styles.description}>
              {isSuccess
                ? 'Your email and resident account are officially verified. Accessing your dashboard...'
                : description || 'Account activation required. Please enter the official 6-digit activation PIN sent to your registered email address:'}
            </Text>

            {/* Email Pill Badge */}
            <View style={styles.emailPill}>
              <Ionicons name="mail" size={14} color="#047857" style={{ marginRight: 6 }} />
              <Text style={styles.emailText} numberOfLines={1}>
                {email || 'your email'}
              </Text>
            </View>

            {!isSuccess && (
              <>
                {/* 6-Digit PIN Boxes Display & Direct Tap Input */}
                <Pressable
                  style={styles.pinInputWrapper}
                  onPress={() => inputRef.current?.focus()}
                  accessible={true}
                  accessibilityLabel="6-digit activation PIN"
                >
                  <View style={styles.pinBoxesContainer} pointerEvents="none">
                    {[0, 1, 2, 3, 4, 5].map((index) => {
                      const digit = pin[index] || '';
                      const isCurrent = pin.length === index;
                      return (
                        <View
                          key={index}
                          style={[
                            styles.pinBox,
                            digit ? styles.pinBoxFilled : null,
                            isCurrent ? styles.pinBoxActive : null,
                          ]}
                        >
                          <Text style={styles.pinDigit}>{digit}</Text>
                        </View>
                      );
                    })}
                  </View>

                  {/* Full-coverage native TextInput to reliably open the soft keyboard on tap */}
                  <TextInput
                    ref={inputRef}
                    value={pin}
                    onChangeText={(val) => {
                      const sanitized = val.replace(/[^0-9]/g, '').slice(0, 6);
                      setPin(sanitized);
                      setPinError('');
                    }}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={6}
                    style={styles.hiddenInput}
                    autoFocus
                    caretHidden
                    contextMenuHidden
                    selectTextOnFocus={false}
                  />
                </Pressable>

                {/* Error message if any */}
                {pinError ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={15} color="#EF4444" style={{ marginRight: 6 }} />
                    <Text style={styles.errorText}>{pinError}</Text>
                  </View>
                ) : null}

                {/* Action Button */}
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    pin.length < 6 && styles.primaryButtonDisabled,
                  ]}
                  onPress={handleVerify}
                  disabled={isVerifying || pin.length < 6}
                  activeOpacity={0.85}
                >
                  {isVerifying ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <>
                      <Text style={styles.primaryButtonText}>Verify & Activate Account</Text>
                      <Ionicons name="arrow-forward" size={16} color="#FFFFFF" style={{ marginLeft: 6 }} />
                    </>
                  )}
                </TouchableOpacity>

                {/* Resend Link */}
                <TouchableOpacity
                  style={styles.resendButton}
                  onPress={handleResendClick}
                  disabled={resendCooldown > 0 || isResending}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="refresh-outline"
                    size={15}
                    color={resendCooldown > 0 ? '#94A3B8' : '#059669'}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      styles.resendButtonText,
                      resendCooldown > 0 && styles.resendButtonDisabledText,
                    ]}
                  >
                    {isResending
                      ? 'Dispatching PIN...'
                      : resendCooldown > 0
                      ? `Resend PIN (${resendCooldown}s)`
                      : 'Resend Activation PIN'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {/* Cancel / Login later */}
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={styles.secondaryButtonText}>
                {isSuccess ? 'Continue' : 'Proceed to Login'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalWrapper: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 22,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.2)',
      },
    }),
  },
  badgeContainer: {
    marginBottom: 14,
  },
  iconCircleOuter: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#ECFDF5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#A7F3D0',
  },
  iconCircleOuterSuccess: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  iconCircleInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircleInnerSuccess: {
    backgroundColor: '#BBF7D0',
  },
  cityHeader: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#059669',
    marginBottom: 4,
    textAlign: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  emailPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginBottom: 16,
    maxWidth: '95%',
  },
  emailText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#065F46',
  },
  keyboardAvoiding: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinInputWrapper: {
    width: '100%',
    position: 'relative',
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBoxesContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
  },
  pinBox: {
    width: 44,
    height: 52,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinBoxActive: {
    borderColor: '#059669',
    backgroundColor: '#ECFDF5',
  },
  pinBoxFilled: {
    borderColor: '#10B981',
    backgroundColor: '#FFFFFF',
  },
  pinDigit: {
    fontSize: 22,
    fontWeight: '800',
    color: '#065F46',
    fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
  },
  hiddenInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.01,
    color: 'transparent',
    fontSize: 1,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 12,
    width: '100%',
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '600',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#1B4D3E',
    borderRadius: 12,
    paddingVertical: 13,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#1B4D3E',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  primaryButtonDisabled: {
    backgroundColor: '#9CA3AF',
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  resendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  resendButtonText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#059669',
  },
  resendButtonDisabledText: {
    color: '#94A3B8',
  },
  secondaryButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
});
