import { aiExplainPlacement } from '@/src/components/ui/aiExplainPlacement';

const base = {
  isWeb: false,
  isPhoneWeb: false,
  isLoggedIn: true,
  isNavActive: false,
  hasRoutes: true,
  hasSafety: true,
};

describe('aiExplainPlacement', () => {
  test('native shows the floating button', () => {
    expect(aiExplainPlacement(base)).toBe('floating');
  });

  test('phone web shows the same floating button as native', () => {
    expect(aiExplainPlacement({ ...base, isWeb: true, isPhoneWeb: true })).toBe('floating');
  });

  test('desktop web puts the button on the recommended card instead', () => {
    expect(aiExplainPlacement({ ...base, isWeb: true, isPhoneWeb: false })).toBe('card');
  });

  test.each([
    ['logged out', { isLoggedIn: false }],
    ['navigating', { isNavActive: true }],
    ['no routes', { hasRoutes: false }],
    ['no safety result', { hasSafety: false }],
  ])('hidden when %s, on every layout', (_label, change) => {
    const input = { ...base, ...change };
    expect(aiExplainPlacement({ ...input, isWeb: false, isPhoneWeb: false })).toBe('none');
    expect(aiExplainPlacement({ ...input, isWeb: true, isPhoneWeb: true })).toBe('none');
    expect(aiExplainPlacement({ ...input, isWeb: true, isPhoneWeb: false })).toBe('none');
  });
});
