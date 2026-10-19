/**
 * /pricing — Web-only plan comparison page.
 * Plan data lives in src/content/pricing.ts (verified against README and code).
 */
import ContentPage, { H2, H3, P, Bullets } from '@/src/components/seo/ContentPage';
import { SiteFooterLinks } from '@/src/components/seo/SiteFooterLinks';
import { FAMILY_PLAN, GUARDED_PLAN, PLANS, type PricingPlan } from '@/src/content/pricing';
import { Href, Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

function formatPrice(plan: PricingPlan): string {
  if (plan.priceGbp === null) return 'Price not set';
  if (plan.priceGbp === 0) return 'Free';
  const amount = `£${plan.priceGbp.toFixed(2)}`;
  return plan.period ? `${amount} per ${plan.period}` : amount;
}

// Answer-first lead. Every price comes from PLANS via formatPrice.
const PRICING_LEAD = `SafeNight has three plans: Free, Guarded at ${formatPrice(GUARDED_PLAN)} and the Family Pack at ${formatPrice(FAMILY_PLAN)} per user for groups of at least ${FAMILY_PLAN.minMembers} people. Both paid plans include a 14-day cooling-off period on your first paid subscription, and every price is in GBP.`;

export default function PricingPage() {
  return (
    <ContentPage path="/pricing" title="SafeNight pricing" lead={PRICING_LEAD}>
      <H2>Compare the plans</H2>
      <P>All prices are in GBP.</P>

      {PLANS.map((plan) => (
        <View key={plan.name} style={styles.card}>
          <H3>{plan.name}</H3>
          <Text style={styles.price}>{formatPrice(plan)}</Text>
          <P>{plan.description}</P>
          {plan.minMembers ? (
            <P>Minimum {plan.minMembers} members, including the owner.</P>
          ) : null}
          <Bullets items={plan.features} />
        </View>
      ))}

      <H2>Refunds and cancellation</H2>
      <P>
        Guarded and the Family Pack include a 14-day cooling-off period. If you cancel within 14
        days of your first-ever paid subscription, you get a full refund. This is a one-time
        entitlement. After that, fees are generally non-refundable once the billing period has
        started, and your plan stays active until the end of that period.
      </P>
      <P>
        Prices include VAT where the law requires it. For the full terms, including refund
        exceptions and how to request a refund, read the{' '}
        <Link href="/refund" style={styles.link}>
          Refund & Payment Policy
        </Link>
        .
      </P>
      <P>
        To see how the safety scores behind these features are worked out, read{' '}
        <Link href={'/how-it-works' as Href} style={styles.link}>
          how SafeNight scores walking routes
        </Link>
        .
      </P>

      <SiteFooterLinks />
    </ContentPage>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    backgroundColor: '#F8FAFC',
  },
  price: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1570EF',
    marginBottom: 8,
  },
  link: {
    color: '#1570EF',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
