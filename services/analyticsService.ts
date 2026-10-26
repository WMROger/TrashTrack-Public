/**
 * Funnel & Drop-Off Analytics Service (#16)
 * Tracks user conversion funnels across Onboarding, Waste Reporting,
 * Reward Redemption, and Driver Route Completion so administrators can
 * identify exactly where users drop off.
 */
import { Platform } from 'react-native';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';

export type FunnelEventName =
  | 'signup_started'
  | 'signup_completed'
  | 'signup_failed'
  | 'login_completed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'report_started'
  | 'report_photo_captured'
  | 'report_ai_analyzed'
  | 'report_submitted'
  | 'report_abandoned'
  | 'reward_viewed'
  | 'reward_redeemed'
  | 'driver_shift_started'
  | 'driver_route_completed'
  | 'support_ticket_submitted';

export async function trackFunnelEvent(
  eventName: FunnelEventName,
  metadata: Record<string, string | number | boolean | null | undefined> = {}
): Promise<void> {
  try {
    if (!db) return;

    const cleanMeta: Record<string, string | number | boolean | null> = {};
    for (const [key, val] of Object.entries(metadata)) {
      if (val === undefined) continue;
      if (typeof val === 'string') {
        cleanMeta[key] = val.slice(0, 120);
      } else if (typeof val === 'number' || typeof val === 'boolean' || val === null) {
        cleanMeta[key] = val;
      }
    }

    await addDoc(collection(db, 'analytics_events'), {
      eventName,
      userId: auth?.currentUser?.uid || null,
      platform: Platform.OS,
      metadata: cleanMeta,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking telemetry
  }
}

