import { useAuthContext } from '@/components/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { auth, db } from '@/config/firebase';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import React, { useEffect, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';

export default function DriverEditProfile() {
  const router = useRouter();
  const { user } = useAuthContext();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchUserData = async () => {
      if (!auth.currentUser || !db) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.firstName) setFirstName(data.firstName);
          else if (data.name) {
            const parts = data.name.split(' ');
            setFirstName(parts[0]);
            setLastName(parts.slice(1).join(' '));
          }
          if (data.lastName) setLastName(data.lastName);
          if (data.phone) setPhone(data.phone);
          if (data.gender) setGender(data.gender);
          if (data.dob) setDob(data.dob);
        }
      } catch (err) {
        console.error("Error fetching user data", err);
      }
    };
    fetchUserData();
  }, []);

  const handleUpdate = async () => {
    if (!auth.currentUser || !db) {
      Alert.alert('Sign-in required', 'Log in with an active driver account before updating the profile.');
      return;
    }
    setLoading(true);
    try {
      const fullName = `${firstName} ${lastName}`.trim();
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        firstName,
        lastName,
        name: fullName,
        phone,
        gender,
        dob
      });
      await updateProfile(auth.currentUser, {
        displayName: fullName
      });
      Alert.alert('Success', 'Profile updated successfully!');
      router.back();
    } catch (err) {
      console.error("Error updating profile", err);
      Alert.alert('Error', 'Failed to update profile. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, isDark && styles.containerDark]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={isDark ? "#111827" : "#F9FAFB"} />
      
      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Feather name="arrow-left" size={24} color={isDark ? "#F9FAFB" : "#1F2937"} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>Profile</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Avatar */}
        <View style={styles.avatarContainer}>
          <View style={styles.avatarWrapper}>
            {user?.photoURL ? (
              <Image source={{ uri: user.photoURL }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#DDE9DF' }]}>
                <Feather name="user" size={42} color="#3B5241" />
              </View>
            )}
          </View>
          <Text style={[styles.name, isDark && styles.textLight]}>{user?.displayName || 'Driver Account'}</Text>
          <Text style={styles.email}>{user?.email || ''}</Text>
        </View>

        {/* Form Fields */}
        <View style={styles.form}>
          <TextInput
            style={[styles.input, isDark && styles.inputDark]}
            placeholderTextColor={isDark ? "#9CA3AF" : "#6B7280"}
            placeholder="What's your first name?"
            value={firstName}
            onChangeText={setFirstName}
          />

          <TextInput
            style={[styles.input, isDark && styles.inputDark]}
            placeholderTextColor={isDark ? "#9CA3AF" : "#6B7280"}
            placeholder="And your last name?"
            value={lastName}
            onChangeText={setLastName}
          />

          <View style={[styles.phoneInputContainer, isDark && styles.inputDark]}>
            <View style={[styles.countryCode, isDark && styles.inputDark]}>
              <Text style={styles.flag}>🇵🇭</Text>
              <View style={[styles.separator, isDark && { backgroundColor: '#374151' }]} />
            </View>
            <TextInput
              style={[styles.phoneInput, isDark && styles.textLight]}
              placeholderTextColor={isDark ? "#9CA3AF" : "#6B7280"}
              placeholder="Phone number"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
          </View>

          <View style={[styles.inputWithIcon, isDark && styles.inputDark]}>
            <TextInput
              style={[styles.inputField, isDark && styles.textLight]}
              placeholderTextColor={isDark ? "#9CA3AF" : "#6B7280"}
              placeholder="Select your gender"
              value={gender}
              onChangeText={setGender}
            />
            <Feather name="chevron-down" size={20} color="#9CA3AF" />
          </View>

          <View style={[styles.inputWithIcon, isDark && styles.inputDark]}>
            <TextInput
              style={[styles.inputField, isDark && styles.textLight]}
              placeholderTextColor={isDark ? "#9CA3AF" : "#6B7280"}
              placeholder="What is your date of birth?"
              value={dob}
              onChangeText={setDob}
            />
            <Feather name="calendar" size={20} color={isDark ? "#9CA3AF" : "#3B5241"} />
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.updateButton, loading && { opacity: 0.7 }]} 
          onPress={handleUpdate}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.updateButtonText}>Update Profile</Text>
          )}
        </TouchableOpacity>
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  containerDark: {
    backgroundColor: '#111827',
  },
  textLight: {
    color: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 60,
    marginBottom: 40,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  avatarWrapper: {
    padding: 4,
    backgroundColor: '#FCA5A5', // Pinkish circle behind
    borderRadius: 50,
    marginBottom: 12,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  form: {
    paddingHorizontal: 20,
    gap: 16,
    marginBottom: 40,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    color: '#1F2937',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  inputDark: {
    backgroundColor: '#1F2937',
    color: '#F9FAFB',
    borderColor: '#374151',
  },
  phoneInputContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    alignItems: 'center',
    overflow: 'hidden',
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#F9FAFB',
  },
  flag: {
    fontSize: 16,
    marginRight: 12,
  },
  separator: {
    width: 1,
    height: 24,
    backgroundColor: '#E5E7EB',
  },
  phoneInput: {
    flex: 1,
    padding: 16,
    fontSize: 14,
    color: '#1F2937',
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  inputField: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 14,
    color: '#1F2937',
  },
  updateButton: {
    backgroundColor: '#5A755E',
    marginHorizontal: 20,
    borderRadius: 24,
    paddingVertical: 16,
    alignItems: 'center',
  },
  updateButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
