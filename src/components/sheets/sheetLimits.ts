/**
 * How tall the bottom sheet may grow. It never goes above 75% of the screen, and never above a
 * gap below the search bar, so the search stays tappable while the sheet sits on top of it.
 */
export const SHEET_MIN_HEIGHT = 80;
export const SHEET_MAX_SCREEN_RATIO = 0.75;
export const SEARCH_SHEET_GAP = 16;

export function sheetMaxHeight(windowHeight: number, searchBottomY: number): number {
  const ratioMax = windowHeight * SHEET_MAX_SCREEN_RATIO;
  const belowSearch = windowHeight - searchBottomY - SEARCH_SHEET_GAP;
  return Math.max(SHEET_MIN_HEIGHT, Math.min(ratioMax, belowSearch));
}
