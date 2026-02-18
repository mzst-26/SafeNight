/**
 * integrityVerify.js — Play Integrity token verification route.
 *
 * POST /api/integrity/verify
 * Body: { token: string }
 *
 * Sends the token to Google's Play Integrity API for decoding and returns
 * the verdict so the client (or other services) can act on it.
 *
 * Required env var:
 *   GOOGLE_APPLICATION_CREDENTIALS_JSON — service account JSON (stringified)
 *   OR
 *   PLAY_INTEGRITY_DECRYPTION_KEY / PLAY_INTEGRITY_VERIFICATION_KEY
 *   (for local/classic decryption — not used here; we use the server-side API)
 *
 * Google Cloud setup:
 *   1. Enable "Google Play Integrity API" in your Cloud project.
 *   2. Create a service account, grant it no roles (the API only needs the project).
 *   3. Download the JSON key, set as GOOGLE_APPLICATION_CREDENTIALS_JSON env var.
 */

const express = require('express');
const router = express.Router();
const { GoogleAuth } = require('google-auth-library');

const PACKAGE_NAME = 'com.safenight.app';

/**
 * Lazily create an authenticated Google HTTP client.
 * Cached after first call so we don't re-authenticate every request.
 */
let _authClient = null;
async function getAuthClient() {
  if (_authClient) return _authClient;

  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credentialsJson) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON env var is not set');
  }

  const credentials = JSON.parse(credentialsJson);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/playintegrity'],
  });
  _authClient = await auth.getClient();
  return _authClient;
}

/**
 * POST /api/integrity/verify
 *
 * Verifies a Play Integrity token. Returns verdicts:
 *   - appRecognitionVerdict: PLAY_RECOGNIZED | UNRECOGNIZED_VERSION | UNEVALUATED
 *   - deviceIntegrity: MEETS_DEVICE_INTEGRITY | MEETS_STRONG_INTEGRITY | etc.
 *   - accountDetails: LICENSED | UNLICENSED | UNEVALUATED
 */
router.post('/verify', async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid integrity token' });
  }

  try {
    const client = await getAuthClient();
    const url = `https://playintegrity.googleapis.com/v1/${PACKAGE_NAME}:decodeIntegrityToken`;

    const response = await client.request({
      url,
      method: 'POST',
      data: { integrity_token: token },
    });

    const payload = response.data?.tokenPayloadExternal;
    if (!payload) {
      return res.status(502).json({ error: 'Unexpected response from Play Integrity API' });
    }

    // Basic pass/fail for the "basics" tier
    const appVerdict = payload.appIntegrity?.appRecognitionVerdict;
    const deviceVerdicts = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
    const passed =
      appVerdict === 'PLAY_RECOGNIZED' && deviceVerdicts.includes('MEETS_DEVICE_INTEGRITY');

    return res.json({
      passed,
      appRecognitionVerdict: appVerdict,
      deviceRecognitionVerdict: deviceVerdicts,
      accountDetails: payload.accountDetails,
    });
  } catch (err) {
    console.error('[integrity] Verification error:', err.message);
    return res.status(500).json({ error: 'Integrity verification failed' });
  }
});

module.exports = router;
