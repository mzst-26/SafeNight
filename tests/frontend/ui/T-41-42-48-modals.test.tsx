import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { AIExplanationModal } from '@/src/components/modals/AIExplanationModal';
import { DownloadAppModal } from '@/src/components/modals/DownloadAppModal';
import { OnboardingModal } from '@/src/components/modals/OnboardingModal';
import WelcomeModal from '@/src/components/modals/WelcomeModal';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied' })),
}));
jest.mock('@/src/services/onboarding', () => ({
  setOnboardingAccepted: jest.fn(() => Promise.resolve()),
}));

function allText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(allText).join('');
  if (typeof node === 'object' && 'children' in (node as object)) {
    return allText((node as { children: unknown }).children);
  }
  return '';
}

describe('WelcomeModal first step (T-41)', () => {
  function render(onComplete: () => void): ReactTestRenderer {
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
    return r;
  }

  it('offers a Skip for now control that calls onComplete', () => {
    const onComplete = jest.fn();
    const r = render(onComplete);
    expect(allText(r.toJSON())).toContain('Skip for now');
    const label = r.root.findAll((n) => n.props.children === 'Skip for now')[0];
    let pressable: ReactTestInstance | null = label;
    while (pressable && typeof pressable.props.onPress !== 'function') pressable = pressable.parent;
    expect(pressable).not.toBeNull();
    act(() => pressable!.props.onPress());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete when Android back requests close', () => {
    const onComplete = jest.fn();
    const r = render(onComplete);
    const modal = r.root.find((n) => typeof n.props.onRequestClose === 'function');
    act(() => modal.props.onRequestClose());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('DownloadAppModal and OnboardingModal back button (T-42)', () => {
  it('DownloadAppModal onRequestClose calls onClose', () => {
    const onClose = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<DownloadAppModal visible onClose={onClose} />);
    });
    const modal = r.root.find((n) => typeof n.props.onRequestClose === 'function');
    act(() => modal.props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('OnboardingModal onRequestClose calls onDismiss', () => {
    const onDismiss = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <OnboardingModal visible error={null} onAccept={jest.fn()} onDismiss={onDismiss} />,
      );
    });
    const modal = r.root.find((n) => typeof n.props.onRequestClose === 'function');
    act(() => modal.props.onRequestClose());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('AIExplanationModal close control (T-48)', () => {
  it('labels Close with a 12 dp hit slop', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <AIExplanationModal
          visible
          onClose={jest.fn()}
          ai={{ status: 'ready', explanation: 'Looks fine', error: null, ask: jest.fn() } as any}
        />,
      );
    });
    const close = r.root.find((n) => n.props.accessibilityLabel === 'Close' && typeof n.props.onPress === 'function');
    expect(close.props.hitSlop).toBe(12);
  });
});
