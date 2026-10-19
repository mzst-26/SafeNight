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
  title: 'SafeNight – Safe Walking Route App for Walking Home at Night',

  /** ≤160 chars — shown in Google snippet */
  description:
    'Plan a safer walking route home. SafeNight scores streets on crime data, lighting, CCTV and foot traffic, with live location sharing. Free to start.',

  /** 40–60 word definition of SafeNight, used for the entity and About page */
  entityDefinition:
    'SafeNight is a walking app that helps pedestrians find safer routes at night. It scores each street segment on six factors: crime density, street lighting, CCTV coverage, road type, open businesses and foot traffic. It suggests alternative routes with turn-by-turn navigation, runs on Android and the web, and has a free tier.',

  /** Public contact address (as published in the delete-account page) */
  contactEmail: 'mzst.26.x@gmail.com',

  /** Brand / org name */
  siteName: 'SafeNight',

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
  },
} as const;

/** Per-page overrides keyed by Expo Router pathname */
export const PAGE_SEO: Record<
  string,
  { title: string; description: string; canonical?: string }
> = {
  '/': {
    title: 'SafeNight – Safe Walking Route App for Walking Home at Night',
    description:
      'Plan a safer walking route home. SafeNight scores streets on crime data, lighting, CCTV and foot traffic, with live location sharing. Free to start.',
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
  '/how-it-works': {
    title: 'How SafeNight Scores Walking Routes for Safety',
    description:
      'See how SafeNight rates walking routes at night using six factors: crime, street lighting, CCTV, road type, open businesses and foot traffic.',
  },
  '/faq': {
    title: 'SafeNight FAQ – Safe Walking Route App Questions',
    description:
      'Answers about SafeNight: what it is, whether it is free, which devices it runs on, how routes are scored, and how your location is used.',
  },
  '/pricing': {
    title: 'SafeNight Pricing – Free, Guarded and Family Plans',
    description:
      "Compare SafeNight's Free, Guarded and Family plans, with monthly prices and how refunds work.",
  },
  '/about': {
    title: 'About SafeNight – Safe Walking Routes',
    description:
      'Who builds SafeNight, why it exists, and how it uses public data to help people choose safer walking routes at night.',
  },
};
