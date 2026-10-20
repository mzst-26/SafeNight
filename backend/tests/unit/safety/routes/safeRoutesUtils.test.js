const {
  stripPH,
  checkOpenNow,
  heuristicOpen,
  safetyLabel,
  segmentColor,
} = require('../../../../src/safety/routes/safeRoutesUtils');

describe('safeRoutesUtils', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('stripPH returns input when it is falsy', () => {
    expect(stripPH(null)).toBeNull();
  });

  test('stripPH removes standalone PH clauses', () => {
    const result = stripPH('Mo-Su 07:00-23:00; PH off');

    expect(result).toBe('Mo-Su 07:00-23:00');
  });

  test('stripPH returns null when every segment is removed', () => {
    const result = stripPH('PH off');

    expect(result).toBeNull();
  });

  test('checkOpenNow returns unknown for empty input', () => {
    const result = checkOpenNow('');

    expect(result).toEqual({ open: null, nextChange: null });
  });

  test('checkOpenNow returns unknown for invalid hours expression', () => {
    const result = checkOpenNow('not-a-valid-hours-string');

    expect(result).toEqual({ open: null, nextChange: null });
  });

  test('heuristicOpen marks always-open amenity as open', () => {
    const result = heuristicOpen('hospital');

    expect(result.open).toBe(true);
  });

  test('heuristicOpen marks evening places as open in evening window', () => {
    const result = heuristicOpen('pub', 18);

    expect(result).toEqual({ open: true, nextChange: 'closes at 23:00' });
  });

  test('heuristicOpen marks evening places as closed outside evening window', () => {
    const result = heuristicOpen('bar', 3);

    expect(result).toEqual({ open: false, nextChange: 'opens at 10:00' });
  });

  test('heuristicOpen marks daytime generic places as open', () => {
    const result = heuristicOpen('library', 10);

    expect(result).toEqual({ open: true, nextChange: 'closes at 20:00' });
  });

  test('heuristicOpen marks nighttime generic places as closed', () => {
    const result = heuristicOpen('library', 22);

    expect(result).toEqual({ open: false, nextChange: 'opens at 07:00' });
  });

  test('safetyLabel returns very-safe label for high scores', () => {
    const result = safetyLabel(90);

    expect(result.label).toBe('Very Safe');
  });

  test('safetyLabel returns safe label for medium-high scores', () => {
    expect(safetyLabel(60)).toEqual({ label: 'Safe', color: '#558B2F' });
  });

  test('safetyLabel returns moderate label for mid-range scores', () => {
    expect(safetyLabel(40)).toEqual({ label: 'Moderate', color: '#F9A825' });
  });

  test('safetyLabel returns caution label for low scores', () => {
    expect(safetyLabel(10)).toEqual({ label: 'Use Caution', color: '#C62828' });
  });

  test('segmentColor returns green for safest range', () => {
    expect(segmentColor(0.8)).toBe('#4CAF50');
  });

  test('segmentColor returns light-green for safe range', () => {
    expect(segmentColor(0.6)).toBe('#8BC34A');
  });

  test('segmentColor returns yellow for moderate range', () => {
    expect(segmentColor(0.4)).toBe('#FFC107');
  });

  test('segmentColor returns orange for lower range', () => {
    expect(segmentColor(0.25)).toBe('#FF9800');
  });

  test('segmentColor returns caution color for low score', () => {
    const result = segmentColor(0.1);

    expect(result).toBe('#F44336');
  });
});

describe('open-now uses the chosen time, not the server clock', () => {
  test('a pub is open at 11:00 and closed at 03:00', () => {
    expect(heuristicOpen('pub', 11).open).toBe(true);
    expect(heuristicOpen('pub', 3).open).toBe(false);
    expect(heuristicOpen('pub', 3).nextChange).toBe('opens at 10:00');
  });
  test('the hour argument beats the server clock', () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    expect(heuristicOpen('pub', 12).open).toBe(true);
  });
  test('checkOpenNow evaluates the given instant and reports London times', () => {
    // 2026-10-20 is a Tuesday. 17:00 BST = 16:00Z.
    const open = checkOpenNow('Mo-Su 10:00-22:00', new Date('2026-10-20T16:00:00Z'));
    const closed = checkOpenNow('Mo-Su 10:00-22:00', new Date('2026-10-20T02:00:00Z'));
    expect(open.open).toBe(true);
    expect(open.nextChange).toBe('closes at 22:00');
    expect(closed.open).toBe(false);
    expect(closed.nextChange).toBe('opens at 10:00');
  });
});
