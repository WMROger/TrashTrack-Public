import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { collection, query, where, doc, updateDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { provisionCoordinatorOnSpark } from '@/services/coordinatorProvisioningService';
import ExportModal from './ExportModal';
import { exportReport, ExportFormat } from '@/services/reportExportService';
import { DANAO_CITY_BARANGAYS, mergeDanaoBarangays } from '@/constants/danaoBarangays';

export default function EnvironmentalCoordinatorsTab() {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const [coordinators, setCoordinators] = useState<any[]>([]);
  const [isAddingCoordinator, setIsAddingCoordinator] = useState(false);
  const [mode, setMode] = useState<'create' | 'upgrade'>('create');
  
  // Create State
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newContact, setNewContact] = useState('');
  
  // Upgrade State
  const [searchEmail, setSearchEmail] = useState('');
  const [foundUser, setFoundUser] = useState<any>(null);
  const [residentsList, setResidentsList] = useState<any[]>([]);

  // Coordinator Details
  const [employeeId, setEmployeeId] = useState('');
  const [barangay, setBarangay] = useState('CITY');
  const [zone, setZone] = useState('');
  const [existingBarangays, setExistingBarangays] = useState<string[]>(['CITY', ...DANAO_CITY_BARANGAYS]);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [directorySearch, setDirectorySearch] = useState('');

  useEffect(() => {
    if (!db) return;
    
    // Fetch coordinators
    const qCoordinators = query(collection(db, 'users'), where('role', '==', 'coordinator'));
    const unsubCoordinators = onSnapshot(qCoordinators, (snap) => {
      const list: any[] = [];
      snap.forEach(d => {
        list.push({ id: d.id, ...d.data() });
      });
      setCoordinators(list);
    });

    // Fetch residents for upgrade
    const qUsers = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(qUsers, (snap) => {
      const residents: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.role !== 'admin' && data.role !== 'driver' && data.role !== 'coordinator') {
          residents.push({ id: d.id, ...data });
        }
      });
      setResidentsList(residents);
    });

    // Fetch existing barangays from barangay_schedules
    const unsubSchedules = onSnapshot(collection(db, 'barangay_schedules'), (snap) => {
      const brgys = new Set<string>();
      snap.forEach(d => {
        const data = d.data();
        if (data.barangayName) brgys.add(data.barangayName);
      });
      const brgyList = ['CITY', ...mergeDanaoBarangays(Array.from(brgys))];
      setExistingBarangays(brgyList);
      if (brgyList.length > 0 && !barangay) {
        setBarangay(brgyList[0]);
      }
    });

    return () => {
      unsubCoordinators();
      unsubUsers();
      unsubSchedules();
    };
  }, []);

  const handleCompleteOnboarding = async () => {
    if (!employeeId || !barangay) {
      Alert.alert('Validation Error', 'Please fill in the Employee ID and Barangay.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'create') {
        if (!newEmail || !newPassword || !newFullName || !newContact) {
          Alert.alert('Validation Error', 'Please fill in Email, Password, Full Name, and Contact Number for the new coordinator.');
          setIsSubmitting(false);
          return;
        }
        if (newPassword.length < 8 || newPassword.length > 24) {
          Alert.alert('Validation Error', 'Temporary password must be 8 to 24 characters.');
          setIsSubmitting(false);
          return;
        }

        await provisionCoordinatorOnSpark({
          mode: 'create', email: newEmail, password: newPassword, fullName: newFullName,
          contactInfo: newContact, employeeId, barangay, zone,
        });
      } else {
        if (!foundUser) {
          Alert.alert('Validation Error', 'Please search and select a resident to upgrade.');
          setIsSubmitting(false);
          return;
        }

        await provisionCoordinatorOnSpark({
          mode: 'upgrade', existingUserId: foundUser.id,
          fullName: foundUser.displayName || foundUser.name || foundUser.email || 'Coordinator',
          contactInfo: foundUser.contactInfo, employeeId, barangay, zone,
        });
      }

      Alert.alert('Success', mode === 'create'
        ? 'Coordinator created. A verification link was sent before first sign-in.'
        : 'Resident account successfully upgraded to coordinator.');
      
      // Reset form and go back
      setNewEmail('');
      setNewPassword('');
      setNewFullName('');
      setNewContact('');
      setSearchEmail('');
      setFoundUser(null);
      setEmployeeId('');
      setBarangay('');
      setZone('');
      setIsAddingCoordinator(false);
      
    } catch (e: any) {
      console.error('Onboarding Error:', e);
      Alert.alert('Error', e.message || 'Failed to complete onboarding.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async (userId: string) => {
    const executeRevoke = async () => {
      try {
        await updateDoc(doc(db, 'users', userId), {
          role: 'user',
          updatedAt: serverTimestamp(),
        });
        if (Platform.OS === 'web') window.alert('Coordinator demoted successfully.');
        else Alert.alert('Success', 'Coordinator demoted successfully.');
      } catch (error) {
        console.error(error);
        if (Platform.OS === 'web') window.alert('Failed to demote coordinator.');
        else Alert.alert('Error', 'Failed to demote coordinator.');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Confirm Revoke: Are you sure you want to demote this coordinator back to a resident?')) {
        executeRevoke();
      }
    } else {
      Alert.alert(
        'Confirm Revoke',
        'Are you sure you want to demote this coordinator back to a resident?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Revoke', 
            style: 'destructive',
            onPress: executeRevoke
          }
        ]
      );
    }
  };

  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);

  const handleResendCoordinatorEmail = async (coord: any) => {
    if (!coord.email) {
      if (Platform.OS === 'web') window.alert('This coordinator account does not have a registered email address.');
      else Alert.alert('Missing Email', 'This coordinator account does not have a registered email address.');
      return;
    }
    setSendingEmailId(coord.id);
    try {
      const { sendCoordinatorWelcomeEmail } = await import('@/services/emailNotificationService');
      await sendCoordinatorWelcomeEmail({
        toEmail: coord.email,
        coordinatorName: coord.displayName || coord.name || 'Barangay Coordinator',
        employeeId: coord.employeeId || 'COORD',
        barangay: coord.barangay || coord.assignedBarangay || 'Danao City',
        zone: coord.zone || 'Standard',
      });
      if (Platform.OS === 'web') {
        window.alert(`Official credentials and clearance email sent to ${coord.email}!`);
      } else {
        Alert.alert('Email Dispatched', `Official credentials and clearance email sent to ${coord.email}!`);
      }
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(`Error dispatching email: ${e?.message || 'Unknown error'}`);
      else Alert.alert('Error', e?.message || 'Failed to dispatch email.');
    } finally {
      setSendingEmailId(null);
    }
  };

  const filteredCoordinators = coordinators.filter(row => {
    const search = directorySearch.trim().toLowerCase();
    if (!search) return true;
    return [row.displayName, row.email, row.employeeId, row.barangay, row.zone]
      .some(value => String(value || '').toLowerCase().includes(search));
  });

  const [isExportModalVisible, setIsExportModalVisible] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    const headers = [
      'Full Name',
      'Email Address',
      'Employee ID',
      'Assigned Barangay',
      'Zone / District',
      'Contact Number',
      'Account Status',
    ];
    const rows = filteredCoordinators.map((row) => [
      row.displayName || 'Unknown',
      row.email || 'N/A',
      row.employeeId || 'N/A',
      row.barangay || 'Danao City',
      row.zone || 'N/A',
      row.contactInfo || row.phoneNumber || 'N/A',
      row.status || 'Active',
    ]);

    await exportReport({
      format,
      filename: `trashtrack-coordinators-${new Date().toISOString().slice(0, 10)}`,
      title: 'Environmental Coordinators Directory',
      subtitle: 'City Environment & Natural Resources Office Field Coordinators',
      jurisdiction: 'City of Danao (All Barangays)',
      headers,
      rows,
      summaryCards: [
        { label: 'Total Coordinators', value: filteredCoordinators.length },
        {
          label: 'Active Coordinators',
          value: filteredCoordinators.filter(
            (c) => (c.status || '').toLowerCase() !== 'inactive'
          ).length,
        },
      ],
      sheetName: 'Coordinators',
    });
  };

  return (
    <ScrollView style={[styles.container, isMobile && { padding: 16 }]}>
      <View style={[styles.headerRow, isMobile && { flexDirection: 'column', gap: 12 }]}>
        <View>
          <Text style={styles.headerTitle}>Environmental Coordinators</Text>
          <Text style={styles.headerDesc}>Manage field leads across urban barangays.</Text>
        </View>
        {!isAddingCoordinator && (
          <View style={[styles.headerActions, isMobile && { flexDirection: 'column', width: '100%', gap: 8 }]}>
            <TouchableOpacity
              style={[styles.outlineBtn, isMobile && { justifyContent: 'center' }]}
              onPress={() => setIsExportModalVisible(true)}
            >
              <MaterialIcons name="file-download" size={18} color="#059669" />
              <Text style={[styles.outlineBtnText, { color: '#065F46' }]}>Export</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, isMobile && { justifyContent: 'center' }]} onPress={() => setIsAddingCoordinator(true)}>
              <MaterialIcons name="person-add" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Add Coordinator</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {isAddingCoordinator ? (
        <View>
          {/* Back button */}
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, alignSelf: 'flex-start' }} onPress={() => setIsAddingCoordinator(false)}>
            <MaterialIcons name="arrow-back" size={20} color="#4B5563" />
            <Text style={{ marginLeft: 8, color: '#4B5563', fontWeight: '500' }}>Back to Coordinators</Text>
          </TouchableOpacity>

          {/* Mode Toggle */}
          <View style={[styles.toggleContainer, isMobile && { flexDirection: 'column', gap: 8, height: 'auto', padding: 4 }]}>
            <TouchableOpacity 
              style={[styles.toggleBtn, mode === 'create' && styles.toggleBtnActive, isMobile && { width: '100%', paddingVertical: 10 }]}
              onPress={() => setMode('create')}
            >
              <Text style={[styles.toggleText, mode === 'create' && styles.toggleTextActive]}>Create New Account</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.toggleBtn, mode === 'upgrade' && styles.toggleBtnActive, isMobile && { width: '100%', paddingVertical: 10 }]}
              onPress={() => setMode('upgrade')}
            >
              <Text style={[styles.toggleText, mode === 'upgrade' && styles.toggleTextActive]}>Upgrade Existing Resident</Text>
            </TouchableOpacity>
          </View>

          {/* Registration / Upgrade Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <MaterialIcons name="person-add" size={20} color="#2E8B57" style={styles.cardIcon} />
                <Text style={styles.cardTitle}>
                  {mode === 'create' ? 'Coordinator Registration' : 'Upgrade Resident'}
                </Text>
              </View>
            </View>

            {mode === 'upgrade' ? (
              <View style={styles.upgradeSection}>
                <View style={[styles.formGroup, { width: '100%', marginBottom: 16 }]}>
                  <Text style={styles.label}>SEARCH RESIDENTS</Text>
                  <View style={styles.searchContainer}>
                    <MaterialIcons name="search" size={20} color="#9CA3AF" style={styles.searchIcon} />
                    <TextInput 
                      style={[styles.input, { paddingLeft: 40, width: '100%' }]} 
                      placeholder="Type name or email to search..." 
                      value={searchEmail}
                      onChangeText={(text) => {
                        setSearchEmail(text);
                        setFoundUser(null);
                      }}
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                {foundUser ? (
                  <View>
                    <View style={styles.foundUserCard}>
                      <View style={styles.foundUserRow}>
                        <View style={styles.avatarBadge}>
                          <Text style={styles.avatarText}>{foundUser.displayName?.substring(0, 2).toUpperCase() || 'NA'}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.foundUserName}>{foundUser.displayName || 'Unknown Name'}</Text>
                          <Text style={styles.foundUserEmail}>{foundUser.email}</Text>
                        </View>
                        <TouchableOpacity onPress={() => setFoundUser(null)}>
                          <MaterialIcons name="close" size={20} color="#6B7280" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 8, fontStyle: 'italic' }}>
                      Selected resident to upgrade.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.residentsListContainer}>
                    <Text style={styles.listHeader}>Available Residents ({residentsList.filter(r => 
                        (r.displayName?.toLowerCase() || '').includes(searchEmail.toLowerCase()) || 
                        (r.email?.toLowerCase() || '').includes(searchEmail.toLowerCase())
                      ).length})</Text>
                    <ScrollView style={styles.residentsScroll} nestedScrollEnabled={true}>
                      {residentsList
                        .filter(r => 
                          (r.displayName?.toLowerCase() || '').includes(searchEmail.toLowerCase()) || 
                          (r.email?.toLowerCase() || '').includes(searchEmail.toLowerCase())
                        )
                        .map(r => (
                          <TouchableOpacity 
                            key={r.id} 
                            style={styles.residentListItem}
                            onPress={() => setFoundUser(r)}
                          >
                            <View style={styles.avatarBadgeSmall}>
                              <Text style={styles.avatarTextSmall}>{r.displayName?.substring(0, 2).toUpperCase() || 'NA'}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.residentListName}>{r.displayName || 'Unknown Name'}</Text>
                              <Text style={styles.residentListEmail}>{r.email}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              {r.role === 'admin' ? (
                                <View style={[styles.roleBadge, { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}><Text style={[styles.roleText, { color: '#B91C1C' }]}>Admin</Text></View>
                              ) : r.role === 'driver' ? (
                                <View style={[styles.roleBadge, { backgroundColor: '#E0F2FE', borderColor: '#BAE6FD' }]}><Text style={[styles.roleText, { color: '#0369A1' }]}>Driver</Text></View>
                              ) : (
                                <View style={[styles.roleBadge, { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' }]}><Text style={[styles.roleText, { color: '#4B5563' }]}>Resident</Text></View>
                              )}
                            </View>
                          </TouchableOpacity>
                        ))
                      }
                      {residentsList.filter(r => 
                          (r.displayName?.toLowerCase() || '').includes(searchEmail.toLowerCase()) || 
                          (r.email?.toLowerCase() || '').includes(searchEmail.toLowerCase())
                        ).length === 0 && (
                          <Text style={{ padding: 16, color: '#6B7280', textAlign: 'center' }}>No residents found matching your search.</Text>
                      )}
                    </ScrollView>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.formGrid}>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>
                    EMAIL ADDRESS (LOGIN) <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <TextInput style={styles.input} placeholder="coordinator@trashtrack.com" value={newEmail} onChangeText={setNewEmail} autoCapitalize="none" />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>
                    TEMPORARY PASSWORD <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <View style={styles.passwordContainer}>
                    <TextInput 
                      style={[styles.input, styles.passwordInput]} 
                      placeholder="8 to 24 characters" 
                      value={newPassword} 
                      onChangeText={setNewPassword} 
                      secureTextEntry={!showPassword} 
                    />
                    <TouchableOpacity 
                      style={styles.eyeIcon} 
                      onPress={() => setShowPassword(!showPassword)}
                    >
                      <MaterialIcons 
                        name={showPassword ? "visibility-off" : "visibility"} 
                        size={20} 
                        color="#6B7280" 
                      />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>
                    FULL NAME <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <TextInput style={styles.input} placeholder="Juan De La Cruz" value={newFullName} onChangeText={setNewFullName} />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>
                    CONTACT INFORMATION <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <View style={styles.phoneInputContainer}>
                    <View style={styles.countryPickerPill}>
                      <Text style={{ fontSize: 14 }}>🇵🇭</Text>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E293B', marginLeft: 4 }}>+63</Text>
                    </View>
                    <TextInput 
                      style={styles.phoneNumberInput} 
                      placeholder="9XX XXX XXXX" 
                      placeholderTextColor="#94A3B8"
                      value={newContact} 
                      onChangeText={(text) => {
                        let digits = text.replace(/\D/g, "");
                        if (digits.startsWith("63")) digits = digits.slice(2);
                        if (digits.startsWith("0")) digits = digits.slice(1);
                        digits = digits.slice(0, 10);
                        let formatted = digits;
                        if (digits.length > 6) {
                          formatted = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
                        } else if (digits.length > 3) {
                          formatted = `${digits.slice(0, 3)} ${digits.slice(3)}`;
                        }
                        setNewContact(formatted);
                      }}
                      keyboardType="phone-pad"
                      maxLength={13}
                    />
                  </View>
                </View>
              </View>
            )}

            <View style={styles.divider} />

            <View style={styles.formGrid}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>
                  EMPLOYEE ID <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <TextInput style={styles.input} placeholder="CENRO-800" value={employeeId} onChangeText={setEmployeeId} />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.label}>
                  BARANGAY <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={barangay}
                    onValueChange={(itemValue) => setBarangay(itemValue)}
                    style={styles.picker}
                  >
                    {existingBarangays.map((brgy) => (
                      <Picker.Item key={brgy} label={brgy === 'CITY' ? 'CITY (City-Wide)' : `Brgy. ${brgy}`} value={brgy} />
                    ))}
                  </Picker>
                </View>
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.label}>ZONE (OPTIONAL)</Text>
                <TextInput style={styles.input} placeholder="Zone 4" value={zone} onChangeText={setZone} />
              </View>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            <TouchableOpacity 
              style={[styles.outlineBtn, { marginRight: 'auto' }]} 
              onPress={() => setIsAddingCoordinator(false)}
            >
              <Text style={styles.outlineBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.primaryBtn} 
              onPress={handleCompleteOnboarding}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="person-add" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>Complete Onboarding</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          <View style={{ height: 40 }} />
        </View>
      ) : (
        <View style={[styles.card, isMobile && { padding: 14 }]}>
          {/* Filters Row */}
          <View style={[styles.filtersRow, isMobile && { flexDirection: 'column', gap: 12, alignItems: 'stretch' }]}>
            <View style={[styles.searchBox, isMobile && { width: '100%' }]}>
              <MaterialIcons name="search" size={20} color="#9CA3AF" />
              <TextInput style={styles.searchInput} placeholder="Search by name, ID, or barangay..." placeholderTextColor="#9CA3AF" value={directorySearch} onChangeText={setDirectorySearch} />
            </View>
            
            <Text style={styles.pageInfo}>{filteredCoordinators.length} matching coordinator{filteredCoordinators.length === 1 ? '' : 's'}</Text>
          </View>

          {/* Table */}
          <ScrollView 
            horizontal={isMobile} 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1, minWidth: '100%' }}
            style={{ width: '100%' }}
          >
            <View style={{ minWidth: isMobile ? 650 : '100%', width: '100%' }}>
              <View style={styles.tableHead}>
                <Text style={[styles.th, { flex: 2 }]}>COORDINATOR</Text>
                <Text style={[styles.th, { flex: 1.5 }]}>BARANGAY</Text>
                <Text style={[styles.th, { flex: 1.5 }]}>CONTACT</Text>
                <Text style={[styles.th, { flex: 1 }]}>STATUS</Text>
                <Text style={[styles.th, { flex: 1.1, textAlign: 'center' }]}>ACTIONS</Text>
              </View>

              {filteredCoordinators.map((row) => {
                const status = row.status || 'CERTIFIED';
                const statusColor = status === 'PENDING' ? '#ef4444' : '#2E8B57';
                const statusBg = status === 'PENDING' ? '#FEF2F2' : '#F6FBF7';

                return (
                <View key={row.id} style={styles.tableRow}>
                  <View style={[styles.td, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
                    <View style={styles.avatarPlaceholder}>
                      <Text style={{ fontWeight: 'bold', color: '#6B7280' }}>
                        {row.displayName?.substring(0, 2).toUpperCase() || 'NA'}
                      </Text>
                    </View>
                    <View>
                      <Text style={styles.coordName}>{row.displayName || 'Unknown'}</Text>
                      <Text style={styles.coordId}>{row.employeeId || 'No ID'}</Text>
                    </View>
                  </View>
                  <View style={[styles.td, { flex: 1.5 }]}>
                    <Text style={styles.brgyName}>{row.barangay || 'CITY'}</Text>
                    <Text style={styles.brgyZone}>{row.zone || ''}</Text>
                  </View>
                  <Text style={[styles.td, { flex: 1.5, color: '#4B5563', fontSize: 13 }]}>{row.contactInfo || row.email || 'N/A'}</Text>
                  <View style={[styles.td, { flex: 1 }]}>
                    <View style={[styles.statusBadge, { borderColor: statusColor, backgroundColor: statusBg }]}>
                      <Text style={[styles.statusText, { color: statusColor }]}>{status}</Text>
                    </View>
                  </View>
                  <View style={[styles.td, { flex: 1.1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]}>
                    <TouchableOpacity
                      onPress={() => handleResendCoordinatorEmail(row)}
                      disabled={sendingEmailId === row.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: '#ECFDF5',
                        borderColor: '#A7F3D0',
                        borderWidth: 1,
                        borderRadius: 6,
                        paddingVertical: 5,
                        paddingHorizontal: 8,
                        gap: 4,
                      }}
                    >
                      {sendingEmailId === row.id ? (
                        <ActivityIndicator size="small" color="#059669" />
                      ) : (
                        <>
                          <MaterialIcons name="email" size={14} color="#059669" />
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#065F46' }}>EMAIL</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleRevoke(row.id)} style={styles.revokeBtn}>
                      <Text style={styles.revokeBtnText}>REVOKE</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                );
              })}

              {filteredCoordinators.length === 0 && (
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: '#6B7280' }}>No coordinators found.</Text>
                </View>
              )}
            </View>
          </ScrollView>

          {filteredCoordinators.length > 0 && (
            <View style={styles.pagination}>
              <Text style={styles.pageInfo}>Showing 1-{filteredCoordinators.length} of {filteredCoordinators.length} coordinators</Text>
              <View style={styles.pageControls}>
                <View style={styles.pageBtnActive}><Text style={styles.pageTextActive}>1</Text></View>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Export Report Modal */}
      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="Environmental Coordinators Directory"
        dataCount={filteredCoordinators.length}
        onExport={handleExport}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB', padding: 32 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#111827', marginBottom: 8 },
  headerDesc: { fontSize: 14, color: '#4B5563' },
  headerActions: { flexDirection: 'row', gap: 16 },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#fff' },
  outlineBtnText: { color: '#374151', fontWeight: '600', fontSize: 14 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#4b6354' },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  card: { backgroundColor: '#fff', borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2, padding: 24 },
  filtersRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, paddingHorizontal: 12, width: 300 },
  searchInput: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 14, color: '#111827' },
  dropdownsContainer: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  dropdown: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', minWidth: 160 },
  dropdownText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  iconBtn: { padding: 10, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, backgroundColor: '#fff' },

  tableHead: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', marginBottom: 8 },
  th: { fontSize: 11, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  td: { justifyContent: 'center' },
  
  avatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  coordName: { fontWeight: '600', color: '#111827', fontSize: 14, marginBottom: 2 },
  coordId: { fontSize: 11, color: '#6B7280' },
  brgyName: { fontWeight: '500', color: '#374151', fontSize: 14, marginBottom: 2 },
  brgyZone: { fontSize: 12, color: '#6B7280' },

  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, alignSelf: 'flex-start' },
  statusText: { fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 },

  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16 },
  pageInfo: { fontSize: 13, color: '#6B7280' },
  pageControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  pageBtnActive: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: '#2E8B57' },
  pageText: { fontSize: 14, color: '#6B7280', fontWeight: '500' },
  pageTextActive: { fontSize: 14, color: '#fff', fontWeight: 'bold' },

  // Form Styles
  toggleContainer: { flexDirection: 'row', backgroundColor: '#E5E7EB', borderRadius: 8, padding: 4, marginBottom: 24, alignSelf: 'flex-start' },
  toggleBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6 },
  toggleBtnActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  toggleText: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  toggleTextActive: { color: '#111827' },

  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardIcon: { marginRight: 4 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827' },
  
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  formGroup: { width: '47%', marginBottom: 16 },
  label: { fontSize: 11, fontWeight: '700', color: '#374151', marginBottom: 8, letterSpacing: 0.5 },
  requiredAsterisk: { color: '#EF4444', fontWeight: 'bold' },
  input: { backgroundColor: '#F9FAFB', borderRadius: 8, padding: 14, fontSize: 14, color: '#111827', borderWidth: 1, borderColor: '#E5E7EB' },
  passwordContainer: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 45 },
  eyeIcon: { position: 'absolute', right: 12, top: 14 },
  
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 24 },
  
  upgradeSection: { marginBottom: 16 },
  foundUserCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F6FBF7', padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#dcfce7', marginTop: 16 },
  foundUserRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  foundUserName: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
  foundUserEmail: { fontSize: 14, color: '#4B5563', marginTop: 2 },

  searchContainer: { position: 'relative', justifyContent: 'center' },
  searchIcon: { position: 'absolute', left: 14, zIndex: 1 },
  residentsListContainer: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, backgroundColor: '#fff', overflow: 'hidden' },
  listHeader: { padding: 12, backgroundColor: '#F9FAFB', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', fontSize: 12, fontWeight: '700', color: '#6B7280' },
  residentsScroll: { maxHeight: 250 },
  residentListItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  avatarBadgeSmall: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarTextSmall: { fontSize: 12, fontWeight: 'bold', color: '#064e3b' },
  residentListName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  residentListEmail: { fontSize: 12, color: '#4B5563' },
  avatarBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: 'bold', color: '#064e3b' },
  
  roleBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  roleText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginBottom: 32 },

  revokeBtn: { paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#FEF2F2', borderRadius: 6, borderWidth: 1, borderColor: '#FECACA' },
  revokeBtnText: { fontSize: 10, color: '#DC2626', fontWeight: 'bold' },
  pickerContainer: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, backgroundColor: '#F9FAFB', overflow: 'hidden' },
  picker: { height: 48, width: '100%', color: '#111827', backgroundColor: 'transparent' },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
  },
  countryPickerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    height: '100%',
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
  },
  phoneNumberInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#111827',
  },
});
