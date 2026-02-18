/**
 * playIntegrity.ts — Play Integrity API service (Android only).
 *
 * Requests a device/app attestation token from Google Play Integrity and
 * returns it so it can be sent to the SafeNight backend for verification.
 *
 * On non-Android platforms this is a no-op (returns null) so the same call
 * site works on iOS and web without conditional checks everywhere.
 */
import { NativeModules, Platform } from 'react-native';

const { PlayIntegrity } = NativeModules;

export interface IntegrityResult {
  token: string;
  nonce: string;
}

/**
 * Generate a simple random nonce. In production the nonce should ideally be
 * server-issued (so the backend can correlate it), but a client-generated
 * nonce still prevents token reuse for the "basics" tier.
 */
function generateNonce(): string {
  const array = new Uint8Array(24);
  // React Native doesn't have crypto.getRandomValues globally in all versions,
  // so we build a random string from Math.random as a fallback.
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += Math.floor(Math.random() * 36).toString(36);
  }
  // Base64-url encode a timestamp + random to ensure ≥ 16 bytes
  return btoa(`${Date.now()}-${nonce}`).replace(/[+/=]/g, (c) =>
    c === '+' ? '-' : c === '/' ? '_' : '',
  );
}

/**
 * Request a Play Integrity token.
 * Returns null on non-Android platforms or if the native module is unavailable
 * (e.g. debug builds without Play Services, emulators).
 */
export async function requestIntegrityToken(): Promise<IntegrityResult | null> {
  if (Platform.OS !== 'android') return null;
  if (!PlayIntegrity?.requestIntegrityToken) return null;

  try {
    const nonce = generateNonce();
    const token: string = await PlayIntegrity.requestIntegrityToken(nonce);
    return { token, nonce };
  } catch (err) {
    // Non-fatal on emulators / sideloaded builds — degrade gracefully
    if (__DEV__) {
      console.warn('[PlayIntegrity] Token request failed (expected on emulators):', err);
    }
    return null;
  }
}

/**
 * Build an Authorization-compatible header object for attaching the
 * integrity token to a backend request.
 *
 * Usage:
 *   const headers = await getIntegrityHeaders();
 *   fetch(url, { headers: { ...baseHeaders, ...headers } });
 */
export async function getIntegrityHeaders(): Promise<Record<string, string>> {
  const result = await requestIntegrityToken();
  if (!result) return {};
  return { 'X-Integrity-Token': result.token };
}
