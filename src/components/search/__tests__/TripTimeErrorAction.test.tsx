import React from 'react';
import { act, create } from 'react-test-renderer';

import { isTripTimeError, TripTimeErrorAction } from '@/src/components/search/TripTimeErrorAction';

describe('TripTimeErrorAction', () => {
  it.each(['INVALID_TIME', 'TIME_OUT_OF_RANGE'])('offers "Back to Leave now" for %s', (code) => {
    const onReset = jest.fn();
    let r!: ReturnType<typeof create>;
    act(() => {
      r = create(<TripTimeErrorAction code={code} onReset={onReset} />);
    });
    const btn = r.root.find((n) => n.props.accessibilityLabel === 'Back to Leave now' && n.props.onPress);
    expect(btn.props.style).toBeDefined();
    act(() => btn.props.onPress());
    expect(onReset).toHaveBeenCalledTimes(1);
  });
  it('renders nothing for other errors', () => {
    let r!: ReturnType<typeof create>;
    act(() => {
      r = create(<TripTimeErrorAction code="NO_ROUTE_FOUND" onReset={jest.fn()} />);
    });
    expect(r.toJSON()).toBeNull();
    expect(isTripTimeError('NO_ROUTE_FOUND')).toBe(false);
  });
});
