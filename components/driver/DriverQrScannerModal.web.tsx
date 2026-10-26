import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  TextInput,
} from 'react-native';
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
import { MaterialIcons } from '@expo/vector-icons';
import jsQR from 'jsqr';
import { authenticateDriverQrLogin, parseDriverQrString, setDriverSessionOrigin } from '@/services/driverQrService';
import { parseFleetInventoryQr } from '@/services/fleetInventoryQrService';
import { scanQrFromWebFile, pickAndScanQrImage } from '@/services/qrImageScannerService';

export interface DriverQrScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onDriverAuthenticated: (driverProfile: any) => void;
  onDriverShiftEnded?: (shiftDetails: any) => void;
  onScanSuccess?: (data: any) => void;
  source?: 'login' | 'resident';
  currentUser?: any;
}

export default function DriverQrScannerModalWeb({
  visible,
  onClose,
  onDriverAuthenticated,
  onDriverShiftEnded,
  onScanSuccess,
  source = 'login',
  currentUser,
}: DriverQrScannerModalProps) {
  const [isVerifying, setIsVerifying] = useState(false);
  const [scannedOnce, setScannedOnce] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState('');
  const [pendingDriverAuth, setPendingDriverAuth] = useState<any>(null);
  const [showDriverPasswordPrompt, setShowDriverPasswordPrompt] = useState(false);
  const [driverPasswordInput, setDriverPasswordInput] = useState('');
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isProcessingRef = useRef(false);

  // Stop camera tracks helper
  const stopWebcam = () => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setWebcamActive(false);
  };

  // Start webcam and frame scanning loop
  const startWebcam = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setWebcamError('Web camera API is not supported in this browser.');
      return;
    }

    try {
      setWebcamError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      const bindAndPlay = async () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          try {
            await videoRef.current.play();
          } catch {}
          setWebcamActive(true);
          scanFrame();
        } else {
          setTimeout(bindAndPlay, 50);
        }
      };
      bindAndPlay();
    } catch (err: any) {
      console.warn('Webcam permission error:', err);
      setWebcamError(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera or upload a badge image.'
          : 'Could not access webcam. You can upload a QR image or enter credentials below.'
      );
      setWebcamActive(false);
    }
  };

  // Scan live video frames using jsQR
  const scanFrame = () => {
    if (scannedOnce || isVerifying || isProcessingRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && canvas && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data) {
          processQrData(code.data);
          return;
        }
      }
    }

    animFrameIdRef.current = requestAnimationFrame(scanFrame);
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
        stopWebcam();
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

  useEffect(() => {
    if (visible) {
      setScannedOnce(false);
      setIsVerifying(false);
      setErrorMessage('');
      setPendingDriverAuth(null);
      setShowDriverPasswordPrompt(false);
      setDriverPasswordInput('');
      setIsSubmittingPassword(false);
      startWebcam();
    } else {
      stopWebcam();
    }

    return () => {
      stopWebcam();
    };
  }, [visible]);

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
          if (webcamActive) animFrameIdRef.current = requestAnimationFrame(scanFrame);
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
            if (webcamActive) animFrameIdRef.current = requestAnimationFrame(scanFrame);
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
          if (webcamActive) animFrameIdRef.current = requestAnimationFrame(scanFrame);
          return;
        }

        const userData = userSnap.data();
        const roleNorm = String(userData.role || '').trim().toLowerCase();
        if (roleNorm !== 'driver' && roleNorm !== 'admin') {
          setErrorMessage('Access Denied: Only registered CENRO drivers can check out or activate fleet trucks.');
          setIsVerifying(false);
          setScannedOnce(false);
          if (webcamActive) animFrameIdRef.current = requestAnimationFrame(scanFrame);
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

          stopWebcam();
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
            if (webcamActive) animFrameIdRef.current = requestAnimationFrame(scanFrame);
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

          stopWebcam();
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
        // Resume webcam scanning loop
        if (webcamActive) {
          animFrameIdRef.current = requestAnimationFrame(scanFrame);
        }
        return;
      }

      // Authenticate through Firestore (Spark Plan) and establish a Firebase session.
      const verifyResult = await authenticateDriverQrLogin(parseResult.payload);
      if (!verifyResult.success || !verifyResult.driver) {
        setErrorMessage(verifyResult.error || 'Authentication rejected. Driver record not found or inactive.');
        setIsVerifying(false);
        setScannedOnce(false);
        if (webcamActive) {
          animFrameIdRef.current = requestAnimationFrame(scanFrame);
        }
        return;
      }

      // If user is already logged in and scanning from within the app (not login screen),
      // verify that the scanned Driver QR badge belongs to their account
      if (source !== 'login' && auth?.currentUser) {
        const currentUid = auth.currentUser.uid;
        const currentEmail = (auth.currentUser.email || '').trim().toLowerCase();
        const badgeUid = (verifyResult.driver.uid || parseResult.payload.uid || '').trim();
        const badgeEmail = (verifyResult.driver.email || parseResult.payload.email || '').trim().toLowerCase();

        const isUidMatch = Boolean(currentUid && badgeUid && currentUid === badgeUid);
        const isEmailMatch = Boolean(currentEmail && badgeEmail && currentEmail === badgeEmail);

        if (!isUidMatch && !isEmailMatch) {
          setErrorMessage('Access Denied: This Driver QR badge is not linked to your currently logged-in account.');
          setIsVerifying(false);
          setScannedOnce(false);
          if (webcamActive) {
            animFrameIdRef.current = requestAnimationFrame(scanFrame);
          }
          return;
        }
      }

      let authedUser: any = options?.authedUser || null;

      if (source === 'login') {
        if (!options?.passwordVerified) {
          // Coming from login: ALWAYS prompt for driver password
          setPendingDriverAuth({
            driver: verifyResult.driver,
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
      const resolvedUid = (source === 'resident' && verifyResult.driver?.id)
        ? verifyResult.driver.id
        : (authedUser?.uid || verifyResult.driver?.id || verifyResult.driver?.uid);
      let assignedTruckId: string | null = verifyResult.driver.currentTruckId || null;
      let assignedTruckPlate: string | null = verifyResult.driver.currentTruckPlate || null;

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

      stopWebcam();
      onDriverAuthenticated({
        ...verifyResult.driver,
        id: resolvedUid,
        uid: resolvedUid,
        email: authedUser.email || verifyResult.driver.email,
        currentTruckId: assignedTruckId,
        currentTruckPlate: assignedTruckPlate,
        dutyStatus: assignedTruckId ? 'on_duty' : 'off_duty',
        status: assignedTruckId ? 'on_duty' : 'off_duty',
      });
    } catch (err: any) {
      console.error('QR verification error:', err);
      const msg = err.message || 'Verification failed. Please try again.';
      setErrorMessage(msg);
      if (typeof window !== 'undefined' && window.alert) {
        window.alert('QR Verification Notice: ' + msg);
      }
      setScannedOnce(false);
      if (webcamActive) {
        animFrameIdRef.current = requestAnimationFrame(scanFrame);
      }
    } finally {
      setIsVerifying(false);
      isProcessingRef.current = false;
    }
  };

  // Process uploaded image file via jsQR on client canvas
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select a valid image file (JPG, PNG, WebP, etc.). Only images can be scanned.');
      return;
    }

    setErrorMessage('');

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            processQrData(code.data);
          } else {
            setErrorMessage('No valid QR code found in uploaded image. Please ensure the QR code is clearly visible.');
            setIsVerifying(false);
          }
        }
      };
      img.onerror = () => {
        setErrorMessage('Failed to read image file.');
        setIsVerifying(false);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);

    // Reset input so re-selecting same file works
    e.target.value = '';
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Top Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <MaterialIcons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.headerTitle}>Driver QR Scanner</Text>
            <Text style={styles.headerSubtitle}>Danao City Official Driver Telemetry</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Content Area */}
        <View style={styles.scannerWrapper}>
          {/* HTML5 Video for Live Webcam (Web Platform) */}
          <video
            ref={videoRef}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: webcamActive ? 'block' : 'none',
            }}
            muted
            playsInline
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Webcam Permission/Error Fallback UI */}
          {!webcamActive && (
            <View style={styles.permissionDeniedBox}>
              <View style={styles.iconCircle}>
                <MaterialIcons name="videocam" size={44} color="#10B981" />
              </View>
              <Text style={styles.permissionTitle}>Live Camera Scanner</Text>
              <Text style={styles.permissionSubtitle}>
                {webcamError ||
                  'Please enable camera permissions to scan your official Danao City driver QR badge live.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: '#10B981' }]}
                  onPress={startWebcam}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="videocam" size={18} color="#FFFFFF" />
                  <Text style={styles.actionButtonText}>Enable Camera</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: '#3B82F6' }]}
                  onPress={() => fileInputRef.current?.click()}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="photo-library" size={18} color="#FFFFFF" />
                  <Text style={styles.actionButtonText}>Upload QR Image</Text>
                </TouchableOpacity>
              </View>
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
                  <Text style={styles.verifyingText}>Authenticating Driver Credentials...</Text>
                </View>
              )}
            </View>
            <Text style={styles.reticlePrompt}>
              Align your official Danao City Driver QR badge inside the frame
            </Text>
          </View>
        </View>

        {/* Hidden File Input for Image Upload */}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="image/*"
          onChange={handleFileUpload}
        />

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
            onPress={() => fileInputRef.current?.click()}
            activeOpacity={0.8}
            disabled={isVerifying}
          >
            <MaterialIcons name="photo-library" size={20} color="#FFFFFF" />
            <Text style={styles.bottomActionText}>Upload Badge Image</Text>
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
                    if (webcamActive) {
                      animFrameIdRef.current = requestAnimationFrame(scanFrame);
                    }
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
    paddingTop: 36,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#0F172A',
    zIndex: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  scannerWrapper: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionDeniedBox: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 440,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 8,
    textAlign: 'center',
  },
  permissionSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reticleOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleTarget: {
    width: 260,
    height: 260,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: '#10B981',
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 6,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 6,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 6,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 6,
  },
  verifyingIndicator: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    gap: 10,
  },
  verifyingText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  reticlePrompt: {
    marginTop: 24,
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#450A0A',
    borderTopWidth: 1,
    borderTopColor: '#7F1D1D',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorBannerText: {
    color: '#FCA5A5',
    fontSize: 12.5,
    fontWeight: '600',
    flex: 1,
  },
  manualInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1E293B',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  manualTextInput: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  manualSubmitBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
  },
  manualSubmitBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  bottomActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  bottomActionText: {
    color: '#FFFFFF',
    fontSize: 12.5,
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
