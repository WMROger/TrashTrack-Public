import { auth, db } from '@/config/firebase';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  runTransaction,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  writeBatch,
  where,
  limit,
} from 'firebase/firestore';
import { MaterialIcons } from '@expo/vector-icons';

export interface GroupChatJoinRequest {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  requestedAt: any;
}

export interface GroupChatItem {
  id: string;
  name: string;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  priority?: 'normal' | 'high' | 'urgent';
  isCustomGC: boolean;
  createdBy?: {
    uid: string;
    name: string;
    role: string;
  };
  createdAt?: any;
  memberUids?: string[];
  joinRequests?: GroupChatJoinRequest[];
}

export interface GroupChatMemberSuggestion {
  uid: string;
  email: string;
  displayName: string;
  role: string;
}

const GROUP_CHAT_MEMBER_ROLES = [
  'admin', 'cenro', 'cenro_officer', 'cicto', 'cicto_admin',
  'mayor', 'coordinator', 'barangay_coordinator', 'cenro_coordinator',
];

export async function getGroupChatMemberSuggestions(excludeUids: string[] = []): Promise<GroupChatMemberSuggestion[]> {
  if (!db || !auth.currentUser) throw new Error('Sign in before searching for group members.');
  const snapshot = await getDocs(query(
    collection(db, 'users'),
    where('role', 'in', GROUP_CHAT_MEMBER_ROLES),
  ));
  const excluded = new Set([...excludeUids, auth.currentUser.uid]);
  return snapshot.docs.flatMap((userDoc) => {
    const profile = userDoc.data();
    const email = String(profile.email || '').trim();
    const status = String(profile.status || 'active').toLowerCase();
    if (!email || excluded.has(userDoc.id) || profile.disabled === true || ['disabled', 'inactive', 'pending'].includes(status)) {
      return [];
    }
    return [{
      uid: userDoc.id,
      email,
      displayName: String(profile.displayName || profile.name || email),
      role: String(profile.role || 'staff'),
    }];
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function createGroupChat(params: {
  name: string;
  description: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  priority?: 'normal' | 'high' | 'urgent';
  creatorName?: string;
  creatorRole?: 'cicto' | 'admin' | 'cenro' | 'coordinator' | 'mayor';
}): Promise<{ success: boolean; channelId?: string; error?: string }> {
  if (!db) {
    return { success: false, error: 'Database service is currently unavailable.' };
  }

  const cleanName = params.name.trim();
  const cleanDesc = params.description.trim();

  if (!cleanName) {
    return { success: false, error: 'Group Chat name cannot be empty.' };
  }

  const channelId = `gc-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { success: false, error: 'You must be signed in to create a group chat.' };
  }
  const uid = currentUser.uid;
  const senderName = params.creatorName || currentUser.displayName || (params.creatorRole === 'cicto' ? 'CICTO IT Authority' : 'CENRO Officer');
  const senderRole = params.creatorRole || 'cenro';

  try {
    const batch = writeBatch(db);
    const channelRef = doc(db, 'interagency_channels', channelId);
    const inauguralMessageRef = doc(collection(db, 'interagency_messages'));
    batch.set(channelRef, {
      name: cleanName,
      description: cleanDesc || 'Executive coordination channel established for city leadership and field response.',
      icon: params.icon || 'groups',
      priority: params.priority || 'normal',
      isCustomGC: true,
      createdBy: {
        uid,
        name: senderName,
        role: senderRole,
      },
      memberUids: [uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(inauguralMessageRef, {
      channelId,
      subject: `Group Chat Created: ${cleanName}`,
      message: `Group Chat "${cleanName}" was officially created by ${senderName} (${senderRole.toUpperCase()}). Direct interagency dispatch line between Office of the Mayor, CENRO, and CICTO is now live.`,
      priority: params.priority || 'normal',
      senderUid: uid,
      senderName,
      senderEmail: currentUser.email || (senderRole === 'cicto' ? 'cicto@trashtrack.gov.ph' : 'cenro@trashtrack.gov.ph'),
      senderRole,
      status: 'sent',
      createdAt: serverTimestamp(),
    });
    await batch.commit();

    return { success: true, channelId };
  } catch (err: any) {
    console.error('Failed to create group chat:', err);
    return { success: false, error: err?.message || 'Could not establish Group Chat channel.' };
  }
}

export function subscribeGroupChats(
  onUpdate: (channels: GroupChatItem[]) => void,
  userUid?: string
): () => void {
  if (!db) return () => {};

  const targetUid = userUid || auth.currentUser?.uid;
  if (!targetUid) {
    onUpdate([]);
    return () => {};
  }

  const channelCollection = collection(db, 'interagency_channels');
  const q = query(channelCollection, where('memberUids', 'array-contains', targetUid));
  return onSnapshot(
    q,
    (snap) => {
      const gcs: GroupChatItem[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || 'Untitled Group Chat',
          description: data.description || '',
          icon: (data.icon as any) || 'groups',
          priority: data.priority || 'normal',
          isCustomGC: true,
          createdBy: data.createdBy,
          createdAt: data.createdAt,
          memberUids: Array.isArray(data.memberUids) ? data.memberUids : [],
          joinRequests: Array.isArray(data.joinRequests) ? data.joinRequests : [],
        };
      });
      const toMillis = (value: any) => value?.toMillis?.() || 0;
      gcs.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onUpdate(gcs);
    },
    (err) => {
      console.warn('Group chat subscription notice:', err);
    }
  );
}

export async function addMemberToGroupChat(channelId: string, email: string, memberUid?: string) {
  if (!db || !auth.currentUser) throw new Error('Sign in before adding a group member.');
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Enter the email address for an existing TrashTrack account.');
  const allowedRoles = [
    'admin', 'cenro', 'cenro_officer', 'cicto', 'cicto_admin',
    'mayor', 'coordinator', 'barangay_coordinator', 'cenro_coordinator',
  ];
  let targetUid: string | undefined;
  let targetProfile: any;
  if (memberUid) {
    const targetSnapshot = await getDoc(doc(db, 'users', memberUid));
    const profile = targetSnapshot.data();
    const status = String(profile?.status || 'active').toLowerCase();
    if (targetSnapshot.exists() && profile && allowedRoles.includes(profile.role)
      && profile.disabled !== true && !['disabled', 'inactive', 'pending'].includes(status)) {
      targetUid = targetSnapshot.id;
      targetProfile = profile;
    }
  } else {
    const matchingUsers = await getDocs(query(
      collection(db, 'users'),
      where('email', '==', normalizedEmail),
      where('role', 'in', allowedRoles),
      limit(2),
    ));
    const target = matchingUsers.docs.find((userDoc) => {
      const profile = userDoc.data();
      return profile.disabled !== true && !['disabled', 'inactive', 'pending'].includes(profile.status);
    });
    if (target) {
      targetUid = target.id;
      targetProfile = target.data();
    }
  }
  if (!targetUid || !targetProfile) {
    throw new Error('No active municipal operations account was found for that email. Check the address and account status.');
  }

  const channelRef = doc(db, 'interagency_channels', channelId);
  return runTransaction(db, async (transaction) => {
    const channelSnapshot = await transaction.get(channelRef);
    if (!channelSnapshot.exists() || channelSnapshot.data().isCustomGC !== true) {
      throw new Error('This group chat could not be found.');
    }
    const channel = channelSnapshot.data();
    const members = Array.isArray(channel.memberUids) ? channel.memberUids : [];
    const alreadyMember = members.includes(targetUid);
    if (!alreadyMember) {
      transaction.update(channelRef, {
        memberUids: arrayUnion(targetUid),
        updatedAt: serverTimestamp(),
      });

      // Post system announcement message so the mini notification & chat history show "[Name] joined the group chat"
      const targetName = targetProfile.displayName || targetProfile.name || (targetProfile.role === 'cenro' ? 'CENRO' : targetProfile.email);
      const inauguralMessageRef = doc(collection(db, 'interagency_messages'));
      transaction.set(inauguralMessageRef, {
        channelId,
        subject: 'Member Joined',
        message: `${targetName} joined the group chat`,
        priority: 'normal',
        senderUid: auth.currentUser?.uid || 'system',
        senderName: 'System',
        senderEmail: auth.currentUser?.email || '',
        senderRole: 'system',
        isSystemNotification: true,
        status: 'sent',
        createdAt: serverTimestamp(),
      });
    }
    return {
      uid: targetUid,
      email: targetProfile.email || normalizedEmail,
      displayName: targetProfile.displayName || targetProfile.name || normalizedEmail,
      alreadyMember,
    };
  });
}

export async function deleteGroupChat(channelId: string) {
  if (!db || !auth.currentUser) throw new Error('Sign in before deleting a group chat.');

  const channelRef = doc(db, 'interagency_channels', channelId);
  const channelSnapshot = await getDoc(channelRef);
  if (!channelSnapshot.exists() || channelSnapshot.data().isCustomGC !== true) {
    throw new Error('This group chat could not be found.');
  }

  let removedMessages = 0;
  while (true) {
    const messageSnapshot = await getDocs(query(
      collection(db, 'interagency_messages'),
      where('channelId', '==', channelId),
      limit(400),
    ));
    if (messageSnapshot.empty) break;

    const batch = writeBatch(db);
    messageSnapshot.docs.forEach((messageDoc) => batch.delete(messageDoc.ref));
    await batch.commit();
    removedMessages += messageSnapshot.size;
  }

  await deleteDoc(channelRef);
  return { removedMessages };
}

export async function kickMemberFromGroupChat(
  channelId: string,
  memberUid: string,
  removerName?: string
) {
  if (!db || !auth.currentUser) throw new Error('Sign in before managing group members.');
  const channelRef = doc(db, 'interagency_channels', channelId);

  return runTransaction(db, async (transaction) => {
    const channelSnapshot = await transaction.get(channelRef);
    if (!channelSnapshot.exists() || channelSnapshot.data().isCustomGC !== true) {
      throw new Error('This group chat could not be found.');
    }
    const channel = channelSnapshot.data();
    const isCreator = channel.createdBy?.uid === auth.currentUser.uid;
    if (!isCreator) {
      throw new Error('Only the creator of this group chat can kick members.');
    }
    if (memberUid === channel.createdBy?.uid) {
      throw new Error('The group chat creator cannot be kicked.');
    }

    const memberDoc = await transaction.get(doc(db, 'users', memberUid));
    const memberData = memberDoc.data();
    const memberName = memberData?.displayName || memberData?.name || memberData?.email || 'A member';

    transaction.update(channelRef, {
      memberUids: arrayRemove(memberUid),
      updatedAt: serverTimestamp(),
    });

    const sysMsgRef = doc(collection(db, 'interagency_messages'));
    const adminName = removerName || auth.currentUser.displayName || 'The creator';
    transaction.set(sysMsgRef, {
      channelId,
      subject: 'Member Removed',
      message: `${memberName} was removed from the group chat by ${adminName}.`,
      priority: 'normal',
      senderUid: auth.currentUser.uid,
      senderName: 'System',
      senderEmail: auth.currentUser.email || '',
      senderRole: 'system',
      isSystemNotification: true,
      status: 'sent',
      createdAt: serverTimestamp(),
    });

    return { success: true, kickedUid: memberUid, memberName };
  });
}

export async function requestToJoinGroupChat(
  channelId: string,
  applicantProfile?: { displayName?: string; role?: string }
) {
  if (!db || !auth.currentUser) throw new Error('Sign in before applying to join a group chat.');
  const currentUid = auth.currentUser.uid;
  const channelRef = doc(db, 'interagency_channels', channelId);

  return runTransaction(db, async (transaction) => {
    const channelSnapshot = await transaction.get(channelRef);
    if (!channelSnapshot.exists() || channelSnapshot.data().isCustomGC !== true) {
      throw new Error('This group chat could not be found.');
    }
    const channel = channelSnapshot.data();
    const members: string[] = Array.isArray(channel.memberUids) ? channel.memberUids : [];
    if (members.includes(currentUid)) {
      throw new Error('You are already a member of this group chat.');
    }

    const requests: GroupChatJoinRequest[] = Array.isArray(channel.joinRequests) ? channel.joinRequests : [];
    const alreadyRequested = requests.some((r) => r.uid === currentUid);
    if (alreadyRequested) {
      return { success: true, alreadyRequested: true };
    }

    const applicantName = applicantProfile?.displayName || auth.currentUser.displayName || auth.currentUser.email || 'Municipal Staff';
    const applicantRole = applicantProfile?.role || 'staff';

    const newRequest: GroupChatJoinRequest = {
      uid: currentUid,
      displayName: applicantName,
      email: auth.currentUser.email || '',
      role: applicantRole,
      requestedAt: Date.now(),
    };

    transaction.update(channelRef, {
      joinRequests: arrayUnion(newRequest),
      updatedAt: serverTimestamp(),
    });

    const sysMsgRef = doc(collection(db, 'interagency_messages'));
    transaction.set(sysMsgRef, {
      channelId,
      subject: 'Join Request',
      message: `${applicantName} submitted an application request to join the group chat.`,
      priority: 'normal',
      senderUid: currentUid,
      senderName: applicantName,
      senderEmail: auth.currentUser.email || '',
      senderRole: 'system',
      isSystemNotification: true,
      status: 'sent',
      createdAt: serverTimestamp(),
    });

    return { success: true, request: newRequest };
  });
}

export async function approveJoinRequest(
  channelId: string,
  request: GroupChatJoinRequest,
  approvedByName?: string
) {
  if (!db || !auth.currentUser) throw new Error('Sign in before approving group requests.');
  const channelRef = doc(db, 'interagency_channels', channelId);

  return runTransaction(db, async (transaction) => {
    const channelSnapshot = await transaction.get(channelRef);
    if (!channelSnapshot.exists() || channelSnapshot.data().isCustomGC !== true) {
      throw new Error('This group chat could not be found.');
    }
    const channel = channelSnapshot.data();
    const isCreator = channel.createdBy?.uid === auth.currentUser.uid;
    if (!isCreator) {
      throw new Error('Only the creator of this group chat can approve join requests.');
    }

    const currentRequests: GroupChatJoinRequest[] = Array.isArray(channel.joinRequests) ? channel.joinRequests : [];
    const updatedRequests = currentRequests.filter((r) => r.uid !== request.uid);

    transaction.update(channelRef, {
      memberUids: arrayUnion(request.uid),
      joinRequests: updatedRequests,
      updatedAt: serverTimestamp(),
    });

    // Format display name: if role is CENRO / cenro_officer, say CENRO
    const joinName = request.role === 'cenro' || request.role === 'cenro_officer'
      ? 'CENRO'
      : (request.displayName || request.email || 'A user');

    const sysMsgRef = doc(collection(db, 'interagency_messages'));
    transaction.set(sysMsgRef, {
      channelId,
      subject: 'Member Joined',
      message: `${joinName} joined the group chat`,
      priority: 'normal',
      senderUid: auth.currentUser.uid,
      senderName: 'System',
      senderEmail: auth.currentUser.email || '',
      senderRole: 'system',
      isSystemNotification: true,
      status: 'sent',
      createdAt: serverTimestamp(),
    });

    return { success: true, approvedUid: request.uid, joinName };
  });
}

export async function rejectJoinRequest(channelId: string, applicantUid: string) {
  if (!db || !auth.currentUser) throw new Error('Sign in before declining group requests.');
  const channelRef = doc(db, 'interagency_channels', channelId);

  return runTransaction(db, async (transaction) => {
    const channelSnapshot = await transaction.get(channelRef);
    if (!channelSnapshot.exists() || channelSnapshot.data().isCustomGC !== true) {
      throw new Error('This group chat could not be found.');
    }
    const channel = channelSnapshot.data();
    const isCreator = channel.createdBy?.uid === auth.currentUser.uid;
    if (!isCreator) {
      throw new Error('Only the creator of this group chat can decline join requests.');
    }

    const currentRequests: GroupChatJoinRequest[] = Array.isArray(channel.joinRequests) ? channel.joinRequests : [];
    const updatedRequests = currentRequests.filter((r) => r.uid !== applicantUid);

    transaction.update(channelRef, {
      joinRequests: updatedRequests,
      updatedAt: serverTimestamp(),
    });

    return { success: true, rejectedUid: applicantUid };
  });
}

export interface GroupChatMemberProfile {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  isCreator: boolean;
}

export async function getGroupChatMembers(
  channelId: string,
  memberUids?: string[],
  creatorUid?: string
): Promise<GroupChatMemberProfile[]> {
  if (!db) return [];
  try {
    let uids = memberUids;
    let creator = creatorUid;

    // Fetch the latest channel document from Firestore to guarantee the freshest member list
    try {
      const channelRef = doc(db, 'interagency_channels', channelId);
      const channelSnap = await getDoc(channelRef);
      if (channelSnap.exists()) {
        const cData = channelSnap.data();
        if (Array.isArray(cData.memberUids) && cData.memberUids.length > 0) {
          uids = cData.memberUids;
        }
        if (cData.createdBy?.uid) {
          creator = cData.createdBy.uid;
        }
      }
    } catch (chanErr) {
      console.warn('getGroupChatMembers: channel fetch fallback to passed uids', chanErr);
    }

    if (!uids || uids.length === 0) return [];

    const members: GroupChatMemberProfile[] = [];
    for (let i = 0; i < uids.length; i += 10) {
      const slice = uids.slice(i, i + 10);
      const userDocs = await Promise.all(slice.map((uid) => getDoc(doc(db, 'users', uid))));
      userDocs.forEach((d) => {
        if (d.exists()) {
          const u = d.data();
          if (u.disabled === true || u.status === 'disabled') {
            return;
          }
          members.push({
            uid: d.id,
            email: String(u.email || ''),
            displayName: String(u.displayName || u.name || u.email || 'Municipal User'),
            role: String(u.role || 'staff'),
            isCreator: d.id === creator,
          });
        }
      });
    }
    return members.sort((a, b) => {
      if (a.isCreator) return -1;
      if (b.isCreator) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  } catch (err) {
    console.warn('Error fetching group chat members:', err);
    return [];
  }
}
