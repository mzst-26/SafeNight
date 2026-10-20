import React from 'react';
import { Text } from 'react-native';
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
});
