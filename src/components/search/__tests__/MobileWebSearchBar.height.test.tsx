import React from 'react';
import { act, create } from 'react-test-renderer';

import { expandedContainerHeight, MobileWebSearchBar } from '@/src/components/search/MobileWebSearchBar';
import { NOW_STATE } from '@/src/utils/tripTime';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/src/components/search/SavedPlaces', () => ({ SavedPlaces: () => null }));
jest.mock('@/src/components/search/SafetyLevelToggle', () => ({ SafetyLevelToggle: () => null }));

describe('expandedContainerHeight', () => {
  it('keeps the 160 floor and grows with the measured card', () => {
    expect(expandedContainerHeight(100)).toBe(160);
    expect(expandedContainerHeight(260)).toBe(260);
  });
});

const search = () =>
  ({ query: '', place: null, predictions: [], clear: jest.fn(), setQuery: jest.fn(), isLoading: false }) as any;

describe('MobileWebSearchBar expanded card', () => {
  it('measures the expanded card on every platform (not only Android) and renders the trip-time row inside it', () => {
    let r!: ReturnType<typeof create>;
    act(() => {
      r = create(
        <MobileWebSearchBar
          location={null}
          isUsingCurrentLocation
          setIsUsingCurrentLocation={jest.fn()}
          originSearch={search()}
          manualOrigin={null}
          setManualOrigin={jest.fn()}
          destSearch={search()}
          manualDest={null}
          setManualDest={jest.fn()}
          pinMode={null}
          setPinMode={jest.fn()}
          onPanTo={jest.fn()}
          onClearRoute={jest.fn()}
          onSwap={jest.fn()}
          hasResults={false}
          tripTime={NOW_STATE}
          onTripTimeChange={jest.fn()}
        />,
      );
    });
    const card = r.root.findAll((n) => typeof n.props.onLayout === 'function' && n.props.pointerEvents !== undefined);
    expect(card.length).toBeGreaterThan(0);
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Leave now, change trip time').length).toBeGreaterThan(0);
    act(() => card[0].props.onLayout({ nativeEvent: { layout: { height: 300 } } }));
  });
});
