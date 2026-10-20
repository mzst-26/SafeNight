import React from 'react';
import { Linking, Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MobileWebSearchBar } from '@/src/components/search/MobileWebSearchBar';
import { AppError } from '@/src/types/errors';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/src/components/search/SavedPlaces', () => ({ SavedPlaces: () => null }));
jest.mock('@/src/components/search/SafetyLevelToggle', () => ({ SafetyLevelToggle: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rn = require('react-native');

let originalOS: string;
beforeEach(() => {
  originalOS = rn.Platform.OS;
});
afterEach(() => {
  rn.Platform.OS = originalOS;
  jest.restoreAllMocks();
});

function allText(node: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') {
      out.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object' && 'children' in (n as object)) {
      walk((n as { children: unknown }).children);
    }
  };
  walk(node);
  return out;
}

const search = (overrides: Record<string, unknown> = {}) =>
  ({
    query: '',
    place: null,
    predictions: [],
    status: 'idle',
    error: null,
    clear: jest.fn(),
    setQuery: jest.fn(),
    isLoading: false,
    ...overrides,
  }) as any;

function render(opts: {
  location: null | { latitude: number; longitude: number };
  destSearch?: any;
  originSearch?: any;
}): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <MobileWebSearchBar
        location={opts.location}
        isUsingCurrentLocation
        setIsUsingCurrentLocation={jest.fn()}
        originSearch={opts.originSearch ?? search()}
        manualOrigin={null}
        setManualOrigin={jest.fn()}
        destSearch={opts.destSearch ?? search()}
        manualDest={null}
        setManualDest={jest.fn()}
        pinMode={null}
        setPinMode={jest.fn()}
        onPanTo={jest.fn()}
        onClearRoute={jest.fn()}
        onSwap={jest.fn()}
        hasResults={false}
      />,
    );
  });
  return r;
}

describe('MobileWebSearchBar origin when location is unavailable on native (T-39)', () => {
  it('tells the user location is off and offers Open settings', () => {
    rn.Platform.OS = 'android';
    const r = render({ location: null });
    const text = allText(r.toJSON());
    expect(text).toContain('Location is off. Tap to enter a start point.');
    expect(text).not.toContain('Getting location...');
    expect(text).toContain('Open settings');
  });

  it('opens the app settings when Open settings is pressed', () => {
    rn.Platform.OS = 'android';
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const r = render({ location: null });
    const action = r.root.find((n) => n.props.accessibilityLabel === 'Open settings' && typeof n.props.onPress === 'function');
    act(() => action.props.onPress({ stopPropagation: jest.fn() }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('keeps the getting-location text on web', () => {
    rn.Platform.OS = 'web';
    const r = render({ location: null });
    const text = allText(r.toJSON());
    expect(text).toContain('Getting location...');
    expect(text).not.toContain('Open settings');
  });
});

describe('MobileWebSearchBar destination search feedback (T-45)', () => {
  it('shows the failure line when the search errors', () => {
    const r = render({
      location: null,
      destSearch: search({ status: 'error', error: new AppError('autocomplete_error', 'Search failed') }),
    });
    expect(allText(r.toJSON())).toContain('Search failed. Try again.');
  });

  it('shows the empty-result line when a search finds nothing', () => {
    const r = render({
      location: null,
      destSearch: search({ status: 'error', error: new AppError('no_results', 'No places found anywhere') }),
    });
    expect(allText(r.toJSON())).toContain('No places match that search.');
  });
});

describe('MobileWebSearchBar accessibility labels (T-48)', () => {
  it('labels the back arrow as Back to map', () => {
    const r = render({ location: null });
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Back to map').length).toBeGreaterThan(0);
  });

  it('labels the swap control and keeps a 48 dp touch target', () => {
    const r = render({ location: null });
    const swap = r.root.find(
      (n) => n.props.accessibilityLabel === 'Swap start and destination' && typeof n.props.onPress === 'function',
    );
    const hitSlop = swap.props.hitSlop;
    const width = 32;
    expect(width + 2 * (typeof hitSlop === 'number' ? hitSlop : hitSlop.left)).toBeGreaterThanOrEqual(48);
  });
});
