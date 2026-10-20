import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { TimeControl } from '@/src/components/search/TimeControl';
import { TimeControl as TimeControlWeb } from '@/src/components/search/TimeControl.web';
import { type TripTimeState } from '@/src/utils/tripTime';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const NOW = new Date('2026-10-21T16:07:00Z'); // 17:07 London

function renderOpen(Comp: typeof TimeControl, value: TripTimeState): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<Comp value={value} onChange={jest.fn()} now={() => NOW} />);
  });
  // Expand the panel from the chip.
  const chip = r.root.findAll(
    (n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function',
  )[0];
  act(() => chip.props.onPress());
  return r;
}

// The time field (native stepper or web input) must not render when the mode is 'now', even if a stale hhmm remains.
const hasTimeField = (r: ReactTestRenderer) =>
  r.root.findAll(
    (n) =>
      n.props.accessibilityLabel === 'Later by 15 minutes' ||
      n.props.accessibilityLabel === 'Earlier by 15 minutes' ||
      n.props['aria-label'] === 'Arrive by time' ||
      (n.type as unknown) === 'input',
  ).length > 0;

describe.each([
  ['native', TimeControl],
  ['web', TimeControlWeb],
])('TimeControl (%s) with mode now and a stale hhmm', (_name, Comp) => {
  it('does not render the time field', () => {
    const r = renderOpen(Comp, { mode: 'now', hhmm: '17:15' });
    expect(hasTimeField(r)).toBe(false);
  });

  it('control: renders the time field when a non-now mode has a time', () => {
    const r = renderOpen(Comp, { mode: 'leave_at', hhmm: '17:15' });
    expect(hasTimeField(r)).toBe(true);
  });
});
