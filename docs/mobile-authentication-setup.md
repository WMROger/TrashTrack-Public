# Mobile Authentication Setup for iOS

## Overview
This app now supports proper Google and Facebook authentication on iOS using Expo's AuthSession API instead of Firebase Web SDK.

## Required Environment Variables

Add these to your `.env` file:

```bash
# Google OAuth (Required for mobile Google sign-in)
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your_ios_google_client_id
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=your_android_google_client_id
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your_web_google_client_id

# Facebook OAuth (Required for mobile Facebook sign-in)
EXPO_PUBLIC_FACEBOOK_APP_ID=your_facebook_app_id
```

## Google OAuth Setup

### 1. Google Cloud Console
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Go to "APIs & Services" > "Credentials"
4. Create a new "OAuth 2.0 Client ID"
5. Create the matching iOS, Android, and Web OAuth client types
6. Add these Authorized redirect URIs:
   - `https://auth.expo.io/@your-expo-username/trashtrack`
   - `trashtrack://auth/callback`
7. Copy the client IDs. Do not place an OAuth client secret in an Expo application.

### 2. Update Environment Variables
```bash
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=123456789-ios.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=123456789-android.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=123456789-web.apps.googleusercontent.com
```

## Facebook OAuth Setup

### 1. Facebook Developers
1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Create a new app or select existing
3. Add Facebook Login product
4. Go to Settings > Basic
5. Copy the App ID
6. Add these Valid OAuth Redirect URIs:
   - `https://auth.expo.io/@your-expo-username/trashtrack`
   - `trashtrack://auth/callback`

### 2. Update Environment Variables
```bash
EXPO_PUBLIC_FACEBOOK_APP_ID=123456789012345
```

## How It Works

### Web Platform
- Uses Firebase Web SDK with popup authentication
- No additional setup required

### Mobile Platform (iOS/Android)
- Uses Expo AuthSession API
- Opens native browser for authentication
- Exchanges the authorization code using PKCE; no client secret is embedded
- Signs in to Firebase using the token

## Testing

1. **Web**: Should work immediately with Firebase config
2. **Mobile**: Requires OAuth credentials in environment variables
3. **iOS Simulator**: May have limitations, test on real device

## Troubleshooting

### Common Issues:
1. **"Google Client ID not configured"**: Add `EXPO_PUBLIC_GOOGLE_CLIENT_ID` to `.env`
2. **"Facebook App ID not configured"**: Add `EXPO_PUBLIC_FACEBOOK_APP_ID` to `.env`
3. **Redirect URI mismatch**: Ensure redirect URIs match exactly in OAuth console
4. **Scheme mismatch**: Verify `scheme: 'trashtrack'` in `app.json` matches your setup

### Debug Steps:
1. Check console logs for authentication flow
2. Verify environment variables are loaded
3. Test on real device (not simulator)
4. Check OAuth console redirect URI settings
