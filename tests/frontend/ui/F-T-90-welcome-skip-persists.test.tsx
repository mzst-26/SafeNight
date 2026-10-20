import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import WelcomeModal from '@/src/components/modals/WelcomeModal';
import { setOnboardingAccepted } from '@/src/services/onboarding';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied' })),
}));
jest.mock('@/src/services/onboarding', () => ({
  setOnboardingAccepted: jest.fn(() => Promise.resolve()),
  getOnboardingAccepted: jest.fn(() => Promise.resolve(false)),
}));

describe('WelcomeModal "Skip for now" (F-1 / T-90)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists the onboarding-accepted state before closing the wizard', async () => {
    const onComplete = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <WelcomeModal
          visible
          onComplete={onComplete}
          userName=""
          currentUsername={null}
          onSetUsername={jest.fn(() => Promise.resolve(true))}
          onSetName={jest.fn(() => Promise.resolve(true))}
          onAcceptLocation={jest.fn()}
          hasLocationPermission={false}
        />,
      );
    });

    const label = r.root.findAll((n) => n.props.children === 'Skip for now')[0];
    let pressable: ReactTestInstance | null = label;
    while (pressable && typeof pressable.props.onPress !== 'function') pressable = pressable.parent;
    expect(pressable).not.toBeNull();

    await act(async () => {
      await pressable!.props.onPress();
    });

    expect(setOnboardingAccepted).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
