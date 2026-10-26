# Cloudinary Upload Preset Fix

## Issue
The driver image upload is failing with the error: "Upload preset must be specified when using unsigned upload"

## Root Cause
The Cloudinary upload preset is not properly configured in the environment variables.

## Solution

### 1. Use Existing Cloudinary Configuration
The driver image service now uses the existing working Cloudinary configuration:
- **Reports**: Uses `trashtrack_reports` preset and `trashtruck/reports` folder
- **Profiles**: Uses `trashtrack_profile` preset and `trashtruck/profiles` folder

### 2. Environment Variables
Make sure you have these environment variables set in your `.env` file:

```env
# Cloudinary Configuration
EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET=trashtrack_reports
```

### 3. Verify Existing Presets
Since you already have the `trashtrack` folder with `reports` and `profile` subfolders in your Cloudinary Media Library, make sure these presets exist:
- `trashtrack_reports` - for completion images and driver reports
- `trashtrack_profile` - for driver profile images

### 4. Test the Fix
After setting up the environment variables:
1. Restart your development server
2. Try uploading an image in the driver interface
3. The upload should now work without the preset error

## Code Changes Made
- Updated `config/cloudinary.ts` to include driver-specific folders
- Updated `services/driverImageService.ts` to use proper upload presets
- Added better error handling in `services/cloudinaryService.ts`

## Troubleshooting
If you still get errors:
1. Check that all environment variables are set correctly
2. Verify the upload preset exists in your Cloudinary account
3. Ensure the preset is set to "Unsigned" mode
4. Check the browser console for detailed error messages
