/**
 * PrivacyPolicyModal.tsx — Full privacy policy accessible from ProfileMenu.
 *
 * Google Play requires a privacy policy for apps that collect location
 * or personal data. This modal provides the in-app version; the same
 * text should be hosted at a public URL for the Store Listing.
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

const LAST_UPDATED = '16 February 2026';

export default function PrivacyPolicyModal({ visible, onClose }: Props) {
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
          <Text style={styles.headerTitle}>Privacy Policy</Text>
          <Pressable onPress={handleClose} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color="#1E293B" />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator
        >
          <Text style={styles.lastUpdated}>Last updated: {LAST_UPDATED}</Text>

          <Text style={styles.body}>
            SafeNight ("we", "our", "us") is committed to protecting your privacy. This Privacy
            Policy explains how we collect, use, store, and share your personal information when you
            use the SafeNight mobile application (the "App").
          </Text>

          <Text style={styles.sectionTitle}>1. Information We Collect</Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>Location Data: </Text>
            We collect your device's precise location (GPS) while the App is in the foreground to
            provide route navigation, safety scoring, and nearby point-of-interest features. We do
            NOT collect location data when the App is in the background.
          </Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>Account Information: </Text>
            When you create an account, we collect your email address and optional display name. We
            use passwordless magic-link authentication — we never store passwords.
          </Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>Usage Data: </Text>
            We log anonymised usage events (e.g. app opens, routes searched) to improve the service.
            These events are tied to your account but do not contain route coordinates.
          </Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>Payment Information: </Text>
            If you subscribe to a paid plan, payment is processed entirely by Stripe. We do not
            store your card number or payment details. We only store your Stripe customer ID and
            subscription status.
          </Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>Safety Circle: </Text>
            When you use the Safety Circle feature, your live location is shared with contacts you
            explicitly invite during active tracking sessions that you initiate. This sharing stops
            when you end the session.
          </Text>

          <Text style={styles.sectionTitle}>2. How We Use Your Information</Text>
          <Text style={styles.body}>
            • Provide route navigation and safety score calculations{'\n'}
            • Enable live location sharing with your Safety Circle contacts{'\n'}
            • Process subscription payments via Stripe{'\n'}
            • Send magic-link authentication emails{'\n'}
            • Improve app performance and features through anonymised analytics{'\n'}
            • Respond to support requests
          </Text>

          <Text style={styles.sectionTitle}>3. Data Sharing</Text>
          <Text style={styles.body}>
            We do NOT sell your personal data to third parties. We share data only in the following
            circumstances:{'\n\n'}
            • <Text style={styles.bold}>Safety Circle contacts</Text> — your live location, only
            during active sharing sessions you initiate.{'\n'}
            • <Text style={styles.bold}>Stripe</Text> — your email address to create a payment
            customer record when you subscribe.{'\n'}
            • <Text style={styles.bold}>Supabase</Text> — our database and authentication provider,
            which stores your account and profile data.{'\n'}
            • <Text style={styles.bold}>OpenAI</Text> — anonymised route data (no personal
            identifiers) may be sent to generate AI safety explanations.{'\n'}
            • <Text style={styles.bold}>Law enforcement</Text> — if required by law or to protect
            users' safety.
          </Text>

          <Text style={styles.sectionTitle}>4. Data Storage & Security</Text>
          <Text style={styles.body}>
            Your data is stored securely on Supabase (hosted on AWS in the EU). All data
            transmission uses HTTPS/TLS encryption. Access to production databases is restricted to
            authorised team members only. We retain your data for as long as your account is active.
          </Text>

          <Text style={styles.sectionTitle}>5. Your Rights</Text>
          <Text style={styles.body}>
            You have the right to:{'\n\n'}
            • <Text style={styles.bold}>Access</Text> your personal data via the app profile.{'\n'}
            • <Text style={styles.bold}>Delete</Text> your account and all associated data using the
            "Delete Account" option in the profile menu.{'\n'}
            • <Text style={styles.bold}>Withdraw consent</Text> for location access at any time via
            your device settings.{'\n'}
            • <Text style={styles.bold}>Export</Text> your data by contacting us.
          </Text>

          <Text style={styles.sectionTitle}>6. Children's Privacy</Text>
          <Text style={styles.body}>
            SafeNight is not intended for children under 16. We do not knowingly collect personal
            data from anyone under 16 years of age. If you believe a child has provided us with
            personal data, please contact us so we can delete it.
          </Text>

          <Text style={styles.sectionTitle}>7. Third-Party Services</Text>
          <Text style={styles.body}>
            The App uses the following third-party services, each with their own privacy policies:
            {'\n\n'}
            • Google Maps API — for map display and geocoding{'\n'}
            • OpenStreetMap / OSRM — for routing and map tiles{'\n'}
            • UK Police Data API — for crime statistics (public data){'\n'}
            • Stripe — for payment processing{'\n'}
            • Supabase — for authentication and data storage{'\n'}
            • OpenAI — for AI-generated safety explanations
          </Text>

          <Text style={styles.sectionTitle}>8. Changes to This Policy</Text>
          <Text style={styles.body}>
            We may update this Privacy Policy from time to time. We will notify you of significant
            changes through the App. Continued use of the App after changes constitutes acceptance of
            the updated policy.
          </Text>

          <Text style={styles.sectionTitle}>9. Contact Us</Text>
          <Text style={styles.body}>
            If you have questions about this Privacy Policy or wish to exercise your data rights,
            please contact us at:{'\n\n'}
            Email: mzst.26.x@gmail.com
          </Text>
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
    fontSize: 20,
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
