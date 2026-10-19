/**
 * Crawlable site-wide links (real <a> anchors on web via expo-router Link).
 * Every info and legal page ends with this so each one is linked from the others.
 *
 * Quiet text links on one wrapping line: the page you are on is accent-coloured and
 * marked aria-current, and destructive links (account deletion) sit after a thin rule.
 *
 * Tokens (kept local until the app has a theme): see the constants below.
 */
import { Href, Link, usePathname } from 'expo-router';
import { StyleSheet, View } from 'react-native';

const TOKENS = {
  text: '#667085',
  current: '#1570EF',
  danger: '#B42318',
  rule: 'rgba(16, 24, 40, 0.10)',
} as const;

const EXPLORE: { label: string; href: string }[] = [
  { label: 'Home', href: '/' },
  { label: 'How it works', href: '/how-it-works' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'About', href: '/about' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Refunds', href: '/refund' },
];

export interface FooterLink {
  label: string;
  href: string;
  /** Destructive actions (e.g. account deletion) are shown in red after a rule */
  tone?: 'danger';
}

interface SiteFooterLinksProps {
  /** Smaller type for use inside the map sidebar */
  compact?: boolean;
  /** Accessible name of the navigation landmark */
  label?: string;
  /** Removes the links from the tab order (for visually hidden copies that sighted keyboard users cannot see) */
  hiddenFromTab?: boolean;
  /** Extra links, shown after a rule. Danger links are red. */
  extraLinks?: FooterLink[];
}

export function SiteFooterLinks({
  compact = false,
  label = 'Site',
  hiddenFromTab = false,
  extraLinks = [],
}: SiteFooterLinksProps) {
  const pathname = usePathname();
  const tabProps = hiddenFromTab ? { tabIndex: -1 } : {};
  const dangerLinks = extraLinks.filter((link) => link.tone === 'danger');
  const otherLinks = extraLinks.filter((link) => link.tone !== 'danger');

  const renderLink = (link: FooterLink) => {
    const current = pathname === link.href;
    const danger = link.tone === 'danger';
    return (
      <Link
        key={link.href}
        href={link.href as Href}
        // aria-current marks the page the user is on; spread keeps tabIndex out of the typed props
        aria-current={current ? 'page' : undefined}
        {...tabProps}
        style={[
          styles.link,
          compact && styles.linkCompact,
          current && styles.linkCurrent,
          danger && styles.linkDanger,
        ]}
      >
        {link.label}
      </Link>
    );
  };

  return (
    <View role="navigation" aria-label={label} style={[styles.root, compact && styles.rootCompact]}>
      <View style={[styles.row, compact && styles.rowCompact]}>
        {[...EXPLORE, ...otherLinks].map(renderLink)}
      </View>
      {dangerLinks.length > 0 ? (
        <View style={[styles.dangerRow, compact && styles.dangerRowCompact]}>
          {dangerLinks.map(renderLink)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 6,
  },
  rootCompact: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 6,
  },
  rowCompact: {
    columnGap: 10,
    rowGap: 4,
  },
  link: {
    fontSize: 13,
    lineHeight: 18,
    color: TOKENS.text,
    fontWeight: '400',
  },
  linkCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  linkCurrent: {
    color: TOKENS.current,
    fontWeight: '600',
  },
  dangerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TOKENS.rule,
  },
  dangerRowCompact: {
    paddingTop: 4,
    columnGap: 10,
  },
  linkDanger: {
    color: TOKENS.danger,
  },
});
