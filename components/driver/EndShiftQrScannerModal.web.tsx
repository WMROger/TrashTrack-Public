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
import { MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import jsQR from 'jsqr';
import { verifyFleetInventoryQr } from '@/services/fleetInventoryQrService';

export interface EndShiftQrScannerModalProps {
  visible: boolean;
  onClose: () => void;
  currentTruck: {
    id: string;
    plateNumber: string;
    type?: string;
    shiftStartedAt?: any;
  } | null;
  driverUid?: string;
  onVerified: (scannedData: string) => void;
  isEndingShift?: boolean;
}

export default function EndShiftQrScannerModalWeb({
  visible,
  onClose,
  currentTruck,
  driverUid,
  onVerified,
  isEndingShift = false,
}: EndShiftQrScannerModalProps) {
  const [isVerifying, setIsVerifying] = useState(false);
  const [scannedOnce, setScannedOnce] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        setWebcamActive(true);
        scanFrame();
      }
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

  const scanFrame = () => {
    if (scannedOnce || isVerifying || isEndingShift) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
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

  useEffect(() => {
    if (visible) {
      setScannedOnce(false);
      setIsVerifying(false);
      setErrorMessage('');
      startWebcam();
    } else {
      stopWebcam();
    }
    return () => {
      stopWebcam();
    };
  }, [visible]);

  const processQrData = async (rawQrString: string) => {
    if (isVerifying || scannedOnce || isEndingShift) return;
    if (!currentTruck) {
      setErrorMessage('No active truck assigned.');
      return;
    }

    setScannedOnce(true);
    setIsVerifying(true);
    setErrorMessage('');

    try {
      const verification = verifyFleetInventoryQr(rawQrString, currentTruck, driverUid);

      if (!verification.valid) {
        setErrorMessage(verification.error || 'Invalid Fleet Inventory QR.');
        setIsVerifying(false);
        setScannedOnce(false);
        // resume frame scanning if webcam is active
        if (webcamActive) {
          animFrameIdRef.current = requestAnimationFrame(scanFrame);
        }
        return;
      }

      stopWebcam();
      onVerified(rawQrString);
    } catch (err: any) {
      console.error('End Shift QR verification error:', err);
      setErrorMessage(err.message || 'QR verification failed. Please try again.');
      setIsVerifying(false);
      setScannedOnce(false);
      if (webcamActive) {
        animFrameIdRef.current = requestAnimationFrame(scanFrame);
      }
    }
  };

  const handleFileUpload = (e: any) => {
    const file = e.target?.files?.[0];
    if (!file) return;

    setErrorMessage('');
    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setErrorMessage('Could not process badge image.');
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          processQrData(code.data);
        } else {
          setErrorMessage('No valid QR code detected in the uploaded image. Please ensure the badge is clear.');
          setIsVerifying(false);
        }
      };
      img.onerror = () => {
        setErrorMessage('Failed to read image file.');
        setIsVerifying(false);
      };
      img.src = uploadEvent.target?.result as string;
    };
    reader.readAsDataURL(file);
    if (e.target) {
      e.target.value = '';
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <MaterialIcons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Scan Fleet Inventory QR</Text>
            <Text style={styles.headerSubtitle}>Record Time Out & End Shift</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Target Truck Banner */}
        {currentTruck && (
          <View style={styles.truckTargetBanner}>
            <FontAwesome5 name="truck" size={14} color="#10B981" />
            <Text style={styles.truckTargetText}>
              Assigned Truck: <Text style={styles.truckTargetBold}>{currentTruck.plateNumber}</Text>
            </Text>
          </View>
        )}

        {/* Video / Camera Frame */}
        <View style={styles.cameraContainer}>
          {/* HTML5 video element for webcam */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              backgroundColor: '#000',
            }}
          >
            <video
              ref={(ref) => {
                videoRef.current = ref;
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: webcamActive ? 'block' : 'none',
              }}
              muted
              playsInline
            />
            <canvas
              ref={(ref) => {
                canvasRef.current = ref;
              }}
              style={{ display: 'none' }}
            />
          </div>

          {/* Web Cam Error / Fallback */}
          {Boolean(webcamError) && !webcamActive && (
            <View style={styles.permissionFallback}>
              <MaterialIcons name="videocam-off" size={48} color="#94A3B8" />
              <Text style={styles.permissionTitle}>Camera Unavailable</Text>
              <Text style={styles.permissionDesc}>{webcamError}</Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                <TouchableOpacity
                  onPress={startWebcam}
                  style={styles.permissionBtn}
                  activeOpacity={0.8}
                >
                  <Text style={styles.permissionBtnText}>Retry Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => fileInputRef.current?.click()}
                  style={[styles.permissionBtn, { backgroundColor: '#2563EB' }]}
                  activeOpacity={0.8}
                >
                  <Text style={styles.permissionBtnText}>Upload Badge</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Target Reticle Overlay */}
          <View style={styles.overlay}>
            <View style={styles.scanTargetBox}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />

              {(isVerifying || isEndingShift) && (
                <View style={styles.verifyingOverlay}>
                  <ActivityIndicator size="large" color="#10B981" />
                  <Text style={styles.verifyingText}>Verifying Fleet QR & Recording Time Out...</Text>
                </View>
              )}
            </View>
            <Text style={styles.scanHint}>
              Point camera at the Fleet Inventory QR Code on the CENRO Dispatch screen or truck badge
            </Text>
          </View>
        </View>

        {/* Error notification */}
        {!!errorMessage && (
          <View style={styles.errorBanner}>
            <MaterialIcons name="error-outline" size={20} color="#EF4444" />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        {/* Bottom Bar */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            onPress={() => fileInputRef.current?.click()}
            style={[styles.actionBtn, { backgroundColor: '#2563EB' }]}
            activeOpacity={0.7}
            disabled={isVerifying || isEndingShift}
          >
            <MaterialIcons name="photo-library" size={18} color="#FFFFFF" />
            <Text style={styles.actionBtnText}>Upload Badge Image</Text>
          </TouchableOpacity>
        </View>

        {/* Hidden File Input for Image Upload */}
        <input
          ref={fileInputRef as any}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />
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
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#0F172A',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleWrap: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  truckTargetBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#064E3B',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  truckTargetText: {
    fontSize: 13,
    color: '#A7F3D0',
  },
  truckTargetBold: {
    fontWeight: '800',
    color: '#FFFFFF',
  },
  cameraContainer: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#000000',
  },
  permissionFallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0F172A',
    zIndex: 10,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
    marginTop: 16,
  },
  permissionDesc: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 18,
    maxWidth: 320,
  },
  permissionBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 5,
  },
  scanTargetBox: {
    width: 250,
    height: 250,
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
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 10,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 10,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 10,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 10,
  },
  verifyingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  verifyingText: {
    marginTop: 12,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  scanHint: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 280,
    marginTop: 24,
    lineHeight: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
    zIndex: 20,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#B91C1C',
    fontWeight: '600',
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    zIndex: 20,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1E293B',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  manualInputDrawer: {
    backgroundColor: '#1E293B',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    zIndex: 30,
  },
  manualTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  manualInput: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#FFFFFF',
    padding: 10,
    fontSize: 12,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  manualActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  manualCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#334155',
  },
  manualCancelText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  manualSubmitBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#10B981',
  },
  manualSubmitText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
