# Cloudinary Setup Guide for TrashTruck

This guide will walk you through setting up Cloudinary for image uploads in your TrashTruck React Native Expo app.

## Prerequisites

- Cloudinary account (free tier available)
- TrashTruck project with Expo and TypeScript
- Node.js and npm/yarn installed

## Step 1: Create Cloudinary Account

1. Go to [cloudinary.com](https://cloudinary.com) and sign up
2. Verify your email address
3. Log in to your dashboard

## Step 2: Get Your Credentials

From your Cloudinary dashboard, note down:
- **Cloud name** (visible in the dashboard URL and top of the page)
- **API Key** (from Account Details)
- **API Secret** (from Account Details - keep this secure!)

## Step 3: Set Up Upload Presets (Recommended)

For security and consistency, create upload presets:

1. Go to Settings → Upload → Upload presets
2. Click "Add upload preset"
3. Configure the preset:
   - **Preset name**: `trashtruck_reports` (or similar)
   - **Signing Mode**: Unsigned (for mobile uploads)
   - **Folder**: `trashtruck/reports` (organizes your uploads)
   - **Allowed formats**: jpg, png, webp
   - **Transformation**: Set max dimensions (e.g., 1200x1200)
   - **Quality**: Auto
   - **Format**: Auto (for optimization)

Repeat for different upload types (profiles, announcements, etc.).

## Step 4: Configure Environment Variables

Create a `.env` file in your project root (copy from `env.example`):

```env
# Cloudinary Configuration
EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name-here
EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET=trashtruck_reports

# Your existing Firebase config...
EXPO_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
# ... etc
```

**Important**: 
- Never commit your `.env` file to version control
- Never put a Cloudinary API secret in an `EXPO_PUBLIC_*` variable
- TrashTrack uses a restricted unsigned upload preset for client uploads

## Step 5: Install Required Packages

The packages should already be installed, but verify:

```bash
npm list cloudinary expo-image-picker
```

If not installed:

```bash
npm install cloudinary expo-image-picker
```

## Step 6: Test the Integration

1. Start your development server:
```bash
npm start
```

2. Use the example components to test uploads:
```typescript
import { CloudinaryImagePicker } from './components/ImagePicker';

// In your component
<CloudinaryImagePicker
  onImageSelected={(result) => {
    if (result.success) {
      console.log('Image uploaded:', result.url);
    }
  }}
  folder="REPORTS"
/>
```

## Step 7: Integrate into Existing Screens

Replace Firebase Storage uploads with Cloudinary:

### Before (Firebase Storage):
```typescript
// Complex upload logic with error handling for CORS, etc.
const uploadImageToStorage = async (uri: string) => {
  // 50+ lines of complex code...
};
```

### After (Cloudinary):
```typescript
import { cloudinaryService } from './services/cloudinaryService';

const result = await cloudinaryService.uploadImage(imageUri, {
  folder: 'trashtruck/reports'
});

if (result.success) {
  console.log('Upload successful:', result.url);
}
```

## Folder Structure

Organize your uploads with folders:

```
trashtruck/
├── reports/          # Trash reports
├── profiles/         # User profile pictures
├── announcements/    # Admin announcements
└── feedback/         # User feedback images
```

## Security Best Practices

1. **Use Upload Presets**: Create unsigned presets for mobile uploads
2. **Limit File Types**: Only allow image formats you need
3. **Set Size Limits**: Prevent huge uploads
4. **Folder Organization**: Use consistent folder structures
5. **Environment Variables**: Keep credentials secure
6. **Server-side Operations**: Handle deletions and sensitive operations server-side

## Image Transformations

Cloudinary automatically optimizes images. You can also apply transformations:

```typescript
// Generate thumbnail
const thumbnailUrl = cloudinaryService.generateOptimizedUrl(
  publicId, 
  150, 
  150, 
  'fill'
);

// Generate responsive image
const responsiveUrl = cloudinaryService.generateOptimizedUrl(
  publicId, 
  800, 
  600, 
  'limit'
);
```

## Troubleshooting

### Common Issues:

1. **"Invalid signature" errors**:
   - Check your API credentials
   - Ensure upload preset is set to "unsigned"

2. **Network errors**:
   - Check internet connection
   - Verify Cloudinary service status

3. **Permission errors**:
   - Check camera/photo library permissions in your app
   - Verify iOS/Android permission settings

4. **Large upload failures**:
   - Reduce image quality in ImagePicker options
   - Set size limits in upload presets

### Debug Mode:

Enable debug logging in development:

```typescript
// In your config/cloudinary.ts
if (__DEV__) {
  console.log('Cloudinary config:', {
    cloud_name: cloudinaryConfig.cloud_name,
    upload_preset: UPLOAD_PRESET,
  });
}
```

## Migration from Firebase Storage

If migrating from Firebase Storage:

1. **Keep both services temporarily** during transition
2. **Update upload logic** to use Cloudinary service
3. **Migrate existing images** (optional):
   - Download from Firebase Storage
   - Upload to Cloudinary
   - Update database URLs
4. **Remove Firebase Storage** once migration is complete

## Benefits of Cloudinary vs Firebase Storage

✅ **Cloudinary Advantages**:
- No CORS issues in development
- Automatic image optimization
- Built-in transformations
- Reliable CDN
- Simpler upload flow
- Better error handling
- Advanced image management features

📱 **Perfect for Mobile Apps**:
- Optimized for React Native
- Reduced app bundle size
- Faster image loading
- Better user experience

## Cost Considerations

Cloudinary free tier includes:
- 25GB storage
- 25GB monthly bandwidth
- 25,000 transformations per month

For production apps, consider:
- Monitor usage in dashboard
- Set up usage alerts
- Plan for scaling

## Support

- [Cloudinary Documentation](https://cloudinary.com/documentation)
- [React Native Integration Guide](https://cloudinary.com/documentation/react_native_integration)
- [Upload API Reference](https://cloudinary.com/documentation/image_upload_api_reference)

## Next Steps

1. Set up your Cloudinary account
2. Configure environment variables
3. Test with the example components
4. Integrate into your existing screens
5. Deploy and monitor usage

Happy uploading! 🚀
