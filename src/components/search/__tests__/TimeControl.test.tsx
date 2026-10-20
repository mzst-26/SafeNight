import React from 'react';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { TimeControl } from '@/src/components/search/TimeControl';
import { TimeControl as TimeControlWeb } from '@/src/components/search/TimeControl.web';
import { NOW_STATE, type TripTimeState } from '@/src/utils/tripTime';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rn = require('react-native');

const NOW = new Date('2026-10-21T16:07:00Z'); // 17:07 London
const COMMIT_DELAY_MS = 700;

// The shell schedules focus-return with setTimeout and a debounced commit. Fake timers keep both
// inside the test and let us advance past the commit pause explicitly.
let originalOS: string;
beforeEach(() => {
  jest.useFakeTimers();
  originalOS = rn.Platform.OS;
});
afterEach(() => {
  rn.Platform.OS = originalOS;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const setOS = (os: string) => {
  rn.Platform.OS = os;
};

function render(
  Comp: typeof TimeControl,
  value: TripTimeState,
  onChange = jest.fn(),
): { r: ReactTestRenderer; onChange: jest.Mock } {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<Comp value={value} onChange={onChange} now={() => NOW} />);
  });
  return { r, onChange };
}

const byLabel = (r: ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');

const press = (r: ReactTestRenderer, label: string) => {
  const nodes = byLabel(r, label);
  expect(nodes.length).toBeGreaterThan(0);
  act(() => nodes[0].props.onPress());
};

// Web: choose an option in the 15-minute <select>.
const pickSlot = (r: ReactTestRenderer, label: string, hhmm: string) => {
  const select = r.root.find(
    (n) => (n.type as unknown) === 'select' && n.props['aria-label'] === label,
  );
  act(() => select.props.onChange({ target: { value: hhmm } }));
};

// Let the debounced commit fire.
const pauseForCommit = () => {
  act(() => {
    jest.advanceTimersByTime(COMMIT_DELAY_MS);
  });
};

const isSelected = (r: ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel === label)[0]
    .props.accessibilityState.selected;

// Effective touch height: declared minHeight/height plus vertical hitSlop.
const touchHeight = (n: { props: Record<string, any> }) => {
  const style = typeof n.props.style === 'function' ? n.props.style({ pressed: false }) : n.props.style;
  const st = StyleSheet.flatten(style) ?? {};
  const slop = n.props.hitSlop ?? {};
  return Math.max(st.minHeight ?? 0, st.height ?? 0) + (slop.top ?? 0) + (slop.bottom ?? 0);
};

describe.each([
  ['native', TimeControl],
  ['web', TimeControlWeb],
])('TimeControl (%s)', (_name, Comp) => {
  beforeEach(() => setOS('ios'));

  it('shows a single "Leave now" chip when collapsed', () => {
    const { r } = render(Comp, NOW_STATE);
    expect(byLabel(r, 'Leave now, change trip time').length).toBe(1);
    expect(byLabel(r, 'Arrive by').length).toBe(0);
  });

  it('expands to the segmented control and selects Leave at with the default slot, committing after a pause', () => {
    const { r, onChange } = render(Comp, NOW_STATE);
    press(r, 'Leave now, change trip time');
    expect(byLabel(r, 'Leave now').length).toBe(1);
    expect(byLabel(r, 'Leave at').length).toBe(1);
    expect(byLabel(r, 'Arrive by').length).toBe(1);
    press(r, 'Leave at');
    expect(isSelected(r, 'Leave at')).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    pauseForCommit();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ mode: 'leave_at', hhmm: '17:15' });
  });

  it('arrive by defaults to now + 30 min rounded to 15 and commits after a pause', () => {
    const { r, onChange } = render(Comp, NOW_STATE);
    press(r, 'Leave now, change trip time');
    press(r, 'Arrive by');
    expect(onChange).not.toHaveBeenCalled();
    pauseForCommit();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ mode: 'arrive_by', hhmm: '17:45' });
  });

  it('returns to now immediately when Leave now is chosen', () => {
    const { r, onChange } = render(Comp, { mode: 'leave_at', hhmm: '17:15' });
    press(r, 'Leave at 17:15, change trip time');
    press(r, 'Leave now');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(NOW_STATE);
  });

  it('shows Tomorrow when the chosen time rolled over', () => {
    const { r } = render(Comp, { mode: 'leave_at', hhmm: '08:30' });
    expect(JSON.stringify(r.toJSON())).toContain('Tomorrow');
  });

  it('has >=44px targets and >=13px text', () => {
    const { r } = render(Comp, { mode: 'leave_at', hhmm: '17:15' });
    press(r, 'Leave at 17:15, change trip time');
    const buttons = r.root.findAll(
      (n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel,
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(touchHeight(b)).toBeGreaterThanOrEqual(44);
    }
    const sizes = r.root
      .findAll((n) => n.props.style && StyleSheet.flatten(n.props.style)?.fontSize)
      .map((n) => StyleSheet.flatten(n.props.style).fontSize as number);
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(13);
  });

  it('labels the panel and the radiogroup', () => {
    const { r } = render(Comp, NOW_STATE);
    press(r, 'Leave now, change trip time');
    expect(JSON.stringify(r.toJSON())).toContain('Trip time, London');
    expect(r.root.find((n) => n.props.accessibilityRole === 'radiogroup').props.accessibilityLabel).toBe(
      'Trip time, London',
    );
  });

  it('keeps the chosen time when switching between Leave at and Arrive by, committing after a pause', () => {
    const { r, onChange } = render(Comp, { mode: 'leave_at', hhmm: '18:30' });
    press(r, 'Leave at 18:30, change trip time');
    press(r, 'Arrive by');
    expect(onChange).not.toHaveBeenCalled();
    pauseForCommit();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ mode: 'arrive_by', hhmm: '18:30' });
  });

  it('shows "(London time)" beside the chip only when the device zone differs', () => {
    const spy = jest
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ timeZone: 'America/New_York' } as Intl.ResolvedDateTimeFormatOptions);
    const { r } = render(Comp, { mode: 'leave_at', hhmm: '18:30' });
    expect(JSON.stringify(r.toJSON())).toContain('(London time)');
    spy.mockReturnValue({ timeZone: 'Europe/London' } as Intl.ResolvedDateTimeFormatOptions);
    const { r: r2 } = render(Comp, { mode: 'leave_at', hhmm: '18:30' });
    expect(JSON.stringify(r2.toJSON())).not.toContain('(London time)');
  });
});

describe('TimeControl native stepper', () => {
  beforeEach(() => setOS('ios'));

  it('steps by 15 minutes in the draft and commits once after a pause', () => {
    const { r, onChange } = render(TimeControl, { mode: 'leave_at', hhmm: '17:30' });
    press(r, 'Leave at 17:30, change trip time');
    press(r, 'Later by 15 minutes');
    press(r, 'Later by 15 minutes');
    expect(onChange).not.toHaveBeenCalled();
    pauseForCommit();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ mode: 'leave_at', hhmm: '18:00' });
  });

  it('restarts the pause on each edit, so only the final value is committed', () => {
    const { r, onChange } = render(TimeControl, { mode: 'leave_at', hhmm: '17:30' });
    press(r, 'Leave at 17:30, change trip time');
    press(r, 'Later by 15 minutes');
    act(() => {
      jest.advanceTimersByTime(500);
    });
    press(r, 'Later by 15 minutes');
    // 700ms pause counts from the last edit, not from the first.
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(COMMIT_DELAY_MS - 1);
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ mode: 'leave_at', hhmm: '18:00' });
  });

  it('disables Earlier at the floor (now rounded up) and does not call onChange', () => {
    const { r, onChange } = render(TimeControl, { mode: 'leave_at', hhmm: '17:15' });
    press(r, 'Leave at 17:15, change trip time');
    const disabled = (label: string) =>
      r.root.findAll((n) => n.props.accessibilityLabel === label && n.props.accessibilityState)[0].props
        .accessibilityState.disabled;
    expect(disabled('Earlier by 15 minutes')).toBe(true);
    expect(disabled('Later by 15 minutes')).toBe(false);
    press(r, 'Earlier by 15 minutes');
    pauseForCommit();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables Later at now + 23h45m', () => {
    const { r } = render(TimeControl, { mode: 'leave_at', hhmm: '16:45' });
    press(r, 'Leave at 16:45 · Tomorrow, change trip time');
    const disabled = (label: string) =>
      r.root.findAll((n) => n.props.accessibilityLabel === label && n.props.accessibilityState)[0].props
        .accessibilityState.disabled;
    expect(disabled('Later by 15 minutes')).toBe(true);
    expect(disabled('Earlier by 15 minutes')).toBe(false);
  });

  it('exposes the time as an adjustable; increment edits the draft and commits after a pause', () => {
    const { r, onChange } = render(TimeControl, { mode: 'arrive_by', hhmm: '18:00' });
    press(r, 'Arrive by 18:00, change trip time');
    const adj = r.root.find((n) => n.props.accessibilityRole === 'adjustable');
    expect(adj.props.accessibilityValue).toEqual({ text: '18:00' });
    act(() => adj.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(onChange).not.toHaveBeenCalled();
    pauseForCommit();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ mode: 'arrive_by', hhmm: '18:15' });
  });

  it('keeps a stepped time when the panel is closed via the chip, and still commits it', () => {
    const { r, onChange } = render(TimeControl, { mode: 'leave_at', hhmm: '17:30' });
    press(r, 'Leave at 17:30, change trip time');
    press(r, 'Later by 15 minutes');
    press(r, 'Leave at 17:30, change trip time'); // close via chip
    expect(onChange).not.toHaveBeenCalled();
    pauseForCommit();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ mode: 'leave_at', hhmm: '17:45' });
  });
});

describe('TimeControl web time select', () => {
  beforeEach(() => setOS('web'));

  it('renders a <select> of 15-minute slots bound to the draft time', () => {
    const { r } = render(TimeControlWeb, { mode: 'arrive_by', hhmm: '18:00' });
    press(r, 'Arrive by 18:00, change trip time');
    const select = r.root.find(
      (n) => (n.type as unknown) === 'select' && n.props['aria-label'] === 'Arrive by time',
    );
    expect(select.props.value).toBe('18:00');
    const values = r.root
      .findAll((n) => (n.type as unknown) === 'option')
      .map((n) => n.props.value as string);
    expect(values).toContain('18:00');
    expect(values).toContain('19:30');
    for (let i = 1; i < values.length; i++) {
      const [ph, pm] = values[i - 1].split(':').map(Number);
      const [h, m] = values[i].split(':').map(Number);
      // Modulo 1440: slots wrap past midnight (23:45 -> 00:00).
      expect((h * 60 + m - (ph * 60 + pm) + 1440) % 1440).toBe(15);
    }
  });

  it('choosing an option updates the draft only; the pause commits it once', () => {
    const { r, onChange } = render(TimeControlWeb, { mode: 'arrive_by', hhmm: '18:00' });
    press(r, 'Arrive by 18:00, change trip time');
    pickSlot(r, 'Arrive by time', '19:30');
    expect(onChange).not.toHaveBeenCalled();
    pauseForCommit();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ mode: 'arrive_by', hhmm: '19:30' });
  });
});

// Regression: draft contract. Leave at and edits commit once after a pause, not per edit.
describe.each([
  ['native', TimeControl, (r: ReactTestRenderer) => press(r, 'Later by 15 minutes'), '17:30'],
  ['web', TimeControlWeb, (r: ReactTestRenderer) => pickSlot(r, 'Leave at time', '19:30'), '19:30'],
])('TimeControl (%s) draft commits after a pause', (_name, Comp, edit, finalHhmm) => {
  beforeEach(() => setOS('ios'));

  it('does not call onChange for Leave at or edits until the pause, then calls it exactly once', () => {
    const { r, onChange } = render(Comp, NOW_STATE);
    press(r, 'Leave now, change trip time');
    press(r, 'Leave at');
    edit(r);
    expect(onChange).not.toHaveBeenCalled();
    pauseForCommit();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ mode: 'leave_at', hhmm: finalHhmm });
  });

  it('does not call onChange when the draft ends equal to the committed value', () => {
    const { r, onChange } = render(Comp, { mode: 'leave_at', hhmm: '18:30' });
    press(r, 'Leave at 18:30, change trip time');
    press(r, 'Arrive by');
    press(r, 'Leave at');
    pauseForCommit();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closing the panel via the chip keeps the draft and its pending commit still fires', () => {
    const { r, onChange } = render(Comp, NOW_STATE);
    press(r, 'Leave now, change trip time');
    press(r, 'Leave at');
    edit(r);
    press(r, 'Leave now, change trip time'); // close via chip (chip still shows the committed value)
    expect(onChange).not.toHaveBeenCalled();
    pauseForCommit();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ mode: 'leave_at', hhmm: finalHhmm });
  });
});

// Web: Escape closes the panel but, like the chip, leaves the draft and its pending commit alone.
describe('TimeControl web Escape', () => {
  beforeEach(() => setOS('web'));

  it('closes the panel without cancelling the pending commit', () => {
    const { r, onChange } = render(TimeControlWeb, NOW_STATE);
    press(r, 'Leave now, change trip time');
    press(r, 'Leave at');
    pickSlot(r, 'Leave at time', '19:00');
    const panel = r.root.find((n) => typeof n.props.onKeyDown === 'function');
    act(() => panel.props.onKeyDown({ key: 'Escape' }));
    expect(byLabel(r, 'Leave now').length).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
    pauseForCommit();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ mode: 'leave_at', hhmm: '19:00' });
  });
});

// Regression: web must not call findNodeHandle (it throws on web) when Leave now closes the panel.
describe.each([
  ['native', TimeControl],
  ['web', TimeControlWeb],
])('TimeControl (%s) Leave at -> Leave now on web', (_name, Comp) => {
  it('does not throw and calls onChange once with NOW_STATE', () => {
    setOS('web');
    const findSpy = jest.spyOn(rn, 'findNodeHandle').mockImplementation(() => {
      throw new Error('findNodeHandle must not be called on web');
    });
    const { r, onChange } = render(Comp, { mode: 'leave_at', hhmm: '18:30' });
    press(r, 'Leave at 18:30, change trip time');
    expect(() => {
      press(r, 'Leave now');
      act(() => {
        jest.runAllTimers();
      });
    }).not.toThrow();
    expect(findSpy).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(NOW_STATE);
  });
});

// Native focus return: findNodeHandle + AccessibilityInfo.setAccessibilityFocus on iOS/Android.
describe('TimeControl native focus return', () => {
  it('uses findNodeHandle and moves accessibility focus back to the chip on iOS', () => {
    setOS('ios');
    const findSpy = jest.spyOn(rn, 'findNodeHandle').mockReturnValue(42);
    const setFocus = jest.spyOn(rn.AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
    const { r, onChange } = render(TimeControl, { mode: 'leave_at', hhmm: '18:30' });
    press(r, 'Leave at 18:30, change trip time');
    press(r, 'Leave now');
    act(() => {
      jest.runAllTimers();
    });
    expect(findSpy).toHaveBeenCalled();
    expect(setFocus).toHaveBeenCalledWith(42);
    expect(onChange).toHaveBeenCalledWith(NOW_STATE);
  });
});
