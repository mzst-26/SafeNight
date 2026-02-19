/**
 * BackgroundLocationModal — Prominent disclosure required by Google Play.
 *
 * Google Play policy requires apps using ACCESS_BACKGROUND_LOCATION to show
 * an in-app disclosure screen BEFORE the system permission prompt, explaining
 * clearly what data is collected, why, and how it is used.
 *
 * This modal satisfies that requirement. It must be shown every time background
 * location permission needs to be requested, not just on first launch.
 */

import { Ionicons } from '@expo/vector-icons';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  onAllow: () => void;
  onDeny: () => void;
}

export function BackgroundLocationModal({ visible, onAllow, onDeny }: Props) {
  const insets = useSafeAreaInsets();

  // Background location is Android-only — on iOS the system handles this
  if (Platform.OS !== 'android') return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDeny}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {/* Icon */}
          <View style={styles.iconWrap}>
            <Ionicons name="location" size={36} color="#7C3AED" />
          </View>

          {/* Title */}
          <Text style={styles.title}>Background Location Access</Text>

          {/* ── Google Play required disclosure text ── */}
          <Text style={styles.body}>
            SafeNight needs to access your location{' '}
            <Text style={styles.bold}>while the app is in the background</Text> (e.g. screen locked,
            phone in pocket) to provide the following features:
          </Text>

          <View style={styles.featureList}>
            <View style={styles.featureRow}>
              <Ionicons name="navigate-circle-outline" size={20} color="#7C3AED" style={styles.featureIcon} />
              <Text style={styles.featureText}>
                <Text style={styles.bold}>Navigation</Text> — continues turn-by-turn guidance when
                your screen is off
              </Text>
            </View>
            <View style={styles.featureRow}>
              <Ionicons name="people-outline" size={20} color="#7C3AED" style={styles.featureIcon} />
              <Text style={styles.featureText}>
                <Text style={styles.bold}>Safety Circle</Text> — shares your real-time location with
                trusted contacts every 5–10 seconds so they can monitor your journey
              </Text>
            </View>
            <View style={styles.featureRow}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#7C3AED" style={styles.featureIcon} />
              <Text style={styles.featureText}>
                <Text style={styles.bold}>Emergency awareness</Text> — allows contacts to be alerted
                if you stop moving unexpectedly
              </Text>
            </View>
          </View>

          <Text style={styles.note}>
            Your location is <Text style={styles.bold}>only shared during active sessions</Text> you
            start. It is never collected in the background outside of a live tracking session.
          </Text>

          {/* Buttons */}
          <Pressable style={styles.allowBtn} onPress={onAllow}>
            <Text style={styles.allowText}>Allow Background Location</Text>
          </Pressable>

          <Pressable style={styles.denyBtn} onPress={onDeny}>
            <Text style={styles.denyText}>Not Now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 22,
    marginBottom: 16,
  },
  bold: {
    fontWeight: '600',
    color: '#111827',
  },
  featureList: {
    gap: 12,
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  featureIcon: {
    marginTop: 1,
  },
  featureText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    lineHeight: 21,
  },
  note: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 18,
    marginBottom: 24,
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 10,
  },
  allowBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  allowText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  denyBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  denyText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '500',
  },
});
