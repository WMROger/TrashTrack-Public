# TrashTrack System Acceptance Checklist

Last updated: 2026-08-13

## Automated acceptance evidence

- [x] Expo lint passes with no reported errors.
- [x] Strict TypeScript compilation passes.
- [x] Function and reward unit tests pass: 10 passed, 1 intentionally skipped emulator wrapper, 0 failed.
- [x] Firestore authorization tests pass in the local emulator.
- [x] Tested Firestore rules compile and are deployed to `trashtruck-swu-98ce9`.
- [x] Expo public configuration resolves successfully for Android, iOS, and web.
- [x] A clean static web export completes successfully.
- [x] Firebase Hosting points to the Expo web export and enables clean route URLs for admin and CICTO links.
- [x] Google, Facebook, and Cloudinary client-secret values are absent from the generated web bundle.

## Defense-day end-to-end test

Run this sequence using separate resident, CENRO, driver, and CICTO accounts. Record a screenshot or short screen capture for each completed section.

### Resident

- [ ] Register with a Danao City barangay and verify the email address.
- [ ] Sign in, request a password-reset email, and confirm the remembered-login option stores only the email.
- [ ] Submit a waste report with a real photo, GPS location, waste type, and description.
- [ ] Confirm the new report appears in My Reports and the CENRO report queue.
- [ ] Open schedules, announcements, notifications, feedback, and the rewards page.
- [ ] After CENRO verification, confirm the one-time token award appears and is not duplicated.

### CENRO administrator

- [ ] Sign in with a verified CENRO account and confirm non-CENRO accounts are rejected.
- [ ] Review the resident report, assign a suitable truck and driver, and dispatch it.
- [ ] Confirm capacity warnings defer stops that exceed the assigned truck capacity.
- [ ] Open the live map, heat map, route view, fleet replay, analytics, expense/budget panel, and CICTO command inbox.
- [ ] Create a driver and an environmental coordinator; verify that the administrator remains signed in and each new user receives an email-verification link.
- [ ] Export service feedback, coordinator records, and override activity.

### Driver

- [ ] Verify the new driver email, sign in through Driver Portal, select the assigned truck, and start a shift.
- [ ] Confirm live dispatch cards open the device mapping application for navigation.
- [ ] Complete the assigned stop with measured waste, photo, GPS, and issue status as applicable.
- [ ] Confirm weights display in kilograms below 1,000 kg and metric tons at or above 1,000 kg.
- [ ] End the shift and confirm the trip appears in driver history and CENRO/CICTO fleet replay.

### CICTO

- [ ] Sign in with a verified CICTO account and confirm routing to the CICTO portal.
- [ ] Review data inventory, identity/access, fleet operations, rewards, and the overview dashboard.
- [ ] Send a CENRO command and confirm it appears in the CENRO inbox.
- [ ] Reconcile eligible historical reward awards, issue one valid catalog redemption, and confirm the ledger balance updates once.
- [ ] Confirm residents cannot edit reward values, staff roles, reservations, or CICTO commands directly.

## External validation still required

- [ ] Test GPS accuracy, foreground tracking, battery usage, notifications, camera, gallery, and mapping on at least one real Android phone under normal and weak connectivity.
- [ ] Restrict public Google/Gemini/Maps keys by application, domain, API, and quota in their provider consoles.
- [ ] Remove and rotate the unused Google, Facebook, and Cloudinary secret values still present in the local `.env` file.
- [ ] Enter at least three approved CENRO expense periods before presenting budget output as backtested.
- [ ] Reconcile the historical workbook with CENRO and append new monthly actuals before promoting the TensorFlow candidate.
- [ ] Run a short user-acceptance session with one representative from each role and keep signed results as defense evidence.

## Acceptance decision

The software-controlled build is defense-ready when every automated item remains green. The system is operationally accepted only after the role-based end-to-end and device checks above are completed with real accounts and hardware.
