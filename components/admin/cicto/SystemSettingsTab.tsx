import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageCropModal } from './ImageCropModal';
import { auth } from '@/config/firebase';
import { cloudinaryService } from '@/services/cloudinaryService';
import { isImageFile } from '@/utils/cloudinaryHelpers';
import {
  DEFAULT_GENERAL_SETTINGS,
  SystemBrandingSettings,
  getAgencyLogoUrl,
  resetAgencyLogo,
  resetGeneralSettings,
  resetLandingBackground,
  resetSystemLogo,
  subscribeToSystemBranding,
  updateAgencyLogo,
  updateGeneralSettings,
  updateLandingBackground,
  updateSystemLogo,
} from '@/services/systemBrandingService';
import {
  EmergencyBroadcastData,
  clearActiveEmergencyBroadcast,
  dispatchEmergencyBroadcastDirective,
  subscribeToSystemOverrides,
} from '@/services/systemOverridesService';

type LoadingAction =
  | 'upload-cenro-logo'
  | 'reset-cenro-logo'
  | 'upload-cicto-logo'
  | 'reset-cicto-logo'
  | 'upload-logo'
  | 'reset-logo'
  | 'upload-bg'
  | 'reset-bg'
  | 'save-general'
  | 'reset-general'
  | 'transmit-broadcast'
  | 'clear-broadcast'
  | null;

export default function SystemSettingsTab() {
  const [activeSection, setActiveSection] = useState<'branding' | 'general' | 'advisory'>('branding');

  // Branding States
  const [branding, setBranding] = useState<SystemBrandingSettings>({
    systemLogoUrl: null,
    landingBgUrl: null,
  });
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);

  // General Municipal Info States
  const [systemTitle, setSystemTitle] = useState(DEFAULT_GENERAL_SETTINGS.systemTitle);
  const [supportEmail, setSupportEmail] = useState(DEFAULT_GENERAL_SETTINGS.supportEmail);
  const [supportPhone, setSupportPhone] = useState(DEFAULT_GENERAL_SETTINGS.supportPhone);
  const [officeAddress, setOfficeAddress] = useState(DEFAULT_GENERAL_SETTINGS.officeAddress);
  const [operatingHours, setOperatingHours] = useState(DEFAULT_GENERAL_SETTINGS.operatingHours);

  // Emergency Advisory States
  const [activeBroadcast, setActiveBroadcast] = useState<EmergencyBroadcastData | null>(null);
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastPriority, setBroadcastPriority] = useState<'urgent' | 'high'>('urgent');

  // Acknowledgment Modal
  const [ackModal, setAckModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    type: 'success' | 'info' | 'error';
  }>({
    visible: false,
    title: '',
    message: '',
    type: 'success',
  });

  // Confirmation Modal
  const [confirmModal, setConfirmModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    confirmColor?: string;
    onConfirm: () => void;
  }>({
    visible: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Interactive Crop Modal State
  const [cropModal, setCropModal] = useState<{
    visible: boolean;
    imageUri: string | null | undefined;
    cropType: 'cenro-logo' | 'cicto-logo' | 'background';
    fileName?: string;
  }>({
    visible: false,
    imageUri: null,
    cropType: 'cenro-logo',
  });

  // Web file input references
  const cenroLogoInputRef = useRef<HTMLInputElement | null>(null);
  const cictoLogoInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const unsubBranding = subscribeToSystemBranding((updated) => {
      setBranding(updated);
      setSystemTitle(updated.systemTitle || DEFAULT_GENERAL_SETTINGS.systemTitle);
      setSupportEmail(updated.supportEmail || DEFAULT_GENERAL_SETTINGS.supportEmail);
      setSupportPhone(updated.supportPhone || DEFAULT_GENERAL_SETTINGS.supportPhone);
      setOfficeAddress(updated.officeAddress || DEFAULT_GENERAL_SETTINGS.officeAddress);
      setOperatingHours(updated.operatingHours || DEFAULT_GENERAL_SETTINGS.operatingHours);
      setLoadingInitial(false);
    });

    const unsubOverrides = subscribeToSystemOverrides((overrides) => {
      setActiveBroadcast(overrides.activeEmergencyBroadcast || null);
    });

    return () => {
      unsubBranding();
      unsubOverrides();
    };
  }, []);

  const getCurrentUser = () => {
    const user = auth?.currentUser;
    return {
      uid: user?.uid || 'super-admin',
      email: user?.email || 'admin@danao.gov.ph',
    };
  };

  // ----------------------------------------------------
  // Dedicated Logo Upload & Reset Handlers (PNG & SVG ONLY)
  // Supports separate logos for CENRO and CICTO
  // ----------------------------------------------------
  const handleUploadAgencyLogo = async (agency: 'cenro' | 'cicto') => {
    try {
      if (Platform.OS === 'web') {
        const inputRef = agency === 'cenro' ? cenroLogoInputRef : cictoLogoInputRef;
        if (inputRef.current) {
          inputRef.current.click();
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      await processAgencyLogoFile(result.assets[0], agency);
    } catch (err: any) {
      console.error(`Error selecting ${agency} logo:`, err);
      setAckModal({
        visible: true,
        title: 'Selection Failed',
        message: err?.message || `Unable to open file picker for ${agency.toUpperCase()} logo.`,
        type: 'error',
      });
    }
  };

  const processAgencyLogoFile = async (asset: any, agency: 'cenro' | 'cicto') => {
    const isCenro = agency === 'cenro';
    const agencyName = isCenro ? 'CENRO' : 'CICTO';
    try {
      const fileName = (asset.fileName || asset.name || asset.uri || '').toLowerCase();
      const mimeType = (asset.mimeType || asset.type || '').toLowerCase();
      const allowedLogoExts = ['.png', '.svg'];
      const hasValidExt = allowedLogoExts.some((ext) => fileName.split('?')[0].endsWith(ext));
      const hasValidMime = mimeType.includes('png') || mimeType.includes('svg');

      if (!hasValidExt && !hasValidMime) {
        setAckModal({
          visible: true,
          title: 'Unsupported Logo Format',
          message: `Only PNG or SVG image files are allowed for the official ${agencyName} logo.`,
          type: 'error',
        });
        return;
      }

      const size = asset.fileSize || asset.size || asset.file?.size;
      if (size && size > 5 * 1024 * 1024) {
        setAckModal({
          visible: true,
          title: 'File Too Large',
          message: 'The selected logo exceeds the 5 MB file size limit. Please choose a smaller image.',
          type: 'error',
        });
        return;
      }

      const check = isImageFile(asset);
      if (!check.isValid) {
        setAckModal({
          visible: true,
          title: 'Invalid File Type',
          message: check.error || 'Please select a valid image (PNG or SVG).',
          type: 'error',
        });
        return;
      }

      // Open interactive crop modal immediately with locked 1:1 square ratio
      setCropModal({
        visible: true,
        imageUri: asset.uri,
        cropType: isCenro ? 'cenro-logo' : 'cicto-logo',
        fileName: asset.fileName || `${agency}_logo.png`,
      });
    } catch (err: any) {
      console.error(`${agencyName} logo selection error:`, err);
      setAckModal({
        visible: true,
        title: 'Selection Error',
        message: err?.message || `Could not open ${agencyName} logo for cropping. Please try again.`,
        type: 'error',
      });
    }
  };

  const handleWebAgencyLogoChange = async (e: any, agency: 'cenro' | 'cicto') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    await processAgencyLogoFile({
      uri: blobUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      type: file.type,
      file,
    }, agency);
    const inputRef = agency === 'cenro' ? cenroLogoInputRef : cictoLogoInputRef;
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleResetAgencyLogoConfirm = (agency: 'cenro' | 'cicto') => {
    const isCenro = agency === 'cenro';
    const agencyName = isCenro ? 'CENRO' : 'CICTO';
    const actionKey: LoadingAction = isCenro ? 'reset-cenro-logo' : 'reset-cicto-logo';
    setConfirmModal({
      visible: true,
      title: `Reset ${agencyName} Logo?`,
      message: `Are you sure you want to revert ${agencyName} to the default official seal? The custom logo will be removed from the /${agency} login and dashboards.`,
      confirmText: 'Confirm Reset',
      confirmColor: '#DC2626',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, visible: false }));
        setLoadingAction(actionKey);
        try {
          const user = getCurrentUser();
          await resetAgencyLogo(agency, user.uid, user.email);
          setAckModal({
            visible: true,
            title: `${agencyName} Logo Reset to Default`,
            message: `The ${agencyName} logo has been restored to the default official seal.`,
            type: 'info',
          });
        } catch (err: any) {
          setAckModal({
            visible: true,
            title: 'Reset Failed',
            message: err?.message || `Could not reset ${agencyName} logo.`,
            type: 'error',
          });
        } finally {
          setLoadingAction(null);
        }
      },
    });
  };

  // ----------------------------------------------------
  // Landing Background Upload & Reset Handlers
  // ----------------------------------------------------
  const handleUploadBg = async () => {
    try {
      if (Platform.OS === 'web' && bgInputRef.current) {
        bgInputRef.current.click();
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.9,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      await processBgFile(result.assets[0]);
    } catch (err: any) {
      console.error('Error selecting background:', err);
      setAckModal({
        visible: true,
        title: 'Selection Failed',
        message: err?.message || 'Unable to open file picker for landing background.',
        type: 'error',
      });
    }
  };

  const processBgFile = async (asset: any) => {
    try {
      const fileName = (asset.fileName || asset.name || asset.uri || '').toLowerCase();
      const mimeType = (asset.mimeType || asset.type || '').toLowerCase();
      const allowedBgExts = ['.jpg', '.jpeg', '.png', '.webp'];
      const hasValidExt = allowedBgExts.some((ext) => fileName.split('?')[0].endsWith(ext));
      const hasValidMime =
        mimeType.includes('jpeg') ||
        mimeType.includes('jpg') ||
        mimeType.includes('png') ||
        mimeType.includes('webp');

      if (!hasValidExt && !hasValidMime) {
        setAckModal({
          visible: true,
          title: 'Unsupported Background Format',
          message: 'Only JPG, PNG, or WebP image files are allowed for the landing portal background.',
          type: 'error',
        });
        return;
      }

      const size = asset.fileSize || asset.size || asset.file?.size;
      if (size && size > 10 * 1024 * 1024) {
        setAckModal({
          visible: true,
          title: 'File Too Large',
          message: 'The selected backdrop exceeds the 10 MB file size limit. Please choose a smaller image.',
          type: 'error',
        });
        return;
      }

      const check = isImageFile(asset);
      if (!check.isValid) {
        setAckModal({
          visible: true,
          title: 'Invalid File Type',
          message: check.error || 'Please select a valid image (JPG, PNG, WebP).',
          type: 'error',
        });
        return;
      }

      // Open interactive crop modal immediately with locked 16:9 widescreen ratio
      setCropModal({
        visible: true,
        imageUri: asset.uri,
        cropType: 'background',
        fileName: asset.fileName || 'landing_bg.jpg',
      });
    } catch (err: any) {
      console.error('Background selection error:', err);
      setAckModal({
        visible: true,
        title: 'Selection Error',
        message: err?.message || 'Could not open background image for cropping. Please try again.',
        type: 'error',
      });
    }
  };

  const handleApplyCroppedImage = async (croppedUri: string) => {
    const { cropType } = cropModal;
    if (cropType === 'cenro-logo' || cropType === 'cicto-logo') {
      const isCenro = cropType === 'cenro-logo';
      const agency = isCenro ? 'cenro' : 'cicto';
      const agencyName = isCenro ? 'CENRO' : 'CICTO';
      const actionKey: LoadingAction = isCenro ? 'upload-cenro-logo' : 'upload-cicto-logo';
      setLoadingAction(actionKey);

      try {
        const uploadRes = await cloudinaryService.uploadImage(croppedUri, {
          folder: `trashtruck/branding/logo_${agency}`,
        });

        if (!uploadRes.success || !uploadRes.url) {
          throw new Error(uploadRes.error || 'Cloudinary upload failed.');
        }

        const user = getCurrentUser();
        await updateAgencyLogo(agency, uploadRes.url, uploadRes.publicId, user.uid, user.email);

        setCropModal((prev) => ({ ...prev, visible: false }));
        setAckModal({
          visible: true,
          title: `${agencyName} Logo Updated`,
          message: `The official ${agencyName} logo has been cropped, uploaded, and is now live across the /${agency} portal login, dashboard top bar, and sidebar navigation.`,
          type: 'success',
        });
      } catch (err: any) {
        console.error(`${agencyName} cropped upload error:`, err);
        setAckModal({
          visible: true,
          title: 'Upload Failed',
          message: err?.message || `Could not upload and save cropped ${agencyName} logo. Please try again.`,
          type: 'error',
        });
      } finally {
        setLoadingAction(null);
      }
    } else if (cropType === 'background') {
      setLoadingAction('upload-bg');
      try {
        const uploadRes = await cloudinaryService.uploadImage(croppedUri, {
          folder: 'trashtruck/branding/landing-bg',
        });

        if (!uploadRes.success || !uploadRes.url) {
          throw new Error(uploadRes.error || 'Cloudinary upload failed.');
        }

        const user = getCurrentUser();
        await updateLandingBackground(uploadRes.url, uploadRes.publicId, user.uid, user.email);

        setCropModal((prev) => ({ ...prev, visible: false }));
        setAckModal({
          visible: true,
          title: 'Landing Background Updated',
          message: 'The landing page backdrop has been cropped, uploaded, and updated for visitors to /cenro and /cicto.',
          type: 'success',
        });
      } catch (err: any) {
        console.error('Background cropped upload error:', err);
        setAckModal({
          visible: true,
          title: 'Upload Failed',
          message: err?.message || 'Could not upload and save cropped landing background. Please try again.',
          type: 'error',
        });
      } finally {
        setLoadingAction(null);
      }
    }
  };

  const handleWebBgChange = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    await processBgFile({
      uri: blobUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      type: file.type,
      file,
    });
    if (bgInputRef.current) {
      bgInputRef.current.value = '';
    }
  };

  const handleResetBgConfirm = () => {
    setConfirmModal({
      visible: true,
      title: 'Reset Landing Background?',
      message: 'Are you sure you want to revert to the default backdrop image? The custom background will be removed from both CENRO and CICTO login screens.',
      confirmText: 'Confirm Reset',
      confirmColor: '#DC2626',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, visible: false }));
        setLoadingAction('reset-bg');
        try {
          const user = getCurrentUser();
          await resetLandingBackground(user.uid, user.email);
          setAckModal({
            visible: true,
            title: 'Background Reset to Default',
            message: 'The landing portal backdrop has been restored to the default professional background.',
            type: 'info',
          });
        } catch (err: any) {
          setAckModal({
            visible: true,
            title: 'Reset Failed',
            message: err?.message || 'Could not reset landing background.',
            type: 'error',
          });
        } finally {
          setLoadingAction(null);
        }
      },
    });
  };

  // ----------------------------------------------------
  // Municipal Information Handlers
  // ----------------------------------------------------
  const handleSaveGeneralInfo = async () => {
    setLoadingAction('save-general');
    try {
      const user = getCurrentUser();
      await updateGeneralSettings(
        {
          systemTitle: systemTitle.trim(),
          supportEmail: supportEmail.trim(),
          supportPhone: supportPhone.trim(),
          officeAddress: officeAddress.trim(),
          operatingHours: operatingHours.trim(),
        },
        user.uid,
        user.email
      );

      setAckModal({
        visible: true,
        title: 'Municipal Information Saved',
        message: 'The city contact information and system titles have been updated successfully and synced across public app links.',
        type: 'success',
      });
    } catch (err: any) {
      setAckModal({
        visible: true,
        title: 'Save Failed',
        message: err?.message || 'Could not save general municipal information.',
        type: 'error',
      });
    } finally {
      setLoadingAction(null);
    }
  };

  const handleResetGeneralConfirm = () => {
    setConfirmModal({
      visible: true,
      title: 'Reset Municipal Information?',
      message: 'Are you sure you want to revert city contact details and system name to the default official values?',
      confirmText: 'Reset to Defaults',
      confirmColor: '#475569',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, visible: false }));
        setLoadingAction('reset-general');
        try {
          const user = getCurrentUser();
          await resetGeneralSettings(user.uid, user.email);
          setSystemTitle(DEFAULT_GENERAL_SETTINGS.systemTitle);
          setSupportEmail(DEFAULT_GENERAL_SETTINGS.supportEmail);
          setSupportPhone(DEFAULT_GENERAL_SETTINGS.supportPhone);
          setOfficeAddress(DEFAULT_GENERAL_SETTINGS.officeAddress);
          setOperatingHours(DEFAULT_GENERAL_SETTINGS.operatingHours);
          setAckModal({
            visible: true,
            title: 'Information Restored',
            message: 'City information has been reset to official Danao City municipal defaults.',
            type: 'info',
          });
        } catch (err: any) {
          setAckModal({
            visible: true,
            title: 'Reset Failed',
            message: err?.message || 'Could not reset general information.',
            type: 'error',
          });
        } finally {
          setLoadingAction(null);
        }
      },
    });
  };

  // ----------------------------------------------------
  // Emergency Advisory Handlers
  // ----------------------------------------------------
  const handleTransmitBroadcast = () => {
    if (!broadcastSubject.trim()) {
      setAckModal({
        visible: true,
        title: 'Subject Required',
        message: 'Please provide a clear advisory subject before transmitting.',
        type: 'error',
      });
      return;
    }
    if (!broadcastMessage.trim()) {
      setAckModal({
        visible: true,
        title: 'Message Required',
        message: 'Please enter the advisory directives or information for citizens and fleet drivers.',
        type: 'error',
      });
      return;
    }

    setConfirmModal({
      visible: true,
      title: 'Transmit City-Wide Advisory?',
      message: `You are about to broadcast an ${broadcastPriority.toUpperCase()} advisory. This will immediately display across all citizen mobile feeds, driver tablets, and inter-agency chat channels.`,
      confirmText: 'Transmit Now',
      confirmColor: broadcastPriority === 'urgent' ? '#DC2626' : '#D97706',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, visible: false }));
        setLoadingAction('transmit-broadcast');
        try {
          const user = getCurrentUser();
          await dispatchEmergencyBroadcastDirective({
            subject: broadcastSubject.trim(),
            message: broadcastMessage.trim(),
            priority: broadcastPriority,
            actorEmail: user.email,
            actorUid: user.uid,
            actorName: 'CICTO Super Administrator',
          });

          setBroadcastSubject('');
          setBroadcastMessage('');

          setAckModal({
            visible: true,
            title: 'Advisory Transmitted Live',
            message: 'The emergency advisory is now broadcasting across the city. All active field trucks, staff, and public apps have received the bulletin.',
            type: 'success',
          });
        } catch (err: any) {
          setAckModal({
            visible: true,
            title: 'Transmission Failed',
            message: err?.message || 'Failed to dispatch the emergency advisory directive.',
            type: 'error',
          });
        } finally {
          setLoadingAction(null);
        }
      },
    });
  };

  const handleClearBroadcastConfirm = () => {
    setConfirmModal({
      visible: true,
      title: 'Withdraw Emergency Advisory?',
      message: 'Are you sure you want to end this active advisory broadcast? The banner will be dismissed from citizen and driver screens.',
      confirmText: 'Withdraw Broadcast',
      confirmColor: '#DC2626',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, visible: false }));
        setLoadingAction('clear-broadcast');
        try {
          const user = getCurrentUser();
          await clearActiveEmergencyBroadcast(user.email, user.uid);
          setAckModal({
            visible: true,
            title: 'Advisory Concluded',
            message: 'The active broadcast has been withdrawn and marked resolved in system records.',
            type: 'info',
          });
        } catch (err: any) {
          setAckModal({
            visible: true,
            title: 'Withdrawal Failed',
            message: err?.message || 'Failed to clear the active emergency advisory.',
            type: 'error',
          });
        } finally {
          setLoadingAction(null);
        }
      },
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Hidden file inputs for Web environment */}
      {Platform.OS === 'web' && (
        <>
          <input
            type="file"
            ref={cenroLogoInputRef as any}
            accept=".png,.svg,image/png,image/svg+xml"
            style={{ display: 'none' }}
            onChange={(e) => handleWebAgencyLogoChange(e, 'cenro')}
          />
          <input
            type="file"
            ref={cictoLogoInputRef as any}
            accept=".png,.svg,image/png,image/svg+xml"
            style={{ display: 'none' }}
            onChange={(e) => handleWebAgencyLogoChange(e, 'cicto')}
          />
          <input
            type="file"
            ref={bgInputRef as any}
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handleWebBgChange}
          />
        </>
      )}

      {/* Header Section */}
      <View style={styles.header}>
        <View style={styles.headerTextGroup}>
          <Text style={styles.eyebrow}>CICTO / SYSTEM CONFIGURATION</Text>
          <Text style={styles.title}>System Settings & Administration</Text>
          <Text style={styles.sub}>
            Manage visual identity, municipal contact information, and executive city-wide broadcast advisories.
          </Text>
        </View>
        <View style={styles.badgeAuthority}>
          <MaterialIcons name="verified-user" size={16} color="#0D9488" />
          <Text style={styles.badgeAuthorityText}>Super Admin Exclusive</Text>
        </View>
      </View>

      {/* Sub-Section Navigation Tabs */}
      <View style={styles.subTabsRow}>
        <TouchableOpacity
          style={[styles.subTabBtn, activeSection === 'branding' && styles.subTabBtnActive]}
          onPress={() => setActiveSection('branding')}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="palette"
            size={18}
            color={activeSection === 'branding' ? '#0D9488' : '#64748B'}
          />
          <Text style={[styles.subTabBtnText, activeSection === 'branding' && styles.subTabBtnTextActive]}>
            Branding & Visuals
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.subTabBtn, activeSection === 'general' && styles.subTabBtnActive]}
          onPress={() => setActiveSection('general')}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="domain"
            size={18}
            color={activeSection === 'general' ? '#0D9488' : '#64748B'}
          />
          <Text style={[styles.subTabBtnText, activeSection === 'general' && styles.subTabBtnTextActive]}>
            City & General Info
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.subTabBtn, activeSection === 'advisory' && styles.subTabBtnActive]}
          onPress={() => setActiveSection('advisory')}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="campaign"
            size={18}
            color={activeSection === 'advisory' ? '#DC2626' : '#64748B'}
          />
          <Text style={[styles.subTabBtnText, activeSection === 'advisory' && styles.subTabBtnTextActive]}>
            Emergency Advisory
          </Text>
          {activeBroadcast && (
            <View style={styles.liveAdvisoryBadge}>
              <Text style={styles.liveAdvisoryBadgeText}>LIVE</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {loadingInitial ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#0D9488" />
          <Text style={styles.loadingText}>Loading system settings...</Text>
        </View>
      ) : (
        <>
          {/* ==================================================== */}
          {/* SECTION 1: BRANDING & VISUAL IDENTITY */}
          {/* ==================================================== */}
          {activeSection === 'branding' && (
            <View style={styles.cardsGrid}>
              {/* CARD 1A: CENRO ENVIRONMENTAL SEAL */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.iconCircle, { backgroundColor: '#ECFDF5' }]}>
                    <MaterialIcons name="eco" size={20} color="#059669" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <Text style={styles.cardTitle}>CENRO Environmental Seal</Text>
                      <View style={[styles.agencyBadge, { backgroundColor: '#DCFCE7' }]}>
                        <Text style={[styles.agencyBadgeText, { color: '#047857' }]}>/cenro</Text>
                      </View>
                    </View>
                    <Text style={styles.cardSubtitle}>
                      Official logo displayed on the /cenro login portal, CENRO sidebar navigation, and dashboard top bar.
                    </Text>
                  </View>
                  {branding.cenroLogoUrl ? (
                    <View style={[styles.statusBadge, styles.statusBadgeActive]}>
                      <View style={styles.statusDotActive} />
                      <Text style={styles.statusTextActive}>Custom Active</Text>
                    </View>
                  ) : (
                    <View style={[styles.statusBadge, styles.statusBadgeDefault]}>
                      <View style={styles.statusDotDefault} />
                      <Text style={styles.statusTextDefault}>Default Seal</Text>
                    </View>
                  )}
                </View>

                {/* Recommended Specifications */}
                <View style={styles.specBox}>
                  <View style={styles.specRow}>
                    <MaterialIcons name="info-outline" size={15} color="#0284C7" />
                    <Text style={styles.specHeading}>Recommended Specifications (PNG or SVG):</Text>
                  </View>
                  <Text style={styles.specText}>
                    • Aspect Ratio: <Text style={styles.boldText}>1:1 (Square)</Text>, e.g., 512 × 512 px or higher{'\n'}
                    • Format: <Text style={styles.boldText}>PNG or SVG</Text> with transparent background{'\n'}
                    • Maximum file size: <Text style={styles.boldText}>5 MB</Text>
                  </Text>
                </View>

                {/* Live Preview Box */}
                <View style={styles.previewContainer}>
                  <Text style={styles.previewLabel}>CENRO LIVE PREVIEW (/cenro PORTAL & SIDEBAR)</Text>
                  <View style={styles.logoPreviewWrapper}>
                    <View style={[styles.logoPreviewBorder, { borderColor: '#86EFAC' }]}>
                      {(branding.cenroLogoUrl || branding.systemLogoUrl) ? (
                        <Image
                          source={{ uri: (branding.cenroLogoUrl || branding.systemLogoUrl)! }}
                          style={styles.logoImage}
                          resizeMode="contain"
                        />
                      ) : (
                        <View style={styles.defaultLogoPlaceholder}>
                          <MaterialIcons name="eco" size={44} color="#059669" />
                          <Text style={[styles.defaultLogoText, { color: '#047857' }]}>DANAO CENRO</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.logoDetailsCol}>
                      <Text style={styles.logoStatusTitle}>
                        {branding.cenroLogoUrl ? 'Custom CENRO Environmental Seal' : 'Official System Default Seal'}
                      </Text>
                      <Text style={styles.logoStatusSub}>
                        {branding.cenroLogoUrl
                          ? 'Active across CENRO login, top header bar, and sidebar navigation.'
                          : 'Default Danao City Eco Seal is currently displayed.'}
                      </Text>
                      {branding.cenroLogoUrl && branding.updatedByEmail && (
                        <Text style={styles.metaText}>
                          Last updated by: {branding.updatedByEmail}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[
                      styles.btnPrimary,
                      { backgroundColor: '#059669' },
                      loadingAction === 'upload-cenro-logo' && styles.btnDisabled,
                    ]}
                    onPress={() => handleUploadAgencyLogo('cenro')}
                    disabled={loadingAction !== null}
                    activeOpacity={0.8}
                  >
                    {loadingAction === 'upload-cenro-logo' ? (
                      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                    ) : (
                      <MaterialIcons name="cloud-upload" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                    )}
                    <Text style={styles.btnPrimaryText}>
                      {loadingAction === 'upload-cenro-logo' ? 'Uploading CENRO Logo...' : 'Upload CENRO Logo'}
                    </Text>
                  </TouchableOpacity>

                  {branding.cenroLogoUrl ? (
                    <>
                      <TouchableOpacity
                        style={styles.btnSecondary}
                        onPress={() =>
                          setCropModal({
                            visible: true,
                            imageUri: branding.cenroLogoUrl,
                            cropType: 'cenro-logo',
                          })
                        }
                        disabled={loadingAction !== null}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="crop" size={18} color="#059669" style={{ marginRight: 6 }} />
                        <Text style={[styles.btnSecondaryText, { color: '#059669', fontWeight: '700' }]}>
                          Adjust Crop
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.btnSecondary,
                          loadingAction === 'reset-cenro-logo' && styles.btnDisabled,
                        ]}
                        onPress={() => handleResetAgencyLogoConfirm('cenro')}
                        disabled={loadingAction !== null}
                        activeOpacity={0.8}
                      >
                        {loadingAction === 'reset-cenro-logo' ? (
                          <ActivityIndicator size="small" color="#475569" style={{ marginRight: 8 }} />
                        ) : (
                          <MaterialIcons name="restart-alt" size={18} color="#475569" style={{ marginRight: 8 }} />
                        )}
                        <Text style={styles.btnSecondaryText}>
                          {loadingAction === 'reset-cenro-logo' ? 'Resetting...' : 'Reset to Default'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>
              </View>

              {/* CARD 1B: CICTO TECHNOLOGY EMBLEM */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.iconCircle, { backgroundColor: '#F0FDFA' }]}>
                    <MaterialIcons name="security" size={20} color="#0D9488" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <Text style={styles.cardTitle}>CICTO Technology Emblem</Text>
                      <View style={[styles.agencyBadge, { backgroundColor: '#CCFBF1' }]}>
                        <Text style={[styles.agencyBadgeText, { color: '#0F766E' }]}>/cicto</Text>
                      </View>
                    </View>
                    <Text style={styles.cardSubtitle}>
                      Official logo displayed on the /cicto login portal, CICTO sidebar navigation, and IT oversight header.
                    </Text>
                  </View>
                  {branding.cictoLogoUrl ? (
                    <View style={[styles.statusBadge, styles.statusBadgeActive]}>
                      <View style={styles.statusDotActive} />
                      <Text style={styles.statusTextActive}>Custom Active</Text>
                    </View>
                  ) : (
                    <View style={[styles.statusBadge, styles.statusBadgeDefault]}>
                      <View style={styles.statusDotDefault} />
                      <Text style={styles.statusTextDefault}>Default Emblem</Text>
                    </View>
                  )}
                </View>

                {/* Recommended Specifications */}
                <View style={styles.specBox}>
                  <View style={styles.specRow}>
                    <MaterialIcons name="info-outline" size={15} color="#0284C7" />
                    <Text style={styles.specHeading}>Recommended Specifications (PNG or SVG):</Text>
                  </View>
                  <Text style={styles.specText}>
                    • Aspect Ratio: <Text style={styles.boldText}>1:1 (Square)</Text>, e.g., 512 × 512 px or higher{'\n'}
                    • Format: <Text style={styles.boldText}>PNG or SVG</Text> with transparent background{'\n'}
                    • Maximum file size: <Text style={styles.boldText}>5 MB</Text>
                  </Text>
                </View>

                {/* Live Preview Box */}
                <View style={styles.previewContainer}>
                  <Text style={styles.previewLabel}>CICTO LIVE PREVIEW (/cicto PORTAL & SIDEBAR)</Text>
                  <View style={styles.logoPreviewWrapper}>
                    <View style={[styles.logoPreviewBorder, { borderColor: '#5EEAD4' }]}>
                      {(branding.cictoLogoUrl || branding.systemLogoUrl) ? (
                        <Image
                          source={{ uri: (branding.cictoLogoUrl || branding.systemLogoUrl)! }}
                          style={styles.logoImage}
                          resizeMode="contain"
                        />
                      ) : (
                        <View style={styles.defaultLogoPlaceholder}>
                          <MaterialIcons name="security" size={44} color="#0D9488" />
                          <Text style={[styles.defaultLogoText, { color: '#0F766E' }]}>DANAO CICTO</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.logoDetailsCol}>
                      <Text style={styles.logoStatusTitle}>
                        {branding.cictoLogoUrl ? 'Custom CICTO Technology Emblem' : 'Official System Default Emblem'}
                      </Text>
                      <Text style={styles.logoStatusSub}>
                        {branding.cictoLogoUrl
                          ? 'Active across CICTO login, top header bar, and sidebar navigation.'
                          : 'Default Danao City ICT Security Emblem is currently displayed.'}
                      </Text>
                      {branding.cictoLogoUrl && branding.updatedByEmail && (
                        <Text style={styles.metaText}>
                          Last updated by: {branding.updatedByEmail}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[
                      styles.btnPrimary,
                      { backgroundColor: '#0D9488' },
                      loadingAction === 'upload-cicto-logo' && styles.btnDisabled,
                    ]}
                    onPress={() => handleUploadAgencyLogo('cicto')}
                    disabled={loadingAction !== null}
                    activeOpacity={0.8}
                  >
                    {loadingAction === 'upload-cicto-logo' ? (
                      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                    ) : (
                      <MaterialIcons name="cloud-upload" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                    )}
                    <Text style={styles.btnPrimaryText}>
                      {loadingAction === 'upload-cicto-logo' ? 'Uploading CICTO Logo...' : 'Upload CICTO Logo'}
                    </Text>
                  </TouchableOpacity>

                  {branding.cictoLogoUrl ? (
                    <>
                      <TouchableOpacity
                        style={styles.btnSecondary}
                        onPress={() =>
                          setCropModal({
                            visible: true,
                            imageUri: branding.cictoLogoUrl,
                            cropType: 'cicto-logo',
                          })
                        }
                        disabled={loadingAction !== null}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="crop" size={18} color="#0D9488" style={{ marginRight: 6 }} />
                        <Text style={[styles.btnSecondaryText, { color: '#0D9488', fontWeight: '700' }]}>
                          Adjust Crop
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.btnSecondary,
                          loadingAction === 'reset-cicto-logo' && styles.btnDisabled,
                        ]}
                        onPress={() => handleResetAgencyLogoConfirm('cicto')}
                        disabled={loadingAction !== null}
                        activeOpacity={0.8}
                      >
                        {loadingAction === 'reset-cicto-logo' ? (
                          <ActivityIndicator size="small" color="#475569" style={{ marginRight: 8 }} />
                        ) : (
                          <MaterialIcons name="restart-alt" size={18} color="#475569" style={{ marginRight: 8 }} />
                        )}
                        <Text style={styles.btnSecondaryText}>
                          {loadingAction === 'reset-cicto-logo' ? 'Resetting...' : 'Reset to Default'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>
              </View>

              {/* CARD 2: LANDING & PORTAL BACKGROUND */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.iconCircle}>
                    <MaterialIcons name="wallpaper" size={20} color="#0D9488" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>Web Landing & Portal Background</Text>
                    <Text style={styles.cardSubtitle}>
                      Displayed as the full-screen backdrop for CENRO (/cenro) and CICTO (/cicto) portals.
                    </Text>
                  </View>
                  {branding.landingBgUrl ? (
                    <View style={[styles.statusBadge, styles.statusBadgeActive]}>
                      <View style={styles.statusDotActive} />
                      <Text style={styles.statusTextActive}>Custom Active</Text>
                    </View>
                  ) : (
                    <View style={[styles.statusBadge, styles.statusBadgeDefault]}>
                      <View style={styles.statusDotDefault} />
                      <Text style={styles.statusTextDefault}>Default City View</Text>
                    </View>
                  )}
                </View>

                {/* Recommended Specifications */}
                <View style={styles.specBox}>
                  <View style={styles.specRow}>
                    <MaterialIcons name="info-outline" size={15} color="#0284C7" />
                    <Text style={styles.specHeading}>Recommended Image Specifications:</Text>
                  </View>
                  <Text style={styles.specText}>
                    • Aspect Ratio: <Text style={styles.boldText}>16:9 Landscape</Text> (e.g. 1920 × 1080 px or 2560 × 1440 px){'\n'}
                    • Format: <Text style={styles.boldText}>JPG, PNG, or WebP</Text> (High quality, clear resolution){'\n'}
                    • Maximum file size: <Text style={styles.boldText}>10 MB</Text>
                  </Text>
                </View>

                {/* Live Preview Box with Portal Overlay Mock */}
                <View style={styles.previewContainer}>
                  <Text style={styles.previewLabel}>LIVE PREVIEW (LOGIN PORTAL BACKDROP)</Text>
                  <View style={styles.bgPreviewFrame}>
                    <ImageBackground
                      source={
                        branding.landingBgUrl
                          ? { uri: branding.landingBgUrl }
                          : require('@/assets/images/admin_login_bg_professional.jpg')
                      }
                      style={styles.bgPreviewImage}
                      resizeMode="cover"
                    >
                      <View style={styles.bgDarkOverlay}>
                        <View style={styles.miniLoginCard}>
                          <View style={styles.miniLogoDot}>
                            <MaterialIcons name="security" size={14} color="#0D9488" />
                          </View>
                          <View style={styles.miniBarLong} />
                          <View style={styles.miniBarShort} />
                          <View style={styles.miniBtn} />
                        </View>
                      </View>
                    </ImageBackground>
                  </View>
                  <View style={styles.bgMetaRow}>
                    <Text style={styles.bgMetaText}>
                      {branding.landingBgUrl
                        ? 'Custom high-resolution photo active for web visitors.'
                        : 'Default city hall landscape backdrop active.'}
                    </Text>
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[
                      styles.btnPrimary,
                      loadingAction === 'upload-bg' && styles.btnDisabled,
                    ]}
                    onPress={handleUploadBg}
                    disabled={loadingAction !== null}
                    activeOpacity={0.8}
                  >
                    {loadingAction === 'upload-bg' ? (
                      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                    ) : (
                      <MaterialIcons name="cloud-upload" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                    )}
                    <Text style={styles.btnPrimaryText}>
                      {loadingAction === 'upload-bg' ? 'Uploading Backdrop...' : 'Upload New Background'}
                    </Text>
                  </TouchableOpacity>

                  {branding.landingBgUrl ? (
                    <>
                      <TouchableOpacity
                        style={styles.btnSecondary}
                        onPress={() =>
                          setCropModal({
                            visible: true,
                            imageUri: branding.landingBgUrl,
                            cropType: 'background',
                          })
                        }
                        disabled={loadingAction !== null}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="crop" size={18} color="#047857" style={{ marginRight: 6 }} />
                        <Text style={[styles.btnSecondaryText, { color: '#047857', fontWeight: '700' }]}>
                          Adjust Crop
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.btnSecondary,
                          loadingAction === 'reset-bg' && styles.btnDisabled,
                        ]}
                        onPress={handleResetBgConfirm}
                        disabled={loadingAction !== null}
                        activeOpacity={0.8}
                      >
                        {loadingAction === 'reset-bg' ? (
                          <ActivityIndicator size="small" color="#475569" style={{ marginRight: 8 }} />
                        ) : (
                          <MaterialIcons name="restart-alt" size={18} color="#475569" style={{ marginRight: 8 }} />
                        )}
                        <Text style={styles.btnSecondaryText}>
                          {loadingAction === 'reset-bg' ? 'Resetting...' : 'Reset to Default'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>
              </View>
            </View>
          )}

          {/* ==================================================== */}
          {/* SECTION 2: MUNICIPAL & GENERAL INFORMATION */}
          {/* ==================================================== */}
          {activeSection === 'general' && (
            <View style={styles.cardsGrid}>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.iconCircle}>
                    <MaterialIcons name="domain" size={20} color="#0D9488" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>Municipal Agency & Contact Details</Text>
                    <Text style={styles.cardSubtitle}>
                      Official details displayed across the resident mobile app, report PDFs, and public help links.
                    </Text>
                  </View>
                </View>

                {/* Form Fields */}
                <View style={styles.formContainer}>
                  <View style={styles.formGroup}>
                    <Text style={styles.inputLabel}>OFFICIAL SYSTEM TITLE</Text>
                    <TextInput
                      style={styles.textInput}
                      value={systemTitle}
                      onChangeText={setSystemTitle}
                      placeholder="e.g. City of Danao — Solid Waste Management & Telemetry System"
                      placeholderTextColor="#94A3B8"
                    />
                    <Text style={styles.inputHint}>Displayed on portal banners and generated service certificates.</Text>
                  </View>

                  <View style={styles.formRow}>
                    <View style={[styles.formGroup, { flex: 1, minWidth: 240 }]}>
                      <Text style={styles.inputLabel}>OFFICIAL HELPDESK EMAIL</Text>
                      <TextInput
                        style={styles.textInput}
                        value={supportEmail}
                        onChangeText={setSupportEmail}
                        placeholder="e.g. cicto@danao.gov.ph"
                        placeholderTextColor="#94A3B8"
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>

                    <View style={[styles.formGroup, { flex: 1, minWidth: 240 }]}>
                      <Text style={styles.inputLabel}>CITIZEN HOTLINE PHONE</Text>
                      <TextInput
                        style={styles.textInput}
                        value={supportPhone}
                        onChangeText={setSupportPhone}
                        placeholder="e.g. (032) 200-3000"
                        placeholderTextColor="#94A3B8"
                        keyboardType="phone-pad"
                      />
                    </View>
                  </View>

                  <View style={styles.formGroup}>
                    <Text style={styles.inputLabel}>OFFICIAL OFFICE / HEADQUARTERS ADDRESS</Text>
                    <TextInput
                      style={styles.textInput}
                      value={officeAddress}
                      onChangeText={setOfficeAddress}
                      placeholder="e.g. Danao City Hall, F. Ralota St, Poblacion, Danao City, Cebu"
                      placeholderTextColor="#94A3B8"
                    />
                  </View>

                  <View style={styles.formGroup}>
                    <Text style={styles.inputLabel}>STANDARD OPERATING HOURS</Text>
                    <TextInput
                      style={styles.textInput}
                      value={operatingHours}
                      onChangeText={setOperatingHours}
                      placeholder="e.g. Monday – Saturday: 5:00 AM – 8:00 PM"
                      placeholderTextColor="#94A3B8"
                    />
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[
                      styles.btnPrimary,
                      loadingAction === 'save-general' && styles.btnDisabled,
                    ]}
                    onPress={handleSaveGeneralInfo}
                    disabled={loadingAction !== null}
                    activeOpacity={0.8}
                  >
                    {loadingAction === 'save-general' ? (
                      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                    ) : (
                      <MaterialIcons name="save" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                    )}
                    <Text style={styles.btnPrimaryText}>
                      {loadingAction === 'save-general' ? 'Saving Details...' : 'Save Municipal Information'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.btnSecondary,
                      loadingAction === 'reset-general' && styles.btnDisabled,
                    ]}
                    onPress={handleResetGeneralConfirm}
                    disabled={loadingAction !== null}
                    activeOpacity={0.8}
                  >
                    {loadingAction === 'reset-general' ? (
                      <ActivityIndicator size="small" color="#475569" style={{ marginRight: 8 }} />
                    ) : (
                      <MaterialIcons name="restart-alt" size={18} color="#475569" style={{ marginRight: 8 }} />
                    )}
                    <Text style={styles.btnSecondaryText}>
                      {loadingAction === 'reset-general' ? 'Restoring...' : 'Reset to Defaults'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* ==================================================== */}
          {/* SECTION 3: PUBLIC EMERGENCY ADVISORY BANNER */}
          {/* ==================================================== */}
          {activeSection === 'advisory' && (
            <View style={styles.cardsGrid}>
              {/* Active Broadcast Alert Card (if broadcasting) */}
              {activeBroadcast ? (
                <View style={[styles.card, styles.cardAdvisoryActive]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconCircle, styles.iconCircleUrgent]}>
                      <MaterialIcons name="warning" size={22} color="#DC2626" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={styles.cardTitle}>Active City-Wide Advisory</Text>
                        <View style={styles.pulsingLivePill}>
                          <View style={styles.pulsingDot} />
                          <Text style={styles.pulsingLiveText}>TRANSMITTING LIVE</Text>
                        </View>
                      </View>
                      <Text style={styles.cardSubtitle}>
                        This bulletin is currently displayed on all citizen mobile app headers, driver navigation screens, and inter-agency portals.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.broadcastDetailsBox}>
                    <View style={styles.broadcastMetaRow}>
                      <View
                        style={[
                          styles.priorityChip,
                          activeBroadcast.priority === 'urgent'
                            ? styles.priorityChipUrgent
                            : styles.priorityChipHigh,
                        ]}
                      >
                        <Text
                          style={[
                            styles.priorityChipText,
                            activeBroadcast.priority === 'urgent'
                              ? styles.priorityChipTextUrgent
                              : styles.priorityChipTextHigh,
                          ]}
                        >
                          {activeBroadcast.priority.toUpperCase()} PRIORITY
                        </Text>
                      </View>
                      <Text style={styles.broadcastSenderText}>
                        Transmitted by: {activeBroadcast.senderName || activeBroadcast.senderEmail}
                      </Text>
                    </View>

                    <Text style={styles.broadcastSubjectText}>{activeBroadcast.subject}</Text>
                    <Text style={styles.broadcastMessageText}>{activeBroadcast.message}</Text>
                  </View>

                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      style={[
                        styles.btnDanger,
                        loadingAction === 'clear-broadcast' && styles.btnDisabled,
                      ]}
                      onPress={handleClearBroadcastConfirm}
                      disabled={loadingAction !== null}
                      activeOpacity={0.8}
                    >
                      {loadingAction === 'clear-broadcast' ? (
                        <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                      ) : (
                        <MaterialIcons name="cancel" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                      )}
                      <Text style={styles.btnDangerText}>
                        {loadingAction === 'clear-broadcast' ? 'Withdrawing...' : 'Withdraw & Conclude Broadcast'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {/* Broadcast Composer Card */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.iconCircle}>
                    <MaterialIcons name="campaign" size={22} color="#0D9488" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>
                      {activeBroadcast ? 'Replace Advisory Directive' : 'Transmit Public Advisory Directive'}
                    </Text>
                    <Text style={styles.cardSubtitle}>
                      Issue official alerts to residents and field drivers regarding extreme weather, route blockages, or emergency suspensions.
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, styles.statusBadgeDefault]}>
                    <MaterialIcons name="sensors" size={14} color="#64748B" />
                    <Text style={styles.statusTextDefault}>
                      {activeBroadcast ? 'Channel In Use' : 'Channel Ready'}
                    </Text>
                  </View>
                </View>

                <View style={styles.formContainer}>
                  {/* Priority Selector */}
                  <View style={styles.formGroup}>
                    <Text style={styles.inputLabel}>ADVISORY PRIORITY LEVEL</Text>
                    <View style={styles.prioritySelectorRow}>
                      <TouchableOpacity
                        style={[
                          styles.priorityOption,
                          broadcastPriority === 'urgent' && styles.priorityOptionUrgentActive,
                        ]}
                        onPress={() => setBroadcastPriority('urgent')}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons
                          name="crisis-alert"
                          size={18}
                          color={broadcastPriority === 'urgent' ? '#DC2626' : '#64748B'}
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.priorityOptionTitle,
                              broadcastPriority === 'urgent' && { color: '#DC2626' },
                            ]}
                          >
                            URGENT HAZARD
                          </Text>
                          <Text style={styles.priorityOptionSub}>
                            Severe weather, flash floods, or mandatory operations halt.
                          </Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.priorityOption,
                          broadcastPriority === 'high' && styles.priorityOptionHighActive,
                        ]}
                        onPress={() => setBroadcastPriority('high')}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons
                          name="info"
                          size={18}
                          color={broadcastPriority === 'high' ? '#D97706' : '#64748B'}
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.priorityOptionTitle,
                              broadcastPriority === 'high' && { color: '#D97706' },
                            ]}
                          >
                            IMPORTANT NOTICE
                          </Text>
                          <Text style={styles.priorityOptionSub}>
                            Festival rerouting, holiday collection, or maintenance advisory.
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.formGroup}>
                    <Text style={styles.inputLabel}>ADVISORY SUBJECT</Text>
                    <TextInput
                      style={styles.textInput}
                      value={broadcastSubject}
                      onChangeText={setBroadcastSubject}
                      placeholder="e.g. Typhoon Warning: Fleet Collection Suspended"
                      placeholderTextColor="#94A3B8"
                    />
                  </View>

                  <View style={styles.formGroup}>
                    <Text style={styles.inputLabel}>DIRECTIVE & INSTRUCTIONS MESSAGE</Text>
                    <TextInput
                      style={[styles.textInput, styles.textAreaInput]}
                      value={broadcastMessage}
                      onChangeText={setBroadcastMessage}
                      placeholder="Enter detailed instructions for residents (e.g. secure trash bags indoors until collection resumes) and drivers (e.g. pull into safe depot)..."
                      placeholderTextColor="#94A3B8"
                      multiline
                      numberOfLines={4}
                      textAlignVertical="top"
                    />
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[
                      styles.btnDanger,
                      loadingAction === 'transmit-broadcast' && styles.btnDisabled,
                    ]}
                    onPress={handleTransmitBroadcast}
                    disabled={loadingAction !== null}
                    activeOpacity={0.8}
                  >
                    {loadingAction === 'transmit-broadcast' ? (
                      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                    ) : (
                      <MaterialIcons name="send" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                    )}
                    <Text style={styles.btnDangerText}>
                      {loadingAction === 'transmit-broadcast'
                        ? 'Transmitting Broadcast...'
                        : 'Broadcast City-Wide Advisory'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </>
      )}

      {/* ==================================================== */}
      {/* ACKNOWLEDGMENT MODAL */}
      {/* ==================================================== */}
      <Modal
        visible={ackModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setAckModal((prev) => ({ ...prev, visible: false }))}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View
              style={[
                styles.modalIconCircle,
                ackModal.type === 'success'
                  ? styles.modalIconSuccess
                  : ackModal.type === 'error'
                  ? styles.modalIconError
                  : styles.modalIconInfo,
              ]}
            >
              <MaterialIcons
                name={
                  ackModal.type === 'success'
                    ? 'check-circle'
                    : ackModal.type === 'error'
                    ? 'error-outline'
                    : 'info'
                }
                size={34}
                color={
                  ackModal.type === 'success'
                    ? '#059669'
                    : ackModal.type === 'error'
                    ? '#DC2626'
                    : '#0284C7'
                }
              />
            </View>

            <Text style={styles.modalTitle}>{ackModal.title}</Text>
            <Text style={styles.modalMessage}>{ackModal.message}</Text>

            <TouchableOpacity
              style={styles.modalAckBtn}
              onPress={() => setAckModal((prev) => ({ ...prev, visible: false }))}
              activeOpacity={0.85}
            >
              <Text style={styles.modalAckBtnText}>Acknowledge & Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ==================================================== */}
      {/* CONFIRMATION MODAL */}
      {/* ==================================================== */}
      <Modal
        visible={confirmModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModal((prev) => ({ ...prev, visible: false }))}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={[styles.modalIconCircle, styles.modalIconWarning]}>
              <MaterialIcons name="help-outline" size={34} color="#D97706" />
            </View>

            <Text style={styles.modalTitle}>{confirmModal.title}</Text>
            <Text style={styles.modalMessage}>{confirmModal.message}</Text>

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setConfirmModal((prev) => ({ ...prev, visible: false }))}
                activeOpacity={0.85}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalConfirmBtn,
                  confirmModal.confirmColor
                    ? { backgroundColor: confirmModal.confirmColor }
                    : null,
                ]}
                onPress={confirmModal.onConfirm}
                activeOpacity={0.85}
              >
                <Text style={styles.modalConfirmBtnText}>
                  {confirmModal.confirmText || 'Confirm'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* ==================================================== */}
      {/* INTERACTIVE IMAGE CROP MODAL */}
      {/* ==================================================== */}
      <ImageCropModal
        visible={cropModal.visible}
        imageUri={cropModal.imageUri}
        cropType={cropModal.cropType}
        onClose={() => setCropModal((prev) => ({ ...prev, visible: false }))}
        onApplyCrop={handleApplyCroppedImage}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 28,
    paddingBottom: 60,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  headerTextGroup: {
    flex: 1,
    minWidth: 280,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '900',
    color: '#0D9488',
    letterSpacing: 1.1,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 5,
  },
  sub: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 5,
    lineHeight: 18,
  },
  badgeAuthority: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  badgeAuthorityText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
  },
  subTabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 12,
    flexWrap: 'wrap',
  },
  subTabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  subTabBtnActive: {
    backgroundColor: '#F0FDFA',
    borderColor: '#0D9488',
  },
  subTabBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#64748B',
  },
  subTabBtnTextActive: {
    color: '#0D9488',
    fontWeight: '800',
  },
  liveAdvisoryBadge: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 2,
  },
  liveAdvisoryBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 10,
    fontWeight: '600',
  },
  cardsGrid: {
    gap: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardAdvisoryActive: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FFF8F8',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleUrgent: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusBadgeActive: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  statusBadgeDefault: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusDotActive: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  statusDotDefault: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#94A3B8',
  },
  statusTextActive: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065F46',
  },
  statusTextDefault: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  specBox: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  specRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  specHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0369A1',
  },
  specText: {
    fontSize: 11,
    color: '#0C4A6E',
    lineHeight: 18,
  },
  boldText: {
    fontWeight: '800',
  },
  previewContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 20,
  },
  previewLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  agencyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  agencyBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  logoPreviewWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    flexWrap: 'wrap',
  },
  logoPreviewBorder: {
    width: 96,
    height: 96,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: '88%',
    height: '88%',
  },
  defaultLogoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultLogoText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#059669',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  logoDetailsCol: {
    flex: 1,
    minWidth: 200,
  },
  logoStatusTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  logoStatusSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 17,
  },
  metaText: {
    fontSize: 11,
    color: '#0D9488',
    fontWeight: '600',
    marginTop: 6,
  },
  bgPreviewFrame: {
    width: '100%',
    height: 190,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#0F172A',
  },
  bgPreviewImage: {
    width: '100%',
    height: '100%',
  },
  bgDarkOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniLoginCard: {
    width: 140,
    height: 100,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  miniLogoDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F0FDFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniBarLong: {
    width: '80%',
    height: 5,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
  },
  miniBarShort: {
    width: '55%',
    height: 5,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
  },
  miniBtn: {
    width: '70%',
    height: 10,
    backgroundColor: '#0D9488',
    borderRadius: 4,
    marginTop: 2,
  },
  bgMetaRow: {
    marginTop: 10,
  },
  bgMetaText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  // Form Styles for General & Advisory
  formContainer: {
    gap: 16,
    marginBottom: 20,
  },
  formGroup: {
    gap: 6,
  },
  formRow: {
    flexDirection: 'row',
    gap: 14,
    flexWrap: 'wrap',
  },
  inputLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.6,
  },
  inputHint: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
  },
  textAreaInput: {
    minHeight: 90,
  },
  // Priority Selector
  prioritySelectorRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  priorityOption: {
    flex: 1,
    minWidth: 200,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  priorityOptionUrgentActive: {
    borderColor: '#DC2626',
    backgroundColor: '#FEF2F2',
  },
  priorityOptionHighActive: {
    borderColor: '#D97706',
    backgroundColor: '#FFFBEB',
  },
  priorityOptionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  priorityOptionSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },
  // Active Broadcast Display Box
  broadcastDetailsBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 18,
    gap: 8,
  },
  broadcastMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  priorityChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priorityChipUrgent: {
    backgroundColor: '#FEE2E2',
  },
  priorityChipHigh: {
    backgroundColor: '#FEF3C7',
  },
  priorityChipText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  priorityChipTextUrgent: {
    color: '#B91C1C',
  },
  priorityChipTextHigh: {
    color: '#B45309',
  },
  broadcastSenderText: {
    fontSize: 11,
    color: '#64748B',
  },
  broadcastSubjectText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 2,
  },
  broadcastMessageText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
  },
  pulsingLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#DC2626',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  pulsingLiveText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  // Buttons
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D9488',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 9,
    minHeight: 40,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  btnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 9,
    minHeight: 40,
  },
  btnSecondaryText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  btnDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DC2626',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 9,
    minHeight: 40,
  },
  btnDangerText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  btnDisabled: {
    opacity: 0.65,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  modalIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalIconSuccess: {
    backgroundColor: '#ECFDF5',
  },
  modalIconError: {
    backgroundColor: '#FEF2F2',
  },
  modalIconInfo: {
    backgroundColor: '#F0F9FF',
  },
  modalIconWarning: {
    backgroundColor: '#FEF3C7',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  modalAckBtn: {
    width: '100%',
    backgroundColor: '#0D9488',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalAckBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  modalConfirmBtn: {
    flex: 1,
    backgroundColor: '#DC2626',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalConfirmBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});
