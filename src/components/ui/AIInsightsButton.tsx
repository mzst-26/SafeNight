/**
 * AIInsightsButton — a long, thin bar above the recommended route card (desktop sidebar).
 * Colour follows the trip time. Late night bounces to say the insights matter now.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';

import { shouldBounce, type InsightsTone } from '@/src/utils/insightsTone';

const BAR_HEIGHT = 30;

const TONE_COLOUR: Record<InsightsTone, string> = {
  morning: '#7c3aed',
  afternoon: '#6d28d9',
  evening: '#4338ca',
  late: '#dc2626',
};

interface AIInsightsButtonProps {
  tone: InsightsTone;
  onPress: () => void;
}

export function AIInsightsButton({ tone, onPress }: AIInsightsButtonProps) {
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!shouldBounce(tone)) {
      bounce.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: -4, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 300, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(900),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [tone, bounce]);

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY: bounce }] }]}>
      <Pressable
        style={[styles.bar, { backgroundColor: TONE_COLOUR[tone] }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="AI Insights or rethink the route choice"
      >
        <Ionicons name="sparkles" size={12} color="#ffffff" />
        <Text style={styles.label}>AI Insights / Rethink</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    marginBottom: 8,
  },
  bar: {
    alignSelf: 'stretch',
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  label: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});
