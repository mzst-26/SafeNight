import { useEffect } from 'react';

/**
 * Auto-update hook for Expo Updates (OTA updates).
 * 
 * Checks for updates on app launch and every time the app comes to foreground.
 * Downloads and installs updates in the background automatically.
 * 
 * Usage: Add `useAutoUpdate();` to your root _layout.tsx
 */
export function useAutoUpdate() {
  useEffect(() => {
    // Never attempt to load expo-updates in dev mode — native module is not available
    if (__DEV__) return;

    // Dynamically import expo-updates to avoid errors in dev mode
    let Updates: typeof import('expo-updates') | null = null;
    try {
      Updates = require('expo-updates');
    } catch {
      return;
    }

    if (!Updates?.isEnabled) return;

    const UpdatesModule = Updates;

    async function checkAndApplyUpdates() {
      if (!UpdatesModule) return;
      
      try {
        console.log('[Updates] Checking for updates...');
        const update = await UpdatesModule.checkForUpdateAsync();

        if (update.isAvailable) {
          console.log('[Updates] New update available, downloading...');
          await UpdatesModule.fetchUpdateAsync();
          console.log('[Updates] Update downloaded, reloading app...');
          
          // Reload the app to apply the update
          await UpdatesModule.reloadAsync();
        } else {
          console.log('[Updates] App is up to date');
        }
      } catch (error) {
        console.error('[Updates] Error checking for updates:', error);
      }
    }

    // Check for updates immediately on mount
    checkAndApplyUpdates();

    // Set up periodic checks (every 30 minutes)
    const interval = setInterval(checkAndApplyUpdates, 30 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);
}

/**
 * Manual update check function.
 * Use this to allow users to manually check for updates.
 * 
 * Returns: { hasUpdate: boolean, updated: boolean }
 */
export async function checkForManualUpdate(): Promise<{
  hasUpdate: boolean;
  updated: boolean;
  error?: string;
}> {
  let Updates: typeof import('expo-updates') | null = null;
  try {
    Updates = require('expo-updates');
  } catch {
    return {
      hasUpdate: false,
      updated: false,
      error: 'expo-updates not available',
    };
  }

  if (__DEV__ || !Updates?.isEnabled) {
    return {
      hasUpdate: false,
      updated: false,
      error: 'Updates are disabled in development mode',
    };
  }

  try {
    const update = await Updates.checkForUpdateAsync();

    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
      return { hasUpdate: true, updated: true };
    }

    return { hasUpdate: false, updated: false };
  } catch (error) {
    console.error('[Updates] Manual update check failed:', error);
    return {
      hasUpdate: false,
      updated: false,
      error: error instanceof Error ? error.message : 'Failed to check for updates',
    };
  }
}
