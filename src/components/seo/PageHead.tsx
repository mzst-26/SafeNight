/**
 * Reusable SEO <Head> wrapper that sets per-page title, description,
 * canonical URL, and Open Graph overrides on web.
 *
 * Usage:
 *   <PageHead path="/privacy" />          — uses PAGE_SEO defaults
 *   <PageHead path="/" title="Custom" />  — override individual fields
 *   <PageHead path="/share" noindex />    — title plus noindex, no canonical
 */
import { PAGE_SEO, SEO } from '@/src/config/seo';
import { BREADCRUMB_NAMES, homeGraph, jsonLdHtml, pageGraph } from '@/src/components/seo/StructuredData';
import Head from 'expo-router/head';
import { Platform } from 'react-native';

interface PageHeadProps {
  /** Expo Router pathname, e.g. "/" or "/privacy" */
  path: string;
  /** Override the default title */
  title?: string;
  /** Override the default description */
  description?: string;
  /** Emit noindex,nofollow and no canonical or social URL tags */
  noindex?: boolean;
}

/**
 * Default JSON-LD for an indexable page: the home graph for "/", and a
 * WebPage plus BreadcrumbList for other pages listed in PAGE_SEO.
 */
function defaultJsonLd(path: string, name: string): object | null {
  if (path === '/') return homeGraph();
  if (!PAGE_SEO[path]) return null;
  return pageGraph(path, name, ['Home', BREADCRUMB_NAMES[path] ?? name]);
}

export function PageHead({ path, title, description, noindex = false }: PageHeadProps) {
  // Only render on web — native platforms ignore <Head>
  if (Platform.OS !== 'web') return null;

  const pageSeo = PAGE_SEO[path];
  const pageTitle = title ?? pageSeo?.title ?? SEO.title;
  const pageDesc = description ?? pageSeo?.description ?? SEO.description;

  if (noindex) {
    return (
      <Head>
        <title>{pageTitle}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
    );
  }

  const canonical = `${SEO.siteUrl}${path}`;
  const graph = defaultJsonLd(path, pageTitle);

  return (
    <Head>
      <title>{pageTitle}</title>
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

      {/* Structured data (JSON-LD). The vendored react-helmet-async reads the script body from its text child. */}
      {graph ? <script type="application/ld+json">{jsonLdHtml(graph)}</script> : null}
    </Head>
  );
}
