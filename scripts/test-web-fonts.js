// Web Font Loading Test
// This script can be run in the browser console to test font loading

console.log('🔍 Testing font loading...');

// Check if Material Icons is loaded
function checkMaterialIcons() {
  const testElement = document.createElement('div');
  testElement.style.fontFamily = 'Material Icons';
  testElement.innerHTML = '&#xe88a;'; // Material Icons home icon
  testElement.style.visibility = 'hidden';
  document.body.appendChild(testElement);
  
  const computedStyle = window.getComputedStyle(testElement);
  const fontFamily = computedStyle.getPropertyValue('font-family');
  
  document.body.removeChild(testElement);
  
  const hasMaterialIcons = fontFamily.includes('Material Icons');
  console.log(`Material Icons loaded: ${hasMaterialIcons ? '✅' : '❌'}`);
  console.log(`Font family: ${fontFamily}`);
  
  return hasMaterialIcons;
}

// Check if Google Fonts link exists
function checkGoogleFontsLink() {
  const link = document.querySelector('link[href*="googleapis.com"]');
  const hasLink = !!link;
  console.log(`Google Fonts link present: ${hasLink ? '✅' : '❌'}`);
  if (link) {
    console.log(`Font URL: ${link.href}`);
  }
  return hasLink;
}

// Main test function
function testFontLoading() {
  console.log('=== Font Loading Test Results ===');
  
  const hasGoogleFontsLink = checkGoogleFontsLink();
  const hasMaterialIcons = checkMaterialIcons();
  
  if (hasGoogleFontsLink && hasMaterialIcons) {
    console.log('🎉 All fonts loaded successfully!');
  } else {
    console.log('⚠️ Some fonts may not be loading properly');
    
    if (!hasGoogleFontsLink) {
      console.log('💡 Try adding Google Fonts link to HTML head');
    }
    
    if (!hasMaterialIcons) {
      console.log('💡 Material Icons font may not be available');
    }
  }
}

// Run test after a short delay to allow fonts to load
setTimeout(testFontLoading, 1000);

// Export for manual testing
if (typeof window !== 'undefined') {
  window.testFontLoading = testFontLoading;
  console.log('💡 You can run testFontLoading() manually in the console');
}