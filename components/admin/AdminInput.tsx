import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

interface AdminInputProps {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  icon: keyof typeof MaterialIcons.glyphMap;
  secureTextEntry?: boolean;
  rightComponent?: React.ReactNode;
  editable?: boolean;
  autoComplete?: any;
  autoCorrect?: boolean;
}

export default function AdminInput({
  placeholder,
  value,
  onChangeText,
  icon,
  secureTextEntry = false,
  rightComponent,
  editable = true,
  autoComplete = 'off',
  autoCorrect = false,
}: AdminInputProps) {
  return (
    <View style={styles.inputContainer}>
      <MaterialIcons name={icon} size={20} color="#333" style={styles.inputIcon} />
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="#999"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        editable={editable}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
      />
      {rightComponent}
    </View>
  );
}

const styles = StyleSheet.create({
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 20,
    marginBottom: 20,
    height: 56,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
}); 