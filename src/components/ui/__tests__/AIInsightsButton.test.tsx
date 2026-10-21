import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AIInsightsButton } from '@/src/components/ui/AIInsightsButton';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const LABEL = 'AI Insights / Rethink';

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  // Stops the bounce loop; otherwise it outlives the test and crashes the run.
  while (mounted.length) mounted.pop()?.unmount();
});

function render(tone: 'morning' | 'afternoon' | 'evening' | 'late', onPress = () => {}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<AIInsightsButton tone={tone} onPress={onPress} />);
  });
  mounted.push(renderer);
  return renderer;
}

function pressable(renderer: ReactTestRenderer) {
  const [node] = renderer.root.findAll(
    (n) => n.props.accessibilityLabel === 'AI Insights or rethink the route choice' && typeof n.props.onPress === 'function',
  );
  if (!node) throw new Error('button not found');
  return node;
}

describe('AIInsightsButton', () => {
  test('shows the label and calls onPress when tapped', () => {
    const onPress = jest.fn();
    const renderer = render('morning', onPress);
    const labels = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(labels).toContain(LABEL);

    act(() => {
      pressable(renderer).props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['morning', '#7c3aed'],
    ['afternoon', '#6d28d9'],
    ['evening', '#4338ca'],
    ['late', '#dc2626'],
  ])('%s tone uses %s', (tone, colour) => {
    const style = StyleSheet.flatten(pressable(render(tone as any)).props.style);
    expect(style.backgroundColor).toBe(colour);
  });

  test('is an ultrathin full-width bar', () => {
    const style = StyleSheet.flatten(pressable(render('morning')).props.style);
    expect(style.height).toBeLessThanOrEqual(30);
    expect(style.alignSelf).toBe('stretch');
  });
});
