import React, { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
  Share,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import {
  buildFleetInventoryQrPayload,
  encodeFleetInventoryQrString,
  calculateShiftTiming,
} from '@/services/fleetInventoryQrService';

export interface FleetInventoryQrBadgeModalProps {
  visible: boolean;
  onClose: () => void;
  truck: {
    id: string;
    plateNumber: string;
    type?: string;
    capacity?: string;
    status?: string;
    assignedBarangay?: string;
    barangay?: string;
    assignedDriverId?: string;
    assignedDriverName?: string;
    shiftStartedAt?: any;
  } | null;
}

export default function FleetInventoryQrBadgeModal({
  visible,
  onClose,
  truck,
}: FleetInventoryQrBadgeModalProps) {
  const [copied, setCopied] = useState(false);

  const resolvedPlate = truck?.plateNumber || 'UNKNOWN';
  const resolvedType = truck?.type || 'Compactor';
  const resolvedCapacity = truck?.capacity || 'Standard';
  const resolvedBarangay = truck?.assignedBarangay || truck?.barangay || 'Danao City';
  const isDeployed = Boolean(truck?.shiftStartedAt);
  const isAssigned = Boolean(truck?.assignedDriverId);
  const driverName = truck?.assignedDriverName || (isAssigned ? 'Assigned Driver' : 'None');

  const shiftTiming = useMemo(() => {
    if (!truck?.shiftStartedAt) return null;
    return calculateShiftTiming(truck.shiftStartedAt);
  }, [truck?.shiftStartedAt]);

  const qrString = useMemo(() => {
    if (!truck) return '';
    const payload = buildFleetInventoryQrPayload({
      truckId: truck.id,
      plateNumber: truck.plateNumber,
      barangay: resolvedBarangay,
      truckType: resolvedType,
      assignedDriverId: truck.assignedDriverId,
      assignedDriverName: truck.assignedDriverName,
      shiftStartedAt: truck.shiftStartedAt,
    });
    return encodeFleetInventoryQrString(payload);
  }, [truck, resolvedBarangay, resolvedType]);

  if (!visible || !truck) return null;

  const handleShareOrCopy = async () => {
    let copySuccessful = false;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(qrString);
        copySuccessful = true;
      } else if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = qrString;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copySuccessful = document.execCommand('copy');
        document.body.removeChild(textarea);
      } else {
        await Share.share({
          title: `Fleet Inventory QR - ${resolvedPlate}`,
          message: `Official CENRO Fleet Inventory Shift End QR for Truck ${resolvedPlate}:\n${qrString}`,
        });
        copySuccessful = true;
      }
    } catch (err: any) {
      console.warn('Share error:', err);
      if (typeof document !== 'undefined') {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = qrString;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          copySuccessful = document.execCommand('copy');
          document.body.removeChild(textarea);
        } catch {}
      }
    }

    if (copySuccessful) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handlePrint = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.print) {
      window.print();
    } else {
      Alert.alert('Print Badge', 'Take a screenshot or export this badge to display at the dispatch station.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.badgeContainer}>
          {/* Header */}
          <View style={styles.badgeHeader}>
            <View style={styles.headerLguRow}>
              <MaterialIcons name="local-shipping" size={20} color="#FFFFFF" />
              <Text style={styles.badgeGovText}>CITY GOVERNMENT OF DANAO · CENRO</Text>
            </View>
            <Text style={styles.badgeTitle}>FLEET INVENTORY SHIFT CHECK-OUT BADGE</Text>
            <Text style={styles.badgeSubtitle}>Time-In / Time-Out Dispatch Station</Text>
          </View>

          {/* Body */}
          <View style={styles.badgeBody}>
            {/* Vehicle Card */}
            <View style={styles.truckCard}>
              <View style={styles.truckIconCircle}>
                <FontAwesome5 name="truck" size={18} color="#2E8B57" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.plateRow}>
                  <Text style={styles.plateText}>{resolvedPlate}</Text>
                  <View
                    style={[
                      styles.statusPill,
                      { backgroundColor: isDeployed ? '#ECFDF5' : isAssigned ? '#EFF6FF' : '#F3F4F6' },
                    ]}
                  >
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: isDeployed ? '#10B981' : isAssigned ? '#3B82F6' : '#9CA3AF' },
                      ]}
                    />
                    <Text
                      style={[
                        styles.statusText,
                        { color: isDeployed ? '#047857' : isAssigned ? '#1D4ED8' : '#4B5563' },
                      ]}
                    >
                      {isDeployed ? 'Active Shift' : isAssigned ? 'Assigned (Off Duty)' : 'In Inventory'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.truckSubtext}>
                  {resolvedType} · {resolvedCapacity} · Brgy. {resolvedBarangay}
                </Text>
              </View>
            </View>

            {/* Active Shift Timing Banner (if deployed) */}
            {isDeployed && shiftTiming && (
              <View style={styles.shiftTimingCard}>
                <View style={styles.timingItem}>
                  <Text style={styles.timingLabel}>Time In (Shift Started)</Text>
                  <Text style={styles.timingValue}>{shiftTiming.timeInFormatted}</Text>
                </View>
                <View style={styles.timingDivider} />
                <View style={styles.timingItem}>
                  <Text style={styles.timingLabel}>Driver on Duty</Text>
                  <Text style={styles.timingValue} numberOfLines={1}>{driverName}</Text>
                </View>
              </View>
            )}

            {/* High-Contrast QR Code */}
            <View style={styles.qrWrapper}>
              <QRCode
                value={qrString}
                size={230}
                color="#0F172A"
                backgroundColor="#FFFFFF"
                quietZone={8}
              />
              <Text style={styles.qrScanInstruction}>
                Driver must scan this QR in the Driver App to verify Time In & Time Out and End Shift
              </Text>
            </View>

            {/* CENRO Dispatch Policy Notice */}
            <View style={styles.noticeBox}>
              <MaterialIcons name="verified-user" size={16} color="#059669" />
              <Text style={styles.noticeText}>
                Official Fleet Attendance: Drivers cannot end shift on their own. Scanning records timestamp and releases vehicle.
              </Text>
            </View>
          </View>

          {/* Footer Actions */}
          <View style={styles.badgeFooter}>
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={handleShareOrCopy}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name={copied ? 'check' : 'content-copy'}
                size={16}
                color={copied ? '#059669' : '#374151'}
              />
              <Text style={[styles.shareBtnText, copied && { color: '#059669' }]}>
                {copied ? 'Copied QR Payload' : 'Copy QR Payload'}
              </Text>
            </TouchableOpacity>

            {Platform.OS === 'web' && (
              <TouchableOpacity
                style={styles.printBtn}
                onPress={handlePrint}
                activeOpacity={0.8}
              >
                <MaterialIcons name="print" size={16} color="#374151" />
                <Text style={styles.shareBtnText}>Print</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  badgeContainer: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 15,
  },
  badgeHeader: {
    backgroundColor: '#064E3B',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    alignItems: 'center',
  },
  headerLguRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  badgeGovText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#A7F3D0',
    letterSpacing: 1.2,
  },
  badgeTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  badgeSubtitle: {
    fontSize: 11,
    color: '#D1FAE5',
    marginTop: 2,
  },
  badgeBody: {
    padding: 20,
    alignItems: 'center',
  },
  truckCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
    gap: 12,
  },
  truckIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  plateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  plateText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  truckSubtext: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  shiftTimingCard: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    marginBottom: 14,
  },
  timingItem: {
    flex: 1,
    alignItems: 'center',
  },
  timingLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#047857',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timingValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#064E3B',
    marginTop: 2,
  },
  timingDivider: {
    width: 1,
    backgroundColor: '#A7F3D0',
    marginHorizontal: 8,
  },
  qrWrapper: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 14,
  },
  qrScanInstruction: {
    marginTop: 10,
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 15,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 10,
    padding: 10,
    gap: 8,
    width: '100%',
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    color: '#15803D',
    lineHeight: 15,
  },
  badgeFooter: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 10,
    alignItems: 'center',
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 9,
  },
  printBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  shareBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  closeBtn: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
