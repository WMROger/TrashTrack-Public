/**
 * Simple test script to verify Cloudinary configuration
 * Run with: node scripts/test-cloudinary.js
 */

// Load environment variables from .env file
require('dotenv').config();

// Check if environment variables are set
console.log('🔍 Checking Cloudinary Configuration...\n');

const requiredEnvVars = [
  'EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME',
  'EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET'
];

let allSet = true;

requiredEnvVars.forEach(envVar => {
  const value = process.env[envVar];
  if (value) {
    console.log(`✅ ${envVar}: ${envVar.includes('SECRET') ? '***hidden***' : value}`);
  } else {
    console.log(`❌ ${envVar}: NOT SET`);
    allSet = false;
  }
});

console.log('\n📋 Configuration Status:');
if (allSet) {
  console.log('✅ All Cloudinary environment variables are set!');
  console.log('\n🚀 Next Steps:');
  console.log('1. Start your development server: npm start');
  console.log('2. Test image upload in your app');
  console.log('3. Check Cloudinary dashboard for uploaded images');
} else {
  console.log('❌ Some environment variables are missing.');
  console.log('\n🔧 To fix this:');
  console.log('1. Create a .env file in your project root');
  console.log('2. Add the missing variables with your Cloudinary credentials');
  console.log('3. Restart your development server');
}

console.log('\n📖 Upload Presets Available:');
console.log('- trashtrack_reports (for report images)');
console.log('- trashtrack_profile (for profile images)');

console.log('\n🔗 Helpful Links:');
console.log('- Cloudinary Dashboard: https://cloudinary.com/console');
console.log('- Upload Presets: https://cloudinary.com/console/settings/upload');
console.log('- API Keys: https://cloudinary.com/console/settings/security');
