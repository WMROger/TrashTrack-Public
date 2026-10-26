// n8n Configuration — No secret API keys in client bundle
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const N8N_CONFIG = {
  // Webhook URL configured via environment variable (server-side proxy recommended for production)
  WEBHOOK_URL: process.env.EXPO_PUBLIC_N8N_WEBHOOK_URL || '',

  // Request timeout in milliseconds (kept under 10s so UI never hangs)
  TIMEOUT: 10000,

  // Maximum retry attempts
  MAX_RETRIES: 2,

  // Delay between retries in milliseconds
  RETRY_DELAY: 1000,

  // CORS Proxy URL (fallback for CORS issues)
  CORS_PROXY_URL: process.env.EXPO_PUBLIC_CORS_PROXY_URL || '',

  // Use CORS proxy if direct calls fail
  USE_CORS_PROXY: process.env.EXPO_PUBLIC_USE_CORS_PROXY === 'true' || false,
};

function normalizeUrlForPlatform(url: string): string {
  if (typeof url !== 'string' || url.length === 0) return url;

  const replaceHostname = (originalUrl: string, newHostname: string): string => {
    try {
      const parsed = new URL(originalUrl);
      parsed.hostname = newHostname;
      return parsed.toString();
    } catch {
      return originalUrl;
    }
  };

  const isLoopback = url.includes('://localhost') || url.includes('://127.0.0.1');
  const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

  if (isLoopback && isNative) {
    const hostUri = (Constants?.expoConfig as any)?.hostUri || (Constants as any)?.hostUri;
    if (typeof hostUri === 'string' && hostUri.length > 0) {
      const hostPart = hostUri.split('/')[0];
      const lanHostname = hostPart.split(':')[0];
      return replaceHostname(url, lanHostname);
    }
  }

  if (Platform.OS === 'android') {
    let updated = url.replace('://localhost', '://10.0.2.2');
    updated = updated.replace('://192.168.1.5', '://10.0.2.2');
    return updated;
  }

  return url;
}

export function getN8nWebhookUrl(): string {
  if (shouldUseCorsProxy()) {
    return getCorsProxyUrl() + normalizeUrlForPlatform(N8N_CONFIG.WEBHOOK_URL);
  }
  return normalizeUrlForPlatform(N8N_CONFIG.WEBHOOK_URL);
}

export function isN8nConfigured(): boolean {
  return Boolean(N8N_CONFIG.WEBHOOK_URL && N8N_CONFIG.WEBHOOK_URL.trim().length > 0);
}

export function getCorsProxyUrl(): string {
  return N8N_CONFIG.CORS_PROXY_URL;
}

export function shouldUseCorsProxy(): boolean {
  return N8N_CONFIG.USE_CORS_PROXY;
}
