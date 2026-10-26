import { MaterialIcons } from '@expo/vector-icons';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth, db } from '../../../config/firebase';
import { historicalWasteSeries } from '../../../data/historicalWasteData';
import {
  DEFAULT_FISCAL_YEAR_CONFIG,
  evaluateFiscalYearSufficiency,
  FiscalYearConfig,
} from '../../../services/budgetValidationService';
import { buildValidatedForecast } from '../../../services/wasteForecastService';
import { formatAdaptiveMassFromMetricTons } from '../../../utils/wasteUnits';

interface CenroProfileSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onLogout?: () => void;
  userRole?: string;
  assignedBarangay?: string;
}

const formatCurrency = (val: number | null | undefined) => {
  if (val === null || val === undefined || isNaN(val)) return '₱0.00';
  return `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function CenroProfileSettingsModal({
  visible,
  onClose,
  onLogout,
  userRole,
  assignedBarangay,
}: CenroProfileSettingsModalProps) {
  const user = auth?.currentUser;

  const [profileData, setProfileData] = useState<any>(null);

  useEffect(() => {
    if (!db || !user?.uid) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        setProfileData(snap.data());
      }
    });
    return () => unsub();
  }, [user?.uid]);

  const effectiveRole = (
    userRole ||
    profileData?.role ||
    ''
  ).toLowerCase().trim();

  const rawBarangay = (
    assignedBarangay ||
    profileData?.assignedBarangay ||
    profileData?.barangay ||
    ''
  ).trim();

  const isCityScope = !rawBarangay || /^(city|all|danao\s*city)$/i.test(rawBarangay);
  const effectiveBarangay = isCityScope ? '' : rawBarangay;

  const isCoordinator =
    effectiveRole === 'coordinator' ||
    effectiveRole === 'barangay_coordinator' ||
    effectiveRole === 'cenro_coordinator';

  // Navigation tab: profile & security vs fiscal year budget settings
  const [activeTab, setActiveTab] = useState<'profile' | 'fiscal'>('profile');

  useEffect(() => {
    if (isCoordinator && activeTab !== 'profile') {
      setActiveTab('profile');
    }
  }, [isCoordinator, activeTab]);

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Password visibility
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Status & Feedback
  const [isUpdating, setIsUpdating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fiscal Year Settings State
  const [fiscalConfig, setFiscalConfig] = useState<FiscalYearConfig>(DEFAULT_FISCAL_YEAR_CONFIG);
  const [fyYearInput, setFyYearInput] = useState(String(DEFAULT_FISCAL_YEAR_CONFIG.fiscalYear));
  const [fyBudgetInput, setFyBudgetInput] = useState(String(DEFAULT_FISCAL_YEAR_CONFIG.allocatedBudget));
  const [savingFiscal, setSavingFiscal] = useState(false);
  const [fiscalSuccess, setFiscalSuccess] = useState<string | null>(null);
  const [fiscalError, setFiscalError] = useState<string | null>(null);
  const [costPerTon, setCostPerTon] = useState<number>(2500);
  const [contingencyPercent, setContingencyPercent] = useState<number>(10);

  // Load Fiscal Year Config and Budget Planning Params from Firestore
  useEffect(() => {
    if (!db || isCoordinator) return;
    const unsub = onSnapshot(doc(db, 'settings', 'fiscal_year'), snapshot => {
      if (snapshot.exists()) {
        const d = snapshot.data();
        const conf: FiscalYearConfig = {
          fiscalYear: Number(d.fiscalYear) || DEFAULT_FISCAL_YEAR_CONFIG.fiscalYear,
          allocatedBudget: Number(d.allocatedBudget) || DEFAULT_FISCAL_YEAR_CONFIG.allocatedBudget,
          department: d.department || DEFAULT_FISCAL_YEAR_CONFIG.department,
          notes: d.notes || DEFAULT_FISCAL_YEAR_CONFIG.notes,
        };
        setFiscalConfig(conf);
        setFyYearInput(String(conf.fiscalYear));
        setFyBudgetInput(String(conf.allocatedBudget));
      }
    }, err => console.warn('Failed to listen to fiscal year settings:', err));

    getDoc(doc(db, 'analytics', 'budget_planning')).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        if (d?.costPerTon && Number(d.costPerTon) > 0) setCostPerTon(Number(d.costPerTon));
        if (d?.contingencyPercent !== undefined) setContingencyPercent(Number(d.contingencyPercent));
      }
    }).catch(err => console.warn('Failed to load budget planning params:', err));

    return () => unsub();
  }, []);

  // Compute 12-month annual projected tonnage from validated forecast
  const annualForecastTons = useMemo(() => {
    try {
      const historicalValues = historicalWasteSeries.map(p => p.value);
      const forecastResult = buildValidatedForecast(historicalValues, 12);
      return forecastResult.forecast.reduce((sum, v) => sum + v, 0);
    } catch {
      return 13200; // conservative baseline if forecast calculation fails
    }
  }, []);

  // Total Projected Cost (Annualized) = Forecast Tonnage × Cost/Ton + Contingency
  const projectedAnnualTotalCost = useMemo(() => {
    const baseCost = annualForecastTons * (costPerTon || 2500);
    const contingency = baseCost * (Math.max(0, contingencyPercent) / 100);
    return baseCost + contingency;
  }, [annualForecastTons, costPerTon, contingencyPercent]);

  // Evaluate Fiscal Year Sufficiency in real time based on active inputs
  const liveSufficiency = useMemo(() => {
    const yr = Number(fyYearInput) || fiscalConfig.fiscalYear;
    const bud = Number(fyBudgetInput) || 0;
    const conf: FiscalYearConfig = {
      fiscalYear: yr,
      allocatedBudget: bud,
      department: fiscalConfig.department,
    };
    return evaluateFiscalYearSufficiency(conf, projectedAnnualTotalCost, true);
  }, [fyYearInput, fyBudgetInput, fiscalConfig, projectedAnnualTotalCost]);

  const handleSaveFiscalYear = async () => {
    setFiscalSuccess(null);
    setFiscalError(null);
    const yr = Number(fyYearInput);
    const bud = Number(fyBudgetInput);

    if (!yr || yr < 2020 || yr > 2050) {
      setFiscalError('Please enter a valid 4-digit fiscal year (e.g., 2026).');
      return;
    }
    if (!bud || bud <= 0) {
      setFiscalError('Please enter a valid allocated annual budget amount greater than zero.');
      return;
    }

    setSavingFiscal(true);
    try {
      await setDoc(doc(db, 'settings', 'fiscal_year'), {
        fiscalYear: yr,
        allocatedBudget: bud,
        department: 'CENRO Danao Solid Waste Management',
        updatedAt: serverTimestamp(),
        updatedByUid: auth?.currentUser?.uid || null,
        notes: `Annual municipal waste budget for FY ${yr}`,
      }, { merge: true });

      const notice = liveSufficiency.isSufficient
        ? `Fiscal Year ${yr} budget saved successfully! Budget is fully sufficient with a ${formatCurrency(liveSufficiency.budgetBuffer)} buffer.`
        : `Fiscal Year ${yr} budget saved with deficit warning! Shortfall: ${formatCurrency(Math.abs(liveSufficiency.budgetBuffer || 0))}.`;

      setFiscalSuccess(notice);
      Alert.alert(
        liveSufficiency.isSufficient ? 'Fiscal Budget Saved' : 'Saved with Deficit Warning',
        notice
      );
    } catch (err: any) {
      console.error('Error saving fiscal year settings:', err);
      setFiscalError(err?.message || 'Failed to save fiscal year budget settings.');
    } finally {
      setSavingFiscal(false);
    }
  };

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Password strength check
  const hasMinLength = newPassword.length >= 8;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword);
  const isPasswordValid = hasMinLength && hasUpper && hasLower && hasNumber && hasSpecial;

  const handleUpdatePassword = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!user || !user.email) {
      setErrorMessage('No authenticated administrator session found.');
      return;
    }

    if (!currentPassword) {
      setErrorMessage('Please enter your current password.');
      return;
    }

    if (!newPassword) {
      setErrorMessage('Please enter a new password.');
      return;
    }

    if (!isPasswordValid) {
      setErrorMessage('New password must meet all 5 security requirements below.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('New password and confirmation password do not match.');
      return;
    }

    if (newPassword === currentPassword) {
      setErrorMessage('New password must be different from your current password.');
      return;
    }

    setIsUpdating(true);
    try {
      // 1. Re-authenticate admin with current password
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);

      // 2. Update to new password
      await updatePassword(user, newPassword);

      setSuccessMessage('Password updated successfully! Your CENRO account is now secured.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('CENRO password update error:', error);
      if (error?.code === 'auth/wrong-password' || error?.code === 'auth/invalid-credential') {
        setErrorMessage('Incorrect current password. Please recheck your temporary credentials.');
      } else if (error?.code === 'auth/requires-recent-login') {
        setErrorMessage('Session expired. Please log out and sign in again to change password.');
      } else if (error?.code === 'auth/weak-password') {
        setErrorMessage('Password is too weak. Please use a stronger combination.');
      } else {
        setErrorMessage(error?.message || 'Failed to update password. Please try again.');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerIconCircle}>
              <MaterialIcons
                name={isCoordinator ? 'person' : (activeTab === 'profile' ? 'security' : 'account-balance')}
                size={24}
                color="#1B4D3E"
              />
            </View>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>
                {isCoordinator
                  ? 'Coordinator Profile & Security'
                  : (activeTab === 'profile' ? 'Profile & Security Settings' : 'Fiscal Year & Budget Settings')}
              </Text>
              <Text style={styles.headerSubtitle}>
                {isCoordinator
                  ? (effectiveBarangay ? `Brgy. ${effectiveBarangay} Coordinator` : 'Barangay Field Coordinator')
                  : (activeTab === 'profile' ? 'CENRO Administrator Governance' : 'Municipal Waste Budget & Cost Sufficiency')}
              </Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7}>
              <MaterialIcons name="close" size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Sub-Navigation Tabs (Hidden for Coordinators) */}
          {!isCoordinator && (
            <View style={styles.tabsRow}>
              <TouchableOpacity
                style={[styles.tabButton, activeTab === 'profile' && styles.tabButtonActive]}
                onPress={() => setActiveTab('profile')}
                activeOpacity={0.75}
              >
                <MaterialIcons
                  name="admin-panel-settings"
                  size={16}
                  color={activeTab === 'profile' ? '#1B4D3E' : '#64748B'}
                />
                <Text style={[styles.tabButtonText, activeTab === 'profile' && styles.tabButtonTextActive]}>
                  Profile & Security
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabButton, activeTab === 'fiscal' && styles.tabButtonActive]}
                onPress={() => setActiveTab('fiscal')}
                activeOpacity={0.75}
              >
                <MaterialIcons
                  name="account-balance"
                  size={16}
                  color={activeTab === 'fiscal' ? '#1B4D3E' : '#64748B'}
                />
                <Text style={[styles.tabButtonText, activeTab === 'fiscal' && styles.tabButtonTextActive]}>
                  Fiscal Year & Budget
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <ScrollView style={styles.scrollBody} showsVerticalScrollIndicator={false}>
            {activeTab === 'profile' ? (
              <>
                {/* Admin / Coordinator Profile Overview Card */}
                <View style={styles.profileCard}>
                  <View style={styles.profileHeaderRow}>
                    <View style={styles.avatarCircle}>
                      <MaterialIcons
                        name={isCoordinator ? 'person' : 'admin-panel-settings'}
                        size={32}
                        color="#1B4D3E"
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <Text style={styles.adminName}>
                        {profileData?.name || profileData?.displayName || user?.displayName || (isCoordinator ? 'Barangay Coordinator' : 'CENRO Administrator')}
                      </Text>
                      <Text style={styles.adminEmail}>{user?.email || profileData?.email || 'coordinator@trashtrack.gov.ph'}</Text>
                      <View style={styles.badgeRow}>
                        <View style={styles.cictoBadge}>
                          <Text style={styles.cictoBadgeText}>✓ CICTO VERIFIED</Text>
                        </View>
                        <View style={[styles.roleBadge, isCoordinator && { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                          <Text style={[styles.roleBadgeText, isCoordinator && { color: '#047857' }]}>
                            {isCoordinator
                              ? (effectiveBarangay ? `BRGY. ${effectiveBarangay.toUpperCase()} COORDINATOR` : 'BARANGAY COORDINATOR')
                              : 'CENRO OFFICER'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View style={styles.infoDivider} />

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Department:</Text>
                    <Text style={styles.infoValue}>
                      {isCoordinator
                        ? (effectiveBarangay ? `Barangay ${effectiveBarangay} Environmental Stewardship` : 'Barangay Field Stewardship')
                        : 'City Environment & Natural Resources Office'}
                    </Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Jurisdiction:</Text>
                    <Text style={styles.infoValue}>
                      {isCoordinator
                        ? (effectiveBarangay ? `Brgy. ${effectiveBarangay}, Danao City, Cebu` : 'Danao City, Cebu')
                        : 'Danao City, Cebu • Region VII'}
                    </Text>
                  </View>
                </View>

            {/* Password Management Card */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionTitleRow}>
                <MaterialIcons name="lock" size={20} color="#1B4D3E" />
                <Text style={styles.sectionTitle}>
                  {isCoordinator ? 'Change Coordinator Password' : 'Change Administrator Password'}
                </Text>
              </View>
              <Text style={styles.sectionDesc}>
                {isCoordinator
                  ? 'Update the temporary credentials issued during onboarding to a secure, personal password.'
                  : 'Update the temporary password issued during onboarding to an executive, high-security password.'}
              </Text>

              {/* Success Banner */}
              {successMessage && (
                <View style={styles.successBanner}>
                  <MaterialIcons name="check-circle" size={20} color="#059669" />
                  <Text style={styles.successText}>{successMessage}</Text>
                </View>
              )}

              {/* Error Banner */}
              {errorMessage && (
                <View style={styles.errorBanner}>
                  <MaterialIcons name="error" size={20} color="#DC2626" />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              )}

              {/* Current Password */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  Current / Temporary Password <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <View style={styles.inputWrapper}>
                  <MaterialIcons name="vpn-key" size={18} color="#9CA3AF" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Enter current password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!showCurrentPassword}
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                    style={styles.eyeBtn}
                  >
                    <MaterialIcons
                      name={showCurrentPassword ? 'visibility-off' : 'visibility'}
                      size={20}
                      color="#6B7280"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* New Password */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  New Password <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <View style={styles.inputWrapper}>
                  <MaterialIcons name="lock-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Enter new strong password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!showNewPassword}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    onPress={() => setShowNewPassword(!showNewPassword)}
                    style={styles.eyeBtn}
                  >
                    <MaterialIcons
                      name={showNewPassword ? 'visibility-off' : 'visibility'}
                      size={20}
                      color="#6B7280"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Requirements checklist */}
              {newPassword.length > 0 && (
                <View style={styles.checklistCard}>
                  <Text style={styles.checklistTitle}>PASSWORD REQUIREMENTS:</Text>
                  <View style={styles.checkItem}>
                    <MaterialIcons
                      name={hasMinLength ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={hasMinLength ? '#059669' : '#9CA3AF'}
                    />
                    <Text style={[styles.checkText, hasMinLength && styles.checkTextActive]}>
                      At least 8 characters
                    </Text>
                  </View>
                  <View style={styles.checkItem}>
                    <MaterialIcons
                      name={hasUpper ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={hasUpper ? '#059669' : '#9CA3AF'}
                    />
                    <Text style={[styles.checkText, hasUpper && styles.checkTextActive]}>
                      At least 1 uppercase letter (A-Z)
                    </Text>
                  </View>
                  <View style={styles.checkItem}>
                    <MaterialIcons
                      name={hasLower ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={hasLower ? '#059669' : '#9CA3AF'}
                    />
                    <Text style={[styles.checkText, hasLower && styles.checkTextActive]}>
                      At least 1 lowercase letter (a-z)
                    </Text>
                  </View>
                  <View style={styles.checkItem}>
                    <MaterialIcons
                      name={hasNumber ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={hasNumber ? '#059669' : '#9CA3AF'}
                    />
                    <Text style={[styles.checkText, hasNumber && styles.checkTextActive]}>
                      At least 1 number (0-9)
                    </Text>
                  </View>
                  <View style={styles.checkItem}>
                    <MaterialIcons
                      name={hasSpecial ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={hasSpecial ? '#059669' : '#9CA3AF'}
                    />
                    <Text style={[styles.checkText, hasSpecial && styles.checkTextActive]}>
                      At least 1 special character (!@#$%^&*)
                    </Text>
                  </View>
                </View>
              )}

              {/* Confirm Password */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  Confirm New Password <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <View style={styles.inputWrapper}>
                  <MaterialIcons name="lock" size={18} color="#9CA3AF" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Re-enter new password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!showConfirmPassword}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={styles.eyeBtn}
                  >
                    <MaterialIcons
                      name={showConfirmPassword ? 'visibility-off' : 'visibility'}
                      size={20}
                      color="#6B7280"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  (!currentPassword || !newPassword || !confirmPassword || isUpdating) && styles.submitBtnDisabled,
                ]}
                onPress={handleUpdatePassword}
                disabled={!currentPassword || !newPassword || !confirmPassword || isUpdating}
                activeOpacity={0.8}
              >
                {isUpdating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialIcons name="verified-user" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.submitBtnText}>Update & Save Password</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Session Management */}
            {onLogout && (
              <View style={styles.logoutCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.logoutTitle}>
                    {isCoordinator ? 'End Coordinator Session' : 'End Admin Session'}
                  </Text>
                  <Text style={styles.logoutDesc}>
                    {isCoordinator
                      ? 'Sign out of Barangay Coordinator Portal'
                      : 'Sign out of CENRO City Government Portal'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.logoutBtn}
                  onPress={() => {
                    handleClose();
                    onLogout();
                  }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="logout" size={16} color="#DC2626" style={{ marginRight: 6 }} />
                  <Text style={styles.logoutBtnText}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            )}
              </>
            ) : (
              /* Fiscal Year & Budget Settings Tab */
              <View style={styles.sectionCard}>
                <View style={styles.sectionTitleRow}>
                  <MaterialIcons name="account-balance" size={20} color="#0D9488" />
                  <Text style={styles.sectionTitle}>Fiscal Year Budget & Sufficiency Governance</Text>
                </View>
                <Text style={styles.sectionDesc}>
                  Configure the official municipal budget for Danao City. The system calculates the projected total cost from forecasted waste tonnages in real time to verify financial sufficiency.
                </Text>

                {/* Success Banner */}
                {Boolean(fiscalSuccess) && (
                  <View style={styles.successBanner}>
                    <MaterialIcons name="check-circle" size={20} color="#059669" />
                    <Text style={styles.successText}>{fiscalSuccess}</Text>
                  </View>
                )}

                {/* Error Banner */}
                {Boolean(fiscalError) && (
                  <View style={styles.errorBanner}>
                    <MaterialIcons name="error" size={20} color="#DC2626" />
                    <Text style={styles.errorText}>{fiscalError}</Text>
                  </View>
                )}

                {/* Inputs for Fiscal Year and Budget */}
                <View style={styles.fyInputRow}>
                  <View style={{ width: 130 }}>
                    <Text style={styles.inputLabel}>
                      Fiscal Year <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                    <View style={styles.inputWrapper}>
                      <MaterialIcons name="calendar-today" size={18} color="#9CA3AF" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInput}
                        value={fyYearInput}
                        onChangeText={setFyYearInput}
                        placeholder="2026"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="numeric"
                        maxLength={4}
                      />
                    </View>
                  </View>

                  <View style={{ flex: 1, minWidth: 200 }}>
                    <Text style={styles.inputLabel}>
                      Annual Budget Allocation (₱) <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                    <View style={styles.inputWrapper}>
                      <MaterialIcons name="payments" size={18} color="#9CA3AF" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInput}
                        value={fyBudgetInput}
                        onChangeText={setFyBudgetInput}
                        placeholder="15000000"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="numeric"
                      />
                    </View>
                  </View>
                </View>

                {/* Real-time Budget Sufficiency Banner */}
                <View style={[
                  styles.sufficiencyBanner,
                  liveSufficiency.status === 'sufficient' ? styles.bannerSufficient :
                  liveSufficiency.status === 'near-limit' ? styles.bannerWarning :
                  liveSufficiency.status === 'insufficient' ? styles.bannerDanger : styles.bannerNeutral
                ]}>
                  <MaterialIcons
                    name={
                      liveSufficiency.status === 'sufficient' ? 'check-circle' :
                      liveSufficiency.status === 'near-limit' ? 'warning' :
                      liveSufficiency.status === 'insufficient' ? 'error' : 'hourglass-empty'
                    }
                    size={22}
                    color={
                      liveSufficiency.status === 'sufficient' ? '#059669' :
                      liveSufficiency.status === 'near-limit' ? '#D97706' :
                      liveSufficiency.status === 'insufficient' ? '#DC2626' : '#64748B'
                    }
                    style={{ marginTop: 2 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[
                      styles.sufficiencyBannerTitle,
                      liveSufficiency.status === 'sufficient' ? { color: '#065F46' } :
                      liveSufficiency.status === 'near-limit' ? { color: '#92400E' } :
                      liveSufficiency.status === 'insufficient' ? { color: '#991B1B' } : { color: '#334155' }
                    ]}>
                      {liveSufficiency.status === 'sufficient'
                        ? `✅ BUDGET IS SUFFICIENT FOR FY ${liveSufficiency.fiscalYear}`
                        : liveSufficiency.status === 'near-limit'
                        ? `⚠️ BUDGET NEAR ALLOCATION CEILING (FY ${liveSufficiency.fiscalYear})`
                        : liveSufficiency.status === 'insufficient'
                        ? `🚨 INSUFFICIENT BUDGET FOR FY ${liveSufficiency.fiscalYear} (DEFICIT WARNING)`
                        : `AWAITING DATA`}
                    </Text>
                    <Text style={styles.sufficiencyBannerText}>
                      {liveSufficiency.status === 'sufficient'
                        ? `Allocated budget of ${formatCurrency(liveSufficiency.allocatedBudget)} fully covers projected operational costs of ${formatCurrency(liveSufficiency.projectedAnnualCost)} with a surplus buffer of ${formatCurrency(liveSufficiency.budgetBuffer)} (${liveSufficiency.utilizationRatePercent}% utilized).`
                        : liveSufficiency.status === 'near-limit'
                        ? `Projected operational costs of ${formatCurrency(liveSufficiency.projectedAnnualCost)} reaches ${liveSufficiency.utilizationRatePercent}% of the allocation. Remaining buffer: ${formatCurrency(liveSufficiency.budgetBuffer)}.`
                        : liveSufficiency.status === 'insufficient'
                        ? `Projected operational cost of ${formatCurrency(liveSufficiency.projectedAnnualCost)} exceeds the ${formatCurrency(liveSufficiency.allocatedBudget)} allocation by ${formatCurrency(Math.abs(liveSufficiency.budgetBuffer || 0))} (${liveSufficiency.utilizationRatePercent}% budget utilization). Additional appropriation required.`
                        : `Enter the allocated municipal budget above.`}
                    </Text>
                  </View>
                </View>

                {/* 4 Key Metric Summary Cards */}
                <View style={styles.fyMetricsGrid}>
                  <View style={styles.fyMetricCard}>
                    <Text style={styles.fyMetricLabel}>FY ALLOCATED BUDGET</Text>
                    <Text style={[styles.fyMetricValue, { color: '#0D9488' }]}>
                      {formatCurrency(liveSufficiency.allocatedBudget)}
                    </Text>
                    <Text style={styles.fyMetricSub}>City Approved Budget</Text>
                  </View>

                  <View style={styles.fyMetricCard}>
                    <Text style={styles.fyMetricLabel}>TOTAL PROJECTED COST</Text>
                    <Text style={[styles.fyMetricValue, { color: liveSufficiency.isSufficient ? '#1E293B' : '#DC2626' }]}>
                      {formatCurrency(liveSufficiency.projectedAnnualCost)}
                    </Text>
                    <Text style={styles.fyMetricSub}>Annual Waste Operations</Text>
                  </View>

                  <View style={[
                    styles.fyMetricCard,
                    liveSufficiency.isSufficient ? { backgroundColor: '#F0FDF4' } : { backgroundColor: '#FEF2F2' }
                  ]}>
                    <Text style={styles.fyMetricLabel}>
                      {liveSufficiency.isSufficient ? 'SURPLUS BUFFER' : 'PROJECTED DEFICIT'}
                    </Text>
                    <Text style={[styles.fyMetricValue, { color: liveSufficiency.isSufficient ? '#166534' : '#DC2626' }]}>
                      {formatCurrency(liveSufficiency.budgetBuffer)}
                    </Text>
                    <Text style={styles.fyMetricSub}>
                      {liveSufficiency.isSufficient ? 'Remaining unallocated' : 'Budget shortfall'}
                    </Text>
                  </View>

                  <View style={styles.fyMetricCard}>
                    <Text style={styles.fyMetricLabel}>UTILIZATION RATE</Text>
                    <Text style={[styles.fyMetricValue, { color: liveSufficiency.utilizationRatePercent && liveSufficiency.utilizationRatePercent > 100 ? '#DC2626' : '#0F172A' }]}>
                      {liveSufficiency.utilizationRatePercent !== null ? `${liveSufficiency.utilizationRatePercent}%` : '—'}
                    </Text>
                    <Text style={styles.fyMetricSub}>Of Allocated Budget</Text>
                  </View>
                </View>

                {/* Total Cost Formula Transparency Box */}
                <View style={styles.formulaBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <MaterialIcons name="info-outline" size={14} color="#0F766E" />
                    <Text style={styles.formulaTitle}>TOTAL COST COMPUTATION FORMULA</Text>
                  </View>
                  <Text style={styles.formulaText}>
                    Total Cost = Projected Annual Tonnage ({formatAdaptiveMassFromMetricTons(annualForecastTons)}) × Cost/Ton ({formatCurrency(costPerTon)}) + Contingency Buffer ({contingencyPercent}%) = {formatCurrency(projectedAnnualTotalCost)}.
                  </Text>
                </View>

                {/* Save Fiscal Settings Button */}
                <TouchableOpacity
                  style={[styles.submitBtn, savingFiscal && styles.submitBtnDisabled, { backgroundColor: '#0D9488' }]}
                  onPress={handleSaveFiscalYear}
                  disabled={savingFiscal}
                  activeOpacity={0.8}
                >
                  {savingFiscal ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <MaterialIcons name="save" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                      <Text style={styles.submitBtnText}>Save Fiscal Year Allocation</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 540,
    maxHeight: '90%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FAFDFB',
  },
  headerIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextContainer: {
    flex: 1,
    marginLeft: 14,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '600',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
  },
  scrollBody: {
    padding: 20,
  },
  profileCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  adminEmail: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  cictoBadge: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  cictoBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
  },
  roleBadge: {
    backgroundColor: '#E0F2FE',
    borderColor: '#BAE6FD',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0369A1',
  },
  infoDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  infoLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#64748B',
  },
  infoValue: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#1E293B',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  sectionDesc: {
    fontSize: 12.5,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 16,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
  },
  successText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#065F46',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#991B1B',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  requiredAsterisk: {
    color: '#DC2626',
    fontWeight: '800',
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
  inputIcon: {
    marginRight: 8,
  },
  textInput: {
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
  checklistCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  checklistTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 2,
  },
  checkText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  checkTextActive: {
    color: '#059669',
    fontWeight: '600',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1B4D3E',
    height: 48,
    borderRadius: 10,
    marginTop: 6,
    shadowColor: '#1B4D3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  submitBtnDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  logoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FFE4E6',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  logoutTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9F1239',
  },
  logoutDesc: {
    fontSize: 11.5,
    color: '#BE123C',
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FECDD3',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  logoutBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#DC2626',
  },
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    padding: 6,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#64748B',
  },
  tabButtonTextActive: {
    color: '#1B4D3E',
    fontWeight: '800',
  },
  fyInputRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 14,
  },
  sufficiencyBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1.5,
  },
  bannerSufficient: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  bannerWarning: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  bannerDanger: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  bannerNeutral: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  sufficiencyBannerTitle: {
    fontSize: 12.5,
    fontWeight: '900',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  sufficiencyBannerText: {
    fontSize: 11.5,
    lineHeight: 17,
    color: '#334155',
  },
  fyMetricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  fyMetricCard: {
    flex: 1,
    minWidth: 110,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
  },
  fyMetricLabel: {
    color: '#64748B',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  fyMetricValue: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 4,
  },
  fyMetricSub: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 2,
  },
  formulaBox: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  formulaTitle: {
    color: '#0F766E',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  formulaText: {
    color: '#134E4A',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
  },
});
