/**
 * authMiddleware.js — JWT verification for protected routes.
 *
 * Extracts Bearer token from Authorization header,
 * verifies it with Supabase, and attaches user to req.
 */

const { supabaseAuth } = require('../lib/supabase');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = data.user;
    next();
  } catch (err) {
    console.error('[auth] Token verification error:', err.message);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

module.exports = { requireAuth };
