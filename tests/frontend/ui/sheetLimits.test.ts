import { sheetMaxHeight, SHEET_MIN_HEIGHT, SEARCH_SHEET_GAP } from '@/src/components/sheets/sheetLimits';

describe('sheetMaxHeight', () => {
  it('keeps the 75% cap when the search bar is high on the screen', () => {
    expect(sheetMaxHeight(2000, 300)).toBe(1500);
  });

  it('stops the sheet a gap below the search bar, so the search stays tappable', () => {
    expect(sheetMaxHeight(2000, 1000)).toBe(2000 - 1000 - SEARCH_SHEET_GAP);
  });

  it('never goes below the collapsed height', () => {
    expect(sheetMaxHeight(2000, 1990)).toBe(SHEET_MIN_HEIGHT);
  });
});
