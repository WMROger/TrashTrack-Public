/**
 * Error Tracking Service (#9)
 * Captures client crashes, ErrorBoundary exceptions, and unhandled rejections,
 * sanitizes stack traces/PII, and writes structured incident logs to Firestore
 * (`system_error_logs`) for real-time CICTO Oversight visibility.
 */
import { Platform } from 'react-native';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { sanitizeUserError } from '@/utils/errorSanitizer';

export interface ErrorReport {
  referenceId: string;
  severity: 'fatal' | 'error' | 'warning';
  message: string;
  context?: string;
  route?: string;
  platform: string;
  userId?: string | null;
}

const recentErrorCache = new Map<string, number>();
const DEDUPE_WINDOW_MS = 30_000;

export function generateErrorReferenceId(): string {
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ERR-${Date.now().toString(36).slice(-4).toUpperCase()}-${rand}`;
}

function scrubStackForAdmin(stack?: string): string {
  if (!stack || typeof stack !== 'string') return '';
  return stack
    .replace(/AIzaSy[A-Za-z0-9_-]+/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .slice(0, 1200);
}

export async function reportSystemError(
  error: unknown,
  options: {
    severity?: 'fatal' | 'error' | 'warning';
    context?: string;
    route?: string;
  } = {}
): Promise<string> {
  const referenceId = generateErrorReferenceId();
  const safeMessage = sanitizeUserError(error, 'Unexpected application error');
  const rawMessage = typeof (error as any)?.message === 'string' ? (error as any).message.slice(0, 300) : safeMessage;
  const dedupeKey = `${options.context || 'app'}:${rawMessage}`;

  const now = Date.now();
  const lastReported = recentErrorCache.get(dedupeKey) || 0;
  if (now - lastReported < DEDUPE_WINDOW_MS) {
    return referenceId;
  }
  recentErrorCache.set(dedupeKey, now);

  try {
    if (db) {
      await addDoc(collection(db, 'system_error_logs'), {
        referenceId,
        severity: options.severity || 'error',
        publicMessage: safeMessage,
        diagnosticSummary: rawMessage.replace(/AIzaSy[A-Za-z0-9_-]+/g, '[REDACTED]'),
        adminTrace: scrubStackForAdmin((error as any)?.stack),
        context: options.context || 'runtime',
        route: options.route || 'unknown',
        platform: Platform.OS,
        userId: auth?.currentUser?.uid || null,
        userRole: null,
        resolved: false,
        createdAt: serverTimestamp(),
      });
    }
  } catch {
    // Fail silently so error reporting never causes secondary crashes
  }

  return referenceId;
}

let globalHandlersInstalled = false;

export function initGlobalErrorTracking(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  try {
    const globalAny = globalThis as any;
    const errorUtils = globalAny?.ErrorUtils;
    if (errorUtils && typeof errorUtils.getGlobalHandler === 'function') {
      const defaultHandler = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
        reportSystemError(error, {
          severity: isFatal ? 'fatal' : 'error',
          context: isFatal ? 'unhandled_fatal_js_exception' : 'unhandled_js_exception',
        });
        if (typeof defaultHandler === 'function') {
          defaultHandler(error, isFatal);
        }
      });
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', (event) => {
        reportSystemError(event.reason, {
          severity: 'error',
          context: 'unhandled_promise_rejection',
          route: window.location?.pathname || '/',
        });
      });
    }
  } catch {
    // Ignore environment differences
  }
}

