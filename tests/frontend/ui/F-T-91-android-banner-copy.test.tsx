import React from 'react';
import { Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AndroidDownloadBanner } from '@/src/components/ui/AndroidDownloadBanner';

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

describe('AndroidDownloadBanner copy (F-2 / T-91)', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    (Platform as { OS: string }).OS = 'web';
  });

  afterEach(() => {
    (Platform as { OS: string }).OS = originalOS;
  });

  it('no longer promises full navigation', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<AndroidDownloadBanner />);
    });
    const text = allText(r.toJSON());
    expect(text).not.toContain('for full navigation');
  });

  it('keeps a call to action that names the Android app', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<AndroidDownloadBanner />);
    });
    const text = allText(r.toJSON());
    expect(text).toMatch(/Download the Android app/);
  });
});
