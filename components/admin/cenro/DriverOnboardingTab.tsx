import { DANAO_CITY_BARANGAYS, resolveScheduleBarangays } from '@/constants/danaoBarangays';
import { MaterialIcons } from '@expo/vector-icons';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
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
  useWindowDimensions,
  View
} from 'react-native';
import { db } from '@/config/firebase';
import { provisionDriverOnSpark } from '@/services/driverProvisioningService';
import DriverQrBadgeModal from '@/components/driver/DriverQrBadgeModal';
import QRCode from 'react-native-qrcode-svg';
import { buildDriverQrPayload, encodeDriverQrString, ensureDriverQrToken } from '@/services/driverQrService';

export default function DriverOnboardingTab({
  onClose,
  defaultBarangay,
  initialUser,
  initialMode,
  isReadOnly = false,
}: {
  onClose?: () => void;
  defaultBarangay?: string;
  initialUser?: any;
  initialMode?: 'create' | 'upgrade';
  isReadOnly?: boolean;
} = {}) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const isNarrow = width < 960;
  const scrollViewRef = useRef<ScrollView>(null);

  const [mode, setMode] = useState<'create' | 'upgrade'>(initialMode || (initialUser ? 'upgrade' : 'create'));

  // Employee & License State
  const [employeeSuffix, setEmployeeSuffix] = useState('');
  const [isCalculatingId, setIsCalculatingId] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState('');

  // Create State - Names
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleInitial, setMiddleInitial] = useState('');

  // Create State - Credentials & Contact
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');

  // Upgrade / Modify State
  const [searchEmail, setSearchEmail] = useState('');
  const [foundUser, setFoundUser] = useState<any>(initialUser || null);
  const [residentsList, setResidentsList] = useState<any[]>([]);

  // Vehicle & Area Assignment
  const [assignedBarangay, setAssignedBarangay] = useState(defaultBarangay || '');
  const [isBarangayDropdownOpen, setIsBarangayDropdownOpen] = useState(false);
  const [availableBarangays, setAvailableBarangays] = useState<string[]>([...DANAO_CITY_BARANGAYS]);
  const [scheduleBarangaySet, setScheduleBarangaySet] = useState<Set<string>>(new Set());
  const [barangaySearchQuery, setBarangaySearchQuery] = useState('');
  const [selectedTruckId, setSelectedTruckId] = useState('');
  const [availableTrucks, setAvailableTrucks] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const normSelectedBarangay = React.useMemo(() => {
    return (assignedBarangay || '')
      .toLowerCase()
      .replace(/^(brgy\.?|barangay)\s*/i, '')
      .replace(/_(whole|original)/i, '')
      .trim();
  }, [assignedBarangay]);

  const filteredTrucks = React.useMemo(() => {
    if (!normSelectedBarangay) return [];
    return availableTrucks.filter((truck) => {
      const truckBarangay = (truck.assignedBarangay || truck.barangay || '')
        .toLowerCase()
        .replace(/^(brgy\.?|barangay)\s*/i, '')
        .replace(/_(whole|original)/i, '')
        .trim();
      return truckBarangay === normSelectedBarangay;
    });
  }, [availableTrucks, normSelectedBarangay]);

  useEffect(() => {
    if (selectedTruckId && selectedTruckId !== 'none') {
      const isMatch = filteredTrucks.some(t => t.id === selectedTruckId);
      if (!isMatch) {
        setSelectedTruckId('');
      }
    }
  }, [filteredTrucks, selectedTruckId]);

  // Validation & Feedback UI State
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
  const [bannerFeedback, setBannerFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [successModalData, setSuccessModalData] = useState<any>(null);
  const [showFullQrBadgeModal, setShowFullQrBadgeModal] = useState(false);

  // Auto-increment Employee ID based on existing database records
  const fetchNextEmployeeId = async () => {
    if (!db) return;
    setIsCalculatingId(true);
    try {
      const existingNumbers = new Set<number>();

      // 1. Check employee_ids collection
      try {
        const employeeSnap = await getDocs(collection(db, 'employee_ids'));
        employeeSnap.forEach(d => {
          const id = d.id;
          const match = id.match(/(\d+)$/);
          if (match) {
            existingNumbers.add(parseInt(match[1], 10));
          }
        });
      } catch { }

      // 2. Also check users collection for drivers
      try {
        const qDrivers = query(collection(db, 'users'), where('role', '==', 'driver'));
        const userSnap = await getDocs(qDrivers);
        userSnap.forEach(d => {
          const empId = d.data()?.employeeId;
          if (empId) {
            const match = String(empId).match(/(\d+)$/);
            if (match) {
              existingNumbers.add(parseInt(match[1], 10));
            }
          }
        });
      } catch { }

      // 3. Find lowest unused number starting from 1
      let nextNum = 1;
      while (existingNumbers.has(nextNum)) {
        nextNum++;
      }

      const nextSuffix = String(nextNum).padStart(4, '0');
      setEmployeeSuffix(nextSuffix);
    } catch (err) {
      console.warn('Auto-increment Employee ID note:', err);
      if (!employeeSuffix) setEmployeeSuffix('0001');
    } finally {
      setIsCalculatingId(false);
    }
  };

  useEffect(() => {
    fetchNextEmployeeId();
  }, []);

  useEffect(() => {
    if (!db) return;

    // Fetch active trucks
    const q = query(collection(db, 'trucks'), where('status', '==', 'active'));
    const unsub = onSnapshot(q, snap => {
      const trucks: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        trucks.push({
          id: d.id,
          plateNumber: data.plateNumber,
          type: data.type,
          assignedDriverId: data.assignedDriverId || null,
          assignedDriverName: data.assignedDriverName || null,
          assignedBarangay: data.assignedBarangay || data.barangay || '',
          barangay: data.barangay || data.assignedBarangay || '',
        });
      });
      setAvailableTrucks(trucks);
    });

    // Fetch residents and existing drivers
    const unsubUsers = onSnapshot(collection(db, 'users'), snap => {
      const list: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        const role = (data.role || '').toLowerCase();
        if (!role || role === 'user' || role === 'resident' || role === 'driver') {
          list.push({ id: d.id, ...data });
        }
      });
      setResidentsList(list);
    });

    // Fetch collection schedules to dynamically detect configured barangays
    const unsubSchedules = onSnapshot(collection(db, 'barangay_schedules'), snap => {
      const scheduleNames = new Set<string>();
      snap.forEach(d => {
        const data = d.data();
        if (data.barangayName && typeof data.barangayName === 'string' && data.barangayName.trim()) {
          scheduleNames.add(data.barangayName.trim());
        }
      });
      setScheduleBarangaySet(scheduleNames);
      setAvailableBarangays(resolveScheduleBarangays(Array.from(scheduleNames)));
    });

    return () => {
      unsub();
      unsubUsers();
      unsubSchedules();
    };
  }, []);

  const handleSelectResident = (r: any) => {
    setFoundUser(r);
    setLastName(r.lastName || '');
    setFirstName(r.firstName || r.displayName || '');
    setMiddleInitial(r.middleInitial || '');
    setPhoneNumber(r.phoneNumber?.replace('+63 ', '') || r.contactInfo?.replace('+63 ', '') || '');
    setNewEmail(r.email || '');
    setAssignedBarangay(r.assignedBarangay || r.barangay || '');
    if (r.licenseNumber) {
      setLicenseNumber(r.licenseNumber);
    }
    if (r.employeeId) {
      const match = String(r.employeeId).match(/(\d+)$/);
      if (match) {
        setEmployeeSuffix(match[1]);
      }
    }
    if (r.currentTruckId) {
      setSelectedTruckId(r.currentTruckId);
    } else {
      setSelectedTruckId('none');
    }
    if (formErrors.foundUser) {
      setFormErrors(prev => {
        const next = { ...prev };
        delete next.foundUser;
        return next;
      });
    }
  };

  useEffect(() => {
    if (initialUser) {
      handleSelectResident(initialUser);
      if (defaultBarangay && !initialUser.assignedBarangay && !initialUser.barangay) {
        setAssignedBarangay(defaultBarangay);
      }
    } else if (defaultBarangay) {
      setAssignedBarangay(defaultBarangay);
    }
  }, [initialUser, defaultBarangay]);

  // Format Full Name
  const getFormattedFullName = () => {
    const fn = firstName.trim();
    const mi = middleInitial.trim() ? `${middleInitial.trim().replace(/\.$/, '')}. ` : '';
    const ln = lastName.trim();
    return `${fn} ${mi}${ln}`.trim() || `${ln}, ${fn}`.trim();
  };

  // Auto-generate strong temporary password (minimum 8 characters)
  const handleAutoGeneratePassword = () => {
    const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lowercase = 'abcdefghijkmnpqrstuvwxyz';
    const numbers = '23456789';
    const symbols = '!@#$%&*';

    let pwd = '';
    pwd += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
    pwd += lowercase.charAt(Math.floor(Math.random() * lowercase.length));
    pwd += numbers.charAt(Math.floor(Math.random() * numbers.length));
    pwd += symbols.charAt(Math.floor(Math.random() * symbols.length));

    const allChars = uppercase + lowercase + numbers + symbols;
    for (let i = 0; i < 6; i++) {
      pwd += allChars.charAt(Math.floor(Math.random() * allChars.length));
    }

    const shuffled = pwd.split('').sort(() => 0.5 - Math.random()).join('');
    setNewPassword(shuffled);
    setShowPassword(true);

    // Clear password error if present
    if (formErrors.password) {
      setFormErrors(prev => {
        const next = { ...prev };
        delete next.password;
        return next;
      });
    }
  };

  // Philippine Mobile Phone Formatter (+63 9XX XXX XXXX)
  const handlePhoneChange = (text: string) => {
    let digits = text.replace(/\D/g, '');
    if (digits.startsWith('63')) digits = digits.slice(2);
    if (digits.startsWith('0')) digits = digits.slice(1);
    digits = digits.slice(0, 10);

    let formatted = digits;
    if (digits.length > 6) {
      formatted = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    } else if (digits.length > 3) {
      formatted = `${digits.slice(0, 3)} ${digits.slice(3)}`;
    }
    setPhoneNumber(formatted);

    if (formErrors.phoneNumber) {
      setFormErrors(prev => {
        const next = { ...prev };
        delete next.phoneNumber;
        return next;
      });
    }
  };

  // Philippine Driver's License Formatter: A00-YY-XXXXXX (e.g. D01-26-001234 or N01-24-123456)
  const handleLicenseChange = (text: string) => {
    const raw = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 11);
    if (raw.length === 0) {
      setLicenseNumber('');
      return;
    }

    let formatted = raw.slice(0, 1);
    if (raw.length > 1) {
      formatted += raw.slice(1, 3);
    }
    if (raw.length > 3) {
      formatted += '-' + raw.slice(3, 5);
    }
    if (raw.length > 5) {
      formatted += '-' + raw.slice(5, 11);
    }
    setLicenseNumber(formatted);

    if (formErrors.licenseNumber) {
      setFormErrors(prev => {
        const next = { ...prev };
        delete next.licenseNumber;
        return next;
      });
    }
  };

  // Auto-fill license template on focus if empty
  const handleLicenseFocus = () => {
    if (!licenseNumber.trim()) {
      setLicenseNumber('D01-26-');
    }
  };

  // Computed Full IDs
  const fullEmployeeId = employeeSuffix.trim() ? `CENRO-2026-${employeeSuffix.trim().toUpperCase()}` : '';

  const handleCompleteOnboarding = async () => {
    if (isReadOnly) {
      Alert.alert('Read-Only Mode', 'Account provisioning is restricted in Read-Only Mode.');
      return;
    }
    setBannerFeedback(null);
    const errors: { [key: string]: string } = {};

    // 1. Validate Employee ID
    if (!employeeSuffix.trim()) {
      errors.employeeSuffix = 'Employee ID suffix is required (e.g. 0001).';
    }

    // 2. Validate Driver's License
    if (!licenseNumber.trim() || licenseNumber.length < 8) {
      errors.licenseNumber = "Valid Philippine Driver's License is required (e.g. D01-26-001234).";
    }

    // 3. Validate Assigned Barangay
    if (!assignedBarangay.trim()) {
      errors.assignedBarangay = 'Please select an assigned barangay for the driver.';
    }

    if (mode === 'create') {
      // 4. Validate Names
      if (!lastName.trim()) errors.lastName = 'Last Name is required.';
      if (!firstName.trim()) errors.firstName = 'First Name is required.';

      // 5. Validate Email
      if (!newEmail.trim() || !newEmail.includes('@') || !newEmail.includes('.')) {
        errors.email = 'Valid login email address is required.';
      }

      // 6. Validate Contact Number
      const phoneDigits = phoneNumber.replace(/\D/g, '');
      if (!phoneNumber.trim() || phoneDigits.length < 10) {
        errors.phoneNumber = 'Valid 10-digit mobile contact number is required (e.g. 9XX XXX XXXX).';
      }

      // 7. Validate Password
      if (!newPassword || newPassword.length < 8 || newPassword.length > 24) {
        errors.password = 'Password must be 8 to 24 characters. Click Auto-Generate.';
      }
    } else {
      if (!foundUser) {
        errors.foundUser = 'Please select an existing resident or driver account to modify.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      const firstError = Object.values(errors)[0];
      setBannerFeedback({ type: 'error', message: firstError });
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    try {
      const formattedFullName = mode === 'create' ? getFormattedFullName() : (foundUser?.displayName || getFormattedFullName());
      const fullContact = phoneNumber.trim() ? `+63 ${phoneNumber.trim()}` : '';

      console.log('Dispatching driver onboarding/modification:', {
        mode,
        email: newEmail.trim(),
        fullName: formattedFullName,
        employeeId: fullEmployeeId,
        licenseNumber: licenseNumber.trim().toUpperCase(),
        assignedBarangay: assignedBarangay.trim(),
      });

      const res = await provisionDriverOnSpark({
        mode,
        email: newEmail.trim(),
        password: mode === 'create' ? newPassword : undefined,
        fullName: formattedFullName,
        firstName: mode === 'create' ? firstName.trim() : (firstName.trim() || undefined),
        lastName: mode === 'create' ? lastName.trim() : (lastName.trim() || undefined),
        middleInitial: mode === 'create' ? middleInitial.trim() : (middleInitial.trim() || undefined),
        contactInfo: fullContact || foundUser?.contactInfo,
        phoneNumber: fullContact || foundUser?.phoneNumber,
        existingUserId: mode === 'upgrade' ? foundUser?.id : undefined,
        employeeId: fullEmployeeId,
        licenseNumber: licenseNumber.trim().toUpperCase(),
        truckId: (selectedTruckId && selectedTruckId !== 'none') ? selectedTruckId : undefined,
        assignedBarangay: assignedBarangay.trim(),
      });

      const driverUid = res?.uid || foundUser?.id;
      const qrLoginToken = res?.qrLoginToken || (driverUid ? await ensureDriverQrToken(driverUid, fullEmployeeId) : '');

      // Show Success Modal
      setSuccessModalData({
        uid: driverUid,
        name: formattedFullName,
        email: mode === 'create' ? newEmail.trim() : foundUser?.email,
        employeeId: fullEmployeeId,
        licenseNumber: licenseNumber.trim().toUpperCase(),
        barangay: assignedBarangay.trim(),
        truck: (selectedTruckId && selectedTruckId !== 'none')
          ? availableTrucks.find(t => t.id === selectedTruckId)?.plateNumber
          : 'None (Assign Later)',
        mode,
        isDriverUpdate: foundUser?.role === 'driver',
        qrLoginToken,
        authKey: res?.authKey || (mode === 'create' ? newPassword.trim() : undefined),
      });

      // Reset form
      setLicenseNumber('');
      setLastName('');
      setFirstName('');
      setMiddleInitial('');
      setNewEmail('');
      setNewPassword('');
      setPhoneNumber('');
      setSearchEmail('');
      setFoundUser(null);
      setAssignedBarangay('');
      setSelectedTruckId('');

      // Auto-increment next ID
      await fetchNextEmployeeId();
    } catch (e: any) {
      console.error('Driver Onboarding Error:', e);
      const msg = e.message || 'Failed to complete driver onboarding.';
      setBannerFeedback({ type: 'error', message: msg });
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView ref={scrollViewRef} style={[styles.container, isMobile && { padding: 12 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.contentWrapper}>
        {/* Page Header */}
        <View
          style={[
            styles.header,
            onClose && {
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
            },
          ]}
        >
          <View>
            <Text style={styles.headerSubtitle}>ADMINISTRATIVE MANAGEMENT</Text>
            <Text style={styles.headerTitle}>Driver Onboarding</Text>
          </View>
          {onClose && (
            <TouchableOpacity
              onPress={onClose}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: "#F1F5F9",
                alignItems: "center",
                justifyContent: "center",
              }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="close" size={20} color="#64748B" />
            </TouchableOpacity>
          )}
        </View>

        {/* In-App Feedback Banner (Errors or Status) */}
        {bannerFeedback && (
          <View
            style={[
              styles.feedbackBanner,
              bannerFeedback.type === 'error' ? styles.feedbackBannerError : styles.feedbackBannerSuccess,
            ]}
          >
            <MaterialIcons
              name={bannerFeedback.type === 'error' ? 'error-outline' : 'check-circle-outline'}
              size={20}
              color={bannerFeedback.type === 'error' ? '#DC2626' : '#059669'}
              style={{ marginRight: 8 }}
            />
            <Text
              style={[
                styles.feedbackBannerText,
                bannerFeedback.type === 'error' ? styles.feedbackBannerTextError : styles.feedbackBannerTextSuccess,
              ]}
            >
              {bannerFeedback.message}
            </Text>
            <TouchableOpacity onPress={() => setBannerFeedback(null)} style={{ padding: 4 }}>
              <MaterialIcons name="close" size={18} color="#64748B" />
            </TouchableOpacity>
          </View>
        )}

        {/* Mode Toggle Switch */}
        <View style={[styles.toggleContainer, isMobile && { flexDirection: 'column', gap: 6, height: 'auto', padding: 4 }]}>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'create' && styles.toggleBtnActive, isMobile && { width: '100%', paddingVertical: 10 }]}
            onPress={() => {
              setMode('create');
              setBannerFeedback(null);
              setFormErrors({});
            }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="person-add" size={17} color={mode === 'create' ? '#1B4D3E' : '#64748B'} style={{ marginRight: 6 }} />
            <Text style={[styles.toggleText, mode === 'create' && styles.toggleTextActive]}>
              Create New Account
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'upgrade' && styles.toggleBtnActive, isMobile && { width: '100%', paddingVertical: 10 }]}
            onPress={() => {
              setMode('upgrade');
              setBannerFeedback(null);
              setFormErrors({});
            }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="tune" size={17} color={mode === 'upgrade' ? '#1B4D3E' : '#64748B'} style={{ marginRight: 6 }} />
            <Text style={[styles.toggleText, mode === 'upgrade' && styles.toggleTextActive]}>
              Modify Existing Residents
            </Text>
          </TouchableOpacity>
        </View>

        {/* Main Registration Card */}
        <View style={[styles.card, isMobile && { padding: 16 }]}>

          {/* SECTION 1: TOP - Official Credentials (Employee ID & License Number) */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconBadge}>
              <MaterialIcons name="badge" size={18} color="#1B4D3E" />
            </View>
            <Text style={styles.sectionTitle}>Employment & Government Credentials</Text>
          </View>

          <View style={[styles.gridRow, isNarrow && { flexDirection: 'column', gap: 14 }]}>
            {/* Employee ID with prefilled CENRO-2026- badge and Auto-Next ID */}
            <View style={styles.formGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>
                  EMPLOYEE ID <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <TouchableOpacity
                  style={styles.autoGenBtn}
                  onPress={fetchNextEmployeeId}
                  activeOpacity={0.7}
                  disabled={isCalculatingId}
                >
                  <MaterialIcons
                    name={isCalculatingId ? 'hourglass-empty' : 'sync'}
                    size={12}
                    color="#059669"
                    style={{ marginRight: 3 }}
                  />
                  <Text style={styles.autoGenBtnText}>
                    {isCalculatingId ? 'Checking...' : 'Auto-Next'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View
                style={[
                  styles.compoundInputContainer,
                  formErrors.employeeSuffix ? styles.inputErrorBorder : null,
                ]}
              >
                <View style={styles.compoundPrefixBadge}>
                  <Text style={styles.compoundPrefixText}>CENRO-2026-</Text>
                </View>
                <TextInput
                  style={styles.compoundInput}
                  placeholder="0001"
                  placeholderTextColor="#94A3B8"
                  value={employeeSuffix}
                  onChangeText={t => {
                    setEmployeeSuffix(t.replace(/[^A-Z0-9-]/gi, '').toUpperCase());
                    if (formErrors.employeeSuffix) {
                      setFormErrors(prev => {
                        const next = { ...prev };
                        delete next.employeeSuffix;
                        return next;
                      });
                    }
                  }}
                  autoCapitalize="characters"
                  maxLength={10}
                />
              </View>
              {formErrors.employeeSuffix ? (
                <Text style={styles.errorHelperText}>{formErrors.employeeSuffix}</Text>
              ) : (
                <Text style={styles.helperText}>
                  Assigned ID: <Text style={styles.boldText}>{fullEmployeeId || 'CENRO-2026-0001'}</Text>
                </Text>
              )}
            </View>

            {/* Philippine Driver's License Input with LTO Format A00-YY-XXXXXX */}
            <View style={styles.formGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>
                  DRIVER&apos;S LICENSE NUMBER <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <View style={styles.npdlBadge}>
                  <Text style={styles.npdlBadgeText}>LTO PH</Text>
                </View>
              </View>
              <View
                style={[
                  styles.compoundInputContainer,
                  formErrors.licenseNumber ? styles.inputErrorBorder : null,
                ]}
              >
                <View style={styles.ltoPrefixBadge}>
                  <MaterialIcons name="credit-card" size={15} color="#1B4D3E" style={{ marginRight: 4 }} />
                  <Text style={styles.ltoPrefixText}>LTO</Text>
                </View>
                <TextInput
                  style={styles.compoundInput}
                  placeholder="D01-26-001234"
                  placeholderTextColor="#94A3B8"
                  value={licenseNumber}
                  onChangeText={handleLicenseChange}
                  onFocus={handleLicenseFocus}
                  autoCapitalize="characters"
                  maxLength={13}
                />
              </View>
              {formErrors.licenseNumber ? (
                <Text style={styles.errorHelperText}>{formErrors.licenseNumber}</Text>
              ) : (
                <Text style={styles.helperText}>
                  Format: <Text style={styles.boldText}>A00-YY-XXXXXX</Text> (e.g. <Text style={styles.boldText}>D01-26-001234</Text>)
                </Text>
              )}
            </View>
          </View>

          <View style={styles.sectionDivider} />

          {mode === 'upgrade' ? (
            /* SECTION 2 (Modify Mode): Search & Select Resident / Driver */
            <View style={styles.upgradeSection}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIconBadge}>
                  <MaterialIcons name="manage-accounts" size={18} color="#1B4D3E" />
                </View>
                <Text style={styles.sectionTitle}>Select Resident or Driver to Modify</Text>
              </View>

              <View style={styles.formGroupFull}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>
                    SEARCH REGISTERED ACCOUNTS <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                </View>
                <View style={styles.searchContainer}>
                  <MaterialIcons name="search" size={20} color="#9CA3AF" style={styles.searchIcon} />
                  <TextInput
                    style={[styles.input, { paddingLeft: 40, width: '100%' }]}
                    placeholder="Type name, email, or barangay to filter..."
                    placeholderTextColor="#9CA3AF"
                    value={searchEmail}
                    onChangeText={text => {
                      setSearchEmail(text);
                    }}
                    autoCapitalize="none"
                  />
                </View>
                {Boolean(formErrors.foundUser) && (
                  <Text style={styles.errorHelperText}>{formErrors.foundUser}</Text>
                )}
              </View>

              {foundUser ? (
                <View style={styles.foundUserCard}>
                  <View style={styles.foundUserRow}>
                    <View style={[styles.avatarBadge, foundUser.role === 'driver' && { backgroundColor: '#E0F2FE' }]}>
                      <Text style={[styles.avatarText, foundUser.role === 'driver' && { color: '#0369A1' }]}>
                        {foundUser.displayName?.substring(0, 2).toUpperCase() || 'DR'}
                      </Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={styles.foundUserName}>{foundUser.displayName || 'Unknown Name'}</Text>
                        <View style={[styles.roleBadgeSmall, { backgroundColor: foundUser.role === 'driver' ? '#E0F2FE' : '#F3F4F6' }]}>
                          <Text style={[styles.roleBadgeSmallText, { color: foundUser.role === 'driver' ? '#0369A1' : '#4B5563' }]}>
                            {foundUser.role === 'driver' ? 'Current Driver' : 'Resident'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.foundUserEmail}>{foundUser.email}</Text>
                      <Text style={styles.foundUserMeta}>
                        Barangay: <Text style={{ fontWeight: '700', color: '#1B4D3E' }}>{assignedBarangay || foundUser.assignedBarangay || foundUser.barangay || 'None'}</Text> • Contact: {foundUser.phoneNumber || foundUser.contactInfo || 'None'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => { setFoundUser(null); setAssignedBarangay(''); }} style={styles.removeUserBtn}>
                      <MaterialIcons name="close" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.residentsListContainer}>
                  <Text style={styles.listHeader}>
                    Available Accounts (
                    {
                      residentsList.filter(
                        r =>
                          (r.displayName?.toLowerCase() || '').includes(searchEmail.toLowerCase()) ||
                          (r.email?.toLowerCase() || '').includes(searchEmail.toLowerCase()) ||
                          (r.barangay?.toLowerCase() || '').includes(searchEmail.toLowerCase()) ||
                          (r.assignedBarangay?.toLowerCase() || '').includes(searchEmail.toLowerCase())
                      ).length
                    }
                    )
                  </Text>
                  <ScrollView style={styles.residentsScroll} nestedScrollEnabled={true}>
                    {residentsList
                      .filter(
                        r =>
                          (r.displayName?.toLowerCase() || '').includes(searchEmail.toLowerCase()) ||
                          (r.email?.toLowerCase() || '').includes(searchEmail.toLowerCase()) ||
                          (r.barangay?.toLowerCase() || '').includes(searchEmail.toLowerCase()) ||
                          (r.assignedBarangay?.toLowerCase() || '').includes(searchEmail.toLowerCase())
                      )
                      .map(r => (
                        <TouchableOpacity
                          key={r.id}
                          style={styles.residentListItem}
                          onPress={() => handleSelectResident(r)}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.avatarBadgeSmall, r.role === 'driver' && { backgroundColor: '#E0F2FE' }]}>
                            <Text style={[styles.avatarTextSmall, r.role === 'driver' && { color: '#0369A1' }]}>
                              {r.displayName?.substring(0, 2).toUpperCase() || 'RS'}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={styles.residentListName}>{r.displayName || 'Unknown Name'}</Text>
                              <View style={[styles.roleBadgeSmall, { backgroundColor: r.role === 'driver' ? '#E0F2FE' : '#F3F4F6' }]}>
                                <Text style={[styles.roleBadgeSmallText, { color: r.role === 'driver' ? '#0369A1' : '#4B5563' }]}>
                                  {r.role === 'driver' ? 'Driver' : 'Resident'}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.residentListEmail}>{r.email} • {r.assignedBarangay || r.barangay || 'No Barangay'}</Text>
                          </View>
                          <View style={styles.selectResidentBadge}>
                            <Text style={styles.selectResidentText}>Select →</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    {residentsList.filter(
                      r =>
                        (r.displayName?.toLowerCase() || '').includes(searchEmail.toLowerCase()) ||
                        (r.email?.toLowerCase() || '').includes(searchEmail.toLowerCase()) ||
                        (r.barangay?.toLowerCase() || '').includes(searchEmail.toLowerCase()) ||
                        (r.assignedBarangay?.toLowerCase() || '').includes(searchEmail.toLowerCase())
                    ).length === 0 && (
                        <Text style={styles.noResidentsText}>No matching accounts found.</Text>
                      )}
                  </ScrollView>
                </View>
              )}
            </View>
          ) : (
            /* SECTION 2 (Create Mode): Personal Details & Login Credentials */
            <View>
              {/* Section 2 Header: Driver Personal Details */}
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIconBadge}>
                  <MaterialIcons name="person" size={18} color="#1B4D3E" />
                </View>
                <Text style={styles.sectionTitle}>Driver Personal Details</Text>
              </View>

              {/* Separated Name Fields (Last Name *, First Name *, M.I.) */}
              <View style={[styles.nameRow, isMobile && { flexDirection: 'column', gap: 12 }]}>
                <View style={[styles.formGroup, { flex: 2.2 }]}>
                  <View style={styles.labelRow}>
                    <Text style={styles.label}>
                      LAST NAME <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                  </View>
                  <TextInput
                    style={[styles.input, formErrors.lastName ? styles.inputErrorBorder : null]}
                    placeholder="Dela Cruz"
                    placeholderTextColor="#9CA3AF"
                    value={lastName}
                    onChangeText={t => {
                      setLastName(t);
                      if (formErrors.lastName) {
                        setFormErrors(prev => {
                          const next = { ...prev };
                          delete next.lastName;
                          return next;
                        });
                      }
                    }}
                  />
                  {Boolean(formErrors.lastName) && (
                    <Text style={styles.errorHelperText}>{formErrors.lastName}</Text>
                  )}
                </View>

                <View style={[styles.formGroup, { flex: 2.2 }]}>
                  <View style={styles.labelRow}>
                    <Text style={styles.label}>
                      FIRST NAME <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                  </View>
                  <TextInput
                    style={[styles.input, formErrors.firstName ? styles.inputErrorBorder : null]}
                    placeholder="Juan"
                    placeholderTextColor="#9CA3AF"
                    value={firstName}
                    onChangeText={t => {
                      setFirstName(t);
                      if (formErrors.firstName) {
                        setFormErrors(prev => {
                          const next = { ...prev };
                          delete next.firstName;
                          return next;
                        });
                      }
                    }}
                  />
                  {Boolean(formErrors.firstName) && (
                    <Text style={styles.errorHelperText}>{formErrors.firstName}</Text>
                  )}
                </View>

                <View style={[styles.formGroup, { flex: 1 }]}>
                  <View style={styles.labelRow}>
                    <Text style={styles.label}>M.I.</Text>
                  </View>
                  <TextInput
                    style={[styles.input, { textAlign: 'center' }]}
                    placeholder="A."
                    placeholderTextColor="#9CA3AF"
                    maxLength={3}
                    value={middleInitial}
                    onChangeText={setMiddleInitial}
                    autoCapitalize="characters"
                  />
                </View>
              </View>

              <View style={styles.sectionDivider} />

              {/* Section 3 Header: Access & Contact */}
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIconBadge}>
                  <MaterialIcons name="vpn-key" size={18} color="#1B4D3E" />
                </View>
                <Text style={styles.sectionTitle}>Access Credentials & Contact</Text>
              </View>

              {/* Email & Temporary Password (with Auto-Generate) */}
              <View style={[styles.gridRow, isNarrow && { flexDirection: 'column', gap: 14 }]}>
                {/* Email Address */}
                <View style={styles.formGroup}>
                  <View style={styles.labelRow}>
                    <Text style={styles.label}>
                      EMAIL ADDRESS (LOGIN) <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                  </View>
                  <TextInput
                    style={[styles.input, formErrors.email ? styles.inputErrorBorder : null]}
                    placeholder="driver@trashtrack.gov.ph"
                    placeholderTextColor="#9CA3AF"
                    value={newEmail}
                    onChangeText={t => {
                      setNewEmail(t);
                      if (formErrors.email) {
                        setFormErrors(prev => {
                          const next = { ...prev };
                          delete next.email;
                          return next;
                        });
                      }
                    }}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                  {formErrors.email ? (
                    <Text style={styles.errorHelperText}>{formErrors.email}</Text>
                  ) : (
                    <Text style={styles.helperText}>Driver mobile app login credential</Text>
                  )}
                </View>

                {/* Temporary Password */}
                <View style={styles.formGroup}>
                  <View style={styles.labelRow}>
                    <Text style={styles.label}>
                      TEMPORARY PASSWORD <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                    <TouchableOpacity
                      style={styles.autoGenBtn}
                      onPress={handleAutoGeneratePassword}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="auto-fix-high" size={12} color="#059669" style={{ marginRight: 3 }} />
                      <Text style={styles.autoGenBtnText}>Auto-Generate</Text>
                    </TouchableOpacity>
                  </View>
                  <View
                    style={[
                      styles.passwordInputWrapper,
                      formErrors.password ? styles.inputErrorBorder : null,
                    ]}
                  >
                    <TextInput
                      style={styles.passwordField}
                      placeholder="8 to 24 characters"
                      placeholderTextColor="#9CA3AF"
                      value={newPassword}
                      onChangeText={t => {
                        setNewPassword(t);
                        if (formErrors.password) {
                          setFormErrors(prev => {
                            const next = { ...prev };
                            delete next.password;
                            return next;
                          });
                        }
                      }}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={styles.passwordEyeBtn}
                      onPress={() => setShowPassword(!showPassword)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons
                        name={showPassword ? 'visibility-off' : 'visibility'}
                        size={18}
                        color="#64748B"
                      />
                    </TouchableOpacity>
                  </View>
                  {formErrors.password ? (
                    <Text style={styles.errorHelperText}>{formErrors.password}</Text>
                  ) : (
                    <Text style={styles.helperText}>
                      Min. 8 chars with uppercase, lowercase, numbers & symbols
                    </Text>
                  )}
                </View>
              </View>

              {/* Contact Number with 🇵🇭 +63 Pill */}
              <View style={styles.formGroupFull}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>
                    CONTACT NUMBER (PHILIPPINES) <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                </View>
                <View
                  style={[
                    styles.phoneInputContainer,
                    formErrors.phoneNumber ? styles.inputErrorBorder : null,
                  ]}
                >
                  <View style={styles.countryPickerPill}>
                    <Text style={styles.flagEmoji}>🇵🇭</Text>
                    <Text style={styles.countryCodeText}>+63</Text>
                    <MaterialIcons name="arrow-drop-down" size={18} color="#64748B" />
                  </View>

                  <TextInput
                    style={styles.phoneNumberInput}
                    placeholder="9XX XXX XXXX"
                    placeholderTextColor="#94A3B8"
                    value={phoneNumber}
                    onChangeText={handlePhoneChange}
                    keyboardType="phone-pad"
                    maxLength={13}
                  />

                  {phoneNumber.length > 0 ? (
                    <TouchableOpacity
                      onPress={() => {
                        setPhoneNumber('');
                        if (formErrors.phoneNumber) {
                          setFormErrors(prev => {
                            const next = { ...prev };
                            delete next.phoneNumber;
                            return next;
                          });
                        }
                      }}
                      style={styles.phoneClearBtn}
                    >
                      <MaterialIcons name="cancel" size={18} color="#94A3B8" />
                    </TouchableOpacity>
                  ) : (
                    <MaterialIcons name="phone" size={18} color="#CBD5E1" style={{ marginRight: 14 }} />
                  )}
                </View>
                {formErrors.phoneNumber ? (
                  <Text style={styles.errorHelperText}>{formErrors.phoneNumber}</Text>
                ) : (
                  <Text style={styles.helperText}>Format: +63 9XX XXX XXXX (10-digit PH mobile)</Text>
                )}
              </View>
            </View>
          )}
        </View>

        {/* SECTION 4: Work & Operational Assignment Card */}
        <View
          style={[
            styles.card,
            isMobile && { padding: 16 },
            (isBarangayDropdownOpen || isDropdownOpen) && {
              zIndex: 1000,
              elevation: 10,
            },
          ]}
        >
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconBadge}>
              <MaterialIcons name="place" size={18} color="#1B4D3E" />
            </View>
            <Text style={styles.sectionTitle}>Work & Operational Assignment</Text>
          </View>

          <View
            style={[
              styles.assignmentRow,
              isMobile && { flexDirection: 'column', gap: 14 },
              (isBarangayDropdownOpen || isDropdownOpen) && { zIndex: 1000 },
            ]}
          >
            {/* Assigned Barangay Dropdown */}
            <View
              style={[
                styles.formGroup,
                { flex: 1, marginBottom: 0 },
                isBarangayDropdownOpen && { zIndex: 1000, position: 'relative' },
              ]}
            >
              <View style={styles.labelRow}>
                <Text style={styles.label}>
                  ASSIGNED BARANGAY / AREA <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
              </View>
              <View
                style={[
                  { position: 'relative' },
                  isBarangayDropdownOpen && { zIndex: 1000 },
                ]}
              >
                <TouchableOpacity
                  style={[styles.dropdown, formErrors.assignedBarangay ? styles.inputErrorBorder : null]}
                  onPress={() => {
                    setIsBarangayDropdownOpen(!isBarangayDropdownOpen);
                    setIsDropdownOpen(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.dropdownText, !assignedBarangay && { color: '#9CA3AF' }]}>
                    {assignedBarangay ? `Brgy. ${assignedBarangay}` : 'Select operational barangay...'}
                  </Text>
                  <MaterialIcons
                    name={isBarangayDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                    size={20}
                    color="#6B7280"
                  />
                </TouchableOpacity>

                {isBarangayDropdownOpen && (
                  <View style={[styles.dropdownMenu, { maxHeight: 260, zIndex: 9999, elevation: 20 }]}>
                    {/* Search Input inside dropdown */}
                    <View style={styles.dropdownSearchContainer}>
                      <MaterialIcons name="search" size={16} color="#6B7280" />
                      <TextInput
                        value={barangaySearchQuery}
                        onChangeText={setBarangaySearchQuery}
                        placeholder="Search barangay..."
                        placeholderTextColor="#9CA3AF"
                        style={styles.dropdownSearchInput}
                        autoFocus={false}
                      />
                      {barangaySearchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setBarangaySearchQuery('')}>
                          <MaterialIcons name="close" size={14} color="#6B7280" />
                        </TouchableOpacity>
                      )}
                    </View>
                    <ScrollView nestedScrollEnabled style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
                      {availableBarangays
                        .filter(b => !barangaySearchQuery.trim() || b.toLowerCase().includes(barangaySearchQuery.trim().toLowerCase()))
                        .map(b => {
                          const isScheduled = scheduleBarangaySet.has(b);
                          const isSelected = assignedBarangay === b;
                          return (
                            <TouchableOpacity
                              key={b}
                              style={[styles.dropdownItem, isSelected && { backgroundColor: '#E8F5E9' }]}
                              onPress={() => {
                                setAssignedBarangay(b);
                                setIsBarangayDropdownOpen(false);
                                setBarangaySearchQuery('');
                                if (formErrors.assignedBarangay) {
                                  setFormErrors(prev => {
                                    const next = { ...prev };
                                    delete next.assignedBarangay;
                                    return next;
                                  });
                                }
                              }}
                            >
                              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={[styles.dropdownItemText, isSelected && { color: '#1B4D3E', fontWeight: '700' }]}>
                                  {b}
                                </Text>
                                {isScheduled && (
                                  <View style={styles.scheduledBadgeMini}>
                                    <Text style={styles.scheduledBadgeMiniText}>Scheduled</Text>
                                  </View>
                                )}
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      {availableBarangays.filter(b => !barangaySearchQuery.trim() || b.toLowerCase().includes(barangaySearchQuery.trim().toLowerCase())).length === 0 && (
                        <View style={{ padding: 16, alignItems: 'center' }}>
                          <Text style={{ color: '#9CA3AF', fontSize: 13 }}>
                            {barangaySearchQuery ? 'No matching barangay found' : 'No collection schedules created yet'}
                          </Text>
                        </View>
                      )}
                    </ScrollView>
                  </View>
                )}
              </View>
              {formErrors.assignedBarangay ? (
                <Text style={styles.errorHelperText}>{formErrors.assignedBarangay}</Text>
              ) : (
                <Text style={styles.helperText}>Scopes the driver&apos;s collection duty to this barangay</Text>
              )}
            </View>

            {/* Truck Assignment Dropdown */}
            <View
              style={[
                styles.formGroup,
                { flex: 1, marginBottom: 0 },
                isDropdownOpen && { zIndex: 1000, position: 'relative' },
              ]}
            >
              <View style={styles.labelRow}>
                <Text style={styles.label}>ASSIGN TRUCK / VEHICLE (OPTIONAL)</Text>
              </View>
              <View
                style={[
                  { position: 'relative' },
                  isDropdownOpen && { zIndex: 1000 },
                ]}
              >
                <TouchableOpacity
                  style={styles.dropdown}
                  onPress={() => {
                    setIsDropdownOpen(!isDropdownOpen);
                    setIsBarangayDropdownOpen(false);
                  }}
                  activeOpacity={0.8}
                >
                  {selectedTruckId === 'none' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="schedule" size={16} color="#059669" />
                      <Text style={[styles.dropdownText, { color: '#065F46', fontWeight: '700' }]}>
                        None (Assign Later)
                      </Text>
                    </View>
                  ) : selectedTruckId ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: 6 }}>
                      <MaterialIcons name="local-shipping" size={16} color="#1B4D3E" />
                      <Text style={[styles.dropdownText, { flexShrink: 1 }]} numberOfLines={1}>
                        {availableTrucks.find(t => t.id === selectedTruckId)?.plateNumber || selectedTruckId} — {availableTrucks.find(t => t.id === selectedTruckId)?.type || 'Truck'}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.dropdownText, { color: '#9CA3AF' }]}>
                      {!assignedBarangay ? 'Select assigned barangay first...' : 'Select available truck unit...'}
                    </Text>
                  )}
                  <MaterialIcons
                    name={isDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                    size={20}
                    color="#6B7280"
                  />
                </TouchableOpacity>

                {isDropdownOpen && (
                  <View style={[styles.dropdownMenu, { maxHeight: 220, zIndex: 9999, elevation: 20 }]}>
                    <ScrollView nestedScrollEnabled style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
                      <TouchableOpacity
                        style={[
                          styles.dropdownItem,
                          selectedTruckId === 'none' && { backgroundColor: '#E8F5E9' },
                        ]}
                        onPress={() => {
                          setSelectedTruckId('none');
                          setIsDropdownOpen(false);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <MaterialIcons name="schedule" size={16} color={selectedTruckId === 'none' ? '#059669' : '#64748B'} />
                            <Text style={[styles.dropdownItemText, selectedTruckId === 'none' && { color: '#1B4D3E', fontWeight: '700' }]}>
                              None (Assign Later)
                            </Text>
                          </View>
                          {selectedTruckId === 'none' && (
                            <MaterialIcons name="check" size={16} color="#059669" />
                          )}
                        </View>
                      </TouchableOpacity>

                      {!assignedBarangay ? (
                        <View style={styles.dropdownItem}>
                          <Text style={{ color: '#9CA3AF', fontSize: 13 }}>
                            Please select an assigned barangay first.
                          </Text>
                        </View>
                      ) : filteredTrucks.length === 0 ? (
                        <View style={styles.dropdownItem}>
                          <Text style={{ color: '#9CA3AF', fontSize: 13 }}>
                            No active trucks connected to {assignedBarangay}.
                          </Text>
                        </View>
                      ) : (
                        filteredTrucks.map(truck => {
                          const isAssignedToOther = Boolean(truck.assignedDriverId && truck.assignedDriverId !== foundUser?.id);
                          return (
                            <TouchableOpacity
                              key={truck.id}
                              style={[
                                styles.dropdownItem,
                                selectedTruckId === truck.id && { backgroundColor: '#E8F5E9' },
                                isAssignedToOther && { opacity: 0.6 },
                              ]}
                              onPress={() => {
                                if (isAssignedToOther) {
                                  Alert.alert(
                                    'Truck Already Assigned',
                                    `Truck ${truck.plateNumber} is already assigned to ${truck.assignedDriverName || 'another driver'}. Please unassign it in Fleet Inventory first.`
                                  );
                                  return;
                                }
                                setSelectedTruckId(truck.id);
                                setIsDropdownOpen(false);
                              }}
                              activeOpacity={0.7}
                            >
                              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginRight: 8 }}>
                                  <MaterialIcons
                                    name="local-shipping"
                                    size={16}
                                    color={selectedTruckId === truck.id ? '#1B4D3E' : isAssignedToOther ? '#94A3B8' : '#64748B'}
                                  />
                                  <Text
                                    style={[
                                      styles.dropdownItemText,
                                      selectedTruckId === truck.id && { color: '#1B4D3E', fontWeight: '700' },
                                      isAssignedToOther && { color: '#94A3B8' },
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {truck.plateNumber} — {truck.type}
                                    {isAssignedToOther ? ` (In Use: ${truck.assignedDriverName || 'Driver'})` : ''}
                                  </Text>
                                </View>
                                {selectedTruckId === truck.id && (
                                  <MaterialIcons name="check" size={16} color="#059669" />
                                )}
                              </View>
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </ScrollView>
                  </View>
                )}
              </View>
              <Text style={styles.helperText}>Syncs routes and telemetry for this vehicle</Text>
            </View>
          </View>
        </View>

        {/* Submission Action */}
        <View style={styles.submitSection}>
          <TouchableOpacity
            style={[styles.submitBtn, (isSubmitting || isReadOnly) && styles.submitBtnDisabled]}
            onPress={handleCompleteOnboarding}
            disabled={isSubmitting || isReadOnly}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.submitBtnText}>Saving Driver Profile...</Text>
              </View>
            ) : (
              <>
                <MaterialIcons
                  name={mode === 'create' ? 'how-to-reg' : (foundUser?.role === 'driver' ? 'save' : 'upgrade')}
                  size={20}
                  color="#FFFFFF"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.submitBtnText}>
                  {mode === 'create'
                    ? 'Complete Driver Onboarding'
                    : (foundUser?.role === 'driver' ? 'Save Driver Changes & Reassign' : 'Promote & Assign Driver')}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Success Confirmation Modal */}
      {successModalData && (
        <Modal visible={true} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalSuccessIconBadge}>
                <MaterialIcons name="check-circle" size={48} color="#059669" />
              </View>

              <Text style={styles.modalTitle}>
                {successModalData.isDriverUpdate
                  ? 'Driver Profile Updated Successfully!'
                  : (successModalData.mode === 'create' ? 'Driver Onboarded Successfully!' : 'Resident Promoted to Driver!')}
              </Text>
              <Text style={styles.modalSubtitle}>
                {successModalData.isDriverUpdate
                  ? 'Driver assignment, barangay, and truck details have been updated.'
                  : (successModalData.mode === 'create'
                    ? 'The driver profile has been created and credentials have been dispatched.'
                    : 'The resident account has been upgraded to official driver status.')}
              </Text>

              <View style={styles.modalSummaryBox}>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>Full Name:</Text>
                  <Text style={styles.modalSummaryValue}>{successModalData.name}</Text>
                </View>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>Employee ID:</Text>
                  <Text style={styles.modalSummaryValue}>{successModalData.employeeId}</Text>
                </View>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>License No:</Text>
                  <Text style={styles.modalSummaryValue}>{successModalData.licenseNumber}</Text>
                </View>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>Assigned Barangay:</Text>
                  <Text style={[styles.modalSummaryValue, { color: '#059669', fontWeight: '800' }]}>
                    Brgy. {successModalData.barangay}
                  </Text>
                </View>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>Login Email:</Text>
                  <Text style={styles.modalSummaryValue}>{successModalData.email}</Text>
                </View>
                <View style={[styles.modalSummaryRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.modalSummaryLabel}>Assigned Truck:</Text>
                  <Text style={styles.modalSummaryValue}>{successModalData.truck}</Text>
                </View>
              </View>

              {/* Generated Driver QR Code Badge Preview */}
              <View style={styles.modalQrPreviewContainer}>
                <View style={styles.modalQrBox}>
                  <QRCode
                    value={encodeDriverQrString(buildDriverQrPayload({
                      uid: successModalData.uid || 'DRV',
                      email: successModalData.email || '',
                      employeeId: successModalData.employeeId || '',
                      name: successModalData.name || '',
                      qrLoginToken: successModalData.qrLoginToken || '',
                      assignedBarangay: successModalData.barangay,
                      plateNumber: successModalData.truck,
                    }))}
                    size={140}
                    color="#0F172A"
                    backgroundColor="#FFFFFF"
                  />
                </View>
                <Text style={styles.modalQrCaption}>
                  Official Driver Login QR Code (Scan to Sign In)
                </Text>
                <TouchableOpacity
                  style={styles.modalViewFullBadgeBtn}
                  onPress={() => setShowFullQrBadgeModal(true)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="badge" size={17} color="#065F46" />
                  <Text style={styles.modalViewFullBadgeBtnText}>View & Print Full Driver Badge</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.modalDoneBtn}
                onPress={() => {
                  setSuccessModalData(null);
                  if (onClose) onClose();
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.modalDoneBtnText}>Done & Return</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Full Driver QR Badge Modal */}
      <DriverQrBadgeModal
        visible={showFullQrBadgeModal}
        onClose={() => setShowFullQrBadgeModal(false)}
        driverData={successModalData}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 20,
  },
  contentWrapper: {
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    marginBottom: 16,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
    letterSpacing: -0.5,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1.5,
  },
  feedbackBannerError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  feedbackBannerSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  feedbackBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  feedbackBannerTextError: {
    color: '#B91C1C',
  },
  feedbackBannerTextSuccess: {
    color: '#065F46',
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 18,
    maxWidth: 440,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 9,
  },
  toggleBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  toggleTextActive: {
    color: '#1B4D3E',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 18,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 16,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 14,
  },
  formGroup: {
    flex: 1,
    marginBottom: 6,
  },
  formGroupFull: {
    width: '100%',
    marginTop: 10,
    marginBottom: 4,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 24,
    marginBottom: 6,
  },
  label: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.3,
  },
  npdlBadge: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  npdlBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#065F46',
  },
  requiredAsterisk: {
    color: '#DC2626',
    fontWeight: '800',
  },
  input: {
    height: 44,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13.5,
    color: '#0F172A',
    ...Platform.select({
      web: { outlineStyle: 'none' } as any,
    }),
  },
  inputErrorBorder: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  compoundInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  compoundPrefixBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    height: '100%',
    justifyContent: 'center',
    borderRightWidth: 1.5,
    borderRightColor: '#E2E8F0',
  },
  compoundPrefixText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1B4D3E',
    letterSpacing: 0.2,
  },
  ltoPrefixBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    height: '100%',
    justifyContent: 'center',
    borderRightWidth: 1.5,
    borderRightColor: '#E2E8F0',
  },
  ltoPrefixText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1B4D3E',
    letterSpacing: 0.5,
  },
  compoundInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 12,
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
    ...Platform.select({
      web: { outlineStyle: 'none' } as any,
    }),
  },
  passwordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  passwordField: {
    flex: 1,
    height: '100%',
    fontSize: 13.5,
    color: '#0F172A',
    ...Platform.select({
      web: { outlineStyle: 'none' } as any,
    }),
  },
  passwordEyeBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  autoGenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  autoGenBtnText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#059669',
  },
  helperText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 4,
  },
  errorHelperText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
    marginTop: 4,
  },
  boldText: {
    fontWeight: '700',
    color: '#1B4D3E',
  },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  countryPickerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    height: '100%',
    borderRightWidth: 1.5,
    borderRightColor: '#E2E8F0',
    gap: 4,
  },
  flagEmoji: {
    fontSize: 15,
  },
  countryCodeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  phoneNumberInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 14,
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0F172A',
    ...Platform.select({
      web: { outlineStyle: 'none' } as any,
    }),
  },
  phoneClearBtn: {
    padding: 10,
    marginRight: 4,
  },
  upgradeSection: {
    width: '100%',
  },
  searchContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    zIndex: 2,
  },
  foundUserCard: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
  },
  foundUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  foundUserName: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#065F46',
  },
  foundUserEmail: {
    fontSize: 12.5,
    color: '#047857',
    marginTop: 1,
  },
  foundUserMeta: {
    fontSize: 11.5,
    color: '#059669',
    marginTop: 3,
  },
  removeUserBtn: {
    padding: 6,
  },
  residentsListContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  listHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#F1F5F9',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  residentsScroll: {
    maxHeight: 180,
  },
  residentListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  avatarBadgeSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarTextSmall: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#475569',
  },
  residentListName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  residentListEmail: {
    fontSize: 12,
    color: '#64748B',
  },
  selectResidentBadge: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  selectResidentText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
  },
  noResidentsText: {
    padding: 16,
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 13,
  },
  assignmentRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
  },
  dropdown: {
    height: 44,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  dropdownMenu: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    zIndex: 100,
    maxHeight: 180,
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownItemText: {
    fontSize: 12.5,
    color: '#334155',
  },
  infoCallout: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 12,
  },
  infoCalloutTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  infoCalloutText: {
    fontSize: 11,
    color: '#047857',
    marginTop: 2,
    lineHeight: 15,
  },
  submitSection: {
    alignItems: 'flex-end',
    marginBottom: 40,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1B4D3E',
    paddingHorizontal: 26,
    paddingVertical: 13,
    borderRadius: 11,
    shadowColor: '#1B4D3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  modalSuccessIconBadge: {
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  modalSummaryBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginVertical: 18,
  },
  modalSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalSummaryLabel: {
    fontSize: 12.5,
    color: '#64748B',
    fontWeight: '600',
  },
  modalSummaryValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalDoneBtn: {
    width: '100%',
    backgroundColor: '#1B4D3E',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDoneBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  modalQrPreviewContainer: {
    alignItems: 'center',
    marginBottom: 16,
    width: '100%',
  },
  modalQrBox: {
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  modalQrCaption: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
  },
  modalViewFullBadgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  modalViewFullBadgeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  roleBadgeSmall: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleBadgeSmallText: {
    fontSize: 10,
    fontWeight: '700',
  },
  dropdownSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginHorizontal: 8,
    marginVertical: 6,
    gap: 6,
  },
  dropdownSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#111827',
    paddingVertical: 2,
  },
  scheduledBadgeMini: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  scheduledBadgeMiniText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#166534',
  },
});
