import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

interface AdminButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  colorScheme?: 'green' | 'teal' | 'slate';
  disabled?: boolean;
  style?: any;
}

export default function AdminButton({
  title,
  onPress,
  variant = 'primary',
  colorScheme = 'green',
  disabled = false,
  style,
}: AdminButtonProps) {
  const getThemeColor = () => {
    switch (colorScheme) {
      case 'teal':
        return '#0F766E';
      case 'slate':
        return '#1E293B';
      case 'green':
      default:
        return '#2E7D32';
    }
  };

  const themeColor = getThemeColor();

  return (
    <TouchableOpacity 
      style={[
        styles.button, 
        variant === 'primary' ? { backgroundColor: themeColor } : { backgroundColor: 'transparent', borderWidth: 2, borderColor: themeColor },
        disabled && styles.disabledButton,
        style,
      ]} 
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <Text style={[
        styles.buttonText, 
        variant === 'primary' ? styles.primaryButtonText : { color: themeColor },
        disabled && styles.disabledButtonText
      ]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButton: {
    backgroundColor: '#2E7D32',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#2E7D32',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  primaryButtonText: {
    color: 'white',
  },
  secondaryButtonText: {
    color: '#2E7D32',
  },
  disabledButton: {
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  disabledButtonText: {
    color: '#E0E0E0',
  },
}); 