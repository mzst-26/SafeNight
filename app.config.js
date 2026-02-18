module.exports = ({ config }) => {
  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        NSLocationWhenInUseUsageDescription:
          'We use your location to show nearby routes and help you navigate safely.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'SafeNight needs background location access to keep navigating and sharing your location with your Safety Circle even when the app is in the background.',
        NSLocationAlwaysUsageDescription:
          'SafeNight needs background location access to continue navigation and live location sharing.',
        UIBackgroundModes: ['location', 'fetch'],
      },
    },
    android: {
      ...config.android,
      permissions: Array.from(
        new Set([
          ...(config.android?.permissions ?? []),
          'ACCESS_FINE_LOCATION',
          'ACCESS_COARSE_LOCATION',
          'ACCESS_BACKGROUND_LOCATION',
          'FOREGROUND_SERVICE',
          'FOREGROUND_SERVICE_LOCATION',
        ])
      ),
    },
  };
};
