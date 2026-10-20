/**
 * T-54 (SEC-18): with RESEND_API_KEY unset, the fallback must not log the
 * email body and must log only the recipient domain.
 * T-55 (SEC-20): user names interpolated into the HTML body must be escaped.
 * Resend is mocked; no live email is sent.
 */

const mockSent = [];

jest.mock('resend', () => ({
  Resend: class {
    constructor() {
      this.emails = {
        send: async (payload) => {
          mockSent.push(payload);
          return { data: { id: 'fake-email-id' }, error: null };
        },
      };
    }
  },
}));

const FAKE_BODY_TOKEN = 'FAKE-TOKEN-do-not-log-9f2c';
const RECIPIENT = 'alice.private@example.com';

function loadEmailModule() {
  let mod;
  jest.isolateModules(() => {
    mod = require('../../../src/shared/email');
  });
  return mod;
}

describe('T-54 email fallback logging (RESEND_API_KEY unset)', () => {
  const originalKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    mockSent.length = 0;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  test('does not pass the email body to the logger and logs only the recipient domain', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendEmail } = loadEmailModule();

    const result = await sendEmail({
      to: RECIPIENT,
      subject: 'Your sign-in link',
      html: `<p>Use ${FAKE_BODY_TOKEN}</p>`,
      text: `Use ${FAKE_BODY_TOKEN}`,
    });

    expect(result).toEqual({ success: true, fallback: true });

    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((args) => args.map(String).join(' '))
      .join('\n');

    expect(logged).not.toContain(FAKE_BODY_TOKEN);
    expect(logged).toContain('Your sign-in link');
    expect(logged).toContain('example.com');
    expect(logged).not.toContain('alice.private');

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('T-55 HTML escaping of user-supplied names', () => {
  const originalKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 'fake-resend-key-for-tests';
    mockSent.length = 0;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  test('a name containing <script> is escaped in the generated HTML', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { sendGiftNotification } = loadEmailModule();

    await sendGiftNotification({
      to: RECIPIENT,
      name: '<script>alert("x")</script> & \'Bob\'',
      giftEndDate: '2027-01-01T00:00:00Z',
    });

    expect(mockSent).toHaveLength(1);
    const { html } = mockSent[0];

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Bob&#39;');

    logSpy.mockRestore();
  });
});
