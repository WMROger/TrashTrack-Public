import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';

export type NotificationType = 
  | 'pickup_reminder' 
  | 'announcement' 
  | 'pickup_completed' 
  | 'schedule_change' 
  | 'emergency' 
  | 'truck_incoming'
  | 'truck_proximity'
  | 'general';

export function getNotificationIcon(type: string): string {
  switch ((type || 'general').toLowerCase()) {
    case 'truck_incoming':
      return 'clock.badge.checkmark.fill';
    case 'truck_proximity':
      return 'location.fill';
    case 'pickup_reminder':
      return 'truck.box.fill';
    case 'announcement':
      return 'megaphone.fill';
    case 'pickup_completed':
      return 'checkmark.circle.fill';
    case 'schedule_change':
      return 'calendar.badge.exclamationmark';
    case 'emergency':
      return 'exclamationmark.triangle.fill';
    default:
      return 'bell.fill';
  }
}

export function getNotificationColor(type: string): string {
  switch ((type || 'general').toLowerCase()) {
    case 'truck_incoming':
      return '#059669'; // Emerald Green
    case 'truck_proximity':
      return '#10B981'; // Green
    case 'pickup_reminder':
      return '#3B82F6'; // Blue
    case 'announcement':
      return '#8B5CF6'; // Purple
    case 'pickup_completed':
      return '#22C55E'; // Green
    case 'schedule_change':
      return '#F59E0B'; // Orange
    case 'emergency':
      return '#EF4444'; // Red
    default:
      return '#6B7280'; // Gray
  }
}

export function getNotificationTypeLabel(type: string): string {
  switch ((type || 'general').toLowerCase()) {
    case 'truck_incoming':
      return 'Incoming Collection';
    case 'truck_proximity':
      return 'Truck Nearby';
    case 'pickup_reminder':
      return 'Pickup Reminder';
    case 'announcement':
      return 'Announcement';
    case 'pickup_completed':
      return 'Pickup Completed';
    case 'schedule_change':
      return 'Schedule Change';
    case 'emergency':
      return 'Emergency';
    default:
      return 'General';
  }
}

export async function sendTestNotification(db: any, user: { uid: string } | null | undefined, currentTypeIndex: number): Promise<number> {
  if (!db || !user?.uid) return currentTypeIndex;
  const templates = [
    { 
      title: '🚛 Incoming Trash Collection (~30 mins)', 
      body: 'AI Arrival Alert: Collection truck is approaching your barangay. Estimated arrival in ~30 minutes. Please prepare your segregated waste!', 
      type: 'truck_incoming' 
    },
    { 
      title: '🔔 Collection Truck Nearby!', 
      body: 'Garbage truck is within 450m of your street. Collection is active in your sector!', 
      type: 'truck_proximity' 
    },
    { 
      title: '🚛 Pickup Reminder', 
      body: 'Your trash pickup is scheduled for tomorrow at 9:00 AM. Please have your bins ready!', 
      type: 'pickup_reminder' 
    },
    { 
      title: '📢 New Announcement', 
      body: 'Important: Schedule changes for next week due to holiday. Check your updated pickup times.', 
      type: 'announcement' 
    },
    { 
      title: '✅ Pickup Completed', 
      body: 'Your trash has been successfully collected today. Thank you for using our service!', 
      type: 'pickup_completed' 
    },
  ];

  const template = templates[currentTypeIndex % templates.length];
  await addDoc(collection(db, 'userNotifications'), {
    title: template.title,
    body: template.body,
    userId: user.uid,
    type: template.type,
    createdAt: new Date(),
    read: false,
  });

  return (currentTypeIndex + 1) % templates.length;
}

export async function markAsRead(db: any, id: string): Promise<void> {
  if (!db || !id) return;
  try {
    await updateDoc(doc(db, 'userNotifications', id), { read: true, readAt: new Date().toISOString() });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to mark notification read:', e);
  }
}
