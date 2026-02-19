/**
 * RefundPolicyModal.tsx — Refund & Payment Policy modal.
 *
 * Covers all subscription payment, refund, and billing information.
 * The shared RefundPolicyContent component is also used by the /refund web page.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export const REFUND_LAST_UPDATED = '19 February 2026';

/** Shared policy content — rendered in the modal AND the /refund web page. */
export function RefundPolicyContent() {
  return (
    <>
      <Text style={styles.lastUpdated}>Last updated: {REFUND_LAST_UPDATED}</Text>

      <Text style={styles.body}>
        This Refund & Payment Policy applies to all purchases made through the SafeNight application
        ("Service"). By subscribing to a paid plan you agree to this policy alongside our Terms &
        Conditions and Privacy Policy.
      </Text>

      <Text style={styles.sectionTitle}>1. Subscription Plans</Text>
      <Text style={styles.body}>
        SafeNight offers the following paid subscription tiers:{'\n\n'}
        • <Text style={styles.bold}>Guarded (monthly)</Text> — billed monthly, auto-renewing.{'\n'}
        • <Text style={styles.bold}>Guarded (annual)</Text> — billed annually, auto-renewing.{'\n'}
        • <Text style={styles.bold}>Family Pack</Text> — multi-user plan, billed as a single
        subscription.{'\n\n'}
        All plans include a free-tier fallback — you may continue using limited features if you
        cancel or do not subscribe.
      </Text>

      <Text style={styles.sectionTitle}>2. Payment Processing</Text>
      <Text style={styles.body}>
        All payments are securely processed by <Text style={styles.bold}>Stripe</Text>, a PCI-DSS
        Level 1 certified payment provider. SafeNight does not store, access, or handle your
        payment card details directly.{'\n\n'}
        Accepted payment methods include major credit and debit cards (Visa, Mastercard, American
        Express) as well as any additional methods made available by Stripe in your region.{'\n\n'}
        Prices are displayed in GBP (£) and include any applicable VAT where required by law.
      </Text>

      <Text style={styles.sectionTitle}>3. Billing & Auto-Renewal</Text>
      <Text style={styles.body}>
        Subscriptions auto-renew at the end of each billing period (monthly or annual) unless you
        cancel before the renewal date. You will be charged using the payment method on file at the
        start of each renewal period.{'\n\n'}
        You will receive a payment receipt by email from Stripe after each successful charge. If a
        payment fails, we will retry up to three times within a short window; if all retries fail,
        your subscription will be downgraded to the free tier.
      </Text>

      <Text style={styles.sectionTitle}>4. Free Trial</Text>
      <Text style={styles.body}>
        Where a free trial is offered, no charge is made during the trial period. At the end of the
        trial, your subscription will automatically convert to a paid plan unless you cancel before
        the trial end date. Cancelling during the trial incurs no charge.
      </Text>

      <Text style={styles.sectionTitle}>5. Cancellation</Text>
      <Text style={styles.body}>
        You may cancel your subscription at any time through the subscription management screen
        within the SafeNight app (Profile → Manage Plan) or by contacting us at
        mzst.26.x@gmail.com.{'\n\n'}
        Cancellation takes effect at the end of the current billing period — you retain access to
        paid features until that date. No partial-period refunds are issued for cancellations made
        mid-cycle unless required by applicable consumer law.
      </Text>

      <Text style={styles.sectionTitle}>6. 14-Day Cooling-Off Period</Text>
      <Text style={styles.body}>
        In accordance with the Consumer Contracts Regulations 2013 (UK) and EU Directive
        2011/83/EU, new subscribers are entitled to a <Text style={styles.bold}>14-day cooling-off
        period on their first subscription only</Text>.{'\n\n'}
        If you cancel within 14 days of your <Text style={styles.bold}>first-ever</Text> paid
        subscription, you will receive an automatic, full refund and immediate cancellation.{'\n\n'}
        <Text style={styles.bold}>This cooling-off refund is a one-time entitlement.</Text> If you
        have previously subscribed, cancelled, and received a cooling-off refund, subsequent
        subscriptions are not eligible for the automatic refund. Instead, cancellation will take
        effect at the end of the current billing period with no refund.{'\n\n'}
        After using the cooling-off refund, a <Text style={styles.bold}>30-day cooldown
        period</Text> applies before you can re-subscribe. This policy exists to prevent abuse
        while still protecting first-time subscribers.
      </Text>

      <Text style={styles.sectionTitle}>7. Refund Policy</Text>
      <Text style={styles.body}>
        <Text style={styles.bold}>General: </Text>
        Due to the digital and immediately-consumable nature of our Service, all subscription fees
        are generally non-refundable once the billing period has commenced, except as described in
        the 14-day cooling-off period above.
      </Text>
      <Text style={styles.body}>
        <Text style={styles.bold}>Additional exceptions — you may be eligible for a refund
        if:{'\n'}</Text>
        • You were charged due to a verified technical error or duplicate transaction on our part.{'\n'}
        • We have experienced significant, prolonged service outages (more than 48 consecutive hours)
        during your billing period that materially prevented you from using the Service.
      </Text>
      <Text style={styles.body}>
        To request a refund, contact us at <Text style={styles.bold}>mzst.26.x@gmail.com</Text> with
        your account email and a brief description of the issue. We aim to respond within 5 business
        days. Approved refunds are processed back to your original payment method within 5–10
        business days.
      </Text>

      <Text style={styles.sectionTitle}>8. Gift Subscriptions</Text>
      <Text style={styles.body}>
        Gift subscriptions are granted manually and are non-transferable. They cannot be exchanged
        for cash. If a gift subscription was granted in error, contact us within 7 days and we will
        work to resolve the issue.
      </Text>

      <Text style={styles.sectionTitle}>9. Price Changes</Text>
      <Text style={styles.body}>
        We reserve the right to change subscription prices at any time. We will provide at least 30
        days advance notice of any price increase by email and/or in-app notification. Continued use
        of the Service after the new price takes effect constitutes acceptance of the new price. If
        you do not agree to a price change, you may cancel before the new price applies.
      </Text>

      <Text style={styles.sectionTitle}>10. Disputes</Text>
      <Text style={styles.body}>
        If you believe a charge was made in error or you have a billing dispute, please contact us
        before initiating a chargeback with your bank. Unjustified chargebacks may result in
        suspension of your account. We are committed to resolving legitimate billing issues quickly
        and fairly.
      </Text>

      <Text style={styles.sectionTitle}>11. Contact Us</Text>
      <Text style={styles.body}>
        For all payment and refund enquiries:{'\n\n'}
        Email: mzst.26.x@gmail.com{'\n'}
        SafeNight — Plymouth, UK{'\n\n'}
        Please include your account email address and, if available, the Stripe payment receipt
        number in your message so we can assist you as quickly as possible.
      </Text>
    </>
  );
}

export default function RefundPolicyModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Refund & Payment Policy</Text>
          <Pressable onPress={handleClose} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color="#1E293B" />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator
        >
          <RefundPolicyContent />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  lastUpdated: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 16,
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 24,
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#374151',
    marginBottom: 12,
  },
  bold: {
    fontWeight: '700',
  },
});
