// Dynamic Expo configuration — injects environment variables at build time
// so no API keys are hardcoded in app.json or committed to git.
const appJson = require('./app.json');

module.exports = ({ config }) => {
  const baseConfig = appJson.expo || config || {};
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

  return {
    ...baseConfig,
    android: {
      ...(baseConfig.android || {}),
      ...(googleMapsApiKey
        ? {
            config: {
              ...(baseConfig.android?.config || {}),
              googleMaps: {
                apiKey: googleMapsApiKey,
              },
            },
          }
        : {}),
    },
  };
};

