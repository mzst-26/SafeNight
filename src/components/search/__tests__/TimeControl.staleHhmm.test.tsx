import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { TimeControl } from '@/src/components/search/TimeControl';
import { TimeControl as TimeControlWeb } from '@/src/components/search/TimeControl.web';
import { type TripTimeState } from '@/src/utils/tripTime';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// Done-free model: edits commit after a pause, and Leave now schedules focus-return with setTimeout.
// Fake timers keep both inside the test.
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

const NOW = new Date('2026-10-21T16:07:00Z'); // 17:07 London

function renderOpen(
  Comp: typeof TimeControl,
  value: TripTimeState,
  onChange = jest.fn(),
): { r: ReactTestRenderer; onChange: jest.Mock } {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<Comp value={value} onChange={onChange} now={() => NOW} />);
  });
  // Expand the panel from the chip.
  const chip = r.root.findAll(
    (n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function',
  )[0];
  act(() => chip.props.onPress());
  return { r, onChange };
}

// The time field (native stepper or web select) must not render when the mode is 'now', even if a stale hhmm remains.
const hasTimeField = (r: ReactTestRenderer) =>
  r.root.findAll(
    (n) =>
      n.props.accessibilityLabel === 'Later by 15 minutes' ||
      n.props.accessibilityLabel === 'Earlier by 15 minutes' ||
      n.props['aria-label'] === 'Leave at time' ||
      n.props['aria-label'] === 'Arrive by time' ||
      (n.type as unknown) === 'select' ||
      (n.type as unknown) === 'input',
  ).length > 0;

const pressByLabel = (r: ReactTestRenderer, label: string) => {
  const nodes = r.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function',
  );
  expect(nodes.length).toBeGreaterThan(0);
  act(() => nodes[0].props.onPress());
};

const pauseForCommit = () => {
  act(() => {
    jest.advanceTimersByTime(700);
  });
};

describe.each([
  ['native', TimeControl],
  ['web', TimeControlWeb],
])('TimeControl (%s) with mode now and a stale hhmm', (_name, Comp) => {
  it('does not render the time field', () => {
    const { r } = renderOpen(Comp, { mode: 'now', hhmm: '17:15' });
    expect(hasTimeField(r)).toBe(false);
  });

  it('control: renders the time field when a non-now mode has a time', () => {
    const { r } = renderOpen(Comp, { mode: 'leave_at', hhmm: '17:15' });
    expect(hasTimeField(r)).toBe(true);
  });

  it('choosing Leave at from a stale now draft uses a fresh default and commits after a pause', () => {
    const { r, onChange } = renderOpen(Comp, { mode: 'now', hhmm: '17:15' });
    pressByLabel(r, 'Leave now');
    expect(onChange).not.toHaveBeenCalled();
    pressByLabel(r, 'Leave at');
    expect(hasTimeField(r)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    pauseForCommit();
    act(() => {
      jest.runAllTimers();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    // Leave at defaults to now (17:07) rounded up to 17:15, not the stale 17:15 from props
    // being reused; the draft starts from the current clock.
    expect(onChange).toHaveBeenCalledWith({ mode: 'leave_at', hhmm: '17:15' });
  });
});
