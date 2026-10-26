import { Colors } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import React from 'react';
import {
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { IconSymbol } from './ui/IconSymbol';

interface PickupDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  pickupData: any | null;
}

const PickupDetailsModal: React.FC<PickupDetailsModalProps> = ({
  visible,
  onClose,
  pickupData,
}) => {
  const { theme } = useTheme();
  const colors = Colors[theme ?? 'light'];

  if (!pickupData) return null;

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return '#22C55E';
      case 'pending':
        return '#EAB308';
      case 'cancelled':
        return '#EF4444';
      default:
        return colors.primary;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return 'checkmark.circle.fill';
      case 'pending':
        return 'clock.fill';
      case 'cancelled':
        return 'xmark.circle.fill';
      default:
        return 'info.circle.fill';
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <TouchableOpacity 
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity 
          style={[styles.modalContainer, { backgroundColor: colors.surface }]}
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
              Pickup Details
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <IconSymbol name="xmark" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Status Badge */}
            <View style={styles.statusSection}>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: getStatusColor(pickupData.status) },
                ]}
              >
                <IconSymbol
                  name={getStatusIcon(pickupData.status)}
                  size={16}
                  color="white"
                />
                <Text style={styles.statusText}>
                  {pickupData.status || 'Scheduled'}
                </Text>
              </View>
            </View>

            {/* Location Details */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                Location Information
              </Text>
              <View style={[styles.detailCard, { backgroundColor: colors.background }]}>
                <View style={styles.detailRow}>
                  <IconSymbol name="location.fill" size={20} color={colors.primary} />
                  <View style={styles.detailContent}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                      Street Address
                    </Text>
                    <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
                      {pickupData.streetName && pickupData.streetName.toLowerCase() !== 'whole barangay'
                        ? `${pickupData.streetName}, ${pickupData.barangayName}`
                        : pickupData.barangayName || 'Barangay'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Schedule Details */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                Schedule Information
              </Text>
              <View style={[styles.detailCard, { backgroundColor: colors.background }]}>
                <View style={styles.detailRow}>
                  <IconSymbol name="calendar" size={20} color={colors.primary} />
                  <View style={styles.detailContent}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                      Date
                    </Text>
                    <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
                      {pickupData.dateText}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.detailRow}>
                  <IconSymbol name="clock.fill" size={20} color={colors.primary} />
                  <View style={styles.detailContent}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                      Time
                    </Text>
                    <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
                      {pickupData.timeText}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Waste Category */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                Waste Category
              </Text>
              <View style={[styles.detailCard, { backgroundColor: colors.background }]}>
                <View style={styles.detailRow}>
                  <IconSymbol name="recycling" size={20} color={colors.primary} />
                  <View style={styles.detailContent}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                      Category
                    </Text>
                    <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
                      {pickupData.wasteCategory}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Additional Information */}
            {Boolean(pickupData.frequency || pickupData.note) && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                  Additional Information
                </Text>
                <View style={[styles.detailCard, { backgroundColor: colors.background }]}>
                  {Boolean(pickupData.frequency) && (
                    <View style={styles.detailRow}>
                      <IconSymbol name="repeat" size={20} color={colors.primary} />
                      <View style={styles.detailContent}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                          Frequency
                        </Text>
                        <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
                          {pickupData.frequency}
                        </Text>
                      </View>
                    </View>
                  )}
                  
                  {Boolean(pickupData.note) && (
                    <View style={styles.detailRow}>
                      <IconSymbol name="note.text" size={20} color={colors.primary} />
                      <View style={styles.detailContent}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                          Note
                        </Text>
                        <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
                          {pickupData.note}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            )}
           </ScrollView>
         </TouchableOpacity>
       </TouchableOpacity>
     </Modal>
   );
};

const { height: screenHeight } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContainer: {
    width: '100%',
    maxHeight: '100%',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 15,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  statusSection: {
    alignItems: 'center',
    marginVertical: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  statusText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  detailCard: {
    borderRadius: 12,
    padding: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  detailContent: {
    flex: 1,
    marginLeft: 12,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '400',
  },
});

export default PickupDetailsModal;
