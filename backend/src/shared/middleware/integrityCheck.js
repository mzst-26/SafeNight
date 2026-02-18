/**
 * integrityCheck.js — Express middleware for Play Integrity token gating.
 *
 * Reads the X-Integrity-Token header sent by trusted Android clients,
 * verifies it against Google's Play Integrity API, and blocks requests
 * that fail the integrity check.
 *
 * Usage — protect a specific route:
 *   const { requireIntegrity } = require('../shared/middleware/integrityCheck');
 *   router.post('/sensitive-action', requireIntegrity, handler);
 *
 * Usage — soft mode (log only, don't block):
 *   router.post('/route', requireIntegrity({ enforce: false }), handler);
 *
 * Non-Android clients (iOS, web) omit the header and are always passed through
 * since they are subject to their own platform security (App Store, browser).
 */

const { GoogleAuth } = require('google-auth-library');

const PACKAGE_NAME = 'com.safenight.app';

let _authClient = null;
async function getAuthClient() {
  if (_authClient) return _authClient;
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credentialsJson) return null; // gracefully disabled if not configured
  const credentials = JSON.parse(credentialsJson);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/playintegrity'],
  });
  _authClient = await auth.getClient();
  return _authClient;
}

async function verifyToken(token) {
  const client = await getAuthClient();
  if (!client) return null; // API not configured — skip verification

  const url = `https://playintegrity.googleapis.com/v1/${PACKAGE_NAME}:decodeIntegrityToken`;
  const response = await client.request({
    url,
    method: 'POST',
    data: { integrity_token: token },
  });

  const payload = response.data?.tokenPayloadExternal;
  if (!payload) return null;

  const appVerdict = payload.appIntegrity?.appRecognitionVerdict;
  const deviceVerdicts = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];

  return {
    passed:
      appVerdict === 'PLAY_RECOGNIZED' && deviceVerdicts.includes('MEETS_DEVICE_INTEGRITY'),
    appVerdict,
    deviceVerdicts,
  };
}

/**
 * requireIntegrity(options?)
 *
 * options.enforce (default true) — set false to log-only without blocking.
 *
 * Can be used as plain middleware (requireIntegrity) or as a factory
 * (requireIntegrity({ enforce: false })).
 */
function requireIntegrity(optionsOrReq, res, next) {
  // Called as factory: requireIntegrity({ enforce: false })
  if (typeof optionsOrReq !== 'object' || !optionsOrReq.headers) {
    const { enforce = true } = optionsOrReq ?? {};
    return async (req, _res, _next) => {
      await checkIntegrity(req, _res, _next, enforce);
    };
  }

  // Called directly as middleware: router.get('/x', requireIntegrity, handler)
  return checkIntegrity(optionsOrReq, res, next, true);
}

async function checkIntegrity(req, res, next, enforce) {
  const token = req.headers['x-integrity-token'];

  // No token → assume non-Android client (web, iOS) — always pass through
  if (!token) return next();

  try {
    const result = await verifyToken(token);

    if (result === null) {
      // API not configured — pass through with a warning
      console.warn('[integrity] Verification skipped — GOOGLE_APPLICATION_CREDENTIALS_JSON not set');
      return next();
    }

    if (!result.passed) {
      console.warn(`[integrity] Failed — app: ${result.appVerdict}, device: ${result.deviceVerdicts}`);
      if (enforce) {
        return res.status(403).json({ error: 'Device integrity check failed' });
      }
    }

    // Attach result to req for downstream handlers
    req.integrityVerdict = result;
    return next();
  } catch (err) {
    console.error('[integrity] Verification error:', err.message);
    // On error: fail open (don't block users due to our infra issues)
    return next();
  }
}

module.exports = { requireIntegrity };
