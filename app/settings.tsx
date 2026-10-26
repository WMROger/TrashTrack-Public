import { useAuthContext } from '@/components/AuthContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { UPLOAD_PRESETS } from '@/config/cloudinary';
import { auth, db, storage } from '@/config/firebase';
import { Colors } from '@/constants/Colors';
import { DANAO_CITY_BARANGAYS, mergeDanaoBarangays } from '@/constants/danaoBarangays';
import { useTheme } from '@/hooks/useTheme';
import { writeAuditLog } from '@/services/auditLogService';
import { cloudinaryService, UPLOAD_FOLDERS } from '@/services/cloudinaryService';
import { setFcmPushEnabled } from '@/services/pushTokenService';
import { soundAlertService } from '@/services/soundAlertService';
import { isImageFile } from '@/utils/cloudinaryHelpers';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { deleteUser, EmailAuthProvider, reauthenticateWithCredential, signOut, updatePassword } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SettingsPage() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = Colors[theme ?? 'light'];
  const { user, logout, updateProfile } = useAuthContext();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editMiddleInitial, setEditMiddleInitial] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editPhoneNumber, setEditPhoneNumber] = useState('');
  const [editPhotoURL, setEditPhotoURL] = useState<string | undefined>(user?.photoURL || undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [userProfile, setUserProfile] = useState<{
    displayName?: string;
    photoURL?: string;
    barangay?: string;
    barangayUpdatedAt?: any;
    role?: string;
    assignedBarangay?: string;
    firstName?: string;
    middleInitial?: string;
    lastName?: string;
    phoneNumber?: string;
  } | null>(null);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showBarangayModal, setShowBarangayModal] = useState(false);
  const [editBarangay, setEditBarangay] = useState('');
  const [barangaySearch, setBarangaySearch] = useState('');
  const [availableBarangays, setAvailableBarangays] = useState<string[]>([...DANAO_CITY_BARANGAYS]);
  const [feedbackSelected, setFeedbackSelected] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reportUpdatesEnabled, setReportUpdatesEnabled] = useState(true);
  const [announcementNotificationsEnabled, setAnnouncementNotificationsEnabled] = useState(true);
  const [proximityAlertsEnabled, setProximityAlertsEnabled] = useState(true);
  const [proximityRadiusMeters, setProximityRadiusMeters] = useState(500);
  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState(true);
  const [verifiedRewardCount, setVerifiedRewardCount] = useState(0);
  const [earnedRewardTokens, setEarnedRewardTokens] = useState(0);
  const [redeemedRewardTokens, setRedeemedRewardTokens] = useState(0);
  const router = useRouter();
  const availableRewardTokens = Math.max(0, earnedRewardTokens - redeemedRewardTokens);

  // Account Deletion state
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [showDeletedSuccessModal, setShowDeletedSuccessModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePasswordText, setShowDeletePasswordText] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteAbortRef = useRef(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) {
        clearTimeout(deleteTimerRef.current);
      }
    };
  }, []);

  const currentUser = auth?.currentUser || user;
  const isPasswordAccount =
    Array.isArray(currentUser?.providerData) &&
    currentUser.providerData.some((p: any) => p?.providerId === 'password');

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const getBarangayLockStatus = () => {
    if (!userProfile?.barangay || !userProfile?.barangayUpdatedAt) {
      return { isLocked: false, remainingHours: 0, remainingMinutes: 0, formattedRemaining: '' };
    }
    const raw = userProfile.barangayUpdatedAt;
    const updateTime = raw?.toDate ? raw.toDate().getTime() : (raw ? new Date(raw).getTime() : 0);
    if (!updateTime || isNaN(updateTime)) {
      return { isLocked: false, remainingHours: 0, remainingMinutes: 0, formattedRemaining: '' };
    }
    const elapsed = Date.now() - updateTime;
    if (elapsed >= ONE_DAY_MS) {
      return { isLocked: false, remainingHours: 0, remainingMinutes: 0, formattedRemaining: '' };
    }
    const remainingMs = ONE_DAY_MS - elapsed;
    const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
    const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
    const formattedRemaining = remainingHours > 1 ? `${remainingHours} hrs` : `${remainingMinutes} mins`;
    return { isLocked: true, remainingHours, remainingMinutes, formattedRemaining };
  };

  useEffect(() => {
    if (!user?.uid || !db) return;
    getDoc(doc(db, 'user_settings', user.uid)).then(snapshot => {
      const preferences = snapshot.data()?.notificationPreferences;
      if (!preferences) return;
      setPushEnabled(preferences.pushEnabled !== false);
      setReminderEnabled(preferences.pickupReminders !== false);
      setReportUpdatesEnabled(preferences.reportUpdates !== false);
      setAnnouncementNotificationsEnabled(preferences.announcements !== false);
      setProximityAlertsEnabled(preferences.proximityAlerts !== false);
      setProximityRadiusMeters([250, 500, 1000].includes(preferences.proximityRadiusMeters) ? preferences.proximityRadiusMeters : 500);
      setSoundAlertsEnabled(preferences.soundAlertsEnabled !== false);
    }).catch(error => console.warn('Unable to load notification preferences:', error));
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !db) return;
    const unsubscribeAwards = onSnapshot(
      query(collection(db, 'reward_awards'), where('userId', '==', user.uid)),
      snapshot => {
        setVerifiedRewardCount(snapshot.size);
        setEarnedRewardTokens(snapshot.docs.reduce((sum, item) => sum + Math.max(0, Number(item.data().tokens || 0)), 0));
      },
    );
    const unsubscribeRedemptions = onSnapshot(
      query(collection(db, 'reward_redemptions'), where('userId', '==', user.uid)),
      snapshot => setRedeemedRewardTokens(snapshot.docs.reduce((sum, item) => sum + Math.max(0, Number(item.data().cost || 0)), 0)),
    );
    return () => { unsubscribeAwards(); unsubscribeRedemptions(); };
  }, [user?.uid]);

  const saveNotificationPreferences = async () => {
    if (!user?.uid || !db) return;
    const notificationPreferences = {
      pushEnabled,
      pickupReminders: reminderEnabled,
      reportUpdates: reportUpdatesEnabled,
      announcements: announcementNotificationsEnabled,
      proximityAlerts: proximityAlertsEnabled,
      proximityRadiusMeters,
      soundAlertsEnabled,
    };
    try {
      await soundAlertService.setSoundAlertsEnabled(soundAlertsEnabled);
      await setDoc(doc(db, 'user_settings', user.uid), { notificationPreferences, updatedAt: serverTimestamp() }, { merge: true });
      await setFcmPushEnabled(user.uid, pushEnabled);
      await writeAuditLog('notification.preferences_updated', 'user', user.uid, notificationPreferences);
      setShowNotificationsModal(false);
    } catch {
      Alert.alert('Unable to save', 'Notification preferences could not be updated. Check your connection and try again.');
    }
  };

  // Resolve storage path to public URL if needed
  const resolvePhotoURL = async (maybePath?: string) => {
    try {
      // Resolving photo URL
      if (!maybePath) {
        // No photo path provided
        return undefined;
      }

      // Check for local file paths (these won't work for display)
      const isLocalFile = /^file:\/\//.test(maybePath);
      if (isLocalFile) {
        // Local file path detected, cannot display
        return undefined; // Don't try to display local file paths
      }

      const isHttp = /^https?:\/\//i.test(maybePath);
      const isDataOrLocal = /^(data:|content:|asset(s)?:\/\/|blob:|expo-file:)/i.test(maybePath);

      if (isHttp || isDataOrLocal) {
        // Direct URL found
        return maybePath;
      }

      if (!storage) {
        // Firebase storage not available
        return undefined;
      }

      // Fetching download URL from Firebase Storage
      const r = ref(storage, maybePath);
      const downloadURL = await getDownloadURL(r);
      // Download URL obtained
      return downloadURL;
    } catch (e) {
      // Failed to resolve photo URL
      return undefined;
    }
  };

  // Fetch user profile data from Firestore
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user || !db) {
        // User or DB not available
        return;
      }

      try {
        // Fetching user profile
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const userData = userSnap.data();
          console.log('📄 Firestore user data:', userData);
          console.log('🖼️ PhotoURL from Firestore:', userData.photoURL);
          console.log('🖼️ PhotoURL from Auth:', user.photoURL);

          // Prioritize Cloudinary URLs from Firestore, never fall back to local paths
          let photoURLToUse = userData.photoURL || userData.verificationImageUrl;

          // Check if the Firestore photoURL is a valid Cloudinary/HTTP URL
          const isValidCloudinaryURL = photoURLToUse && (
            photoURLToUse.includes('cloudinary.com') ||
            photoURLToUse.startsWith('https://') ||
            photoURLToUse.startsWith('http://')
          );

          // Only use Firestore photoURL if it's a valid Cloudinary/HTTP URL
          if (!isValidCloudinaryURL) {
            // Check Auth photoURL only if it's a valid Cloudinary/HTTP URL
            const authPhotoURL = user.photoURL;
            const isValidAuthURL = authPhotoURL && (
              authPhotoURL.includes('cloudinary.com') ||
              authPhotoURL.startsWith('https://') ||
              authPhotoURL.startsWith('http://')
            );

            if (isValidAuthURL) {
              photoURLToUse = authPhotoURL;
            } else {
              photoURLToUse = undefined; // No valid URL available, use placeholder
            }
          }

          console.log('🎯 Selected photoURL for resolution:', photoURLToUse);
          const resolved = await resolvePhotoURL(photoURLToUse);
          console.log('✅ Resolved photoURL:', resolved);

          setUserProfile({
            displayName: userData.displayName || user.displayName || 'User',
            photoURL: resolved,
            barangay: userData.barangay || '',
            barangayUpdatedAt: userData.barangayUpdatedAt || null,
            role: userData.role || 'user',
            assignedBarangay: userData.assignedBarangay || '',
            firstName: userData.firstName || '',
            middleInitial: userData.middleInitial || '',
            lastName: userData.lastName || '',
            phoneNumber: userData.phoneNumber || userData.contactInfo || '',
          });
        } else {
          console.log('❌ No Firestore document found, checking auth data');
          // Only use auth photoURL if it's a valid Cloudinary/HTTP URL
          const authPhotoURL = user.photoURL;
          const isValidAuthURL = authPhotoURL && (
            authPhotoURL.includes('cloudinary.com') ||
            authPhotoURL.startsWith('https://') ||
            authPhotoURL.startsWith('http://')
          );

          const photoURLToUse = isValidAuthURL ? authPhotoURL : undefined;
          const resolved = await resolvePhotoURL(photoURLToUse);
          console.log('✅ Fallback resolved photoURL:', resolved);

          setUserProfile({
            displayName: user.displayName || 'User',
            photoURL: resolved,
          });
        }
      } catch (error) {
        // Error fetching user profile
        // Only use auth photoURL if it's a valid Cloudinary/HTTP URL
        const authPhotoURL = user?.photoURL;
        const isValidAuthURL = authPhotoURL && (
          authPhotoURL.includes('cloudinary.com') ||
          authPhotoURL.startsWith('https://') ||
          authPhotoURL.startsWith('http://')
        );

        const photoURLToUse = isValidAuthURL ? authPhotoURL : undefined;
        const resolved = await resolvePhotoURL(photoURLToUse);
        console.log('✅ Error fallback resolved photoURL:', resolved);

        setUserProfile({
          displayName: user.displayName || 'User',
          photoURL: resolved,
        });
      }
    };

    const fetchBarangays = async () => {
      try {
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

    fetchUserProfile();
    fetchBarangays();
  }, [user]);

  const handleLogout = () => {
    console.log('Logout button pressed');
    setLogoutError(null);
    setShowLogoutModal(true);
    console.log('Modal should now be visible:', true);
  };

  const cancelLogout = () => {
    setShowLogoutModal(false);
    setLogoutError(null);
  };

  const confirmLogout = async () => {
    setLogoutError(null);
    setIsLoggingOut(true);
    try {
      await logout();
      setShowLogoutModal(false);
    } catch (e: any) {
      setLogoutError(e?.message || 'Logout failed');
    } finally {
      setIsLoggingOut(false);
    }
  };



  const handleEditProfile = () => {
    setIsEditMode(true);

    let fn = (userProfile?.firstName || '').trim();
    let mi = (userProfile?.middleInitial || '').trim();
    let ln = (userProfile?.lastName || '').trim();

    // If firstName/lastName are not yet populated separately, parse existing displayName (e.g. "luthar 1. james")
    if (!fn && !ln) {
      const rawName = (userProfile?.displayName || user?.displayName || '').trim();
      const parts = rawName.split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        fn = parts[0];
      } else if (parts.length === 2) {
        fn = parts[0];
        ln = parts[1];
      } else if (parts.length >= 3) {
        fn = parts[0];
        if (parts[1].length <= 2) {
          mi = parts[1].replace(/\./g, '');
          ln = parts.slice(2).join(' ');
        } else {
          fn = parts.slice(0, parts.length - 1).join(' ');
          ln = parts[parts.length - 1];
        }
      }
    }

    setEditFirstName(fn);
    setEditMiddleInitial(mi);
    setEditLastName(ln);
    setEditPhoneNumber(userProfile?.phoneNumber || '');

    const currentPhotoURL = userProfile?.photoURL || user?.photoURL || undefined;
    if (currentPhotoURL && currentPhotoURL.startsWith('file://')) {
      setEditPhotoURL(undefined);
    } else {
      setEditPhotoURL(currentPhotoURL);
    }
  };

  const handleCancelEdit = () => {
    setIsEditMode(false);
    setEditFirstName('');
    setEditMiddleInitial('');
    setEditLastName('');
    setEditPhoneNumber('');

    const currentPhotoURL = userProfile?.photoURL || user?.photoURL || undefined;
    if (currentPhotoURL && currentPhotoURL.startsWith('file://')) {
      setEditPhotoURL(undefined);
    } else {
      setEditPhotoURL(currentPhotoURL);
    }
  };

  const handleSaveProfile = async () => {
    const fn = editFirstName.trim();
    const mi = editMiddleInitial.trim().replace(/\./g, '').toUpperCase();
    const ln = editLastName.trim();
    const phone = editPhoneNumber.trim();

    if (!fn && !ln) {
      Alert.alert('Required Name', 'Please enter at least your first or last name.');
      return;
    }

    setIsSaving(true);
    try {
      if (editPhotoURL && editPhotoURL.startsWith('file://')) {
        Alert.alert('Error', 'Cannot save local file path. Please wait for image upload to complete or select a new image.');
        setIsSaving(false);
        return;
      }

      const formattedDisplayName = `${fn}${mi ? ` ${mi}.` : ''}${ln ? ` ${ln}` : ''}`.trim();

      await updateProfile({
        displayName: formattedDisplayName,
        photoURL: editPhotoURL,
        firstName: fn,
        middleInitial: mi,
        lastName: ln,
        phoneNumber: phone,
      });

      if (db && user?.uid) {
        const userRef = doc(db, 'users', user.uid);
        await setDoc(
          userRef,
          {
            displayName: formattedDisplayName,
            name: formattedDisplayName,
            ...(editPhotoURL !== undefined ? { photoURL: editPhotoURL } : {}),
            firstName: fn,
            middleInitial: mi,
            lastName: ln,
            phoneNumber: phone,
            contactInfo: phone,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      setUserProfile(prev => ({
        ...(prev || {}),
        displayName: formattedDisplayName,
        photoURL: editPhotoURL,
        firstName: fn,
        middleInitial: mi,
        lastName: ln,
        phoneNumber: phone,
      }));

      Alert.alert('Success', 'Profile updated successfully');
      setIsEditMode(false);
    } catch (err: any) {
      console.error('❌ Profile update error:', err);
      let errorMessage = 'Failed to update profile';
      if (err?.code === 'auth/invalid-profile-attribute') {
        errorMessage = 'Profile photo URL is too long. Please try with a different image.';
      } else if (err?.message) {
        errorMessage = err.message;
      }
      Alert.alert('Error', errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const pickImage = async () => {
    const mediaTypes = (ImagePicker as any).MediaType
      ? (ImagePicker as any).MediaType.image
      : ((ImagePicker as any).MediaTypeOptions?.Images ?? ImagePicker.MediaTypeOptions.Images);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaTypes as any,
      allowsEditing: true,
      quality: 0.7,
      base64: Platform.OS === 'web',
    } as any);
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset: any = result.assets[0];
      const check = isImageFile(asset);
      if (!check.isValid) {
        Alert.alert('Invalid File', check.error || 'Only image files (JPG, PNG, WebP, etc.) are allowed.');
        return;
      }
      const selectedImageUri = asset.uri;

      // Check if the URI is too long for Firebase Auth
      if (selectedImageUri.length > 2000) {
        Alert.alert(
          'Image URL Too Long',
          'The selected image URL is too long for Firebase Auth. The image will be saved to your profile but may not appear in Firebase Auth. Consider using a different image or uploading to a cloud service.'
        );
      }

      let uploadSource = selectedImageUri;
      if (asset.base64) {
        const mime = asset.mimeType || 'image/jpeg';
        const dataUrl = `data:${mime};base64,${asset.base64}`;
        uploadSource = dataUrl;
      }

      try {
        console.log('🔄 Uploading image to Cloudinary...');
        // Don't set any URL until upload completes
        const result = await cloudinaryService.uploadImage(uploadSource, { folder: UPLOAD_FOLDERS.PROFILES, preset: UPLOAD_PRESETS.PROFILES });
        if (result.success && result.url) {
          console.log('✅ Cloudinary upload successful:', result.url);
          setEditPhotoURL(result.url); // Only set the Cloudinary URL
        } else {
          console.error('❌ Cloudinary upload failed:', result.error);
          Alert.alert('Upload Error', result.error || 'Failed to upload profile image.');
          // Keep the previous photo URL on failure
        }
      } catch (err) {
        console.error('❌ Cloudinary upload error:', err);
        Alert.alert('Upload Error', 'Failed to upload profile image.');
        // Keep the previous photo URL on failure
      }
    }
  };

  const handleChangePassword = () => {
    setShowChangePassword(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleCancelChangePassword = () => {
    setShowChangePassword(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  const validatePassword = (password: string) => {
    if (password.length < 8) {
      return 'Password must be at least 8 characters long';
    }
    if (!/(?=.*[a-z])/.test(password)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/(?=.*[A-Z])/.test(password)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/(?=.*\d)/.test(password)) {
      return 'Password must contain at least one number';
    }
    if (!/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`])/.test(password)) {
      return 'Password must contain at least one special character';
    }
    return null;
  };

  const handleSavePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all password fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      Alert.alert('Password Requirements', passwordError);
      return;
    }

    setIsChangingPassword(true);
    try {
      if (!auth || !user?.email) {
        throw new Error('Authentication not available');
      }

      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);

      // Update password
      await updatePassword(user, newPassword);

      Alert.alert('Success', 'Password updated successfully');
      handleCancelChangePassword();
    } catch (error: any) {
      console.error('Password change error:', error);
      let errorMessage = 'Failed to change password';

      if (error?.code === 'auth/wrong-password') {
        errorMessage = 'Current password is incorrect';
      } else if (error?.code === 'auth/weak-password') {
        errorMessage = 'New password is too weak';
      } else if (error?.code === 'auth/requires-recent-login') {
        errorMessage = 'Please log out and log back in before changing your password';
      } else if (error?.message) {
        errorMessage = error.message;
      }

      Alert.alert('Error', errorMessage);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSaveBarangay = async () => {
    const targetUid = auth?.currentUser?.uid || user?.uid;
    if (!auth || !targetUid) {
      Alert.alert('Session Error', 'User session not found. Please log in again.');
      return;
    }
    const lockStatus = getBarangayLockStatus();
    if (lockStatus.isLocked && editBarangay !== userProfile?.barangay) {
      Alert.alert(
        'Barangay Locked',
        `You can only change your registered barangay once every 24 hours. Remaining lock time: ${lockStatus.formattedRemaining}.`
      );
      return;
    }
    if (!editBarangay.trim()) {
      Alert.alert('Selection Required', 'Please select a barangay.');
      return;
    }
    setIsSaving(true);
    try {
      const userRef = doc(db, 'users', targetUid);
      const now = new Date();
      try {
        await updateDoc(userRef, {
          barangay: editBarangay,
          barangayUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (updateErr: any) {
        // If document doesn't exist yet in Firestore, create/merge initial profile safely
        if (
          updateErr?.code === 'not-found' ||
          updateErr?.message?.includes('No document to update') ||
          updateErr?.message?.includes('NOT_FOUND')
        ) {
          await setDoc(
            userRef,
            {
              uid: targetUid,
              email: currentUser?.email || '',
              displayName: currentUser?.displayName || 'Resident',
              name: currentUser?.displayName || 'Resident',
              barangay: editBarangay,
              barangayUpdatedAt: serverTimestamp(),
              role: 'user',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          throw updateErr;
        }
      }
      setUserProfile((prev) => (prev ? { ...prev, barangay: editBarangay, barangayUpdatedAt: now } : null));
      setShowBarangayModal(false);
      Alert.alert('Success', 'Barangay preference updated. Your registered barangay is now locked for 24 hours.');
    } catch (error: any) {
      console.error('Failed to update barangay:', error);
      Alert.alert('Error', error?.message || 'Failed to update barangay preference');
    } finally {
      setIsSaving(false);
    }
  };

  // Feedback handling
  const handleSendFeedback = async () => {
    if (feedbackSelected === null || !feedbackText.trim()) {
      Alert.alert('Error', 'Please select a rating and enter your feedback.');
      return;
    }

    const ratingOptions = ['Terrible', 'Bad', 'Good', 'Loved it'];
    const rating = ratingOptions[feedbackSelected] || 'Average';

    try {
      // Determine real user role: check userProfile or fallback to fetching live user doc directly
      let effectiveRole = 'resident';
      const currentRole = (userProfile?.role || '').toLowerCase();
      if (currentRole === 'driver') {
        effectiveRole = 'driver';
      } else if (auth?.currentUser?.uid && db) {
        try {
          const uDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (uDoc.exists()) {
            const roleInDoc = (uDoc.data()?.role || '').toLowerCase();
            if (roleInDoc === 'driver') effectiveRole = 'driver';
          }
        } catch { }
      }

      await addDoc(collection(db, 'feedback'), {
        rating,
        title: `${rating} feedback`,
        description: feedbackText,
        message: feedbackText,
        userId: auth.currentUser?.uid || 'anonymous',
        userEmail: auth.currentUser?.email || 'anonymous',
        userName: userProfile?.displayName || auth.currentUser?.displayName || 'User',
        userRole: effectiveRole,
        barangay: userProfile?.barangay || userProfile?.assignedBarangay || 'Poblacion',
        street: userProfile?.barangay || 'unknown',
        createdAt: new Date().toISOString(),
      });
      Alert.alert('Thank you!', 'Your feedback has been submitted successfully.');
      setFeedbackSelected(null);
      setFeedbackText('');
      setShowFeedbackModal(false);
    } catch (err) {
      console.error('Feedback error:', err);
      Alert.alert('Error', 'Failed to send feedback. Please try again.');
    }
  };

  // Delete Account Confirmation & Execution
  const handleDeleteAccountPress = () => {
    deleteAbortRef.current = false;
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setDeletePassword('');
    setDeleteError(null);
    setShowDeletePasswordText(false);
    setShowDeleteConfirmModal(true);
  };

  const handleCancelDeletion = () => {
    deleteAbortRef.current = true;
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setIsDeletingAccount(false);
    setDeletePassword('');
    setDeleteError(null);
    setShowDeleteConfirmModal(false);
  };

  const executeAccountDeletion = async () => {
    const activeUser = auth?.currentUser || user;
    if (!activeUser) {
      setDeleteError('No authenticated session found.');
      return;
    }

    const needsPassword =
      Array.isArray(activeUser?.providerData) &&
      activeUser.providerData.some((p: any) => p?.providerId === 'password');

    if (needsPassword && !deletePassword.trim()) {
      setDeleteError('Please enter your password to authorize deletion.');
      return;
    }

    setDeleteError(null);
    deleteAbortRef.current = false;
    setIsDeletingAccount(true);
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
        setIsDeletingAccount(false);
        return;
      }

      if (needsPassword && activeUser.email) {
        const credential = EmailAuthProvider.credential(activeUser.email, deletePassword);
        await reauthenticateWithCredential(activeUser as any, credential);
      }

      if (deleteAbortRef.current) {
        setIsDeletingAccount(false);
        return;
      }

      const uid = activeUser.uid;

      // 1. Delete FCM devices and profile document in Firestore
      if (db) {
        try {
          const devicesSnap = await getDocs(collection(db, 'users', uid, 'devices'));
          for (const d of devicesSnap.docs) {
            if (deleteAbortRef.current) {
              setIsDeletingAccount(false);
              return;
            }
            await deleteDoc(d.ref);
          }
          if (deleteAbortRef.current) {
            setIsDeletingAccount(false);
            return;
          }
          await deleteDoc(doc(db, 'users', uid));
          console.log(`✅ [User Deletion] Deleted Firestore profile & devices: /users/${uid}`);
        } catch (fsErr: any) {
          console.warn('Firestore deletion warning:', fsErr.message);
        }
      }

      if (deleteAbortRef.current) {
        setIsDeletingAccount(false);
        return;
      }

      // 2. Clear local storage
      try {
        await AsyncStorage.clear();
      } catch { }

      // 3. Delete user from Firebase Auth
      await deleteUser(activeUser as any);
      console.log(`✅ [User Deletion] Successfully deleted user ${uid} from Firebase Auth.`);

      // 4. Sign out
      try {
        if (auth) await signOut(auth);
      } catch { }

      setShowDeleteConfirmModal(false);
      setShowDeletedSuccessModal(true);
    } catch (err: any) {
      if (err?.message === 'DELETION_ABORTED' || deleteAbortRef.current) {
        console.log('Account deletion was successfully cancelled by resident.');
        setIsDeletingAccount(false);
        setShowDeleteConfirmModal(false);
        return;
      }
      console.error('Account deletion error:', err);
      if (['auth/wrong-password', 'auth/invalid-credential'].includes(err?.code)) {
        setDeleteError('The password you entered is incorrect. Please try again.');
      } else if (err?.code === 'auth/requires-recent-login') {
        setDeleteError('For your security, please sign out, log back in, and retry deleting your account.');
      } else {
        setDeleteError(err?.message || 'We could not complete your account deletion. Please try again.');
      }
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Settings Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <IconSymbol name="arrow.left" size={24} color="#234033" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollContent} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 24 }}>
        <Modal
          visible={isEditMode}
          transparent
          animationType="fade"
          onRequestClose={handleCancelEdit}
        >
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={[styles.editProfileCard, { backgroundColor: colors.surface }]}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ padding: 20 }}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.editProfileHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.editProfileTitle, { color: colors.textPrimary }]}>Edit Profile</Text>
                    <Text style={[styles.editProfileSubtitle, { color: colors.textSecondary }]}>
                      Official resident account details for Danao City directory
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleCancelEdit}
                    disabled={isSaving}
                    style={styles.editProfileCloseBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialIcons name="close" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.avatarContainer}
                  onPress={pickImage}
                  activeOpacity={0.7}
                >
                  {editPhotoURL ? (
                    <Image source={{ uri: editPhotoURL }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                      <IconSymbol name="person.fill" size={40} color={colors.surface} />
                    </View>
                  )}
                  <Text style={styles.avatarEditText}>Tap to change photo</Text>
                </TouchableOpacity>

                {/* Name Row: First Name & Middle Initial */}
                <View style={styles.editFieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.editFieldLabel, { color: colors.textSecondary }]}>FIRST NAME *</Text>
                    <TextInput
                      value={editFirstName}
                      onChangeText={setEditFirstName}
                      style={[styles.editTextInput, { color: colors.textPrimary, borderColor: colors.border || '#CBD5E1', backgroundColor: colors.background }]}
                      placeholder="e.g. Luthar"
                      placeholderTextColor="#94A3B8"
                    />
                  </View>
                  <View style={{ width: 75 }}>
                    <Text style={[styles.editFieldLabel, { color: colors.textSecondary }]}>M.I.</Text>
                    <TextInput
                      value={editMiddleInitial}
                      onChangeText={setEditMiddleInitial}
                      style={[styles.editTextInput, { color: colors.textPrimary, borderColor: colors.border || '#CBD5E1', backgroundColor: colors.background, textAlign: 'center' }]}
                      placeholder="M"
                      placeholderTextColor="#94A3B8"
                      maxLength={2}
                      autoCapitalize="characters"
                    />
                  </View>
                </View>

                {/* Last Name */}
                <View style={styles.editFieldGroup}>
                  <Text style={[styles.editFieldLabel, { color: colors.textSecondary }]}>LAST NAME *</Text>
                  <TextInput
                    value={editLastName}
                    onChangeText={setEditLastName}
                    style={[styles.editTextInput, { color: colors.textPrimary, borderColor: colors.border || '#CBD5E1', backgroundColor: colors.background }]}
                    placeholder="e.g. James"
                    placeholderTextColor="#94A3B8"
                  />
                </View>

                {/* Mobile / Contact Number */}
                <View style={styles.editFieldGroup}>
                  <Text style={[styles.editFieldLabel, { color: colors.textSecondary }]}>MOBILE / CONTACT NUMBER</Text>
                  <TextInput
                    value={editPhoneNumber}
                    onChangeText={setEditPhoneNumber}
                    style={[styles.editTextInput, { color: colors.textPrimary, borderColor: colors.border || '#CBD5E1', backgroundColor: colors.background }]}
                    placeholder="e.g. 0912 345 6789"
                    placeholderTextColor="#94A3B8"
                    keyboardType="phone-pad"
                  />
                </View>

                {/* Account Email (Read-Only) */}
                <View style={styles.editFieldGroup}>
                  <Text style={[styles.editFieldLabel, { color: colors.textSecondary }]}>ACCOUNT EMAIL (LOGIN ID)</Text>
                  <View style={[styles.readOnlyEmailBox, { backgroundColor: colors.background, borderColor: colors.border || '#E2E8F0' }]}>
                    <MaterialIcons name="alternate-email" size={16} color="#64748B" />
                    <Text style={[styles.readOnlyEmailText, { color: colors.textSecondary }]} numberOfLines={1}>
                      {user?.email || 'No email'}
                    </Text>
                    <MaterialIcons name="lock" size={14} color="#94A3B8" />
                  </View>
                </View>

                {/* Save and Cancel Buttons */}
                <TouchableOpacity
                  style={[styles.saveButton, { backgroundColor: colors.primary, width: '100%', marginTop: 18 }]}
                  onPress={handleSaveProfile}
                  disabled={isSaving}
                  activeOpacity={0.8}
                >
                  {isSaving ? (
                    <ActivityIndicator color={colors.surface} />
                  ) : (
                    <Text style={[styles.saveButtonText, { color: colors.surface }]}>
                      Save Changes
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={{ marginTop: 12, paddingVertical: 8 }}
                  onPress={handleCancelEdit}
                  disabled={isSaving}
                >
                  <Text style={{ color: colors.textSecondary, textAlign: 'center', fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* EnviroHero Badges */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitleSmall}>EnviroHero Badges</Text>
          <TouchableOpacity onPress={() => router.push('/rewards' as any)}>
            <Text style={styles.viewAllText}>VIEW ALL</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.badgesRow}>
          <View style={styles.badgeCardSmall}>
            <View style={[styles.badgeIconBg, { backgroundColor: '#FDE68A' }]}>
              <IconSymbol name="leaf.fill" size={24} color="#D97706" />
            </View>
            <Text style={styles.badgeTitle}>Verified Pickups</Text>
            <Text style={styles.badgeSubtitle}>{verifiedRewardCount} REWARDED</Text>
          </View>
          <View style={styles.badgeCardSmall}>
            <View style={[styles.badgeIconBg, { backgroundColor: '#C8E6C9' }]}>
              <IconSymbol name="arrow.triangle.2.circlepath" size={24} color="#2E7D32" />
            </View>
            <Text style={styles.badgeTitle}>Eco Tokens</Text>
            <Text style={styles.badgeSubtitle}>{availableRewardTokens.toLocaleString()} AVAILABLE</Text>
          </View>
        </View>

        <View style={styles.badgeCardLarge}>
          <View style={[styles.badgeIconBg, { backgroundColor: '#A5D6A7' }]}>
            <IconSymbol name="person.circle.fill" size={32} color="#1B5E20" />
          </View>
          <Text style={styles.badgeTitle}>{availableRewardTokens >= 500 ? 'Souvenir Eligible' : 'Next Souvenir'}</Text>
          <Text style={styles.badgeSubtitle}>{availableRewardTokens >= 500 ? 'OPEN REWARDS TO REVIEW OPTIONS' : `${500 - availableRewardTokens} TOKENS TO A CENRO TOTE`}</Text>
        </View>

        {/* Location & Service */}
        <Text style={[styles.sectionTitleSmall, { marginTop: 16, marginHorizontal: 20 }]}>Location & Service</Text>
        <View style={styles.settingsCard}>
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => {
              setEditBarangay(userProfile?.barangay || '');
              setBarangaySearch('');
              setShowBarangayModal(true);
            }}
          >
            <View style={styles.settingsIconBg}>
              <IconSymbol name="mappin.circle.fill" size={20} color="#2E7D32" />
            </View>
            <View style={styles.settingsTextContainer}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.settingsRowTitle}>Barangay Preference</Text>
                {getBarangayLockStatus().isLocked && (
                  <View style={{ backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                    <Text style={{ fontSize: 10, color: '#92400E', fontWeight: 'bold' }}>24h Lock</Text>
                  </View>
                )}
              </View>
              <Text style={styles.settingsRowSubtitle}>
                {userProfile?.barangay
                  ? `${userProfile.barangay}${getBarangayLockStatus().isLocked ? ` · Locked (${getBarangayLockStatus().formattedRemaining})` : ''}`
                  : "Tap to set barangay"}
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={20} color="#9E9E9E" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.settingsRow} onPress={() => router.push('/(tabs)/schedule')}>
            <View style={styles.settingsIconBg}>
              <IconSymbol name="calendar" size={20} color="#2E7D32" />
            </View>
            <View style={styles.settingsTextContainer}>
              <Text style={styles.settingsRowTitle}>Area Schedule</Text>
              <Text style={styles.settingsRowSubtitle}>Open your published collection calendar</Text>
            </View>
            <IconSymbol name="chevron.right" size={20} color="#9E9E9E" />
          </TouchableOpacity>
        </View>

        {/* Profile Settings */}
        <Text style={[styles.sectionTitleSmall, { marginTop: 16, marginHorizontal: 20 }]}>Profile Settings</Text>
        <View style={styles.settingsCard}>
          <TouchableOpacity style={styles.settingsRow} onPress={handleEditProfile}>
            <View style={[styles.settingsIconBg, { backgroundColor: '#F5F5F5' }]}>
              <IconSymbol name="person.fill" size={20} color="#4A6741" />
            </View>
            <View style={styles.settingsTextContainer}>
              <Text style={styles.settingsRowTitle}>Edit Personal Info</Text>
            </View>
            <IconSymbol name="chevron.right" size={20} color="#9E9E9E" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.settingsRow} onPress={() => setShowNotificationsModal(true)}>
            <View style={[styles.settingsIconBg, { backgroundColor: '#F5F5F5' }]}>
              <IconSymbol name="bell" size={20} color="#4A6741" />
            </View>
            <View style={styles.settingsTextContainer}>
              <Text style={styles.settingsRowTitle}>Notification Preferences</Text>
            </View>
            <IconSymbol name="chevron.right" size={20} color="#9E9E9E" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.settingsRow} onPress={handleChangePassword}>
            <View style={[styles.settingsIconBg, { backgroundColor: '#F5F5F5' }]}>
              <IconSymbol name="shield.fill" size={20} color="#4A6741" />
            </View>
            <View style={styles.settingsTextContainer}>
              <Text style={styles.settingsRowTitle}>Security & Privacy</Text>
            </View>
            <IconSymbol name="chevron.right" size={20} color="#9E9E9E" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.settingsRow} onPress={() => setShowFeedbackModal(true)}>
            <View style={[styles.settingsIconBg, { backgroundColor: '#F5F5F5' }]}>
              <IconSymbol name="message.fill" size={20} color="#4A6741" />
            </View>
            <View style={styles.settingsTextContainer}>
              <Text style={styles.settingsRowTitle}>Send Feedback</Text>
            </View>
            <IconSymbol name="chevron.right" size={20} color="#9E9E9E" />
          </TouchableOpacity>

          <View style={styles.divider} />
          <TouchableOpacity style={styles.settingsRow} onPress={handleLogout}>
            <View style={[styles.settingsIconBg, { backgroundColor: '#FFEBEE' }]}>
              <IconSymbol name="door.left.hand.open" size={20} color="#D32F2F" />
            </View>
            <View style={styles.settingsTextContainer}>
              <Text style={[styles.settingsRowTitle, { color: '#D32F2F', fontWeight: 'bold' }]}>Sign Out</Text>
            </View>
            <IconSymbol name="chevron.right" size={20} color="#D32F2F" />
          </TouchableOpacity>

        </View>

        {/* Danger Zone: Bottom of Settings */}
        <View style={styles.dangerZoneCard}>
          <View style={styles.dangerZoneHeader}>
            <View style={styles.dangerZoneIconBg}>
              <MaterialIcons name="error-outline" size={18} color="#DC2626" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dangerZoneTitle}>Account Management</Text>
              <Text style={styles.dangerZoneSubtitle}>Irreversible account actions</Text>
            </View>
          </View>
          <Text style={styles.dangerZoneDesc}>
            Permanently delete your resident profile, login credentials, and waste diversion points from Danao City records. This action cannot be reversed.
          </Text>
          <TouchableOpacity
            style={styles.deleteAccountBtn}
            onPress={handleDeleteAccountPress}
            disabled={isDeletingAccount}
            activeOpacity={0.8}
          >
            {isDeletingAccount ? (
              <ActivityIndicator size="small" color="#DC2626" />
            ) : (
              <>
                <MaterialIcons name="delete-forever" size={18} color="#DC2626" />
                <Text style={styles.deleteAccountBtnText}>Permanently Delete My Account</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Logout Confirmation Modal */}
        <Modal
          visible={showLogoutModal}
          transparent
          animationType="fade"
          onRequestClose={cancelLogout}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Confirm Logout</Text>
              <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>Are you sure you want to logout?</Text>

              {logoutError ? <Text style={styles.errorText}>{logoutError}</Text> : null}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
                  onPress={cancelLogout}
                  activeOpacity={0.7}
                  hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                >
                  <Text style={[styles.modalButtonText, { color: colors.textPrimary }]}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButtonConfirm, { backgroundColor: colors.error }]}
                  onPress={confirmLogout}
                  disabled={isLoggingOut}
                  activeOpacity={0.7}
                  hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                >
                  {isLoggingOut ? (
                    <ActivityIndicator color={colors.surface} />
                  ) : (
                    <Text style={[styles.modalButtonText, { color: colors.surface }]}>Logout</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Delete Account Confirmation Modal */}
        <Modal
          visible={showDeleteConfirmModal}
          transparent
          animationType="fade"
          onRequestClose={handleCancelDeletion}
        >
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={[styles.deleteConfirmModalCard, { backgroundColor: colors.surface }]}>
              {/* Top Warning Badge */}
              <View style={styles.deleteModalBadge}>
                <View style={styles.deleteModalInnerBadge}>
                  <MaterialIcons name="delete-forever" size={30} color="#DC2626" />
                </View>
              </View>

              <Text style={[styles.deleteModalTitle, { color: colors.textPrimary }]}>
                Delete TrashTrack Account?
              </Text>

              <Text style={[styles.deleteModalSubtitle, { color: colors.textSecondary }]}>
                This action will permanently delete your resident account and cannot be undone.
              </Text>

              {/* Warning Impact Callout Box */}
              <View style={[styles.deleteImpactBox, { backgroundColor: theme === 'dark' ? '#2A1215' : '#FFF1F2', borderColor: theme === 'dark' ? '#5B1A22' : '#FECDD3' }]}>
                <View style={styles.deleteImpactRow}>
                  <MaterialIcons name="stars" size={16} color="#DC2626" style={styles.deleteImpactIcon} />
                  <Text style={[styles.deleteImpactText, { color: theme === 'dark' ? '#FECDD3' : '#9F1239' }]}>
                    All earned Eco Points and reward tokens will be reset
                  </Text>
                </View>
                <View style={styles.deleteImpactRow}>
                  <MaterialIcons name="event-busy" size={16} color="#DC2626" style={styles.deleteImpactIcon} />
                  <Text style={[styles.deleteImpactText, { color: theme === 'dark' ? '#FECDD3' : '#9F1239' }]}>
                    Waste collection reminders and history will be cleared
                  </Text>
                </View>
                <View style={styles.deleteImpactRow}>
                  <MaterialIcons name="no-accounts" size={16} color="#DC2626" style={styles.deleteImpactIcon} />
                  <Text style={[styles.deleteImpactText, { color: theme === 'dark' ? '#FECDD3' : '#9F1239' }]}>
                    Profile data permanently removed from Danao City records
                  </Text>
                </View>
              </View>

              {/* Password Re-authentication if applicable */}
              {isPasswordAccount && (
                <View style={styles.deletePasswordSection}>
                  <Text style={[styles.deletePasswordLabel, { color: colors.textPrimary }]}>
                    Enter your password to authorize:
                  </Text>
                  <View style={[
                    styles.deletePasswordInputWrapper,
                    {
                      backgroundColor: colors.background,
                      borderColor: deleteError ? '#DC2626' : colors.border
                    }
                  ]}>
                    <MaterialIcons name="lock-outline" size={18} color={colors.textTertiary} style={{ marginRight: 8 }} />
                    <TextInput
                      style={[styles.deletePasswordInput, { color: colors.textPrimary }]}
                      value={deletePassword}
                      onChangeText={(val) => {
                        setDeletePassword(val);
                        if (deleteError) setDeleteError(null);
                      }}
                      placeholder="Enter current password"
                      placeholderTextColor={colors.textTertiary}
                      secureTextEntry={!showDeletePasswordText}
                      editable={!isDeletingAccount}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={styles.eyeButton}
                      onPress={() => setShowDeletePasswordText(!showDeletePasswordText)}
                    >
                      <IconSymbol
                        name={showDeletePasswordText ? "eye.slash" : "eye"}
                        size={18}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Inline Error Message */}
              {deleteError ? (
                <View style={styles.deleteErrorContainer}>
                  <MaterialIcons name="error" size={16} color="#DC2626" />
                  <Text style={styles.deleteErrorText}>{deleteError}</Text>
                </View>
              ) : null}

              {/* Modal Action Buttons */}
              <View style={styles.deleteModalButtons}>
                <TouchableOpacity
                  style={[
                    styles.deleteConfirmBtn,
                    (isPasswordAccount && !deletePassword.trim()) || isDeletingAccount ? styles.deleteConfirmBtnDisabled : null
                  ]}
                  onPress={executeAccountDeletion}
                  disabled={isDeletingAccount || (isPasswordAccount && !deletePassword.trim())}
                  activeOpacity={0.8}
                >
                  {isDeletingAccount ? (
                    <View style={styles.deleteBtnLoading}>
                      <ActivityIndicator color="#FFFFFF" size="small" />
                      <Text style={styles.deleteConfirmBtnText}>Deleting Account...</Text>
                    </View>
                  ) : (
                    <View style={styles.deleteBtnContent}>
                      <MaterialIcons name="delete-forever" size={18} color="#FFFFFF" />
                      <Text style={styles.deleteConfirmBtnText}>Permanently Delete Account</Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.deleteCancelBtn,
                    {
                      backgroundColor: isDeletingAccount
                        ? (theme === 'dark' ? '#371B1B' : '#FEE2E2')
                        : (theme === 'dark' ? '#1E293B' : '#F1F5F9'),
                      borderWidth: isDeletingAccount ? 1.5 : 0,
                      borderColor: isDeletingAccount ? '#DC2626' : 'transparent',
                    }
                  ]}
                  onPress={handleCancelDeletion}
                  disabled={false}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    {isDeletingAccount && (
                      <MaterialIcons name="close" size={16} color="#DC2626" />
                    )}
                    <Text style={[
                      styles.deleteCancelBtnText,
                      {
                        color: isDeletingAccount ? '#DC2626' : colors.textPrimary,
                        fontWeight: isDeletingAccount ? '700' : '600',
                      }
                    ]}>
                      {isDeletingAccount ? 'Cancel Deletion' : 'Cancel, Keep My Account'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Delete Account Success Modal */}
        <Modal
          visible={showDeletedSuccessModal}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setShowDeletedSuccessModal(false);
            router.replace('/(auth)/login' as any);
          }}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.deleteSuccessModalCard, { backgroundColor: colors.surface }]}>
              {/* Checkmark Badge */}
              <View style={styles.deleteSuccessBadge}>
                <View style={styles.deleteSuccessInnerBadge}>
                  <MaterialIcons name="check" size={28} color="#FFFFFF" />
                </View>
              </View>

              <Text style={[styles.deleteSuccessTitle, { color: colors.textPrimary }]}>
                Account Deleted
              </Text>

              <Text style={[styles.deleteSuccessSubtitle, { color: colors.textSecondary }]}>
                Your TrashTrack account and personal profile have been permanently deleted from Danao City records.
              </Text>

              {/* Status checklist */}
              <View style={[
                styles.deleteSuccessDetailBox,
                {
                  backgroundColor: theme === 'dark' ? '#064E3B20' : '#ECFDF5',
                  borderColor: theme === 'dark' ? '#065F46' : '#A7F3D0'
                }
              ]}>
                <View style={styles.deleteSuccessDetailRow}>
                  <MaterialIcons name="check-circle" size={16} color="#10B981" />
                  <Text style={[styles.deleteSuccessDetailText, { color: theme === 'dark' ? '#A7F3D0' : '#065F46' }]}>
                    Profile data & credentials erased
                  </Text>
                </View>
                <View style={styles.deleteSuccessDetailRow}>
                  <MaterialIcons name="check-circle" size={16} color="#10B981" />
                  <Text style={[styles.deleteSuccessDetailText, { color: theme === 'dark' ? '#A7F3D0' : '#065F46' }]}>
                    Device push notifications unregistered
                  </Text>
                </View>
                <View style={styles.deleteSuccessDetailRow}>
                  <MaterialIcons name="check-circle" size={16} color="#10B981" />
                  <Text style={[styles.deleteSuccessDetailText, { color: theme === 'dark' ? '#A7F3D0' : '#065F46' }]}>
                    All active sessions signed out
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.deleteSuccessBtn}
                onPress={() => {
                  setShowDeletedSuccessModal(false);
                  router.replace('/(auth)/login' as any);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.deleteSuccessBtnText}>OK, Return to Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Notifications Modal (Driver-style) */}
        <Modal
          visible={showNotificationsModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowNotificationsModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.passwordModalContainer, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Notifications</Text>
              <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>
                Control push notifications and pickup reminders.
              </Text>
              <View style={{ gap: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 16 }}>Enable Push Notifications</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                      Allow the app to send you notifications on this device.
                    </Text>
                  </View>
                  <Switch value={pushEnabled} onValueChange={setPushEnabled} />
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 16 }}>Pickup Reminders</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                      Receive reminders 24h and 1h before your scheduled pickup.
                    </Text>
                  </View>
                  <Switch value={reminderEnabled} onValueChange={setReminderEnabled} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 16 }}>Report Status Updates</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>Receive acknowledgement, dispatch, and resolution updates.</Text>
                  </View>
                  <Switch value={reportUpdatesEnabled} onValueChange={setReportUpdatesEnabled} disabled={!pushEnabled} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 16 }}>Announcements</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>Receive new CENRO announcement alerts.</Text>
                  </View>
                  <Switch value={announcementNotificationsEnabled} onValueChange={setAnnouncementNotificationsEnabled} disabled={!pushEnabled} />
                </View>
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 16 }}>Incoming & Proximity Alerts</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>Receive AI arrival alerts (~30 mins before) and proximity notices when your collection truck approaches your barangay.</Text>
                    </View>
                    <Switch value={proximityAlertsEnabled} onValueChange={setProximityAlertsEnabled} disabled={!pushEnabled} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    {[250, 500, 1000].map(radius => (
                      <TouchableOpacity
                        key={radius}
                        onPress={() => setProximityRadiusMeters(radius)}
                        disabled={!pushEnabled || !proximityAlertsEnabled}
                        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: proximityRadiusMeters === radius ? colors.primary : colors.border, backgroundColor: proximityRadiusMeters === radius ? `${colors.primary}18` : colors.surface }}
                      >
                        <Text style={{ color: proximityRadiusMeters === radius ? colors.primary : colors.textSecondary, fontWeight: '700', fontSize: 12 }}>{radius} m</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Audible Alert Sounds Toggle & Test Buttons */}
                <View style={{ marginTop: 4, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <MaterialIcons
                          name={soundAlertsEnabled ? "volume-up" : "volume-off"}
                          size={18}
                          color={soundAlertsEnabled ? colors.primary : colors.textSecondary}
                        />
                        <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 16 }}>
                          Audible Alert Sounds
                        </Text>
                      </View>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                        Play friendly 3-tone chime for fleet arrivals and urgent siren chime for emergency advisories.
                      </Text>
                    </View>
                    <Switch value={soundAlertsEnabled} onValueChange={setSoundAlertsEnabled} />
                  </View>

                  {/* Audio Preview Buttons */}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <TouchableOpacity
                      onPress={() => soundAlertService.playFleetArrivalChime(userProfile?.barangay || 'Baliang')}
                      disabled={!soundAlertsEnabled}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: soundAlertsEnabled ? colors.primary : colors.border,
                        backgroundColor: soundAlertsEnabled ? `${colors.primary}18` : colors.surface,
                        opacity: soundAlertsEnabled ? 1 : 0.45,
                      }}
                    >
                      <MaterialIcons name="play-arrow" size={16} color={soundAlertsEnabled ? colors.primary : colors.textSecondary} />
                      <Text style={{ color: soundAlertsEnabled ? colors.primary : colors.textSecondary, fontWeight: '700', fontSize: 12 }}>
                        Test Arrival Chime
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => soundAlertService.playEmergencyAlertSiren()}
                      disabled={!soundAlertsEnabled}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: soundAlertsEnabled ? '#DC2626' : colors.border,
                        backgroundColor: soundAlertsEnabled ? '#FEE2E2' : colors.surface,
                        opacity: soundAlertsEnabled ? 1 : 0.45,
                      }}
                    >
                      <MaterialIcons name="campaign" size={16} color={soundAlertsEnabled ? '#DC2626' : colors.textSecondary} />
                      <Text style={{ color: soundAlertsEnabled ? '#DC2626' : colors.textSecondary, fontWeight: '700', fontSize: 12 }}>
                        Test Emergency Siren
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <View style={[styles.modalActions, { marginTop: 16 }]}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
                  onPress={saveNotificationPreferences}
                >
                  <Text style={[styles.modalButtonText, { color: colors.textPrimary }]}>Save Preferences</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Help & Support Modal */}
        <Modal
          visible={showHelpModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowHelpModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.passwordModalContainer, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Help & Support</Text>
              <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>How can we help you?</Text>
              <View style={{ gap: 12 }}>
                <TouchableOpacity
                  style={[styles.menuItem, { backgroundColor: colors.background }]}
                  onPress={() => {
                    const mailto = 'mailto:support@trashtrack.app?subject=Support%20Request&body=Describe%20your%20issue...';
                    try { (window as any).location.href = mailto; } catch { }
                  }}
                >
                  <IconSymbol name="envelope" size={22} color={colors.primary} />
                  <Text style={[styles.menuText, { color: colors.textPrimary }]}>Email support</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.menuItem, { backgroundColor: colors.background }]}
                  onPress={() => {
                    try { (window as any).open?.('https://docs.trashtrack.app', '_blank'); } catch { }
                  }}
                >
                  <IconSymbol name="book" size={22} color={colors.primary} />
                  <Text style={[styles.menuText, { color: colors.textPrimary }]}>View documentation</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.modalButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]} onPress={() => setShowHelpModal(false)}>
                  <Text style={[styles.modalButtonText, { color: colors.textPrimary }]}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* About Modal */}
        <Modal
          visible={showAboutModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAboutModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.passwordModalContainer, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>About TrashTrack</Text>
              <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>TrashTrack helps you keep your community clean with schedules, reports, and announcements.</Text>
              <Text style={[styles.modalMessage, { color: colors.textTertiary }]}>Version 1.0.0</Text>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.modalButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]} onPress={() => setShowAboutModal(false)}>
                  <Text style={[styles.modalButtonText, { color: colors.textPrimary }]}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        {/* Change Password Modal */}
        <Modal
          visible={showChangePassword}
          transparent
          animationType="slide"
          onRequestClose={handleCancelChangePassword}
        >
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={[styles.passwordModalContainer, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Change Password</Text>

              {/* Current Password */}
              <View style={styles.passwordInputContainer}>
                <Text style={[styles.passwordLabel, { color: colors.textPrimary }]}>Current Password</Text>
                <View style={[styles.passwordInputWrapper, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.passwordInput, { color: colors.textPrimary }]}
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    placeholder="Enter current password"
                    placeholderTextColor={colors.textTertiary}
                    secureTextEntry={!showCurrentPassword}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                  >
                    <IconSymbol
                      name={showCurrentPassword ? "eye.slash" : "eye"}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* New Password */}
              <View style={styles.passwordInputContainer}>
                <Text style={[styles.passwordLabel, { color: colors.textPrimary }]}>New Password</Text>
                <View style={[styles.passwordInputWrapper, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.passwordInput, { color: colors.textPrimary }]}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="Enter new password"
                    placeholderTextColor={colors.textTertiary}
                    secureTextEntry={!showNewPassword}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowNewPassword(!showNewPassword)}
                  >
                    <IconSymbol
                      name={showNewPassword ? "eye.slash" : "eye"}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Confirm Password */}
              <View style={styles.passwordInputContainer}>
                <Text style={[styles.passwordLabel, { color: colors.textPrimary }]}>Confirm New Password</Text>
                <View style={[styles.passwordInputWrapper, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.passwordInput, { color: colors.textPrimary }]}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Confirm new password"
                    placeholderTextColor={colors.textTertiary}
                    secureTextEntry={!showConfirmPassword}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    <IconSymbol
                      name={showConfirmPassword ? "eye.slash" : "eye"}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Password Requirements */}
              <View style={styles.passwordRequirements}>
                <Text style={[styles.requirementsTitle, { color: colors.textSecondary }]}>Password Requirements:</Text>
                <Text style={[styles.requirementText, { color: colors.textTertiary }]}>• At least 8 characters</Text>
                <Text style={[styles.requirementText, { color: colors.textTertiary }]}>• One uppercase letter</Text>
                <Text style={[styles.requirementText, { color: colors.textTertiary }]}>• One lowercase letter</Text>
                <Text style={[styles.requirementText, { color: colors.textTertiary }]}>• One number</Text>
                <Text style={[styles.requirementText, { color: colors.textTertiary }]}>• One special character</Text>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
                  onPress={handleCancelChangePassword}
                >
                  <Text style={[styles.modalButtonText, { color: colors.textPrimary }]}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButtonConfirm, { backgroundColor: colors.primary }]}
                  onPress={handleSavePassword}
                  disabled={isChangingPassword}
                >
                  {isChangingPassword ? (
                    <ActivityIndicator color={colors.surface} />
                  ) : (
                    <Text style={[styles.modalButtonText, { color: colors.surface }]}>Change Password</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Feedback Modal */}
        <Modal
          visible={showFeedbackModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowFeedbackModal(false)}
        >
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={[styles.feedbackModalContainer, { backgroundColor: colors.background }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text, marginBottom: 0 }]}>Send Feedback</Text>
                <TouchableOpacity onPress={() => setShowFeedbackModal(false)} style={styles.closeButton}>
                  <IconSymbol name="xmark" size={24} color={colors.icon} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.feedbackQuestion, { color: colors.text }]}>How was your experience today?</Text>

              <View style={styles.feedbackRow}>
                {[
                  { id: 0, emoji: '😣', label: 'Terrible', color: '#EF5350' },
                  { id: 1, emoji: '😕', label: 'Bad', color: '#FFB300' },
                  { id: 2, emoji: '😊', label: 'Good', color: '#66BB6A' },
                  { id: 3, emoji: '😍', label: 'Loved it', color: '#4CAF50' },
                ].map((reaction) => (
                  <TouchableOpacity
                    key={reaction.id}
                    style={[
                      styles.feedbackReaction,
                      { borderColor: feedbackSelected === reaction.id ? reaction.color : '#E0E0E0' },
                      feedbackSelected === reaction.id && { backgroundColor: `${reaction.color}15` }
                    ]}
                    onPress={() => setFeedbackSelected(reaction.id)}
                  >
                    <Text style={{ fontSize: 24, marginBottom: 4 }}>{reaction.emoji}</Text>
                    <Text style={[styles.feedbackReactionLabel, { color: feedbackSelected === reaction.id ? reaction.color : '#757575' }]}>
                      {reaction.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={[styles.feedbackInput, { color: colors.text, backgroundColor: colors.surface }]}
                placeholder="Tell us what you liked or how we can improve..."
                placeholderTextColor={colors.icon}
                multiline
                numberOfLines={4}
                value={feedbackText}
                onChangeText={setFeedbackText}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
                  onPress={() => {
                    setShowFeedbackModal(false);
                    setFeedbackSelected(null);
                    setFeedbackText('');
                  }}
                >
                  <Text style={[styles.modalButtonText, { color: colors.textPrimary }]}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButtonConfirm, { backgroundColor: colors.primary }]}
                  onPress={handleSendFeedback}
                >
                  <Text style={[styles.modalButtonText, { color: colors.surface }]}>Send Feedback</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Barangay Modal */}
        <Modal
          visible={showBarangayModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowBarangayModal(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalOverlay}
          >
            <View style={[styles.barangayModalCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalTitle, { color: colors.text, textAlign: 'left', marginBottom: 2 }]}>
                    Select Barangay
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.icon }}>
                    Danao City, Cebu ({availableBarangays.length} areas)
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setShowBarangayModal(false)} style={styles.closeButton}>
                  <IconSymbol name="xmark" size={22} color={colors.icon} />
                </TouchableOpacity>
              </View>

              {/* Search Box */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme === 'dark' ? '#1E293B' : '#F1F5F9',
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  height: 44,
                  marginTop: 12,
                  marginBottom: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <MaterialIcons name="search" size={20} color={colors.icon} style={{ marginRight: 8 }} />
                <TextInput
                  value={barangaySearch}
                  onChangeText={setBarangaySearch}
                  placeholder="Search Danao City barangay..."
                  placeholderTextColor={colors.icon}
                  style={{
                    flex: 1,
                    fontSize: 14,
                    color: colors.text,
                    paddingVertical: 0,
                  }}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {barangaySearch.length > 0 && (
                  <TouchableOpacity onPress={() => setBarangaySearch('')} style={{ padding: 4 }}>
                    <MaterialIcons name="cancel" size={18} color={colors.icon} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Scrollable Barangay List */}
              <View style={{ maxHeight: 260, minHeight: 180, marginBottom: 12 }}>
                <ScrollView
                  nestedScrollEnabled={true}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={true}
                  style={{ flexGrow: 0 }}
                >
                  {availableBarangays
                    .filter((b) => b.toLowerCase().includes(barangaySearch.toLowerCase().trim()))
                    .map((b) => {
                      const isSelected = editBarangay.toLowerCase().trim() === b.toLowerCase().trim();
                      return (
                        <TouchableOpacity
                          key={b}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingVertical: 11,
                            paddingHorizontal: 14,
                            borderRadius: 8,
                            marginBottom: 6,
                            backgroundColor: isSelected
                              ? theme === 'dark' ? '#064E3B' : '#ECFDF5'
                              : theme === 'dark' ? '#1E293B' : '#F8FAFC',
                            borderWidth: 1,
                            borderColor: isSelected ? '#10B981' : colors.border,
                          }}
                          onPress={() => setEditBarangay(b)}
                          activeOpacity={0.7}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <MaterialIcons
                              name="location-on"
                              size={18}
                              color={isSelected ? '#10B981' : colors.icon}
                            />
                            <Text
                              style={{
                                fontSize: 14,
                                fontWeight: isSelected ? '700' : '500',
                                color: isSelected ? (theme === 'dark' ? '#A7F3D0' : '#065F46') : colors.text,
                              }}
                            >
                              {b}
                            </Text>
                          </View>
                          {isSelected && (
                            <MaterialIcons name="check-circle" size={20} color="#10B981" />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  {availableBarangays.filter((b) => b.toLowerCase().includes(barangaySearch.toLowerCase().trim())).length === 0 && (
                    <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                      <MaterialIcons name="location-off" size={30} color={colors.icon} />
                      <Text style={{ fontSize: 13, color: colors.icon, marginTop: 6 }}>
                        No barangays matching &quot;{barangaySearch}&quot;
                      </Text>
                    </View>
                  )}
                </ScrollView>
              </View>

              {/* Lock Notice */}
              {getBarangayLockStatus().isLocked && (
                <View style={{ backgroundColor: '#FEF3C7', padding: 10, borderRadius: 8, marginBottom: 12 }}>
                  <Text style={{ fontSize: 12, color: '#92400E', fontWeight: '600' }}>
                    🔒 Barangay is locked for 24 hours. Remaining cooldown: {getBarangayLockStatus().formattedRemaining}.
                  </Text>
                </View>
              )}

              {/* Save Button */}
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  {
                    backgroundColor: colors.primary,
                    marginTop: 4,
                    opacity: (getBarangayLockStatus().isLocked && editBarangay !== userProfile?.barangay) || isSaving ? 0.6 : 1,
                  }
                ]}
                onPress={handleSaveBarangay}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={[styles.saveButtonText, { color: colors.surface }]}>
                    {editBarangay ? `Confirm Brgy. ${editBarangay}` : 'Select a Barangay'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F8F6',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingHorizontal: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerSpacer: {
    width: 40, // Same width as close button to center title
  },
  scrollContent: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  content: {
    padding: 20,
    gap: 24,
  },
  profileCard: {
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    gap: 12,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
  },
  preferencesDropdown: {
    marginLeft: 20,
    gap: 16,
    paddingVertical: 8,
  },
  selectableItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  selectableLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  toggleContainer: {
    alignItems: 'center',
  },
  toggleSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 200,
    height: 50,
    borderRadius: 25,
    paddingHorizontal: 16,
    gap: 12,
    // Neumorphic shadow effects
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  toggleThumb: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    // Inner shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  systemToggleSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 200,
    height: 50,
    borderRadius: 25,
    paddingHorizontal: 16,
    gap: 12,
    // Neumorphic shadow effects
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  systemToggleText: {
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  // Gamified Settings Styles
  backButton: {
    padding: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
  },
  sectionTitleSmall: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1B5E20',
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  badgesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginBottom: 12,
  },
  badgeCardSmall: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  badgeCardLarge: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  badgeIconBg: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  badgeTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2E7D32',
    textAlign: 'center',
    marginBottom: 4,
  },
  badgeSubtitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#9E9E9E',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  settingsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 20,
    marginTop: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  settingsIconBg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  settingsTextContainer: {
    flex: 1,
  },
  settingsRowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#424242',
  },
  settingsRowSubtitle: {
    fontSize: 14,
    color: '#757575',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#EEEEEE',
    marginLeft: 72,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
    gap: 8,
    marginTop: 20,
    marginBottom: 40,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  themeStatusContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  themeStatusText: {
    fontSize: 14,
    marginBottom: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  modalContainer: {
    width: '80%',
    borderRadius: 12,
    padding: 20,
    zIndex: 10000,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center'
  },
  modalMessage: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center'
  },
  errorText: {
    color: '#ff4d4f',
    textAlign: 'center',
    marginBottom: 8
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  modalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    marginRight: 8,
    alignItems: 'center'
  },
  modalButtonConfirm: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    marginLeft: 8,
    alignItems: 'center'
  },
  modalButtonText: {
    fontWeight: 'bold'
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarEditText: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  editProfileCard: {
    width: '92%',
    maxWidth: 420,
    maxHeight: '90%',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  editProfileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 12,
  },
  editProfileTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  editProfileSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  editProfileCloseBtn: {
    padding: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  editFieldRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  editFieldGroup: {
    marginBottom: 12,
  },
  editFieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  editTextInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '600',
  },
  readOnlyEmailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  readOnlyEmailText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  saveButton: {
    marginTop: 16,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  barangayModalCard: {
    width: '92%',
    maxWidth: 420,
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
  },
  passwordModalContainer: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 12,
    padding: 20,
  },
  passwordInputContainer: {
    marginBottom: 16,
  },
  passwordLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  passwordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
  },
  eyeButton: {
    padding: 8,
  },
  passwordRequirements: {
    marginBottom: 20,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 8,
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  requirementText: {
    fontSize: 12,
    marginBottom: 2,
  },
  feedbackModalContainer: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 12,
    padding: 20,
  },
  feedbackQuestion: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
  feedbackRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  feedbackReaction: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 2,
    minWidth: 60,
    flex: 1,
    marginHorizontal: 2,
  },
  feedbackReactionEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  feedbackReactionLabel: {
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
  },
  feedbackInput: {
    height: 100,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    textAlignVertical: 'top',
    fontSize: 14,
  },
  dangerZoneCard: {
    backgroundColor: '#FFF5F5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 16,
    padding: 16,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  dangerZoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  dangerZoneIconBg: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerZoneTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#DC2626',
  },
  dangerZoneSubtitle: {
    fontSize: 11,
    color: '#991B1B',
    fontWeight: '500',
  },
  dangerZoneDesc: {
    fontSize: 12,
    color: '#7F1D1D',
    lineHeight: 18,
    marginBottom: 14,
  },
  deleteAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#DC2626',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  deleteAccountBtnText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteConfirmModalCard: {
    width: '90%',
    maxWidth: 390,
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  deleteModalBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 4,
    borderColor: '#FEF2F2',
  },
  deleteModalInnerBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteModalTitle: {
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  deleteModalSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 6,
  },
  deleteImpactBox: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  deleteImpactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteImpactIcon: {
    marginTop: 1,
  },
  deleteImpactText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    lineHeight: 16,
  },
  deletePasswordSection: {
    width: '100%',
    marginBottom: 10,
  },
  deletePasswordLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  deletePasswordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
  },
  deletePasswordInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  deleteErrorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingHorizontal: 4,
    alignSelf: 'flex-start',
  },
  deleteErrorText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  deleteModalButtons: {
    width: '100%',
    gap: 8,
    marginTop: 4,
  },
  deleteConfirmBtn: {
    backgroundColor: '#DC2626',
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  deleteConfirmBtnDisabled: {
    opacity: 0.5,
  },
  deleteBtnLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteConfirmBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteCancelBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  deleteSuccessModalCard: {
    width: '90%',
    maxWidth: 380,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  deleteSuccessBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 4,
    borderColor: '#D1FAE5',
  },
  deleteSuccessInnerBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteSuccessTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  deleteSuccessSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
    paddingHorizontal: 6,
  },
  deleteSuccessDetailBox: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 20,
    gap: 8,
  },
  deleteSuccessDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteSuccessDetailText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  deleteSuccessBtn: {
    backgroundColor: '#10B981',
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  deleteSuccessBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});

