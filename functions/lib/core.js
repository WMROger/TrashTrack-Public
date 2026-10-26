'use strict';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPLOYEE_ID_PATTERN = /^[A-Z0-9-]{4,32}$/i;
const LICENSE_PATTERN = /^[A-Z0-9-]{4,40}$/i;
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_BASE64_IMAGE_LENGTH = 8 * 1024 * 1024; // ~6MB binary ceiling

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function sanitizeString(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<\s*\/?\s*script\b[^>]*>/gi, '')
    .trim()
    .slice(0, maxLength);
}

function validateProvisionInput(data) {
  const mode = data?.mode === 'upgrade' ? 'upgrade' : 'create';
  const email = normalizeEmail(data?.email);
  const password = String(data?.password || '');
  const fullName = sanitizeString(data?.fullName, 100);
  const employeeId = String(data?.employeeId || '').trim().toUpperCase();
  const licenseNumber = String(data?.licenseNumber || '').trim().toUpperCase();
  const existingUserId = sanitizeString(data?.existingUserId, 128);
  const truckId = sanitizeString(data?.truckId, 128) || null;
  const assignedBarangay = sanitizeString(data?.assignedBarangay, 80);

  if (!EMPLOYEE_ID_PATTERN.test(employeeId)) throw new Error('A valid employee ID is required.');
  if (!LICENSE_PATTERN.test(licenseNumber)) throw new Error('A valid license number is required.');
  if (mode === 'create') {
    if (!EMAIL_PATTERN.test(email)) throw new Error('A valid email address is required.');
    if (password.length < 8 || password.length > 24) throw new Error('Password must contain 8 to 24 characters.');
    if (fullName.length < 2 || fullName.length > 100) throw new Error('A valid full name is required.');
  } else if (!existingUserId) {
    throw new Error('An existing resident account is required for upgrade.');
  }

  return {
    mode,
    email,
    password,
    fullName,
    employeeId,
    licenseNumber,
    existingUserId,
    truckId,
    assignedBarangay,
    contactInfo: sanitizeString(data?.contactInfo, 100),
  };
}

function validateWasteAnalysisInput(data) {
  const base64 = String(data?.base64 || '').trim();
  const mimeType = String(data?.mimeType || 'image/jpeg').trim().toLowerCase();
  if (!base64 || base64.length < 64) {
    throw new Error('A valid image payload is required for waste analysis.');
  }
  if (base64.length > MAX_BASE64_IMAGE_LENGTH) {
    throw new Error('Image payload exceeds the maximum allowed size (6 MB).');
  }
  if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
    throw new Error('Unsupported image format. Use JPEG, PNG, or WebP.');
  }
  return { base64, mimeType };
}

function validateSupportTicketInput(data) {
  const name = sanitizeString(data?.name, 100);
  const email = normalizeEmail(data?.email);
  const category = sanitizeString(data?.category || 'general', 50);
  const subject = sanitizeString(data?.subject, 150);
  const message = sanitizeString(data?.message, 2000);
  const barangay = sanitizeString(data?.barangay, 80);

  if (name.length < 2) throw new Error('Please provide your name (at least 2 characters).');
  if (!EMAIL_PATTERN.test(email)) throw new Error('Please provide a valid contact email address.');
  if (subject.length < 4) throw new Error('Please enter a brief subject (at least 4 characters).');
  if (message.length < 10) throw new Error('Please describe your concern (at least 10 characters).');

  return { name, email, category, subject, message, barangay };
}

function sanitizePublicError(error, fallbackMessage = 'An unexpected server error occurred. Please try again.') {
  if (!error) return fallbackMessage;
  const rawMessage = typeof error === 'string' ? error : String(error.message || '');
  // Never leak stack traces, file paths, SQL/Firestore paths, or internal keys
  if (
    rawMessage.includes('\n    at ') ||
    rawMessage.includes('node_modules') ||
    rawMessage.includes('E:\\') ||
    rawMessage.includes('/workspace/') ||
    rawMessage.includes('AIzaSy') ||
    rawMessage.includes('PERMISSION_DENIED:')
  ) {
    return fallbackMessage;
  }
  return sanitizeString(rawMessage, 240) || fallbackMessage;
}

function coordinateOf(value) {
  const latitude = value?.lat ?? value?.latitude ?? value?.location?.lat ?? value?.location?.latitude;
  const longitude = value?.lng ?? value?.longitude ?? value?.location?.lng ?? value?.location?.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const latNum = Number(latitude);
  const lngNum = Number(longitude);
  if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) return null;
  return { latitude: latNum, longitude: lngNum };
}

function haversineMeters(left, right) {
  const a = coordinateOf(left);
  const b = coordinateOf(right);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function manilaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function manilaDateKey(date = new Date()) {
  const p = manilaDateParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function isScheduleForToday(dateText, now = new Date()) {
  if (!dateText) return false;
  if (String(dateText).trim().toLowerCase() === 'today') return true;
  const parsed = new Date(String(dateText));
  if (Number.isNaN(parsed.getTime())) return false;
  const today = manilaDateParts(now);
  return parsed.getFullYear() === today.year && parsed.getMonth() + 1 === today.month && parsed.getDate() === today.day;
}

function notificationPreferenceAllows(preferences, type) {
  if (preferences?.pushEnabled === false) return false;
  if (type === 'announcement') return preferences?.announcements !== false;
  if (type === 'report_update') return preferences?.reportUpdates !== false;
  if (type === 'pickup_reminder' || type === 'route') return preferences?.pickupReminders !== false;
  if (type === 'truck_proximity' || type === 'truck_incoming') return preferences?.proximityAlerts !== false;
  return true;
}

function clampRadius(value, fallback = 500) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(2000, Math.max(100, parsed)) : fallback;
}

module.exports = {
  normalizeEmail,
  sanitizeString,
  validateProvisionInput,
  validateWasteAnalysisInput,
  validateSupportTicketInput,
  sanitizePublicError,
  coordinateOf,
  haversineMeters,
  manilaDateKey,
  isScheduleForToday,
  clampRadius,
  notificationPreferenceAllows,
};
