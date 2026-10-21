/**
 * AIExplainButton — compact glass chip that opens AI Insights / Rethink (the agent panel).
 * Uses the same glass surface as the map buttons so it sits quietly on the map.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { glassSurface } from '@/src/components/ui/glass';

const AI_EXPLAIN_BUTTON_HEIGHT = 40;

interface AIExplainButtonProps {
  onPress: () => void;
}

export function AIExplainButton({ onPress }: AIExplainButtonProps) {
  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="AI Insights or rethink the route choice"
    >
      <Ionicons name="sparkles" size={16} color="#7c3aed" />
      <Text style={styles.label}>AI Insights / Rethink</Text>
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
});
