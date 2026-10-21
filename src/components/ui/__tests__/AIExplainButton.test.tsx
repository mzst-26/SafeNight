import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AIExplainButton } from '@/src/components/ui/AIExplainButton';
import { glassSurface } from '@/src/components/ui/glass';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const LABEL = 'AI Insights or rethink the route choice';

function render(onPress: () => void): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<AIExplainButton onPress={onPress} />);
  });
  return renderer;
}

function findPressable(renderer: ReactTestRenderer) {
  const [node] = renderer.root.findAll(
    (n) => n.props.accessibilityLabel === LABEL && typeof n.props.onPress === 'function',
  );
  if (!node) throw new Error('AI button not found');
  return node;
}

describe('AIExplainButton', () => {
  test('shows the AI Insights label that opens the agent panel', () => {
    const renderer = render(() => {});
    const labels = renderer.root.findAllByType(Text).map((t) => t.props.children);

    expect(labels).toContain('AI Insights / Rethink');
    expect(labels).not.toContain(LABEL);
  });

  test('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const renderer = render(onPress);

    act(() => {
      findPressable(renderer).props.onPress();
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('uses a glass surface and is no taller than a 40px chip, so it blends with the map buttons', () => {
    const renderer = render(() => {});
    const style = StyleSheet.flatten(findPressable(renderer).props.style);

    expect(style.backgroundColor).toBe(glassSurface.backgroundColor);
    expect(style.height).toBeLessThanOrEqual(40);
  });
});
