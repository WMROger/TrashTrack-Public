import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  useWindowDimensions,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  limit,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { sendInteragencyMessage } from '@/services/cictoOversightService';
import {
  addMemberToGroupChat,
  deleteGroupChat,
  subscribeGroupChats,
  requestToJoinGroupChat,
  GroupChatItem,
  GroupChatJoinRequest,
} from '@/services/groupChatService';
import CreateGroupChatModal from '../CreateGroupChatModal';
import GroupChatMembersModal from '../GroupChatMembersModal';

interface InteragencyMessage {
  id: string;
  subject?: string;
  message: string;
  priority: 'normal' | 'high' | 'urgent';
  channelId?: string;
  senderUid: string;
  senderName?: string;
  senderEmail?: string;
  senderRole?: 'cicto' | 'admin' | 'cenro' | 'coordinator' | 'mayor' | 'system';
  isSystemNotification?: boolean;
  createdAt?: any;
}

interface ChannelItem {
  id: string;
  name: string;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  badgeCount?: number;
  priority?: 'normal' | 'high' | 'urgent';
  isCustomGC?: boolean;
  createdBy?: GroupChatItem['createdBy'];
  memberUids?: string[];
  joinRequests?: GroupChatJoinRequest[];
}

const CHANNELS: ChannelItem[] = [
  {
    id: 'general-command',
    name: 'Executive Inter-Agency Bridge',
    description: 'Direct command line between CENRO Operations, CICTO IT Authority, and Barangay Field Stewards.',
    icon: 'security',
  },
  {
    id: 'urgent-advisories',
    name: 'Emergency Directives & Alerts',
    description: 'City-wide and barangay emergency broadcasts, severe weather protocols, and directives from CENRO.',
    icon: 'campaign',
    priority: 'urgent',
  },
  {
    id: 'fleet-dispatch',
    name: 'Fleet Dispatch & Routing',
    description: 'Fleet alerts, telemetry anomalies, road obstructions, and real-time reroutes.',
    icon: 'local-shipping',
  },
  {
    id: 'incident-escalation',
    name: 'Hazard & Incident Escalations',
    description: 'Priority citizen hazard reports requiring coordinated city IT & environmental response.',
    icon: 'warning',
    priority: 'high',
  },
  {
    id: 'system-governance',
    name: 'System Governance & Audits',
    description: 'Account provisioning, security audits, database sync, and protocol updates.',
    icon: 'admin-panel-settings',
  },
];

const PRESET_TEMPLATES = [
  { label: '🚛 Route Completed', text: 'Collection round completed for scheduled barangays. Telemetry logs synchronized with CICTO database.' },
  { label: '🚨 Hazard Escalation', text: 'Illegal dumping or uncollected hazardous waste identified. Requesting rapid dispatch authorization and incident ticket.' },
  { label: '⚠️ Road Obstruction', text: 'Collection truck encountered a road blockage. Re-routing through secondary municipal corridor.' },
];

export interface CictoCommandsTabProps {
  userRole?: string;
  assignedBarangay?: string;
}

export default function CictoCommandsTab({ userRole, assignedBarangay }: CictoCommandsTabProps = {}) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const isCoordinator = userRole === 'coordinator';
  const isMayor = userRole === 'mayor';
  const currentUserId = auth.currentUser?.uid;

  const [activeChannelId, setActiveChannelId] = useState<string>('general-command');
  const [messages, setMessages] = useState<InteragencyMessage[]>([]);
  const [customGroupChats, setCustomGroupChats] = useState<GroupChatItem[]>([]);
  const [showCreateGcModal, setShowCreateGcModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [membersModalChannel, setMembersModalChannel] = useState<GroupChatItem | null>(null);
  const [miniNotification, setMiniNotification] = useState<string | null>(null);
  const [requestingToJoin, setRequestingToJoin] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberError, setMemberError] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [groupChatToDelete, setGroupChatToDelete] = useState<ChannelItem | null>(null);
  const [deletingGroupChat, setDeletingGroupChat] = useState(false);
  const [deleteGroupChatError, setDeleteGroupChatError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inputText, setInputText] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [mobileView, setMobileView] = useState<'channels' | 'chat'>('channels');
  const [menuChannel, setMenuChannel] = useState<ChannelItem | null>(null);

  const scrollViewRef = useRef<ScrollView>(null);

  // Subscribe to dynamically created group chats from Mayor and CENRO (member-only)
  useEffect(() => {
    const unsubGc = subscribeGroupChats((gcs) => {
      setCustomGroupChats(gcs);
    }, currentUserId);
    return () => unsubGc();
  }, [currentUserId]);

  const allChannels: ChannelItem[] = [
    ...CHANNELS,
    ...customGroupChats
      .filter((gc) => Boolean(currentUserId && gc.memberUids?.includes(currentUserId)))
      .map((gc) => ({
        id: gc.id,
        name: gc.name,
        description: gc.description,
        icon: gc.icon,
        priority: gc.priority,
        isCustomGC: true,
        createdBy: gc.createdBy,
        memberUids: gc.memberUids,
        joinRequests: gc.joinRequests,
      })),
  ];

  const activeChannel = allChannels.find((c) => c.id === activeChannelId) || allChannels[0] || CHANNELS[0];

  // If active channel no longer exists or user is not a member, fallback to general-command
  useEffect(() => {
    const channelExists = allChannels.some((c) => c.id === activeChannelId);
    if (!channelExists && activeChannelId !== 'general-command') {
      setActiveChannelId('general-command');
    }
  }, [allChannels, activeChannelId]);

  const coordinatorTemplates = [
    { label: '✅ Directive Acknowledged', text: `Barangay ${assignedBarangay || 'Field'} Coordinator acknowledges receipt of directive. Relaying instructions to field personnel.` },
    { label: '🚛 Barangay Status Update', text: `Collection progress update for Brgy. ${assignedBarangay || 'our sector'}: Scheduled collection rounds actively monitored.` },
    { label: '🚨 Hazard Escalation', text: `Urgent uncollected waste cluster reported in Brgy. ${assignedBarangay || 'our area'}. Requesting rapid collection support.` },
    { label: '⚠️ Road Obstruction', text: `Road blockage encountered in Brgy. ${assignedBarangay || 'our area'}. Requesting alternate corridor approval.` },
  ];

  const displayTemplates = isCoordinator ? coordinatorTemplates : PRESET_TEMPLATES;

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    // Safety guard: If active channel is a custom GC and user is not in member list, do not query
    const isAllowedMember = !activeChannel?.isCustomGC || Boolean(currentUserId && activeChannel?.memberUids?.includes(currentUserId));
    if (!isAllowedMember) {
      setMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const messageCollection = collection(db, 'interagency_messages');
    const q = query(
      messageCollection,
      where('channelId', '==', activeChannelId),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: InteragencyMessage[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        const toMillis = (value: any) => value?.toMillis?.() || 0;
        list.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
        setMessages(list);
        setLoading(false);
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      },
      (err) => {
        console.warn('Interagency chat listener note:', err?.message || err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeChannelId, activeChannel?.isCustomGC, activeChannel?.memberUids, currentUserId]);

  const knownChannelIds = new Set(allChannels.map((c) => c.id));
  const channelMessages = messages.filter((m) => {
    if (activeChannelId === 'general-command') {
      return !m.channelId || m.channelId === 'general-command' || !knownChannelIds.has(m.channelId);
    }
    return m.channelId === activeChannelId;
  });

  const isChannelCreator = (channel?: ChannelItem | null) => Boolean(
    channel?.isCustomGC && auth.currentUser && channel?.createdBy?.uid === auth.currentUser.uid
  );

  const isChannelMember = (channel?: ChannelItem | null) => Boolean(
    channel?.memberUids?.includes(auth.currentUser?.uid || '')
  );

  const hasRequestedJoin = (channel?: ChannelItem | null) => Boolean(
    channel?.joinRequests?.some((r) => r.uid === auth.currentUser?.uid)
  );

  // Auto-display mini notification in the chat bar when a join event message is present
  useEffect(() => {
    const activeMsgs = messages.filter((m) => m.channelId === activeChannelId);
    const latestJoinMsg = activeMsgs.slice().reverse().find((m) => m.message?.toLowerCase().includes('joined the group chat'));
    if (latestJoinMsg) {
      setMiniNotification(latestJoinMsg.message);
    } else {
      setMiniNotification(null);
    }
  }, [activeChannelId, messages]);

  const handleApplyToJoin = async (channel?: ChannelItem | null) => {
    if (!channel?.isCustomGC) return;
    setRequestingToJoin(channel.id);
    try {
      const applicantName = auth.currentUser?.displayName || (isCoordinator ? `Brgy. ${assignedBarangay || 'Field'} Coordinator` : 'CENRO Officer');
      const applicantRole = isCoordinator ? 'coordinator' : 'cenro';
      const res = await requestToJoinGroupChat(channel.id, {
        displayName: applicantName,
        role: applicantRole,
      });
      if (res.alreadyRequested) {
        Alert.alert('Request Already Submitted', 'Your application request is already awaiting group creator approval.');
      } else {
        Alert.alert('Application Request Sent', `Your request to join "${channel.name}" has been submitted for creator approval.`);
      }
    } catch (err: any) {
      Alert.alert('Request Failed', err?.message || 'Could not send join request.');
    } finally {
      setRequestingToJoin(null);
    }
  };

  const handleAddMember = async () => {
    if (!activeChannel?.isCustomGC || !memberEmail.trim()) {
      setMemberError('Enter the email address for an existing municipal operations account.');
      return;
    }
    setAddingMember(true);
    setMemberError('');
    try {
      const member = await addMemberToGroupChat(activeChannel.id, memberEmail);
      setMemberEmail('');
      setShowAddMemberModal(false);
      Alert.alert(member.alreadyMember ? 'Already a member' : 'Person added', `${member.displayName} (${member.email}) ${member.alreadyMember ? 'is already in this group.' : 'can now open this group chat.'}`);
    } catch (error: any) {
      const code = String(error?.code || '');
      const message = String(error?.message || 'Check the email and try again.');
      setMemberError(code.includes('permission-denied')
        ? 'Firebase access rules need updating before members can be added. Ask the system administrator to publish the latest Firestore rules.'
        : code.includes('failed-precondition') && message.toLowerCase().includes('index')
          ? 'The member lookup needs its Firestore index. Ask the system administrator to publish the latest database indexes.'
          : message);
    } finally {
      setAddingMember(false);
    }
  };

  const handleDeleteGroupChat = async () => {
    if (!groupChatToDelete) return;
    setDeletingGroupChat(true);
    setDeleteGroupChatError('');
    try {
      await deleteGroupChat(groupChatToDelete.id);
      if (activeChannelId === groupChatToDelete.id) {
        setActiveChannelId('general-command');
      }
      setGroupChatToDelete(null);
      if (isMobile) setMobileView('channels');
    } catch (error: any) {
      const code = String(error?.code || '');
      setDeleteGroupChatError(code.includes('permission-denied')
        ? 'You do not have permission to delete this group chat.'
        : error?.message || 'The group chat could not be deleted. Try again.');
    } finally {
      setDeletingGroupChat(false);
    }
  };

  const handleSendMessage = async (customMessage?: string, priority: 'normal' | 'high' | 'urgent' = 'normal') => {
    const textToSend = (customMessage || inputText).trim();
    if (!textToSend) return;

    if (!auth.currentUser) {
      Alert.alert('Authentication Error', 'You must be signed in to transmit messages.');
      return;
    }

    setSending(true);
    try {
      const senderRole = isCoordinator ? 'coordinator' : isMayor ? 'mayor' : 'cenro';
      const defaultSenderName = isCoordinator
        ? (assignedBarangay ? `Brgy. ${assignedBarangay} Coordinator` : 'Barangay Coordinator')
        : isMayor ? 'Office of the Mayor' : 'CENRO Operations Admin';

      await sendInteragencyMessage({
        message: textToSend,
        priority,
        channelId: activeChannelId,
        senderRole,
        senderName: auth.currentUser.displayName || defaultSenderName,
        senderEmail: auth.currentUser.email || '',
      });

      if (!customMessage) {
        setInputText('');
      }

      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 150);
    } catch (err: any) {
      Alert.alert('Transmission Failed', err?.message || 'Could not transmit command dispatch.');
    } finally {
      setSending(false);
    }
  };

  const filteredChannels = allChannels
    .filter(Boolean)
    .filter(
      (c) =>
        (c?.name || '').toLowerCase().includes(channelSearch.toLowerCase()) ||
        (c?.description || '').toLowerCase().includes(channelSearch.toLowerCase())
    );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Top Republic Ribbon Header */}
      <View style={styles.topHeaderBar}>
        <View style={styles.headerTitleGroup}>
          <View style={styles.agencyBadge}>
            <MaterialIcons name="security" size={16} color="#0D9488" />
            <Text style={styles.agencyBadgeText}>
              {isCoordinator
                ? 'CICTO • CENRO • BARANGAY COMMAND BRIDGE'
                : 'CICTO - CENRO INTER-AGENCY BRIDGE'}
            </Text>
          </View>
          <Text style={styles.headerMainTitle}>
            {isCoordinator
              ? `Official Command & Dispatch Stream${assignedBarangay ? ` • Brgy. ${assignedBarangay}` : ''}`
              : 'Direct Governance Command & Dispatch'}
          </Text>
        </View>
        <View style={styles.securityStatusPill}>
          <View style={styles.statusDot} />
          <Text style={styles.securityStatusText}>
            {isCoordinator && assignedBarangay
              ? `BRGY. ${assignedBarangay.toUpperCase()} • ENCRYPTED FREQUENCY`
              : 'ENCRYPTED CHANNEL • DANAO LGU'}
          </Text>
        </View>
      </View>

      <View style={styles.mainLayout}>
        {/* Sidebar Channels List */}
        {(!isMobile || mobileView === 'channels') && (
          <View style={[styles.channelSidebar, isMobile && styles.channelSidebarMobile]}>
            <View style={styles.searchContainer}>
              <MaterialIcons name="search" size={18} color="#94A3B8" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search command channels..."
                placeholderTextColor="#94A3B8"
                value={channelSearch}
                onChangeText={setChannelSearch}
              />
              {channelSearch.length > 0 && (
                <TouchableOpacity onPress={() => setChannelSearch('')}>
                  <MaterialIcons name="close" size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={styles.channelScroll} showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginTop: 4, marginBottom: 8 }}>
                <Text style={styles.channelSectionHeader}>OFFICIAL FREQUENCIES</Text>
                <TouchableOpacity
                  style={styles.newGcHeaderBtn}
                  onPress={() => setShowCreateGcModal(true)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="group-add" size={13} color="#0D9488" />
                  <Text style={styles.newGcHeaderBtnText}>+ New GC</Text>
                </TouchableOpacity>
              </View>
              {filteredChannels.map((channel) => {
                const isActive = channel.id === activeChannelId;
                const channelMsgs = messages.filter((m) =>
                  channel.id === 'general-command'
                    ? !m.channelId || m.channelId === 'general-command'
                    : m.channelId === channel.id
                );
                const channelMsgCount = channelMsgs.length;
                const lastMsg = channelMsgs[channelMsgs.length - 1];
                const previewText = lastMsg
                  ? `${lastMsg.senderName ? `${lastMsg.senderName.split(' ')[0]}: ` : ''}${lastMsg.message}`
                  : channel.description;
                const hasPendingRequests = Boolean(channel.joinRequests && channel.joinRequests.length > 0);

                return (
                  <TouchableOpacity
                    key={channel.id}
                    style={[styles.channelItem, isActive && styles.channelItemActive]}
                    onPress={() => {
                      setActiveChannelId(channel.id);
                      if (isMobile) setMobileView('chat');
                    }}
                    activeOpacity={0.7}
                  >
                    {/* Messenger Circular Avatar */}
                    <View style={[styles.channelAvatarWrap, isActive && styles.channelAvatarWrapActive]}>
                      <MaterialIcons
                        name={channel.icon}
                        size={20}
                        color={isActive ? '#FFFFFF' : '#0D9488'}
                      />
                    </View>

                    {/* Middle: Channel Name & Subtitle Preview (Full Width!) */}
                    <View style={styles.channelInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text
                          style={[styles.channelName, isActive && styles.channelNameActive]}
                          numberOfLines={1}
                        >
                          {channel.name}
                        </Text>
                        {channel?.isCustomGC && (
                          <View style={styles.gcTagBadge}>
                            <Text style={styles.gcTagBadgeText}>GC</Text>
                          </View>
                        )}
                        {channel?.priority === 'high' && (
                          <View style={styles.highPriorityDot} />
                        )}
                      </View>
                      <Text style={styles.channelDesc} numberOfLines={1}>
                        {previewText}
                      </Text>
                    </View>

                    {/* Right: Badges & Messenger-style 3-dots button */}
                    <View style={styles.channelTrailing}>
                      {channelMsgCount > 0 && (
                        <View style={[styles.channelBadge, isActive && styles.channelBadgeActive]}>
                          <Text
                            style={[
                              styles.channelBadgeText,
                              isActive && styles.channelBadgeTextActive,
                            ]}
                          >
                            {channelMsgCount}
                          </Text>
                        </View>
                      )}

                      {/* 3-Dots Action Button (Just like Messenger!) */}
                      {channel?.isCustomGC ? (
                        <TouchableOpacity
                          style={styles.messengerDotsBtn}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            setMenuChannel(channel);
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={`More options for ${channel.name}`}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons
                            name="more-horiz"
                            size={18}
                            color={isActive ? '#0F766E' : '#64748B'}
                          />
                          {hasPendingRequests ? <View style={styles.pendingDot} /> : null}
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Chat Feed & Command Console */}
        {(!isMobile || mobileView === 'chat') && (
          <View style={styles.chatArea}>
            {/* Chat Room Subheader */}
            <View style={styles.chatHeader}>
              {isMobile && (
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => setMobileView('channels')}
                >
                  <MaterialIcons name="arrow-back" size={20} color="#1E293B" />
                </TouchableOpacity>
              )}
              <View style={styles.chatHeaderIcon}>
                <MaterialIcons name={activeChannel?.icon || 'security'} size={20} color="#0D9488" />
              </View>
              <View style={styles.chatHeaderTitleWrap}>
                <Text style={styles.chatHeaderTitle}>{activeChannel?.name || 'Inter-Agency Channel'}</Text>
                <Text style={styles.chatHeaderSubtitle}>
                  {activeChannel?.description}{activeChannel?.isCustomGC ? ` · ${activeChannel?.memberUids?.length || 0} members` : ''}
                </Text>
              </View>
              {activeChannel?.isCustomGC && (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  {isChannelCreator(activeChannel) ? (
                    <TouchableOpacity
                      onPress={() => {
                        setMembersModalChannel(customGroupChats.find((g) => g.id === activeChannel?.id) || null);
                        setShowMembersModal(true);
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: '#99F6E4', backgroundColor: '#F0FDFA' }}
                      accessibilityRole="button"
                      accessibilityLabel="Manage group chat members"
                    >
                      <MaterialIcons name="manage-accounts" size={18} color="#0F766E" />
                      <Text style={{ color: '#0F766E', fontSize: 12, fontWeight: '800' }}>Manage Members</Text>
                      {(activeChannel?.joinRequests && activeChannel.joinRequests.length > 0) && (
                        <View style={{ backgroundColor: '#EF4444', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 }}>
                          <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800' }}>{activeChannel.joinRequests.length} New</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ) : isChannelMember(activeChannel) ? (
                    <TouchableOpacity
                      onPress={() => {
                        setMembersModalChannel(customGroupChats.find((g) => g.id === activeChannel?.id) || null);
                        setShowMembersModal(true);
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' }}
                      accessibilityRole="button"
                      accessibilityLabel="View group chat members"
                    >
                      <MaterialIcons name="people" size={18} color="#475569" />
                      <Text style={{ color: '#475569', fontSize: 12, fontWeight: '700' }}>View Members</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            </View>

            {/* Mini Notification in the Chat Bar */}
            {miniNotification && (
              <View style={styles.miniNotificationBar}>
                <View style={styles.miniNotifIconCircle}>
                  <MaterialIcons name="person-pin" size={14} color="#065F46" />
                </View>
                <Text style={styles.miniNotificationText} numberOfLines={1}>
                  {miniNotification}
                </Text>
                <TouchableOpacity
                  onPress={() => setMiniNotification(null)}
                  style={styles.miniNotifCloseBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Dismiss notification"
                >
                  <MaterialIcons name="close" size={14} color="#047857" />
                </TouchableOpacity>
              </View>
            )}

            {activeChannel?.isCustomGC && !isChannelMember(activeChannel) ? (
              <View style={[styles.emptyFeed, { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
                <MaterialIcons name="lock" size={52} color="#94A3B8" />
                <Text style={[styles.emptyFeedTitle, { marginTop: 12 }]}>Private Group Chat</Text>
                <Text style={[styles.emptyFeedSubtitle, { textAlign: 'center', maxWidth: 360 }]}>
                  This group chat is restricted to invited members only. You cannot view transmissions or send dispatches.
                </Text>
              </View>
            ) : (
              <>
                {/* Quick Command Templates */}
                <View style={styles.templateBar}>
              <Text style={styles.templateBarLabel}>QUICK DISPATCH:</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.templateScroll}
              >
                {displayTemplates.map((tmpl, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.templateChip}
                    onPress={() => handleSendMessage(tmpl.text, 'normal')}
                    disabled={sending}
                  >
                    <Text style={styles.templateChipText}>{tmpl.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Message Stream */}
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#0D9488" />
                <Text style={styles.loadingText}>Connecting to secure frequency...</Text>
              </View>
            ) : (
              <ScrollView
                ref={scrollViewRef}
                style={styles.messageScroll}
                contentContainerStyle={styles.messageList}
                showsVerticalScrollIndicator={true}
              >
                {channelMessages.length === 0 ? (
                  <View style={styles.emptyFeed}>
                    <MaterialIcons name="forum" size={48} color="#CBD5E1" />
                    <Text style={styles.emptyFeedTitle}>No Transmissions Yet</Text>
                    <Text style={styles.emptyFeedSubtitle}>
                      {isCoordinator
                        ? 'All directives and dispatches from CENRO Operations or CICTO IT will appear here.'
                        : 'Transmit an official operational dispatch or request CICTO oversight below.'}
                    </Text>
                  </View>
                ) : (
                  channelMessages.map((msg) => {
                    if (msg.isSystemNotification || msg.senderRole === 'system') {
                      return (
                        <View key={msg.id} style={styles.systemEventRow}>
                          <View style={styles.systemEventPill}>
                            <MaterialIcons name="info-outline" size={13} color="#0D9488" />
                            <Text style={styles.systemEventText}>{msg.message}</Text>
                            <Text style={styles.systemEventTime}>
                              {msg.createdAt?.toDate
                                ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : 'Just now'}
                            </Text>
                          </View>
                        </View>
                      );
                    }

                    const isMe = msg.senderUid === currentUserId;
                    const role = msg.senderRole;
                    const isCenro = role === 'cenro' || role === 'admin';
                    const isCicto = role === 'cicto';
                    const isCoord = role === 'coordinator';

                    let senderLabel = 'OFFICIAL DISPATCH';
                    let senderIcon: keyof typeof MaterialIcons.glyphMap = 'security';
                    let senderColor = '#0D9488';
                    let senderStyle = styles.senderNameCicto;

                    if (isCicto) {
                      senderLabel = 'CICTO IT AUTHORITY';
                      senderIcon = 'security';
                      senderColor = '#0D9488';
                      senderStyle = styles.senderNameCicto;
                    } else if (isCenro) {
                      senderLabel = 'CENRO OPERATIONS';
                      senderIcon = 'eco';
                      senderColor = '#059669';
                      senderStyle = styles.senderNameCenro;
                    } else if (isCoord) {
                      senderLabel = 'BARANGAY COORDINATOR';
                      senderIcon = 'place';
                      senderColor = '#15803D';
                      senderStyle = styles.senderNameCoord;
                    }

                    return (
                      <View
                        key={msg.id}
                        style={[
                          styles.messageRow,
                          isMe ? styles.messageRowRight : styles.messageRowLeft,
                        ]}
                      >
                        <View
                          style={[
                            styles.messageBubble,
                            isMe
                              ? styles.messageBubbleMe
                              : isCenro
                              ? styles.messageBubbleCenro
                              : isCicto
                              ? styles.messageBubbleCicto
                              : styles.messageBubbleCoord,
                          ]}
                        >
                          <View style={styles.messageHeaderRow}>
                            <View style={styles.senderPill}>
                              <MaterialIcons
                                name={senderIcon}
                                size={12}
                                color={senderColor}
                              />
                              <Text
                                style={[
                                  styles.senderNameText,
                                  senderStyle,
                                ]}
                              >
                                {senderLabel}
                              </Text>
                            </View>
                            {msg.priority === 'urgent' && (
                              <View style={styles.urgentBadge}>
                                <Text style={styles.urgentBadgeText}>URGENT</Text>
                              </View>
                            )}
                            {msg.priority === 'high' && (
                              <View style={styles.highBadge}>
                                <Text style={styles.highBadgeText}>PRIORITY</Text>
                              </View>
                            )}
                          </View>

                          {msg.subject && msg.subject !== 'Operational Dispatch' && (
                            <Text style={styles.messageSubject}>{msg.subject}</Text>
                          )}

                          <Text style={styles.messageBody}>{msg.message}</Text>

                          <View style={styles.messageFooter}>
                            <Text style={styles.senderEmail}>
                              {msg.senderName || msg.senderEmail || (isCenro ? 'CENRO Officer' : isCicto ? 'CICTO Admin' : 'Barangay Coordinator')}
                            </Text>
                            <Text style={styles.messageTimestamp}>
                              {msg.createdAt?.toDate
                                ? msg.createdAt.toDate().toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : 'Just now'}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            )}

            {/* Transmit Command Input Bar */}
            <View style={styles.inputArea}>
              <TextInput
                style={styles.messageInput}
                placeholder={isCoordinator ? `Reply or message in ${activeChannel?.name || 'chat'}...` : `Dispatch message to ${activeChannel?.name || 'chat'}...`}
                placeholderTextColor="#94A3B8"
                value={inputText}
                onChangeText={setInputText}
                multiline
                maxLength={3000}
                editable={!sending}
              />
              <View style={styles.actionButtonRow}>
                <TouchableOpacity
                  style={[styles.urgentButton, sending && styles.btnDisabled]}
                  onPress={() => handleSendMessage(undefined, 'urgent')}
                  disabled={sending || !inputText.trim()}
                >
                  <MaterialIcons name="report-problem" size={16} color="#DC2626" />
                  <Text style={styles.urgentButtonText}>Urgent</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sendButton, (!inputText.trim() || sending) && styles.sendButtonDisabled]}
                  onPress={() => handleSendMessage(undefined, 'normal')}
                  disabled={!inputText.trim() || sending}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Text style={styles.sendButtonText}>{isCoordinator ? 'Send' : 'Transmit'}</Text>
                      <MaterialIcons name="send" size={16} color="#FFFFFF" />
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
              </>
            )}
          </View>
        )}
      </View>

      {/* Messenger-style 3-Dots Context Menu Modal */}
      <Modal
        visible={!!menuChannel}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuChannel(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setMenuChannel(null)}
          style={styles.actionMenuBackdrop}
        >
          <TouchableOpacity activeOpacity={1} style={styles.actionMenuCard}>
            {/* Header: Avatar, Name, and Close button */}
            <View style={styles.actionMenuHeader}>
              <View style={styles.actionMenuAvatar}>
                <MaterialIcons
                  name={menuChannel?.icon || 'groups'}
                  size={24}
                  color="#0F766E"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionMenuTitle} numberOfLines={1}>
                  {menuChannel?.name}
                </Text>
                <Text style={styles.actionMenuSub} numberOfLines={1}>
                  {menuChannel?.memberUids?.length || 0} members · Municipal Group Chat
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setMenuChannel(null)}
                style={styles.actionMenuCloseBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Action Items */}
            <View style={styles.actionMenuList}>
              {/* Option 1: Open Chat */}
              <TouchableOpacity
                onPress={() => {
                  if (!menuChannel) return;
                  setActiveChannelId(menuChannel.id);
                  if (isMobile) setMobileView('chat');
                  setMenuChannel(null);
                }}
                style={styles.actionMenuItem}
                accessibilityRole="button"
              >
                <View style={styles.actionMenuIconWrap}>
                  <MaterialIcons name="chat-bubble-outline" size={18} color="#0D9488" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionMenuItemTitle}>Open Conversation</Text>
                  <Text style={styles.actionMenuItemDesc}>Switch active view to this group chat</Text>
                </View>
              </TouchableOpacity>

              {/* Option 2: Manage Members & Invites */}
              <TouchableOpacity
                onPress={() => {
                  if (!menuChannel) return;
                  const fullGc = customGroupChats.find((g) => g.id === menuChannel.id) || (menuChannel as GroupChatItem);
                  setMembersModalChannel(fullGc);
                  setShowMembersModal(true);
                  setMenuChannel(null);
                }}
                style={styles.actionMenuItem}
                accessibilityRole="button"
              >
                <View style={styles.actionMenuIconWrap}>
                  <MaterialIcons name="group" size={18} color="#0F766E" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionMenuItemTitle}>Members & Access</Text>
                  <Text style={styles.actionMenuItemDesc}>
                    {menuChannel?.joinRequests && menuChannel.joinRequests.length > 0
                      ? `${menuChannel.joinRequests.length} pending request(s) awaiting approval`
                      : 'View or manage participant access'}
                  </Text>
                </View>
                {menuChannel?.joinRequests && menuChannel.joinRequests.length > 0 ? (
                  <View style={styles.actionMenuPendingBadge}>
                    <Text style={styles.actionMenuPendingText}>
                      {menuChannel.joinRequests.length} New
                    </Text>
                  </View>
                ) : null}
              </TouchableOpacity>

              {/* Option 3: Add Person (if creator or admin) */}
              {Boolean(menuChannel && (isChannelCreator(menuChannel) || isMayor || !isCoordinator)) && (
                <TouchableOpacity
                  onPress={() => {
                    if (!menuChannel) return;
                    setActiveChannelId(menuChannel.id);
                    setMemberEmail('');
                    setMemberError('');
                    setMenuChannel(null);
                    setShowAddMemberModal(true);
                  }}
                  style={styles.actionMenuItem}
                  accessibilityRole="button"
                >
                  <View style={styles.actionMenuIconWrap}>
                    <MaterialIcons name="person-add-alt-1" size={18} color="#0284C7" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.actionMenuItemTitle}>Add People</Text>
                    <Text style={styles.actionMenuItemDesc}>Invite active municipal accounts</Text>
                  </View>
                </TouchableOpacity>
              )}

              {/* Option 4: Delete Group Chat (if creator or mayor/cenro admin) */}
              {Boolean(menuChannel && (isChannelCreator(menuChannel) || isMayor)) && (
                <TouchableOpacity
                  onPress={() => {
                    if (!menuChannel) return;
                    setGroupChatToDelete(menuChannel);
                    setDeleteGroupChatError('');
                    setMenuChannel(null);
                  }}
                  style={[styles.actionMenuItem, styles.actionMenuItemDanger]}
                  accessibilityRole="button"
                >
                  <View style={[styles.actionMenuIconWrap, { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]}>
                    <MaterialIcons name="delete-outline" size={18} color="#B91C1C" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.actionMenuItemTitle, { color: '#B91C1C' }]}>Delete Group Chat</Text>
                    <Text style={[styles.actionMenuItemDesc, { color: '#DC2626' }]}>
                      Permanently delete chat for all members
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showAddMemberModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddMemberModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'center', padding: 20 }}>
          <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 22, gap: 13 }}>
            <Text style={{ color: '#0F172A', fontSize: 19, fontWeight: '900' }}>
              Add a person to {activeChannel?.name || 'group chat'}
            </Text>
            <Text style={{ color: '#64748B', fontSize: 13, lineHeight: 19 }}>
              Enter the email on their TrashTrack account. They will see this group in their chat list.
            </Text>
            <TextInput
              value={memberEmail}
              onChangeText={(value) => {
                setMemberEmail(value);
                setMemberError('');
              }}
              placeholder="name@example.com"
              placeholderTextColor="#94A3B8"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!addingMember}
              onFocus={() => setMemberError('')}
              style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 12, color: '#0F172A' }}
            />
            {memberError ? (
              <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 12, lineHeight: 18 }}>
                {memberError}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 3 }}>
              <TouchableOpacity onPress={() => setShowAddMemberModal(false)} disabled={addingMember} style={{ paddingHorizontal: 14, paddingVertical: 11 }}>
                <Text style={{ color: '#475569', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAddMember} disabled={addingMember} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#0F766E', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11 }}>
                {addingMember && <ActivityIndicator size="small" color="#FFFFFF" />}
                <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{addingMember ? 'Adding…' : 'Add to group'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!groupChatToDelete}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deletingGroupChat) setGroupChatToDelete(null);
        }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'center', padding: 20 }}>
          <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 22, gap: 13 }}>
            <Text style={{ color: '#0F172A', fontSize: 19, fontWeight: '900' }}>Delete this group chat?</Text>
            <Text style={{ color: '#334155', fontSize: 14, fontWeight: '800' }}>{groupChatToDelete?.name}</Text>
            <Text style={{ color: '#64748B', fontSize: 13, lineHeight: 19 }}>
              This removes the group and its messages for everyone in the chat. This can’t be undone.
            </Text>
            {deleteGroupChatError ? (
              <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 12, lineHeight: 18 }}>
                {deleteGroupChatError}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 3 }}>
              <TouchableOpacity
                onPress={() => setGroupChatToDelete(null)}
                disabled={deletingGroupChat}
                style={{ paddingHorizontal: 14, paddingVertical: 11 }}
              >
                <Text style={{ color: '#475569', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDeleteGroupChat}
                disabled={deletingGroupChat}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#B91C1C', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11 }}
              >
                {deletingGroupChat && <ActivityIndicator size="small" color="#FFFFFF" />}
                <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{deletingGroupChat ? 'Deleting…' : 'Delete group'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <CreateGroupChatModal
        visible={showCreateGcModal}
        onClose={() => setShowCreateGcModal(false)}
        onCreated={(newChannelId) => {
          setShowCreateGcModal(false);
          setActiveChannelId(newChannelId);
          if (isMobile) setMobileView('chat');
        }}
        creatorRole={isCoordinator ? 'coordinator' : isMayor ? 'mayor' : 'cenro'}
        creatorName={auth.currentUser?.displayName || (isCoordinator ? (assignedBarangay ? `Brgy. ${assignedBarangay} Coordinator` : 'Barangay Coordinator') : isMayor ? 'Office of the Mayor' : 'CENRO Officer')}
      />

      <GroupChatMembersModal
        visible={showMembersModal}
        channel={customGroupChats.find((g) => g.id === membersModalChannel?.id) || membersModalChannel}
        onClose={() => setShowMembersModal(false)}
        currentUserUid={currentUserId || null}
        currentUserName={auth.currentUser?.displayName || (isCoordinator ? (assignedBarangay ? `Brgy. ${assignedBarangay} Coordinator` : 'Barangay Coordinator') : isMayor ? 'Office of the Mayor' : 'CENRO Officer')}
        onMemberAdded={(name) => {
          setMiniNotification(`${name} joined the group chat`);
        }}
        onRequestApproved={(name) => {
          setMiniNotification(`${name} joined the group chat`);
        }}
        onMemberKicked={(name) => {
          setMiniNotification(`${name} was removed from the group chat`);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topHeaderBar: {
    backgroundColor: '#042F2E',
    paddingHorizontal: 24,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#115E59',
  },
  headerTitleGroup: {
    flexDirection: 'column',
    gap: 2,
  },
  agencyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  agencyBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#CCFBF1',
    letterSpacing: 1,
  },
  headerMainTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  securityStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#134E4A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2DD4BF',
  },
  securityStatusText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#CCFBF1',
    letterSpacing: 0.5,
  },
  mainLayout: {
    flex: 1,
    flexDirection: 'row',
  },
  channelSidebar: {
    width: 280,
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  channelSidebarMobile: {
    width: '100%',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    color: '#1E293B',
    padding: 0,
  },
  channelScroll: {
    flex: 1,
  },
  channelSectionHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 0,
    paddingHorizontal: 4,
  },
  newGcHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDFA',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  newGcHeaderBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0D9488',
  },
  gcTagBadge: {
    backgroundColor: '#ECFDF5',
    paddingVertical: 1,
    paddingHorizontal: 5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    marginLeft: 4,
  },
  gcTagBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#059669',
  },
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 4,
    gap: 12,
  },
  channelItemActive: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  channelAvatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  channelAvatarWrapActive: {
    backgroundColor: '#0D9488',
  },
  channelIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  channelIconWrapActive: {
    backgroundColor: '#0D9488',
  },
  channelInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  channelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  channelName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#334155',
  },
  channelNameActive: {
    color: '#0F766E',
    fontWeight: '800',
  },
  highPriorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DC2626',
  },
  channelDesc: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  channelTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  channelBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 12,
  },
  channelBadgeActive: {
    backgroundColor: '#0D9488',
  },
  channelBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
  },
  channelBadgeTextActive: {
    color: '#FFFFFF',
  },
  messengerDotsBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pendingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    position: 'absolute',
    top: 4,
    right: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  actionMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  actionMenuCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  actionMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 12,
  },
  actionMenuAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0FDFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionMenuTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  actionMenuSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  actionMenuCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  actionMenuList: {
    gap: 8,
  },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    gap: 12,
  },
  actionMenuItemDanger: {
    backgroundColor: '#FEF2F2',
  },
  actionMenuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  actionMenuItemTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#1E293B',
  },
  actionMenuItemDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  actionMenuPendingBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 'auto',
  },
  actionMenuPendingText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '800',
  },
  chatArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    flexDirection: 'column',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 12,
  },
  backButton: {
    padding: 6,
  },
  chatHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F0FDFA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatHeaderTitleWrap: {
    flex: 1,
  },
  chatHeaderTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  chatHeaderSubtitle: {
    fontSize: 11.5,
    color: '#64748B',
  },
  templateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#F1F5F9',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
  },
  templateBarLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  templateScroll: {
    gap: 6,
  },
  templateChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  templateChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  messageScroll: {
    flex: 1,
  },
  messageList: {
    padding: 20,
    gap: 14,
  },
  emptyFeed: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyFeedTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#64748B',
    marginTop: 6,
  },
  emptyFeedSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    maxWidth: 320,
  },
  messageRow: {
    flexDirection: 'row',
    width: '100%',
  },
  messageRowRight: {
    justifyContent: 'flex-end',
  },
  messageRowLeft: {
    justifyContent: 'flex-start',
  },
  messageRowCenro: {
    justifyContent: 'flex-end',
  },
  messageRowCicto: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  messageBubbleMe: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
    borderBottomRightRadius: 4,
  },
  messageBubbleCenro: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderBottomLeftRadius: 4,
  },
  messageBubbleCicto: {
    backgroundColor: '#F0FDFA',
    borderColor: '#CCFBF1',
    borderBottomLeftRadius: 4,
  },
  messageBubbleCoord: {
    backgroundColor: '#FEFCE8',
    borderColor: '#FEF08A',
    borderBottomLeftRadius: 4,
  },
  messageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  senderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  senderNameText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  senderNameCenro: {
    color: '#059669',
  },
  senderNameCicto: {
    color: '#0D9488',
  },
  senderNameCoord: {
    color: '#15803D',
  },
  urgentBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  urgentBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#DC2626',
  },
  highBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  highBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#D97706',
  },
  messageSubject: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  messageBody: {
    fontSize: 13,
    color: '#1E293B',
    lineHeight: 18,
  },
  messageFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    gap: 12,
  },
  senderEmail: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
  },
  messageTimestamp: {
    fontSize: 9.5,
    color: '#94A3B8',
  },
  inputArea: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    padding: 14,
    gap: 10,
  },
  messageInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: '#0F172A',
    maxHeight: 100,
    minHeight: 44,
  },
  actionButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  urgentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  urgentButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0D9488',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  sendButtonText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  miniNotificationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderBottomWidth: 1,
    borderBottomColor: '#A7F3D0',
    paddingHorizontal: 16,
    paddingVertical: 9,
    gap: 9,
  },
  miniNotifIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniNotificationText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '700',
    color: '#065F46',
  },
  miniNotifCloseBtn: {
    padding: 3,
  },
  systemEventRow: {
    alignItems: 'center',
    marginVertical: 8,
    paddingHorizontal: 12,
  },
  systemEventPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 6,
  },
  systemEventText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#0F766E',
  },
  systemEventTime: {
    fontSize: 10,
    color: '#94A3B8',
    marginLeft: 4,
  },
});
