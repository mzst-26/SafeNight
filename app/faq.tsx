/**
 * /faq — Web-only FAQ page. Questions and answers come from FAQ_ITEMS so the
 * visible text matches the FAQPage structured data built from the same array.
 */
import ContentPage, { H2, P } from '@/src/components/seo/ContentPage';
import { StructuredData, faqGraph } from '@/src/components/seo/StructuredData';
import { SiteFooterLinks } from '@/src/components/seo/SiteFooterLinks';
import { SEO } from '@/src/config/seo';
import { FAQ_ITEMS } from '@/src/content/faq';
import { Href, Link } from 'expo-router';
import { View } from 'react-native';

/** Optional link shown under a specific answer (keyed by exact question text) */
const FAQ_LINKS: Record<string, { href: string; label: string }> = {
  'How do I delete my account?': {
    href: '/delete-account',
    label: 'Account deletion steps (/delete-account)',
  },
};

export default function FaqPage() {
  return (
    <ContentPage
      path="/faq"
      title="SafeNight FAQ"
      lead={SEO.entityDefinition}
    >
      <StructuredData data={faqGraph()} />
      {FAQ_ITEMS.map((item) => {
        const link = FAQ_LINKS[item.question];
        return (
          <View key={item.question}>
            <H2>{item.question}</H2>
            <P>{item.answer}</P>
            {link ? (
              <P>
                <Link href={link.href as Href} style={{ color: '#1570EF', fontWeight: '600' }}>
                  {link.label}
                </Link>
              </P>
            ) : null}
          </View>
        );
      })}
      <SiteFooterLinks />
    </ContentPage>
  );
}
