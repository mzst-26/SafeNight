/**
 * AIExplainButton — compact glass chip that opens the "why this route" explanation.
 * Uses the same glass surface as the map buttons so it sits quietly on the map.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { glassSurface } from '@/src/components/ui/glass';

const AI_EXPLAIN_BUTTON_HEIGHT = 40;

interface AIExplainButtonProps {
  onPress: () => void;
  /** chip: icon and label (map). circle: icon only, 28px, for a route card corner. */
  variant?: 'chip' | 'circle';
}

const CIRCLE_SIZE = 28;

export function AIExplainButton({ onPress, variant = 'chip' }: AIExplainButtonProps) {
  if (variant === 'circle') {
    return (
      <Pressable
        style={styles.circle}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Why we recommend this route"
      >
        <Ionicons name="sparkles" size={14} color="#7c3aed" />
      </Pressable>
    );
  }
  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Why we recommend this route"
    >
      <Ionicons name="sparkles" size={16} color="#7c3aed" />
      <Text style={styles.label}>Why this route</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: AI_EXPLAIN_BUTTON_HEIGHT,
    paddingHorizontal: 14,
    borderRadius: AI_EXPLAIN_BUTTON_HEIGHT / 2,
    elevation: 6,
    ...glassSurface,
  },
  label: {
    color: '#101828',
    fontSize: 13,
    fontWeight: '600',
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    elevation: 6,
    ...glassSurface,
  },
});
