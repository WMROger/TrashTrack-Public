import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ExportFormat } from '@/services/reportExportService';

interface ExportModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  dataCount: number;
  onExport: (format: ExportFormat) => Promise<void> | void;
  description?: string;
}

export default function ExportModal({
  visible,
  onClose,
  title,
  dataCount,
  onExport,
  description,
}: ExportModalProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 600;
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('pdf');
  const [isExporting, setIsExporting] = useState(false);

  const handleConfirm = async () => {
    setIsExporting(true);
    try {
      await onExport(selectedFormat);
      onClose();
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const formats: {
    id: ExportFormat;
    name: string;
    ext: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    badgeColor: string;
    desc: string;
  }[] = [
    {
      id: 'pdf',
      name: 'Official PDF Document',
      ext: '.PDF',
      icon: 'picture-as-pdf',
      badgeColor: '#DC2626',
      desc: 'Print-ready municipal report with official Danao City CENRO letterhead and signatories.',
    },
    {
      id: 'xlsx',
      name: 'Microsoft Excel Spreadsheet',
      ext: '.XLSX',
      icon: 'table-chart',
      badgeColor: '#16A34A',
      desc: 'Multi-sheet workbook with AutoFilter, auto-sized columns, and Executive Summary.',
    },
    {
      id: 'csv',
      name: 'Comma-Separated Values',
      ext: '.CSV',
      icon: 'description',
      badgeColor: '#2563EB',
      desc: 'Raw structured UTF-8 data table compatible with Excel, Google Sheets, and databases.',
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.dialog, isMobile && styles.dialogMobile]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconCircle}>
                <MaterialIcons name="file-download" size={22} color="#059669" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>Export Report</Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {title}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              disabled={isExporting}
            >
              <MaterialIcons name="close" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Scrollable Body */}
          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={styles.scrollBodyContent}
            showsVerticalScrollIndicator={true}
          >
            {/* Info Banner */}
            <View style={styles.infoBanner}>
              <MaterialIcons name="info-outline" size={18} color="#065F46" />
              <Text style={styles.infoBannerText}>
                {description ||
                  `Exporting ${dataCount} record(s) matching your current filters and jurisdiction.`}
              </Text>
            </View>

            {/* Format Selection Cards */}
            <Text style={styles.sectionLabel}>SELECT EXPORT FORMAT</Text>
            <View style={styles.optionsList}>
              {formats.map((fmt) => {
                const isSelected = selectedFormat === fmt.id;
                return (
                  <TouchableOpacity
                    key={fmt.id}
                    style={[
                      styles.optionCard,
                      isSelected && styles.optionCardSelected,
                    ]}
                    onPress={() => setSelectedFormat(fmt.id)}
                    activeOpacity={0.8}
                    disabled={isExporting}
                  >
                    <View style={styles.optionHeader}>
                      <View style={styles.optionIconRow}>
                        <MaterialIcons
                          name={fmt.icon}
                          size={22}
                          color={isSelected ? '#059669' : fmt.badgeColor}
                        />
                        <Text
                          style={[
                            styles.optionName,
                            isSelected && styles.optionNameSelected,
                          ]}
                        >
                          {fmt.name}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.badge,
                          {
                            backgroundColor: isSelected ? '#DCFCE7' : '#F3F4F6',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            { color: isSelected ? '#065F46' : '#4B5563' },
                          ]}
                        >
                          {fmt.ext}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.optionDesc}>{fmt.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Large Dataset Advisory for PDF */}
            {selectedFormat === 'pdf' && dataCount >= 300 && (
              <View style={styles.largeDataNotice}>
                <MaterialIcons name="warning-amber" size={17} color="#B45309" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.largeDataNoticeText}>
                    <Text style={{ fontWeight: '800', color: '#92400E' }}>Large Dataset ({dataCount.toLocaleString()} records): </Text>
                    Generating a PDF will produce ~{Math.ceil(dataCount / 32)} printed pages. For easy searching, sorting, and filtering,{' '}
                    <Text
                      style={styles.largeDataNoticeLink}
                      onPress={() => setSelectedFormat('xlsx')}
                    >
                      Excel (.xlsx) is recommended
                    </Text>.
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Footer Actions */}
          <View style={[styles.footer, isMobile && styles.footerMobile]}>
            <TouchableOpacity
              style={[styles.cancelBtn, isMobile && { flex: 1, alignItems: 'center', justifyContent: 'center' }]}
              onPress={onClose}
              disabled={isExporting}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.exportBtn,
                isMobile && { flex: 1.6, alignItems: 'center', justifyContent: 'center' },
                isExporting && styles.exportBtnDisabled,
              ]}
              onPress={handleConfirm}
              disabled={isExporting}
            >
              {isExporting ? (
                <>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.exportBtnText}>Generating...</Text>
                </>
              ) : (
                <>
                  <MaterialIcons name="download" size={18} color="#FFFFFF" />
                  <Text style={styles.exportBtnText}>
                    Download {selectedFormat.toUpperCase()}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 9999,
    width: '100%',
    height: '100%',
    ...Platform.select({
      web: {
        position: 'fixed' as any,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw' as any,
        height: '100vh' as any,
      },
    }),
  },
  dialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    width: '100%',
    maxWidth: 520,
    maxHeight: '92%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      },
      default: {
        elevation: 8,
      },
    }),
  },
  dialogMobile: {
    borderRadius: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  scrollBody: {
    flex: 1,
    width: '100%',
  },
  scrollBodyContent: {
    padding: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  headerIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ECFDF5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 16,
  },
  infoBannerText: {
    fontSize: 12,
    color: '#065F46',
    fontWeight: '500',
    flex: 1,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  optionsList: {
    gap: 10,
    marginBottom: 20,
  },
  optionCard: {
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#FAFAFA',
  },
  optionCardSelected: {
    borderColor: '#059669',
    backgroundColor: '#F0FDF4',
  },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  optionIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
  },
  optionNameSelected: {
    color: '#065F46',
  },
  optionDesc: {
    fontSize: 11,
    color: '#6B7280',
    lineHeight: 15,
    marginTop: 2,
    paddingLeft: 30,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  largeDataNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 8,
    padding: 10,
    marginTop: -8,
    marginBottom: 16,
  },
  largeDataNoticeText: {
    fontSize: 11,
    color: '#78350F',
    lineHeight: 16,
  },
  largeDataNoticeLink: {
    color: '#065F46',
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  footerMobile: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#059669',
  },
  exportBtnDisabled: {
    opacity: 0.65,
  },
  exportBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
