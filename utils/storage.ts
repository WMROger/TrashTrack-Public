import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Cross-platform secure storage utility
 * Uses expo-secure-store on native platforms and localStorage on web
 */
class CrossPlatformStorage {
  private isWeb = Platform.OS === 'web';

  async getItem(key: string): Promise<string | null> {
    try {
      if (this.isWeb) {
        // Use localStorage on web
        return localStorage.getItem(key);
      } else {
        // Use SecureStore on native platforms
        return await SecureStore.getItemAsync(key);
      }
    } catch (error) {
      console.error('Failed to get item from storage:', error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (this.isWeb) {
        // Use localStorage on web
        localStorage.setItem(key, value);
      } else {
        // Use SecureStore on native platforms
        await SecureStore.setItemAsync(key, value);
      }
    } catch (error) {
      console.error('Failed to set item in storage:', error);
      throw error;
    }
  }

  async deleteItem(key: string): Promise<void> {
    try {
      if (this.isWeb) {
        // Use localStorage on web
        localStorage.removeItem(key);
      } else {
        // Use SecureStore on native platforms
        await SecureStore.deleteItemAsync(key);
      }
    } catch (error) {
      console.error('Failed to delete item from storage:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.isWeb) {
        // Clear all localStorage items (be careful - this clears everything)
        localStorage.clear();
      } else {
        // Note: SecureStore doesn't have a clear all method
        // You'd need to track keys manually if needed
        console.warn('SecureStore does not support clearing all items');
      }
    } catch (error) {
      console.error('Failed to clear storage:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const storage = new CrossPlatformStorage();

// Export named functions for backward compatibility
export const getItem = (key: string) => storage.getItem(key);
export const setItem = (key: string, value: string) => storage.setItem(key, value);
export const deleteItem = (key: string) => storage.deleteItem(key);
export const clearStorage = () => storage.clear();
