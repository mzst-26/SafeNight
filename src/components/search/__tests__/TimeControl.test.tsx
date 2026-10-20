import React from 'react';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { TimeControl } from '@/src/components/search/TimeControl';
import { TimeControl as TimeControlWeb } from '@/src/components/search/TimeControl.web';
import { NOW_STATE, type TripTimeState } from '@/src/utils/tripTime';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const NOW = new Date('2026-10-21T16:07:00Z'); // 17:07 London

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

describe.each([
  ['native', TimeControl],
  ['web', TimeControlWeb],
])('TimeControl (%s)', (_name, Comp) => {
  it('shows a single "Leave now" chip when collapsed', () => {
    const { r } = render(Comp, NOW_STATE);
    expect(byLabel(r, 'Leave now, change trip time').length).toBe(1);
    expect(byLabel(r, 'Arrive by').length).toBe(0);
  });

  it('expands to the segmented control and selects Leave at with the default slot', () => {
    const { r, onChange } = render(Comp, NOW_STATE);
    press(r, 'Leave now, change trip time');
    expect(byLabel(r, 'Leave now').length).toBe(1);
    expect(byLabel(r, 'Leave at').length).toBe(1);
    expect(byLabel(r, 'Arrive by').length).toBe(1);
    press(r, 'Leave at');
    expect(onChange).toHaveBeenCalledWith({ mode: 'leave_at', hhmm: '17:15' });
  });

  it('arrive by defaults to now + 30 min rounded to 15', () => {
    const { r, onChange } = render(Comp, NOW_STATE);
    press(r, 'Leave now, change trip time');
    press(r, 'Arrive by');
    expect(onChange).toHaveBeenCalledWith({ mode: 'arrive_by', hhmm: '17:45' });
  });

  it('returns to now when Leave now is chosen', () => {
    const { r, onChange } = render(Comp, { mode: 'leave_at', hhmm: '17:15' });
    press(r, 'Leave at 17:15, change trip time');
    press(r, 'Leave now');
    expect(onChange).toHaveBeenCalledWith(NOW_STATE);
  });

  it('shows Tomorrow when the chosen time rolled over', () => {
    const { r } = render(Comp, { mode: 'leave_at', hhmm: '08:30' });
    const texts = r.root.findAll((n) => (n.type as unknown) === 'Text' || typeof n.props.children === 'string');
    expect(JSON.stringify(r.toJSON())).toContain('Tomorrow');
    expect(texts.length).toBeGreaterThan(0);
  });

  it('has >=44px targets and >=13px text', () => {
    const { r } = render(Comp, { mode: 'leave_at', hhmm: '17:15' });
    const buttons = r.root.findAll((n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel);
    for (const b of buttons) {
      const st = StyleSheet.flatten(b.props.style) ?? {};
      expect(st.minHeight ?? 0).toBeGreaterThanOrEqual(44);
    }
    const sizes = r.root
      .findAll((n) => n.props.style && StyleSheet.flatten(n.props.style)?.fontSize)
      .map((n) => StyleSheet.flatten(n.props.style).fontSize as number);
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(13);
  });
});

describe('TimeControl native stepper', () => {
  it('steps by 15 minutes', () => {
    const { r, onChange } = render(TimeControl, { mode: 'leave_at', hhmm: '17:30' });
    press(r, 'Leave at 17:30, change trip time'); // expand
    press(r, 'Later by 15 minutes');
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'leave_at', hhmm: '17:45' });
    press(r, 'Earlier by 15 minutes');
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'leave_at', hhmm: '17:15' });
  });
});

describe('TimeControl native stepper bounds and a11y', () => {
  const expand = (r: ReactTestRenderer, label: string) => press(r, label);
  const disabled = (r: ReactTestRenderer, label: string) =>
    r.root.findAll((n) => n.props.accessibilityLabel === label && n.props.accessibilityState)[0].props.accessibilityState.disabled;

  it('disables Earlier at the floor (now rounded up) and does not call onChange', () => {
    const { r, onChange } = render(TimeControl, { mode: 'leave_at', hhmm: '17:15' });
    expand(r, 'Leave at 17:15, change trip time');
    expect(disabled(r, 'Earlier by 15 minutes')).toBe(true);
    expect(disabled(r, 'Later by 15 minutes')).toBe(false);
    press(r, 'Earlier by 15 minutes');
    expect(onChange).not.toHaveBeenCalled();
  });
  it('disables Later at now + 23h45m', () => {
    const { r } = render(TimeControl, { mode: 'leave_at', hhmm: '16:45' });
    expand(r, 'Leave at 16:45 · Tomorrow, change trip time');
    expect(disabled(r, 'Later by 15 minutes')).toBe(true);
    expect(disabled(r, 'Earlier by 15 minutes')).toBe(false);
  });
  it('exposes the time as an adjustable with a value', () => {
    const { r } = render(TimeControl, { mode: 'arrive_by', hhmm: '18:00' });
    expand(r, 'Arrive by 18:00, change trip time');
    const adj = r.root.find((n) => n.props.accessibilityRole === 'adjustable');
    expect(adj.props.accessibilityValue).toEqual({ text: '18:00' });
    act(() => adj.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
  });
});

describe('TimeControl web time input', () => {
  it('renders an <input type="time"> with a label and 15-minute step, and reports changes', () => {
    const { r, onChange } = render(TimeControlWeb, { mode: 'arrive_by', hhmm: '18:00' });
    press(r, 'Arrive by 18:00, change trip time');
    const input = r.root.find((n) => (n.type as unknown) === 'input');
    expect(input.props.type).toBe('time');
    expect(input.props.value).toBe('18:00');
    expect(input.props.step).toBe(900);
    expect(input.props['aria-label']).toBe('Arrive by time');
    act(() => input.props.onChange({ target: { value: '19:30' } }));
    expect(onChange).toHaveBeenCalledWith({ mode: 'arrive_by', hhmm: '19:30' });
  });
});

describe.each([
  ['native', TimeControl],
  ['web', TimeControlWeb],
])('TimeControl (%s) labels and mode switching', (_n, Comp) => {
  it('labels the panel and the radiogroup', () => {
    const { r } = render(Comp, NOW_STATE);
    press(r, 'Leave now, change trip time');
    expect(JSON.stringify(r.toJSON())).toContain('Trip time · London');
    expect(r.root.find((n) => n.props.accessibilityRole === 'radiogroup').props.accessibilityLabel).toBe('Trip time');
  });
  it('keeps the chosen time when switching between Leave at and Arrive by', () => {
    const { r, onChange } = render(Comp, { mode: 'leave_at', hhmm: '18:30' });
    press(r, 'Leave at 18:30, change trip time');
    press(r, 'Arrive by');
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
    spy.mockRestore();
  });
});

describe('TimeControl focus return', () => {
  it('moves accessibility focus back to the chip when Leave now closes the panel', () => {
    jest.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native');
    const setFocus = jest.spyOn(rn.AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
    jest.spyOn(rn, 'findNodeHandle').mockReturnValue(42);
    const { r } = render(TimeControl, { mode: 'leave_at', hhmm: '18:30' });
    press(r, 'Leave at 18:30, change trip time');
    press(r, 'Leave now');
    act(() => {
      jest.runAllTimers();
    });
    expect(setFocus).toHaveBeenCalledWith(42);
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
});
