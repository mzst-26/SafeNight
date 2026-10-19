/**
 * Crawlable site-wide links (real <a> anchors on web via expo-router Link).
 * Every info and legal page ends with this so each one is linked from the others.
 */
import { Href, Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

const LINKS: { label: string; href: string }[] = [
  { label: 'Home', href: '/' },
  { label: 'How it works', href: '/how-it-works' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'About', href: '/about' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Refunds', href: '/refund' },
];

interface SiteFooterLinksProps {
  /** Smaller type and tighter spacing, for use inside the map sidebar */
  compact?: boolean;
  /** Accessible name of the navigation landmark */
  label?: string;
  /** Removes the links from the tab order (for visually hidden copies that sighted keyboard users cannot see) */
  hiddenFromTab?: boolean;
}

export function SiteFooterLinks({ compact = false, label = 'Site', hiddenFromTab = false }: SiteFooterLinksProps) {
  return (
    <View
      role="navigation"
      aria-label={label}
      style={[styles.row, compact && styles.rowCompact]}
    >
      {LINKS.map((link, index) => (
        <View key={link.href} style={styles.item}>
          {index > 0 ? (
            <Text aria-hidden={true} style={[styles.sep, compact && styles.sepCompact]}>
              ·
            </Text>
          ) : null}
          {/* tabIndex goes through a spread: the expo-router Link type does not declare it. */}
          <Link
            href={link.href as Href}
            {...(hiddenFromTab ? { tabIndex: -1 } : {})}
            style={[styles.link, compact && styles.linkCompact]}
          >
            {link.label}
          </Link>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rowCompact: {
    gap: 6,
    justifyContent: 'flex-start',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  link: {
    fontSize: 13,
    color: '#475467',
    fontWeight: '500',
    paddingVertical: 2,
  },
  linkCompact: {
    fontSize: 12,
  },
  sep: {
    fontSize: 13,
    color: '#CBD5E1',
  },
  sepCompact: {
    fontSize: 12,
  },
});
