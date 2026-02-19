/**
 * /refund — Web-only Refund & Payment Policy page.
 * Rendered as a standalone full-page document on web.
 * Not accessible from mobile app navigation.
 */
import { PageHead } from '@/src/components/seo/PageHead';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RefundPolicyContent } from '../src/components/modals/RefundPolicyModal';
import { PolicyFooter } from './privacy';

export default function RefundPage() {
  if (Platform.OS !== 'web') return null;

  return (
    <View style={styles.root}>
      <PageHead path="/refund" />
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
          <Text style={styles.navTitle}>Refund & Payment Policy</Text>
          <View style={styles.navSpacer} />
        </View>
      </View>

      {/* Policy links bar */}
      <View style={styles.policyBar}>
        <View style={styles.policyBarInner}>
          <Pressable onPress={() => router.push('/privacy' as any)} accessibilityRole="link">
            <Text style={styles.policyLink}>Privacy</Text>
          </Pressable>
          <Text style={styles.policyBarSep}>·</Text>
          <Pressable onPress={() => router.push('/refund' as any)} accessibilityRole="link">
            <Text style={[styles.policyLink, styles.policyLinkActive]}>Refund & Payment</Text>
          </Pressable>
          <Text style={styles.policyBarSep}>·</Text>
          <Pressable onPress={() => router.push('/terms' as any)} accessibilityRole="link">
            <Text style={styles.policyLink}>Terms & Conditions</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.pageTitle}>Refund & Payment Policy</Text>
        <View style={styles.card}>
          <RefundPolicyContent />
        </View>
        <PolicyFooter />
      </ScrollView>
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
  policyBar: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  policyBarInner: {
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
    gap: 8,
  },
  policyLink: {
    fontSize: 14,
    color: '#667085',
    fontWeight: '500',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  policyLinkActive: {
    color: '#1570EF',
    fontWeight: '700',
    borderBottomWidth: 2,
    borderBottomColor: '#1570EF',
  },
  policyBarSep: {
    fontSize: 14,
    color: '#CBD5E1',
  },
  scroll: {
    flex: 1,
  },
  content: {
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
    padding: 32,
    paddingBottom: 64,
  } as any,
  pageTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 32,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
  } as any,
});
