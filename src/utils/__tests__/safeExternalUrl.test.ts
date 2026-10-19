import { isTrustedPaymentUrl } from '@/src/utils/safeExternalUrl';

describe('isTrustedPaymentUrl', () => {
  it('accepts https Stripe hosts', () => {
    expect(isTrustedPaymentUrl('https://checkout.stripe.com/c/pay/cs_test_1')).toBe(true);
    expect(isTrustedPaymentUrl('https://billing.stripe.com/p/session/x')).toBe(true);
  });
  it('rejects other schemes, hosts, and lookalikes', () => {
    expect(isTrustedPaymentUrl('http://checkout.stripe.com/x')).toBe(false);
    expect(isTrustedPaymentUrl('javascript:alert(1)')).toBe(false);
    expect(isTrustedPaymentUrl('intent://evil#Intent;end')).toBe(false);
    expect(isTrustedPaymentUrl('https://evil.com/?https://checkout.stripe.com')).toBe(false);
    expect(isTrustedPaymentUrl('https://checkout.stripe.com.evil.com/')).toBe(false);
    expect(isTrustedPaymentUrl('https://user@evil.com@checkout.stripe.com/')).toBe(false);
    expect(isTrustedPaymentUrl('')).toBe(false);
    expect(isTrustedPaymentUrl(undefined)).toBe(false);
  });
});
