/**
 * useUpdateCheck — Checks GitHub Releases for a newer APK/IPA build.
 *
 * Compares the app's build number (injected at CI time via
 * EXPO_PUBLIC_BUILD_NUMBER) against the build number embedded in the
 * latest GitHub Release's body. Shows a full-screen force update if
 * a newer version exists.
 *
 * Falls back to comparing EXPO_PUBLIC_BUILD_TIMESTAMP against
 * the release's published_at date if build numbers aren't available.
 *
 * This is a FORCE UPDATE — the app is fully blocked until the user reinstalls.
 * Only runs on native (sideloaded APK/IPA). Web skips the check.
 */
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

const REPO = 'Jrtowers-prog/PlymHack2026New';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/tags/latest`;
const APK_URL = `https://github.com/${REPO}/releases/download/latest/SafeNightHome.apk`;
const IPA_URL = `https://github.com/${REPO}/releases/download/latest/SafeNightHome.ipa`;

// Injected at build time by CI; falls back to empty string in dev
const BUILD_TIMESTAMP = process.env.EXPO_PUBLIC_BUILD_TIMESTAMP ?? '';
const BUILD_NUMBER = process.env.EXPO_PUBLIC_BUILD_NUMBER ?? '';

/** Extract BUILD_NUMBER=<digits> from the release body text */
function parseBuildNumber(body: string | null | undefined): string | null {
  if (!body) return null;
  const match = body.match(/BUILD_NUMBER=(\d+)/);
  return match?.[1] ?? null;
}

export interface UpdateInfo {
  /** Whether a force update is required (blocks the entire app) */
  forceUpdate: boolean;
  /** Whether an update is available (kept for backward compat) */
  available: boolean;
  /** Dismiss the update banner (no-op in force mode) */
  dismiss: () => void;
  /** Open the APK/IPA download link */
  download: () => void;
}

export function useUpdateCheck(): UpdateInfo {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only check on native (sideloaded APK / IPA)
    if (Platform.OS === 'web') return;

    // If neither build number nor timestamp is set, this is a dev build — skip
    if (!BUILD_NUMBER && !BUILD_TIMESTAMP) {
      console.log('[useUpdateCheck] ⏭️ Dev build (no build number or timestamp) — skipping update check');
      return;
    }

    const check = async () => {
      try {
        console.log(`[useUpdateCheck] 🔍 Checking for updates... (build number: ${BUILD_NUMBER || 'none'}, timestamp: ${BUILD_TIMESTAMP || 'none'})`);

        const res = await fetch(RELEASES_API, {
          headers: { Accept: 'application/vnd.github.v3+json' },
        });

        if (!res.ok) {
          console.warn(`[useUpdateCheck] ⚠️ GitHub API returned ${res.status} ${res.statusText}`);
          return;
        }

        const data = await res.json();

        // ── Strategy 1: Compare build numbers (preferred, reliable) ──────
        const releaseBuildNumber = parseBuildNumber(data.body);

        if (BUILD_NUMBER && releaseBuildNumber) {
          const local = parseInt(BUILD_NUMBER, 10);
          const remote = parseInt(releaseBuildNumber, 10);
          console.log(`[useUpdateCheck] 📊 Build numbers — local: ${local}, remote: ${remote}`);

          if (remote > local) {
            console.log('[useUpdateCheck] 🚨 Newer build detected via build number — forcing update');
            setAvailable(true);
            return;
          }
          console.log('[useUpdateCheck] ✅ App is up to date (build number)');
          return;
        }

        // ── Strategy 2: Fall back to timestamp comparison ────────────────
        const publishedAt = data.published_at;
        if (!publishedAt || !BUILD_TIMESTAMP) {
          console.log('[useUpdateCheck] ⏭️ No published_at or build timestamp — cannot compare');
          return;
        }

        const buildDate = new Date(BUILD_TIMESTAMP).getTime();
        const releaseDate = new Date(publishedAt).getTime();
        console.log(`[useUpdateCheck] 📊 Timestamps — build: ${BUILD_TIMESTAMP}, release: ${publishedAt}`);

        // If the release is more than 2 minutes newer than this build
        if (releaseDate > buildDate + 120_000) {
          console.log('[useUpdateCheck] 🚨 Newer build detected via timestamp — forcing update');
          setAvailable(true);
        } else {
          console.log('[useUpdateCheck] ✅ App is up to date (timestamp)');
        }
      } catch (err) {
        console.warn('[useUpdateCheck] ❌ Update check failed:', err);
      }
    };

    // Check after a short delay so it doesn't block app startup
    const timer = setTimeout(check, 3000);
    return () => clearTimeout(timer);
  }, []);

  return {
    // Force update — always blocks (cannot dismiss)
    forceUpdate: available,
    available: available && !dismissed,
    dismiss: () => setDismissed(true),
    download: () => Linking.openURL(Platform.OS === 'ios' ? IPA_URL : APK_URL),
  };
}
