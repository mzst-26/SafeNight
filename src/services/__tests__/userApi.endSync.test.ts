const FAKE_TOKEN = 'eyJfakeheader.fakepayloadSECRET.fakesig';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    multiSet: jest.fn(),
    multiGet: jest.fn(async () => []),
    multiRemove: jest.fn(),
  },
}));

class FakeBlob {
  parts: unknown[];
  type: string;
  constructor(parts: unknown[], opts?: { type?: string }) {
    this.parts = parts;
    this.type = opts?.type ?? '';
  }
}

describe('liveApi.endSync beacon', () => {
  const originalBlob = (global as any).Blob;
  const originalNavigator = (global as any).navigator;

  afterEach(() => {
    (global as any).Blob = originalBlob;
    Object.defineProperty(global, 'navigator', { value: originalNavigator, configurable: true });
    delete (globalThis as any).__safenight_access_token;
  });

  it('sends the token in a text/plain JSON body, never in the URL', () => {
    const sendBeacon = jest.fn(() => true);
    (global as any).Blob = FakeBlob;
    Object.defineProperty(global, 'navigator', {
      value: { ...(originalNavigator || {}), sendBeacon },
      configurable: true,
    });
    (globalThis as any).__safenight_access_token = FAKE_TOKEN;

    const { liveApi } = require('../userApi');
    liveApi.endSync('completed');

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, FakeBlob];
    expect(url).not.toContain('?');
    expect(url).not.toContain(FAKE_TOKEN);
    expect(url.endsWith('/api/live/end')).toBe(true);
    expect(blob.type).toBe('text/plain');
    expect(JSON.parse(String(blob.parts[0]))).toEqual({
      status: 'completed',
      access_token: FAKE_TOKEN,
    });
  });
});
