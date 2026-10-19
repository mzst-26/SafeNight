/**
 * /how-it-works — Web-only explainer of how SafeNight scores walking routes.
 * Opens with the answer-first entity definition, then one H2 per question.
 */
import ContentPage, { Bullets, H2, P, SafetyDisclaimer } from '@/src/components/seo/ContentPage';
import { SiteFooterLinks } from '@/src/components/seo/SiteFooterLinks';
import { SEO } from '@/src/config/seo';
import { Link } from 'expo-router';

const linkStyle = { color: '#1570EF', fontWeight: '600' } as const;

export default function HowItWorksPage() {
  return (
    <ContentPage
      path="/how-it-works"
      title="How SafeNight scores walking routes for safety"
      lead={SEO.entityDefinition}
    >
      <H2>What does SafeNight score?</H2>
      <P>
        Each street segment is rated on six factors. The weights change between late night (0 to 5
        am), evening (6 pm to midnight) and daytime, so the same street can score differently at
        different times.
      </P>
      <Bullets
        items={[
          'Crime: recent police-reported incidents nearby, weighted by severity.',
          'Street lighting: lamp density, lamp quality and roads tagged as lit.',
          'CCTV coverage: mapped CCTV cameras nearby.',
          'Road type: main roads score safer than footpaths and alleys.',
          'Open businesses: shops and cafés nearby, which reduces risk.',
          'Foot traffic: an estimate of how many people are likely to be around.',
        ]}
      />

      <H2>Where does the data come from?</H2>
      <P>
        Crime data comes from the UK Police data portal, which covers England and Wales. Lighting,
        road, CCTV, shop and transit information comes from OpenStreetMap, read through the Overpass
        API. Crime data is only available where that portal publishes it, so scores are not
        available in every area. See the <Link href="/faq" style={linkStyle}>FAQ</Link> for more on
        coverage.
      </P>

      <H2>How are routes chosen?</H2>
      <P>
        SafeNight searches for walking routes with a cost that includes safety, and offers three to
        five alternatives, removing near-duplicates. Each route is split into short segments of
        roughly 50 to 80 metres, coloured green, yellow or red by risk. The route score is built
        from those segment risks.
      </P>

      <H2>Why can a safer route be longer?</H2>
      <P>
        The search does not only look for the shortest walk. Because safety is part of the cost, a
        safer route that avoids poorly lit or higher-risk streets can be longer than the most direct
        one.
      </P>

      <H2>What can&apos;t the score tell you?</H2>
      <P>
        A score is an estimate built from public data. It can be incomplete or out of date, and it
        does not guarantee that a route is safe. Compare the{' '}
        <Link href="/pricing" style={linkStyle}>plans</Link> or read the{' '}
        <Link href="/faq" style={linkStyle}>FAQ</Link>.
      </P>
      <SafetyDisclaimer />

      <SiteFooterLinks />
    </ContentPage>
  );
}
