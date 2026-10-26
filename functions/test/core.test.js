'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateProvisionInput,
  haversineMeters,
  isScheduleForToday,
  clampRadius,
  notificationPreferenceAllows,
} = require('../lib/core');

test('driver provisioning normalizes validated input', () => {
  const result = validateProvisionInput({
    mode: 'create', email: ' Driver@Example.COM ', password: 'StrongPass!23',
    fullName: 'Maria Driver', employeeId: 'cenro-1024', licenseNumber: 'N01-23-456789',
  });
  assert.equal(result.email, 'driver@example.com');
  assert.equal(result.employeeId, 'CENRO-1024');
});

test('driver provisioning rejects short passwords', () => {
  assert.throws(() => validateProvisionInput({
    mode: 'create', email: 'driver@example.com', password: 'short', fullName: 'Driver',
    employeeId: 'CENRO-1', licenseNumber: 'LICENSE-1',
  }), /8 to 24/);
});

test('driver provisioning rejects unsafe license identifiers', () => {
  assert.throws(() => validateProvisionInput({
    mode: 'create', email: 'driver@example.com', password: 'StrongPass!23', fullName: 'Driver',
    employeeId: 'CENRO-1', licenseNumber: 'N01/INVALID',
  }), /valid license number/);
});

test('haversine distance handles report and truck coordinate shapes', () => {
  const distance = haversineMeters({ lat: 10.5200, lng: 124.0270 }, { location: { latitude: 10.5210, longitude: 124.0270 } });
  assert.ok(distance > 100 && distance < 120);
});

test('schedule date comparison uses Asia/Manila calendar date', () => {
  const now = new Date('2026-08-10T16:30:00.000Z'); // 2026-08-11 in Manila
  assert.equal(isScheduleForToday('August 11, 2026', now), true);
  assert.equal(isScheduleForToday('August 10, 2026', now), false);
  assert.equal(isScheduleForToday('Today', now), true);
});

test('proximity radius is bounded', () => {
  assert.equal(clampRadius(10), 100);
  assert.equal(clampRadius(5000), 2000);
  assert.equal(clampRadius('invalid'), 500);
});

test('notification preferences apply per notification category', () => {
  assert.equal(notificationPreferenceAllows({ pushEnabled: false }, 'route'), false);
  assert.equal(notificationPreferenceAllows({ pushEnabled: true, proximityAlerts: false }, 'truck_proximity'), false);
  assert.equal(notificationPreferenceAllows({ pushEnabled: true, proximityAlerts: false }, 'truck_incoming'), false);
  assert.equal(notificationPreferenceAllows({ pushEnabled: true, proximityAlerts: true }, 'truck_incoming'), true);
  assert.equal(notificationPreferenceAllows({ pushEnabled: true, reportUpdates: true }, 'report_update'), true);
});
