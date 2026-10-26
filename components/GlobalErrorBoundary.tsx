import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { reportSystemError } from '@/services/errorTrackingService';
import { sanitizeUserError } from '@/utils/errorSanitizer';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  referenceId: string;
  publicMessage: string;
}

/**
 * Branded 500 Application Error Page / Boundary (#8, #9, #11)
 * Catches rendering and lifecycle crashes, hides raw stack traces from users,
 * logs the incident to Firestore (`system_error_logs`), and provides one-tap recovery.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      referenceId: '',
      publicMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      publicMessage: sanitizeUserError(
        error,
        'TrashTrack encountered an unexpected issue while rendering this screen.'
      ),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    reportSystemError(error, {
      severity: 'fatal',
      context: errorInfo?.componentStack?.slice(0, 300) || 'GlobalErrorBoundary',
    }).then((refId) => {
      this.setState({ referenceId: refId });
    });
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, referenceId: '', publicMessage: '' });
  };

  handleReturnHome = (): void => {
    this.setState({ hasError: false, referenceId: '', publicMessage: '' });
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <MaterialIcons name="verified-user" size={15} color="#059669" />
            <Text style={styles.badgeText}>TRASHTRACK DANAO CITY • SYSTEM SAFEGUARD</Text>
          </View>

          <View style={styles.iconCircle}>
            <MaterialIcons name="error-outline" size={44} color="#DC2626" />
          </View>

          <Text style={styles.errorCode}>ERROR 500 • SERVICE INTERRUPTION</Text>
          <Text style={styles.title}>Something Went Wrong</Text>
          <Text style={styles.subtitle}>
            {this.state.publicMessage ||
              'We encountered an unexpected technical issue. No personal data was lost, and our CICTO technical team has been notified.'}
          </Text>

          {this.state.referenceId ? (
            <View style={styles.refBox}>
              <Text style={styles.refLabel}>INCIDENT REFERENCE ID</Text>
              <Text style={styles.refCode}>{this.state.referenceId}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.primaryBtn} onPress={this.handleRetry} activeOpacity={0.85}>
              <MaterialIcons name="refresh" size={18} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={this.handleReturnHome} activeOpacity={0.85}>
              <MaterialIcons name="home" size={18} color="#1B4D3E" />
              <Text style={styles.secondaryBtnText}>Return to Home</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footerNote}>
            Need immediate assistance? Contact Danao City CENRO / CICTO Support at cicto@danao.gov.ph
          </Text>
        </View>
      </View>
    );
  }
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
    maxWidth: 460,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 10,
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
    backgroundColor: '#FEF2F2',
    borderWidth: 2,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorCode: {
    fontSize: 11,
    fontWeight: '800',
    color: '#DC2626',
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
    marginBottom: 20,
  },
  refBox: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  refLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  refCode: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
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
  footerNote: {
    marginTop: 20,
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
  },
});
export default GlobalErrorBoundary;

