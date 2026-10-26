// Custom transition configurations for smooth navigation
export const transitionConfigs = {
  // Default slide transition - smooth and consistent
  slideFromRight: {
    animation: 'slide_from_right' as const,
    animationDuration: 300,
    gestureEnabled: true,
    gestureDirection: 'horizontal' as const,
  },

  // Fade transition for splash screens and loading
  fade: {
    animation: 'fade' as const,
    animationDuration: 300,
    gestureEnabled: false,
  },

  // Bottom slide transition (if needed for specific cases)
  slideFromBottom: {
    animation: 'slide_from_bottom' as const,
    animationDuration: 300,
    gestureEnabled: true,
    gestureDirection: 'vertical' as const,
  },

  // Quick transition for tab switches
  tabSwitch: {
    animation: 'slide_from_right' as const,
    animationDuration: 250,
    gestureEnabled: false,
  },

  // Smooth transition for auth flows
  auth: {
    animation: 'slide_from_right' as const,
    animationDuration: 300,
    gestureEnabled: true,
    gestureDirection: 'horizontal' as const,
  },

  // Admin transition - same smooth feel as other screens
  admin: {
    animation: 'slide_from_right' as const,
    animationDuration: 300,
    gestureEnabled: true,
    gestureDirection: 'horizontal' as const,
  },
};

// Helper function to get transition config by type
export const getTransitionConfig = (type: keyof typeof transitionConfigs) => {
  return transitionConfigs[type];
};
