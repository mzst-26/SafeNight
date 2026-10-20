import { decideBackAction } from '@/src/utils/backAction';

describe('decideBackAction', () => {
  it('asks to confirm when navigation is running', () => {
    expect(decideBackAction({ isNavActive: true, hasRouteOptions: true })).toBe('confirm-stop-navigation');
  });

  it('asks to confirm during navigation even when the route options are not shown', () => {
    expect(decideBackAction({ isNavActive: true, hasRouteOptions: false })).toBe('confirm-stop-navigation');
  });

  it('resets the search when route options are shown and navigation is not running', () => {
    expect(decideBackAction({ isNavActive: false, hasRouteOptions: true })).toBe('reset-search');
  });

  it('leaves the default back behaviour in the rest mode', () => {
    expect(decideBackAction({ isNavActive: false, hasRouteOptions: false })).toBe('exit');
  });
});
