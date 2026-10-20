import AsyncStorage from '@react-native-async-storage/async-storage';

import { createRouteShareLink } from '@/src/services/shareRoute';
import { refreshIfNeeded } from '@/src/services/userApi';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
}));

jest.mock('@/src/services/userApi', () => ({
  refreshIfNeeded: jest.fn(async () => true),
}));

describe('createRouteShareLink when refresh clears the session (I-1)', () => {
  let stored: string | null;

  beforeEach(() => {
    jest.clearAllMocks();
    stored = 'old-dead-token';
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async () => stored);
    // Refresh invalidates the session: storage is empty afterwards.
    jest.mocked(refreshIfNeeded).mockImplementation(async () => {
      stored = null;
      return false;
    });
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws and does not send the pre-refresh token', async () => {
    await expect(createRouteShareLink({})).rejects.toThrow();

    const sentAuthHeaders = (global.fetch as jest.Mock).mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string> | undefined)?.Authorization,
    );
    expect(sentAuthHeaders).not.toContain('Bearer old-dead-token');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
