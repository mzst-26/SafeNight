import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { TimeControl } from '@/src/components/search/TimeControl';
import { NOW_STATE } from '@/src/utils/tripTime';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const radioText = (r: ReactTestRenderer, label: string) => {
  const radio = r.root.findAll((n) => n.props.accessibilityLabel === label && n.props.accessibilityRole === 'radio')[0];
  return radio.findAll((n) => n.type === Text).map((n) => n.props.children).join('');
};

describe('TimeControl inline (desktop sidebar)', () => {
  it('shows the three mode buttons directly, with no chip', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<TimeControl inline value={NOW_STATE} onChange={jest.fn()} />);
    });
    expect(r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.endsWith('change trip time')).length).toBe(0);
    expect(radioText(r, 'Leave now')).toBe('Leave now');
    expect(radioText(r, 'Leave at')).toBe('Leave at');
    expect(radioText(r, 'Arrive by')).toBe('Arrive by');
  });

  it('shows the chosen time on the middle button when Leave at is selected', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<TimeControl inline value={{ mode: 'leave_at', hhmm: '18:30' }} onChange={jest.fn()} />);
    });
    expect(radioText(r, 'Leave at')).toBe('18:30');
    expect(radioText(r, 'Arrive by')).toBe('Arrive by');
  });
});
