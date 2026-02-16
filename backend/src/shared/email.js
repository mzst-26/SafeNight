/**
 * email.js — Email utility using Resend.
 *
 * Provides a simple interface for sending transactional emails.
 * Used for gift subscription notifications, etc.
 *
 * Requires RESEND_API_KEY in .env
 * Get a free API key at https://resend.com
 */

const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.FROM_EMAIL || 'SafeNight <onboarding@resend.dev>';

/**
 * Send an email via Resend.
 * Falls back to console logging if RESEND_API_KEY is not configured.
 */
async function sendEmail({ to, subject, html, text }) {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — logging email instead:');
    console.log(`[email] To: ${to}`);
    console.log(`[email] Subject: ${subject}`);
    console.log(`[email] Body: ${text || html}`);
    return { success: true, fallback: true };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(text ? { text } : {}),
    });

    if (error) {
      console.error('[email] Send failed:', error);
      return { success: false, error };
    }

    console.log(`[email] Sent to ${to} — ID: ${data?.id}`);
    return { success: true, id: data?.id };
  } catch (err) {
    console.error('[email] Send error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a gift subscription notification email.
 * Uses table-based layout for maximum client compatibility and deliverability.
 */
async function sendGiftNotification({ to, name, giftEndDate }) {
  const formattedDate = new Date(giftEndDate).toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const subject = 'You\'ve been gifted a SafeNight Guarded subscription!';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1F5F9;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#FFFFFF;border-radius:16px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background-color:#6366F1;padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:700;letter-spacing:0.5px;">SafeNight</h1>
          <p style="margin:8px 0 0;color:#C7D2FE;font-size:14px;">Walk safe. Stay connected.</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#1E293B;">Hi${name ? ` ${name}` : ' there'},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Great news! You have been gifted our <strong style="color:#6366F1;">Guarded</strong> subscription
            for being one of the first users of SafeNight.
          </p>
          <!-- Gift details box -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:20px;background-color:#F8FAFC;border:2px dashed #E2E8F0;border-radius:12px;">
              <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;">Your gift</p>
              <p style="margin:0;font-size:22px;font-weight:800;color:#6366F1;">Guarded (Pro)</p>
              <p style="margin:8px 0 0;font-size:14px;color:#475569;">Valid until <strong>${formattedDate}</strong></p>
            </td></tr>
          </table>
          <!-- Benefits -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
            <tr><td style="padding:20px;background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;">
              <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#6366F1;text-transform:uppercase;letter-spacing:1px;">What you get</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#475569;line-height:2;">
                <tr><td>Unlimited route searches</td></tr>
                <tr><td>Up to 10 km walking routes</td></tr>
                <tr><td>Unlimited navigation sessions</td></tr>
                <tr><td>Up to 10 emergency contacts</td></tr>
                <tr><td>Up to 5 live tracking sessions</td></tr>
                <tr><td>AI safety explanations</td></tr>
                <tr><td>Full usage statistics</td></tr>
              </table>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:13px;color:#94A3B8;line-height:1.5;">Thank you for being an early supporter of SafeNight. Stay safe!</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 40px;background-color:#F8FAFC;border-top:1px solid #E2E8F0;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94A3B8;line-height:1.5;">&copy; 2026 SafeNight. All rights reserved.<br>This is an automated message &mdash; please do not reply.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi${name ? ` ${name}` : ' there'},\n\nGreat news! You have been gifted our Guarded subscription for being one of the first users of SafeNight.\n\nPlan: Guarded (Pro)\nGift ends: ${formattedDate}\n\nWhat you get:\n- Unlimited route searches\n- Up to 10 km walking routes\n- Unlimited navigation sessions\n- Up to 10 emergency contacts\n- Up to 5 live tracking sessions\n- AI safety explanations\n- Full usage statistics\n\nThank you for being an early supporter. Stay safe!\n\n© 2026 SafeNight. All rights reserved.`;

  return sendEmail({ to, subject, html, text });
}

module.exports = { sendEmail, sendGiftNotification };
