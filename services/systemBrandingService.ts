import { db } from '../config/firebase';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

export interface SystemBrandingSettings {
  systemLogoUrl?: string | null;
  systemLogoPublicId?: string | null;
  cenroLogoUrl?: string | null;
  cenroLogoPublicId?: string | null;
  cictoLogoUrl?: string | null;
  cictoLogoPublicId?: string | null;
  landingBgUrl?: string | null;
  landingBgPublicId?: string | null;
  // General Municipal Information
  systemTitle?: string | null;
  supportEmail?: string | null;
  supportPhone?: string | null;
  officeAddress?: string | null;
  operatingHours?: string | null;
  updatedAt?: any;
  updatedBy?: string | null;
  updatedByEmail?: string | null;
}

export const DEFAULT_GENERAL_SETTINGS = {
  systemTitle: 'City of Danao — Solid Waste Management & Telemetry System',
  supportEmail: 'cicto@danao.gov.ph',
  supportPhone: '(032) 200-3000',
  officeAddress: 'Danao City Hall, F. Ralota St, Poblacion, Danao City, Cebu',
  operatingHours: 'Monday – Saturday: 5:00 AM – 8:00 PM',
};

const BRANDING_DOC_PATH = ['system_settings', 'branding'] as const;
const LOCAL_STORAGE_KEY = 'trashtrack_branding_cache';

function loadLocalBranding(): SystemBrandingSettings {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
  }
  return {
    systemLogoUrl: null,
    systemLogoPublicId: null,
    cenroLogoUrl: null,
    cenroLogoPublicId: null,
    cictoLogoUrl: null,
    cictoLogoPublicId: null,
    landingBgUrl: null,
    landingBgPublicId: null,
    systemTitle: null,
    supportEmail: null,
    supportPhone: null,
    officeAddress: null,
    operatingHours: null,
  };
}

function saveLocalBranding(data: SystemBrandingSettings) {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  }
}

let cachedBranding: SystemBrandingSettings = loadLocalBranding();

export function getCachedSystemBranding(): SystemBrandingSettings {
  return cachedBranding;
}

export function subscribeToSystemBranding(
  callback: (branding: SystemBrandingSettings) => void
): () => void {
  // Always trigger callback immediately with whatever is in cache to prevent UI flash
  callback(cachedBranding);

  if (!db) {
    return () => {};
  }

  try {
    const brandingRef = doc(db, BRANDING_DOC_PATH[0], BRANDING_DOC_PATH[1]);
    const unsubscribe = onSnapshot(
      brandingRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as SystemBrandingSettings;
          cachedBranding = {
            systemLogoUrl: data.systemLogoUrl ?? null,
            systemLogoPublicId: data.systemLogoPublicId ?? null,
            cenroLogoUrl: data.cenroLogoUrl ?? null,
            cenroLogoPublicId: data.cenroLogoPublicId ?? null,
            cictoLogoUrl: data.cictoLogoUrl ?? null,
            cictoLogoPublicId: data.cictoLogoPublicId ?? null,
            landingBgUrl: data.landingBgUrl ?? null,
            landingBgPublicId: data.landingBgPublicId ?? null,
            systemTitle: data.systemTitle ?? null,
            supportEmail: data.supportEmail ?? null,
            supportPhone: data.supportPhone ?? null,
            officeAddress: data.officeAddress ?? null,
            operatingHours: data.operatingHours ?? null,
            updatedAt: data.updatedAt,
            updatedBy: data.updatedBy ?? null,
            updatedByEmail: data.updatedByEmail ?? null,
          };
        } else {
          cachedBranding = {
            systemLogoUrl: null,
            systemLogoPublicId: null,
            cenroLogoUrl: null,
            cenroLogoPublicId: null,
            cictoLogoUrl: null,
            cictoLogoPublicId: null,
            landingBgUrl: null,
            landingBgPublicId: null,
            systemTitle: null,
            supportEmail: null,
            supportPhone: null,
            officeAddress: null,
            operatingHours: null,
          };
        }
        saveLocalBranding(cachedBranding);
        callback(cachedBranding);
      },
      (error) => {
        console.warn('System branding subscription error:', error);
        callback(cachedBranding);
      }
    );

    return unsubscribe;
  } catch (err) {
    console.warn('Failed to subscribe to system branding:', err);
    callback(cachedBranding);
    return () => {};
  }
}

export async function getSystemBranding(): Promise<SystemBrandingSettings> {
  if (!db) return cachedBranding;
  try {
    const brandingRef = doc(db, BRANDING_DOC_PATH[0], BRANDING_DOC_PATH[1]);
    const snap = await getDoc(brandingRef);
    if (snap.exists()) {
      const data = snap.data() as SystemBrandingSettings;
      cachedBranding = {
        systemLogoUrl: data.systemLogoUrl ?? null,
        systemLogoPublicId: data.systemLogoPublicId ?? null,
        cenroLogoUrl: data.cenroLogoUrl ?? null,
        cenroLogoPublicId: data.cenroLogoPublicId ?? null,
        cictoLogoUrl: data.cictoLogoUrl ?? null,
        cictoLogoPublicId: data.cictoLogoPublicId ?? null,
        landingBgUrl: data.landingBgUrl ?? null,
        landingBgPublicId: data.landingBgPublicId ?? null,
        systemTitle: data.systemTitle ?? null,
        supportEmail: data.supportEmail ?? null,
        supportPhone: data.supportPhone ?? null,
        officeAddress: data.officeAddress ?? null,
        operatingHours: data.operatingHours ?? null,
        updatedAt: data.updatedAt,
        updatedBy: data.updatedBy ?? null,
        updatedByEmail: data.updatedByEmail ?? null,
      };
      saveLocalBranding(cachedBranding);
      return cachedBranding;
    }
  } catch (error) {
    console.warn('Failed to fetch system branding:', error);
  }
  return cachedBranding;
}

export async function updateSystemLogo(
  url: string,
  publicId?: string | null,
  updatedBy?: string | null,
  updatedByEmail?: string | null
): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  const brandingRef = doc(db, BRANDING_DOC_PATH[0], BRANDING_DOC_PATH[1]);
  await setDoc(
    brandingRef,
    {
      systemLogoUrl: url,
      systemLogoPublicId: publicId ?? null,
      updatedAt: serverTimestamp(),
      updatedBy: updatedBy ?? null,
      updatedByEmail: updatedByEmail ?? null,
    },
    { merge: true }
  );
  cachedBranding.systemLogoUrl = url;
  cachedBranding.systemLogoPublicId = publicId ?? null;
  saveLocalBranding(cachedBranding);
}

export async function resetSystemLogo(
  updatedBy?: string | null,
  updatedByEmail?: string | null
): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  const brandingRef = doc(db, BRANDING_DOC_PATH[0], BRANDING_DOC_PATH[1]);
  await setDoc(
    brandingRef,
    {
      systemLogoUrl: null,
      systemLogoPublicId: null,
      updatedAt: serverTimestamp(),
      updatedBy: updatedBy ?? null,
      updatedByEmail: updatedByEmail ?? null,
    },
    { merge: true }
  );
  cachedBranding.systemLogoUrl = null;
  cachedBranding.systemLogoPublicId = null;
  saveLocalBranding(cachedBranding);
}

export function getAgencyLogoUrl(
  branding: SystemBrandingSettings | null | undefined,
  agency: 'cenro' | 'cicto'
): string | null {
  if (!branding) return null;
  if (agency === 'cenro') {
    return branding.cenroLogoUrl ?? branding.systemLogoUrl ?? null;
  }
  return branding.cictoLogoUrl ?? branding.systemLogoUrl ?? null;
}

export async function updateAgencyLogo(
  agency: 'cenro' | 'cicto',
  url: string,
  publicId?: string | null,
  updatedBy?: string | null,
  updatedByEmail?: string | null
): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  const brandingRef = doc(db, BRANDING_DOC_PATH[0], BRANDING_DOC_PATH[1]);
  const isCenro = agency === 'cenro';
  const payload: any = {
    updatedAt: serverTimestamp(),
    updatedBy: updatedBy ?? null,
    updatedByEmail: updatedByEmail ?? null,
  };
  if (isCenro) {
    payload.cenroLogoUrl = url;
    payload.cenroLogoPublicId = publicId ?? null;
    cachedBranding.cenroLogoUrl = url;
    cachedBranding.cenroLogoPublicId = publicId ?? null;
  } else {
    payload.cictoLogoUrl = url;
    payload.cictoLogoPublicId = publicId ?? null;
    cachedBranding.cictoLogoUrl = url;
    cachedBranding.cictoLogoPublicId = publicId ?? null;
  }
  // Also sync general fallback
  payload.systemLogoUrl = url;
  payload.systemLogoPublicId = publicId ?? null;
  cachedBranding.systemLogoUrl = url;
  cachedBranding.systemLogoPublicId = publicId ?? null;

  await setDoc(brandingRef, payload, { merge: true });
  saveLocalBranding(cachedBranding);
}

export async function resetAgencyLogo(
  agency: 'cenro' | 'cicto',
  updatedBy?: string | null,
  updatedByEmail?: string | null
): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  const brandingRef = doc(db, BRANDING_DOC_PATH[0], BRANDING_DOC_PATH[1]);
  const isCenro = agency === 'cenro';
  const payload: any = {
    updatedAt: serverTimestamp(),
    updatedBy: updatedBy ?? null,
    updatedByEmail: updatedByEmail ?? null,
  };
  if (isCenro) {
    payload.cenroLogoUrl = null;
    payload.cenroLogoPublicId = null;
    cachedBranding.cenroLogoUrl = null;
    cachedBranding.cenroLogoPublicId = null;
  } else {
    payload.cictoLogoUrl = null;
    payload.cictoLogoPublicId = null;
    cachedBranding.cictoLogoUrl = null;
    cachedBranding.cictoLogoPublicId = null;
  }
  await setDoc(brandingRef, payload, { merge: true });
  saveLocalBranding(cachedBranding);
}

export async function updateLandingBackground(
  url: string,
  publicId?: string | null,
  updatedBy?: string | null,
  updatedByEmail?: string | null
): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  const brandingRef = doc(db, BRANDING_DOC_PATH[0], BRANDING_DOC_PATH[1]);
  await setDoc(
    brandingRef,
    {
      landingBgUrl: url,
      landingBgPublicId: publicId ?? null,
      updatedAt: serverTimestamp(),
      updatedBy: updatedBy ?? null,
      updatedByEmail: updatedByEmail ?? null,
    },
    { merge: true }
  );
  cachedBranding.landingBgUrl = url;
  cachedBranding.landingBgPublicId = publicId ?? null;
  saveLocalBranding(cachedBranding);
}

export async function resetLandingBackground(
  updatedBy?: string | null,
  updatedByEmail?: string | null
): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  const brandingRef = doc(db, BRANDING_DOC_PATH[0], BRANDING_DOC_PATH[1]);
  await setDoc(
    brandingRef,
    {
      landingBgUrl: null,
      landingBgPublicId: null,
      updatedAt: serverTimestamp(),
      updatedBy: updatedBy ?? null,
      updatedByEmail: updatedByEmail ?? null,
    },
    { merge: true }
  );
  cachedBranding.landingBgUrl = null;
  cachedBranding.landingBgPublicId = null;
  saveLocalBranding(cachedBranding);
}

export async function updateGeneralSettings(
  params: {
    systemTitle?: string | null;
    supportEmail?: string | null;
    supportPhone?: string | null;
    officeAddress?: string | null;
    operatingHours?: string | null;
  },
  updatedBy?: string | null,
  updatedByEmail?: string | null
): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  const brandingRef = doc(db, BRANDING_DOC_PATH[0], BRANDING_DOC_PATH[1]);
  await setDoc(
    brandingRef,
    {
      ...params,
      updatedAt: serverTimestamp(),
      updatedBy: updatedBy ?? null,
      updatedByEmail: updatedByEmail ?? null,
    },
    { merge: true }
  );
  cachedBranding = {
    ...cachedBranding,
    ...params,
  };
  saveLocalBranding(cachedBranding);
}

export async function resetGeneralSettings(
  updatedBy?: string | null,
  updatedByEmail?: string | null
): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  const brandingRef = doc(db, BRANDING_DOC_PATH[0], BRANDING_DOC_PATH[1]);
  await setDoc(
    brandingRef,
    {
      systemTitle: null,
      supportEmail: null,
      supportPhone: null,
      officeAddress: null,
      operatingHours: null,
      updatedAt: serverTimestamp(),
      updatedBy: updatedBy ?? null,
      updatedByEmail: updatedByEmail ?? null,
    },
    { merge: true }
  );
  cachedBranding.systemTitle = null;
  cachedBranding.supportEmail = null;
  cachedBranding.supportPhone = null;
  cachedBranding.officeAddress = null;
  cachedBranding.operatingHours = null;
  saveLocalBranding(cachedBranding);
}
