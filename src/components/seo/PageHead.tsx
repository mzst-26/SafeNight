/**
 * Reusable SEO <Head> wrapper that sets per-page title, description,
 * canonical URL, and Open Graph overrides on web.
 *
 * Usage:
 *   <PageHead path="/privacy" />          — uses PAGE_SEO defaults
 *   <PageHead path="/" title="Custom" />  — override individual fields
 */
import { PAGE_SEO, SEO } from '@/src/config/seo';
import Head from 'expo-router/head';
import { Platform } from 'react-native';

interface PageHeadProps {
  /** Expo Router pathname, e.g. "/" or "/privacy" */
  path: string;
  /** Override the default title */
  title?: string;
  /** Override the default description */
  description?: string;
}

export function PageHead({ path, title, description }: PageHeadProps) {
  // Only render on web — native platforms ignore <Head>
  if (Platform.OS !== 'web') return null;

  const pageSeo = PAGE_SEO[path];
  const pageTitle = title ?? pageSeo?.title ?? SEO.title;
  const pageDesc = description ?? pageSeo?.description ?? SEO.description;
  const canonical = `${SEO.siteUrl}${path === '/' ? '' : path}`;

  return (
    <Head>
      <title>{pageTitle}</title>
      <meta name="title" content={pageTitle} />
      <meta name="description" content={pageDesc} />
      <link rel="canonical" href={canonical} />

      {/* Open Graph overrides */}
      <meta property="og:url" content={canonical} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={pageDesc} />

      {/* Twitter overrides */}
      <meta name="twitter:url" content={canonical} />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={pageDesc} />
    </Head>
  );
}
