import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SavedPlaces } from '@/src/components/search/SavedPlaces';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function render(): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <SavedPlaces
        places={[]}
        onSelect={jest.fn()}
        onSave={jest.fn()}
        onRemove={jest.fn()}
        currentDestination={null}
        visible
      />,
    );
  });
  return r;
}

describe('SavedPlaces place buttons', () => {
  it('shows the place buttons as icons only, not text labels', () => {
    const r = render();
    const texts = r.root.findAll((n) => n.type === Text).map((n) => n.props.children);
    expect(texts).not.toContain('Home');
    expect(texts).not.toContain('Work');
  });

  it('keeps each place button labelled for screen readers', () => {
    const r = render();
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Home').length).toBeGreaterThan(0);
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Work').length).toBeGreaterThan(0);
  });

  it('keeps saved places in the list, not as their own circles, and shows the count on the list button', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <SavedPlaces
          places={[
            { id: '1', label: 'Home', name: 'Home street', lat: 1, lng: 1, icon: 'home', createdAt: 0 } as any,
            { id: '2', label: 'Gym', name: 'Gym road', lat: 2, lng: 2, icon: 'fitness', createdAt: 0 } as any,
          ]}
          onSelect={jest.fn()}
          onSave={jest.fn()}
          onRemove={jest.fn()}
          currentDestination={null}
          visible
        />,
      );
    });
    const circles = r.root.findAll((n) => n.props.accessibilityRole === 'button' && (n.props.accessibilityLabel === 'Home' || n.props.accessibilityLabel === 'Gym'));
    expect(circles.length).toBe(0);
    const list = r.root.findAll((n) => n.props.accessibilityLabel === 'Open saved locations list')[0];
    const badge = list.findAll((n) => n.props.children === 2 || n.props.children === '2')[0];
    expect(badge).toBeDefined();
  });

  it('puts the top content in the same container as the round row, as two rows', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <SavedPlaces places={[]} onSelect={jest.fn()} onSave={jest.fn()} onRemove={jest.fn()} currentDestination={null} visible above={<Text>top-row</Text>} />,
      );
    });
    const top = r.root.findAll((n) => n.type === Text && n.props.children === 'top-row')[0];
    const scroll = r.root.findAll((n) => n.props.horizontal === true)[0];
    expect(scroll.parent).toBe(top.parent);
  });

  it('spreads the round buttons across the full width when spread is set', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <SavedPlaces places={[]} onSelect={jest.fn()} onSave={jest.fn()} onRemove={jest.fn()} currentDestination={null} visible spread />,
      );
    });
    const scroll = r.root.findAll((n) => n.props.horizontal === true)[0];
    const content = StyleSheet.flatten(scroll.props.contentContainerStyle);
    expect(content.justifyContent).toBe('space-between');
  });

  it('draws the add button as a plus with thick bars, labelled for screen readers', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<SavedPlaces places={[]} onSelect={jest.fn()} onSave={jest.fn()} onRemove={jest.fn()} currentDestination={{ name: 'x', lat: 1, lng: 1 }} visible />);
    });
    const add = r.root.findAll((n) => n.props.accessibilityLabel === 'Save current place')[0];
    expect(add).toBeDefined();
    const flatten = (x: any) => (Array.isArray(x) ? Object.assign({}, ...x.flat(Infinity).filter(Boolean)) : x ?? {});
    const bars = add.findAll((n) => n.type === View && (flatten(n.props.style).height === 4 || flatten(n.props.style).width === 4));
    expect(bars.length).toBeGreaterThanOrEqual(2);
  });
});
