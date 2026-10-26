import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { auth } from '@/config/firebase';

export interface PortalLoadingScreenProps {
  portal?: 'cenro' | 'cicto' | 'default';
  title?: string;
  subtitle?: string;
  statusText?: string;
  isDone?: boolean;
  isError?: boolean;
  errorTitle?: string;
  errorMessage?: string;
  countdownSeconds?: number;
  onFinish?: () => void;
  onReload?: () => void;
  onCancel?: () => void;
}

const CENRO_MESSAGES = [
  'Verifying administrative clearance...',
  'Connecting to Danao City CENRO telemetry...',
  'Synchronizing fleet GPS and collection schedules...',
  'Loading operational command dashboard...',
];

const CICTO_MESSAGES = [
  'Verifying CICTO administrative clearance...',
  'Establishing secure channel with municipal IT registry...',
  'Checking system health telemetry & audit trails...',
  'Loading CICTO oversight console...',
];

const DEFAULT_MESSAGES = [
  'Initializing TrashTrack services...',
  'Authenticating session...',
  'Loading municipal data...',
  'Preparing application...',
];

export default function PortalLoadingScreen({
  portal = 'cenro',
  title,
  subtitle,
  statusText,
  isDone = false,
  isError = false,
  errorTitle,
  errorMessage,
  countdownSeconds = 4,
  onFinish,
  onReload,
  onCancel,
}: PortalLoadingScreenProps) {
  const router = useRouter();
  const isCenro = portal === 'cenro';
  const isCicto = portal === 'cicto';

  const defaultTitle = isCenro
    ? 'CENRO Portal'
    : isCicto
    ? 'CICTO Portal'
    : 'TrashTrack';

  const defaultSubtitle = isCenro
    ? 'City Environment & Natural Resources Office'
    : isCicto
    ? 'City Information & Communications Technology Office'
    : 'Intelligent Solid Waste & Fleet Logistics';

  const displayTitle = title || defaultTitle;
  const displaySubtitle = subtitle || defaultSubtitle;

  const messages = isCenro
    ? CENRO_MESSAGES
    : isCicto
    ? CICTO_MESSAGES
    : DEFAULT_MESSAGES;

  const [messageIndex, setMessageIndex] = useState(0);
  const [showSlowNotice, setShowSlowNotice] = useState(false);
  const [percent, setPercent] = useState(5);
  const hasFinishedRef = useRef(false);

  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0.05)).current;
  const fadeTextAnim = useRef(new Animated.Value(1)).current;
  const cardScaleAnim = useRef(new Animated.Value(0.94)).current;
  const cardOpacityAnim = useRef(new Animated.Value(0)).current;

  // Listen to animated progress and update percent state from 0 to 100
  useEffect(() => {
    const listenerId = progressAnim.addListener(({ value }) => {
      setPercent(Math.min(100, Math.max(0, Math.round(value * 100))));
    });
    return () => {
      progressAnim.removeListener(listenerId);
    };
  }, [progressAnim]);

  // Entrance and infinite background ambient animations
  useEffect(() => {
    // Card entrance
    Animated.parallel([
      Animated.timing(cardOpacityAnim, {
        toValue: 1,
        duration: 450,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(cardScaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 50,
        useNativeDriver: true,
      }),
    ]).start();

    // Infinite breathing pulse for the outer logo halo
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 1800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.1,
            duration: 1800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.45,
            duration: 1800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    pulseLoop.start();

    // Constant rotation for the orbital decoration
    const rotateLoop = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 10000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    rotateLoop.start();

    return () => {
      pulseLoop.stop();
      rotateLoop.stop();
    };
  }, []);

  // Progress Bar Controller: handles both autonomous progression and instant 100% completion if isDone
  useEffect(() => {
    if (isError) return;
    let cleanupTimer: any = null;

    const triggerFinish = () => {
      if (hasFinishedRef.current) return;
      hasFinishedRef.current = true;
      // Show the 100% completed screen for 1 second more as requested
      cleanupTimer = setTimeout(() => {
        Animated.timing(cardOpacityAnim, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }).start(() => {
          onFinish?.();
        });
      }, 1000);
    };

    if (isDone) {
      // Rapid, smooth acceleration straight to 100%
      Animated.timing(progressAnim, {
        toValue: 1.0,
        duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(() => {
        triggerFinish();
      });
      return () => {
        if (cleanupTimer) clearTimeout(cleanupTimer);
      };
    }

    // Default staged progression when waiting for asynchronous tasks:
    // 5% -> 38% -> 72% -> 92% -> 100%
    const animSequence = Animated.sequence([
      Animated.timing(progressAnim, {
        toValue: 0.38,
        duration: 450,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(progressAnim, {
        toValue: 0.72,
        duration: 900,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(progressAnim, {
        toValue: 0.92,
        duration: 1100,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(progressAnim, {
        toValue: 1.0,
        duration: 900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]);

    animSequence.start(({ finished }) => {
      if (finished) {
        triggerFinish();
      }
    });

    return () => {
      animSequence.stop();
      if (cleanupTimer) clearTimeout(cleanupTimer);
    };
  }, [isDone, onFinish, cardOpacityAnim, progressAnim]);

  // Cycling status messages
  useEffect(() => {
    if (statusText || percent === 100) return;

    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeTextAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(fadeTextAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();

      setMessageIndex((prev) => (prev + 1) % messages.length);
    }, 2200);

    return () => clearInterval(interval);
  }, [messages, statusText, percent]);

  // Display helpful recovery button if loading takes longer than 4.5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSlowNotice(true);
    }, 4500);
    return () => clearTimeout(timer);
  }, []);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  // Countdown timer for automatic return to login when in error state
  const [countdown, setCountdown] = useState(countdownSeconds);

  useEffect(() => {
    if (!isError) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleManualCancel();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isError]);

  // Palette settings
  const bgGradient = isError
    ? (['#1F0A0A', '#450A0A', '#1F0A0A'] as const)
    : isCenro
    ? (['#011E16', '#064E3B', '#02231A'] as const)
    : isCicto
    ? (['#021B24', '#0F766E', '#031720'] as const)
    : (['#011E16', '#064E3B', '#02231A'] as const);

  const accentColor = isError ? '#EF4444' : isCenro ? '#34D399' : isCicto ? '#2DD4BF' : '#10B981';
  const badgeBg = isError ? 'rgba(239, 68, 68, 0.22)' : isCenro ? 'rgba(16, 185, 129, 0.16)' : 'rgba(20, 184, 166, 0.16)';
  const badgeBorder = isError ? 'rgba(239, 68, 68, 0.55)' : isCenro ? 'rgba(52, 211, 153, 0.35)' : 'rgba(45, 212, 191, 0.35)';
  const badgeTextColor = isError ? '#FCA5A5' : isCenro ? '#6EE7B7' : '#5EEAD4';
  const agencyIconName = isError ? 'error-outline' : isCenro ? 'eco' : isCicto ? 'security' : 'recycling';

  const handleManualReload = () => {
    if (onReload) {
      onReload();
      return;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleManualCancel = async () => {
    if (onCancel) {
      onCancel();
      return;
    }
    try {
      if (auth?.currentUser) {
        await signOut(auth);
      }
    } catch {}
    if (isCicto) {
      router.replace('/cicto?error=auth_error' as any);
    } else {
      router.replace('/cenro?error=auth_error' as any);
    }
  };

  return (
    <View style={styles.container}>
      {/* Background Gradient */}
      <LinearGradient
        colors={bgGradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Ambient background glow orbs */}
      <View
        style={[
          styles.glowOrb,
          styles.glowOrbTop,
          { backgroundColor: accentColor, opacity: 0.1 },
        ]}
      />
      <View
        style={[
          styles.glowOrb,
          styles.glowOrbBottom,
          { backgroundColor: accentColor, opacity: 0.08 },
        ]}
      />

      {/* Main Glassmorphic Card Container */}
      <Animated.View
        style={[
          styles.card,
          {
            opacity: cardOpacityAnim,
            transform: [{ scale: cardScaleAnim }],
            borderColor: isError ? 'rgba(239, 68, 68, 0.55)' : isCenro ? 'rgba(52, 211, 153, 0.22)' : 'rgba(45, 212, 191, 0.22)',
            backgroundColor: isError ? 'rgba(69, 10, 10, 0.72)' : 'rgba(6, 78, 59, 0.45)',
          },
        ]}
      >
        {/* Top Official Agency Pill */}
        <View
          style={[
            styles.agencyPill,
            { backgroundColor: badgeBg, borderColor: badgeBorder },
          ]}
        >
          <MaterialIcons name={agencyIconName as any} size={15} color={badgeTextColor} />
          <Text style={[styles.agencyPillText, { color: badgeTextColor }]}>
            {isError ? 'SYSTEM CLEARANCE ALERT' : isCenro ? 'DANAO CITY LGU • CENRO' : isCicto ? 'DANAO CITY LGU • CICTO' : 'DANAO CITY LGU'}
          </Text>
        </View>

        {/* Hero Animated Emblem */}
        <View style={styles.emblemContainer}>
          {/* Outer Pulsing Ripple */}
          <Animated.View
            style={[
              styles.pulseRing,
              {
                borderColor: accentColor,
                opacity: pulseOpacity,
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />

          {/* Rotating Orbital Dashed Ring */}
          <Animated.View
            style={[
              styles.orbitalRing,
              {
                borderColor: accentColor,
                transform: [{ rotate: spin }],
              },
            ]}
          />

          {/* Center White Circle Badge */}
          <View style={[styles.whiteBadgeCircle, isError && { borderColor: '#EF4444', backgroundColor: '#FEF2F2' }]}>
            <Image
              source={require('@/assets/images/trashtrack_logo_driver.png')}
              style={[styles.logoImage, isError && { tintColor: '#DC2626' }]}
              resizeMode="contain"
            />
          </View>

          {/* Verified Official Seal or Error Checkmark */}
          <View style={[styles.verifiedBadge, { backgroundColor: isError ? '#DC2626' : isCenro ? '#059669' : '#0D9488' }]}>
            <MaterialIcons name={isError ? "error" : "verified"} size={13} color="#FFFFFF" />
          </View>
        </View>

        {/* Title & Subtitle */}
        <View style={styles.textBlock}>
          <Text style={[styles.titleText, isError && { color: '#FEE2E2' }]}>
            {isError ? (errorTitle || 'Portal Authorization Failed') : displayTitle}
          </Text>
          <Text style={[styles.subtitleText, isError && { color: '#FCA5A5' }]}>
            {isError ? (errorMessage || 'Something went wrong while verifying access clearance.') : displaySubtitle}
          </Text>
          <Text style={styles.jurisdictionText}>
            {isError
              ? 'Security Policy Enforcement • Danao City Operations'
              : isCenro
              ? 'Solid Waste & Municipal Fleet Logistics'
              : isCicto
              ? 'Information Systems & Tech Governance'
              : 'Danao City Official Environmental Services'}
          </Text>
        </View>

        {/* Glowing Progress Bar with Percentage */}
        <View style={styles.progressSection}>
          {/* Progress Header with Label and Percentage Counter */}
          <View style={styles.progressHeader}>
            <Text style={[styles.progressLabel, isError && { color: '#FCA5A5' }]}>
              {isError ? 'CLEARANCE STATUS' : percent === 100 ? 'INITIALIZATION COMPLETE' : 'SYSTEM INITIALIZATION'}
            </Text>
            <View style={[styles.percentBadge, isError && { backgroundColor: 'rgba(239, 68, 68, 0.25)' }]}>
              {isError ? (
                <MaterialIcons name="error" size={13} color="#EF4444" style={{ marginRight: 4 }} />
              ) : percent === 100 ? (
                <MaterialIcons name="check-circle" size={13} color="#34D399" style={{ marginRight: 4 }} />
              ) : null}
              <Text style={[styles.percentText, { color: isError ? '#EF4444' : percent === 100 ? '#34D399' : '#FFFFFF' }]}>
                {isError ? 'REJECTED' : `${percent}%`}
              </Text>
            </View>
          </View>

          {/* Progress Bar Track & Animated Fill */}
          <View style={[styles.progressBarTrack, isError && { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}>
            <Animated.View
              style={[
                styles.progressBarFill,
                {
                  width: isError ? '100%' : progressWidth,
                  backgroundColor: isError ? '#DC2626' : percent === 100 ? '#10B981' : accentColor,
                  shadowColor: isError ? '#DC2626' : percent === 100 ? '#10B981' : accentColor,
                },
              ]}
            />
          </View>

          {/* Real-time Status Message */}
          <View style={styles.statusRow}>
            {isError ? (
              <MaterialIcons name="cancel" size={16} color="#EF4444" style={styles.statusIcon} />
            ) : percent === 100 ? (
              <MaterialIcons name="done-all" size={16} color="#34D399" style={styles.statusIcon} />
            ) : (
              <ActivityIndicator size="small" color={accentColor} style={styles.spinner} />
            )}
            <Animated.Text
              style={[
                styles.statusText,
                isError && { color: '#FCA5A5', fontWeight: '700' },
                !isError && { opacity: fadeTextAnim },
                percent === 100 && !isError && styles.statusTextSuccess,
              ]}
              numberOfLines={2}
            >
              {isError
                ? (errorMessage || 'Clearance check failed. Returning to sign in...')
                : percent === 100
                ? '100% • System verified. Opening console...'
                : statusText || messages[messageIndex]}
            </Animated.Text>
          </View>
        </View>

        {/* If isError, show prominent Return to Login button */}
        {isError && (
          <TouchableOpacity
            style={styles.errorActionBtn}
            onPress={handleManualCancel}
            activeOpacity={0.85}
          >
            <MaterialIcons name="arrow-back" size={18} color="#FFFFFF" />
            <Text style={styles.errorActionBtnText}>
              Return to Login {countdown > 0 ? `(${countdown}s)` : ''}
            </Text>
          </TouchableOpacity>
        )}

        {/* Security / System Badges */}
        {!isError && (
          <View style={styles.tagsRow}>
            <View style={styles.tagItem}>
              <MaterialIcons name="lock" size={12} color="#94A3B8" />
              <Text style={styles.tagText}>SSL Encrypted</Text>
            </View>
            <View style={styles.tagDivider} />
            <View style={styles.tagItem}>
              <View style={[styles.activeDot, { backgroundColor: accentColor }]} />
              <Text style={styles.tagText}>Live Telemetry</Text>
            </View>
            <View style={styles.tagDivider} />
            <View style={styles.tagItem}>
              <MaterialIcons name="cloud-done" size={12} color="#94A3B8" />
              <Text style={styles.tagText}>Cloud Sync</Text>
            </View>
          </View>
        )}

        {/* Recovery options if load takes longer than usual */}
        {showSlowNotice && !isError && (
          <View style={styles.slowNoticeContainer}>
            <Text style={styles.slowNoticeText}>Taking longer than usual?</Text>
            <View style={styles.slowActionsRow}>
              <TouchableOpacity
                onPress={handleManualReload}
                style={[styles.slowBtn, styles.reloadBtn]}
                activeOpacity={0.8}
              >
                <MaterialIcons name="refresh" size={14} color="#34D399" />
                <Text style={styles.reloadBtnText}>Refresh</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleManualCancel}
                style={[styles.slowBtn, styles.cancelBtn]}
                activeOpacity={0.8}
              >
                <MaterialIcons name="login" size={14} color="#E2E8F0" />
                <Text style={styles.cancelBtnText}>Back to Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Animated.View>

      {/* Footer Branding */}
      <View style={styles.footerContainer}>
        <Text style={styles.footerBrand}>TrashTrack™ Municipal Operations System</Text>
        <Text style={styles.footerSub}>City of Danao, Cebu, Philippines</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#021E16',
    position: 'relative',
    overflow: 'hidden',
  },
  glowOrb: {
    position: 'absolute',
    borderRadius: 300,
    pointerEvents: 'none',
  },
  glowOrbTop: {
    width: 480,
    height: 480,
    top: -120,
    right: -100,
  },
  glowOrbBottom: {
    width: 400,
    height: 400,
    bottom: -100,
    left: -80,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: 'rgba(6, 78, 59, 0.45)',
    borderRadius: 28,
    borderWidth: 1.5,
    paddingVertical: 36,
    paddingHorizontal: 28,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
    elevation: 8,
    ...(Platform.OS === 'web'
      ? ({
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        } as any)
      : {}),
  },
  agencyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 22,
  },
  agencyPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  emblemContainer: {
    width: 128,
    height: 128,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    position: 'relative',
  },
  pulseRing: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 2,
  },
  orbitalRing: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    opacity: 0.65,
  },
  whiteBadgeCircle: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  logoImage: {
    width: 68,
    height: 68,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  textBlock: {
    alignItems: 'center',
    marginBottom: 24,
    paddingHorizontal: 10,
  },
  titleText: {
    fontSize: 27,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#A7F3D0',
    textAlign: 'center',
    marginBottom: 4,
  },
  jurisdictionText: {
    fontSize: 11.5,
    color: '#94A3B8',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  progressSection: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    marginBottom: 20,
  },
  progressHeader: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  progressLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.65)',
    letterSpacing: 0.8,
  },
  percentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  percentText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  progressBarTrack: {
    width: '100%',
    height: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 22,
  },
  spinner: {
    transform: [{ scale: 0.85 }],
  },
  statusIcon: {
    marginRight: 2,
  },
  statusText: {
    fontSize: 13,
    color: '#F1F5F9',
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  statusTextSuccess: {
    color: '#34D399',
    fontWeight: '700',
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    width: '100%',
  },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tagText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  tagDivider: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  slowNoticeContainer: {
    marginTop: 18,
    alignItems: 'center',
    width: '100%',
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  slowNoticeText: {
    fontSize: 12,
    color: '#CBD5E1',
    marginBottom: 10,
  },
  slowActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  slowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  reloadBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(52, 211, 153, 0.4)',
  },
  reloadBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34D399',
  },
  cancelBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  cancelBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  errorActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    borderWidth: 1.5,
    borderColor: '#EF4444',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 14,
    marginTop: 16,
    width: '100%',
    maxWidth: 320,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 6,
  },
  errorActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  footerContainer: {
    marginTop: 26,
    alignItems: 'center',
  },
  footerBrand: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.6)',
    letterSpacing: 0.4,
  },
  footerSub: {
    fontSize: 10.5,
    color: 'rgba(255, 255, 255, 0.35)',
    marginTop: 2,
  },
});
