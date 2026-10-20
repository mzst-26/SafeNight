import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SubscriptionModal } from '@/src/components/modals/SubscriptionModal';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/src/services/stripeApi', () => ({
  stripeApi: {
    getStatus: jest.fn(() => Promise.resolve(null)),
    createCheckout: jest.fn(),
    createPortal: jest.fn(),
    cancelSubscription: jest.fn(),
  },
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

async function renderFor(currentTier: string): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <SubscriptionModal visible currentTier={currentTier} onClose={jest.fn()} />,
    );
  });
  return r;
}

describe('SubscriptionModal for a premium user (T-36)', () => {
  it('shows the Premium badge, not Free', async () => {
    const r = await renderFor('premium');
    const text = allText(r.toJSON());
    expect(text).toContain('Current plan: Premium');
    expect(text).not.toContain('Current plan: Free');
  });

  it('does not offer the Guarded upgrade card to a premium user', async () => {
    const r = await renderFor('premium');
    const text = allText(r.toJSON());
    expect(text).not.toContain('Upgrade to Guarded');
    expect(text).not.toContain('Switch to Guarded');
    expect(text).toContain("You're on the top plan!");
  });

  it('still offers Guarded to a free user', async () => {
    const r = await renderFor('free');
    const text = allText(r.toJSON());
    expect(text).toContain('Current plan: Free');
    expect(text).toContain('Upgrade to Guarded');
  });
});
