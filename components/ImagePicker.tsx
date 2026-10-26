import { Ionicons } from '@expo/vector-icons';
import * as ExpoImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    type AlertButton,
    Image,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { cloudinaryService, UPLOAD_FOLDERS, UploadResult } from '../services/cloudinaryService';
import { isImageFile } from '../utils/cloudinaryHelpers';

interface ImagePickerProps {
  onImageSelected: (result: UploadResult) => void;
  folder?: keyof typeof UPLOAD_FOLDERS;
  placeholder?: string;
  currentImageUrl?: string;
  style?: any;
  disabled?: boolean;
  showPreview?: boolean;
  aspectRatio?: [number, number];
}

export const CloudinaryImagePicker: React.FC<ImagePickerProps> = ({
  onImageSelected,
  folder = 'REPORTS',
  placeholder = 'Tap to add image',
  currentImageUrl,
  style,
  disabled = false,
  showPreview = true,
  aspectRatio = [1, 1],
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  const handleImageSelection = async (source: 'gallery' | 'camera') => {
    setShowOptions(false);
    setIsUploading(true);

    try {
      const folderPath = UPLOAD_FOLDERS[folder];
      const result = source === 'camera' 
        ? await cloudinaryService.takePhotoAndUpload(folderPath)
        : await cloudinaryService.pickAndUploadImage('gallery', folderPath);

      if (result.success) {
        onImageSelected(result);
      } else {
        Alert.alert('Upload Failed', result.error || 'Unknown error occurred');
      }
    } catch (error) {
      console.error('Image selection error:', error);
      Alert.alert('Error', 'Failed to select and upload image');
    } finally {
      setIsUploading(false);
    }
  };

  const showImageOptions = () => {
    Alert.alert(
      'Select Image',
      'Choose how you want to add an image',
      [
        { text: 'Camera', onPress: () => handleImageSelection('camera') },
        { text: 'Gallery', onPress: () => handleImageSelection('gallery') },
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={showImageOptions}
      disabled={disabled || isUploading}
      activeOpacity={0.7}
    >
      {isUploading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Uploading...</Text>
        </View>
      ) : currentImageUrl && showPreview ? (
        <View style={styles.imageContainer}>
          <Image source={{ uri: currentImageUrl }} style={styles.previewImage} />
          <View style={styles.editOverlay}>
            <Ionicons name="camera" size={24} color="white" />
          </View>
        </View>
      ) : (
        <View style={styles.placeholderContainer}>
          <Ionicons name="camera-outline" size={48} color="#999" />
          <Text style={styles.placeholderText}>{placeholder}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

// Alternative component with more customization options
interface AdvancedImagePickerProps extends ImagePickerProps {
  multiple?: boolean;
  maxImages?: number;
  onMultipleImagesSelected?: (results: UploadResult[]) => void;
}

export const AdvancedImagePicker: React.FC<AdvancedImagePickerProps> = ({
  onImageSelected,
  onMultipleImagesSelected,
  folder = 'REPORTS',
  placeholder = 'Add images',
  multiple = false,
  maxImages = 5,
  style,
  disabled = false,
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');

  const handleMultipleImageUpload = async () => {
    setIsUploading(true);
    setUploadProgress('Selecting images...');
    try {
      const permission = await ExpoImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permission required', 'Allow photo-library access to upload images.');
        return;
      }
      const selection = await ExpoImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, Math.min(10, maxImages)),
        quality: 0.8,
        exif: false,
      });
      if (selection.canceled || !selection.assets.length) return;
      const validAssets = selection.assets.filter(asset => isImageFile(asset).isValid);
      if (validAssets.length === 0) {
        Alert.alert('Invalid File', 'Only image files (JPG, PNG, WebP, GIF, etc.) are allowed to be uploaded.');
        return;
      }
      setUploadProgress(`Uploading ${validAssets.length} image${validAssets.length === 1 ? '' : 's'}...`);
      const results = await cloudinaryService.uploadMultipleImages(
        validAssets.map(asset => asset.uri),
        { folder: UPLOAD_FOLDERS[folder] },
      );
      const successful = results.filter(result => result.success);
      if (!successful.length) {
        Alert.alert('Upload failed', results[0]?.error || 'The selected images could not be uploaded.');
        return;
      }
      onMultipleImagesSelected?.(successful);
      successful.forEach(onImageSelected);
      if (successful.length !== results.length) {
        Alert.alert('Partial upload', `${successful.length} of ${results.length} images were uploaded.`);
      }
    } catch (error) {
      console.error('Multiple image upload error:', error);
      Alert.alert('Upload failed', 'The selected images could not be uploaded.');
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  const handleSingleImageUpload = async (source: 'gallery' | 'camera') => {
    setIsUploading(true);
    setUploadProgress('Selecting image...');

    try {
      const folderPath = UPLOAD_FOLDERS[folder];
      setUploadProgress('Uploading to cloud...');
      
      const result = source === 'camera' 
        ? await cloudinaryService.takePhotoAndUpload(folderPath)
        : await cloudinaryService.pickAndUploadImage('gallery', folderPath);

      if (result.success) {
        setUploadProgress('Upload complete!');
        onImageSelected(result);
      } else {
        Alert.alert('Upload Failed', result.error || 'Unknown error occurred');
      }
    } catch (error) {
      console.error('Advanced image selection error:', error);
      Alert.alert('Error', 'Failed to select and upload image');
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  const showImageOptions = () => {
    const options: AlertButton[] = [
      { text: 'Camera', onPress: () => handleSingleImageUpload('camera') },
      { text: 'Gallery', onPress: () => handleSingleImageUpload('gallery') },
    ];

    if (multiple) {
      options.unshift({
        text: 'Multiple Images',
        onPress: handleMultipleImageUpload,
      });
    }

    options.push({ text: 'Cancel', style: 'cancel' as const });

    Alert.alert('Select Image', 'Choose how you want to add images', options);
  };

  return (
    <TouchableOpacity
      style={[styles.advancedContainer, style]}
      onPress={showImageOptions}
      disabled={disabled || isUploading}
      activeOpacity={0.7}
    >
      {isUploading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>{uploadProgress}</Text>
        </View>
      ) : (
        <View style={styles.advancedPlaceholder}>
          <Ionicons name="images-outline" size={48} color="#4CAF50" />
          <Text style={styles.advancedPlaceholderText}>{placeholder}</Text>
          <Text style={styles.advancedSubtext}>
            {multiple ? `Tap to add up to ${maxImages} images` : 'Tap to add image'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 150,
    backgroundColor: '#F9F9F9',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    height: 150,
  },
  previewImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  editOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    padding: 8,
  },
  placeholderContainer: {
    alignItems: 'center',
  },
  placeholderText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  advancedContainer: {
    borderWidth: 2,
    borderColor: '#4CAF50',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 180,
    backgroundColor: '#F1F8E9',
  },
  advancedPlaceholder: {
    alignItems: 'center',
  },
  advancedPlaceholderText: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: '600',
    color: '#2E7D32',
    textAlign: 'center',
  },
  advancedSubtext: {
    marginTop: 8,
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});

export default CloudinaryImagePicker;
