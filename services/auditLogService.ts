import { auth, db } from '@/config/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

export type AuditEvent =
  | 'pickup.completed'
  | 'pickup.issue_reported'
  | 'route.dispatched'
  | 'offline_action.synced'
  | 'notification.preferences_updated';

export async function writeAuditLog(event: AuditEvent, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  const user = auth.currentUser;
  if (!user || !db) return;
  try {
    const logPayload = {
      type: 'client',
      event,
      targetType,
      targetId,
      actorUid: user.uid,
      actorEmail: user.email || null,
      metadata,
      createdAt: serverTimestamp(),
    };
    await addDoc(collection(db, 'audit_logs'), logPayload);
  } catch (error) {
    // Auditing should be observable but must not discard a completed field operation.
    console.warn('Unable to write audit log:', error);
  }
}
