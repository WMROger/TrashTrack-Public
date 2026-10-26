/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * Light mode is the primary theme with a carefully crafted color palette.
 * Dark mode is provided as an auxiliary option for user preference.
 */

const tintColorLight = '#4E6C50'; // Primary green from user palette
const tintColorDark = '#A9D6B5'; // Lighter green for dark mode

export const Colors = {
  light: {
    text: '#11181C',
    background: '#E8F5E9', // Consistent light eco-green background matching Home and tabs
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
    // TrashTrack specific colors using user's color palette - PRIMARY THEME
    primary: '#4E6C50', // Main primary green
    primaryLight: '#4E6C50', // Lighter green variant
    secondary: '#ECFEE5', // Light green secondary
    surface: '#FFFFFF', // White surface
    surfaceVariant: '#E6F5D9', // Very light green surface variant
    border: '#AFAF9F', // Muted gray border
    textPrimary: '#000000', // Dark green text
    textSecondary: '#73946B', // Medium green text
    textTertiary: '#AFAF9F', // Muted gray text
    success: '#4CAF50',
    warning: '#FF9800',
    error: '#F44336',
    chatUserBubble: '#4E6C50',
    chatUserText: '#FFFFFF',
    chatAIBubble: '#E6F5D9',
    chatAIText: '#4E6C50',
    chatAIBorder: '#4E6C50',
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    // TrashTrack specific colors - AUXILIARY THEME
    primary: '#A9D6B5',
    primaryLight: '#5B7C67',
    secondary: '#2A3A2E',
    surface: '#1E1E1E',
    surfaceVariant: '#2A2A2A',
    border: '#404040',
    textPrimary: '#FFFFFF',
    textSecondary: '#CCCCCC',
    textTertiary: '#999999',
    success: '#66BB6A',
    warning: '#FFB74D',
    error: '#EF5350',
    chatUserBubble: '#A9D6B5',
    chatUserText: '#1E1E1E',
    chatAIBubble: '#2A2A2A',
    chatAIText: '#FFFFFF',
    chatAIBorder: '#A9D6B5',
  },
};
