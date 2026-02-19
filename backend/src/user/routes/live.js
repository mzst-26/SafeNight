/**
 * live.js — Live location sharing routes.
 *
 * When a user starts walking/navigating, a live session is created.
 * All accepted emergency contacts get a push notification.
 * Location is updated periodically (every 5-10s from the app).
 * Heartbeat keeps session alive even if user is stationary.
 * Contacts can poll to see the live location.
 *
 * POST /api/live/start        — Start a live session (notifies contacts)
 * POST /api/live/update       — Update current location during session
 * POST /api/live/heartbeat    — Keep session alive (no location change needed)
 * POST /api/live/end          — End a live session
 * GET  /api/live/my-session   — Get my active session
 * GET  /api/live/watch/:userId — Watch a contact's live location (polling)
 */

const express = require('express');
const { supabase } = require('../lib/supabase');
const { requireAuth } = require('../middleware/authMiddleware');
const { checkFeatureLimit } = require('../middleware/subscriptionMiddleware');
const { sendPush } = require('../lib/pushNotifications');

const router = express.Router();

// All routes require auth (except the beacon-based /end which uses a query token)
router.use((req, res, next) => {
  // Allow /end with ?token= for sendBeacon (no Authorization header)
  if (req.path === '/end' && req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});
router.use(requireAuth);

// Staleness thresholds (in seconds)
const STALE_THRESHOLD_S = 60;      // Mark as stale after 60s without heartbeat
const EXPIRE_THRESHOLD_S = 5 * 60; // Auto-expire after 5 minutes without heartbeat

// ─── Validation ──────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidCoord(lat, lng) {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}

// ─── POST /api/live/start ────────────────────────────────────────────────────
// Start a live session. Automatically ends any existing active session.
// Notifies all accepted emergency contacts.
// Gated by live_sessions feature limit (free: 1/month, pro+: unlimited).
router.post('/start', checkFeatureLimit('live_sessions'), async (req, res, next) => {
  try {
    const { current_lat, current_lng, destination_lat, destination_lng, destination_name } = req.body;

    if (!isValidCoord(current_lat, current_lng)) {
      return res.status(400).json({ error: 'Valid current_lat and current_lng are required' });
    }

    // End any existing active session
    await supabase
      .from('live_sessions')
      .update({
        status: 'cancelled',
        ended_at: new Date().toISOString(),
      })
      .eq('user_id', req.user.id)
      .eq('status', 'active');

    // Create new session
    const sessionData = {
      user_id: req.user.id,
      status: 'active',
      current_lat,
      current_lng,
      last_update_at: new Date().toISOString(),
    };

    if (isValidCoord(destination_lat, destination_lng)) {
      sessionData.destination_lat = destination_lat;
      sessionData.destination_lng = destination_lng;
    }

    if (destination_name && typeof destination_name === 'string') {
      sessionData.destination_name = destination_name.trim().slice(0, 200);
    }

    const { data: session, error } = await supabase
      .from('live_sessions')
      .insert(sessionData)
      .select()
      .single();

    if (error) throw error;

    // Get user's profile for notification
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('name, username')
      .eq('id', req.user.id)
      .single();

    const userName = userProfile?.name || userProfile?.username || 'Your contact';

    // Get all accepted contacts and notify them
    const { data: contacts } = await supabase
      .from('emergency_contacts')
      .select('user_id, contact_id')
      .eq('status', 'accepted')
      .or(`user_id.eq.${req.user.id},contact_id.eq.${req.user.id}`);

    if (contacts && contacts.length > 0) {
      // Get the other user IDs
      const contactUserIds = contacts.map((c) =>
        c.user_id === req.user.id ? c.contact_id : c.user_id,
      );

      // Fetch their push tokens
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, push_token')
        .in('id', contactUserIds)
        .not('push_token', 'is', null);

      if (profiles && profiles.length > 0) {
        const notificationBody = destination_name
          ? `${userName} started a live session going to ${destination_name}`
          : `${userName} started a live session`;

        // Send notifications in parallel
        await Promise.allSettled(
          profiles.map((p) =>
            sendPush(p.push_token, {
              title: '📍 Live session started',
              body: notificationBody,
              data: {
                type: 'live_session_started',
                user_id: req.user.id,
                session_id: session.id,
              },
            }),
          ),
        );
      }
    }

    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/live/update ───────────────────────────────────────────────────
// Update current location during an active session.
// Called every 5-10 seconds from the app.
router.post('/update', async (req, res, next) => {
  try {
    const { current_lat, current_lng } = req.body;

    if (!isValidCoord(current_lat, current_lng)) {
      return res.status(400).json({ error: 'Valid current_lat and current_lng are required' });
    }

    const { data, error } = await supabase
      .from('live_sessions')
      .update({
        current_lat,
        current_lng,
        last_update_at: new Date().toISOString(),
      })
      .eq('user_id', req.user.id)
      .eq('status', 'active')
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'No active session found' });
    }

    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/live/heartbeat ────────────────────────────────────────────────
// Keep the session alive without changing location. Updates last_update_at.
// The frontend sends this every 15s so the backend knows the app is still open.
// This is critical for the staleness detection — if heartbeats stop arriving
// for STALE_THRESHOLD_S seconds, the session is considered stale.
router.post('/heartbeat', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('live_sessions')
      .update({ last_update_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'No active session found' });
    }

    res.json({ alive: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/live/end ──────────────────────────────────────────────────────
// End the current live session (arrived / manual stop).
router.post('/end', async (req, res, next) => {
  try {
    const { status: endStatus } = req.body;
    const finalStatus = endStatus === 'cancelled' ? 'cancelled' : 'completed';

    const { data, error } = await supabase
      .from('live_sessions')
      .update({
        status: finalStatus,
        ended_at: new Date().toISOString(),
      })
      .eq('user_id', req.user.id)
      .eq('status', 'active')
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'No active session found' });
    }

    // Notify contacts that user has arrived
    if (finalStatus === 'completed') {
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('name, username')
        .eq('id', req.user.id)
        .single();

      const userName = userProfile?.name || userProfile?.username || 'Your contact';

      const { data: contacts } = await supabase
        .from('emergency_contacts')
        .select('user_id, contact_id')
        .eq('status', 'accepted')
        .or(`user_id.eq.${req.user.id},contact_id.eq.${req.user.id}`);

      if (contacts && contacts.length > 0) {
        const contactUserIds = contacts.map((c) =>
          c.user_id === req.user.id ? c.contact_id : c.user_id,
        );

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, push_token')
          .in('id', contactUserIds)
          .not('push_token', 'is', null);

        if (profiles && profiles.length > 0) {
          await Promise.allSettled(
            profiles.map((p) =>
              sendPush(p.push_token, {
                title: '✅ Arrived safely',
                body: `${userName} has arrived at their destination.`,
                data: {
                  type: 'live_session_ended',
                  user_id: req.user.id,
                },
              }),
            ),
          );
        }
      }
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/live/my-session ────────────────────────────────────────────────
// Get the current user's active live session (if any).
router.get('/my-session', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('live_sessions')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/live/watch/:userId ─────────────────────────────────────────────
// Watch a contact's live location. Must be an accepted contact.
// Frontend polls this every 5 seconds.
router.get('/watch/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Verify they are an accepted contact
    const { data: contact } = await supabase
      .from('emergency_contacts')
      .select('id')
      .eq('status', 'accepted')
      .or(
        `and(user_id.eq.${req.user.id},contact_id.eq.${userId}),and(user_id.eq.${userId},contact_id.eq.${req.user.id})`,
      )
      .maybeSingle();

    if (!contact) {
      return res.status(403).json({ error: 'Not an accepted contact' });
    }

    // Get their active session
    const { data: session, error } = await supabase
      .from('live_sessions')
      .select('id, current_lat, current_lng, destination_lat, destination_lng, destination_name, started_at, last_update_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;

    if (!session) {
      return res.json({ active: false });
    }

    // Also get the user's profile (name)
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, username')
      .eq('id', userId)
      .single();

    // Check if the session is stale (no heartbeat for STALE_THRESHOLD_S)
    const lastUpdate = new Date(session.last_update_at);
    const ageSeconds = (Date.now() - lastUpdate.getTime()) / 1000;
    const stale = ageSeconds > STALE_THRESHOLD_S;

    res.json({
      active: true,
      stale,
      staleSince: stale ? session.last_update_at : undefined,
      user: profile || { name: 'Unknown', username: null },
      session,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Stale session cleanup ───────────────────────────────────────────────────
// Exported for server.js to run on a periodic interval.
// Finds active sessions with last_update_at older than EXPIRE_THRESHOLD_S,
// marks them as expired, and notifies contacts.
async function cleanupStaleSessions() {
  try {
    const cutoff = new Date(Date.now() - EXPIRE_THRESHOLD_S * 1000).toISOString();

    // Find sessions that have gone stale beyond the expire threshold
    const { data: staleSessions, error } = await supabase
      .from('live_sessions')
      .select('id, user_id, destination_name')
      .eq('status', 'active')
      .lt('last_update_at', cutoff);

    if (error) {
      console.error('[live] Stale session cleanup error:', error.message);
      return;
    }

    if (!staleSessions || staleSessions.length === 0) return;

    console.log(`[live] Expiring ${staleSessions.length} stale session(s)`);

    for (const session of staleSessions) {
      // Mark session as expired
      await supabase
        .from('live_sessions')
        .update({
          status: 'expired',
          ended_at: new Date().toISOString(),
        })
        .eq('id', session.id);

      // Notify the user's contacts that the session went stale
      try {
        const { data: userProfile } = await supabase
          .from('profiles')
          .select('name, username')
          .eq('id', session.user_id)
          .single();

        const userName = userProfile?.name || userProfile?.username || 'Your contact';

        const { data: contacts } = await supabase
          .from('emergency_contacts')
          .select('user_id, contact_id')
          .eq('status', 'accepted')
          .or(`user_id.eq.${session.user_id},contact_id.eq.${session.user_id}`);

        if (contacts && contacts.length > 0) {
          const contactUserIds = contacts.map((c) =>
            c.user_id === session.user_id ? c.contact_id : c.user_id,
          );

          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, push_token')
            .in('id', contactUserIds)
            .not('push_token', 'is', null);

          if (profiles && profiles.length > 0) {
            await Promise.allSettled(
              profiles.map((p) =>
                sendPush(p.push_token, {
                  title: '⚠️ Live session disconnected',
                  body: `${userName}'s app appears to have closed. Their last known location is still visible.`,
                  data: {
                    type: 'live_session_expired',
                    user_id: session.user_id,
                  },
                }),
              ),
            );
          }
        }
      } catch (notifyErr) {
        console.error('[live] Failed to notify contacts for stale session:', notifyErr.message);
      }
    }
  } catch (err) {
    console.error('[live] Stale session cleanup failed:', err.message);
  }
}

module.exports = router;
module.exports.cleanupStaleSessions = cleanupStaleSessions;
