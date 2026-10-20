import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { LimitReachedModal } from '@/src/components/modals/LimitReachedModal';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function allText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(allText).join('');
  if (typeof node === 'object' && 'children' in (node as object)) {
    return allText((node as { children: unknown }).children);
  }
  return '';
}

function render(currentTier: string): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <LimitReachedModal
        visible
        onClose={jest.fn()}
        onUpgrade={jest.fn()}
        limitInfo={{
          feature: 'route_search',
          limit: 5,
          used: 5,
          currentTier,
          errorType: 'limit_reached',
          resetsAt: null,
          per: 'day',
        } as any}
      />,
    );
  });
  return r;
}

describe('LimitReachedModal upgrade copy (T-37)', () => {
  it('names the Guarded plan for a free user', () => {
    const text = allText(render('free').toJSON());
    expect(text).toContain('Upgrade to Guarded');
    expect(text).not.toContain('Pro or Premium');
  });
});
