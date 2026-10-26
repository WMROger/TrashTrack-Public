import { useAuthContext } from '@/components/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { auth } from '@/config/firebase';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Image, ScrollView, StatusBar, StyleSheet, Switch, Text, TouchableOpacity, View, Modal, Pressable } from 'react-native';

export default function DriverProfileSettings() {
  const router = useRouter();
  const { user } = useAuthContext();
  const { theme, setTheme } = useTheme();
  const isDarkMode = theme === 'dark';
  const [isHelpModalVisible, setIsHelpModalVisible] = useState(false);
  const [isAboutModalVisible, setIsAboutModalVisible] = useState(false);

  const handleLogout = async () => {
    try {
      await auth.signOut();
      router.replace('/auth');
    } catch (error) {
      console.error('Logout error', error);
    }
  };

  return (
    <>
      <ScrollView style={[styles.container, isDarkMode && styles.containerDark]} showsVerticalScrollIndicator={false}>
        <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={isDarkMode ? "#111827" : "#F9FAFB"} />
        
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Feather name="arrow-left" size={24} color={isDarkMode ? "#F9FAFB" : "#1F2937"} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, isDarkMode && styles.textLight]}>Settings</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Profile Card */}
        <View style={styles.profileCard}>
          {user?.photoURL ? (
            <Image source={{ uri: user.photoURL }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#DDE9DF' }]}>
              <Feather name="user" size={38} color="#3B5241" />
            </View>
          )}
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user?.displayName || 'Driver Account'}</Text>
            <Text style={styles.profileHandle}>{user?.email || ''}</Text>
          </View>
          <TouchableOpacity 
            style={styles.editButton} 
            onPress={() => router.push('/(driver)/edit-profile')}
          >
            <Feather name="edit-2" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Main Menu */}
        <View style={[styles.menuSection, isDarkMode && styles.menuSectionDark]}>
          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/(driver)/diesel-log' as any)}>
            <View style={styles.menuIconContainer}><Feather name="file-text" size={18} color="#166534" /></View>
            <View style={styles.menuTextContainer}><Text style={[styles.menuTitle, isDarkMode && styles.textLight]}>Trip & Diesel Log</Text>
              <Text style={styles.menuSubtitle}>Enter distance and consumption after your shift</Text></View>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.menuItem} 
            onPress={() => router.push('/(driver)/edit-profile')}
          >
            <View style={[styles.menuIconContainer, isDarkMode && styles.menuIconContainerDark]}>
              <Feather name="user" size={18} color={isDarkMode ? "#9CA3AF" : "#6B7280"} />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={[styles.menuTitle, isDarkMode && styles.textLight]}>My Account</Text>
              <Text style={styles.menuSubtitle}>Make changes to your account</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#9CA3AF" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => router.push('/profile/change-password' as any)}
          >
            <View style={[styles.menuIconContainer, isDarkMode && styles.menuIconContainerDark]}>
              <Feather name="lock" size={18} color={isDarkMode ? "#9CA3AF" : "#6B7280"} />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={[styles.menuTitle, isDarkMode && styles.textLight]}>Change Password</Text>
              <Text style={styles.menuSubtitle}>Update your driver account password</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#9CA3AF" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
            <View style={[styles.menuIconContainer, isDarkMode && styles.menuIconContainerDark]}>
              <Feather name="log-out" size={18} color={isDarkMode ? "#9CA3AF" : "#6B7280"} />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={[styles.menuTitle, isDarkMode && styles.textLight]}>Log out</Text>
              <Text style={styles.menuSubtitle}>Sign out of your driver account</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#9CA3AF" />
          </TouchableOpacity>
        </View>

        {/* More Section */}
        <Text style={[styles.sectionTitle, isDarkMode && styles.textLight]}>More</Text>
        
        <View style={[styles.menuSection, isDarkMode && styles.menuSectionDark]}>
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => setIsHelpModalVisible(true)}
          >
            <View style={[styles.menuIconContainer, isDarkMode && styles.menuIconContainerDark]}>
              <Feather name="bell" size={18} color={isDarkMode ? "#9CA3AF" : "#6B7280"} />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={[styles.menuTitle, isDarkMode && styles.textLight]}>Help & Support</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#9CA3AF" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => setIsAboutModalVisible(true)}
          >
            <View style={[styles.menuIconContainer, isDarkMode && styles.menuIconContainerDark]}>
              <Feather name="info" size={18} color={isDarkMode ? "#9CA3AF" : "#6B7280"} />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={[styles.menuTitle, isDarkMode && styles.textLight]}>About App</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#9CA3AF" />
          </TouchableOpacity>
        </View>
        
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Help Modal */}
      <Modal
        visible={isHelpModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsHelpModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsHelpModalVisible(false)}>
          <View style={[styles.modalContent, isDarkMode && styles.modalContentDark]}>
            <View style={styles.modalIconBg}>
              <Feather name="life-buoy" size={32} color="#3B5241" />
            </View>
            <Text style={[styles.modalTitle, isDarkMode && styles.textLight]}>Help & Support</Text>
            <Text style={styles.modalBody}>
              Need assistance with your dispatch routes or having trouble with the app? Our CENRO support team is here for you.
            </Text>
            <View style={styles.modalInfoBox}>
              <Text style={styles.modalInfoLabel}>Emergency Dispatch Hotline</Text>
              <Text style={styles.modalInfoValue}>(032) 123-4567</Text>
              <Text style={[styles.modalInfoLabel, { marginTop: 12 }]}>Email Support</Text>
              <Text style={styles.modalInfoValue}>support@trashtrack.ph</Text>
            </View>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setIsHelpModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* About Modal */}
      <Modal
        visible={isAboutModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsAboutModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsAboutModalVisible(false)}>
          <View style={[styles.modalContent, isDarkMode && styles.modalContentDark]}>
            <Image 
              source={require('@/assets/images/trashtrack_logo_driver.png')} 
              style={{ width: 80, height: 80, resizeMode: 'contain', marginBottom: 16 }}
            />
            <Text style={[styles.modalTitle, isDarkMode && styles.textLight]}>TrashTrack</Text>
            <Text style={[styles.modalTitle, { fontSize: 16, marginTop: -4, color: '#3B5241' }]}>Driver Portal</Text>
            
            <Text style={styles.modalBody}>
              Version 1.0.0{'\n\n'}
              An intelligent, route-aware waste management and tracking system designed for Danao City CENRO drivers.
            </Text>
            
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setIsAboutModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 20,
  },
  containerDark: {
    backgroundColor: '#111827',
  },
  textLight: {
    color: '#F9FAFB'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 60,
    marginBottom: 30,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  profileCard: {
    backgroundColor: '#3B5241',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 30,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 16,
  },
  profileName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  profileHandle: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  menuSectionDark: {
    backgroundColor: '#1F2937',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  menuIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  menuIconContainerDark: {
    backgroundColor: '#374151',
  },
  menuTextContainer: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4B5563',
    marginBottom: 12,
    marginLeft: 4,
  },
  
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#FFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  modalContentDark: {
    backgroundColor: '#1F2937',
  },
  modalIconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F0FDF4',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalBody: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  modalInfoBox: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modalInfoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    marginBottom: 4,
  },
  modalInfoValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#3B5241',
  },
  modalCloseBtn: {
    width: '100%',
    backgroundColor: '#3B5241',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
