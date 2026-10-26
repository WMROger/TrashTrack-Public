import React, { createContext, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'trashtrack_theme_preference';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleSystem: () => void;
  isSystem: boolean;
}

const defaultContext: ThemeContextType = {
  theme: 'light',
  setTheme: () => {},
  toggleSystem: () => {},
  isSystem: false,
};

const ThemeContext = createContext<ThemeContextType>(defaultContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always lock and enforce light mode, clear any saved dark mode
  useEffect(() => {
    AsyncStorage.setItem(THEME_STORAGE_KEY, 'light').catch(() => {});
  }, []);

  const value: ThemeContextType = {
    theme: 'light',
    setTheme: () => {},
    toggleSystem: () => {},
    isSystem: false,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// Theme hook with light mode guaranteed
export function useTheme() {
  const context = useContext(ThemeContext);
  return context || defaultContext;
}
