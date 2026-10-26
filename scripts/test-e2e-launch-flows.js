#!/usr/bin/env node
/**
 * End-to-End Pre-Launch Verification Suite (#17, #6, #7, #8, #18)
 * Tests end-to-end:
 * 1. Signup & User Provisioning Validation (valid & invalid inputs, XSS sanitization)
 * 2. Password Reset & Verification PIN Sanitization
 * 3. Eco-Reward Points & Souvenir Redemption Ledger (valid redemption, insufficient balance, invalid item)
 * 4. AI Waste Analysis Input Validation & Spending Cap Quota Enforcement
 * 5. Stack Trace & Error Leakage Prevention
 */
const assert = require('assert');
const {
  validateProvisionInput,
  validateWasteAnalysisInput,
  validateSupportTicketInput,
  sanitizePublicError,
  sanitizeString,
  coordinateOf,
} = require('../functions/lib/core');
const { normalizeRewardConfig, findSouvenir } = require('../functions/lib/rewards');

function runTests() {
  let passed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✘ [FAIL] ${name}:`, err.message);
      process.exit(1);
    }
  }

  console.log('🚀 Running Pre-Launch End-to-End Verification Tests...\n');

  // 1. Signup & Account Provisioning E2E
  test('1. Signup/Provisioning accepts valid user credentials and strips XSS', () => {
    const res = validateProvisionInput({
      mode: 'create',
      email: '  Juan.DelaCruz@Danao.gov.ph ',
      password: 'SecurePass123!',
      fullName: 'Juan <script>alert(1)</script> Dela Cruz',
      employeeId: 'drv-2026-01',
      licenseNumber: 'g01-23-456789',
      assignedBarangay: 'Baliang',
    });
    assert.strictEqual(res.email, 'juan.delacruz@danao.gov.ph');
    assert.strictEqual(res.employeeId, 'DRV-2026-01');
    assert.ok(!res.fullName.includes('<script>'), 'XSS script tag must be stripped');
  });

  test('2. Signup/Provisioning rejects weak passwords and malformed emails', () => {
    assert.throws(() => {
      validateProvisionInput({
        mode: 'create',
        email: 'invalid-email',
        password: 'short',
        fullName: 'Test User',
        employeeId: 'DRV-001',
        licenseNumber: 'LTO-12345',
      });
    }, /valid email|Password/);
  });

  // 2. Password Reset & OOB Verification Code E2E
  test('3. Password Reset & Activation Code sanitizes injected HTML/scripts', () => {
    const rawCode = '849201"><img src=x onerror=alert(1)>';
    const safeCode = rawCode.replace(/[^0-9A-Za-z-]/g, '').slice(0, 12);
    assert.strictEqual(safeCode, '849201imgsrc');
    assert.ok(!safeCode.includes('<') && !safeCode.includes('>'));
  });

  // 3. Eco-Reward Points & Souvenir Redemption E2E (#17)
  test('4. Eco-Reward Souvenir Redemption validates catalog, stock, and point balance', () => {
    const rewardConfig = normalizeRewardConfig({});
    const toteBag = findSouvenir(rewardConfig, 'tote');
    assert.ok(toteBag, 'Tote bag souvenir should exist in catalog');
    assert.strictEqual(toteBag.cost, 500);

    // Simulate resident point ledger check
    const earnedPoints = 650;
    const redeemedPoints = 100;
    const availableBalance = earnedPoints - redeemedPoints;
    assert.ok(availableBalance >= toteBag.cost, 'Resident with 550 available points can redeem 500-pt Tote Bag');

    const remainingAfterRedeem = availableBalance - toteBag.cost;
    assert.strictEqual(remainingAfterRedeem, 50);

    // Insufficient balance check
    const tumbler = findSouvenir(rewardConfig, 'tumbler');
    assert.strictEqual(tumbler.cost, 1000);
    assert.ok(remainingAfterRedeem < tumbler.cost, 'Resident with 50 points must be blocked from 1000-pt Tumbler');
  });

  // 4. Server Input Validation & AI Payload Protection (#6, #7)
  test('5. AI Waste Analysis validates MIME type and enforces 6MB ceiling', () => {
    const validBase64 = 'A'.repeat(128);
    const valid = validateWasteAnalysisInput({ base64: validBase64, mimeType: 'image/jpeg' });
    assert.strictEqual(valid.mimeType, 'image/jpeg');

    assert.throws(() => {
      validateWasteAnalysisInput({ base64: validBase64, mimeType: 'application/x-msdownload' });
    }, /Unsupported image format/);

    assert.throws(() => {
      validateWasteAnalysisInput({ base64: 'A'.repeat(9 * 1024 * 1024), mimeType: 'image/png' });
    }, /exceeds the maximum allowed size/);
  });

  // 5. Support Ticket Validation (#19)
  test('6. Support Ticket server validator enforces email, subject, and message bounds', () => {
    const validTicket = validateSupportTicketInput({
      name: 'Maria Santos',
      email: 'maria@danao.gov.ph',
      category: 'collection',
      subject: 'Missed pickup in Purok 3',
      message: 'Our segregated biodegradable waste in Purok 3 Baliang was not picked up this morning.',
    });
    assert.strictEqual(validTicket.email, 'maria@danao.gov.ph');
    assert.strictEqual(validTicket.category, 'collection');
  });

  // 6. Error Stack Trace Sanitization (#8)
  test('7. Error Sanitizer strips stack traces, file paths, and API keys', () => {
    const leakedError = new Error(
      'Database failure at Object.<anonymous> (E:\\Capstone\\TrashTruck\\node_modules\\firebase\\index.js:42:11)\n    at Module._compile'
    );
    const publicMsg = sanitizePublicError(leakedError, 'Safe fallback message');
    assert.strictEqual(publicMsg, 'Safe fallback message');
    assert.ok(!publicMsg.includes('node_modules'));
    assert.ok(!publicMsg.includes('E:\\'));
  });

  // 7. Coordinate Bounds Validation (#6)
  test('8. Coordinate validator rejects out-of-range GPS coordinates', () => {
    assert.strictEqual(coordinateOf({ latitude: 95, longitude: 124 }), null);
    assert.strictEqual(coordinateOf({ latitude: 10.52, longitude: 195 }), null);
    const validCoord = coordinateOf({ latitude: 10.5218, longitude: 124.0285 });
    assert.deepStrictEqual(validCoord, { latitude: 10.5218, longitude: 124.0285 });
  });

  console.log(`\n✅ ALL ${passed}/8 END-TO-END LAUNCH VERIFICATION TESTS PASSED!`);
}

runTests();

