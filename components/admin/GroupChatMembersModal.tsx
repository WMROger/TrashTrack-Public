import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import {
  addMemberToGroupChat,
  approveJoinRequest,
  getGroupChatMembers,
  getGroupChatMemberSuggestions,
  GroupChatItem,
  GroupChatJoinRequest,
  GroupChatMemberProfile,
  GroupChatMemberSuggestion,
  kickMemberFromGroupChat,
  rejectJoinRequest,
} from '@/services/groupChatService';

interface GroupChatMembersModalProps {
  visible: boolean;
  channel: GroupChatItem | null;
  currentUserUid: string | null;
  currentUserName?: string;
  onClose: () => void;
  onMemberAdded?: (displayName: string) => void;
  onMemberKicked?: (displayName: string) => void;
  onRequestApproved?: (displayName: string) => void;
}

export default function GroupChatMembersModal({
  visible,
  channel,
  currentUserUid,
  currentUserName,
  onClose,
  onMemberAdded,
  onMemberKicked,
  onRequestApproved,
}: GroupChatMembersModalProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [liveMemberUids, setLiveMemberUids] = useState<string[]>(channel?.memberUids || []);
  const [liveJoinRequests, setLiveJoinRequests] = useState<GroupChatJoinRequest[]>(channel?.joinRequests || []);
  const [liveCreatorUid, setLiveCreatorUid] = useState<string | undefined>(channel?.createdBy?.uid);

  useEffect(() => {
    if (channel) {
      if (Array.isArray(channel.memberUids)) {
        setLiveMemberUids(channel.memberUids);
      }
      if (Array.isArray(channel.joinRequests)) {
        setLiveJoinRequests(channel.joinRequests);
      }
      if (channel.createdBy?.uid) {
        setLiveCreatorUid(channel.createdBy.uid);
      }
    }
  }, [channel?.id, channel?.memberUids?.join(','), channel?.joinRequests?.length]);

  const effectiveCreatorUid = liveCreatorUid || channel?.createdBy?.uid;
  const isCreator = Boolean(
    channel?.isCustomGC &&
    currentUserUid &&
    effectiveCreatorUid === currentUserUid
  );

  const pendingRequests: GroupChatJoinRequest[] = liveJoinRequests.length > 0 ? liveJoinRequests : (channel?.joinRequests || []);
  const [activeTab, setActiveTab] = useState<'members' | 'requests'>('members');

  const [members, setMembers] = useState<GroupChatMemberProfile[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Direct add state (for creator)
  const [showAddForm, setShowAddForm] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [selectedSuggestion, setSelectedSuggestion] = useState<GroupChatMemberSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<GroupChatMemberSuggestion[]>([]);
  const [addingMember, setAddingMember] = useState(false);
  const [addError, setAddError] = useState('');

  // Action state (kick / approve / decline)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Switch to requests tab if there are pending requests when opened
  useEffect(() => {
    if (visible && isCreator && pendingRequests.length > 0) {
      setActiveTab('requests');
    } else if (visible) {
      setActiveTab('members');
    }
  }, [visible, isCreator, pendingRequests.length]);

  // Load member details
  const fetchMembers = async (overrideUids?: string[], overrideCreator?: string) => {
    if (!channel?.id) return;
    setLoadingMembers(true);
    try {
      const targetUids = overrideUids || (liveMemberUids.length > 0 ? liveMemberUids : channel.memberUids);
      const targetCreator = overrideCreator || effectiveCreatorUid;
      const list = await getGroupChatMembers(
        channel.id,
        targetUids,
        targetCreator
      );
      setMembers(list);
    } catch (err) {
      console.warn('Failed to fetch group members:', err);
    } finally {
      setLoadingMembers(false);
    }
  };

  // Real-time listener for authoritative channel state changes (member additions, removals, join requests)
  useEffect(() => {
    if (!visible || !channel?.id || !db) return;

    const channelRef = doc(db, 'interagency_channels', channel.id);
    const unsubscribe = onSnapshot(
      channelRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const uids: string[] = Array.isArray(data.memberUids) ? data.memberUids : [];
          const reqs: GroupChatJoinRequest[] = Array.isArray(data.joinRequests) ? data.joinRequests : [];
          const creatorUid: string | undefined = data.createdBy?.uid;

          setLiveMemberUids(uids);
          setLiveJoinRequests(reqs);
          if (creatorUid) setLiveCreatorUid(creatorUid);

          // Fetch member profiles with the newly updated live UIDs
          fetchMembers(uids, creatorUid);
        }
      },
      (err) => {
        console.warn('Realtime channel snapshot error in GroupChatMembersModal:', err);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [visible, channel?.id]);

  useEffect(() => {
    if (visible && channel?.id) {
      fetchMembers();
      setShowAddForm(false);
      setAddError('');
      setMemberEmail('');
      setSelectedSuggestion(null);
    }
  }, [visible, channel?.id]);

  // Load suggestions for adding members
  useEffect(() => {
    if (!visible || !isCreator || !showAddForm) return;
    const currentUids = liveMemberUids.length > 0 ? liveMemberUids : (channel?.memberUids || []);
    getGroupChatMemberSuggestions(currentUids)
      .then((res) => setSuggestions(res))
      .catch((err) => console.warn('Suggestions error:', err));
  }, [visible, isCreator, showAddForm, liveMemberUids.join(','), channel?.memberUids]);

  const handleAddMember = async () => {
    if (!channel?.id) return;
    const emailToUse = selectedSuggestion?.email || memberEmail.trim();
    if (!emailToUse) {
      setAddError('Please enter or select an authorized operations email.');
      return;
    }

    setAddingMember(true);
    setAddError('');
    try {
      const res = await addMemberToGroupChat(channel.id, emailToUse, selectedSuggestion?.uid);
      setMemberEmail('');
      setSelectedSuggestion(null);
      setShowAddForm(false);
      await fetchMembers();
      onMemberAdded?.(res.displayName);
      Alert.alert(
        res.alreadyMember ? 'Already Member' : 'Member Added',
        `${res.displayName} (${res.email}) ${res.alreadyMember ? 'is already in this group.' : 'has been added to this group chat.'}`
      );
    } catch (err: any) {
      setAddError(err?.message || 'Could not add member. Try again.');
    } finally {
      setAddingMember(false);
    }
  };

  const handleKickMember = (member: GroupChatMemberProfile) => {
    if (!channel?.id) return;
    if (member.isCreator) {
      Alert.alert('Cannot Remove', 'The creator of the group chat cannot be removed.');
      return;
    }

    const confirmKick = async () => {
      setActionLoadingId(member.uid);
      try {
        await kickMemberFromGroupChat(channel.id, member.uid, currentUserName);
        await fetchMembers();
        onMemberKicked?.(member.displayName);
        Alert.alert('Member Removed', `${member.displayName} was removed from the group chat.`);
      } catch (err: any) {
        Alert.alert('Error', err?.message || 'Could not remove member.');
      } finally {
        setActionLoadingId(null);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Are you sure you want to kick ${member.displayName} from this group chat?`)) {
        confirmKick();
      }
    } else {
      Alert.alert(
        'Kick Member',
        `Are you sure you want to remove ${member.displayName} from this group chat?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: confirmKick },
        ]
      );
    }
  };

  const handleApproveRequest = async (req: GroupChatJoinRequest) => {
    if (!channel?.id) return;
    setActionLoadingId(req.uid);
    try {
      const res = await approveJoinRequest(channel.id, req, currentUserName);
      await fetchMembers();
      onRequestApproved?.(res.joinName);
      Alert.alert('Request Approved', `${res.joinName} has been approved and added to the group chat.`);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not approve join request.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeclineRequest = async (req: GroupChatJoinRequest) => {
    if (!channel?.id) return;
    setActionLoadingId(req.uid);
    try {
      await rejectJoinRequest(channel.id, req.uid);
      Alert.alert('Request Declined', `Join request from ${req.displayName} was declined.`);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not decline request.');
    } finally {
      setActionLoadingId(null);
    }
  };

  if (!visible || !channel) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modalCard, isMobile && { width: '94%', maxHeight: '90%' }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconCircle}>
                <MaterialIcons name="groups" size={22} color="#0D9488" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {channel.name}
                </Text>
                <Text style={styles.headerSubtitle}>
                  {isCreator ? 'Creator Controls • Member Management' : 'Group Chat Members Directory'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Segmented Tabs (Members vs Application Requests) */}
            <View style={styles.tabBar}>
              <TouchableOpacity
                style={[styles.tabButton, activeTab === 'members' && styles.tabButtonActive]}
                onPress={() => setActiveTab('members')}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name="people-alt"
                  size={15}
                  color={activeTab === 'members' ? '#FFFFFF' : '#64748B'}
                />
                <Text
                  style={[styles.tabButtonText, activeTab === 'members' && styles.tabButtonTextActive]}
                >
                  Members ({members.length || liveMemberUids.length || channel.memberUids?.length || 0})
                </Text>
              </TouchableOpacity>

              {isCreator && (
                <TouchableOpacity
                  style={[styles.tabButton, activeTab === 'requests' && styles.tabButtonActive]}
                  onPress={() => setActiveTab('requests')}
                  activeOpacity={0.8}
                >
                  <MaterialIcons
                    name="how-to-reg"
                    size={15}
                    color={activeTab === 'requests' ? '#FFFFFF' : '#64748B'}
                  />
                  <Text
                    style={[styles.tabButtonText, activeTab === 'requests' && styles.tabButtonTextActive]}
                  >
                    Join Requests
                  </Text>
                  {pendingRequests.length > 0 && (
                    <View style={styles.badgePill}>
                      <Text style={styles.badgePillText}>{pendingRequests.length}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Modal Content */}
          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={styles.contentInner}
            showsVerticalScrollIndicator={true}
          >
            {activeTab === 'members' ? (
              <>
                {/* Creator "Add Member" Trigger & Form */}
                {isCreator && (
                  <View style={styles.addSection}>
                    {!showAddForm ? (
                      <TouchableOpacity
                        style={styles.openAddBtn}
                        onPress={() => setShowAddForm(true)}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="person-add-alt-1" size={17} color="#0D9488" />
                        <Text style={styles.openAddBtnText}>Add User Directly to Group Chat</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.addFormBox}>
                        <View style={styles.addFormHeader}>
                          <Text style={styles.addFormTitle}>Add User (Creator Privilege)</Text>
                          <TouchableOpacity onPress={() => setShowAddForm(false)}>
                            <Text style={styles.cancelText}>Cancel</Text>
                          </TouchableOpacity>
                        </View>

                        {/* Suggestions Dropdown / Chips */}
                        {suggestions.length > 0 && (
                          <View style={{ marginBottom: 10 }}>
                            <Text style={styles.inputSubLabel}>Quick Pick Operations Personnel:</Text>
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              contentContainerStyle={{ gap: 6, paddingVertical: 4 }}
                            >
                              {suggestions.slice(0, 8).map((s) => {
                                const isSelected = selectedSuggestion?.uid === s.uid;
                                return (
                                  <TouchableOpacity
                                    key={s.uid}
                                    style={[styles.suggestionChip, isSelected && styles.suggestionChipActive]}
                                    onPress={() => {
                                      setSelectedSuggestion(isSelected ? null : s);
                                      setMemberEmail(isSelected ? '' : s.email);
                                    }}
                                  >
                                    <Text
                                      style={[
                                        styles.suggestionChipText,
                                        isSelected && styles.suggestionChipTextActive,
                                      ]}
                                    >
                                      {s.displayName} ({s.role.toUpperCase()})
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </ScrollView>
                          </View>
                        )}

                        <TextInput
                          style={styles.emailInput}
                          placeholder="Or type user email (e.g. cenro@trashtrack.gov.ph)"
                          placeholderTextColor="#94A3B8"
                          value={memberEmail}
                          onChangeText={(t) => {
                            setMemberEmail(t);
                            if (selectedSuggestion && selectedSuggestion.email !== t) {
                              setSelectedSuggestion(null);
                            }
                            if (addError) setAddError('');
                          }}
                          autoCapitalize="none"
                          keyboardType="email-address"
                        />

                        {addError ? (
                          <Text style={styles.errorText}>{addError}</Text>
                        ) : null}

                        <TouchableOpacity
                          style={[styles.confirmAddBtn, addingMember && { opacity: 0.6 }]}
                          onPress={handleAddMember}
                          disabled={addingMember}
                          activeOpacity={0.8}
                        >
                          {addingMember ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <>
                              <MaterialIcons name="check" size={17} color="#FFFFFF" style={{ marginRight: 6 }} />
                              <Text style={styles.confirmAddBtnText}>Add User Now</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}

                {/* Member List */}
                {loadingMembers ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator size="small" color="#0D9488" />
                    <Text style={styles.loadingText}>Loading members directory...</Text>
                  </View>
                ) : members.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <MaterialIcons name="person-outline" size={36} color="#CBD5E1" />
                    <Text style={styles.emptyText}>No members registered in this group chat.</Text>
                  </View>
                ) : (
                  members.map((m) => {
                    const isSelf = m.uid === currentUserUid;
                    const isKickingThis = actionLoadingId === m.uid;
                    const roleLabel = m.role?.toUpperCase() || 'STAFF';

                    return (
                      <View key={m.uid} style={styles.memberCard}>
                        <View style={styles.avatarCircle}>
                          <Text style={styles.avatarText}>
                            {m.displayName ? m.displayName.charAt(0).toUpperCase() : 'U'}
                          </Text>
                        </View>

                        <View style={{ flex: 1, marginRight: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={styles.memberName} numberOfLines={1}>
                              {m.displayName}
                            </Text>
                            {isSelf && <Text style={styles.selfTag}>(You)</Text>}
                            {m.isCreator && (
                              <View style={styles.ownerBadge}>
                                <MaterialIcons name="star" size={11} color="#B45309" />
                                <Text style={styles.ownerBadgeText}>Creator</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.memberEmail} numberOfLines={1}>
                            {m.email} · <Text style={{ fontWeight: '700', color: '#0F766E' }}>{roleLabel}</Text>
                          </Text>
                        </View>

                        {/* Kick Button (Creator Only, cannot kick creator) */}
                        {isCreator && !m.isCreator && (
                          <TouchableOpacity
                            style={styles.kickBtn}
                            onPress={() => handleKickMember(m)}
                            disabled={isKickingThis}
                            activeOpacity={0.7}
                            accessibilityLabel={`Kick ${m.displayName}`}
                          >
                            {isKickingThis ? (
                              <ActivityIndicator size="small" color="#DC2626" />
                            ) : (
                              <>
                                <MaterialIcons name="person-remove" size={15} color="#DC2626" style={{ marginRight: 3 }} />
                                <Text style={styles.kickBtnText}>Kick</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })
                )}
              </>
            ) : (
              /* APPLICATION REQUESTS TAB */
              <View>
                {pendingRequests.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <MaterialIcons name="mark-email-read" size={40} color="#CBD5E1" />
                    <Text style={styles.emptyTitle}>No Pending Join Requests</Text>
                    <Text style={styles.emptyText}>
                      When municipal personnel or coordinators request to join this group chat, their application requests will appear here for your approval.
                    </Text>
                  </View>
                ) : (
                  pendingRequests.map((req) => {
                    const isProcessing = actionLoadingId === req.uid;

                    return (
                      <View key={req.uid} style={styles.requestCard}>
                        <View style={styles.requestInfoRow}>
                          <View style={styles.requestAvatarCircle}>
                            <MaterialIcons name="person" size={20} color="#0D9488" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.requestName}>{req.displayName}</Text>
                            <Text style={styles.requestEmail}>
                              {req.email} · <Text style={{ fontWeight: '700', color: '#047857' }}>{req.role.toUpperCase()}</Text>
                            </Text>
                            <Text style={styles.requestTime}>
                              Requested to join via Messenger-style application request
                            </Text>
                          </View>
                        </View>

                        {/* Approve / Decline Actions */}
                        <View style={styles.requestActionsRow}>
                          <TouchableOpacity
                            style={[styles.declineBtn, isProcessing && { opacity: 0.5 }]}
                            onPress={() => handleDeclineRequest(req)}
                            disabled={isProcessing}
                            activeOpacity={0.7}
                          >
                            <MaterialIcons name="close" size={15} color="#B91C1C" style={{ marginRight: 4 }} />
                            <Text style={styles.declineBtnText}>Decline</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.approveBtn, isProcessing && { opacity: 0.5 }]}
                            onPress={() => handleApproveRequest(req)}
                            disabled={isProcessing}
                            activeOpacity={0.8}
                          >
                            {isProcessing ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                              <>
                                <MaterialIcons name="check" size={16} color="#FFFFFF" style={{ marginRight: 4 }} />
                                <Text style={styles.approveBtnText}>Approve & Add</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.doneBtnText}>Close</Text>
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
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 540,
    maxHeight: '88%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 12,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F0FDFA',
    borderWidth: 1.5,
    borderColor: '#99F6E4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  closeBtn: {
    padding: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 16,
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 9,
    gap: 6,
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  tabButtonActive: {
    backgroundColor: '#0F766E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#64748B',
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  badgePill: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    marginLeft: 2,
  },
  badgePillText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  contentScroll: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  contentInner: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  addSection: {
    marginBottom: 16,
  },
  openAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F0FDFA',
    borderWidth: 1.5,
    borderColor: '#99F6E4',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  openAddBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F766E',
  },
  addFormBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  addFormHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  addFormTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E293B',
  },
  cancelText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  inputSubLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 4,
  },
  suggestionChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  suggestionChipActive: {
    backgroundColor: '#CCFBF1',
    borderColor: '#0D9488',
  },
  suggestionChipText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  suggestionChipTextActive: {
    color: '#0F766E',
    fontWeight: '800',
  },
  emailInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
    marginBottom: 10,
    ...Platform.select({
      web: { outlineStyle: 'none' } as any,
    }),
  },
  errorText: {
    fontSize: 11.5,
    color: '#DC2626',
    fontWeight: '600',
    marginBottom: 8,
  },
  confirmAddBtn: {
    backgroundColor: '#0F766E',
    borderRadius: 9,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  confirmAddBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  loadingText: {
    fontSize: 12.5,
    color: '#64748B',
    fontWeight: '500',
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 16,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#334155',
  },
  emptyText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 8,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E0F2FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0369A1',
  },
  memberName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#1E293B',
  },
  selfTag: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  ownerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  ownerBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#92400E',
  },
  memberEmail: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  kickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  kickBtnText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#DC2626',
  },
  requestCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 10,
  },
  requestInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  requestAvatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  requestName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#1E293B',
  },
  requestEmail: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  requestTime: {
    fontSize: 10.5,
    color: '#0F766E',
    marginTop: 3,
    fontWeight: '600',
  },
  requestActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  declineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  declineBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B91C1C',
  },
  approveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#0F766E',
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  approveBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
    alignItems: 'flex-end',
  },
  doneBtn: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 9,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...Platform.select({
      web: { cursor: 'pointer' } as any,
    }),
  },
  doneBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
});
