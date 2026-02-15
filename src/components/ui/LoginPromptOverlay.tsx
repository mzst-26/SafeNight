/**
 * LoginPromptOverlay — Blurred overlay on the bottom sheet for web guests.
 *
 * Shows a frosted-glass effect over route/safety results with a prominent
 * "Login to see more" button. Sits on top of the DraggableSheet content.
 */
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  onLogin: () => void;
}

export function LoginPromptOverlay({ onLogin }: Props) {
  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Blur layer */}
      <View style={styles.webBlur} />

      {/* CTA content */}
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="lock-closed" size={28} color="#6366F1" />
        </View>
        <Text style={styles.title}>Sign in to view results</Text>
        <Text style={styles.subtitle}>
          Log in to see safety scores, route details, and get turn-by-turn navigation.
        </Text>
        <Pressable style={styles.loginBtn} onPress={onLogin} accessibilityRole="button">
          <Ionicons name="log-in-outline" size={18} color="#fff" />
          <Text style={styles.loginText}>Log In to See More</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    overflow: 'hidden',
    zIndex: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webBlur: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
    ...(Platform.OS === 'web'
      ? { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }
      : {}),
  } as any,
  content: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
    zIndex: 2,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
    maxWidth: 300,
  },
  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#6366F1',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)' }
      : {}),
    elevation: 4,
  },
  loginText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
