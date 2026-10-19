const FAKE_TOKEN = 'eyJfaketokenheader.fakepayloadSECRETPART.fakesig';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => FAKE_TOKEN),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

describe('stripeApi auth logging', () => {
  it('never logs any part of the access token', async () => {
    const logs: string[] = [];
    const capture = (...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(' '));
    };
    jest.spyOn(console, 'log').mockImplementation(capture);
    jest.spyOn(console, 'error').mockImplementation(capture);
    jest.spyOn(console, 'warn').mockImplementation(capture);

    (global as any).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ tier: 'free', hasStripeCustomer: false, stripeSubscription: null }),
      text: async () => '',
    }));

    const { stripeApi } = require('../stripeApi');
    await stripeApi.getStatus();

    const fetchMock = (global as any).fetch as jest.Mock;
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);

    const joined = logs.join('\n');
    expect(joined).not.toContain(FAKE_TOKEN.substring(0, 8));
    expect(joined).not.toContain('SECRETPART');
  });
});
