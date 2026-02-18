/**
 * /delete-account — Web-only account deletion request page.
 *
 * Required by Google Play / App Store to provide a publicly accessible
 * URL where users can request deletion of their account and data.
 * No login required — accessible to anyone.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PolicyFooter } from './privacy';

const DELETE_EMAIL = 'mzst.26.x@gmail.com';
const DELETE_SUBJECT = 'Account Deletion Request — SafeNight';
const DELETE_BODY =
  'Hi SafeNight team,%0A%0APlease permanently delete my account and all associated data.%0A%0AAccount email: [your email here]%0A%0AThank you.';

export default function DeleteAccountPage() {
  if (Platform.OS !== 'web') return null;

  return (
    <View style={styles.root}>
      {/* Top nav */}
      <View style={styles.nav}>
        <View style={styles.navInner}>
          <Pressable
            onPress={() => router.push('/')}
            style={styles.backButton}
            accessibilityRole="link"
            accessibilityLabel="Back to SafeNight"
          >
            <Ionicons name="arrow-back" size={18} color="#1570EF" />
            <Text style={styles.backText}>SafeNight</Text>
          </Pressable>
          <Text style={styles.navTitle}>Delete Account</Text>
          <View style={styles.navSpacer} />
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.pageTitle}>Delete Your Account & Data</Text>

        <View style={styles.card}>
          {/* Method 1 — in-app */}
          <View style={styles.methodCard}>
            <View style={styles.methodHeader}>
              <View style={[styles.methodBadge, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="phone-portrait-outline" size={20} color="#1570EF" />
              </View>
              <View style={styles.methodHeaderText}>
                <Text style={styles.methodTitle}>Option 1 — Delete directly in the app</Text>
                <Text style={styles.methodSubtitle}>Instant deletion — recommended</Text>
              </View>
            </View>
            <Text style={styles.body}>
              If you have access to your SafeNight account on a device:
            </Text>
            <View style={styles.steps}>
              <Step n="1" text='Open SafeNight and log in.' />
              <Step n="2" text='Tap the profile icon (top right of the map screen).' />
              <Step n="3" text='Scroll down and tap "Delete Account".' />
              <Step n="4" text='Confirm the deletion when prompted.' />
            </View>
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color="#1570EF" />
              <Text style={styles.infoText}>
                This immediately and permanently deletes your account, location history, Safety
                Circle contacts, and all other personal data from our servers.
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Method 2 — email */}
          <View style={styles.methodCard}>
            <View style={styles.methodHeader}>
              <View style={[styles.methodBadge, { backgroundColor: '#F0FDF4' }]}>
                <Ionicons name="mail-outline" size={20} color="#16A34A" />
              </View>
              <View style={styles.methodHeaderText}>
                <Text style={styles.methodTitle}>Option 2 — Request deletion by email</Text>
                <Text style={styles.methodSubtitle}>
                  Use this if you no longer have access to the app
                </Text>
              </View>
            </View>
            <Text style={styles.body}>
              Send a deletion request to our team and we will erase your account within{' '}
              <Text style={styles.bold}>30 days</Text>.
            </Text>
            <Pressable
              style={styles.emailButton}
              onPress={() =>
                Linking.openURL(
                  `mailto:${DELETE_EMAIL}?subject=${encodeURIComponent(DELETE_SUBJECT)}&body=${DELETE_BODY}`,
                )
              }
              accessibilityRole="link"
              accessibilityLabel="Send account deletion email"
            >
              <Ionicons name="mail" size={18} color="#FFFFFF" />
              <Text style={styles.emailButtonText}>Email Deletion Request</Text>
            </Pressable>
            <Text style={styles.emailHint}>
              Or email us directly at{' '}
              <Text
                style={styles.emailLink}
                // @ts-ignore
                onClick={() =>
                  Linking.openURL(
                    `mailto:${DELETE_EMAIL}?subject=${encodeURIComponent(DELETE_SUBJECT)}`,
                  )
                }
              >
                {DELETE_EMAIL}
              </Text>
              {'\n'}Please include the email address associated with your SafeNight account.
            </Text>
          </View>

          <View style={styles.divider} />

          {/* What gets deleted */}
          <View style={styles.methodCard}>
            <Text style={styles.sectionTitle}>What data is deleted</Text>
            <DataRow icon="person-outline" text="Your account and profile (name, email, username)" />
            <DataRow icon="location-outline" text="All location history and route searches" />
            <DataRow icon="people-outline" text="Safety Circle contacts and live tracking data" />
            <DataRow icon="card-outline" text="Subscription records (Stripe customer ID)" />

            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>What is retained</Text>
            <Text style={styles.body}>
              The following data is kept after account deletion because it serves a legitimate public
              safety interest and no longer identifies you personally:
            </Text>
            <DataRow icon="alert-circle-outline" text="Safety reports you submitted — retained anonymously to keep hazard and infrastructure data accurate for other users." />
            <DataRow icon="stats-chart-outline" text="Anonymised usage analytics — retained in aggregate form (no personal identifiers) to improve the service." />
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color="#1570EF" />
              <Text style={styles.infoText}>
                Retained records contain no name, email, username, or any data that can identify you.
                They cannot be used to trace activity back to your account.
              </Text>
            </View>
          </View>
        </View>

        {/* Partial data deletion */}
        <View style={styles.card}>
          <View style={styles.methodCard}>
            <View style={styles.methodHeader}>
              <View style={[styles.methodBadge, { backgroundColor: '#FFF7ED' }]}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#EA580C" />
              </View>
              <View style={styles.methodHeaderText}>
                <Text style={styles.methodTitle}>Request deletion of specific data only</Text>
                <Text style={styles.methodSubtitle}>Keep your account — delete selected data</Text>
              </View>
            </View>
            <Text style={styles.body}>
              You do not have to delete your account to have specific data removed. If you would like
              some of your data deleted while keeping your SafeNight account, contact us by email and
              tell us what you would like removed. We will respond within{' '}
              <Text style={styles.bold}>30 days</Text>.
            </Text>
            <Pressable
              style={[styles.emailButton, { backgroundColor: '#EA580C' }]}
              onPress={() =>
                Linking.openURL(
                  `mailto:${DELETE_EMAIL}?subject=${encodeURIComponent('Partial Data Deletion Request — SafeNight')}&body=${encodeURIComponent('Hi SafeNight team,\n\nI would like to request deletion of the following data from my account (without deleting the account itself):\n\n[describe the data you want removed]\n\nAccount email: [your email here]\n\nThank you.')}`,
                )
              }
              accessibilityRole="link"
              accessibilityLabel="Send partial data deletion email"
            >
              <Ionicons name="mail" size={18} color="#FFFFFF" />
              <Text style={styles.emailButtonText}>Contact Us About My Data</Text>
            </Pressable>
            <Text style={styles.emailHint}>
              Or email us directly at{' '}
              <Text
                style={styles.emailLink}
                // @ts-ignore
                onClick={() => Linking.openURL(`mailto:${DELETE_EMAIL}`)}
              >
                {DELETE_EMAIL}
              </Text>
              {'\n'}Please include your account email and a description of the data you want removed.
            </Text>
          </View>
        </View>

        <PolicyFooter />
      </ScrollView>
    </View>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

function DataRow({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.dataRow}>
      <Ionicons name={icon} size={16} color="#EF4444" />
      <Text style={styles.dataRowText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  } as any,
  nav: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  navInner: {
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 120,
  },
  backText: {
    fontSize: 15,
    color: '#1570EF',
    fontWeight: '600',
  },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  navSpacer: {
    minWidth: 120,
  },
  scroll: {
    flex: 1,
  },
  content: {
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    padding: 32,
    paddingBottom: 64,
  } as any,
  pageTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    marginTop: 16,
  },
  methodCard: {
    padding: 24,
  },
  methodHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 16,
  },
  methodBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodHeaderText: {
    flex: 1,
  },
  methodTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  methodSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
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
  steps: {
    gap: 10,
    marginBottom: 16,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#1570EF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  stepText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: '#374151',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: '#1E40AF',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  emailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16A34A',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  emailButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emailHint: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748B',
  },
  emailLink: {
    color: '#1570EF',
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  dataRowText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
});
