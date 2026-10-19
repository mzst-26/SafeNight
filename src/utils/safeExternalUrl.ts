/**
 * Validates URLs returned by the backend before handing them to the OS
 * (Linking.openURL / window.open). Only https Stripe-hosted pages are allowed
 * so a compromised or spoofed response cannot open arbitrary schemes or hosts.
 */
const TRUSTED_PAYMENT_HOSTS = ['stripe.com'];

export const isTrustedPaymentUrl = (value: unknown): boolean => {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return TRUSTED_PAYMENT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
};
