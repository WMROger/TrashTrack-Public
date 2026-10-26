import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { createGroupChat } from '@/services/groupChatService';

interface CreateGroupChatModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (newChannelId: string) => void;
  creatorRole?: 'cicto' | 'admin' | 'cenro' | 'coordinator' | 'mayor';
  creatorName?: string;
}

const AVAILABLE_ICONS: (keyof typeof MaterialIcons.glyphMap)[] = [
  'groups',
  'campaign',
  'security',
  'local-police',
  'eco',
  'bolt',
  'chat',
  'alt-route',
];

export default function CreateGroupChatModal({
  visible,
  onClose,
  onCreated,
  creatorRole = 'cenro',
  creatorName,
}: CreateGroupChatModalProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high' | 'urgent'>('normal');
  const [selectedIcon, setSelectedIcon] = useState<keyof typeof MaterialIcons.glyphMap>('groups');
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Required Field', 'Please provide a name for the Group Chat.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await createGroupChat({
        name: name.trim(),
        description: description.trim(),
        icon: selectedIcon,
        priority,
        creatorName,
        creatorRole,
      });

      if (res.success && res.channelId) {
        const newChanId = res.channelId;
        setName('');
        setDescription('');
        setPriority('normal');
        setSelectedIcon('groups');
        if (Platform.OS === 'web') {
          onCreated(newChanId);
        } else {
          Alert.alert(
            'Group Chat Established',
            `"${name.trim()}" has been created. Authorized municipal staff can now collaborate in this group chat.`,
            [
              {
                text: 'Open Channel',
                onPress: () => {
                  onCreated(newChanId);
                },
              },
            ]
          );
        }
      } else {
        Alert.alert('Creation Failed', res.error || 'Could not establish Group Chat.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.modalCard, isMobile && { width: '92%', padding: 20 }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <MaterialIcons name="group-add" size={24} color="#059669" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Create Interagency Group Chat</Text>
              <Text style={styles.subtitle}>
                Establish a direct command line for the Mayor, CENRO, and CICTO.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialIcons name="close" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
            {/* GC Name Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>GROUP CHAT NAME *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Mayor's Taskforce / Coastal River Patrol"
                placeholderTextColor="#9CA3AF"
                value={name}
                onChangeText={setName}
                maxLength={60}
              />
            </View>

            {/* Topic / Description Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>PURPOSE & TOPIC</Text>
              <TextInput
                style={[styles.input, { height: 75, textAlignVertical: 'top', paddingTop: 10 }]}
                placeholder="Describe the operational mandate or incident focus of this group..."
                placeholderTextColor="#9CA3AF"
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
                maxLength={200}
              />
            </View>

            {/* Icon Picker */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>CHANNEL BADGE ICON</Text>
              <View style={styles.iconRow}>
                {AVAILABLE_ICONS.map((ic) => (
                  <TouchableOpacity
                    key={ic}
                    style={[styles.iconChip, selectedIcon === ic && styles.iconChipActive]}
                    onPress={() => setSelectedIcon(ic)}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons
                      name={ic}
                      size={20}
                      color={selectedIcon === ic ? '#FFFFFF' : '#4B5563'}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Priority Selector */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>DISPATCH PRIORITY LEVEL</Text>
              <View style={styles.priorityRow}>
                {[
                  { id: 'normal', label: 'Normal Dispatch', color: '#059669', bg: '#ECFDF5' },
                  { id: 'high', label: 'High Priority', color: '#D97706', bg: '#FEF3C7' },
                  { id: 'urgent', label: 'City Emergency', color: '#DC2626', bg: '#FEE2E2' },
                ].map((p) => {
                  const isActive = priority === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[
                        styles.priorityBtn,
                        isActive && { backgroundColor: p.bg, borderColor: p.color, borderWidth: 1.5 },
                      ]}
                      onPress={() => setPriority(p.id as any)}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.priorityDot,
                          { backgroundColor: p.color },
                        ]}
                      />
                      <Text
                        style={[
                          styles.priorityBtnText,
                          isActive && { color: p.color, fontWeight: '800' },
                        ]}
                      >
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={submitting}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.submitBtn}
              onPress={handleCreate}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialIcons name="add-comment" size={17} color="#FFFFFF" />
                  <Text style={styles.submitBtnText}>Establish GC</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4B5563',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 46,
    fontSize: 14,
    color: '#111827',
  },
  iconRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  iconChip: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  iconChipActive: {
    backgroundColor: '#059669',
    borderColor: '#047857',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  priorityBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4B5563',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  cancelBtnText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '600',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#059669',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
