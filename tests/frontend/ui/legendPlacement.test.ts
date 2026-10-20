import { RL_LEGEND_ICON_SVG } from '@/src/components/maps/inline/legend';
import { legendBottomPx, LEGEND_LOWER_PX } from '@/src/components/maps/legendPlacement';

describe('route guide icon', () => {
  it('is a question mark in a circle, not the shield', () => {
    expect(RL_LEGEND_ICON_SVG).toContain('<circle');
    expect(RL_LEGEND_ICON_SVG).toMatch(/M9\.5 9\.2/);
    expect(RL_LEGEND_ICON_SVG).not.toContain('M12 2.5l7.5');
  });
});

describe('legendBottomPx', () => {
  const base = { isWeb: false, navActive: false, sheetVisible: true, windowHeight: 2000, sheetTopY: 1910 };

  it('sits a bit lower than the old position above the sheet', () => {
    // Old lift: windowHeight - sheetTopY + 8 = 98. Now 40px lower: 58.
    expect(legendBottomPx(base)).toBe(98 - LEGEND_LOWER_PX);
  });

  it('never drops below the 38px floor, so it stays clear of the attribution box', () => {
    expect(legendBottomPx({ ...base, sheetTopY: 1990 })).toBe(38);
  });

  it('uses the floor when the sheet is hidden', () => {
    expect(legendBottomPx({ ...base, sheetVisible: false })).toBe(38);
  });

  it('lifts above the navigation bar during navigation', () => {
    expect(legendBottomPx({ ...base, navActive: true })).toBe(190);
  });

  it('keeps the web value', () => {
    expect(legendBottomPx({ ...base, isWeb: true })).toBe(38);
  });
});
