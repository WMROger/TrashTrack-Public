# Social Login Setup Guide

This guide explains how to set up Google and Facebook authentication for the TrashTrack app.

## Prerequisites

1. Firebase project with Authentication enabled
2. Google Cloud Console project
3. Facebook Developer account and app

## Environment Variables

Add the following environment variables to your `.env` file:

```bash
# Firebase Configuration
EXPO_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
EXPO_PUBLIC_FIREBASE_APP_ID=your-app-id

# Google Sign-In Configuration
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-google-web-client-id
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your-google-ios-client-id

# Facebook App Configuration
EXPO_PUBLIC_FACEBOOK_APP_ID=your-facebook-app-id
EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN=your-facebook-client-token
```

## Google Sign-In Setup

### 1. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Go to "Credentials" and create OAuth 2.0 Client IDs:
   - Web client ID (for web platform)
   - iOS client ID (for iOS platform)
   - Android client ID (for Android platform)

### 2. Firebase Configuration

1. In your Firebase project, go to Authentication > Sign-in method
2. Enable Google as a sign-in provider
3. Add your Google Cloud Console project's OAuth 2.0 client ID

### 3. Android Setup

1. Add your SHA-1 fingerprint to Firebase project settings
2. Download `google-services.json` and place it in the `android/app/` directory

### 4. iOS Setup

1. Add your bundle identifier to Firebase project settings
2. Download `GoogleService-Info.plist` and add it to your iOS project

## Facebook Sign-In Setup

### 1. Facebook Developer Console Setup

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Create a new app or select an existing one
3. Add Facebook Login product to your app
4. Configure OAuth redirect URIs
5. Get your App ID and Client Token

### 2. Firebase Configuration

1. In your Firebase project, go to Authentication > Sign-in method
2. Enable Facebook as a sign-in provider
3. Add your Facebook App ID and App Secret

### 3. Android Setup

1. Add your Facebook App ID to `android/app/src/main/res/values/strings.xml`:
```xml
<string name="facebook_app_id">your-facebook-app-id</string>
```

2. Add Facebook permissions to `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET"/>
```

### 4. iOS Setup

1. Add your Facebook App ID to `ios/YourApp/Info.plist`:
```xml
<key>FacebookAppID</key>
<string>your-facebook-app-id</string>
<key>FacebookClientToken</key>
<string>your-facebook-client-token</string>
<key>FacebookDisplayName</key>
<string>Your App Name</string>
```

## Testing

1. Run the app on a physical device (social login may not work on simulators)
2. Test both Google and Facebook login flows
3. Verify that users are properly authenticated in Firebase

## Troubleshooting

### Common Issues

1. **"Google Play services not available"**: Make sure you're testing on a device with Google Play Services
2. **"Facebook login cancelled"**: Check your Facebook app configuration and permissions
3. **"Invalid client"**: Verify your OAuth client IDs are correct
4. **"Network error"**: Check your internet connection and Firebase configuration

### Debug Tips

1. Check the console logs for detailed error messages
2. Verify all environment variables are set correctly
3. Ensure your Firebase project has the correct authentication providers enabled
4. Test with a fresh app install to clear any cached authentication state

## Security Notes

1. Never commit your actual API keys to version control
2. Use environment variables for all sensitive configuration
3. Regularly rotate your API keys and tokens
4. Monitor your Firebase Authentication logs for suspicious activity
