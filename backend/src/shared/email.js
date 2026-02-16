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
 */
async function sendGiftNotification({ to, name, giftEndDate }) {
  const formattedDate = new Date(giftEndDate).toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const subject = '🎁 You\'ve been gifted a SafeNight Guarded subscription!';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #7C3AED; font-size: 28px; margin: 0;">🛡️ SafeNight</h1>
      </div>
      
      <h2 style="color: #1F2937; font-size: 22px;">Hi${name ? ` ${name}` : ''},</h2>
      
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Great news! You have been gifted our <strong style="color: #7C3AED;">Guarded</strong> subscription 
        for being one of the first users of SafeNight. 🎉
      </p>
      
      <div style="background: linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%); border-radius: 12px; padding: 24px; margin: 24px 0; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 18px;">🎁 Your Gift Details</h3>
        <p style="margin: 0; font-size: 16px; opacity: 0.95;">
          <strong>Plan:</strong> Guarded (Pro)<br/>
          <strong>Gift ends:</strong> ${formattedDate}
        </p>
      </div>
      
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        With the Guarded plan, you get access to:
      </p>
      
      <ul style="color: #374151; font-size: 15px; line-height: 1.8;">
        <li>🔍 Unlimited route searches</li>
        <li>📏 Up to 10km walking routes</li>
        <li>🚶 Unlimited navigation sessions</li>
        <li>👥 Up to 10 emergency contacts</li>
        <li>📡 Up to 5 live tracking sessions</li>
        <li>🤖 AI safety explanations</li>
        <li>📊 Full usage statistics</li>
      </ul>
      
      <p style="color: #6B7280; font-size: 14px; margin-top: 32px; border-top: 1px solid #E5E7EB; padding-top: 16px;">
        Thank you for being an early supporter of SafeNight. Stay safe! 💜
      </p>
    </div>
  `;

  const text = `Hi${name ? ` ${name}` : ''},\n\nGreat news! You have been gifted our Guarded subscription for being one of the first users of SafeNight.\n\nPlan: Guarded (Pro)\nGift ends: ${formattedDate}\n\nThank you for being an early supporter. Stay safe!`;

  return sendEmail({ to, subject, html, text });
}

/**
 * Send a Family Pack invitation email.
 * Used when a pack owner adds a member or creates a new pack.
 */
async function sendFamilyInvite({ to, ownerName, memberName }) {
  const subject = `🛡️ ${ownerName || 'Someone'} invited you to their SafeNight Family Pack`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #7C3AED; font-size: 28px; margin: 0;">🛡️ SafeNight</h1>
      </div>

      <h2 style="color: #1F2937; font-size: 22px;">Hi${memberName ? ` ${memberName}` : ''},</h2>

      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        <strong style="color: #7C3AED;">${ownerName || 'Someone'}</strong> has added you to their
        SafeNight Family Pack. You now have access to our
        <strong style="color: #7C3AED;">Guarded (Pro)</strong> plan at no extra cost! 🎉
      </p>

      <div style="background: linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%); border-radius: 12px; padding: 24px; margin: 24px 0; color: white;">
        <h3 style="margin: 0 0 12px 0; font-size: 18px;">👨‍👩‍👧‍👦 Your Family Pack Benefits</h3>
        <ul style="margin: 0; padding-left: 20px; font-size: 15px; line-height: 1.8; opacity: 0.95;">
          <li>🔍 Unlimited route searches</li>
          <li>📏 Up to 10km walking routes</li>
          <li>🚶 Unlimited navigation sessions</li>
          <li>👥 5 emergency contacts</li>
          <li>🤖 AI-powered safety explanations</li>
          <li>📡 Unlimited live location sharing</li>
        </ul>
      </div>

      <div style="text-align: center; margin: 28px 0;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Just <strong>log in with this email address</strong> (${to}) to activate your benefits.
        </p>
      </div>

      <p style="color: #6B7280; font-size: 14px; margin-top: 32px; border-top: 1px solid #E5E7EB; padding-top: 16px;">
        SafeNight — Walk Safe, Stay Connected 💜
      </p>
    </div>
  `;

  const text = `Hi${memberName ? ` ${memberName}` : ''},\n\n${ownerName || 'Someone'} has added you to their SafeNight Family Pack. You now have access to our Guarded (Pro) plan!\n\nBenefits include:\n- Unlimited route searches\n- Up to 10km walking routes\n- Unlimited navigation sessions\n- 5 emergency contacts\n- AI-powered safety explanations\n- Unlimited live location sharing\n\nJust log in with this email address (${to}) to activate your benefits.\n\nSafeNight — Walk Safe, Stay Connected`;

  return sendEmail({ to, subject, html, text });
}

module.exports = { sendEmail, sendGiftNotification, sendFamilyInvite };
