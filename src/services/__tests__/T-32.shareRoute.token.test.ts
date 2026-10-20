import AsyncStorage from '@react-native-async-storage/async-storage';

import { createRouteShareLink } from '@/src/services/shareRoute';
import { refreshIfNeeded } from '@/src/services/userApi';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
}));

jest.mock('@/src/services/userApi', () => ({
  refreshIfNeeded: jest.fn(async () => true),
}));

describe('createRouteShareLink token handling (T-32)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('token-abc');
    jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws when the create response has no share token', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ shareUrl: 'https://safe/link', expiresAt: '2099-01-01' }),
    } as Response);

    await expect(
      createRouteShareLink({ destination: { latitude: 50.3, longitude: -4.1 } }),
    ).rejects.toThrow(/token/i);
  });

  it('refreshes the session before creating the share link', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'share-2', shareUrl: 'https://safe/link', expiresAt: '2099-01-01' }),
    } as Response);

    await createRouteShareLink({});

    const refreshMock = jest.mocked(refreshIfNeeded);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock.mock.invocationCallOrder[0]).toBeLessThan(
      (global.fetch as jest.Mock).mock.invocationCallOrder[0],
    );
  });
});
