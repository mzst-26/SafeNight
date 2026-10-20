import { fetchCrimesForSegment } from '@/src/services/safety';
import { reverseGeocode } from '@/src/services/openStreetMap';

/**
 * A fetch that never settles on its own. It honours AbortSignal the way the
 * real fetch does: it rejects with an AbortError once the signal aborts.
 */
const hangingFetch = () =>
  jest.fn((_url: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  });

describe('request timeouts (T-19)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('safety fetchJson aborts a never-resolving police request within the timeout', async () => {
    const fetchMock = hangingFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    const segment = {
      start: { latitude: 51.5, longitude: -0.12 },
      end: { latitude: 51.501, longitude: -0.119 },
    } as unknown as Parameters<typeof fetchCrimesForSegment>[0];

    const pending = fetchCrimesForSegment(segment);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = (fetchMock.mock.calls[0][1] as RequestInit | undefined)?.signal as AbortSignal;

    await jest.advanceTimersByTimeAsync(31_000);

    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(true);
    await expect(pending).resolves.toEqual([]);
  });

  it('reverseGeocode aborts a never-resolving geocode request within the timeout', async () => {
    const fetchMock = hangingFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = reverseGeocode({ latitude: 51.5, longitude: -0.12 });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = (fetchMock.mock.calls[0][1] as RequestInit | undefined)?.signal as AbortSignal;

    await jest.advanceTimersByTimeAsync(31_000);

    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(true);
    await expect(pending).resolves.toBeNull();
  });
});
