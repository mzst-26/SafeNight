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

async function renderFor(props: { currentTier: string; isGift?: boolean; subscriptionEndsAt?: string | null }): Promise<string> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<SubscriptionModal visible onClose={jest.fn()} {...props} />);
  });
  return allText(r.toJSON());
}

const END_DATE = '2027-03-01T00:00:00.000Z';

describe('SubscriptionModal gift and end-date blocks for premium (F-3 / T-92)', () => {
  it('shows the gift block to a premium user exactly as to a pro user', async () => {
    const pro = await renderFor({ currentTier: 'pro', isGift: true, subscriptionEndsAt: END_DATE });
    const premium = await renderFor({ currentTier: 'premium', isGift: true, subscriptionEndsAt: END_DATE });
    expect(pro).toContain('Gifted Subscription');
    expect(premium).toContain('Gifted Subscription');
  });

  it('shows the subscription end date to a premium user exactly as to a pro user', async () => {
    const pro = await renderFor({ currentTier: 'pro', isGift: false, subscriptionEndsAt: END_DATE });
    const premium = await renderFor({ currentTier: 'premium', isGift: false, subscriptionEndsAt: END_DATE });
    expect(pro).toContain('Subscription ends:');
    expect(premium).toContain('Subscription ends:');
  });
});
