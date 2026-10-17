import { glassSurface, glassScrim } from '@/src/components/ui/glass';
/**
 * OnboardingModal — First-launch consent overlay.
 */
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

interface OnboardingModalProps {
  visible: boolean;
  error: { message: string } | null;
  onAccept: () => void;
  onDismiss: () => void;
}

export function OnboardingModal({ visible, error, onAccept, onDismiss }: OnboardingModalProps) {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="SafeNight logo"
        />
        <Text style={styles.title}>SafeNight</Text>
        <Text style={styles.body}>
          We use your location to plan walking routes. Results are guidance only and do not
          guarantee safety.
        </Text>
        {error && <Text style={styles.error}>{error.message}</Text>}
        <Pressable
          style={styles.button}
          onPress={onAccept}
          accessibilityRole="button"
          accessibilityLabel="Enable location"
        >
          <Text style={styles.buttonText}>Enable location</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Maybe later"
        >
          <Text style={styles.secondaryText}>Maybe later</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    ...glassScrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 100,
    elevation: 100,
  },
  card: {
    width: '100%',
    borderRadius: 20,
    padding: 20,
    ...glassSurface,
    ...(Platform.OS === 'web' ? { boxShadow: '0 8px 12px rgba(16, 24, 40, 0.2)' } : {}),
    elevation: 6,
  },
  logo: {
    width: 140,
    height: 44,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#101828',
    textAlign: 'center',
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    color: '#475467',
    lineHeight: 20,
  },
  error: {
    fontSize: 14,
    color: '#d92d20',
    paddingVertical: 8,
  },
  button: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1570ef',
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f2f4f7',
    alignItems: 'center',
  },
  secondaryText: {
    color: '#101828',
    fontWeight: '600',
    fontSize: 14,
  },
});
