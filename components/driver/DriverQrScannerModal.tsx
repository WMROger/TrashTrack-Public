import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
let ExpoCameraModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ExpoCameraModule = require('expo-camera');
} catch (e) {
  console.warn('[DriverQrScannerModal] ExpoCamera native module unavailable:', e);
}

const CameraView: any = ExpoCameraModule?.CameraView ?? null;
const isExpoCameraAvailable = !!CameraView;

const useCameraPermissionsFallback = () => {
  const [permission] = useState({
    granted: false,
    canAskAgain: false,
    status: 'denied',
    expires: 'never',
  });
  const requestPermission = async () => ({
    granted: false,
    status: 'denied',
    canAskAgain: false,
    expires: 'never',
  });
  return [permission, requestPermission] as const;
};

const useCameraPermissions = ExpoCameraModule?.useCameraPermissions ?? useCameraPermissionsFallback;
import { signInWithCustomToken, signInWithEmailAndPassword } from 'firebase/auth';
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  limit,
  addDoc,
} from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { parseDriverQrString, authenticateDriverQrLogin, setDriverSessionOrigin } from '@/services/driverQrService';
import { parseFleetInventoryQr } from '@/services/fleetInventoryQrService';
import { pickAndScanQrImage } from '@/services/qrImageScannerService';

export interface DriverQrScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onDriverAuthenticated: (driverProfile: any) => void;
  onDriverShiftEnded?: (shiftDetails: any) => void;
  onScanSuccess?: (data: any) => void;
  source?: 'login' | 'resident';
  currentUser?: any;
}

export default function DriverQrScannerModal({
  visible,
  onClose,
  onDriverAuthenticated,
  onDriverShiftEnded,
  onScanSuccess,
  source = 'login',
  currentUser,
}: DriverQrScannerModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [isVerifying, setIsVerifying] = useState(false);
  const [scannedOnce, setScannedOnce] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [pendingDriverAuth, setPendingDriverAuth] = useState<any>(null);
  const [showDriverPasswordPrompt, setShowDriverPasswordPrompt] = useState(false);
  const [driverPasswordInput, setDriverPasswordInput] = useState('');
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setScannedOnce(false);
      setIsVerifying(false);
      setIsUploading(false);
      setErrorMessage('');
      setPendingDriverAuth(null);
      setShowDriverPasswordPrompt(false);
      setDriverPasswordInput('');
      setIsSubmittingPassword(false);
      if (isExpoCameraAvailable && !permission?.granted) {
        requestPermission();
      }
    }
  }, [visible]);

  const handleUploadQrImage = async () => {
    if (isVerifying || isUploading) return;
    setErrorMessage('');
    setIsUploading(true);
    try {
      const scanRes = await pickAndScanQrImage();
      if (scanRes.canceled) {
        setIsUploading(false);
        return;
      }
      if (!scanRes.success || !scanRes.data) {
        setErrorMessage(scanRes.error || 'No valid QR code found in the selected image.');
        setIsUploading(false);
        return;
      }
      await processQrData(scanRes.data, { bypassLock: true });
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to scan uploaded image.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmPasswordLogin = async () => {
    if (!driverPasswordInput.trim() || isSubmittingPassword || !auth || !pendingDriverAuth) return;
    setIsSubmittingPassword(true);
    setErrorMessage('');

    try {
      const driverEmail = pendingDriverAuth.driver.email;
      if (!driverEmail) throw new Error('Driver account has no registered email.');
      // Mark the QR session before sign-in: the root layout redirects to /(driver)
      // as soon as auth changes, and the driver layout guard requires this origin.
      if (source === 'login') await setDriverSessionOrigin('login');
      const cred = await signInWithEmailAndPassword(auth, driverEmail, driverPasswordInput.trim());

      // Cache authKey in driver_qr_credentials so future scans log in automatically
      try {
        if (db) {
          await setDoc(doc(db, 'driver_qr_credentials', cred.user.uid), {
            uid: cred.user.uid,
            email: driverEmail,
            authKey: driverPasswordInput.trim(),
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }
      } catch {}

      const resumeQr = pendingDriverAuth.rawQr;
      setShowDriverPasswordPrompt(false);
      setPendingDriverAuth(null);
      setDriverPasswordInput('');
      setScannedOnce(false);

      if (resumeQr) {
        await processQrData(resumeQr, { bypassLock: true, passwordVerified: true, authedUser: cred.user });
      } else {
        onDriverAuthenticated({
          ...pendingDriverAuth.driver,
          id: cred.user.uid,
          uid: cred.user.uid,
          email: cred.user.email || driverEmail,
        });
      }
    } catch (err: any) {
      console.error('Password confirmation error:', err);
      const isBadPass = err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential';
      setErrorMessage(isBadPass ? 'Incorrect password for this driver account.' : (err?.message || 'Authentication failed.'));
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  const processQrData = async (
    rawQrString: string,
    options?: { bypassLock?: boolean; passwordVerified?: boolean; authedUser?: any }
  ) => {
    if (!options?.bypassLock && (isVerifying || scannedOnce || isProcessingRef.current)) return;
    isProcessingRef.current = true;
    setScannedOnce(true);
    setIsVerifying(true);
    setErrorMessage('');

    try {
      // 1. Check if the scanned QR is an official Fleet Inventory / Truck Dispatch Badge
      const fleetQr = parseFleetInventoryQr(rawQrString);
      const isFleetQr = fleetQr.valid || rawQrString.includes('fleet_inventory') || rawQrString.includes('truck_checkout') || rawQrString.includes('CENRO_DANAO_FLEET_INVENTORY');

      if (isFleetQr) {
        if (!db) throw new Error('Database connection unavailable.');

        // 1. Locate truck document in Firestore first
        let truckDoc: any = null;
        let truckData: any = null;
        let resolvedTruckId = fleetQr.truckId || '';

        if (resolvedTruckId) {
          const tSnap = await getDoc(doc(db, 'trucks', resolvedTruckId));
          if (tSnap.exists()) {
            truckDoc = tSnap;
            truckData = tSnap.data();
          }
        }

        if (!truckData && fleetQr.plateNumber) {
          const cleanPlate = fleetQr.plateNumber.trim().toUpperCase();
          const qTruck = query(collection(db, 'trucks'), where('plateNumber', '==', cleanPlate), limit(1));
          const tSnapQuery = await getDocs(qTruck);
          if (!tSnapQuery.empty) {
            truckDoc = tSnapQuery.docs[0];
            truckData = truckDoc.data();
            resolvedTruckId = truckDoc.id;
          }
        }

        if (!truckData && fleetQr.plateNumber) {
          const cleanPlateAlpha = fleetQr.plateNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          const allTrucksSnap = await getDocs(query(collection(db, 'trucks'), limit(100)));
          for (const d of allTrucksSnap.docs) {
            const dp = (d.data()?.plateNumber || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            if (dp && dp === cleanPlateAlpha) {
              truckDoc = d;
              truckData = d.data();
              resolvedTruckId = d.id;
              break;
            }
          }
        }

        if (!truckData || !resolvedTruckId) {
          setErrorMessage(`Truck "${fleetQr.plateNumber || fleetQr.truckId || 'vehicle'}" was not found in CENRO Fleet Inventory.`);
          setIsVerifying(false);
          setScannedOnce(false);
          return;
        }

        const resolvedPlate = fleetQr.plateNumber || truckData.plateNumber || 'Truck';

        // 2. Resolve the active user session (from options, props, or Firebase Auth)
        let activeUser = options?.authedUser || currentUser || auth?.currentUser;

        // If not yet authenticated (e.g. from login screen or session reload), check assigned driver for this truck
        if (!activeUser) {
          const targetDriverUid = truckData.assignedDriverId || fleetQr.assignedDriverId;
          if (targetDriverUid) {
            try {
              const driverSnap = await getDoc(doc(db, 'users', targetDriverUid));
              if (driverSnap.exists()) {
                const driverData = driverSnap.data();
                const driverEmail = driverData.email;

                // Check for cached credentials to log in seamlessly
                const credSnap = await getDoc(doc(db, 'driver_qr_credentials', targetDriverUid));
                if (credSnap.exists() && credSnap.data()?.authKey && driverEmail) {
                  const autoCred = await signInWithEmailAndPassword(auth, driverEmail, credSnap.data().authKey);
                  if (autoCred?.user) {
                    activeUser = autoCred.user;
                  }
                }

                if (!activeUser) {
                  // Prompt password for assigned driver to complete shift check-out
                  setPendingDriverAuth({
                    driver: { ...driverData, id: targetDriverUid, uid: targetDriverUid },
                    rawQr: rawQrString,
                  });
                  setShowDriverPasswordPrompt(true);
                  setIsVerifying(false);
                  setScannedOnce(false);
                  return;
                }
              }
            } catch (authLookupErr) {
              console.warn('Driver lookup note:', authLookupErr);
            }
          }

          if (!activeUser) {
            setErrorMessage(`Truck ${resolvedPlate} requires driver authentication. Please log in with your Driver account or scan your personal Driver QR badge.`);
            setIsVerifying(false);
            setScannedOnce(false);
            return;
          }
        }

        const activeUid = activeUser.uid;
        const userRef = doc(db, 'users', activeUid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          setErrorMessage('User account record not found in system.');
          setIsVerifying(false);
          setScannedOnce(false);
          return;
        }

        const userData = userSnap.data();
        const roleNorm = String(userData.role || '').trim().toLowerCase();
        if (roleNorm !== 'driver' && roleNorm !== 'admin') {
          setErrorMessage('Access Denied: Only registered CENRO drivers can check out or activate fleet trucks.');
          setIsVerifying(false);
          setScannedOnce(false);
          return;
        }

        const driverName = userData.displayName || userData.name || activeUser.displayName || activeUser.email || 'Driver';

        const isCurrentlyOnThisTruck =
          (userData.dutyStatus === 'on_duty' || userData.status === 'on_duty') &&
          (userData.currentTruckId === resolvedTruckId ||
           (userData.currentTruckPlate && userData.currentTruckPlate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === resolvedPlate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()));

        const resolvedBarangay = (userData.assignedBarangay || userData.barangay || truckData?.assignedBarangay || truckData?.barangay || 'Baliang').trim();

        if (isCurrentlyOnThisTruck) {
          // TIME OUT / END SHIFT
          const { calculateShiftTiming } = await import('@/services/fleetInventoryQrService');
          const timing = calculateShiftTiming(truckData.shiftStartedAt || userData.shiftStartedAt);

          await updateDoc(doc(db, 'trucks', resolvedTruckId), {
            assignedDriverId: null,
            assignedDriverName: null,
            shiftEndedAt: serverTimestamp(),
            lastDriverId: activeUid,
            lastDriverName: driverName,
            lastUsedAt: serverTimestamp(),
            shiftStartedAt: null,
            status: truckData.status === 'maintenance' || truckData.status === 'out_of_service' ? truckData.status : 'active',
            dutyStatus: 'off_duty',
            updatedAt: serverTimestamp(),
          });

          await updateDoc(userRef, {
            currentTruckId: null,
            currentTruckPlate: null,
            dutyStatus: 'off_duty',
            status: 'off_duty',
            lastShiftEndedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          try {
            await addDoc(collection(db, 'truck_usage_history'), {
              truckId: resolvedTruckId,
              truckPlate: resolvedPlate,
              driverId: activeUid,
              driverName: driverName,
              barangay: resolvedBarangay,
              action: 'shift_ended_qr_scan',
              shiftDurationMinutes: timing.durationMinutes,
              shiftDurationFormatted: timing.durationFormatted,
              timeIn: timing.timeIn,
              timeOut: timing.timeOut,
              timestamp: serverTimestamp(),
              createdAt: serverTimestamp(),
              status: 'completed',
            });
          } catch (e) {
            console.warn('Could not record shift ended history:', e);
          }

          await setDriverSessionOrigin('resident');

          onDriverAuthenticated({
            ...userData,
            id: activeUid,
            uid: activeUid,
            email: activeUser?.email || userData.email,
            currentTruckId: null,
            currentTruckPlate: resolvedPlate,
            dutyStatus: 'off_duty',
            status: 'off_duty',
            shiftAction: 'time_out',
            durationFormatted: timing.durationFormatted,
            timeInFormatted: timing.timeInFormatted,
            timeOutFormatted: timing.timeOutFormatted,
          });
          return;
        } else {
          // TIME IN / START SHIFT
          if (truckData.assignedDriverId && truckData.assignedDriverId !== activeUid && (truckData.dutyStatus === 'on_duty' || truckData.status === 'in_use')) {
            const occupant = truckData.assignedDriverName || 'another driver';
            setErrorMessage(`Truck ${resolvedPlate} is currently checked out by ${occupant}. Please verify with CENRO Dispatch.`);
            setIsVerifying(false);
            setScannedOnce(false);
            return;
          }

          await updateDoc(doc(db, 'trucks', resolvedTruckId), {
            assignedDriverId: activeUid,
            assignedDriverName: driverName,
            shiftStartedAt: serverTimestamp(),
            lastDriverId: activeUid,
            lastDriverName: driverName,
            lastUsedAt: serverTimestamp(),
            status: 'active',
            dutyStatus: 'on_duty',
            updatedAt: serverTimestamp(),
          });

          await updateDoc(userRef, {
            currentTruckId: resolvedTruckId,
            currentTruckPlate: resolvedPlate,
            dutyStatus: 'on_duty',
            status: 'on_duty',
            shiftStartedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          try {
            await addDoc(collection(db, 'truck_usage_history'), {
              truckId: resolvedTruckId,
              truckPlate: resolvedPlate,
              driverId: activeUid,
              driverName: driverName,
              barangay: resolvedBarangay,
              action: 'shift_started_qr_scan',
              timestamp: serverTimestamp(),
              createdAt: serverTimestamp(),
              status: 'active',
            });
          } catch (e) {
            console.warn('Could not record shift start history:', e);
          }

          try {
            const { autoAssignQueuedReportsOnDriverShiftStart } = await import('@/services/autoDispatchService');
            autoAssignQueuedReportsOnDriverShiftStart(activeUid, resolvedBarangay, resolvedTruckId, resolvedPlate).catch(() => {});
          } catch {}

          await setDriverSessionOrigin('resident');

          onDriverAuthenticated({
            ...userData,
            id: activeUid,
            uid: activeUid,
            email: activeUser?.email || userData.email,
            currentTruckId: resolvedTruckId,
            currentTruckPlate: resolvedPlate,
            dutyStatus: 'on_duty',
            status: 'on_duty',
            shiftAction: 'time_in',
          });
          return;
        }
      }

      // 2. Otherwise process as Driver Personal QR Credential
      const parseResult = parseDriverQrString(rawQrString);
      if (!parseResult.valid || !parseResult.payload) {
        setErrorMessage(parseResult.error || 'Invalid driver or fleet QR format.');
        setIsVerifying(false);
        setScannedOnce(false);
        return;
      }

      // Validate credential with Firestore
      const authResult = await authenticateDriverQrLogin(parseResult.payload);
      if (!authResult.success || !authResult.driver) {
        setErrorMessage(authResult.error || 'Authentication rejected.');
        setIsVerifying(false);
        setScannedOnce(false);
        return;
      }

      // If user is already logged in and scanning from within the app (not login screen),
      // verify that the scanned Driver QR badge belongs to their account
      if (source !== 'login' && auth?.currentUser) {
        const currentUid = auth.currentUser.uid;
        const currentEmail = (auth.currentUser.email || '').trim().toLowerCase();
        const badgeUid = (authResult.driver.uid || parseResult.payload.uid || '').trim();
        const badgeEmail = (authResult.driver.email || parseResult.payload.email || '').trim().toLowerCase();

        const isUidMatch = Boolean(currentUid && badgeUid && currentUid === badgeUid);
        const isEmailMatch = Boolean(currentEmail && badgeEmail && currentEmail === badgeEmail);

        if (!isUidMatch && !isEmailMatch) {
          setErrorMessage('Access Denied: This Driver QR badge is not linked to your currently logged-in account.');
          setIsVerifying(false);
          setScannedOnce(false);
          return;
        }
      }

      let authedUser: any = options?.authedUser || null;

      if (source === 'login') {
        if (!options?.passwordVerified) {
          // Coming from login: ALWAYS prompt for driver password
          setPendingDriverAuth({
            driver: authResult.driver,
            rawQr: rawQrString,
          });
          setShowDriverPasswordPrompt(true);
          setIsVerifying(false);
          setScannedOnce(false);
          return;
        }
      } else if (source === 'resident') {
        // Resident portal: proceed immediately without requiring password input
        authedUser = auth?.currentUser;
      } else if (!authedUser && auth?.currentUser) {
        authedUser = auth.currentUser;
      }

      // Sync Fleet Inventory assignment state with user profile
      const resolvedUid = (source === 'resident' && authResult.driver?.id)
        ? authResult.driver.id
        : (authedUser?.uid || authResult.driver?.id || authResult.driver?.uid);
      let assignedTruckId: string | null = authResult.driver.currentTruckId || null;
      let assignedTruckPlate: string | null = authResult.driver.currentTruckPlate || null;

      if (db && resolvedUid) {
        try {
          const truckQ = query(collection(db, 'trucks'), where('assignedDriverId', '==', resolvedUid), limit(1));
          const truckSnap = await getDocs(truckQ);
          if (!truckSnap.empty) {
            const trDoc = truckSnap.docs[0];
            const trData = trDoc.data();
            assignedTruckId = trDoc.id;
            assignedTruckPlate = trData.plateNumber || null;

            if (!trData.shiftStartedAt) {
              await updateDoc(doc(db, 'trucks', trDoc.id), {
                shiftStartedAt: serverTimestamp(),
                lastUsedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }

            await updateDoc(doc(db, 'users', resolvedUid), {
              currentTruckId: assignedTruckId,
              currentTruckPlate: assignedTruckPlate,
              assignedTruck: assignedTruckPlate,
              dutyStatus: 'on_duty',
              status: 'on_duty',
              shiftStartedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            assignedTruckId = null;
            assignedTruckPlate = null;
            await updateDoc(doc(db, 'users', resolvedUid), {
              currentTruckId: null,
              currentTruckPlate: null,
              assignedTruck: null,
              dutyStatus: 'off_duty',
              status: 'off_duty',
              updatedAt: serverTimestamp(),
            });
          }
        } catch (syncErr) {
          console.warn('Could not sync driver truck assignment on QR login:', syncErr);
        }
      }

      // QR verification establishes the same Firebase session as password login.
      onDriverAuthenticated({
        ...authResult.driver,
        id: resolvedUid,
        uid: resolvedUid,
        email: authedUser.email || authResult.driver.email,
        currentTruckId: assignedTruckId,
        currentTruckPlate: assignedTruckPlate,
        dutyStatus: assignedTruckId ? 'on_duty' : 'off_duty',
        status: assignedTruckId ? 'on_duty' : 'off_duty',
      });
    } catch (err: any) {
      console.error('QR verification error:', err);
      const msg = err.message || 'Verification failed. Please try again.';
      setErrorMessage(msg);
      Alert.alert('Scan Result', msg);
      setScannedOnce(false);
    } finally {
      setIsVerifying(false);
      isProcessingRef.current = false;
    }
  };

  const handleBarcodeScanned = (result: any) => {
    const raw = typeof result === 'string' ? result : (result?.data || result?.raw || '');
    if (raw && !scannedOnce && !isVerifying && !isProcessingRef.current) {
      processQrData(raw);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Top Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <MaterialIcons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Driver & Fleet QR Scanner</Text>
          <TouchableOpacity
            onPress={() => setTorchEnabled((prev) => !prev)}
            style={styles.torchBtn}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name={torchEnabled ? 'flash-on' : 'flash-off'}
              size={22}
              color={torchEnabled ? '#FDE047' : '#FFFFFF'}
            />
          </TouchableOpacity>
        </View>

        {/* Content Area */}
        <View style={styles.scannerWrapper}>
          {isExpoCameraAvailable && CameraView && permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing="back"
              enableTorch={torchEnabled}
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={scannedOnce ? undefined : handleBarcodeScanned}
            />
          ) : !isExpoCameraAvailable ? (
            <View style={styles.permissionDeniedBox}>
              <MaterialIcons name="videocam-off" size={48} color="#94A3B8" />
              <Text style={styles.permissionTitle}>Live Camera Required</Text>
              <Text style={styles.permissionSubtitle}>
                Camera module is not loaded in this dev build. Please open via Expo Go to scan your live driver QR badge.
              </Text>
            </View>
          ) : (
            <View style={styles.permissionDeniedBox}>
              <MaterialIcons name="videocam-off" size={48} color="#94A3B8" />
              <Text style={styles.permissionTitle}>Camera Permission Required</Text>
              <Text style={styles.permissionSubtitle}>
                Please grant camera access to scan your official driver QR badge live.
              </Text>
              <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
                <Text style={styles.permissionBtnText}>Grant Camera Access</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.permissionBtn, { backgroundColor: '#0284C7', marginTop: 12 }]}
                onPress={handleUploadQrImage}
                disabled={isUploading}
              >
                <Text style={styles.permissionBtnText}>
                  {isUploading ? 'Reading Image...' : 'Upload QR Image from Gallery'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Scanner Reticle Overlay */}
          <View style={styles.reticleOverlay} pointerEvents="none">
            <View style={styles.reticleTarget}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
              {isVerifying && (
                <View style={styles.verifyingIndicator}>
                  <ActivityIndicator size="large" color="#10B981" />
                  <Text style={styles.verifyingText}>Verifying Driver Credentials...</Text>
                </View>
              )}
            </View>
            <Text style={styles.reticlePrompt}>
              Align your daily Driver QR badge inside the frame, or upload QR image
            </Text>
          </View>
        </View>

        {/* Error Notification Bar */}
        {errorMessage ? (
          <View style={styles.errorBanner}>
            <MaterialIcons name="error-outline" size={18} color="#EF4444" />
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Bottom Bar Actions */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.bottomActionBtn}
            onPress={handleUploadQrImage}
            disabled={isVerifying || isUploading}
            activeOpacity={0.8}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <MaterialIcons name="photo-library" size={20} color="#FFFFFF" />
            )}
            <Text style={styles.bottomActionText}>
              {isUploading ? 'Reading...' : 'Upload QR Image'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Driver One-Time Password Confirmation (Spark Plan Auth Key Activation) */}
        {showDriverPasswordPrompt && (
          <View style={styles.passwordPromptOverlay}>
            <View style={styles.passwordPromptCard}>
              <View style={styles.passwordPromptIconWrap}>
                <MaterialIcons name="lock" size={28} color="#10B981" />
              </View>
              <Text style={styles.passwordPromptTitle}>Confirm Driver Login</Text>
              <Text style={styles.passwordPromptSubtitle}>
                Driver: {pendingDriverAuth?.driver?.displayName || 'Driver'}
              </Text>
              <Text style={styles.passwordPromptEmail}>
                {pendingDriverAuth?.driver?.email || ''}
              </Text>

              <TextInput
                style={styles.passwordTextInput}
                placeholder="Enter Driver Password"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                value={driverPasswordInput}
                onChangeText={setDriverPasswordInput}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {errorMessage ? (
                <Text style={styles.passwordPromptError}>{errorMessage}</Text>
              ) : null}

              <View style={styles.passwordPromptActions}>
                <TouchableOpacity
                  style={styles.passwordCancelBtn}
                  onPress={() => {
                    setShowDriverPasswordPrompt(false);
                    setPendingDriverAuth(null);
                    setDriverPasswordInput('');
                    setScannedOnce(false);
                    setIsVerifying(false);
                  }}
                  disabled={isSubmittingPassword}
                >
                  <Text style={styles.passwordCancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.passwordSubmitBtn,
                    (!driverPasswordInput.trim() || isSubmittingPassword) && styles.btnDisabled,
                  ]}
                  onPress={handleConfirmPasswordLogin}
                  disabled={!driverPasswordInput.trim() || isSubmittingPassword}
                >
                  {isSubmittingPassword ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.passwordSubmitText}>Sign In & Start</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#0F172A',
    zIndex: 10,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  torchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  scannerWrapper: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  permissionDeniedBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    marginTop: 16,
    textAlign: 'center',
  },
  permissionSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
  permissionBtn: {
    marginTop: 20,
    backgroundColor: '#10B981',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  reticleOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleTarget: {
    width: 250,
    height: 250,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderColor: '#10B981',
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 10,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 10,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 10,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 10,
  },
  verifyingIndicator: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    gap: 10,
  },
  verifyingText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  reticlePrompt: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 28,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorBannerText: {
    color: '#B91C1C',
    fontSize: 12.5,
    fontWeight: '700',
    flex: 1,
  },
  manualInputContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  manualTextInput: {
    flex: 1,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontSize: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  manualSubmitBtn: {
    backgroundColor: '#10B981',
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualSubmitBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  bottomActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  bottomActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  passwordPromptOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 50,
  },
  passwordPromptCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  passwordPromptIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  passwordPromptTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 4,
    textAlign: 'center',
  },
  passwordPromptSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 4,
  },
  passwordPromptEmail: {
    fontSize: 13,
    fontWeight: '600',
    color: '#10B981',
    marginBottom: 16,
    textAlign: 'center',
  },
  passwordTextInput: {
    width: '100%',
    height: 48,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 16,
    color: '#FFFFFF',
    fontSize: 15,
    marginBottom: 12,
  },
  passwordPromptError: {
    color: '#EF4444',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  passwordPromptActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    marginTop: 4,
  },
  passwordCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  passwordCancelText: {
    color: '#CBD5E1',
    fontWeight: '600',
    fontSize: 14,
  },
  passwordSubmitBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  passwordSubmitText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
