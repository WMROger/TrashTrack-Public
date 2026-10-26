import { Alert } from 'react-native';
import { UploadResult } from '../services/cloudinaryService';

/**
 * Helper utilities for Cloudinary integration
 * These functions provide better error handling, validation, and user experience
 */

// Error types for better error handling
export enum CloudinaryErrorType {
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  UNKNOWN = 'UNKNOWN',
}

export interface CloudinaryError {
  type: CloudinaryErrorType;
  message: string;
  originalError?: any;
}

/**
 * Parse and categorize Cloudinary errors for better user messaging
 */
export function parseCloudinaryError(error: any): CloudinaryError {
  const errorMessage = error?.message || error?.error?.message || 'Unknown error';
  
  // Check for specific error patterns
  if (errorMessage.includes('permission') || errorMessage.includes('denied')) {
    return {
      type: CloudinaryErrorType.PERMISSION_DENIED,
      message: 'Camera or photo library permission was denied. Please check your device settings.',
      originalError: error,
    };
  }
  
  if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
    return {
      type: CloudinaryErrorType.NETWORK_ERROR,
      message: 'Network error occurred. Please check your internet connection and try again.',
      originalError: error,
    };
  }
  
  if (errorMessage.includes('file size') || errorMessage.includes('too large')) {
    return {
      type: CloudinaryErrorType.FILE_TOO_LARGE,
      message: 'The selected image is too large. Please choose a smaller image.',
      originalError: error,
    };
  }
  
  if (errorMessage.includes('file type') || errorMessage.includes('format')) {
    return {
      type: CloudinaryErrorType.INVALID_FILE_TYPE,
      message: 'Invalid file type. Please select a valid image file.',
      originalError: error,
    };
  }
  
  if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
    return {
      type: CloudinaryErrorType.QUOTA_EXCEEDED,
      message: 'Upload limit reached. Please try again later or contact support.',
      originalError: error,
    };
  }
  
  return {
    type: CloudinaryErrorType.UNKNOWN,
    message: errorMessage,
    originalError: error,
  };
}

/**
 * Show user-friendly error alerts
 */
export function showCloudinaryError(error: CloudinaryError, customActions?: Array<{ text: string; onPress: () => void }>) {
  const defaultActions = [{ text: 'OK', onPress: () => {} }];
  const actions = customActions || defaultActions;
  
  let title = 'Upload Error';
  
  switch (error.type) {
    case CloudinaryErrorType.PERMISSION_DENIED:
      title = 'Permission Required';
      break;
    case CloudinaryErrorType.NETWORK_ERROR:
      title = 'Network Error';
      break;
    case CloudinaryErrorType.FILE_TOO_LARGE:
      title = 'File Too Large';
      break;
    case CloudinaryErrorType.INVALID_FILE_TYPE:
      title = 'Invalid File';
      break;
    case CloudinaryErrorType.QUOTA_EXCEEDED:
      title = 'Upload Limit Reached';
      break;
  }
  
  Alert.alert(title, error.message, actions);
}

/**
 * Validate image before upload
 */
export interface ImageValidationOptions {
  maxSizeInMB?: number;
  allowedTypes?: string[];
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface FileOrAssetInfo {
  uri?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  type?: string | null;
}

/**
 * Validates that an asset, file object, or URI is strictly an image
 */
export function isImageFile(
  fileOrAsset?: FileOrAssetInfo | string | null
): { isValid: boolean; error?: string } {
  if (!fileOrAsset) {
    return { isValid: false, error: 'No file selected.' };
  }

  const uri = typeof fileOrAsset === 'string' ? fileOrAsset : fileOrAsset.uri || '';
  const mime = (typeof fileOrAsset === 'object' ? fileOrAsset.mimeType : '') || '';
  const fileName = (typeof fileOrAsset === 'object' ? fileOrAsset.fileName : '') || '';
  const type = (typeof fileOrAsset === 'object' ? fileOrAsset.type : '') || '';

  // 1. Explicit asset type (e.g. from ImagePicker: 'image' | 'video')
  if (type && type !== 'image' && !type.toLowerCase().startsWith('image/')) {
    return { isValid: false, error: 'Only image files are allowed. Videos and other formats cannot be uploaded.' };
  }

  // 2. MIME type check
  if (mime && !mime.toLowerCase().startsWith('image/')) {
    return { isValid: false, error: `Invalid file type (${mime}). Only images are allowed.` };
  }

  // 3. Base64 data URI check
  if (uri.startsWith('data:')) {
    const dataMime = uri.substring(5, uri.indexOf(';')).toLowerCase();
    if (dataMime && !dataMime.startsWith('image/')) {
      return { isValid: false, error: 'Only image files are allowed to be uploaded.' };
    }
    return { isValid: true };
  }

  // 4. File extension check on filename or URI
  const rawTarget = (fileName || uri).split('?')[0].toLowerCase();
  const forbiddenExts = [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.txt', '.csv', '.zip', '.rar', '.7z', '.tar', '.gz',
    '.mp4', '.avi', '.mov', '.mkv', '.webm', '.mp3', '.wav',
    '.exe', '.apk', '.bin', '.json', '.xml', '.html', '.js', '.ts'
  ];
  if (forbiddenExts.some((ext) => rawTarget.endsWith(ext))) {
    return { isValid: false, error: 'Only image files (JPG, PNG, WebP, GIF, etc.) are allowed to be uploaded.' };
  }

  const match = rawTarget.match(/\.([a-z0-9]+)$/i);
  if (match) {
    const ext = `.${match[1]}`;
    const allowedImageExts = [
      '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg',
      '.heic', '.heif', '.jfif', '.pjp', '.pjpeg', '.tif', '.tiff', '.avif', '.ico'
    ];
    if (!allowedImageExts.includes(ext) && !rawTarget.startsWith('blob:') && !rawTarget.includes('cloudinary.com')) {
      return { isValid: false, error: 'Only image files (JPG, PNG, WebP, GIF, etc.) are allowed to be uploaded.' };
    }
  }

  return { isValid: true };
}

export function validateImage(
  imageUri: string,
  options: ImageValidationOptions = {}
): Promise<{ isValid: boolean; error?: CloudinaryError }> {
  return new Promise((resolve) => {
    if (!imageUri) {
      resolve({
        isValid: false,
        error: {
          type: CloudinaryErrorType.INVALID_FILE_TYPE,
          message: 'No image selected',
        },
      });
      return;
    }

    const check = isImageFile(imageUri);
    if (!check.isValid) {
      resolve({
        isValid: false,
        error: {
          type: CloudinaryErrorType.INVALID_FILE_TYPE,
          message: check.error || 'Invalid file type. Only image files are allowed.',
        },
      });
      return;
    }

    resolve({ isValid: true });
  });
}

/**
 * Handle upload result with automatic error handling
 */
export function handleUploadResult(
  result: UploadResult,
  onSuccess: (url: string, publicId: string) => void,
  onError?: (error: CloudinaryError) => void
) {
  if (result.success && result.url) {
    onSuccess(result.url, result.publicId || '');
  } else {
    const error = parseCloudinaryError(result.error);
    
    if (onError) {
      onError(error);
    } else {
      showCloudinaryError(error);
    }
  }
}

/**
 * Retry upload with exponential backoff
 */
export async function retryUpload<T>(
  uploadFunction: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await uploadFunction();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff
      const delay = initialDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Generate responsive image URLs for different screen sizes
 */
export interface ResponsiveImageUrls {
  thumbnail: string;
  small: string;
  medium: string;
  large: string;
  original: string;
}

export function generateResponsiveUrls(publicId: string, cloudName?: string): ResponsiveImageUrls {
  const actualCloudName = cloudName || process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!actualCloudName) {
    throw new Error('Cloud name is required. Either pass it as parameter or set EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME');
  }
  
  const baseUrl = `https://res.cloudinary.com/${actualCloudName}/image/upload`;
  
  return {
    thumbnail: `${baseUrl}/w_150,h_150,c_fill,q_auto,f_auto/${publicId}`,
    small: `${baseUrl}/w_300,h_300,c_limit,q_auto,f_auto/${publicId}`,
    medium: `${baseUrl}/w_600,h_600,c_limit,q_auto,f_auto/${publicId}`,
    large: `${baseUrl}/w_1200,h_1200,c_limit,q_auto,f_auto/${publicId}`,
    original: `${baseUrl}/q_auto,f_auto/${publicId}`,
  };
}

/**
 * Compress image before upload (for React Native)
 */
export interface CompressionOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  format?: 'jpeg' | 'png' | 'webp';
}

// Note: This would require additional libraries like react-native-image-resizer
// or expo-image-manipulator for actual implementation
export async function compressImage(
  imageUri: string,
  _options: CompressionOptions = {}
): Promise<string> {
  // Returns imageUri directly; Cloudinary transforms deliver at optimal 360p-480p
  return imageUri;
}

/**
 * Log upload analytics
 */
export function logUploadAnalytics(
  eventType: 'upload_started' | 'upload_success' | 'upload_failed',
  metadata: {
    folder?: string;
    fileSize?: number;
    uploadTime?: number;
    errorType?: CloudinaryErrorType;
  }
) {
  // Log to your analytics service
  console.log(`Cloudinary ${eventType}:`, metadata);
  
  // You could integrate with services like:
  // - Firebase Analytics
  // - Mixpanel
  // - Amplitude
  // - Custom analytics
}

/**
 * Cache management for uploaded images
 */
class CloudinaryCache {
  private cache = new Map<string, UploadResult>();
  private maxCacheSize = 100;
  
  set(key: string, result: UploadResult) {
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, result);
  }
  
  get(key: string): UploadResult | undefined {
    return this.cache.get(key);
  }
  
  clear() {
    this.cache.clear();
  }
  
  has(key: string): boolean {
    return this.cache.has(key);
  }
}

export const cloudinaryCache = new CloudinaryCache();

/**
 * Utility for generating cache keys
 */
export function generateCacheKey(imageUri: string, folder?: string): string {
  const timestamp = Math.floor(Date.now() / 1000); // Cache for 1 second intervals
  return `${imageUri}_${folder || 'default'}_${timestamp}`;
}
