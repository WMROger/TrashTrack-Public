import { UPLOAD_FOLDERS, UPLOAD_PRESETS } from '../config/cloudinary';
import { cloudinaryService } from './cloudinaryService';

export interface DriverImageUploadResult {
  success: boolean;
  url?: string;
  publicId?: string;
  error?: string;
}

class DriverImageService {
  private readonly DRIVER_FOLDER = UPLOAD_FOLDERS.DRIVER_PHOTOS || 'trashtrack/driver-photos';

  /**
   * Upload completion image for pickup
   */
  async uploadCompletionImage(imageUri: string): Promise<DriverImageUploadResult> {
    try {
      const result = await cloudinaryService.uploadImage(imageUri, {
        folder: UPLOAD_FOLDERS.REPORTS, // Use existing reports folder
        preset: UPLOAD_PRESETS.REPORTS, // Use existing reports preset
        tags: ['completion', 'pickup', 'driver'],
        resourceType: 'image',
      });

      return {
        success: result.success,
        url: result.url,
        publicId: result.publicId,
        error: result.error,
      };
    } catch (error) {
      console.error('Driver completion image upload error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload completion image',
      };
    }
  }

  /**
   * Upload profile image for driver
   */
  async uploadProfileImage(imageUri: string): Promise<DriverImageUploadResult> {
    try {
      const result = await cloudinaryService.uploadImage(imageUri, {
        folder: UPLOAD_FOLDERS.PROFILES, // Use existing profiles folder
        preset: UPLOAD_PRESETS.PROFILES, // Use existing profiles preset
        tags: ['profile', 'driver'],
        resourceType: 'image',
      });

      return {
        success: result.success,
        url: result.url,
        publicId: result.publicId,
        error: result.error,
      };
    } catch (error) {
      console.error('Driver profile image upload error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload profile image',
      };
    }
  }

  /**
   * Upload report image for driver
   */
  async uploadReportImage(imageUri: string): Promise<DriverImageUploadResult> {
    try {
      const result = await cloudinaryService.uploadImage(imageUri, {
        folder: UPLOAD_FOLDERS.REPORTS, // Use existing reports folder
        preset: UPLOAD_PRESETS.REPORTS, // Use existing reports preset
        tags: ['report', 'driver', 'issue'],
        resourceType: 'image',
      });

      return {
        success: result.success,
        url: result.url,
        publicId: result.publicId,
        error: result.error,
      };
    } catch (error) {
      console.error('Driver report image upload error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload report image',
      };
    }
  }

  /**
   * Generate optimized image URL for display
   */
  generateOptimizedImageUrl(publicId: string, width?: number, height?: number): string {
    return cloudinaryService.generateOptimizedUrl(publicId, width, height, 'fill');
  }

  /**
   * Generate thumbnail URL for list views
   */
  generateThumbnailUrl(publicId: string): string {
    return cloudinaryService.generateOptimizedUrl(publicId, 200, 200, 'fill');
  }

  /**
   * Generate full-size URL for detailed views
   */
  generateFullSizeUrl(publicId: string): string {
    return cloudinaryService.generateOptimizedUrl(publicId, 800, 600, 'fit');
  }

  /**
   * Check if URL is a Cloudinary URL
   */
  isCloudinaryUrl(url: string): boolean {
    return url.includes('cloudinary.com');
  }

  /**
   * Extract public ID from Cloudinary URL
   */
  extractPublicId(url: string): string | null {
    if (!this.isCloudinaryUrl(url)) return null;
    
    const match = url.match(/\/upload\/(?:[^\/]+\/)*([^\.]+)/);
    return match ? match[1] : null;
  }

  /**
   * Get fallback image URL for when images fail to load
   */
  getFallbackImageUrl(): string {
    // Return a placeholder image URL or local asset
    return 'https://via.placeholder.com/200x200/E8F5E8/2f3a31?text=No+Image';
  }
}

// Export singleton instance
export const driverImageService = new DriverImageService();
export default driverImageService;
