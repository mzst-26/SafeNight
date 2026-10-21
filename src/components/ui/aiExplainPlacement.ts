/**
 * Where the "why this route" button appears.
 * - floating: the chip above the sheet (native and phone web).
 * - card: a small circle on the recommended route card (desktop web sidebar).
 * - none: logged out, navigating, or no route explanation is available.
 */
export type AIExplainPlacement = 'floating' | 'card' | 'none';

export function aiExplainPlacement(input: {
  isWeb: boolean;
  isPhoneWeb: boolean;
  isLoggedIn: boolean;
  isNavActive: boolean;
  hasRoutes: boolean;
  hasSafety: boolean;
}): AIExplainPlacement {
  if (!input.isLoggedIn || input.isNavActive || !input.hasRoutes || !input.hasSafety) return 'none';
  if (!input.isWeb || input.isPhoneWeb) return 'floating';
  return 'card';
}
