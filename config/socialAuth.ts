import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
} from 'firebase/auth';
import { Platform } from 'react-native';
import { auth } from './firebase';

// Configure WebBrowser for auth
WebBrowser.maybeCompleteAuthSession();

// Google OAuth configuration
// Prefer platform-specific client IDs with full fallback chain
export const getGoogleClientId = (): string | undefined => {
  if (Platform.OS === 'ios') {
    return (
      process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
    );
  }
  if (Platform.OS === 'android') {
    return (
      process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
    );
  }
  return (
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID
  );
};

export const getFacebookAppId = (): string | undefined => {
  return process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
};

export const signInWithGoogle = async (): Promise<{ success: boolean; error?: string }> => {
  try {
    console.log('Starting Google sign-in...');
    
    if (Platform.OS === 'web') {
      // Web platform - use Firebase popup
      console.log('Using Firebase popup for web');
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      return { success: true };
    } else {
      // Use PKCE flow for mobile
      const clientId = getGoogleClientId();
      if (!clientId) {
        throw new Error('Google Client ID not configured for mobile (check EXPO_PUBLIC_GOOGLE_CLIENT_ID in .env)');
      }
      const redirectUri = AuthSession.makeRedirectUri({
        scheme: 'trashtrack',
        path: 'auth/callback'
      });

      // Use the correct endpoint and parameters
      const request = new AuthSession.AuthRequest({
        clientId,
        scopes: ['openid', 'profile', 'email'],
        redirectUri,
        responseType: AuthSession.ResponseType.Code,
        usePKCE: true,
        codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
      });

      const result = await request.promptAsync({
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      });

      if (result.type === 'success' && result.params.code) {
        const tokenResponse = await AuthSession.exchangeCodeAsync(
          {
            clientId,
            code: result.params.code,
            redirectUri,
            extraParams: {
              code_verifier: request.codeVerifier || '', // Ensure codeVerifier is set
            },
          },
          {
            tokenEndpoint: 'https://oauth2.googleapis.com/token',
          }
        );

        const credential = GoogleAuthProvider.credential(tokenResponse.idToken || tokenResponse.accessToken);
        await signInWithCredential(auth, credential);
        
        console.log('Google sign-in successful on mobile');
        return { success: true };
      } else {
        throw new Error('Google authentication was cancelled or failed');
      }
    }
  } catch (error: any) {
    console.error('Google sign-in error:', error);
    
    if (error.code === 'auth/popup-closed-by-user') {
      return { success: false, error: 'Sign-in was cancelled' };
    } else if (error.code === 'auth/popup-blocked') {
      return { success: false, error: 'Pop-up was blocked. Please allow pop-ups and try again.' };
    } else if (error.code === 'auth/network-request-failed') {
      return { success: false, error: 'Network error. Please check your connection and try again.' };
    } else {
      return { success: false, error: error.message || 'Google sign-in failed' };
    }
  }
};

export const signInWithFacebook = async (): Promise<{ success: boolean; error?: string }> => {
  try {
    console.log('Starting Facebook sign-in...');
    
    if (Platform.OS === 'web') {
      // Web platform - use Firebase popup
      console.log('Using Firebase popup for web');
      const provider = new FacebookAuthProvider();
      await signInWithPopup(auth, provider);
      return { success: true };
    } else {
      // Mobile platform - Use implicit flow for an access token, then sign in with Firebase
      const facebookAppId = getFacebookAppId();
      if (!facebookAppId) {
        throw new Error('Facebook App ID not configured for mobile (check EXPO_PUBLIC_FACEBOOK_APP_ID in .env)');
      }

      // Mirror Google logic to avoid exp:// redirects and ensure exact Expo proxy URL
      const isExpoGo = Constants.appOwnership === 'expo';
      const expoOwner = (Constants as any)?.expoConfig?.owner || (Constants as any)?.easConfig?.owner;
      const expoSlug = (Constants as any)?.expoConfig?.slug || 'trashtrack';
      if (isExpoGo && (!expoOwner || !expoSlug)) {
        throw new Error('Expo project owner is required for Facebook sign-in in Expo Go. Use a development build or configure expo.owner.');
      }
      const proxyBase = `https://auth.expo.dev/@${expoOwner}/${expoSlug}`;

      const redirectUri = isExpoGo
        ? proxyBase
        : (AuthSession.makeRedirectUri as any)({ scheme: 'trashtrack', path: 'auth/callback' });
      console.log('Redirect URI:', redirectUri);

      const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${encodeURIComponent(
        facebookAppId
      )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(
        'public_profile,email'
      )}`;
      console.log('Facebook auth URL:', authUrl);

      const wbResult = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (wbResult.type === 'success' && wbResult.url) {
        const fragment = wbResult.url.split('#')[1] || '';
        const params = new URLSearchParams(fragment);
        const accessToken = params.get('access_token');

        if (!accessToken) {
          throw new Error('No access token returned from Facebook');
        }

        const credential = FacebookAuthProvider.credential(accessToken);
        await signInWithCredential(auth, credential);

        console.log('Facebook sign-in successful on mobile');
        return { success: true };
      }
      if (wbResult.type === 'cancel' || wbResult.type === 'dismiss') {
        throw new Error('Facebook authentication was cancelled');
      }
      throw new Error('Facebook authentication failed');
    }
  } catch (error: any) {
    console.error('Facebook sign-in error:', error);
    
    if (error.code === 'auth/popup-closed-by-user') {
      return { success: false, error: 'Sign-in was cancelled' };
    } else if (error.code === 'auth/popup-blocked') {
      return { success: false, error: 'Pop-up was blocked. Please allow pop-ups and try again.' };
    } else if (error.code === 'auth/network-request-failed') {
      return { success: false, error: 'Network error. Please check your connection and try again.' };
    } else {
      return { success: false, error: error.message || 'Facebook sign-in failed' };
    }
  }
};

// Sign out
export const signOut = async () => {
  try {
    await auth.signOut();
  } catch (error) {
    console.error('Sign-Out Error:', error);
  }
};

// Check if user is signed in
export const isSignedIn = () => {
  return !!auth.currentUser;
};

// Get current user
export const getCurrentUser = () => {
  return auth.currentUser;
};

// Check if user is signed in with specific provider
export const isSignedInWithProvider = (providerId: string) => {
  const user = auth.currentUser;
  return user?.providerData.some((provider: any) => provider.providerId === providerId) || false;
};

// Check if user is signed in with Google
export const isSignedInWithGoogle = () => {
  return isSignedInWithProvider('google.com');
};

// Check if user is signed in with Facebook
export const isSignedInWithFacebook = () => {
  return isSignedInWithProvider('facebook.com');
};

// Get current Google user
export const getCurrentGoogleUser = () => {
  const user = auth.currentUser;
  if (user?.providerData.some((provider: any) => provider.providerId === 'google.com')) {
    return user;
  }
  return null;
};

// Get current Facebook user
export const getCurrentFacebookUser = () => {
  const user = auth.currentUser;
  if (user?.providerData.some((provider: any) => provider.providerId === 'facebook.com')) {
    return user;
  }
  return null;
};
