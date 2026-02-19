/**
 * contacts.js — Emergency Contact (Buddy System) routes.
 *
 * Both users must have SafeNight. Pairing happens via QR code scan.
 *
 * POST   /api/contacts/invite       — Send contact request (by user_id from QR)
 * POST   /api/contacts/respond       — Accept / reject a request
 * GET    /api/contacts               — List my accepted contacts
 * GET    /api/contacts/pending       — List pending incoming requests
 * DELETE /api/contacts/:id           — Remove a contact
 * POST   /api/contacts/username      — Set or update my unique username
 * GET    /api/contacts/lookup/:username — Look up a user by username
 */

const express = require('express');
const { supabase } = require('../lib/supabase');
const { requireAuth } = require('../middleware/authMiddleware');
const { checkFeatureLimit } = require('../middleware/subscriptionMiddleware');

const router = express.Router();

// All routes require auth
router.use(requireAuth);

// ─── Validation ──────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const MAX_NICKNAME = 50;
const VALID_RESPONSES = ['accepted', 'rejected', 'blocked'];

// ─── POST /api/contacts/username ─────────────────────────────────────────────
// Set or update the user's unique username (shown in QR code).
router.post('/username', async (req, res, next) => {
  try {
    const { username } = req.body;

    if (!username || !USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: 'Username must be 3-20 characters, letters/numbers/underscores only',
      });
    }

    const cleanUsername = username.trim().toLowerCase();

    // Check if username is already taken by another user
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', cleanUsername)
      .neq('id', req.user.id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Username is already taken' });
    }

    const { error } = await supabase
      .from('profiles')
      .update({ username: cleanUsername })
      .eq('id', req.user.id);

    if (error) throw error;

    res.json({ username: cleanUsername });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/contacts/lookup/:username ──────────────────────────────────────
// Look up a user by their username (for manual add / QR scan result).
router.get('/lookup/:username', async (req, res, next) => {
  try {
    const { username } = req.params;

    if (!username || !USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Invalid username' });
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, username')
      .eq('username', username.trim().toLowerCase())
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't let users look up themselves
    if (data.id === req.user.id) {
      return res.status(400).json({ error: 'That is your own account' });
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/contacts/invite ───────────────────────────────────────────────
// Send a contact request to another SafeNight user.
// Gated by emergency_contacts feature limit (free: 2, pro: 5, premium: unlimited).
router.post('/invite', checkFeatureLimit('emergency_contacts'), async (req, res, next) => {
  try {
    const { contact_id, nickname } = req.body;

    if (!contact_id || !UUID_RE.test(contact_id)) {
      return res.status(400).json({ error: 'Valid contact_id (UUID) is required' });
    }

    if (contact_id === req.user.id) {
      return res.status(400).json({ error: 'You cannot add yourself as a contact' });
    }

    // Make sure target user exists
    const { data: targetUser } = await supabase
      .from('profiles')
      .select('id, name')
      .eq('id', contact_id)
      .maybeSingle();

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found — they need SafeNight to be added' });
    }

    // Check if relationship already exists (in either direction)
    const { data: existing } = await supabase
      .from('emergency_contacts')
      .select('id, status')
      .or(`and(user_id.eq.${req.user.id},contact_id.eq.${contact_id}),and(user_id.eq.${contact_id},contact_id.eq.${req.user.id})`)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(409).json({ error: 'Already connected' });
      }
      if (existing.status === 'pending') {
        return res.status(409).json({ error: 'Request already pending' });
      }
      if (existing.status === 'blocked') {
        return res.status(403).json({ error: 'Unable to send request' });
      }
      // If rejected, allow re-invite by updating
      const { data, error } = await supabase
        .from('emergency_contacts')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return res.json(data);
    }

    const cleanNickname = typeof nickname === 'string'
      ? nickname.trim().slice(0, MAX_NICKNAME)
      : '';

    const { data, error } = await supabase
      .from('emergency_contacts')
      .insert({
        user_id: req.user.id,
        contact_id,
        nickname: cleanNickname,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    // Send push notification to the target user
    const { sendPush } = require('../lib/pushNotifications');
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('name, username')
      .eq('id', req.user.id)
      .single();

    if (targetUser) {
      const { data: targetProfile } = await supabase
        .from('profiles')
        .select('push_token')
        .eq('id', contact_id)
        .single();

      if (targetProfile?.push_token) {
        const senderName = senderProfile?.name || senderProfile?.username || 'Someone';
        await sendPush(targetProfile.push_token, {
          title: 'SafeNight Contact Request',
          body: `${senderName} wants to add you as an emergency contact`,
          data: { type: 'contact_request', from: req.user.id },
        });
      }
    }

    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/contacts/respond ──────────────────────────────────────────────
// Accept or reject an incoming contact request.
router.post('/respond', async (req, res, next) => {
  try {
    const { contact_request_id, response } = req.body;
    console.log('[contacts] Respond request:', { contact_request_id, response, user_id: req.user?.id });

    if (!contact_request_id || !UUID_RE.test(contact_request_id)) {
      console.log('[contacts] Invalid contact_request_id:', contact_request_id);
      return res.status(400).json({ error: 'Valid contact_request_id is required' });
    }

    if (!VALID_RESPONSES.includes(response)) {
      console.log('[contacts] Invalid response:', response);
      return res.status(400).json({ error: `Response must be one of: ${VALID_RESPONSES.join(', ')}` });
    }

    // Only the contact (receiver) can respond
    const { data: request } = await supabase
      .from('emergency_contacts')
      .select('*')
      .eq('id', contact_request_id)
      .eq('contact_id', req.user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (!request) {
      console.log('[contacts] Pending request not found:', { contact_request_id, contact_id: req.user.id });
      return res.status(404).json({ error: 'Pending request not found' });
    }

    const { data, error } = await supabase
      .from('emergency_contacts')
      .update({
        status: response,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact_request_id)
      .select()
      .single();

    if (error) throw error;
    console.log('[contacts] Response updated successfully:', { contact_request_id, response });

    // Notify the sender about the response
    if (response === 'accepted') {
      const { sendPush } = require('../lib/pushNotifications');
      const { data: responderProfile } = await supabase
        .from('profiles')
        .select('name, username')
        .eq('id', req.user.id)
        .single();

      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('push_token')
        .eq('id', request.user_id)
        .single();

      if (senderProfile?.push_token) {
        const responderName = responderProfile?.name || responderProfile?.username || 'Someone';
        await sendPush(senderProfile.push_token, {
          title: 'Contact Accepted!',
          body: `${responderName} accepted your emergency contact request`,
          data: { type: 'contact_accepted', from: req.user.id },
        });
      }
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/contacts ───────────────────────────────────────────────────────
// List all accepted emergency contacts for the current user.
router.get('/', async (req, res, next) => {
  try {
    // Get contacts where I'm either the sender or receiver
    const { data, error } = await supabase
      .from('emergency_contacts')
      .select(`
        id,
        user_id,
        contact_id,
        nickname,
        status,
        created_at
      `)
      .eq('status', 'accepted')
      .or(`user_id.eq.${req.user.id},contact_id.eq.${req.user.id}`);

    if (error) throw error;

    // Enrich with profile info for each contact
    const contacts = await Promise.all(
      (data || []).map(async (c) => {
        const otherUserId = c.user_id === req.user.id ? c.contact_id : c.user_id;
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, name, username')
          .eq('id', otherUserId)
          .single();

        // Check if they have an active live session (include path for map visualization)
        const { data: liveSession } = await supabase
          .from('live_sessions')
          .select('id, current_lat, current_lng, destination_name, started_at, last_update_at, path')
          .eq('user_id', otherUserId)
          .eq('status', 'active')
          .maybeSingle();

        // Detect stale sessions (no heartbeat for >60s)
        let isStale = false;
        if (liveSession) {
          const ageMs = Date.now() - new Date(liveSession.last_update_at).getTime();
          isStale = ageMs > 60_000;
        }

        return {
          id: c.id,
          nickname: c.nickname,
          user: profile || { id: otherUserId, name: 'Unknown', username: null },
          is_live: !!liveSession,
          is_stale: isStale,
          live_session: liveSession || null,
        };
      }),
    );

    res.json(contacts);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/contacts/pending ───────────────────────────────────────────────
// List pending incoming contact requests.
router.get('/pending', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('emergency_contacts')
      .select('id, user_id, nickname, created_at')
      .eq('contact_id', req.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Enrich with sender profile
    const pending = await Promise.all(
      (data || []).map(async (c) => {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, name, username')
          .eq('id', c.user_id)
          .single();

        return {
          id: c.id,
          from: profile || { id: c.user_id, name: 'Unknown', username: null },
          created_at: c.created_at,
        };
      }),
    );

    res.json(pending);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/contacts/:id ────────────────────────────────────────────────
// Remove a contact (either party can remove).
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!UUID_RE.test(id)) {
      return res.status(400).json({ error: 'Invalid contact ID' });
    }

    // Verify the user is part of this contact
    const { data: contact } = await supabase
      .from('emergency_contacts')
      .select('id, user_id, contact_id')
      .eq('id', id)
      .or(`user_id.eq.${req.user.id},contact_id.eq.${req.user.id}`)
      .maybeSingle();

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const { error } = await supabase
      .from('emergency_contacts')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Contact removed' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
