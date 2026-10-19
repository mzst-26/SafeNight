/**
 * Crawlable home-page intro for web.
 *
 * The home screen is a map UI, so its static HTML has almost no text. This
 * block gives crawlers and AI answer engines one H1, the entity definition and
 * the six scoring factors. It is visually hidden (the standard accessible
 * clip pattern) so the map UI is unchanged for visitors and screen readers
 * still read it.
 */
import { Platform, Text, View } from 'react-native';

import { SiteFooterLinks } from '@/src/components/seo/SiteFooterLinks';
import { SEO } from '@/src/config/seo';
import { FACTOR_NAMES } from '@/src/content/factors';

// Standard accessible visually-hidden pattern. Not display:none and not opacity 0,
// so the content stays in the accessibility tree and in the DOM for crawlers.
// clip is kept for older engines; clipPath is the current equivalent.
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  margin: -1,
  padding: 0,
  borderWidth: 0,
} as any;

export function HomeIntro() {
  if (Platform.OS !== 'web') return null;

  return (
    <View role="region" aria-label="About SafeNight" style={visuallyHidden}>
      <Text role="heading" aria-level={1}>
        SafeNight: find a safer walking route home at night
      </Text>
      <Text>{SEO.entityDefinition}</Text>
      <Text>Crime data covers England and Wales.</Text>
      <Text>The six factors SafeNight scores each street segment on:</Text>
      <View role="list">
        {FACTOR_NAMES.map((factor) => (
          <Text key={factor} role="listitem">
            {factor}
          </Text>
        ))}
      </View>
      <SiteFooterLinks compact label="SafeNight pages" hiddenFromTab />
    </View>
  );
}
