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
// Start a live session. If there is a recent session (ended/cancelled/expired
// within the last 5 minutes) it will be reactivated instead of creating a new
// one — this avoids burning a usage count when the user quickly restarts
// navigation or the session was briefly interrupted.
// Notifies all accepted emergency contacts.
// Gated by live_sessions feature limit — only for truly NEW sessions (reuse is free).

const SESSION_REUSE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

router.post('/start', async (req, res, next) => {
  try {
    const { current_lat, current_lng, destination_lat, destination_lng, destination_name } = req.body;

    if (!isValidCoord(current_lat, current_lng)) {
      return res.status(400).json({ error: 'Valid current_lat and current_lng are required' });
    }

    const now = new Date();
    let session = null;
    let reused = false;

    // 1. If there is already an active session, just update it and return it
    const { data: activeSession } = await supabase
      .from('live_sessions')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (activeSession) {
      // Update location + destination on the existing active session
      const updateData = {
        current_lat,
        current_lng,
        last_update_at: now.toISOString(),
      };
      if (isValidCoord(destination_lat, destination_lng)) {
        updateData.destination_lat = destination_lat;
        updateData.destination_lng = destination_lng;
      }
      if (destination_name && typeof destination_name === 'string') {
        updateData.destination_name = destination_name.trim().slice(0, 200);
      }
      const { data: updated, error: upErr } = await supabase
        .from('live_sessions')
        .update(updateData)
        .eq('id', activeSession.id)
        .select()
        .single();
      if (upErr) throw upErr;
      session = updated;
      reused = true;
    }

    // 2. Try to reactivate a recently ended session (within 5 min window)
    if (!session) {
      const cutoff = new Date(now.getTime() - SESSION_REUSE_WINDOW_MS).toISOString();

      const { data: recentSession } = await supabase
        .from('live_sessions')
        .select('*')
        .eq('user_id', req.user.id)
        .in('status', ['cancelled', 'completed', 'expired'])
        .gte('ended_at', cutoff)
        .order('ended_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentSession) {
        // Reactivate: set back to active, update coords & heartbeat
        const reactivateData = {
          status: 'active',
          current_lat,
          current_lng,
          last_update_at: now.toISOString(),
          ended_at: null,
        };
        if (isValidCoord(destination_lat, destination_lng)) {
          reactivateData.destination_lat = destination_lat;
          reactivateData.destination_lng = destination_lng;
        }
        if (destination_name && typeof destination_name === 'string') {
          reactivateData.destination_name = destination_name.trim().slice(0, 200);
        }
        const { data: reactivated, error: rErr } = await supabase
          .from('live_sessions')
          .update(reactivateData)
          .eq('id', recentSession.id)
          .select()
          .single();
        if (rErr) throw rErr;
        session = reactivated;
        reused = true;
      }
    }

    // 3. No reusable session — enforce subscription limit, then create new
    if (!session) {
      // Run the feature limit check only for genuinely new sessions
      const limitBlocked = await new Promise((resolve) => {
        checkFeatureLimit('live_sessions')(req, res, (err) => {
          if (err) return resolve(true);
          resolve(false);
        });
      });
      // If checkFeatureLimit already sent a 403 response, stop here
      if (limitBlocked || res.headersSent) return;

      const sessionData = {
        user_id: req.user.id,
        status: 'active',
        current_lat,
        current_lng,
        last_update_at: now.toISOString(),
      };

      if (isValidCoord(destination_lat, destination_lng)) {
        sessionData.destination_lat = destination_lat;
        sessionData.destination_lng = destination_lng;
      }

      if (destination_name && typeof destination_name === 'string') {
        sessionData.destination_name = destination_name.trim().slice(0, 200);
      }

      const { data: newSession, error: insertErr } = await supabase
        .from('live_sessions')
        .insert(sessionData)
        .select()
        .single();

      if (insertErr) throw insertErr;
      session = newSession;
    }

    if (!session) throw new Error('Failed to create or reactivate session');

    // Only notify contacts for brand-new sessions (not reuse/reactivation)
    if (!reused) {
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
    } // end if (!reused)

    res.status(reused ? 200 : 201).json(session);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/live/update ───────────────────────────────────────────────────
// Update current location during an active session.
// Called every 5-10 seconds from the app.
// Also appends the coordinate to the session's path history.
router.post('/update', async (req, res, next) => {
  try {
    const { current_lat, current_lng } = req.body;

    if (!isValidCoord(current_lat, current_lng)) {
      return res.status(400).json({ error: 'Valid current_lat and current_lng are required' });
    }

    // Use RPC to atomically append coordinate to path and update location
    const { error: rpcError } = await supabase.rpc('append_path_point', {
      p_user_id: req.user.id,
      p_lat: current_lat,
      p_lng: current_lng,
    });

    if (rpcError) {
      // Fallback to simple update if RPC not available (migration not run yet)
      console.warn('[live] append_path_point RPC failed, falling back:', rpcError.message);
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
      if (!data) return res.status(404).json({ error: 'No active session found' });
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

    // Get their active session (include path for contact visualization)
    const { data: session, error } = await supabase
      .from('live_sessions')
      .select('id, current_lat, current_lng, destination_lat, destination_lng, destination_name, started_at, last_update_at, path')
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

// ─── 30-day old session cleanup ──────────────────────────────────────────────
// Deletes completed/cancelled/expired sessions older than 30 days.
// Run periodically (every hour is sufficient).
async function cleanupOldSessions() {
  try {
    const { error } = await supabase.rpc('cleanup_old_sessions');
    if (error) {
      // Fallback: manual delete if RPC not available
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error: delError } = await supabase
        .from('live_sessions')
        .delete()
        .not('status', 'eq', 'active')
        .not('ended_at', 'is', null)
        .lt('ended_at', cutoff);
      if (delError) {
        console.error('[live] Old session cleanup fallback error:', delError.message);
      }
    }
  } catch (err) {
    console.error('[live] Old session cleanup failed:', err.message);
  }
}

module.exports = router;
module.exports.cleanupStaleSessions = cleanupStaleSessions;
module.exports.cleanupOldSessions = cleanupOldSessions;
