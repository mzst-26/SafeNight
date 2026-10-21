import {
  captureMapSnapshot,
  isUsableSnapshot,
  setMapSnapshotProvider,
} from '@/src/services/mapSnapshot';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

afterEach(() => {
  setMapSnapshotProvider(null);
  jest.useRealTimers();
});

describe('captureMapSnapshot', () => {
  test('returns null when no map is mounted', async () => {
    await expect(captureMapSnapshot()).resolves.toBeNull();
  });

  test('returns what the mounted map provides', async () => {
    setMapSnapshotProvider(async () => JPEG);
    await expect(captureMapSnapshot()).resolves.toBe(JPEG);
  });

  test('returns null when the map fails to capture', async () => {
    setMapSnapshotProvider(async () => {
      throw new Error('map not ready');
    });
    await expect(captureMapSnapshot()).resolves.toBeNull();
  });

  test('gives up after the timeout so the explanation is never blocked', async () => {
    jest.useFakeTimers();
    setMapSnapshotProvider(() => new Promise(() => {}));
    const pending = captureMapSnapshot(3000);
    jest.advanceTimersByTime(3000);
    await expect(pending).resolves.toBeNull();
  });
});

describe('isUsableSnapshot', () => {
  test('accepts a JPEG or PNG data URL', () => {
    expect(isUsableSnapshot(JPEG)).toBe(true);
    expect(isUsableSnapshot('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });

  test('rejects anything that is not an image data URL', () => {
    expect(isUsableSnapshot('https://example.com/map.png')).toBe(false);
    expect(isUsableSnapshot('data:text/html;base64,PGgxPg==')).toBe(false);
    expect(isUsableSnapshot(null)).toBe(false);
  });

  test('rejects images over about 300 KB', () => {
    expect(isUsableSnapshot(`data:image/jpeg;base64,${'A'.repeat(400_001)}`)).toBe(false);
  });
});
