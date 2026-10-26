import { db } from '@/config/firebase';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { Platform } from 'react-native';

const isExpoGo = Constants.appOwnership === 'expo' || (Constants as any).executionEnvironment === 'storeClient';
let NotificationsModule: any = null;
if (!isExpoGo) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    NotificationsModule = require('expo-notifications');
  } catch {}
}

export async function registerDeviceForFcm(userId: string): Promise<{ registered: boolean; reason?: string }> {
  if (!userId || Platform.OS !== 'android') return { registered: false, reason: 'android-only' };
  if (isExpoGo || !NotificationsModule) {
    return { registered: false, reason: 'expo-go-not-supported' };
  }
  try {
    const settings = await getDoc(doc(db, 'user_settings', userId));
    if (settings.data()?.notificationPreferences?.pushEnabled === false) return { registered: false, reason: 'disabled-by-user' };

    await NotificationsModule.setNotificationChannelAsync('trashtrack-alerts', {
      name: 'TrashTrack Alerts',
      importance: NotificationsModule.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250],
    });
    let permission = await NotificationsModule.getPermissionsAsync();
    if (permission.status !== 'granted') permission = await NotificationsModule.requestPermissionsAsync();
    if (permission.status !== 'granted') return { registered: false, reason: 'permission-denied' };

    const nativeToken = await NotificationsModule.getDevicePushTokenAsync();
    const token = typeof nativeToken.data === 'string' ? nativeToken.data : JSON.stringify(nativeToken.data);
    if (!token) return { registered: false, reason: 'missing-token' };
    const deviceId = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token);

    // Disable any older or stale device documents for this user
    try {
      const existingDevices = await getDocs(collection(db, 'users', userId, 'devices'));
      const batch = writeBatch(db);
      let hasStale = false;
      existingDevices.docs.forEach((d) => {
        if (d.id !== deviceId && d.data().enabled !== false) {
          batch.set(d.ref, { enabled: false, updatedAt: serverTimestamp() }, { merge: true });
          hasStale = true;
        }
      });
      if (hasStale) await batch.commit();
    } catch {}

    await setDoc(doc(db, 'users', userId, 'devices', deviceId), {
      token,
      tokenType: 'fcm',
      platform: 'android',
      enabled: true,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return { registered: true };
  } catch (err: any) {
    return { registered: false, reason: err?.message || 'registration-failed' };
  }
}

export async function setFcmPushEnabled(userId: string, enabled: boolean) {
  if (enabled) return registerDeviceForFcm(userId);
  const devices = await getDocs(collection(db, 'users', userId, 'devices'));
  const batch = writeBatch(db);
  devices.docs.forEach(device => batch.set(device.ref, { enabled: false, updatedAt: serverTimestamp() }, { merge: true }));
  await batch.commit();
  return { registered: false, reason: 'disabled-by-user' };
}
