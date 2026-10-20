/**
 * I-6: the success path of sendEmail must log the recipient domain only,
 * matching the fallback path. The local part of the address must not be logged.
 * Resend is mocked; no live email is sent.
 */

jest.mock('resend', () => ({
  Resend: class {
    constructor() {
      this.emails = {
        send: async () => ({ data: { id: 'fake-email-id' }, error: null }),
      };
    }
  },
}));

const RECIPIENT = 'alice.private@example.com';

function loadEmailModule() {
  let mod;
  jest.isolateModules(() => {
    mod = require('../../../src/shared/email');
  });
  return mod;
}

describe('I-6 email success logging', () => {
  const originalKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-key';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  test('logs the recipient domain and not the local part of the address', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { sendEmail } = loadEmailModule();

    const result = await sendEmail({
      to: RECIPIENT,
      subject: 'Welcome',
      html: '<p>Hi</p>',
    });

    expect(result).toEqual({ success: true, id: 'fake-email-id' });
    const logged = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('example.com');
    expect(logged).not.toContain('alice.private');
    expect(logged).not.toContain(RECIPIENT);
  });
});
