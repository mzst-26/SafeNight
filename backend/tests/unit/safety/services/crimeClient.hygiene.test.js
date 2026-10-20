const path = require('path');

const CRIME_CLIENT = path.resolve(__dirname, '../../../../src/safety/services/crimeClient');
const CRIME_RISK = path.resolve(__dirname, '../../../../src/safety/scoring/crimeRisk');

describe('crimeClient hygiene (final review F17/F18)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  test('status constants are the ones defined in scoring/crimeRisk.js', () => {
    const crimeRisk = require(CRIME_RISK);
    const crimeClient = require(CRIME_CLIENT);

    expect(crimeClient.CRIME_STATUS_OK).toBe(crimeRisk.STATUS_OK);
    expect(crimeClient.CRIME_STATUS_UNAVAILABLE).toBe(crimeRisk.STATUS_UNAVAILABLE);
  });

  test('__resetForTests is exported under NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    jest.isolateModules(() => {
      const crimeClient = require(CRIME_CLIENT);
      expect(typeof crimeClient.__resetForTests).toBe('function');
    });
  });

  test('__resetForTests is not exported outside NODE_ENV=test', () => {
    process.env.NODE_ENV = 'production';
    jest.isolateModules(() => {
      const crimeClient = require(CRIME_CLIENT);
      expect(crimeClient.__resetForTests).toBeUndefined();
    });
  });

  test('the crime cache has a 32 MB memory byte budget', () => {
    const crimeClient = require(CRIME_CLIENT);

    expect(crimeClient.CRIME_CACHE_MAX_BYTES).toBe(32 * 1024 * 1024);
  });
});
