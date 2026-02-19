/**
 * pushNotifications.js — Expo Push Notification helper.
 *
 * Uses Expo's free push notification service.
 * No third-party service (Firebase, OneSignal) needed.
 *
 * Expo push tokens look like: ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
 * We send via POST to https://exp.host/--/api/v2/push/send
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_RE = /^ExponentPushToken\[.+\]$/;

/**
 * Send a push notification to a single Expo push token.
 *
 * @param {string} pushToken - Expo push token
 * @param {Object} notification - { title, body, data }
 * @returns {Promise<boolean>} - true if sent successfully
 */
async function sendPush(pushToken, notification) {
  if (!pushToken || !EXPO_TOKEN_RE.test(pushToken)) {
    console.warn('[push] Invalid push token:', pushToken?.slice(0, 30));
    return false;
  }

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        sound: 'default',
        title: notification.title || 'SafeNight',
        body: notification.body || '',
        data: notification.data || {},
        priority: 'high',
        channelId: 'default',
        // Ensure delivery even when app is closed / device is in Doze mode
        ttl: 86400,
        _contentAvailable: true,
      }),
    });

    if (!res.ok) {
      console.error('[push] Expo push failed:', res.status);
      return false;
    }

    const result = await res.json();

    // Check for ticket errors
    if (result.data?.[0]?.status === 'error') {
      console.error('[push] Push error:', result.data[0].message);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[push] Send failed:', err.message);
    return false;
  }
}

/**
 * Send push notifications to multiple tokens at once.
 * Expo supports batching up to 100 notifications per request.
 *
 * @param {Array<{pushToken: string, notification: Object}>} messages
 * @returns {Promise<number>} - count of successful sends
 */
async function sendPushBatch(messages) {
  const validMessages = messages.filter((m) => EXPO_TOKEN_RE.test(m.pushToken));

  if (validMessages.length === 0) return 0;

  const batch = validMessages.map((m) => ({
    to: m.pushToken,
    sound: 'default',
    title: m.notification.title || 'SafeNight',
    body: m.notification.body || '',
    data: m.notification.data || {},
    priority: 'high',
    channelId: 'default',
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      console.error('[push] Batch push failed:', res.status);
      return 0;
    }

    const result = await res.json();
    const successCount = (result.data || []).filter((t) => t.status === 'ok').length;

    return successCount;
  } catch (err) {
    console.error('[push] Batch send failed:', err.message);
    return 0;
  }
}

module.exports = { sendPush, sendPushBatch };
