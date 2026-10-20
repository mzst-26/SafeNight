import { buildStreamUrl } from '@/src/hooks/usePathfindingVisualization';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const O = { latitude: 51.5, longitude: -0.1 };
const D = { latitude: 51.52, longitude: -0.12 };

describe('buildStreamUrl', () => {
  it('has no time params for leave now', () => {
    const url = buildStreamUrl('http://api', O, D);
    expect(url).toBe('http://api/api/safe-routes/stream?origin_lat=51.5&origin_lng=-0.1&dest_lat=51.52&dest_lng=-0.12');
  });
  it('adds exactly one of leave_at / arrive_by', () => {
    expect(buildStreamUrl('http://api', O, D, { arrive_by: '2026-10-21T18:00:00+01:00' })).toMatch(
      /&arrive_by=2026-10-21T18%3A00%3A00%2B01%3A00$/,
    );
    expect(buildStreamUrl('http://api', O, D, { leave_at: '2026-10-21T18:00:00+01:00' })).not.toContain('arrive_by');
  });
});
