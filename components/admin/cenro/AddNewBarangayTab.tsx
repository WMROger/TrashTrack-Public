import React from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export default function AddNewBarangayTab() {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Add New Barangay</Text>
        <Text style={styles.headerDesc}>
          Expand the civic stewardship network. Register a new administrative district to synchronize waste collection schedules and logistics assets.
        </Text>
      </View>

      <View style={styles.formContainer}>
        {/* Section 01 */}
        <View style={styles.section}>
          <View style={styles.sectionInfo}>
            <Text style={styles.sectionLabel}>SECTION 01</Text>
            <Text style={styles.sectionTitle}>Basic Information</Text>
            <Text style={styles.sectionDesc}>Primary identifiers and demographic scale for routing calculations.</Text>
          </View>
          <View style={styles.sectionFields}>
            <View style={styles.row}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>Barangay Name</Text>
                <TextInput style={styles.input} placeholder="e.g. San Lorenzo" placeholderTextColor="#9CA3AF" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.label}>Zone/District</Text>
                <View style={styles.dropdown}>
                  <Text style={styles.dropdownText}>Select Jurisdiction</Text>
                  <MaterialIcons name="keyboard-arrow-down" size={20} color="#6B7280" />
                </View>
              </View>
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Total Household Count</Text>
              <TextInput style={styles.input} placeholder="Enter numerical value" placeholderTextColor="#9CA3AF" />
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Section 02 */}
        <View style={styles.section}>
          <View style={styles.sectionInfo}>
            <Text style={styles.sectionLabel}>SECTION 02</Text>
            <Text style={styles.sectionTitle}>Collection Parameters</Text>
            <Text style={styles.sectionDesc}>Temporal settings for service frequency and resource shifts.</Text>
          </View>
          <View style={styles.sectionFields}>
            <Text style={styles.label}>Preferred Frequency</Text>
            <View style={styles.daysRow}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                <View key={i} style={[styles.dayCheck, (day === 'Mon' || day === 'Tue') && styles.dayCheckActive]}>
                  {(day === 'Mon' || day === 'Tue') && <MaterialIcons name="check" size={12} color="#fff" style={styles.checkIcon} />}
                  <Text style={[styles.dayCheckText, (day === 'Mon' || day === 'Tue') && styles.dayCheckTextActive]}>{day}</Text>
                </View>
              ))}
            </View>
            <View style={[styles.dayCheck, { width: 60, marginTop: 8 }]}>
              <Text style={styles.dayCheckText}>Sun</Text>
            </View>
            
            <View style={styles.infoNote}>
              <MaterialIcons name="info-outline" size={14} color="#6B7280" />
              <Text style={styles.infoNoteText}>Mon-Tue: Biodegradable Collection | Thu-Sat: Non-Biodegradable Collection</Text>
            </View>

            <View style={[styles.formGroup, { marginTop: 24, width: '50%' }]}>
              <Text style={styles.label}>Shift Assignment</Text>
              <View style={styles.dropdown}>
                <Text style={styles.dropdownText}>Assign Shift</Text>
                <MaterialIcons name="keyboard-arrow-down" size={20} color="#6B7280" />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Section 03 */}
        <View style={styles.section}>
          <View style={styles.sectionInfo}>
            <Text style={styles.sectionLabel}>SECTION 03</Text>
            <Text style={styles.sectionTitle}>Logistics Setup</Text>
            <Text style={styles.sectionDesc}>Operational hardware and initial spatial efficiency reporting.</Text>
          </View>
          <View style={styles.sectionFieldsRow}>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Asset Requirement</Text>
              
              <View style={[styles.radioCard, styles.radioCardActive]}>
                <View style={styles.radioInner}>
                  <MaterialIcons name="local-shipping" size={24} color="#2E8B57" />
                  <View>
                    <Text style={styles.radioTitle}>Heavy Compactor</Text>
                    <Text style={styles.radioDesc}>High volume, industrial capacity</Text>
                  </View>
                </View>
                <View style={styles.radioDotActive} />
              </View>

              <View style={styles.radioCard}>
                <View style={styles.radioInner}>
                  <MaterialIcons name="local-shipping" size={24} color="#6B7280" />
                  <View>
                    <Text style={styles.radioTitle}>Light Loader</Text>
                    <Text style={styles.radioDesc}>Agile maneuvering, low emission</Text>
                  </View>
                </View>
                <View style={styles.radioDot} />
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Waste Collection Types</Text>
              <View style={styles.checkboxList}>
                {['Biodegradable', 'Non-Biodegradable'].map((type, i) => (
                  <View key={i} style={styles.checkboxRow}>
                    <View style={styles.checkboxActive}><MaterialIcons name="check" size={14} color="#fff" /></View>
                    <Text style={styles.checkboxText}>{type}</Text>
                  </View>
                ))}
                {['Hazardous', 'Electronic Waste'].map((type, i) => (
                  <View key={i} style={styles.checkboxRow}>
                    <View style={styles.checkbox} />
                    <Text style={styles.checkboxText}>{type}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmBtn}>
            <MaterialIcons name="check-circle-outline" size={18} color="#fff" />
            <Text style={styles.confirmBtnText}>Confirm Addition</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB', padding: 32 },
  header: { marginBottom: 40, maxWidth: 600 },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#111827', marginBottom: 12 },
  headerDesc: { fontSize: 14, color: '#4B5563', lineHeight: 22 },

  formContainer: { backgroundColor: '#fff', borderRadius: 12, padding: 32, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2, maxWidth: 1000 },
  section: { flexDirection: 'row', gap: 48 },
  sectionInfo: { flex: 1, maxWidth: 280 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5, marginBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827', marginBottom: 8 },
  sectionDesc: { fontSize: 13, color: '#6B7280', lineHeight: 20 },
  
  sectionFields: { flex: 2 },
  sectionFieldsRow: { flex: 2, flexDirection: 'row', gap: 32 },
  row: { flexDirection: 'row', gap: 24, marginBottom: 24 },
  formGroup: { flex: 1 },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: { backgroundColor: '#F9FAFB', borderRadius: 8, padding: 14, fontSize: 14, color: '#111827', borderWidth: 1, borderColor: '#E5E7EB' },
  dropdown: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F9FAFB', padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  dropdownText: { fontSize: 14, color: '#9CA3AF' },

  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 32 },

  daysRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  dayCheck: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff' },
  dayCheckActive: { backgroundColor: '#2E8B57', borderColor: '#2E8B57' },
  dayCheckText: { fontSize: 13, fontWeight: '500', color: '#374151' },
  dayCheckTextActive: { color: '#fff', marginLeft: 4 },
  checkIcon: { marginLeft: -4 },
  infoNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  infoNoteText: { fontSize: 12, color: '#6B7280' },

  radioCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff', marginBottom: 12 },
  radioCardActive: { borderColor: '#2E8B57', backgroundColor: '#F6FBF7' },
  radioInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  radioTitle: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 2 },
  radioDesc: { fontSize: 12, color: '#6B7280' },
  radioDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D1D5DB' },
  radioDotActive: { width: 20, height: 20, borderRadius: 10, borderWidth: 6, borderColor: '#2E8B57' },

  checkboxList: { gap: 16, marginTop: 8 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: '#D1D5DB' },
  checkboxActive: { width: 20, height: 20, borderRadius: 4, backgroundColor: '#2E8B57', alignItems: 'center', justifyContent: 'center' },
  checkboxText: { fontSize: 14, color: '#374151' },

  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16, marginTop: 48, paddingTop: 24, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 24 },
  cancelBtnText: { color: '#6B7280', fontWeight: '600', fontSize: 14 },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, backgroundColor: '#4b6354' },
  confirmBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
