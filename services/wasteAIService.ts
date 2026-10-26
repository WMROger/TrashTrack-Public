import app, { auth } from '@/config/firebase';
import * as FileSystem from 'expo-file-system';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';
import { classifyWasteEdgeML, CollectionCategory } from './edgeWasteClassifier';

export type { CollectionCategory };

export interface WasteAnalysisResult {
  wasteType: string;
  wasteTypes?: string[];
  collectionCategory?: CollectionCategory;
  isUnsegregated?: boolean;
  rewardPoints?: number;
  estimatedWeight: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  details: string;
  isEdgePrediction?: boolean;
}

const FALLBACK_RESULT: WasteAnalysisResult = {
  wasteType: 'Unable to determine',
  estimatedWeight: '—',
  confidence: 'none',
  details: 'Could not analyze the image. Please ensure the waste is clearly visible.',
};

const NOT_TRASH_RESULT: WasteAnalysisResult = {
  wasteType: 'Not waste',
  estimatedWeight: '—',
  confidence: 'none',
  details: 'This image does not appear to contain waste or trash. Please take a photo of the waste you want to report.',
};

// Client-side rate-limit guard (max 6 scans/minute) before hitting the Cloud Function (#3)
const clientScanTimestamps: number[] = [];
const CLIENT_MAX_SCANS_PER_MINUTE = 6;

function canProceedWithClientRateLimit(): boolean {
  const now = Date.now();
  while (clientScanTimestamps.length > 0 && now - clientScanTimestamps[0] > 60_000) {
    clientScanTimestamps.shift();
  }
  if (clientScanTimestamps.length >= CLIENT_MAX_SCANS_PER_MINUTE) {
    return false;
  }
  clientScanTimestamps.push(now);
  return true;
}

/**
 * Helper to derive collectionCategory, isUnsegregated, and rewardPoints from detected physical waste types
 */
export function resolveCollectionClassification(
  wasteTypes: string[],
  rawWasteType: string,
  aiCategory?: string,
  aiIsUnsegregated?: boolean
): {
  wasteType: string;
  wasteTypes: string[];
  collectionCategory: CollectionCategory;
  isUnsegregated: boolean;
  rewardPoints: number;
} {
  const cleanTypes = Array.from(
    new Set(
      (Array.isArray(wasteTypes) && wasteTypes.length > 0 ? wasteTypes : [rawWasteType])
        .map((t) => String(t || '').trim())
        .filter(Boolean)
    )
  );

  const hasBio = cleanTypes.some((t) => t.toLowerCase().includes('organic') || t.toLowerCase().includes('biodegradable'));
  const hasNonBio = cleanTypes.some(
    (t) =>
      t.toLowerCase().includes('solid') ||
      t.toLowerCase().includes('recyclable') ||
      t.toLowerCase().includes('liquid') ||
      t.toLowerCase().includes('hazardous') ||
      t.toLowerCase().includes('non-biodegradable')
  );
  const rawLower = String(rawWasteType || '').toLowerCase();
  const catLower = String(aiCategory || '').toLowerCase();

  const isUnsegregated =
    Boolean(aiIsUnsegregated) ||
    (hasBio && hasNonBio) ||
    cleanTypes.length > 1 ||
    rawLower.includes('unsegregated') ||
    rawLower.includes('mixed') ||
    catLower === 'unsegregated' ||
    catLower === 'mixed';

  let collectionCategory: CollectionCategory = 'Non-Biodegradable';
  if (isUnsegregated) {
    collectionCategory = 'Unsegregated';
  } else if (hasBio || catLower === 'biodegradable') {
    collectionCategory = 'Biodegradable';
  } else {
    collectionCategory = 'Non-Biodegradable';
  }

  let finalWasteType = rawWasteType;
  if (isUnsegregated) {
    if (cleanTypes.length > 1) {
      const shortNames = cleanTypes.map((t) => t.replace(/\s*Waste$/i, '').trim());
      finalWasteType = `Unsegregated (${shortNames.join(' + ')})`;
    } else {
      finalWasteType = 'Unsegregated Waste';
    }
  }

  const rewardPoints = isUnsegregated ? 25 : 50;

  return {
    wasteType: finalWasteType,
    wasteTypes: cleanTypes,
    collectionCategory,
    isUnsegregated,
    rewardPoints,
  };
}

/**
 * Convert a local image URI to a base64 string.
 * Works on both native (Expo FileSystem) and web (fetch + blob).
 */
async function imageUriToBase64(uri: string): Promise<{ base64: string; mimeType: string }> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    const mimeType = blob.type || 'image/jpeg';

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        resolve({ base64, mimeType });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } else {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64' as any,
    });
    const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
    };
    const mimeType = mimeMap[ext] || 'image/jpeg';
    return { base64, mimeType };
  }
}

/**
 * Hybrid Machine Learning Waste Analysis Pipeline:
 * Stage 1: Computes instant On-Device Edge ML visual feature classification (< 30ms).
 * Stage 2: Calls the server-side `analyzeWasteImage` Cloud Function (which holds the private
 *          GEMINI_API_KEY on the server, enforces 20/user/day and 500/global/day spending caps,
 *          and completes within < 2.8s). Automatically falls back to Stage 1 Edge ML when offline
 *          or when the AI spending cap is reached.
 */
export async function analyzeWasteImage(
  imageUri: string,
  precomputedBase64?: string | null,
  onInstantPrediction?: (result: WasteAnalysisResult) => void
): Promise<WasteAnalysisResult> {
  let edgePrediction: WasteAnalysisResult = FALLBACK_RESULT;

  try {
    let base64 = precomputedBase64;
    let mimeType = 'image/jpeg';

    const ext = imageUri.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
    };
    mimeType = mimeMap[ext] || 'image/jpeg';

    if (!base64) {
      const converted = await imageUriToBase64(imageUri);
      base64 = converted.base64;
      mimeType = converted.mimeType;
    }

    if (base64) {
      if (base64.startsWith('iVBORw0KGgo')) mimeType = 'image/png';
      else if (base64.startsWith('UklGR')) mimeType = 'image/webp';
      else if (base64.startsWith('R0lGOD')) mimeType = 'image/gif';
      else if (base64.startsWith('/9j/')) mimeType = 'image/jpeg';
    }

    // --- STAGE 1: INSTANT ON-DEVICE EDGE ML INFERENCE (< 30ms) ---
    if (base64) {
      edgePrediction = classifyWasteEdgeML(base64);
      onInstantPrediction?.(edgePrediction);
    }

    if (!base64 || base64.length > 5_500_000 || !app || !auth?.currentUser) {
      return edgePrediction;
    }

    if (!canProceedWithClientRateLimit()) {
      return edgePrediction;
    }

    // --- STAGE 2: SERVER-PROXY AI ANALYSIS (< 2.8s fast timeout, spending cap protected) ---
    const functionsInstance = getFunctions(app);
    const analyzeCallable = httpsCallable<
      { base64: string; mimeType: string },
      {
        fallbackToEdge?: boolean;
        reason?: string;
        analysis?: {
          isWaste?: boolean;
          wasteType: string;
          wasteTypes?: string[];
          collectionCategory?: string;
          isUnsegregated?: boolean;
          estimatedWeight?: string;
          confidence?: 'high' | 'medium' | 'low';
          details?: string;
        };
      }
    >(functionsInstance, 'analyzeWasteImage');

    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([
      analyzeCallable({ base64, mimeType }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 2800);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    if (!response || !response.data || response.data.fallbackToEdge || !response.data.analysis) {
      return edgePrediction;
    }

    const parsed = response.data.analysis;
    if (parsed.isWaste === false || parsed.wasteType === 'Not waste') {
      return {
        ...NOT_TRASH_RESULT,
        details: parsed.details || NOT_TRASH_RESULT.details,
      };
    }

    const resolved = resolveCollectionClassification(
      parsed.wasteTypes || [],
      parsed.wasteType,
      parsed.collectionCategory,
      parsed.isUnsegregated
    );

    return {
      wasteType: resolved.wasteType,
      wasteTypes: resolved.wasteTypes,
      collectionCategory: resolved.collectionCategory,
      isUnsegregated: resolved.isUnsegregated,
      rewardPoints: resolved.rewardPoints,
      estimatedWeight: parsed.estimatedWeight || edgePrediction.estimatedWeight || '1-3 kg',
      confidence: parsed.confidence || 'high',
      details: parsed.details || edgePrediction.details,
      isEdgePrediction: false,
    };
  } catch {
    // Never leak stack traces (#8); seamlessly return instant on-device Edge ML result
    if (edgePrediction && edgePrediction.wasteType !== 'Unable to determine') {
      return edgePrediction;
    }
    return FALLBACK_RESULT;
  }
}
