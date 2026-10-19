import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PageHead } from '@/src/components/seo/PageHead';

export default function ModalScreen() {
  return (
    <View style={styles.container}>
      <PageHead path="/modal" title="Modal — SafeNight" noindex />
      <Text style={styles.title}>Modal</Text>
      <Text style={styles.subtitle}>This is a modal route.</Text>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.back()}>
        <Text style={styles.buttonText}>Close</Text>
      </Pressable>
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
  },
  button: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1570ef',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});