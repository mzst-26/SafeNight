/**
 * /about — Web-only page describing what SafeNight is, why it exists and how to contact us.
 * Entity wording comes from SEO.entityDefinition so it matches the home page and structured data.
 */
import ContentPage, { H2, P, SafetyDisclaimer } from '@/src/components/seo/ContentPage';
import { SiteFooterLinks } from '@/src/components/seo/SiteFooterLinks';
import { SEO } from '@/src/config/seo';
import { Href, Link } from 'expo-router';
import { StyleSheet } from 'react-native';

export default function AboutPage() {
  return (
    <ContentPage path="/about" title="About SafeNight" lead={SEO.entityDefinition}>
      <H2>Why SafeNight exists</H2>
      <P>
        SafeNight is for people walking at night who want to choose a safer route, not only the
        quickest one. It compares walking routes and shows how each one scores on the factors
        that matter after dark, so you can make an informed choice before you set off.
      </P>

      <H2>Where SafeNight is based</H2>
      <P>SafeNight&apos;s legal notices give its location as Plymouth, UK.</P>

      <H2>How it uses public data</H2>
      <P>
        SafeNight uses public data to score streets. This includes UK Police street-level crime
        data for England and Wales, and OpenStreetMap data for roads, street lighting, CCTV,
        transit and open businesses. Read{' '}
        <Link href={'/how-it-works' as Href} style={styles.link}>
          how SafeNight scores walking routes
        </Link>{' '}
        for the full method.
      </P>

      <H2>Responsibility</H2>
      <P>
        SafeNight gives guidance, not guarantees. Scores are estimates from public data and can be
        out of date or incomplete. Always use your own judgement, and in an emergency call 999.
      </P>
      <SafetyDisclaimer />

      <H2>Contact</H2>
      <P>
        For questions about SafeNight, email{' '}
        <Link href={`mailto:${SEO.contactEmail}` as Href} style={styles.link}>
          {SEO.contactEmail}
        </Link>
        .
      </P>
      <P>
        To request deletion of your account and personal data, use the{' '}
        <Link href={'/delete-account' as Href} style={styles.link}>
          delete account page
        </Link>
        .
      </P>

      <SiteFooterLinks />
    </ContentPage>
  );
}

const styles = StyleSheet.create({
  link: {
    color: '#1570EF',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
