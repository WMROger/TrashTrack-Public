import { Platform } from 'react-native';
import * as ExpoImagePicker from 'expo-image-picker';
import jsQR from 'jsqr';

let nativeScanFromURLAsync: ((url: string, barcodeTypes?: any[]) => Promise<any[]>) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ExpoCamera = require('expo-camera');
  if (typeof ExpoCamera?.scanFromURLAsync === 'function') {
    nativeScanFromURLAsync = ExpoCamera.scanFromURLAsync;
  }
} catch (e) {
  console.warn('[qrImageScannerService] expo-camera scanFromURLAsync unavailable:', e);
}

/**
 * Decodes a QR code from an image URI on the web using an off-screen HTML canvas and jsQR.
 */
export function decodeQrFromImageUriWeb(uri: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (typeof Image === 'undefined') {
        resolve(null);
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          resolve(code?.data || null);
        } catch (e) {
          console.warn('[qrImageScannerService] web canvas decode error:', e);
          resolve(null);
        }
      };
      img.onerror = (err) => {
        console.warn('[qrImageScannerService] web image load error:', err);
        resolve(null);
      };
      img.src = uri;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Decodes a QR code from a Web File object (e.g. from an <input type="file">).
 */
export function scanQrFromWebFile(file: File): Promise<{ success: boolean; data?: string; error?: string }> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve({
        success: false,
        error: 'Please select a valid image file (JPG, PNG, WebP).',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUri = e.target?.result as string;
      if (!dataUri) {
        resolve({ success: false, error: 'Failed to read image file data.' });
        return;
      }
      const decoded = await decodeQrFromImageUriWeb(dataUri);
      if (decoded) {
        resolve({ success: true, data: decoded });
      } else {
        resolve({
          success: false,
          error: 'No QR code detected in the uploaded image. Please ensure the QR code is clearly visible and well-lit.',
        });
      }
    };
    reader.onerror = () => {
      resolve({ success: false, error: 'Could not read file from disk.' });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Launches the device photo library and scans for a QR code in the selected image.
 * Works seamlessly on iOS, Android, and Web.
 */
export async function pickAndScanQrImage(): Promise<{
  canceled?: boolean;
  success: boolean;
  data?: string;
  error?: string;
}> {
  try {
    const permission = await ExpoImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      return {
        success: false,
        error: 'Photo gallery permission is required to upload a QR code image.',
      };
    }

    const result = await ExpoImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: false,
      selectionLimit: 1,
      quality: 1,
      legacy: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return { canceled: true, success: false };
    }

    const asset = result.assets[0];
    const assetUri = asset.uri;

    // Web handling
    if (Platform.OS === 'web') {
      const decoded = await decodeQrFromImageUriWeb(assetUri);
      if (decoded) {
        return { success: true, data: decoded };
      }
      return {
        success: false,
        error: 'No QR code detected in the selected image. Please make sure the QR image is clear, sharp, and well-lit.',
      };
    }

    // Native handling (iOS / Android)
    if (nativeScanFromURLAsync) {
      try {
        let scanResults = await nativeScanFromURLAsync(assetUri, ['qr']);
        if ((!scanResults || scanResults.length === 0) && nativeScanFromURLAsync) {
          // Fallback with all barcode types in case platform labels it differently
          scanResults = await nativeScanFromURLAsync(assetUri);
        }
        if (scanResults && scanResults.length > 0 && scanResults[0]?.data) {
          return { success: true, data: scanResults[0].data };
        }
      } catch (nativeErr) {
        console.warn('[qrImageScannerService] native scan error:', nativeErr);
      }
    }

    return {
      success: false,
      error: 'No QR code detected in the selected image. Please make sure the QR code is clearly visible and not cropped.',
    };
  } catch (err: any) {
    console.error('[qrImageScannerService] pickAndScanQrImage failed:', err);
    return {
      success: false,
      error: err?.message || 'Failed to select and scan image.',
    };
  }
}

