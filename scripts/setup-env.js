#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Setting up environment variables for TrashTruck...\n');

// Check if .env already exists
const envPath = path.join(__dirname, '..', '.env');
const envExamplePath = path.join(__dirname, '..', '.env.example');

if (fs.existsSync(envPath)) {
  console.log('⚠️  .env file already exists. Skipping creation.');
  console.log('   If you need to update it, copy from .env.example and update the values.\n');
} else {
  if (fs.existsSync(envExamplePath)) {
    // Copy .env.example to .env
    const envExample = fs.readFileSync(envExamplePath, 'utf8');
    fs.writeFileSync(envPath, envExample);
    console.log('✅ Created .env file from .env.example');
    console.log('📝 Please update the values in .env with your actual Firebase configuration\n');
  } else {
    console.log('❌ .env.example not found. Please create it first.\n');
  }
}

console.log('📋 Next steps:');
console.log('1. Get your Firebase configuration from Firebase Console');
console.log('2. Update the values in .env file');
console.log('3. Run "npm start" to test the app');
console.log('\n🔒 Remember: .env file is already in .gitignore and will not be committed to version control.'); 