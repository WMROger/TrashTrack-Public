import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '@/config/firebase';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);
  const requirements = useMemo(() => ({
    length: newPassword.length >= 12,
    upper: /[A-Z]/.test(newPassword),
    lower: /[a-z]/.test(newPassword),
    number: /\d/.test(newPassword),
    symbol: /[@$!%*?&]/.test(newPassword),
  }), [newPassword]);
  const valid = Object.values(requirements).every(Boolean) && newPassword === confirmPassword && !!currentPassword;

  const save = async () => {
    const user = auth?.currentUser;
    if (!user?.email) return Alert.alert('Unavailable', 'Password changes require an email/password account.');
    if (!valid) return Alert.alert('Check password', 'Complete every password requirement and make sure the confirmation matches.');
    if (newPassword === currentPassword) return Alert.alert('Choose a new password', 'The new password must be different from the current password.');
    setSaving(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
      await updatePassword(user, newPassword);

      if (db && user.uid) {
        try {
          await updateDoc(doc(db, 'users', user.uid), {
            mustChangePassword: false,
            passwordChangeSnoozedUntil: null,
            updatedAt: serverTimestamp(),
          });
        } catch (dbErr) {
          console.warn('Could not reset mustChangePassword in Firestore:', dbErr);
        }
        try {
          await AsyncStorage.removeItem(`@trashtrack_pwd_snooze_${user.uid}`);
        } catch {}
      }

      Alert.alert('Password Updated', 'Your new password is now active.', [{ text: 'Done', onPress: () => router.back() }]);
    } catch (error: any) {
      const message = ['auth/invalid-credential', 'auth/wrong-password'].includes(error?.code)
        ? 'The current password is incorrect.'
        : error?.code === 'auth/requires-recent-login'
          ? 'Please sign in again, then retry the password change.'
          : 'The password could not be updated. Please try again.';
      Alert.alert('Password Change Failed', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={23} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change Password</Text>
        <View style={styles.back} />
      </View>
      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView 
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <View style={styles.icon}><MaterialIcons name="lock-reset" size={30} color="#2E8B57" /></View>
            <Text style={styles.title}>Secure your account</Text>
            <Text style={styles.subtitle}>Confirm your current password before choosing a new one.</Text>
            {[
              ['Current password', currentPassword, setCurrentPassword],
              ['New password', newPassword, setNewPassword],
              ['Confirm new password', confirmPassword, setConfirmPassword],
            ].map(([label, value, setter]) => (
              <View key={label as string} style={styles.field}>
                <Text style={styles.label}>{label as string}</Text>
                <TextInput
                  style={styles.input}
                  value={value as string}
                  onChangeText={setter as (value: string) => void}
                  secureTextEntry={!showPasswords}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ))}
            <TouchableOpacity style={styles.showRow} onPress={() => setShowPasswords(value => !value)}>
              <MaterialIcons name={showPasswords ? 'visibility-off' : 'visibility'} size={18} color="#64748B" />
              <Text style={styles.showText}>{showPasswords ? 'Hide passwords' : 'Show passwords'}</Text>
            </TouchableOpacity>
            <View style={styles.requirements}>
              {[
                ['At least 12 characters', requirements.length],
                ['Uppercase and lowercase letters', requirements.upper && requirements.lower],
                ['At least one number', requirements.number],
                ['At least one symbol (@$!%*?&)', requirements.symbol],
                ['Confirmation matches', !!confirmPassword && newPassword === confirmPassword],
              ].map(([label, met]) => (
                <View key={label as string} style={styles.requirementRow}>
                  <MaterialIcons name={met ? 'check-circle' : 'radio-button-unchecked'} size={16} color={met ? '#16A34A' : '#94A3B8'} />
                  <Text style={[styles.requirementText, met && styles.requirementMet]}>{label as string}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity style={[styles.save, (!valid || saving) && styles.disabled]} onPress={save} disabled={!valid || saving}>
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveText}>Update Password</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:'#F5F8F5'},header:{height:62,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:18,backgroundColor:'#FFF',borderBottomWidth:1,borderBottomColor:'#E5E7EB'},back:{width:40,height:40,alignItems:'center',justifyContent:'center'},headerTitle:{fontSize:17,fontWeight:'800',color:'#1F2937'},card:{margin:22,backgroundColor:'#FFF',borderRadius:18,padding:22,borderWidth:1,borderColor:'#E5E7EB'},icon:{width:54,height:54,borderRadius:15,backgroundColor:'#ECFDF5',alignItems:'center',justifyContent:'center'},title:{fontSize:23,fontWeight:'900',color:'#111827',marginTop:16},subtitle:{fontSize:13,color:'#64748B',lineHeight:19,marginTop:5,marginBottom:20},field:{marginBottom:14},label:{fontSize:12,fontWeight:'800',color:'#374151',marginBottom:7},input:{height:48,borderWidth:1,borderColor:'#CBD5E1',borderRadius:10,paddingHorizontal:13,color:'#111827',backgroundColor:'#F8FAFC'},showRow:{flexDirection:'row',alignItems:'center',gap:7,alignSelf:'flex-start',paddingVertical:5},showText:{fontSize:12,fontWeight:'700',color:'#64748B'},requirements:{backgroundColor:'#F8FAFC',borderRadius:11,padding:13,marginTop:12,marginBottom:18},requirementRow:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:4},requirementText:{fontSize:11,color:'#64748B'},requirementMet:{color:'#166534',fontWeight:'700'},save:{height:48,borderRadius:10,backgroundColor:'#2E8B57',alignItems:'center',justifyContent:'center'},disabled:{opacity:.45},saveText:{color:'#FFF',fontSize:14,fontWeight:'900'},
});
