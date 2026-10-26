import React, { useState, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import { MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
let ExpoCameraModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ExpoCameraModule = require('expo-camera');
} catch (e) {
  console.warn('[StartShiftQrScannerModal] ExpoCamera native module unavailable:', e);
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
import { verifyFleetInventoryQr, parseFleetInventoryQr } from '@/services/fleetInventoryQrService';
import { pickAndScanQrImage } from '@/services/qrImageScannerService';

export interface StartShiftQrScannerModalProps {
  visible: boolean;
  onClose: () => void;
  targetTruck?: {
    id: string;
    plateNumber: string;
    type?: string;
  } | null;
  driverUid?: string;
  onVerified: (scannedData: string, truckInfo?: { truckId: string; plateNumber: string; barangay?: string; truckType?: string }) => void;
  isStartingShift?: boolean;
}

export default function StartShiftQrScannerModal({
  visible,
  onClose,
  targetTruck,
  driverUid,
  onVerified,
  isStartingShift = false,
}: StartShiftQrScannerModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [isVerifying, setIsVerifying] = useState(false);
  const [scannedOnce, setScannedOnce] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (visible) {
      setScannedOnce(false);
      setIsVerifying(false);
      setErrorMessage('');
      setIsUploading(false);
      if (isExpoCameraAvailable && !permission?.granted) {
        requestPermission();
      }
    }
  }, [visible]);

  const processQrData = async (rawQrString: string) => {
    if (isVerifying || scannedOnce || isStartingShift) return;

    setScannedOnce(true);
    setIsVerifying(true);
    setErrorMessage('');

    try {
      if (targetTruck) {
        const verification = verifyFleetInventoryQr(rawQrString, targetTruck, driverUid);
        if (!verification.valid) {
          setErrorMessage(verification.error || 'Invalid Fleet Inventory QR.');
          setIsVerifying(false);
          setScannedOnce(false);
          return;
        }
        onVerified(rawQrString, {
          truckId: targetTruck.id,
          plateNumber: targetTruck.plateNumber,
          truckType: targetTruck.type,
        });
      } else {
        const parsed = parseFleetInventoryQr(rawQrString);
        if (!parsed.valid || !parsed.truckId || !parsed.plateNumber) {
          setErrorMessage(parsed.error || 'Scanned QR is not a valid Fleet Inventory badge.');
          setIsVerifying(false);
          setScannedOnce(false);
          return;
        }
        onVerified(rawQrString, {
          truckId: parsed.truckId,
          plateNumber: parsed.plateNumber,
          barangay: parsed.barangay,
          truckType: parsed.truckType,
        });
      }
    } catch (err: any) {
      console.error('Start Shift QR verification error:', err);
      setErrorMessage(err.message || 'QR verification failed. Please try again.');
      setIsVerifying(false);
      setScannedOnce(false);
    }
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (data) {
      processQrData(data);
    }
  };

  const handleUploadQrImage = async () => {
    if (isVerifying || scannedOnce || isStartingShift || isUploading) return;
    setIsUploading(true);
    setErrorMessage('');

    try {
      const scanResult = await pickAndScanQrImage();
      if (!scanResult.success || !scanResult.data) {
        if (scanResult.error && scanResult.error !== 'Image selection cancelled.') {
          setErrorMessage(scanResult.error);
        }
        return;
      }

      await processQrData(scanResult.data);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to scan QR from selected image.');
    } finally {
      setIsUploading(false);
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
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Scan Fleet Inventory QR</Text>
            <Text style={styles.headerSubtitle}>Verify Vehicle & Start On Duty Shift</Text>
          </View>
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

        {/* Assigned Vehicle Target Banner */}
        {targetTruck && (
          <View style={styles.truckTargetBanner}>
            <FontAwesome5 name="truck" size={14} color="#10B981" />
            <Text style={styles.truckTargetText}>
              Assigned Truck: <Text style={styles.truckTargetBold}>{targetTruck.plateNumber}</Text>
            </Text>
          </View>
        )}

        {/* Scanner Body */}
        <View style={styles.cameraContainer}>
          {isExpoCameraAvailable && CameraView && permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing="back"
              enableTorch={torchEnabled}
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={scannedOnce || isVerifying || isStartingShift ? undefined : handleBarcodeScanned}
            />
          ) : !isExpoCameraAvailable ? (
            <View style={styles.permissionFallback}>
              <MaterialIcons name="qr-code-scanner" size={48} color="#94A3B8" />
              <Text style={styles.permissionTitle}>Badge Verification</Text>
              <Text style={styles.permissionDesc}>
                Camera is not loaded in this environment. Upload a badge image below to verify your vehicle badge.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <TouchableOpacity
                  onPress={handleUploadQrImage}
                  style={[styles.permissionBtn, { backgroundColor: '#2563EB' }]}
                  activeOpacity={0.8}
                  disabled={isUploading}
                >
                  <Text style={styles.permissionBtnText}>{isUploading ? 'Scanning...' : 'Upload Badge Image'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.permissionFallback}>
              <MaterialIcons name="camera-alt" size={54} color="#64748B" />
              <Text style={styles.permissionTitle}>Camera Permission Required</Text>
              <Text style={styles.permissionDesc}>
                Please grant camera access or upload your Fleet Inventory badge image to start your shift.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <TouchableOpacity
                  onPress={requestPermission}
                  style={styles.permissionBtn}
                  activeOpacity={0.8}
                >
                  <Text style={styles.permissionBtnText}>Grant Camera Access</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleUploadQrImage}
                  style={[styles.permissionBtn, { backgroundColor: '#2563EB' }]}
                  activeOpacity={0.8}
                  disabled={isUploading}
                >
                  <Text style={styles.permissionBtnText}>{isUploading ? 'Scanning...' : 'Upload Badge Image'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Scanner Overlay UI */}
          <View style={styles.overlay} pointerEvents="none">
            <View style={styles.scanTargetBox}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />

              {(isVerifying || isStartingShift || isUploading) && (
                <View style={styles.verifyingOverlay}>
                  <ActivityIndicator size="large" color="#10B981" />
                  <Text style={styles.verifyingText}>
                    {isUploading ? 'Scanning QR from image...' : 'Verifying Fleet QR & Starting Shift...'}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.scanHint}>
              Point camera at the Fleet Inventory QR Code on the vehicle or CENRO Dispatch badge
            </Text>
          </View>
        </View>

        {/* Error Notification */}
        {!!errorMessage && (
          <View style={styles.errorBanner}>
            <MaterialIcons name="error-outline" size={20} color="#EF4444" />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        {/* Bottom Bar */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            onPress={handleUploadQrImage}
            style={[styles.actionBtn, { backgroundColor: '#2563EB' }]}
            activeOpacity={0.7}
            disabled={isUploading || isVerifying || isStartingShift}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <MaterialIcons name="photo-library" size={18} color="#FFFFFF" />
                <Text style={styles.actionBtnText}>Upload QR Image</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
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
    paddingTop: Platform.OS === 'ios' ? 52 : 20,
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
  torchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
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
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0F172A',
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
    borderBottomRightRadius: 10,
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
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
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
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
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
    minHeight: 46,
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
