import React from 'react';
import { act, create } from 'react-test-renderer';

import WelcomeModal from '@/src/components/modals/WelcomeModal';
import { setOnboardingAccepted } from '@/src/services/onboarding';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/src/services/onboarding', () => ({
  setOnboardingAccepted: jest.fn(() => Promise.resolve()),
}));

describe('WelcomeModal hardware back (I-2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('back persists the accepted onboarding state before completing', async () => {
    const onComplete = jest.fn();
    let r!: ReturnType<typeof create>;
    await act(async () => {
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

    const modal = r.root.findAll((node) => typeof node.props.onRequestClose === 'function')[0];
    expect(modal).toBeDefined();
    await act(async () => {
      modal.props.onRequestClose();
    });

    expect(setOnboardingAccepted).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
