# 📱 TrashTrack Standalone APK Build & Deployment Guide

This guide explains how to convert your TrashTrack project from **Expo Go** into a **Standalone Android APK** (`.apk`) for your Capstone defense and municipal field testing.

---

## 🛠️ Step 1: Install EAS CLI (One-Time Setup)

Make sure you have an Expo account ([expo.dev](https://expo.dev)) and install the EAS CLI:

```bash
npm install -g eas-cli
eas login
```

---

## 📍 Step 2: Enable Background GPS Tracking (Optional for Driver APK)

When building the standalone APK, you can unlock full 24/7 background location tracking so that drivers can track routes even when their phone screen is locked or in their pocket.

1. **Install `expo-task-manager`**:
   ```bash
   npx expo install expo-task-manager
   ```

2. **In `services/locationService.ts`**:
   Uncomment lines **90–111** and lines **147–163** to activate `BACKGROUND_LOCATION_TASK` and `Location.startLocationUpdatesAsync()`.

3. **In `app.json`**:
   Add the background permissions to `android.permissions`:
   ```json
   "permissions": [
     "CAMERA",
     "ACCESS_FINE_LOCATION",
     "ACCESS_COARSE_LOCATION",
     "ACCESS_BACKGROUND_LOCATION",
     "FOREGROUND_SERVICE",
     "FOREGROUND_SERVICE_LOCATION",
     "WAKE_LOCK"
   ]
   ```
   And set `"locationAlwaysAndWhenInUsePermission": true` in the `expo-location` plugin.

---

## 🔔 Step 3: Enable Firebase Push Notifications (Optional)

1. Open your **Firebase Console** -> Project Settings -> General.
2. Under "Your apps", add an Android app with package name `com.trashtrack.danao`.
3. Download `google-services.json` and place it in the root project folder:
   ```
   TrashTruck/
   ├── google-services.json
   ├── app.json
   ...
   ```
4. In `app.json`, add the reference under `android`:
   ```json
   "android": {
     "package": "com.trashtrack.danao",
     "googleServicesFile": "./google-services.json"
   }
   ```

---

## 🚀 Step 4: Build the Standalone `.apk` File

We have already created [`eas.json`](../eas.json) in your project configured for APK builds.

Run this single command in your terminal:

```bash
eas build --platform android --profile preview
```

### What happens next:
1. EAS will bundle your assets and code in the cloud.
2. When the build finishes (approx. 10–15 minutes), EAS will provide a direct download link and QR code for the `.apk` file.
3. Download and install the APK on any Android phone!

---

## 💡 Tips for Capstone Defense Day
* Install the `.apk` on your test devices 1–2 days before your defense.
* Standalone APKs do **not** require running `npx expo start` on your laptop; they run independently anywhere.
* Keep the CENRO/CICTO web dashboard running on your laptop browser (`npx expo start --web`) to project the live maps on the big screen during your presentation.
