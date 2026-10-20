/**
 * Where the route guide (legend) button sits on the native map, as a distance from the bottom.
 * Above the bottom sheet when the sheet is shown; above the navigation bar during navigation.
 */
export const LEGEND_MIN_BOTTOM_PX = 38;
export const LEGEND_SHEET_GAP_PX = 8;
/** How much lower than the sheet's top edge the guide sits (a bit lower than before). */
export const LEGEND_LOWER_PX = 40;
export const LEGEND_NAV_BOTTOM_PX = 190;

export function legendBottomPx(input: {
  isWeb: boolean;
  navActive: boolean;
  sheetVisible: boolean;
  windowHeight: number;
  sheetTopY: number;
}): number {
  if (input.isWeb) return LEGEND_MIN_BOTTOM_PX;
  if (input.navActive) return LEGEND_NAV_BOTTOM_PX;
  if (!input.sheetVisible) return LEGEND_MIN_BOTTOM_PX;
  const lift = input.windowHeight - input.sheetTopY + LEGEND_SHEET_GAP_PX - LEGEND_LOWER_PX;
  return Math.max(LEGEND_MIN_BOTTOM_PX, Math.round(lift));
}
