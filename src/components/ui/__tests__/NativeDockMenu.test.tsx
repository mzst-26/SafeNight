import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { NativeDockMenu } from '@/src/components/ui/MapControlRail';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function render(): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <NativeDockMenu
        collapsible
        current={<Text>current</Text>}
        hidden={[<Text key="p">profile</Text>, <Text key="r">report</Text>]}
        all={[]}
      />,
    );
  });
  return renderer;
}

function textOf(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll((n) => n.type === Text)
    .map((n) => n.props.children)
    .join(' ');
}

describe('NativeDockMenu', () => {
  it('starts collapsed: current location and the menu only, the other buttons hidden', () => {
    const r = render();
    expect(textOf(r)).toContain('current');
    expect(textOf(r)).not.toContain('profile');
  });

  it('expands when the menu button is tapped', () => {
    const r = render();
    const menu = r.root.findAll((n) => n.props.accessibilityLabel === 'Open map menu')[0];
    act(() => menu.props.onPress());
    expect(textOf(r)).toContain('profile');
    expect(textOf(r)).toContain('report');
  });

  it('collapses again when the screen outside the container is tapped', () => {
    const r = render();
    act(() => r.root.findAll((n) => n.props.accessibilityLabel === 'Open map menu')[0].props.onPress());
    const backdrop = r.root.findAll((n) => n.props.accessibilityLabel === 'Close map menu')[0];
    act(() => backdrop.props.onPress());
    expect(textOf(r)).not.toContain('profile');
    expect(textOf(r)).toContain('current');
  });
});

describe('NativeDockMenu after navigation', () => {
  it('closes an open menu when navigation starts, so its backdrop cannot cover the screen afterwards', () => {
    let r!: ReturnType<typeof create>;
    const element = (collapsible: boolean) => (
      <NativeDockMenu
        collapsible={collapsible}
        current={<Text>current</Text>}
        hidden={[<Text key="p">profile</Text>]}
        all={[]}
      />
    );
    act(() => {
      r = create(element(true));
    });
    act(() => r.root.findAll((n) => n.props.accessibilityLabel === 'Open map menu')[0].props.onPress());
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Close map menu').length).toBeGreaterThan(0);

    act(() => r.update(element(false)));
    act(() => r.update(element(true)));

    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Close map menu').length).toBe(0);
    expect(textOf(r)).not.toContain('profile');
  });
});
