import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import {
  SystemBrandingSettings,
  subscribeToSystemBranding,
} from '../../services/systemBrandingService';

interface AgencySignProps {
  type: 'cenro' | 'cicto';
  size?: 'small' | 'medium' | 'large';
  customLogoUrl?: string | null;
}

export default function AgencySign({
  type,
  size = 'medium',
  customLogoUrl,
}: AgencySignProps) {
  const isCenro = type === 'cenro';
  const isSmall = size === 'small';
  const isLarge = size === 'large';

  const [branding, setBranding] = useState<SystemBrandingSettings>({
    systemLogoUrl: null,
  });

  useEffect(() => {
    if (customLogoUrl !== undefined) return;
    const unsub = subscribeToSystemBranding((updated) => {
      setBranding(updated);
    });
    return () => unsub();
  }, [customLogoUrl]);

  const activeLogoUrl =
    customLogoUrl !== undefined
      ? customLogoUrl
      : isCenro
      ? (branding.cenroLogoUrl ?? branding.systemLogoUrl ?? null)
      : (branding.cictoLogoUrl ?? branding.systemLogoUrl ?? null);

  const badgeDimension = isSmall ? 52 : isLarge ? 76 : 64;
  const iconSize = isSmall ? 24 : isLarge ? 36 : 30;

  return (
    <View style={styles.container}>
      {/* Minimalist Agency Seal Container */}
      <View
        style={[
          styles.badgeOuter,
          isCenro ? styles.cenroBadgeOuter : styles.cictoBadgeOuter,
          { width: badgeDimension, height: badgeDimension, borderRadius: badgeDimension / 2 },
        ]}
      >
        <View
          style={[
            styles.badgeInner,
            isCenro ? styles.cenroBadgeInner : styles.cictoBadgeInner,
            { width: badgeDimension - 8, height: badgeDimension - 8, borderRadius: (badgeDimension - 8) / 2 },
          ]}
        >
          {activeLogoUrl ? (
            <Image
              source={{ uri: activeLogoUrl }}
              style={{
                width: badgeDimension - 14,
                height: badgeDimension - 14,
                borderRadius: (badgeDimension - 14) / 2,
              }}
              resizeMode="contain"
            />
          ) : (
            <MaterialIcons
              name={isCenro ? 'eco' : 'admin-panel-settings'}
              size={iconSize}
              color={isCenro ? '#065F46' : '#0F766E'}
            />
          )}
        </View>

        {/* Official Verification Checkmark Badge */}
        <View
          style={[
            styles.statusDot,
            isCenro ? styles.cenroStatusDot : styles.cictoStatusDot,
          ]}
        >
          <MaterialIcons name="verified" size={13} color="#FFFFFF" />
        </View>
      </View>

      {/* Official Sign Metadata */}
      <View style={styles.textContainer}>
        <View style={styles.agencyRow}>
          <Text style={[styles.agencyCode, isCenro ? styles.cenroText : styles.cictoText]}>
            {isCenro ? 'CENRO • DANAO' : 'CICTO • DANAO'}
          </Text>
          <View style={[styles.pillBadge, isCenro ? styles.cenroPill : styles.cictoPill]}>
            <Text style={[styles.pillText, isCenro ? styles.cenroPillText : styles.cictoPillText]}>
              {isCenro ? 'LGU OFFICIAL' : 'CICTO OFFICIAL'}
            </Text>
          </View>
        </View>
        <Text style={styles.agencySub} numberOfLines={1}>
          {isCenro
            ? 'City Environment & Natural Resources Office'
            : 'City Information & Communications Technology Office'}
        </Text>
        <Text style={styles.agencyJurisdiction}>
          {isCenro ? 'Danao City, Cebu • Solid Waste Logistics' : 'Republic of the Philippines • Danao City IT Governance'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
    paddingVertical: 6,
  },
  badgeOuter: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    position: 'relative',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  cenroBadgeOuter: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  cictoBadgeOuter: {
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
  },
  badgeInner: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    overflow: 'hidden',
  },
  cenroBadgeInner: {
    backgroundColor: '#D1FAE5',
    borderColor: '#34D399',
  },
  cictoBadgeInner: {
    backgroundColor: '#CCFBF1',
    borderColor: '#2DD4BF',
  },
  statusDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  cenroStatusDot: {
    backgroundColor: '#059669',
  },
  cictoStatusDot: {
    backgroundColor: '#0D9488',
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  agencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  agencyCode: {
    fontSize: 12.5,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cenroText: {
    color: '#065F46',
  },
  cictoText: {
    color: '#115E59',
  },
  pillBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  cenroPill: {
    backgroundColor: '#D1FAE5',
  },
  cictoPill: {
    backgroundColor: '#CCFBF1',
  },
  pillText: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cenroPillText: {
    color: '#047857',
  },
  cictoPillText: {
    color: '#0F766E',
  },
  agencySub: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#334155',
    marginTop: 1,
  },
  agencyJurisdiction: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
});
