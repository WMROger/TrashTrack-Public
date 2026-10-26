/**
 * Cheap Android Phone & Sub-3-Second Performance Utilities (#12, #13)
 * Provides adaptive rendering budgets, FlatList windowing props, image compression
 * presets, and strict <3s network timeout wrappers so TrashTrack stays fast and smooth
 * on entry-level Android devices and 3G/LTE connections.
 */
import { Dimensions, PixelRatio, Platform } from 'react-native';

export interface DevicePerformanceProfile {
  isLowEndAndroid: boolean;
  maxMapMarkers: number;
  imageUploadMaxWidth: number;
  imageUploadQuality: number;
  enableHeavyShadows: boolean;
  flatListProps: {
    removeClippedSubviews: boolean;
    initialNumToRender: number;
    maxToRenderPerBatch: number;
    windowSize: number;
    updateCellsBatchingPeriod: number;
  };
}

export function getDevicePerformanceProfile(): DevicePerformanceProfile {
  const { width, height } = Dimensions.get('window');
  const pixelRatio = PixelRatio.get();
  const isAndroid = Platform.OS === 'android';

  // Entry-level Android phones typically have smaller logical viewports or lower pixel density
  // or run Android where clipping subviews and limiting batch sizes prevents UI thread frame drops.
  const isLowEndAndroid = isAndroid && (width <= 380 || height <= 720 || pixelRatio <= 2);

  return {
    isLowEndAndroid,
    maxMapMarkers: isLowEndAndroid ? 35 : 100,
    imageUploadMaxWidth: isLowEndAndroid ? 800 : 1080,
    imageUploadQuality: isLowEndAndroid ? 0.55 : 0.72,
    enableHeavyShadows: !isLowEndAndroid,
    flatListProps: {
      removeClippedSubviews: isAndroid,
      initialNumToRender: isLowEndAndroid ? 6 : 10,
      maxToRenderPerBatch: isLowEndAndroid ? 4 : 8,
      windowSize: isLowEndAndroid ? 5 : 7,
      updateCellsBatchingPeriod: isLowEndAndroid ? 60 : 40,
    },
  };
}

/**
 * Enforces a strict < 3000ms timeout on any fetch request (#13)
 * so external APIs (OSRM routing, geocoding, weather) never block UI loading for > 3 seconds.
 */
export async function fetchWithFastTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 2800
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 2950));
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

