import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AIExplainButton } from '@/src/components/ui/AIExplainButton';
import { glassSurface } from '@/src/components/ui/glass';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const LABEL = 'Why we recommend this route';

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
  test('shows a short visible label instead of the long sentence', () => {
    const renderer = render(() => {});
    const labels = renderer.root.findAllByType(Text).map((t) => t.props.children);

    expect(labels).toContain('Why this route');
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

describe('AIExplainButton circle variant', () => {
  test('is a 28px glass circle with no visible text, still labelled for screen readers', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<AIExplainButton variant="circle" onPress={() => {}} />);
    });
    const texts = renderer.root.findAllByType(Text);
    expect(texts).toHaveLength(0);

    const node = findPressable(renderer);
    const style = StyleSheet.flatten(node.props.style);
    expect(style.width).toBe(28);
    expect(style.height).toBe(28);
    expect(style.borderRadius).toBe(14);
    expect(style.backgroundColor).toBe(glassSurface.backgroundColor);
  });
});

