/**
 * useWebBreakpoint — Responsive breakpoint hook for web only.
 *
 * Returns layout mode based on window width:
 *   - 'phone'  : width < 768px  (phone-size web)
 *   - 'tablet' : 768–1024px
 *   - 'desktop': > 1024px
 *
 * On native (Android/iOS) always returns 'native'.
 * Re-renders on window resize.
 */
import { useEffect, useState } from 'react';
import { Dimensions, Platform } from 'react-native';

export type WebBreakpoint = 'phone' | 'tablet' | 'desktop' | 'native';

const PHONE_MAX = 768;
const TABLET_MAX = 1024;

function getBreakpoint(): WebBreakpoint {
  if (Platform.OS !== 'web') return 'native';
  const { width } = Dimensions.get('window');
  if (width < PHONE_MAX) return 'phone';
  if (width < TABLET_MAX) return 'tablet';
  return 'desktop';
}

export function useWebBreakpoint(): WebBreakpoint {
  const [bp, setBp] = useState<WebBreakpoint>(getBreakpoint);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const sub = Dimensions.addEventListener('change', () => {
      setBp(getBreakpoint());
    });
    return () => sub.remove();
  }, []);

  return bp;
}
