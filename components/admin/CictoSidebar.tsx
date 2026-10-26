import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SystemBrandingSettings,
  subscribeToSystemBranding,
} from '../../services/systemBrandingService';

export type CictoTabType =
  | 'dashboard'
  | 'identity-access'
  | 'fleet-ops'
  | 'cenro-command'
  | 'helpdesk'
  | 'data-mgmt'
  | 'rewards'
  | 'system-settings'
  | 'activity-logs';

export interface CictoSidebarProps {
  activeTab: CictoTabType | string;
  onSelectTab?: (tab: CictoTabType) => void;
  onTabChange?: (tab: any) => void;
  onLogout: () => void;
  collapsed?: boolean;
}

interface NavigationGroup {
  title: string;
  items: {
    id: CictoTabType;
    label: string;
    icon: keyof typeof MaterialIcons.glyphMap;
  }[];
}

const navigationGroups: NavigationGroup[] = [
  {
    title: 'SYSTEM OVERSIGHT',
    items: [
      { id: 'dashboard', label: 'EXECUTIVE DASHBOARD', icon: 'grid-view' },
      { id: 'identity-access', label: 'USER GOVERNANCE', icon: 'people' },
      { id: 'fleet-ops', label: 'FLEET TELEMETRY', icon: 'local-shipping' },
      { id: 'cenro-command', label: 'INTER-AGENCY CHATS', icon: 'forum' },
      { id: 'helpdesk', label: 'IT HELPDESK TICKETS', icon: 'support-agent' },
    ],
  },
  {
    title: 'GOVERNANCE & AUDIT',
    items: [
      { id: 'data-mgmt', label: 'DATA GOVERNANCE', icon: 'storage' },
      { id: 'rewards', label: 'REWARDS & RECOGNITION', icon: 'stars' },
      { id: 'activity-logs', label: 'AUDIT TRAIL', icon: 'receipt-long' },
    ],
  },
];

export default function CictoSidebar({
  activeTab,
  onSelectTab,
  onTabChange,
  onLogout,
  collapsed = false,
}: CictoSidebarProps) {
  const [openTicketsCount, setOpenTicketsCount] = useState(0);
  const [branding, setBranding] = useState<SystemBrandingSettings>({
    systemLogoUrl: null,
  });

  useEffect(() => {
    const unsub = subscribeToSystemBranding((updated) => {
      setBranding(updated);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!db) return;
    try {
      const q = query(collection(db, 'support_tickets'), where('status', '==', 'open'));
      const unsub = onSnapshot(
        q,
        (snap) => {
          setOpenTicketsCount(snap.size);
        },
        (err) => {
          console.warn('CictoSidebar: tickets count error', err);
        }
      );
      return () => unsub();
    } catch {
      // ignore
    }
  }, []);

  const handleSelectTab = (id: CictoTabType) => {
    if (onSelectTab) onSelectTab(id);
    else if (onTabChange) onTabChange(id);
  };

  const isSettingsActive = activeTab === 'system-settings' || activeTab === 'settings' || activeTab === 'branding';

  return (
    <View style={[styles.sidebar, collapsed && styles.sidebarCollapsed]}>
      {/* Top Header Logo / Agency Info */}
      {collapsed ? (
        <View style={styles.headerCollapsed}>
          <View style={styles.logoWrapCollapsed}>
            {(branding.cictoLogoUrl || branding.systemLogoUrl) ? (
              <Image
                source={{ uri: (branding.cictoLogoUrl || branding.systemLogoUrl)! }}
                style={styles.logoImageCollapsed}
                resizeMode="contain"
              />
            ) : (
              <MaterialIcons name="security" size={20} color="#047857" />
            )}
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.headerRow}>
            {(branding.cictoLogoUrl || branding.systemLogoUrl) ? (
              <Image
                source={{ uri: (branding.cictoLogoUrl || branding.systemLogoUrl)! }}
                style={styles.headerLogoImage}
                resizeMode="contain"
              />
            ) : null}
            <View style={styles.headerTitleCol}>
              <Text style={styles.headerTitle}>CICTO IT Command</Text>
              <View style={styles.badgeMini}>
                <MaterialIcons name="security" size={11} color="#047857" />
                <Text style={styles.badgeMiniText} numberOfLines={1}>
                  Danao City IT Authority
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Navigation Sections */}
      <ScrollView
        style={styles.navigation}
        contentContainerStyle={styles.navigationContent}
        showsVerticalScrollIndicator={false}
      >
        {navigationGroups.map((group, groupIndex) => {
          const hasActiveChild = group.items.some((item) => item.id === activeTab);

          return (
            <View
              key={group.title}
              style={[
                styles.navGroupCard,
                groupIndex > 0 && { marginTop: 8 },
              ]}
            >
              {!collapsed && (
                <View style={styles.navGroupHeader}>
                  <Text
                    style={[
                      styles.navGroupTitle,
                      hasActiveChild && styles.navGroupTitleActive,
                    ]}
                  >
                    {group.title}
                  </Text>
                </View>
              )}

              <View style={styles.navGroupItems}>
                {group.items.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.navItem,
                        isActive && styles.activeNavItem,
                        collapsed && styles.navItemCollapsed,
                      ]}
                      onPress={() => handleSelectTab(item.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.navItemLeft}>
                        <View
                          style={[
                            styles.iconContainer,
                            isActive && styles.activeIconContainer,
                          ]}
                        >
                          <MaterialIcons
                            name={item.icon}
                            size={18}
                            color={isActive ? '#FFFFFF' : '#4B5563'}
                          />
                        </View>
                        {!collapsed && (
                          <Text
                            style={[
                              styles.navLabel,
                              isActive && styles.activeNavLabel,
                            ]}
                            numberOfLines={1}
                          >
                            {item.label}
                          </Text>
                        )}
                      </View>

                      {/* Ticket notification badge for helpdesk */}
                      {item.id === 'helpdesk' && openTicketsCount > 0 && (
                        <>
                          {!collapsed ? (
                            <View
                              style={[
                                styles.badgeCount,
                                isActive && styles.badgeCountActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.badgeCountText,
                                  isActive && styles.badgeCountTextActive,
                                ]}
                              >
                                {openTicketsCount > 99 ? '99+' : openTicketsCount}
                              </Text>
                            </View>
                          ) : (
                            <View style={styles.collapsedBadgeDot} />
                          )}
                        </>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Footer / System Settings & Sign Out */}
      <View style={[styles.bottomSection, collapsed && styles.bottomSectionCollapsed]}>
        <TouchableOpacity
          style={[
            styles.settingsBtn,
            isSettingsActive && styles.settingsBtnActive,
            collapsed && styles.settingsBtnCollapsed,
          ]}
          onPress={() => handleSelectTab('system-settings')}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name="settings"
            size={18}
            color={isSettingsActive ? '#FFFFFF' : '#4B5563'}
          />
          {!collapsed && (
            <Text
              style={[
                styles.settingsText,
                isSettingsActive && styles.settingsTextActive,
              ]}
              numberOfLines={1}
            >
              SYSTEM SETTINGS
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.logoutBtn, collapsed && styles.logoutBtnCollapsed]}
          onPress={onLogout}
          activeOpacity={0.7}
        >
          <MaterialIcons name="logout" size={17} color="#DC2626" />
          {!collapsed && <Text style={styles.logoutText}>Sign Out</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 256,
    backgroundColor: '#F3F4F6',
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
    justifyContent: 'space-between',
  },
  sidebarCollapsed: {
    width: 64,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    marginBottom: 4,
  },
  headerCollapsed: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  logoWrapCollapsed: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  logoImageCollapsed: {
    width: 28,
    height: 28,
  },
  headerLogoImage: {
    width: 34,
    height: 34,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleCol: {
    flex: 1,
    paddingRight: 8,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1F2937',
    letterSpacing: 0.2,
  },
  badgeMini: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#DCFCE7',
    borderColor: '#BBF7D0',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 4,
    gap: 4,
  },
  badgeMiniText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
  },
  navigation: {
    flex: 1,
    paddingHorizontal: 10,
    ...(Platform.OS === 'web'
      ? {
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }
      : {}),
  },
  navigationContent: {
    paddingVertical: 6,
  },
  navGroupCard: {
    borderRadius: 8,
  },
  navGroupHeader: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 6,
  },
  navGroupTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.6,
  },
  navGroupTitleActive: {
    color: '#1B4D3E',
  },
  navGroupItems: {
    gap: 2,
    marginTop: 2,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 7,
  },
  activeNavItem: {
    backgroundColor: '#1B4D3E',
  },
  navItemCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    height: 42,
  },
  navItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconContainer: {
    width: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeIconContainer: {},
  navLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
    letterSpacing: 0.2,
    flex: 1,
  },
  activeNavLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  badgeCount: {
    backgroundColor: '#F59E0B',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
  },
  badgeCountActive: {
    backgroundColor: '#FFFFFF',
  },
  badgeCountText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  badgeCountTextActive: {
    color: '#1B4D3E',
  },
  collapsedBadgeDot: {
    position: 'absolute',
    top: 6,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  bottomSection: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#F3F4F6',
    gap: 4,
  },
  bottomSectionCollapsed: {
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 6,
  },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 7,
    gap: 10,
  },
  settingsBtnActive: {
    backgroundColor: '#1B4D3E',
  },
  settingsBtnCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    width: 44,
    height: 42,
  },
  settingsText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
    letterSpacing: 0.2,
    flex: 1,
  },
  settingsTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 7,
    gap: 8,
  },
  logoutBtnCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    width: 44,
  },
  logoutText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
    letterSpacing: 0.3,
  },
});
