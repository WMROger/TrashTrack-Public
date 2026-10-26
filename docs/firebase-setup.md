# Firebase Authentication Setup Guide

This guide will help you set up Firebase Authentication for your TrashTruck app.

## Prerequisites

1. A Firebase project (create one at [Firebase Console](https://console.firebase.google.com/))
2. Node.js and npm installed
3. Expo CLI installed

## Step 1: Get Firebase Configuration

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project (or create a new one)
3. Click on the gear icon (⚙️) next to "Project Overview" to open Project Settings
4. In the "General" tab, scroll down to "Your apps"
5. Click "Add app" and select the appropriate platform (Web for Expo)
6. Copy the configuration object

## Step 2: Create Environment File

1. In your project root, create a `.env` file
2. Add the following variables with your Firebase values:

```bash
EXPO_PUBLIC_FIREBASE_API_KEY=your-api-key-here
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
EXPO_PUBLIC_FIREBASE_APP_ID=your-app-id
```

## Step 3: Enable Authentication Methods

1. In Firebase Console, go to "Authentication" > "Sign-in method"
2. Enable the following providers:
   - **Email/Password**: Enable and configure
   - **Google**: Enable and configure (requires Google Cloud project setup)
   - **Facebook**: Enable and configure (requires Facebook app setup)

### Email/Password Setup
- Click on "Email/Password"
- Enable "Email/Password" and "Email link (passwordless sign-in)"
- Click "Save"

### Google Sign-in Setup
- Click on "Google"
- Enable Google sign-in
- Add your authorized domain
- Click "Save"

### Facebook Sign-in Setup
- Click on "Facebook"
- Enable Facebook sign-in
- Add your Facebook App ID and App Secret
- Click "Save"

## Step 4: Test the Setup

1. Run the setup script: `npm run setup-env`
2. Start your app: `npm start`
3. Try to create an account or sign in
4. Check the console for any authentication errors

## Troubleshooting

### Common Issues

1. **"Firebase not available" error**
   - Check that your `.env` file exists and has correct values
   - Ensure all Firebase packages are installed: `npm install firebase`

2. **Authentication errors**
   - Verify the authentication method is enabled in Firebase Console
   - Check that your app domain is authorized for OAuth providers

3. **Environment variables not loading**
   - Restart your Expo development server after creating `.env`
   - Ensure variable names start with `EXPO_PUBLIC_`

### Security Rules

For production, consider setting up Firestore security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Next Steps

After setting up authentication:

1. Implement user profile management
2. Add role-based access control
3. Set up user data storage in Firestore
4. Configure push notifications
5. Add email verification

## Support

If you encounter issues:
1. Check Firebase Console for error logs
2. Verify your configuration values
3. Check Expo documentation for environment variable setup
4. Review Firebase Authentication documentation
