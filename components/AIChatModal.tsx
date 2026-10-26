import ChatMessage from '@/components/ChatMessage';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { auth, db } from '@/config/firebase';
import { getN8nWebhookUrl } from '@/config/n8n';
import { Colors } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import { Ionicons } from '@expo/vector-icons';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    LogBox,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

// Suppress expo-notifications warning in Expo Go (not needed for AI chat functionality)
LogBox.ignoreLogs([
  'expo-notifications',
  'Android Push notifications',
  'Expo Go',
]);

interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: Date;
}

interface AIChatModalProps {
  visible: boolean;
  onClose: () => void;
}

function isScheduleIntent(text: string): boolean {
  const t = text.toLowerCase();
  const keys = [
    'schedule', 'pickup', 'collection', 'when', 'time', 'date', 'next pickup', 'upcoming', 'today', 'tomorrow'
  ];
  return keys.some(k => t.includes(k));
}

async function buildSchedulesContextForBarangay(barangay: string) {
  if (!db || !barangay) return null;
  try {
    const toDateSafe = (val: any): Date | null => {
      try {
        if (!val) return null;
        // Firestore Timestamp
        if (typeof val?.toDate === 'function') return val.toDate();
        // { seconds, nanoseconds }
        if (typeof val?.seconds === 'number') return new Date(val.seconds * 1000);
        // ISO/date-like string
        const asDate = new Date(val);
        if (!isNaN(asDate.getTime())) return asDate;
        return null;
      } catch {
        return null;
      }
    };

    const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);
    const toReadable = (d: Date | null, timeZone?: string): string | null => {
      if (!d) return null;
      try {
        const opts: Intl.DateTimeFormatOptions = {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        };
        return new Intl.DateTimeFormat(undefined, { ...opts, timeZone }).format(d);
      } catch {
        return d.toDateString();
      }
    };

    const ref = collection(db, 'barangay_schedules');
    const qy = query(
      ref,
      where('barangayName', '==', barangay),
      limit(20)
    );
    const snap = await getDocs(qy);
    const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any[];

    // Map to a format the AI understands perfectly
    const normalized = items.map((r) => {
      return {
        id: r.id,
        location: r.barangayName,
        category: r.wasteCategory || 'Mixed',
        recurringDays: Array.isArray(r.days)
          ? r.days
              .map((d: string) => {
                const dt = r.dayTimes && r.dayTimes[d];
                return dt ? `${d} at ${dt}` : (r.time ? `${d} at ${r.time}` : d);
              })
              .join(', ')
          : 'None',
        specialDates: Array.isArray(r.specificSchedules) 
          ? r.specificSchedules.map((s: any) => `${s.date || 'Unknown'} at ${s.time || 'Unknown'}${s.description ? ` (${s.description})` : ''}`).join('; ')
          : 'None',
      };
    });

    return {
      total: normalized.length,
      items: normalized
    };
  } catch (e) {
    console.error('Failed to build schedules context:', e);
    return null;
  }
}

async function buildAnnouncementsContext(): Promise<any | null> {
  if (!db) return null;
  try {
    const ref = collection(db, 'announcements');
    const qy = query(ref, where('isPublished', '==', true), limit(10));
    const snap = await getDocs(qy);
    const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any[];
    // Sort client-side by createdAt desc
    items.sort((a: any, b: any) => {
      const ad = typeof a.createdAt?.toDate === 'function' ? a.createdAt.toDate() : new Date(a.createdAt);
      const bd = typeof b.createdAt?.toDate === 'function' ? b.createdAt.toDate() : new Date(b.createdAt);
      return (bd?.getTime?.() || 0) - (ad?.getTime?.() || 0);
    });
    const compact = items.map((a) => ({
      id: a.id,
      title: a.title || '',
      description: a.description || '',
      priority: a.priority || 'Medium',
      category: a.category || 'General',
      createdAtIso: (typeof a.createdAt?.toDate === 'function' ? a.createdAt.toDate() : new Date(a.createdAt))?.toISOString?.() || null,
    }));
    return { total: compact.length, items: compact };
  } catch (e) {
    console.error('Failed to build announcements context:', e);
    return null;
  }
}

async function buildNotificationsContext(userId: string): Promise<any | null> {
  if (!db || !userId) return null;
  try {
    const ref = collection(db, 'userNotifications');
    const qy = query(ref, where('userId', '==', userId), limit(20));
    const snap = await getDocs(qy);
    const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any[];
    // Sort client-side by createdAt desc
    items.sort((a: any, b: any) => {
      const ad = typeof a.createdAt?.toDate === 'function' ? a.createdAt.toDate() : new Date(a.createdAt);
      const bd = typeof b.createdAt?.toDate === 'function' ? b.createdAt.toDate() : new Date(b.createdAt);
      return (bd?.getTime?.() || 0) - (ad?.getTime?.() || 0);
    });
    const compact = items.map((n) => ({
      id: n.id,
      title: n.title || 'Notification',
      body: n.body || '',
      type: n.type || 'general',
      read: !!n.read,
      createdAtIso: (typeof n.createdAt?.toDate === 'function' ? n.createdAt.toDate() : new Date(n.createdAt))?.toISOString?.() || null,
    }));
    return { total: compact.length, items: compact };
  } catch (e) {
    console.error('Failed to build notifications context:', e);
    return null;
  }
}

async function buildProfileContext(userId: string): Promise<any | null> {
  if (!db || !userId) return null;
  try {
    const userRef = doc(db, 'users', userId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return null;
    const u: any = snap.data();
    return {
      displayName: u.displayName || null,
      role: u.role || null,
      photoURL: u.photoURL || null,
      barangay: u.barangay || u.address || null,
    };
  } catch (e) {
    console.error('Failed to build profile context:', e);
    return null;
  }
}

async function buildPickupsContext(userId: string): Promise<any | null> {
  // Optional: best-effort from a likely collection name; ignore if missing
  if (!db || !userId) return null;
  try {
    const ref = collection(db, 'pickupHistory');
    const qy = query(ref, where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(5));
    const snap = await getDocs(qy);
    const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any[];
    const compact = items.map((p) => ({
      id: p.id,
      status: p.status || 'completed',
      type: p.type || p.category || 'general',
      completedAtIso: (typeof p.createdAt?.toDate === 'function' ? p.createdAt.toDate() : new Date(p.createdAt))?.toISOString?.() || null,
    }));
    return { total: compact.length, items: compact };
  } catch {
    return null;
  }
}

const buildOfflineAssistantResponse = (queryText: string, context: any) => {
  const normalized = queryText.toLowerCase();
  if (/schedule|pickup|collection/.test(normalized)) {
    const schedules = Array.isArray(context?.schedules?.items) ? context.schedules.items : [];
    return schedules.length
      ? `You have ${schedules.length} collection schedule${schedules.length === 1 ? '' : 's'} available. Open the Schedule tab for confirmed dates, route, and live truck status.`
      : 'You do not have an assigned collection schedule yet. Confirmed schedules will appear in the Schedule tab when CENRO publishes them.';
  }
  if (/announcement|alert/.test(normalized)) {
    const count = Number(context?.announcements?.total || 0);
    return count
      ? `There ${count === 1 ? 'is' : 'are'} ${count} published announcement${count === 1 ? '' : 's'}. Open the Announce tab to review the official details.`
      : 'There are no published announcements in your TrashTrack data right now.';
  }
  if (/notification|inbox/.test(normalized)) {
    const count = Number(context?.notifications?.total || 0);
    return count
      ? `Your inbox contains ${count} notification${count === 1 ? '' : 's'}. Open the notification list to review them.`
      : 'Your TrashTrack inbox is currently empty.';
  }
  return 'The online AI service is temporarily unavailable. You can still report waste, view collection schedules, read official announcements, and track submitted reports in TrashTrack.';
};

// Call Gemini API for AI processing
async function generateAIResponse(query: string, options?: { context?: any; userId?: string }): Promise<string> {
  try {
    // Enhanced system prompt for TrashTrack app
    const systemPrompt = `You are an AI assistant for TrashTrack, a waste management app that helps users track and manage their waste efficiently. You are friendly, helpful, and knowledgeable about many topics, but you have a special focus on waste management, recycling, sustainability, and the TrashTrack app features.

🚨 CRITICAL INSTRUCTION: You have access to the user's actual data through the context object. You MUST use this data to provide personalized responses. Do NOT give generic responses like "I don't have access" or "I need more information". 

For the user's question about schedules, check context.schedules.items. If it's empty, say "I can see you don't have any pickup schedules assigned yet in TrashTrack. Schedules are set up by administrators and will appear in your Schedule tab when available." If it has data, list the actual schedules.

IMPORTANT: You have access to the user's actual data through the context. Use this data to provide personalized responses. Don't give generic advice when you have specific user data available.

CRITICAL: Always check the context data first:
- context.schedules.items - for pickup schedules
- context.announcements.items - for announcements  
- context.notifications.items - for notifications
- context.profile - for user information

If the data exists, use it. If it's empty, explain what that means in the context of TrashTrack.

MANDATORY: You MUST use the provided context data. Do NOT give generic responses about "I don't have access" or "I need more information". Use the actual data from the context or explain what empty data means in TrashTrack.

## TrashTrack App Features:

### Schedule Screen:
- Calendar view with color-coded waste categories
- Pickup dates, times, and locations
- Street/barangay information
- Collection frequencies: Daily, Weekly, Monthly, One-time

### Report Screen:
- Report uncollected trash or illegal dumping
- Upload photos of trash piles
- Specify location (Barangay, Street, Landmark)
- Currently serving the user's selected barangay: \${options?.context?.profile?.barangay || 'Unknown'}

### Announcements Screen:
- View important updates from waste management team
- Categories: General, Schedule Change, Service Update, Emergency, Maintenance, Holiday Notice, Policy Update
- Priority levels: Low, Medium, High, Urgent
- Comment on announcements

### Home Screen:
- Dashboard with recent announcements
- Notification center
- Quick access to features

### Notifications:
- Pickup reminders
- Announcement alerts
- Pickup completion notifications

## Waste Categories in TrashTrack:
- 🟢 **Biodegradable**: Food waste, plant materials
- 🔵 **Non-Biodegradable**: Plastics, packaging
- 🟡 **Recyclable**: Paper, glass, metal
- ⚫ **Residual**: Mixed/non-recyclable waste
- 🔴 **Hazardous**: Batteries, chemicals
- 🟣 **Special/Bulk**: Large items, special collections

## Your Role:
- ALWAYS use the provided context data to give personalized, app-specific responses
- When users ask about schedules, check their actual schedule data from the context
- When users ask about announcements, reference their actual announcements from the context
- When users ask about notifications, reference their actual notifications from the context
- Be helpful and engaging with all topics, but subtly guide conversations toward TrashTrack and waste management
- When users ask about non-waste topics, provide brief helpful answers but gently mention how TrashTrack can help with waste management
- Reference actual TrashTrack features when relevant
- Provide general waste management tips that align with the app's waste categories
- Help users navigate and use the app (e.g., "Go to the Schedule tab to see your pickup dates")
- Mention the waste categories when discussing recycling/sorting tips
- Guide users on reporting trash, viewing schedules, checking announcements
- Use phrases like "Speaking of sustainability..." or "That reminds me of waste management..." to naturally transition topics

## Context Usage:
- If user asks about schedules and context.schedules.items is empty, explain that schedules are set by administrators and will appear when available
- If user asks about schedules and context.schedules.items has data, list their actual pickup schedules with dates, times, waste categories, and locations
- If user asks about announcements and context.announcements.items exists, reference their actual announcements with titles, descriptions, priorities, and categories
- If user asks about notifications and context.notifications.items exists, reference their actual notifications with titles, bodies, and types
- Always mention specific TrashTrack features that can help with their request
- Use the actual data from context instead of giving generic advice

## Example Responses:
- User: "Can you tell me the schedules for trash collecting?"
- If context.schedules.items is empty: "I can see you don't have any pickup schedules assigned yet in TrashTrack. Schedules are set up by administrators and will appear in your Schedule tab when available. You can check the Schedule tab to see if any new schedules have been added."
- If context.schedules.items has data: "Here are your current pickup schedules: [list actual schedules from context with dates, times, waste categories, and locations]"

- User: "What announcements do I have?"
- Reference context.announcements.items: "You have [X] announcements. Here are the latest: [list actual announcements with titles, descriptions, priorities, and categories]"

- User: "What notifications do I have?"
- Reference context.notifications.items: "You have [X] notifications. Here are the latest: [list actual notifications with titles, bodies, and types]"

## SPECIFIC INSTRUCTION FOR SCHEDULE QUESTIONS:
When user asks "Can you tell me the schedules for trash collecting?" or similar:
1. Check context.schedules.items
2. If empty: "I can see you don't have any pickup schedules assigned yet in TrashTrack. Schedules are set up by administrators and will appear in your Schedule tab when available."
3. If has data: List the actual schedules with details
4. NEVER say "I don't have access" or "I need more information"

## Conversation Style:
- Be warm, friendly, and conversational
- Answer questions helpfully, but look for opportunities to mention TrashTrack features
- Use subtle transitions like "By the way, did you know TrashTrack can help with..." or "Speaking of [topic], TrashTrack has features for..."
- Never be pushy or overly promotional
- Make connections between user interests and waste management naturally

## Formatting & Navigation Guidelines:
- NEVER use asterisks (*) for bullet points; use clean bullet symbols (•) or numbers instead.
- Do NOT leave dangling or extra asterisks in your responses.
- When mentioning or recommending any TrashTrack section, explicitly mention the tab name as "Schedule tab", "Report tab", "Announcements tab", "Home tab", or "Profile tab" so the user can easily tap to navigate directly to it.

## Guardrails:
1) Never provide advice about illegal, dangerous, or harmful waste disposal methods
2) Always promote safe, legal, and environmentally-friendly practices
3) Focus on positive environmental impact and sustainability
4) If asked about inappropriate topics, redirect to waste management and TrashTrack features
5) Always encourage users to explore TrashTrack features when relevant`;

    const responseText = buildOfflineAssistantResponse(query, options?.context);
    let aiResponse = cleanAiResponse(responseText);
    aiResponse = applyGuardrails(aiResponse, query);
    
    return aiResponse;
  } catch (error) {
    console.error('❌ AI SDK error:', error);
    return buildOfflineAssistantResponse(query, options?.context);
  }
}

function cleanAiResponse(response: string): string {
  if (!response) return '';

  // 1. Remove <think> tags and their content
  response = response.replace(/<think>[\s\S]*?<\/think>/gi, '');
  
  // 2. Remove any remaining XML-like tags
  response = response.replace(/<[^>]*>/g, '');

  // 3. Clean up horizontal rules like *** or --- or * * *
  response = response.replace(/^\s*(\*\s*){3,}\s*$/gm, '');
  response = response.replace(/^\s*(-\s*){3,}\s*$/gm, '');

  // 4. Convert markdown list bullets (* or -) at start of lines into clean bullet points
  response = response.replace(/^(\s*)[*\-]\s+/gm, '$1• ');

  // 5. Convert bold-italic ***text*** to **text**
  response = response.replace(/\*\*\*([^*]+)\*\*\*/g, '**$1**');

  // 6. Convert single asterisk italics *text* into clean text
  response = response.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1$2$3');

  // 7. Remove any leftover isolated or dangling asterisks
  response = response.replace(/(\s)\*+(\s)/g, '$1$2');
  response = response.replace(/\s*\*+\s*$/gm, '');
  response = response.replace(/^\s*\*+\s*/gm, '');

  // 8. Clean up extra whitespace
  response = response.replace(/\n{3,}/g, '\n\n').trim();
  
  return response;
}

// Strict domain filter to prevent wasting tokens on unrelated queries
function isTrashRelatedQuery(query: string): boolean {
  const q = query.toLowerCase();
  
  // Strict list of allowed terms (Waste management and app-specific terms)
  const allowedTerms = [
    'trash', 'waste', 'recycle', 'recycling', 'compost', 'garbage', 'bin', 'landfill', 'plastic', 'paper', 'glass', 'metal',
    'e-waste', 'organic', 'hazardous', 'disposal', 'segregation', 'collection', 'pickup', 'schedule', 'litter', 'pollution',
    'sustainability', 'environment', 'eco', 'composting', 'reuse', 'reduce', 'sorting', 'incineration', 'municipal',
    'trashtrack', 'trash track', 'app', 'driver', 'route', 'dump', 'junk', 'debris', 'scrap', 'rubbish', 'refuse',
    'schedule', 'report', 'announcement', 'notification', 'pickup', 'barangay', 'sambag',
    'biodegradable', 'non-biodegradable', 'recyclable', 'residual', 'special', 'bulk',
    'upload', 'photo', 'image', 'location', 'street', 'landmark', 'comment', 'filter',
    'reminder', 'alert', 'update', 'change', 'maintenance', 'emergency', 'holiday', 'policy',
    'hello', 'hi', 'hey', 'help', 'who are you', 'what can you do'
  ];
  
  // Return true if any of the allowed terms are found in the query
  return allowedTerms.some(term => q.includes(term));
}

function applyGuardrails(response: string, originalQuery: string): string {
  // Basic content filtering for inappropriate responses
  const inappropriateKeywords = ['illegal', 'dangerous', 'harmful', 'toxic'];
  const hasInappropriateContent = inappropriateKeywords.some(keyword => 
    response.toLowerCase().includes(keyword)
  );
  
  if (hasInappropriateContent) {
    return 'I apologize, but I cannot provide advice about that. Please focus on safe and legal waste management practices. How can I help you with proper waste disposal and recycling?';
  }
  
  // Check if the query is clearly off-topic and needs gentle redirection
  const isOffTopic = !isTrashRelatedQuery(originalQuery);
  
  if (isOffTopic) {
    // Don't block the response, but let the AI handle it with the new system prompt
    // The AI will now provide helpful answers while subtly mentioning TrashTrack
    return response;
  }

  return response;
}

let messageIdCounter = 0;
function createMessageId(role: 'user' | 'ai'): string {
  messageIdCounter += 1;
  return `${role}-${Date.now()}-${messageIdCounter}-${Math.random().toString(36).substring(2, 7)}`;
}

export default function AIChatModal({ visible, onClose }: AIChatModalProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = Colors[theme ?? 'light'];
  const [messages, setMessages] = useState<Message[]>([
    {
      id: createMessageId('ai'),
      role: 'ai',
      text: 'Hello! I\'m your AI assistant for TrashTrack. How can I help you today?',
      timestamp: new Date(),
    },
  ]);
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const handleNavigate = (route: string) => {
    onClose();
    setTimeout(() => {
      try {
        router.push(route as any);
      } catch (err) {
        console.warn('Chat navigation error:', err);
      }
    }, 150);
  };

  const scrollToBottom = () => {
    if (flatListRef.current) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const handleKeyboardShow = (e?: any) => {
      setIsKeyboardVisible(true);
      if (Platform.OS === 'android' && e?.endCoordinates?.height) {
        setAndroidKeyboardHeight(e.endCoordinates.height);
      }
      setTimeout(scrollToBottom, 100);
    };

    const handleKeyboardHide = () => {
      setIsKeyboardVisible(false);
      if (Platform.OS === 'android') {
        setAndroidKeyboardHeight(0);
      }
      setTimeout(scrollToBottom, 100);
    };

    const showSubscription = Keyboard.addListener(showEvent, handleKeyboardShow);
    const hideSubscription = Keyboard.addListener(hideEvent, handleKeyboardHide);

    return () => {
      showSubscription?.remove();
      hideSubscription?.remove();
    };
  }, []);

  // Add escape key handling for web
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (event: any) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (Platform.OS === 'web') {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [visible, onClose]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    // Front-end domain check before sending to backend/webhook
    if (!isTrashRelatedQuery(input.trim())) {
      const userText = input.trim();
      const userMsg: Message = {
        id: createMessageId('user'),
        role: 'user',
        text: userText,
        timestamp: new Date(),
      };
      const aiMessage: Message = {
        id: createMessageId('ai'),
        role: 'ai',
        text: 'I’m specialized in TrashTrack and waste-related topics (recycling, disposal, composting, pickup schedules). Ask me something in that area.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMsg, aiMessage]);
      setInput('');
      return;
    }

    const userMessage: Message = {
      id: createMessageId('user'),
      role: 'user',
      text: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      console.log('🚀 Using n8n webhook for AI response');
      const userId = auth?.currentUser?.uid || null;
      // Build expanded context (profile, announcements, schedules, notifications, pickups, theme)
      let context: any = null;
      if (userId) {
        const profile = await buildProfileContext(userId);
        const [announcements, schedules, notifications, pickups] = await Promise.all([
          buildAnnouncementsContext(),
          buildSchedulesContextForBarangay(profile?.barangay),
          buildNotificationsContext(userId),
          buildPickupsContext(userId),
        ]);
        context = { profile, announcements, schedules, notifications, pickups };
      }
      // Include minimal client timezone for temporal awareness
      const clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      context = {
        ...(context || {}),
        ui: { theme },
        clientTimeZone,
      };
      
      const aiResponse = await generateAIResponse(userMessage.text, { context, userId });
      
      const aiMessage: Message = {
        id: createMessageId('ai'),
        role: 'ai',
        text: aiResponse,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, aiMessage]);

      // Persist lightweight continuity to user_settings
      try {
        if (db && userId) {
          const settingsRef = doc(db, 'user_settings', userId);
          const existing = await getDoc(settingsRef);
          const prevHistory: any[] = Array.isArray(existing.data()?.chatHistory) ? existing.data()!.chatHistory : [];
          // Firestore doesn't support serverTimestamp inside array values; use client ISO time for entries
          const nowIso = new Date().toISOString();
          const newEntry = { tIso: nowIso, q: userMessage.text, a: aiResponse };
          const trimmed = [...prevHistory, newEntry].slice(-30);
          await setDoc(settingsRef, {
            lastPrompt: userMessage.text,
            lastReply: aiResponse,
            lastSeenAt: serverTimestamp(),
            chatHistory: trimmed,
          }, { merge: true });
        }
      } catch (persistErr) {
        console.warn('Continuity persistence failed:', persistErr);
      }
    } catch (error) {
      console.error('❌ Error sending message:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
      
      const errorMessage: Message = {
        id: createMessageId('ai'),
        role: 'ai',
        text: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <ChatMessage message={item} onNavigate={handleNavigate} />
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      transparent={Platform.OS === 'web'}
    >
      {Platform.OS === 'web' ? (
        // Web version with click-outside-to-close
        <Pressable onPress={onClose} style={styles.webOverlay}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.webContainerWrapper}>
            <View style={[styles.webContainer, { backgroundColor: colors.background }]}>
                <View style={[styles.container, { backgroundColor: colors.background }]}>
                  <View style={[styles.header, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>
                      TrashTrack AI Assistant
                    </Text>
                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                      <Ionicons name="close" size={24} color={colors.textPrimary} />
                    </TouchableOpacity>
                  </View>

                  <FlatList
                    ref={flatListRef}
                    data={messages}
                    renderItem={renderMessage}
                    keyExtractor={(item, index) => item.id ? `${item.id}-${index}` : `msg-${index}`}
                    style={styles.messagesList}
                    contentContainerStyle={styles.messagesContainer}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  />

                  {isLoading && (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                        AI is thinking...
                      </Text>
                    </View>
                  )}

                  <View style={[styles.inputContainer, { borderTopColor: colors.border }]}>
                    <View style={[styles.inputWrapper, { borderColor: colors.border }]}>
                      <TextInput
                        style={[styles.input, { color: colors.textPrimary }]}
                        value={input}
                        onChangeText={setInput}
                        placeholder="Ask me about waste management..."
                        placeholderTextColor={colors.textTertiary}
                        multiline
                        maxLength={500}
                        onSubmitEditing={sendMessage}
                      />
                      <TouchableOpacity
                        style={[styles.sendButton, { backgroundColor: colors.primary }]}
                        onPress={sendMessage}
                        disabled={!input.trim() || isLoading}
                      >
                        <IconSymbol 
                          name="paperplane.fill" 
                          size={20} 
                          color={colors.surface} 
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
            </View>
          </Pressable>
        </Pressable>
      ) : (
        // Native version
        <KeyboardAvoidingView 
          style={[
            styles.container,
            {
              backgroundColor: colors.background,
              paddingBottom: Platform.OS === 'android' ? androidKeyboardHeight : 0,
            },
          ]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
        >
          <View
            style={[
              styles.header,
              {
                borderBottomColor: colors.border,
                paddingTop: Platform.OS === 'ios' ? 16 : Math.max(insets.top, 16),
              },
            ]}
          >
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              TrashTrack AI Assistant
            </Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item, index) => item.id ? `${item.id}-${index}` : `msg-${index}`}
            style={styles.messagesList}
            contentContainerStyle={styles.messagesContainer}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />

          {isLoading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                AI is thinking...
              </Text>
            </View>
          )}

          <View
            style={[
              styles.inputContainer,
              {
                borderTopColor: colors.border,
                paddingBottom: Platform.OS === 'ios' && !isKeyboardVisible ? Math.max(insets.bottom, 12) : 12,
              },
            ]}
          >
            <View style={[styles.inputWrapper, { borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.textPrimary }]}
                value={input}
                onChangeText={setInput}
                placeholder="Ask me about waste management..."
                placeholderTextColor={colors.textTertiary}
                multiline
                maxLength={500}
                onSubmitEditing={sendMessage}
              />
              <TouchableOpacity
                style={[styles.sendButton, { backgroundColor: colors.primary }]}
                onPress={sendMessage}
                disabled={!input.trim() || isLoading}
              >
                <IconSymbol 
                  name="paperplane.fill" 
                  size={20} 
                  color={colors.surface} 
                />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB', // Soft off-white background
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    zIndex: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  closeButton: {
    padding: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
  },
  messagesList: {
    flex: 1,
  },
  messagesContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 6,
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    paddingVertical: 10,
    color: '#1F2937',
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  // Web-specific styles
  webOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  webContainerWrapper: {
    width: '100%',
    maxWidth: 520,
    height: '85%',
    maxHeight: 700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webContainer: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
    overflow: 'hidden',
  },
});
