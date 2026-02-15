/**
 * AndroidDownloadBanner — Tiny top banner shown only on web,
 * prompting users to download the Android app.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const APK_URL = 'https://github.com/Jrtowers-prog/PlymHack2026New/releases/download/latest/SafeNightHome.apk';

export function AndroidDownloadBanner({ embedded }: { embedded?: boolean } = {}) {
  const [dismissed, setDismissed] = useState(false);

  if (Platform.OS !== 'web' || dismissed) return null;

  return (
    <View style={[styles.banner, embedded && styles.bannerEmbedded]}>
      <Pressable
        style={styles.content}
        onPress={() => window.open(APK_URL, '_blank', 'noopener,noreferrer')}
        accessibilityRole="link"
      >
        <Ionicons name="logo-google-playstore" size={14} color="#fff" />
        <Text style={styles.text}>Get the Android app for full navigation</Text>
        <Ionicons name="download-outline" size={14} color="#fff" />
      </Pressable>
      <Pressable onPress={() => setDismissed(true)} style={styles.close} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Ionicons name="close" size={14} color="rgba(255,255,255,0.8)" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1570EF',
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 200,
    elevation: 200,
    height: 32,
  },
  bannerEmbedded: {
    position: 'relative',
  } as any,
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  close: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
