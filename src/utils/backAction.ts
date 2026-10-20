/**
 * What the Android hardware back button does on the map screen.
 * - navigation running: ask first, then stop it (the route options come back)
 * - route options shown: reset the search to the rest mode
 * - rest mode: the default back behaviour (leave the app)
 */
export type BackAction = 'confirm-stop-navigation' | 'reset-search' | 'exit';

export function decideBackAction(input: { isNavActive: boolean; hasRouteOptions: boolean }): BackAction {
  if (input.isNavActive) return 'confirm-stop-navigation';
  if (input.hasRouteOptions) return 'reset-search';
  return 'exit';
}
