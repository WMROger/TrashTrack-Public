import React, { useMemo, useRef, useState } from 'react';
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
import { MaterialIcons } from '@expo/vector-icons';
import { buildDriverQrPayload, encodeDriverQrString } from '@/services/driverQrService';

export interface DriverQrBadgeModalProps {
  visible: boolean;
  onClose: () => void;
  driverData: {
    uid?: string;
    id?: string;
    name?: string;
    fullName?: string;
    email?: string;
    employeeId?: string;
    licenseNumber?: string;
    barangay?: string;
    assignedBarangay?: string;
    truck?: string;
    plateNumber?: string;
    qrLoginToken?: string;
    authKey?: string;
  } | null;
}

function buildDriverBadgePrintHtml(params: {
  name: string;
  employeeId: string;
  barangay: string;
  license: string;
  truck: string;
  svgHtml: string;
}): string {
  const { name, employeeId, barangay, license, truck, svgHtml } = params;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Driver Credential Badge - ${name}</title>
  <style>
    @page {
      size: auto;
      margin: 0mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background-color: #F8FAFC;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .print-wrapper {
      width: 100%;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
    }
    .cut-guide-wrap {
      position: relative;
      width: 440px;
      margin: 0 auto;
      padding: 12px;
      border: 1.5px dashed #64748B;
      border-radius: 22px;
      background: #FFFFFF;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);
    }
    .cut-guide-label {
      position: absolute;
      top: -9px;
      left: 20px;
      background: #FFFFFF;
      padding: 0 8px;
      font-size: 9.5px;
      font-weight: 700;
      color: #64748B;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .badge-card {
      width: 100%;
      background: #FFFFFF;
      border-radius: 16px;
      border: 2px solid #1E4E38;
      overflow: hidden;
      text-align: center;
      page-break-inside: avoid;
    }
    .badge-header {
      background: #1E4E38 !important;
      color: #FFFFFF !important;
      padding: 18px 16px;
      border-bottom: 3px solid #166534;
    }
    .gov-seal-row {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.12);
      padding: 3px 10px;
      border-radius: 12px;
      margin-bottom: 6px;
    }
    .gov-sub {
      color: #86EFAC !important;
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      margin: 0;
    }
    .badge-title {
      font-size: 14.5px;
      font-weight: 900;
      letter-spacing: 0.5px;
      margin: 0;
      color: #FFFFFF !important;
    }
    .badge-body {
      padding: 24px 20px 20px;
    }
    .driver-name {
      font-size: 24px;
      font-weight: 900;
      color: #0F172A;
      margin: 0 0 8px 0;
      letter-spacing: -0.3px;
    }
    .badge-tags {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 18px;
    }
    .tag {
      font-size: 11.5px;
      font-weight: 800;
      padding: 4px 10px;
      border-radius: 6px;
      letter-spacing: 0.3px;
    }
    .tag-id {
      background: #F1F5F9;
      color: #334155;
      border: 1px solid #CBD5E1;
    }
    .tag-brgy {
      background: #DCFCE7;
      color: #166534;
      border: 1px solid #86EFAC;
    }
    .qr-container {
      background: #FFFFFF;
      border: 1.5px solid #E2E8F0;
      border-radius: 14px;
      padding: 14px;
      display: inline-block;
      margin-bottom: 12px;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.03);
    }
    .qr-container svg,
    .qr-container img {
      width: 240px;
      height: 240px;
      display: block;
      margin: 0 auto;
    }
    .qr-hint {
      font-size: 11.5px;
      font-weight: 600;
      color: #64748B;
      margin-bottom: 18px;
    }
    .details-table {
      width: 100%;
      background: #F8FAFC;
      border-radius: 10px;
      border: 1.5px solid #E2E8F0;
      padding: 12px 10px;
      display: flex;
      margin-bottom: 16px;
    }
    .col {
      flex: 1;
      text-align: center;
    }
    .col-label {
      font-size: 9.5px;
      font-weight: 800;
      color: #64748B;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      margin-bottom: 3px;
    }
    .col-val {
      font-size: 13.5px;
      font-weight: 900;
      color: #0F172A;
    }
    .col-divider {
      width: 1px;
      background: #CBD5E1;
      margin: 0 4px;
    }
    .badge-footer {
      font-size: 10px;
      font-weight: 700;
      color: #64748B;
      border-top: 1px dashed #E2E8F0;
      padding-top: 12px;
    }
    @media print {
      html, body {
        background: #FFFFFF !important;
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        height: 100% !important;
      }
      .print-wrapper {
        width: 100% !important;
        min-height: auto !important;
        padding-top: 25mm !important;
        padding-bottom: 0 !important;
        display: block !important;
      }
      .cut-guide-wrap {
        margin: 0 auto !important;
        width: 440px !important;
        box-shadow: none !important;
      }
      .badge-card {
        border: 2px solid #1E4E38 !important;
        box-shadow: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="print-wrapper">
    <div class="cut-guide-wrap">
      <div class="cut-guide-label">✂ Cut along dashed line for lanyard badge / display</div>
      <div class="badge-card">
        <div class="badge-header">
          <div class="gov-seal-row">
            <span class="gov-sub">CITY GOVERNMENT OF DANAO · CENRO</span>
          </div>
          <h1 class="badge-title">OFFICIAL DRIVER CREDENTIAL BADGE</h1>
        </div>
        <div class="badge-body">
          <div class="driver-name">${name}</div>
          <div class="badge-tags">
            <span class="tag tag-id">${employeeId}</span>
            <span class="tag tag-brgy">Brgy. ${barangay}</span>
          </div>
          <div class="qr-container">
            ${svgHtml || '<div style="width:240px;height:240px;display:flex;align-items:center;justify-content:center;color:#64748B;">QR Code</div>'}
          </div>
          <div class="qr-hint">Scan with TrashTrack Driver App to login instantly</div>
          <div class="details-table">
            <div class="col">
              <div class="col-label">LICENSE NO.</div>
              <div class="col-val">${license}</div>
            </div>
            <div class="col-divider"></div>
            <div class="col">
              <div class="col-label">ASSIGNED TRUCK</div>
              <div class="col-val">${truck}</div>
            </div>
          </div>
          <div class="badge-footer">
            City Environment and Natural Resources Office (CENRO) · Danao City
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function downloadBadgePngWeb(
  svgElem: SVGElement | null,
  driver: {
    name: string;
    employeeId: string;
    barangay: string;
    license: string;
    truck: string;
  },
  onSuccess: () => void,
  onError: () => void
) {
  if (typeof document === 'undefined' || !svgElem) {
    onError();
    return;
  }

  try {
    const width = 640;
    const height = 900;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onError();
      return;
    }

    // Outer Background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, width - 20, height - 20);

    // Header Banner
    ctx.fillStyle = '#1E4E38';
    ctx.fillRect(10, 10, width - 20, 110);

    // Header Text
    ctx.fillStyle = '#86EFAC';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CITY GOVERNMENT OF DANAO · CENRO', width / 2, 48);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('OFFICIAL DRIVER CREDENTIAL BADGE', width / 2, 85);

    // Driver Name
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(driver.name, width / 2, 175);

    // Subtitle / Tags
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(`ID: ${driver.employeeId}   |   Brgy. ${driver.barangay}`, width / 2, 210);

    // Serialize SVG
    let svgString = new XMLSerializer().serializeToString(svgElem);
    if (!svgString.includes('xmlns=')) {
      svgString = svgString.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    }
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();

    img.onload = () => {
      // QR Code Box
      const qrSize = 340;
      const qrX = (width - qrSize) / 2;
      const qrY = 240;

      ctx.fillStyle = '#F8FAFC';
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 2;
      ctx.fillRect(qrX - 15, qrY - 15, qrSize + 30, qrSize + 30);
      ctx.strokeRect(qrX - 15, qrY - 15, qrSize + 30, qrSize + 30);

      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);
      URL.revokeObjectURL(url);

      // Scan Instruction
      ctx.fillStyle = '#64748B';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Scan with TrashTrack Driver App to login instantly.', width / 2, 630);

      // Details Box
      const boxY = 660;
      const boxH = 90;
      ctx.fillStyle = '#F1F5F9';
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1;
      ctx.fillRect(40, boxY, width - 80, boxH);
      ctx.strokeRect(40, boxY, width - 80, boxH);

      // Column Divider
      ctx.beginPath();
      ctx.moveTo(width / 2, boxY + 10);
      ctx.lineTo(width / 2, boxY + boxH - 10);
      ctx.stroke();

      // Col 1: License No
      ctx.fillStyle = '#64748B';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LICENSE NO.', width / 4 + 20, boxY + 32);
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(driver.license, width / 4 + 20, boxY + 62);

      // Col 2: Assigned Truck
      ctx.fillStyle = '#64748B';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('ASSIGNED TRUCK', (width * 3) / 4 - 20, boxY + 32);
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(driver.truck, (width * 3) / 4 - 20, boxY + 62);

      // Footer
      ctx.fillStyle = '#94A3B8';
      ctx.font = '11px sans-serif';
      ctx.fillText('City Environment and Natural Resources Office (CENRO) · Danao City', width / 2, 810);

      // Trigger download
      canvas.toBlob((blob) => {
        if (!blob) {
          onError();
          return;
        }
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        const sanitizedName = driver.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const sanitizedId = driver.employeeId.replace(/[^a-zA-Z0-9_-]/g, '_');
        a.download = `Driver_Badge_${sanitizedId}_${sanitizedName}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 8000);
        onSuccess();
      }, 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      onError();
    };

    img.src = url;
  } catch {
    onError();
  }
}

export default function DriverQrBadgeModal({
  visible,
  onClose,
  driverData,
}: DriverQrBadgeModalProps) {
  const qrSvgRef = useRef<any>(null);
  const resolvedName = driverData?.name || driverData?.fullName || 'Official Driver';
  const resolvedEmail = driverData?.email || '';
  const resolvedEmployeeId = driverData?.employeeId || 'CENRO-DRV';
  const resolvedUid = driverData?.uid || driverData?.id || '';
  const resolvedBarangay = driverData?.assignedBarangay || driverData?.barangay || 'Danao City';
  const resolvedTruck = driverData?.truck || driverData?.plateNumber || 'Pending Assignment';
  const resolvedLicense = driverData?.licenseNumber || 'N/A';
  const resolvedToken = driverData?.qrLoginToken || '';
  const resolvedAuthKey = driverData?.authKey || undefined;

  const [feedback, setFeedback] = useState<string | null>(null);

  const qrString = useMemo(() => {
    const payload = buildDriverQrPayload({
      uid: resolvedUid,
      email: resolvedEmail,
      employeeId: resolvedEmployeeId,
      name: resolvedName,
      qrLoginToken: resolvedToken,
      authKey: resolvedAuthKey,
      assignedBarangay: resolvedBarangay,
      plateNumber: resolvedTruck,
    });
    return encodeDriverQrString(payload);
  }, [resolvedUid, resolvedEmail, resolvedEmployeeId, resolvedName, resolvedToken, resolvedAuthKey, resolvedBarangay, resolvedTruck]);

  if (!visible || !driverData) return null;

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  };

  const getSvgElement = (): SVGElement | null => {
    if (typeof document === 'undefined') return null;
    return document.getElementById('driver-qr-badge-svg-container')?.querySelector('svg') || null;
  };

  const handleDownloadBadge = async () => {
    if (Platform.OS === 'web') {
      const svgElem = getSvgElement();
      downloadBadgePngWeb(
        svgElem,
        {
          name: resolvedName,
          employeeId: resolvedEmployeeId,
          barangay: resolvedBarangay,
          license: resolvedLicense,
          truck: resolvedTruck,
        },
        () => showFeedback('Badge PNG downloaded! Ready to print or display.'),
        () => {
          // Fallback: download HTML badge file
          try {
            let svgHtml = '';
            if (svgElem) {
              svgHtml = new XMLSerializer().serializeToString(svgElem);
            }
            const html = buildDriverBadgePrintHtml({
              name: resolvedName,
              employeeId: resolvedEmployeeId,
              barangay: resolvedBarangay,
              license: resolvedLicense,
              truck: resolvedTruck,
              svgHtml,
            });
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Driver_Badge_${resolvedEmployeeId}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            showFeedback('Badge saved as HTML file.');
          } catch {
            Alert.alert('Download Error', 'Could not generate badge image.');
          }
        }
      );
    } else {
      // Native PDF print / export
      try {
        let base64Png = '';
        if (qrSvgRef.current?.toDataURL) {
          await new Promise<void>((resolve) => {
            try {
              qrSvgRef.current.toDataURL((data: string) => {
                base64Png = data;
                resolve();
              });
            } catch {
              resolve();
            }
          });
        }
        const imgTag = base64Png ? `<img src="data:image/png;base64,${base64Png}" />` : '';
        const html = buildDriverBadgePrintHtml({
          name: resolvedName,
          employeeId: resolvedEmployeeId,
          barangay: resolvedBarangay,
          license: resolvedLicense,
          truck: resolvedTruck,
          svgHtml: imgTag,
        });

        const Print = await import('expo-print');
        const file = await Print.printToFileAsync({ html });
        if (file?.uri) {
          await Share.share({
            title: `Driver Badge - ${resolvedName}`,
            url: file.uri,
            message: `Official CENRO Driver Credential Badge for ${resolvedName} (${resolvedEmployeeId})`,
          });
          showFeedback('Badge exported successfully!');
        }
      } catch (err: any) {
        console.warn('Native badge export error:', err);
        Alert.alert('Export Error', 'Unable to export badge on this device.');
      }
    }
  };

  const handlePrintBadge = async () => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      const svgElem = getSvgElement();
      let svgHtml = '';
      if (svgElem) {
        svgHtml = new XMLSerializer().serializeToString(svgElem);
      }
      const html = buildDriverBadgePrintHtml({
        name: resolvedName,
        employeeId: resolvedEmployeeId,
        barangay: resolvedBarangay,
        license: resolvedLicense,
        truck: resolvedTruck,
        svgHtml,
      });

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        showFeedback('Opening print window...');
        setTimeout(() => {
          printWindow.print();
        }, 300);
        return;
      }
      showFeedback('Print pop-up blocked. Triggering download instead.');
      handleDownloadBadge();
    } else {
      // Native print
      try {
        let base64Png = '';
        if (qrSvgRef.current?.toDataURL) {
          await new Promise<void>((resolve) => {
            try {
              qrSvgRef.current.toDataURL((data: string) => {
                base64Png = data;
                resolve();
              });
            } catch {
              resolve();
            }
          });
        }
        const imgTag = base64Png ? `<img src="data:image/png;base64,${base64Png}" />` : '';
        const html = buildDriverBadgePrintHtml({
          name: resolvedName,
          employeeId: resolvedEmployeeId,
          barangay: resolvedBarangay,
          license: resolvedLicense,
          truck: resolvedTruck,
          svgHtml: imgTag,
        });

        const Print = await import('expo-print');
        await Print.printAsync({ html });
      } catch (err: any) {
        console.warn('Native print error:', err);
        Alert.alert('Print Error', 'Could not open print preview.');
      }
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.badgeContainer}>
          {/* Official Badge Header */}
          <View style={styles.badgeHeader}>
            <View style={styles.headerLguRow}>
              <MaterialIcons name="local-shipping" size={20} color="#FFFFFF" />
              <Text style={styles.badgeGovText}>CITY GOVERNMENT OF DANAO · CENRO</Text>
            </View>
            <Text style={styles.badgeTitle}>OFFICIAL DRIVER CREDENTIAL BADGE</Text>
          </View>

          {/* Badge Body */}
          <View style={styles.badgeBody}>
            {/* Driver Identity Summary */}
            <View style={styles.driverInfoCard}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitials}>
                  {resolvedName
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverNameText} numberOfLines={1}>
                  {resolvedName}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.empIdBadge}>{resolvedEmployeeId}</Text>
                  <Text style={styles.barangayTag}>Brgy. {resolvedBarangay}</Text>
                </View>
              </View>
            </View>

            {/* High-Contrast Centered QR Code */}
            <View nativeID="driver-qr-badge-svg-container" style={styles.qrWrapper}>
              <QRCode
                getRef={(ref) => {
                  qrSvgRef.current = ref;
                }}
                value={qrString}
                size={190}
                color="#0F172A"
                backgroundColor="#FFFFFF"
                logoSize={36}
                logoMargin={2}
                logoBorderRadius={18}
              />
              <Text style={styles.qrScanInstruction}>
                Scan with the Driver App to login instantly. Rotates daily at 6:00 AM.
              </Text>
            </View>

            {/* Driver Metadata Pill Details */}
            <View style={styles.metadataGrid}>
              <View style={styles.metaCol}>
                <Text style={styles.metaLabel}>LICENSE NO.</Text>
                <Text style={styles.metaVal}>{resolvedLicense}</Text>
              </View>
              <View style={styles.metaDivider} />
              <View style={styles.metaCol}>
                <Text style={styles.metaLabel}>ASSIGNED TRUCK</Text>
                <Text style={styles.metaVal}>{resolvedTruck}</Text>
              </View>
            </View>

            {/* Feedback Toast Banner */}
            {feedback && (
              <View style={styles.feedbackBanner}>
                <MaterialIcons name="check-circle" size={15} color="#047857" />
                <Text style={styles.feedbackBannerText}>{feedback}</Text>
              </View>
            )}
          </View>

          {/* Action Buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtnDownload}
              onPress={handleDownloadBadge}
              activeOpacity={0.8}
            >
              <MaterialIcons name="file-download" size={18} color="#FFFFFF" />
              <Text style={styles.actionBtnDownloadText}>Download</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtnPrint}
              onPress={handlePrintBadge}
              activeOpacity={0.8}
            >
              <MaterialIcons name="print" size={17} color="#1E4E38" />
              <Text style={styles.actionBtnPrintText}>Print</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtnDone}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <MaterialIcons name="check" size={17} color="#475569" />
              <Text style={styles.actionBtnDoneText}>Done</Text>
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
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  badgeContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    width: '100%',
    maxWidth: 400,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  badgeHeader: {
    backgroundColor: '#1E4E38',
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  headerLguRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  badgeGovText: {
    color: '#86EFAC',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  badgeTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  badgeBody: {
    padding: 20,
    alignItems: 'center',
  },
  driverInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    width: '100%',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1E4E38',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  driverNameText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  empIdBadge: {
    backgroundColor: '#DCFCE7',
    color: '#166534',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  barangayTag: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  qrWrapper: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    width: '100%',
  },
  qrScanInstruction: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 16,
  },
  metadataGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 14,
    width: '100%',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metaCol: {
    flex: 1,
    alignItems: 'center',
  },
  metaDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  metaLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  metaVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 2,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    alignSelf: 'center',
  },
  feedbackBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  actionBtnDownload: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#1E4E38',
  },
  actionBtnDownloadText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionBtnPrint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  actionBtnPrintText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  actionBtnDone: {
    flex: 0.9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  actionBtnDoneText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
});
