/**
 * JSON-LD structured data for web pages.
 *
 * `StructuredData` puts one <script type="application/ld+json"> in the
 * document head via expo-router/head. PageHead emits the default graph for
 * indexable pages the same way. The script body is passed as a text child,
 * because the vendored react-helmet-async reads a <script> body only from its
 * text children (dangerouslySetInnerHTML is ignored and the tag is dropped).
 *
 * Every graph is built only from SEO, PAGE_SEO, FAQ_ITEMS, PLANS and facts in
 * README.md. Every @id is an absolute URL. Do not add aggregateRating, review,
 * Person, contactPoint, HowTo or SearchAction.
 */
import { PAGE_SEO, SEO } from '@/src/config/seo';
import { FAQ_ITEMS } from '@/src/content/faq';
import { FACTOR_NAMES } from '@/src/content/factors';
import { PLANS } from '@/src/content/pricing';
import Head from 'expo-router/head';
import { Platform } from 'react-native';

const CONTEXT = 'https://schema.org';
const HOME_URL = `${SEO.siteUrl}/`;
const ORGANIZATION_ID = `${SEO.siteUrl}/#organization`;
const WEBSITE_ID = `${SEO.siteUrl}/#website`;
const APP_ID = `${SEO.siteUrl}/#app`;

/** Short breadcrumb labels for pages that get a BreadcrumbList */
export const BREADCRUMB_NAMES: Record<string, string> = {
  '/privacy': 'Privacy Policy',
  '/terms': 'Terms',
  '/refund': 'Refund Policy',
  '/delete-account': 'Delete Account',
  '/how-it-works': 'How it works',
  '/faq': 'FAQ',
  '/pricing': 'Pricing',
  '/about': 'About',
};

/** Factors (FACTOR_NAMES) and features named in README.md (Live Location Sharing, Safety Circle) */
const FEATURE_LIST = [
  ...FACTOR_NAMES.map((factor) => `${factor} scoring`),
  'Live location sharing',
  'Safety Circle',
];

/** Serialise JSON-LD for a <script> body. Escapes "<" so content cannot close the tag. */
export function jsonLdHtml(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Renders a JSON-LD block in the document head. Web only. */
export function StructuredData({ data }: { data: object }) {
  if (Platform.OS !== 'web') return null;

  return (
    <Head>
      <script type="application/ld+json">{jsonLdHtml(data)}</script>
    </Head>
  );
}

const organization = {
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: SEO.siteName,
  url: HOME_URL,
  logo: {
    '@type': 'ImageObject',
    url: `${SEO.siteUrl}/logo.png`,
    width: 1024,
    height: 1024,
  },
  sameAs: [SEO.appStore.android],
};

const website = {
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  url: HOME_URL,
  name: SEO.siteName,
  inLanguage: 'en-GB',
  publisher: { '@id': ORGANIZATION_ID },
};

/** One Offer per plan with a price. Free is included with price "0". */
function planOffers() {
  return PLANS.flatMap((plan) =>
    plan.priceGbp === null
      ? []
      : [
          {
            '@type': 'Offer',
            name: plan.name,
            price: String(plan.priceGbp),
            priceCurrency: 'GBP',
            // Group plans price per member, so the description states the per-member basis and the minimum group size.
            description: plan.minMembers
              ? `${plan.description} Priced per member per month, with a minimum of ${plan.minMembers} members including the owner.`
              : plan.description,
            // Paid plans are per month. Group plans price per member, so state the minimum group size.
            ...(plan.period !== null
              ? {
                  priceSpecification: {
                    '@type': 'UnitPriceSpecification',
                    price: String(plan.priceGbp),
                    priceCurrency: 'GBP',
                    referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' },
                    ...(plan.minMembers
                      ? {
                          eligibleQuantity: {
                            '@type': 'QuantitativeValue',
                            minValue: plan.minMembers,
                            unitText: 'members',
                          },
                        }
                      : {}),
                  },
                }
              : {}),
          },
        ]
  );
}

/** Home page graph: Organization, WebSite, WebPage and the app itself. */
export function homeGraph() {
  return {
    '@context': CONTEXT,
    '@graph': [
      organization,
      website,
      {
        '@type': 'WebPage',
        '@id': `${HOME_URL}#webpage`,
        url: HOME_URL,
        name: PAGE_SEO['/'].title,
        description: PAGE_SEO['/'].description,
        isPartOf: { '@id': WEBSITE_ID },
        about: { '@id': APP_ID },
        inLanguage: 'en-GB',
      },
      {
        '@type': 'MobileApplication',
        '@id': APP_ID,
        name: SEO.siteName,
        url: HOME_URL,
        description: SEO.description,
        applicationCategory: 'NavigationApplication',
        operatingSystem: 'Android, Web',
        installUrl: SEO.appStore.android,
        inLanguage: 'en-GB',
        featureList: FEATURE_LIST,
        offers: planOffers(),
        publisher: { '@id': ORGANIZATION_ID },
      },
    ],
  };
}

/** Info and legal page graph: WebPage plus BreadcrumbList (Home -> page). */
export function pageGraph(path: string, name: string, breadcrumbNames: [string, string]) {
  const url = `${SEO.siteUrl}${path}`;
  const breadcrumbId = `${url}#breadcrumb`;

  return {
    '@context': CONTEXT,
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name,
        description: PAGE_SEO[path]?.description,
        isPartOf: { '@type': 'WebSite', '@id': WEBSITE_ID, url: HOME_URL, name: SEO.siteName },
        inLanguage: 'en-GB',
        breadcrumb: { '@id': breadcrumbId },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': breadcrumbId,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: breadcrumbNames[0], item: HOME_URL },
          { '@type': 'ListItem', position: 2, name: breadcrumbNames[1], item: url },
        ],
      },
    ],
  };
}

/** FAQPage for /faq, built from FAQ_ITEMS so it matches the visible answers exactly. */
export function faqGraph() {
  const url = `${SEO.siteUrl}/faq`;

  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    url,
    inLanguage: 'en-GB',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}
