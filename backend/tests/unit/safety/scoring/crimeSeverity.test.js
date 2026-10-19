const {
  CRIME_SEVERITY,
  severityOf,
} = require('../../../../src/safety/services/crimeSeverity');
const { CRIME } = require('../../../../src/safety/scoring/config');
const crimeClient = require('../../../../src/safety/services/crimeClient');

const EXPECTED_SEVERITY = {
  'violent-crime': 1.0,
  robbery: 1.0,
  'sexual-offences': 1.0,
  'possession-of-weapons': 0.9,
  'public-order': 0.7,
  'criminal-damage-arson': 0.6,
  burglary: 0.5,
  'vehicle-crime': 0.4,
  drugs: 0.4,
  'theft-from-the-person': 0.8,
  'bicycle-theft': 0.3,
  shoplifting: 0.2,
  'other-theft': 0.3,
  'anti-social-behaviour': 0.3,
  'other-crime': 0.4,
  unknown: 0.4,
};

describe('severityOf', () => {
  test.each(Object.entries(EXPECTED_SEVERITY))('%s has severity %p', (category, severity) => {
    expect(severityOf(category)).toBe(severity);
  });

  test('the table covers exactly the 16 Police API categories, nothing more', () => {
    expect(Object.keys(CRIME_SEVERITY).sort()).toEqual(Object.keys(EXPECTED_SEVERITY).sort());
  });

  test('every severity is in (0, 1]', () => {
    for (const severity of Object.values(CRIME_SEVERITY)) {
      expect(severity).toBeGreaterThan(0);
      expect(severity).toBeLessThanOrEqual(1);
    }
  });

  test('unrecognised, missing and non-string categories all get the single fallback 0.4', () => {
    expect(CRIME.SEVERITY_FALLBACK).toBe(0.4);
    for (const category of ['not-a-category', undefined, null, 42, '']) {
      expect(severityOf(category)).toBe(0.4);
    }
  });

  test('inherited object keys are not categories and get the fallback', () => {
    expect(severityOf('constructor')).toBe(0.4);
    expect(severityOf('toString')).toBe(0.4);
    expect(severityOf('__proto__')).toBe(0.4);
  });

  test('violent crime is more severe than shoplifting', () => {
    expect(severityOf('violent-crime')).toBeGreaterThan(severityOf('shoplifting'));
  });
});

describe('crimeClient severity table', () => {
  test('crimeClient re-exports the same table rather than a copy', () => {
    expect(crimeClient.CRIME_SEVERITY).toBe(CRIME_SEVERITY);
  });
});
