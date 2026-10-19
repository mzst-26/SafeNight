/**
 * Shared shell for web-only marketing and information pages.
 *
 * Mirrors the layout of app/privacy.tsx: a top nav, a scrollable content
 * column inside a flex root, so pages scroll even though the HTML body is
 * overflow:hidden. Renders PageHead (title/description from PAGE_SEO) and
 * exactly one H1 (role="heading" aria-level={1} renders <h1> on web).
 */
import { PageHead } from '@/src/components/seo/PageHead';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

interface ContentPageProps {
  /** Expo Router pathname, e.g. "/how-it-works" (key into PAGE_SEO) */
  path: string;
  /** Visible H1 for the page */
  title: string;
  /** Optional answer-first introduction shown under the H1 */
  lead?: string;
  children?: ReactNode;
}

export default function ContentPage({ path, title, lead, children }: ContentPageProps) {
  // Web-only, same as the legal pages
  if (Platform.OS !== 'web') return null;

  return (
    <View style={styles.root}>
      <PageHead path={path} />

      <View style={styles.nav}>
        <View style={styles.navInner}>
          <Link href="/" asChild>
            <Pressable style={styles.backButton} accessibilityRole="link" accessibilityLabel="Back to SafeNight">
              <Ionicons name="arrow-back" size={18} color="#1570EF" />
              <Text style={styles.backText}>SafeNight</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.h1} role="heading" aria-level={1}>
            {title}
          </Text>
          {lead ? <Text style={styles.lead}>{lead}</Text> : null}
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

/** Section heading (h2 on web) */
export function H2({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.h2} role="heading" aria-level={2}>
      {children}
    </Text>
  );
}

/** Sub-section heading (h3 on web) */
export function H3({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.h3} role="heading" aria-level={3}>
      {children}
    </Text>
  );
}

/** Body paragraph */
export function P({ children }: { children: ReactNode }) {
  return <Text style={styles.p}>{children}</Text>;
}

/** Unordered list of plain-text items */
export function Bullets({ items }: { items: string[] }) {
  return (
    <View style={styles.bullets} role="list">
      {items.map((item, index) => (
        <View key={index} style={styles.bulletRow} role="listitem">
          <Text aria-hidden={true} style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

/** Standard safety line. Keep the wording identical across pages. */
export function SafetyDisclaimer({
  text = 'Guidance only: scores are estimates from public data and do not guarantee safety. In an emergency call 999.',
}: {
  text?: string;
}) {
  return (
    <View style={styles.disclaimer}>
      <Text style={styles.disclaimerText}>{text}</Text>
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
  h1: {
    fontSize: 32,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 16,
  },
  lead: {
    fontSize: 17,
    lineHeight: 26,
    color: '#334155',
    marginBottom: 24,
  },
  h2: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 28,
    marginBottom: 12,
  },
  h3: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 20,
    marginBottom: 8,
  },
  p: {
    fontSize: 15,
    lineHeight: 24,
    color: '#334155',
    marginBottom: 12,
  },
  bullets: {
    marginBottom: 12,
    gap: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 8,
  },
  bulletDot: {
    fontSize: 15,
    lineHeight: 24,
    color: '#1570EF',
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 24,
    color: '#334155',
  },
  disclaimer: {
    marginTop: 24,
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  disclaimerText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#7C2D12',
    fontWeight: '600',
  },
});
