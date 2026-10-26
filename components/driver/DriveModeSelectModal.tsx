import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export interface DriveModeSelectModalProps {
  visible: boolean;
  onClose: () => void;
  assignedBarangay: string;
  truckPlate?: string;
  isDark?: boolean;
  onSelectMode: (mode: 'sim_baliang_direct' | 'sim_baliang_whole' | 'sim_baliang_orig' | 'sim_sector' | 'actual_gps') => void;
}

export default function DriveModeSelectModal({
  visible,
  onClose,
  assignedBarangay,
  truckPlate,
  isDark = false,
  onSelectMode,
}: DriveModeSelectModalProps) {
  const isBaliang = (assignedBarangay || '').toLowerCase().includes('baliang');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, isDark && styles.cardDark]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={[styles.headerIconBox, isDark && styles.headerIconBoxDark]}>
                <MaterialIcons name="alt-route" size={24} color="#16A34A" />
              </View>
              <View style={styles.headerTextCol}>
                <Text style={[styles.title, isDark && styles.textLight]} numberOfLines={1}>
                  Choose Drive Mode
                </Text>
                <Text style={[styles.subtitle, isDark && styles.textMuted]} numberOfLines={1}>
                  Sector: Brgy. {assignedBarangay || 'Baliang'}{truckPlate ? ` • ${truckPlate}` : ''}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Close drive mode selector"
            >
              <MaterialIcons name="close" size={22} color={isDark ? '#9CA3AF' : '#64748B'} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.promptText, isDark && styles.textMuted]}>
            Select how you want to conduct this collection run before departure:
          </Text>

          {/* Scrollable Options List */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled={true}
            bounces={false}
          >
            {/* Options */}
            {isBaliang ? (
              <>
                {/* Option 0: Direct Baliang (Straight to Sector - 3 Stops) */}
                <TouchableOpacity
                  style={[styles.optionCard, { borderColor: '#86EFAC', borderWidth: 1.5 }, isDark && styles.optionCardDark]}
                  onPress={() => onSelectMode('sim_baliang_direct')}
                  activeOpacity={0.8}
                >
                  <View style={[styles.optionIconBox, { backgroundColor: '#F0FDF4' }]}>
                    <MaterialIcons name="near-me" size={22} color="#16A34A" />
                  </View>
                  <View style={styles.optionContent}>
                    <View style={styles.optionTitleRow}>
                      <Text style={[styles.optionTitle, isDark && styles.textLight]}>
                        Direct Baliang (Straight to Sector)
                      </Text>
                      <View style={[styles.badge, { backgroundColor: '#DCFCE7' }]}>
                        <Text style={[styles.badgeText, { color: '#166534' }]} numberOfLines={1}>3 Stops · Direct</Text>
                      </View>
                    </View>
                    <Text style={[styles.optionDesc, isDark && styles.textMuted]}>
                      Starts immediately inside Brgy. Baliang at Barangay Hall. Skips transit to immediately test nearby resident truck alerts.
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Option 1: Whole Brgy. Baliang Loop (3 Stops) */}
                <TouchableOpacity
                  style={[styles.optionCard, isDark && styles.optionCardDark]}
                  onPress={() => onSelectMode('sim_baliang_whole')}
                  activeOpacity={0.8}
                >
                  <View style={[styles.optionIconBox, { backgroundColor: '#ECFDF5' }]}>
                    <MaterialIcons name="repeat" size={22} color="#059669" />
                  </View>
                  <View style={styles.optionContent}>
                    <View style={styles.optionTitleRow}>
                      <Text style={[styles.optionTitle, isDark && styles.textLight]}>
                        Whole Baliang Loop
                      </Text>
                      <View style={[styles.badge, { backgroundColor: '#DCFCE7' }]}>
                        <Text style={[styles.badgeText, { color: '#166534' }]} numberOfLines={1}>8 Stops · Full Loop</Text>
                      </View>
                    </View>
                    <Text style={[styles.optionDesc, isDark && styles.textMuted]}>
                      Simulate full collection route covering all puroks and local pickup points in Brgy. Baliang.
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Option 2: Original Corridor Route (3 Stops) */}
                <TouchableOpacity
                  style={[styles.optionCard, isDark && styles.optionCardDark]}
                  onPress={() => onSelectMode('sim_baliang_orig')}
                  activeOpacity={0.8}
                >
                  <View style={[styles.optionIconBox, { backgroundColor: '#EFF6FF' }]}>
                    <MaterialIcons name="alt-route" size={22} color="#2563EB" />
                  </View>
                  <View style={styles.optionContent}>
                    <View style={styles.optionTitleRow}>
                      <Text style={[styles.optionTitle, isDark && styles.textLight]}>
                        Original Corridor Route
                      </Text>
                      <View style={[styles.badge, { backgroundColor: '#DBEAFE' }]}>
                        <Text style={[styles.badgeText, { color: '#1E40AF' }]} numberOfLines={1}>9 Stops · Depot Corridor</Text>
                      </View>
                    </View>
                    <Text style={[styles.optionDesc, isDark && styles.textMuted]}>
                      Simulate the primary highway corridor route with 9 designated key collection points.
                    </Text>
                  </View>
                </TouchableOpacity>
              </>
            ) : (
              /* Non-Baliang sector route */
              <TouchableOpacity
                style={[styles.optionCard, isDark && styles.optionCardDark]}
                onPress={() => onSelectMode('sim_sector')}
                activeOpacity={0.8}
              >
                <View style={[styles.optionIconBox, { backgroundColor: '#ECFDF5' }]}>
                  <MaterialIcons name="alt-route" size={22} color="#059669" />
                </View>
                <View style={styles.optionContent}>
                  <View style={styles.optionTitleRow}>
                    <Text style={[styles.optionTitle, isDark && styles.textLight]}>
                      Simulated Route ({assignedBarangay})
                    </Text>
                    <View style={[styles.badge, { backgroundColor: '#DCFCE7' }]}>
                      <Text style={[styles.badgeText, { color: '#166534' }]} numberOfLines={1}>Sector Sim</Text>
                    </View>
                  </View>
                  <Text style={[styles.optionDesc, isDark && styles.textMuted]}>
                    Simulate collection route along designated roads in Brgy. {assignedBarangay}.
                  </Text>
                </View>
              </TouchableOpacity>
            )}

            {/* Option: Real Physical Phone GPS */}
            <TouchableOpacity
              style={[
                styles.optionCard,
                { borderColor: '#86EFAC', borderWidth: 1.5 },
                isDark && { backgroundColor: '#064E3B20', borderColor: '#059669' },
              ]}
              onPress={() => onSelectMode('actual_gps')}
              activeOpacity={0.8}
            >
              <View style={[styles.optionIconBox, { backgroundColor: '#F0FDF4' }]}>
                <MaterialIcons name="gps-fixed" size={22} color="#16A34A" />
              </View>
              <View style={styles.optionContent}>
                <View style={styles.optionTitleRow}>
                  <Text style={[styles.optionTitle, isDark && styles.textLight]}>
                    Real Physical Phone GPS
                  </Text>
                  <View style={[styles.badge, { backgroundColor: '#BBF7D0' }]}>
                    <Text style={[styles.badgeText, { color: '#14532D' }]} numberOfLines={1}>📡 Live GPS</Text>
                  </View>
                </View>
                <Text style={[styles.optionDesc, isDark && styles.textMuted]}>
                  Broadcast your phone&apos;s real-time GPS coordinates directly to CENRO dispatch and residents.
                </Text>
              </View>
            </TouchableOpacity>
          </ScrollView>

          {/* Cancel / Standby Button */}
          <TouchableOpacity
            style={[styles.cancelBtn, isDark && styles.cancelBtnDark]}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={[styles.cancelBtnText, isDark && styles.textLight]}>
              Stay on Standby
            </Text>
          </TouchableOpacity>
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
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '88%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
    overflow: 'hidden',
  },
  cardDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  headerIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerIconBoxDark: {
    backgroundColor: '#064E3B',
  },
  headerTextCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 1,
  },
  closeBtn: {
    padding: 4,
    flexShrink: 0,
  },
  promptText: {
    fontSize: 12.5,
    color: '#475569',
    marginBottom: 10,
    lineHeight: 17,
  },
  scrollArea: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingVertical: 2,
    paddingHorizontal: 1,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 11,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
    overflow: 'hidden',
  },
  optionCardDark: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
  },
  optionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  optionContent: {
    flex: 1,
    minWidth: 0,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 3,
  },
  optionTitle: {
    flex: 1,
    flexShrink: 1,
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  optionDesc: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 15,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  cancelBtn: {
    width: '100%',
    backgroundColor: '#F1F5F9',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  cancelBtnDark: {
    backgroundColor: '#334155',
  },
  cancelBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  textLight: {
    color: '#F8FAFC',
  },
  textMuted: {
    color: '#94A3B8',
  },
});
