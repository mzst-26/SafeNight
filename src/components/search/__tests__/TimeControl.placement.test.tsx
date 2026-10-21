import React from 'react';
import { Modal, Text } from 'react-native';
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

  it('hides the time stepper once a time is chosen, leaving one row', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<TimeControl inline value={{ mode: 'leave_at', hhmm: '18:30' }} onChange={jest.fn()} />);
    });
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Earlier by 15 minutes').length).toBe(0);
  });

  it('shows the time stepper again when Leave at is pressed', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<TimeControl inline value={{ mode: 'leave_at', hhmm: '18:30' }} onChange={jest.fn()} />);
    });
    const leaveAt = r.root.findAll((n) => n.props.accessibilityLabel === 'Leave at' && n.props.accessibilityRole === 'radio')[0];
    act(() => leaveAt.props.onPress());
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Earlier by 15 minutes').length).toBeGreaterThan(0);
  });

  it('opens the time row as an overlay, absolutely positioned, so the items below do not move', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<TimeControl inline value={{ mode: 'leave_at', hhmm: '18:30' }} onChange={jest.fn()} />);
    });
    const leaveAt = r.root.findAll((n) => n.props.accessibilityLabel === 'Leave at' && n.props.accessibilityRole === 'radio')[0];
    act(() => leaveAt.props.onPress());
    const stepper = r.root.findAll((n) => n.props.accessibilityLabel === 'Earlier by 15 minutes')[0];
    const flatten = (x: any) => (Array.isArray(x) ? Object.assign({}, ...x.flat(Infinity).filter(Boolean)) : x ?? {});
    let p: any = stepper.parent;
    let absolute = false;
    while (p) {
      if (flatten(p.props.style).position === 'absolute') absolute = true;
      p = p.parent;
    }
    expect(absolute).toBe(true);
  });

  it('keeps the time row open after Leave at is picked, until a time is chosen', () => {
    jest.useFakeTimers();
    try {
      let r!: ReactTestRenderer;
      act(() => {
        r = create(<TimeControl inline value={NOW_STATE} onChange={jest.fn()} />);
      });
      const leaveAt = r.root.findAll((n) => n.props.accessibilityLabel === 'Leave at' && n.props.accessibilityRole === 'radio')[0];
      act(() => leaveAt.props.onPress());
      act(() => {
        jest.advanceTimersByTime(1500);
      });
      expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Earlier by 15 minutes').length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders the open desktop time row as a modal popup, outside the sidebar tree', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<TimeControl inline value={{ mode: 'leave_at', hhmm: '18:30' }} onChange={jest.fn()} />);
    });
    const leaveAt = r.root.findAll((n) => n.props.accessibilityLabel === 'Leave at' && n.props.accessibilityRole === 'radio')[0];
    act(() => leaveAt.props.onPress());
    const modal = r.root.findAll((n) => n.type === Modal)[0];
    expect(modal).toBeDefined();
    expect(modal.props.visible).toBe(true);
    expect(modal.findAll((n) => n.props.accessibilityLabel === 'Earlier by 15 minutes').length).toBeGreaterThan(0);
  });

  it('shows the desktop mode buttons slim: smaller text and a shorter button', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<TimeControl inline value={NOW_STATE} onChange={jest.fn()} />);
    });
    const flatten = (x: any) => (Array.isArray(x) ? Object.assign({}, ...x.flat(Infinity).filter(Boolean)) : x ?? {});
    const leaveNow = r.root.findAll((n) => n.props.accessibilityLabel === 'Leave now' && n.props.accessibilityRole === 'radio')[0];
    const text = leaveNow.findAll((n) => n.type === Text)[0];
    expect(flatten(text.props.style).fontSize).toBeLessThanOrEqual(11);
    expect(flatten(leaveNow.props.style).minHeight).toBeLessThanOrEqual(34);
  });

  it('gives the desktop mode selector space from the top and a glass selected state, not a blue outline', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<TimeControl inline value={NOW_STATE} onChange={jest.fn()} />);
    });
    const flatten = (x: any) => (Array.isArray(x) ? Object.assign({}, ...x.flat(Infinity).filter(Boolean)) : x ?? {});
    const radio = r.root.findAll((n) => n.props.accessibilityLabel === 'Leave now' && n.props.accessibilityRole === 'radio')[0];
    const paddingTops: number[] = [];
    for (let p: any = radio.parent; p; p = p.parent) {
      const pt = flatten(p.props.style).paddingTop;
      if (typeof pt === 'number') paddingTops.push(pt);
    }
    expect(Math.max(...paddingTops)).toBeGreaterThanOrEqual(8);
    const selected = r.root.findAll((n) => n.props.accessibilityLabel === 'Now' || n.props.accessibilityLabel === 'Leave now')[0];
    expect(flatten(selected.props.style).borderColor).not.toBe('#1570ef');
  });

  it('makes the desktop mode container as tall as the round place buttons (40px)', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<TimeControl inline value={NOW_STATE} onChange={jest.fn()} />);
    });
    const flatten = (x: any) => (Array.isArray(x) ? Object.assign({}, ...x.flat(Infinity).filter(Boolean)) : x ?? {});
    const segments = r.root.findAll((n) => n.props.accessibilityLabel === 'Trip time, London')[0];
    expect(flatten(segments.props.style).height).toBe(40);
  });

  it('has one container only for the desktop mode buttons: no outer panel with padding or border', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<TimeControl inline value={NOW_STATE} onChange={jest.fn()} />);
    });
    const flatten = (x: any) => (Array.isArray(x) ? Object.assign({}, ...x.flat(Infinity).filter(Boolean)) : x ?? {});
    const segments = r.root.findAll((n) => n.props.accessibilityLabel === 'Trip time, London')[0];
    const outer = segments.parent!;
    const st = flatten(outer.props.style);
    expect(st.padding ?? 0).toBe(0);
    expect(st.borderWidth ?? 0).toBe(0);
    expect(st.backgroundColor ?? 'transparent').toBe('transparent');
  });
});
