/**
 * WebLoginButton — Floating "Log In" button shown on web for guests.
 *
 * Appears in the top-right of the map (same spot as ProfileMenu for
 * logged-in users). Clean, minimal design.
 */
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';

interface Props {
  onPress: () => void;
}

export function WebLoginButton({ onPress }: Props) {
  if (Platform.OS !== 'web') return null;

  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Log in"
    >
      <Ionicons name="log-in-outline" size={18} color="#fff" />
      <Text style={styles.text}>Log In</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#6366F1',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    width: '100%',
    maxWidth: 600,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 2px 10px rgba(99, 102, 241, 0.35)' }
      : {}),
    elevation: 4,
  } as any,
  text: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
