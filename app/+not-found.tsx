/**
 * Not-found screen (Expo Router catch-all). Web only sets noindex via PageHead;
 * no canonical is emitted for unmatched paths.
 */
import { PageHead } from '@/src/components/seo/PageHead';
import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <PageHead path="/404" title="Page not found — SafeNight" noindex />
      <Text style={styles.title} role="heading" aria-level={1}>Page not found</Text>
      <Text style={styles.subtitle}>The page you are looking for does not exist.</Text>
      <Link href="/" style={styles.link}>
        Back to SafeNight
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#101828',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#475467',
    textAlign: 'center',
  },
  link: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
    color: '#1570EF',
  },
});
