# 🚨 TrashTrack Danao City — Launch Day Rollback & Incident Recovery Plan

This document provides the official step-by-step rollback procedures for **TrashTrack Danao City** in the event of a launch day regression, critical bug, or infrastructure incident.

---

## 1. Immediate 10-Second Mitigation: CICTO Emergency Maintenance Mode
If a live issue is affecting citizen waste reports, AI scanning, or fleet dispatch, **you do not need to redeploy code** to stop impact immediately:
1. Sign in to the **CICTO Oversight Dashboard** (`/cicto/dashboard`) -> **System Settings Tab**.
2. Toggle **Emergency Maintenance Mode** ON, or disable the **AI Vision Quota Switch** (`app_config/ai_quota.enabled = false`).
   - Disabling AI Vision immediately routes all waste photo analysis to the zero-cost, on-device `edgeWasteClassifier.ts` (<30ms latency, zero external API calls).

---

## 2. Database Backup & Restore Procedure (Firestore)

### A. Pre-Launch / Pre-Deploy Snapshot
Run the automated backup and restore-verification script before any production change:
```bash
node scripts/backup-and-test-restore.js
```
This writes a timestamped, SHA-256 checksummed archive to `backups/trashtrack-backup-<timestamp>.json` and verifies 100% restore integrity in an isolated sandbox.

### B. Cloud-Level Firestore Point-in-Time Export / Import
```bash
# Export current production Firestore database to GCS bucket
gcloud firestore export gs://trashtruck-swu-98ce9-backups/pre-launch-$(date +%Y%m%d-%H%M)

# Rollback / Restore from a known-good snapshot
gcloud firestore import gs://trashtruck-swu-98ce9-backups/<snapshot-folder>
```

---

## 3. Rolling Back Firestore Security Rules (`firestore.rules`)
If a security rule update blocks legitimate citizen, driver, or coordinator operations:
```bash
# 1. Revert firestore.rules to the previous git commit
git checkout HEAD~1 -- firestore.rules

# 2. Deploy the reverted rules immediately (takes < 15 seconds)
npx firebase deploy --only firestore:rules
```
*(Or open **Firebase Console → Firestore Database → Rules → Releases** and click **Rollback** on the previous release timestamp.)*

---

## 4. Rolling Back Firebase Cloud Functions (`functions/`)
If a Cloud Function (`provisionDriver`, `authenticateDriverQr`, `analyzeWasteImage`, `submitSupportTicket`) experiences elevated error rates:
```bash
# 1. Checkout the last known-good functions code
git checkout HEAD~1 -- functions/

# 2. Redeploy only Cloud Functions
npx firebase deploy --only functions
```

---

## 5. Rolling Back Web Portal Deployment (CENRO / CICTO / Citizen Web)
```bash
# Instant 1-click rollback via Firebase Hosting channel history:
npx firebase hosting:clone trashtruck-swu-98ce9:live trashtruck-swu-98ce9:live --version <PREVIOUS_VERSION_ID>
```
Or rebuild and deploy the previous tag:
```bash
git checkout <last-stable-tag>
npx expo export --platform web
npx firebase deploy --only hosting
```

---

## 6. Rolling Back Android Mobile App (EAS Update / APK)
```bash
# Republish the previous stable OTA bundle on the production branch
npx eas update:republish --branch production --group <PREVIOUS_UPDATE_GROUP_ID>
```

---

## 7. API Key Rotation Checklist (If a Key Is Ever Compromised)
1. **Google Maps & Firebase Web API Key**:
   - Open **Google Cloud Console → APIs & Services → Credentials**.
   - Click **Regenerate Key** on the compromised key (use the 24-hour grace period while updating `.env`).
   - Restrict the new key by **HTTP Referrers** (for web) and **Android Package (`com.trashtrack.danao`) + SHA-1 fingerprint** (for mobile).
   - Update `EXPO_PUBLIC_FIREBASE_API_KEY` and `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env` (never in `app.json` or git).
2. **Gemini AI Key**:
   - Rotate the key in **Google AI Studio** and set `GEMINI_API_KEY` strictly in `functions/.env` (never in client `.env`).
   - Run `node scripts/audit-keys.js` to confirm zero secrets exist in git-tracked files.

