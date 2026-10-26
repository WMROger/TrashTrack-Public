/**
 * Error Sanitizer Utility (#8)
 * Ensures internal stack traces, file paths, tokens, and database internals
 * are never exposed in user-facing UI alerts or error messages.
 */

const FRIENDLY_FIREBASE_ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'Invalid email or password. Please check your credentials and try again.',
  'auth/user-not-found': 'No account was found with that email address.',
  'auth/wrong-password': 'Incorrect password. Please try again or reset your password.',
  'auth/email-already-in-use': 'An account with this email address is already registered.',
  'auth/weak-password': 'Password is too weak. Please use at least 8 characters with letters and numbers.',
  'auth/too-many-requests': 'Too many attempts detected. Please wait a few minutes before trying again.',
  'auth/network-request-failed': 'Network connection error. Please check your internet connection.',
  'auth/requires-recent-login': 'For your security, please sign in again before performing this action.',
  'permission-denied': 'You do not have permission to perform this action.',
  'resource-exhausted': 'Rate limit reached. Please wait a moment before trying again.',
  'unavailable': 'The service is temporarily unavailable. Please try again in a moment.',
  'deadline-exceeded': 'The request took too long to respond. Please check your connection and retry.',
};

export function sanitizeUserError(
  error: unknown,
  fallbackMessage: string = 'Something went wrong. Please try again.'
): string {
  if (!error) return fallbackMessage;

  const code = (error as any)?.code ? String((error as any).code).replace(/^functions\//, '') : '';
  if (code && FRIENDLY_FIREBASE_ERRORS[code]) {
    return FRIENDLY_FIREBASE_ERRORS[code];
  }

  const rawMessage =
    typeof error === 'string'
      ? error
      : typeof (error as any)?.message === 'string'
      ? (error as any).message
      : '';

  if (!rawMessage) return fallbackMessage;

  for (const [errKey, friendly] of Object.entries(FRIENDLY_FIREBASE_ERRORS)) {
    if (rawMessage.includes(errKey)) {
      return friendly;
    }
  }

  // Strip stack traces, file paths, or sensitive internal identifiers
  if (
    rawMessage.includes('\n    at ') ||
    rawMessage.includes('node_modules') ||
    rawMessage.includes('E:\\') ||
    rawMessage.includes('C:\\') ||
    rawMessage.includes('/Users/') ||
    rawMessage.includes('AIzaSy') ||
    rawMessage.includes('FirebaseError:') ||
    rawMessage.includes('ReferenceError:') ||
    rawMessage.includes('TypeError:')
  ) {
    return fallbackMessage;
  }

  return rawMessage.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 220) || fallbackMessage;
}

