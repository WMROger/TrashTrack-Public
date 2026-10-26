# Authentication Screens

This document describes the new authentication screens implemented for TrashTrack.

## Overview

The authentication system now includes three main screens:
1. **Auth Choice Screen** (`/auth`) - Main entry point with options to login or signup
2. **Login Screen** (`/login`) - User login with email/password and social options
3. **Signup Screen** (`/signup`) - User registration with email/password confirmation

## Design Features

### Visual Design
- **Light green background** (`#E8F5E8`) matching the TrashTrack brand
- **Clean, modern UI** with rounded corners and proper spacing
- **Consistent color scheme** using the app's color constants
- **Responsive design** with proper keyboard handling

### Login Screen Features
- Email and password input fields
- Remember me checkbox
- Forgot password link
- Primary login button
- Social login options (Google, Facebook)
- Link to signup page

### Signup Screen Features
- Email, password, and confirm password fields
- Remember me checkbox
- Primary signup button
- Social signup options (Google, Facebook)
- Link to login page

### Common Features
- Back navigation to previous screen
- Form validation
- Loading states
- Error handling with alerts
- Keyboard-aware scrolling

## Navigation Flow

```
Splash Screen → Auth Choice → Login/Signup → Main App (Tabs)
     ↑              ↑           ↑
     └──────────────┴───────────┘
        (Back navigation)
```

## File Structure

```
app/
├── auth.tsx          # Main auth choice screen
├── login.tsx         # Login route
└── signup.tsx        # Signup route

components/
├── LoginScreen.tsx   # Login screen component
├── SignupScreen.tsx  # Signup screen component
└── index.ts         # Component exports
```

## Usage

### Basic Navigation
```typescript
import { useRouter } from 'expo-router';

const router = useRouter();

// Navigate to login
router.push('/login');

// Navigate to signup
router.push('/signup');

// Go back
router.back();
```

### Component Usage
```typescript
import { LoginScreen, SignupScreen } from '@/components';

// Use in your app
<LoginScreen />
<SignupScreen />
```

## Styling

The screens use a consistent design system with:
- **Primary Color**: `#5B7C67` (TrashTrack green)
- **Background**: `#E8F5E8` (Light green)
- **Input Fields**: White with light gray borders
- **Buttons**: Rounded corners with proper padding
- **Typography**: Consistent font sizes and weights

## Future Enhancements

- [ ] Real authentication integration with Firebase
- [ ] Social login implementation (Google, Facebook)
- [ ] Password strength validation
- [ ] Email verification flow
- [ ] Biometric authentication support
- [ ] Dark mode support

## Notes

- Currently uses simulated authentication (1-second delay)
- Social login buttons show placeholder alerts
- Form validation is basic but functional
- Designed to be easily extensible for real authentication
