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
        Each street segment is scored on five factors, estimated from public data. The factors are
        combined into a route score from 0 to 100, where a higher score means a safer route.
      </P>
      <Bullets
        items={[
          'Street lighting: mapped lamps and lit tags. Where lighting is not mapped, it is estimated from the type of street and marked as estimated.',
          'Crime density: recent police-reported crime nearby, weighted by severity, so violent crime counts for more than theft.',
          'Road type: main roads are generally safer for walking than footpaths and alleys.',
          'Nearby activity: open places, CCTV cameras and transit stops close by.',
          'Isolation: how far a path is from roads and buildings, and whether it is a dead end. A remote path can be riskier after dark even when it is lit.',
        ]}
      />

      <H2>How does the time I walk change the score?</H2>
      <P>
        Darkness is worked out from the position of the sun at the time and place you walk, not from
        a fixed night-time schedule. A street that is daylit at 3 pm can be dark by 10 pm, and the
        score follows that. Whether a shop or café is open is also checked for the time you walk, in
        London time.
      </P>
      <P>
        You can choose Leave now, Leave at or Arrive by. For Arrive by, SafeNight works back from
        your arrival time to estimate when you start. Each route shows a timeline with its darkness
        at the start and at the destination: daylight, dusk, dark by arrival, or dark from the start.
      </P>

      <H2>How is crime counted?</H2>
      <P>
        SafeNight uses street-level crime data from the UK Police data portal. Each crime is weighted
        by its category. Crime is also compared with how many people are likely to be around, so a
        busy high street is not marked down simply for having more reported theft. Violent crime and
        robbery are never discounted this way. Police street data gives the month but not the time of
        day, so crime is not weighted by hour.
      </P>

      <H2>Where does the data come from?</H2>
      <P>
        Crime data comes from the UK Police data portal, which covers England and Wales. Lighting,
        road, CCTV, shop and transit information comes from OpenStreetMap, read through the Overpass
        API. Walking directions use OSRM and place search uses Nominatim. Crime data is only available
        where that portal publishes it, so scores are not available in every area. See the{' '}
        <Link href="/faq" style={linkStyle}>FAQ</Link> for more on coverage.
      </P>

      <H2>How are routes chosen?</H2>
      <P>
        SafeNight searches for several walking routes, including the most direct one, and ranks them.
        The ranking weighs how risky a route is against how long it is. A longer route is only
        recommended when it is clearly safer, because the extra distance counts against it. Routes
        more than twice as long as the shortest route are not recommended.
      </P>

      <H2>Why can a safer route be longer?</H2>
      <P>
        Safety is part of the search, not just an afterthought. A route that avoids dark, isolated or
        higher-risk streets can be longer than the most direct one. SafeNight shows how much longer
        and how much safer it is, so you can decide.
      </P>

      <H2>How do I read the score?</H2>
      <Bullets
        items={[
          'Score and label: a number from 0 to 100, with a label such as Very Safe, Safe, Moderate or Use Caution.',
          'Reason: on the recommended route, a line comparing it with the next best option, such as how much longer it is and how much higher it scores.',
          'Lighting: marked as Verified, Mostly mapped or Estimated. Estimated lighting is drawn as dashed lines on the map.',
          'Weakest stretch: the longest run of higher-risk street on a route, shown as a callout on the map when it is at least 50 metres.',
        ]}
      />

      <H2>What happens when data is missing?</H2>
      <P>
        If crime data cannot be retrieved, the route shows a &quot;Crime data unavailable&quot; notice.
        SafeNight does not treat a missing crime feed as a clean record. Scores in areas with thin
        mapping, or outside England and Wales, rely more on estimates, so treat them with extra care.
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
