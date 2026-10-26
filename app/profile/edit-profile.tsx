import { useAuthContext } from '@/components/AuthContext';
import { auth, db } from '@/config/firebase';
import { Colors } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { isImageFile } from '@/utils/cloudinaryHelpers';
import { Stack, useRouter } from 'expo-router';
import {
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signOut,
} from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export default function EditProfileScreen() {
  const { theme } = useTheme();
  const colors = Colors[theme ?? 'light'];
  const { user } = useAuthContext();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const deleteAbortRef = useRef(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCancelDeletion = () => {
    deleteAbortRef.current = true;
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setDeleting(false);
    setDeletePassword('');
    setShowPasswordModal(false);
  };

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [gender, setGender] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [email, setEmail] = useState('');
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Password confirmation modal for account deletion
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePasswordText, setShowDeletePasswordText] = useState(false);

  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user || !db) {
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const userData = userSnap.data();
          const displayName = userData.displayName || user.displayName || '';
          const nameParts = displayName.split(' ');

          setFirstName(nameParts[0] || '');
          setLastName(nameParts.slice(1).join(' ') || '');
          setPhoneNumber(userData.phoneNumber || '');
          setGender(userData.gender || '');
          setDateOfBirth(userData.dateOfBirth || '');
          if (userData.dateOfBirth) {
            const dateParts = userData.dateOfBirth.split('/');
            if (dateParts.length === 3) {
              setSelectedDate(new Date(dateParts[2], dateParts[0] - 1, dateParts[1]));
            }
          }
          setEmail(userData.email || user.email || '');
          setPhotoURL(userData.photoURL || user.photoURL || null);
        } else {
          const displayName = user.displayName || '';
          const nameParts = displayName.split(' ');

          setFirstName(nameParts[0] || '');
          setLastName(nameParts.slice(1).join(' ') || '');
          setEmail(user.email || '');
          setPhotoURL(user.photoURL || null);
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, [user]);

  const handleUpdateProfile = async () => {
    if (!user || !db) return;

    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Error', 'Please enter both first and last name');
      return;
    }

    setSaving(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName: `${firstName.trim()} ${lastName.trim()}`,
        phoneNumber: phoneNumber.trim(),
        gender: gender.trim(),
        dateOfBirth: dateOfBirth.trim(),
        photoURL: photoURL || '',
        updatedAt: new Date(),
      });

      Alert.alert('Success', 'Profile updated successfully!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Gallery permission is required to select photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });

    if (!result.canceled && result.assets && result.assets[0]) {
      const asset = result.assets[0];
      const check = isImageFile(asset);
      if (!check.isValid) {
        Alert.alert('Invalid File', check.error || 'Only image files (JPG, PNG, WebP, etc.) are allowed.');
        return;
      }
      setPhotoURL(asset.uri);
    }
  };

  const handleDateChange = (event: any, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }

    if (date) {
      setSelectedDate(date);
      const formattedDate = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(
        date.getDate()
      ).padStart(2, '0')}/${date.getFullYear()}`;
      setDateOfBirth(formattedDate);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of TrashTrack?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            if (auth) await signOut(auth);
            try {
              await AsyncStorage.clear();
            } catch {}
            router.replace('/(auth)/login' as any);
          } catch (e: any) {
            Alert.alert('Sign Out Failed', e.message || 'Could not sign out.');
          }
        },
      },
    ]);
  };

  // 1. Initial Delete Account confirmation
  const handleDeleteAccountPress = () => {
    Alert.alert(
      'Delete TrashTrack Account?',
      'This will permanently delete your resident account, registered information, and eco activity points from TrashTrack Danao City.\n\nThis action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue to Delete',
          style: 'destructive',
          onPress: () => {
            const isPasswordAccount =
              Array.isArray(user?.providerData) &&
              user.providerData.some((p) => p.providerId === 'password');

            if (isPasswordAccount && user?.email) {
              setDeletePassword('');
              setShowPasswordModal(true);
            } else {
              // OAuth account (Google, etc.) or no password provider
              Alert.alert(
                'Final Confirmation',
                'Are you sure you want to permanently erase your profile and credentials?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Permanently Erase',
                    style: 'destructive',
                    onPress: () => executeAccountDeletion(),
                  },
                ]
              );
            }
          },
        },
      ]
    );
  };

  // 2. Execute Permanent Deletion from Firestore and Firebase Authentication
  const executeAccountDeletion = async (password?: string) => {
    const currentUser = auth?.currentUser || user;
    if (!currentUser) {
      Alert.alert('Error', 'No authenticated session found.');
      return;
    }

    deleteAbortRef.current = false;
    setDeleting(true);
    try {
      // 1.5-second cancellation grace window: allows user to cancel if tapped accidentally
      await new Promise<void>((resolve, reject) => {
        deleteTimerRef.current = setTimeout(() => {
          if (deleteAbortRef.current) {
            reject(new Error('DELETION_ABORTED'));
          } else {
            resolve();
          }
        }, 1500);
      });

      if (deleteAbortRef.current) {
        setDeleting(false);
        return;
      }

      // Re-authenticate if password was supplied
      if (password && currentUser.email) {
        const credential = EmailAuthProvider.credential(currentUser.email, password);
        await reauthenticateWithCredential(currentUser as any, credential);
      }

      if (deleteAbortRef.current) {
        setDeleting(false);
        return;
      }

      const uid = currentUser.uid;

      // Step A: Delete user subcollections and profile document from Firestore while authenticated
      if (db) {
        try {
          // Delete registered FCM device tokens in /users/{uid}/devices
          const devicesSnap = await getDocs(collection(db, 'users', uid, 'devices'));
          for (const d of devicesSnap.docs) {
            if (deleteAbortRef.current) {
              setDeleting(false);
              return;
            }
            await deleteDoc(d.ref);
          }
          if (deleteAbortRef.current) {
            setDeleting(false);
            return;
          }
          await deleteDoc(doc(db, 'users', uid));
          console.log(`✅ [User Deletion] Deleted Firestore profile & devices: /users/${uid}`);
        } catch (fsErr: any) {
          console.warn('Firestore deletion warning:', fsErr.message);
        }
      }

      if (deleteAbortRef.current) {
        setDeleting(false);
        return;
      }

      // Step B: Clear local cache & tokens
      try {
        await AsyncStorage.clear();
      } catch {}

      // Step C: Permanently delete account from Firebase Authentication
      await deleteUser(currentUser as any);
      console.log(`✅ [User Deletion] Successfully removed user ${uid} from Firebase Auth.`);

      // Step D: Sign out and exit
      try {
        if (auth) await signOut(auth);
      } catch {}

      setShowPasswordModal(false);

      Alert.alert(
        'Account Deleted',
        'Your TrashTrack account and personal profile have been permanently deleted from Danao City records.',
        [
          {
            text: 'OK',
            onPress: () => {
              router.replace('/(auth)/login' as any);
            },
          },
        ]
      );
    } catch (err: any) {
      if (err?.message === 'DELETION_ABORTED' || deleteAbortRef.current) {
        console.log('Account deletion was cancelled.');
        setDeleting(false);
        setShowPasswordModal(false);
        return;
      }
      console.error('Account deletion error:', err);
      if (['auth/wrong-password', 'auth/invalid-credential'].includes(err?.code)) {
        Alert.alert('Incorrect Password', 'The password you entered is incorrect. Please try again.');
      } else if (err?.code === 'auth/requires-recent-login') {
        setShowPasswordModal(false);
        Alert.alert(
          'Recent Login Required',
          'For your security, please sign out, log back in, and retry deleting your account.'
        );
      } else {
        Alert.alert(
          'Deletion Error',
          err.message || 'We could not complete your account deletion. Please try again.'
        );
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.background }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Edit Profile</Text>
          <View style={{ width: 24 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={{ paddingBottom: 60 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Profile Photo */}
            <View style={styles.photoSection}>
              <TouchableOpacity onPress={handlePickImage} style={styles.photoContainer}>
                {photoURL ? (
                  <Image source={{ uri: photoURL }} style={styles.profilePhoto} />
                ) : (
                  <View style={[styles.photoPlaceholder, { backgroundColor: colors.primary }]}>
                    <Ionicons name="person" size={50} color={colors.surface} />
                  </View>
                )}
                <View style={styles.cameraBadge}>
                  <Ionicons name="camera" size={14} color="#FFFFFF" />
                </View>
              </TouchableOpacity>
              <Text style={[styles.userName, { color: colors.textPrimary }]}>
                {firstName} {lastName}
              </Text>
              <Text style={[styles.userEmail, { color: colors.textSecondary }]}>{email}</Text>
            </View>

            {/* Form Fields */}
            <View style={styles.formSection}>
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>First Name</Text>
                <TextInput
                  value={firstName}
                  onChangeText={setFirstName}
                  style={[
                    styles.input,
                    { backgroundColor: colors.surface, color: colors.textPrimary },
                  ]}
                  placeholder="First name"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Last Name</Text>
                <TextInput
                  value={lastName}
                  onChangeText={setLastName}
                  style={[
                    styles.input,
                    { backgroundColor: colors.surface, color: colors.textPrimary },
                  ]}
                  placeholder="Last name"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Phone Number</Text>
                <View style={styles.phoneContainer}>
                  <View style={[styles.countryCode, { backgroundColor: colors.surface }]}>
                    <Text style={{ fontSize: 20 }}>🇵🇭</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', marginLeft: 4, color: colors.textPrimary }}>
                      +63
                    </Text>
                  </View>
                  <TextInput
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    style={[
                      styles.phoneInput,
                      { backgroundColor: colors.surface, color: colors.textPrimary },
                    ]}
                    placeholder="912 345 6789"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Gender</Text>
                <TextInput
                  value={gender}
                  onChangeText={setGender}
                  style={[
                    styles.input,
                    { backgroundColor: colors.surface, color: colors.textPrimary },
                  ]}
                  placeholder="Male / Female / Prefer not to say"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Date of Birth</Text>
                <TouchableOpacity
                  onPress={() => setShowDatePicker(true)}
                  style={[
                    styles.input,
                    styles.dropdown,
                    { backgroundColor: colors.surface },
                  ]}
                >
                  <Text
                    style={[
                      styles.dropdownText,
                      { color: dateOfBirth ? colors.textPrimary : colors.textTertiary },
                    ]}
                  >
                    {dateOfBirth || 'MM/DD/YYYY'}
                  </Text>
                  <Ionicons name="calendar-outline" size={20} color={colors.textTertiary} />
                </TouchableOpacity>

                {showDatePicker && (
                  <DateTimePicker
                    value={selectedDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleDateChange}
                    maximumDate={new Date()}
                    minimumDate={new Date(1900, 0, 1)}
                  />
                )}
              </View>
            </View>

            {/* Save Changes Button */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.updateButton, { backgroundColor: colors.primary }]}
                onPress={handleUpdateProfile}
                disabled={saving || deleting}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.surface} />
                ) : (
                  <Text style={[styles.updateButtonText, { color: colors.surface }]}>
                    Save Changes
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Account Settings / Security Options */}
            <View style={styles.sectionDivider} />

            <View style={styles.accountOptionsSection}>
              <Text style={[styles.sectionHeading, { color: colors.textSecondary }]}>
                Account & Security
              </Text>

              <TouchableOpacity
                style={[styles.actionRow, { backgroundColor: colors.surface }]}
                onPress={() => router.push('/profile/change-password' as any)}
              >
                <View style={styles.actionRowLeft}>
                  <View style={[styles.actionIconBg, { backgroundColor: '#ECFDF5' }]}>
                    <Ionicons name="key-outline" size={18} color="#059669" />
                  </View>
                  <Text style={[styles.actionRowText, { color: colors.textPrimary }]}>
                    Change Password
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionRow, { backgroundColor: colors.surface }]}
                onPress={handleSignOut}
              >
                <View style={styles.actionRowLeft}>
                  <View style={[styles.actionIconBg, { backgroundColor: '#F3F4F6' }]}>
                    <Ionicons name="log-out-outline" size={18} color="#4B5563" />
                  </View>
                  <Text style={[styles.actionRowText, { color: colors.textPrimary }]}>
                    Sign Out
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            {/* Manage Account: Delete My Account */}
            <View style={styles.dangerZoneSection}>
              <Text style={styles.dangerZoneHeading}>Manage Account</Text>

              <View style={styles.dangerZoneCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Ionicons name="alert-circle" size={18} color="#DC2626" />
                  <Text style={styles.dangerZoneTitle}>Delete Resident Account</Text>
                </View>
                <Text style={styles.dangerZoneBody}>
                  Permanently erase your TrashTrack resident profile, login credentials, and waste diversion points. This action cannot be reversed.
                </Text>

                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={handleDeleteAccountPress}
                  disabled={deleting}
                >
                  {deleting ? (
                    <ActivityIndicator size="small" color="#DC2626" />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={18} color="#DC2626" />
                      <Text style={styles.deleteButtonText}>Delete My Account</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Password Re-authentication Modal */}
        <Modal
          visible={showPasswordModal}
          transparent
          animationType="fade"
          onRequestClose={handleCancelDeletion}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
              <View style={styles.modalIconBg}>
                <Ionicons name="lock-closed" size={26} color="#DC2626" />
              </View>

              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                Confirm Account Deletion
              </Text>
              <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                Please enter your current password to authorize permanent deletion of your TrashTrack account.
              </Text>

              <View style={styles.passwordInputContainer}>
                <TextInput
                  value={deletePassword}
                  onChangeText={setDeletePassword}
                  secureTextEntry={!showDeletePasswordText}
                  placeholder="Enter current password"
                  placeholderTextColor={colors.textTertiary}
                  style={[
                    styles.modalPasswordInput,
                    { color: colors.textPrimary, borderColor: 'rgba(0,0,0,0.15)' },
                  ]}
                  autoFocus
                  editable={!deleting}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowDeletePasswordText(!showDeletePasswordText)}
                >
                  <Ionicons
                    name={showDeletePasswordText ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[
                    styles.modalCancelButton, 
                    { 
                      borderColor: deleting ? '#DC2626' : colors.textTertiary,
                      backgroundColor: deleting ? '#FEE2E2' : 'transparent',
                    }
                  ]}
                  onPress={handleCancelDeletion}
                  disabled={false}
                >
                  <Text style={[
                    styles.modalCancelText, 
                    { 
                      color: deleting ? '#DC2626' : colors.textSecondary,
                      fontWeight: deleting ? '700' : '600',
                    }
                  ]}>
                    {deleting ? 'Cancel Deletion' : 'Cancel'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalDeleteButton,
                    !deletePassword.trim() && { opacity: 0.5 },
                  ]}
                  disabled={!deletePassword.trim() || deleting}
                  onPress={() => executeAccountDeletion(deletePassword)}
                >
                  {deleting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalDeleteText}>Delete Account</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: Platform.OS === 'android' ? 44 : 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  backButton: {
    padding: 6,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  photoSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  photoContainer: {
    position: 'relative',
    marginBottom: 12,
  },
  profilePhoto: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  photoPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 13.5,
  },
  formSection: {
    paddingHorizontal: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  phoneContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  countryCode: {
    flexDirection: 'row',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  phoneInput: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownText: {
    fontSize: 15,
  },
  buttonContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  updateButton: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  updateButtonText: {
    fontSize: 15.5,
    fontWeight: '700',
  },
  sectionDivider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginVertical: 20,
    marginHorizontal: 20,
  },
  accountOptionsSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionHeading: {
    fontSize: 12.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    marginBottom: 10,
  },
  actionRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionRowText: {
    fontSize: 14.5,
    fontWeight: '600',
  },
  dangerZoneSection: {
    paddingHorizontal: 20,
    marginBottom: 32,
  },
  dangerZoneHeading: {
    fontSize: 12.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: '#DC2626',
    marginBottom: 10,
  },
  dangerZoneCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    borderRadius: 16,
    padding: 18,
  },
  dangerZoneTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#991B1B',
  },
  dangerZoneBody: {
    fontSize: 13,
    color: '#7F1D1D',
    lineHeight: 18,
    marginBottom: 16,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 12,
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#DC2626',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  modalIconBg: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  passwordInputContainer: {
    width: '100%',
    position: 'relative',
    marginBottom: 20,
  },
  modalPasswordInput: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingRight: 44,
    fontSize: 15,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    top: 12,
    padding: 4,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalDeleteButton: {
    flex: 1.2,
    backgroundColor: '#DC2626',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDeleteText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
