/**
 * Centralised SEO constants used by +html.tsx, Head components, and
 * structured data across the app.
 *
 * Update these once and every page inherits the correct values.
 */

export const SEO = {
  /** Canonical production URL (no trailing slash) */
  siteUrl: 'https://safenight.netlify.app',

  /** Default page title */
  title: 'SafeNight — Walk Safer at Night',

  /** ≤160 chars — shown in Google snippet */
  description:
    'SafeNight helps you find the safest walking route home at night. AI-powered safety scores, real-time navigation, live location sharing, and a Safety Circle to keep you connected.',

  /** Brand / org name */
  siteName: 'SafeNight',

  /** Twitter @handle (without @) */
  twitterHandle: 'safenightapp',

  /** Open Graph image (1200×630 recommended) */
  ogImage: '/og-image.png',

  /** Theme colour used in meta tags & manifest */
  themeColor: '#1570EF',

  /** Background colour for PWA splash */
  backgroundColor: '#FFFFFF',

  /** Default locale */
  locale: 'en_GB',

  /** App store links */
  appStore: {
    android:
      'https://play.google.com/store/apps/details?id=com.safenight.app',
    // ios: 'https://apps.apple.com/app/safenight/idXXXXXXXXXX',
  },

  /** Keywords for meta tag (comma-separated) */
  keywords:
    'safe walking route, night safety app, walk home safe, AI route safety, live location sharing, safety circle, pedestrian safety, SafeNight',
} as const;

/** Per-page overrides keyed by Expo Router pathname */
export const PAGE_SEO: Record<
  string,
  { title: string; description: string; canonical?: string }
> = {
  '/': {
    title: 'SafeNight — Walk Safer at Night | AI-Powered Route Safety',
    description:
      'Find the safest walking route home at night with AI-powered safety scores, street-light data, crime stats, and live navigation. Download SafeNight free on Android.',
  },
  '/privacy': {
    title: 'Privacy Policy — SafeNight',
    description:
      'Read SafeNight\'s privacy policy. Learn how we collect, use, and protect your personal data and location information.',
  },
  '/terms': {
    title: 'Terms & Conditions — SafeNight',
    description:
      'SafeNight terms and conditions of use. Understand your rights and responsibilities when using the SafeNight app and website.',
  },
  '/refund': {
    title: 'Refund & Payment Policy — SafeNight',
    description:
      'SafeNight refund and payment policy. Information about subscription billing, cancellations, and refund eligibility.',
  },
  '/delete-account': {
    title: 'Delete Your Account — SafeNight',
    description:
      'Request permanent deletion of your SafeNight account and all associated personal data. Two easy methods available.',
  },
};
