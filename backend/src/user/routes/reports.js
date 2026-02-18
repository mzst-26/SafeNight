/**
 * reports.js — Safety report routes.
 *
 * POST /api/reports           — Submit a safety report with pinned location
 * GET  /api/reports           — Get all reports (public, for map overlay)
 * GET  /api/reports/nearby    — Get reports within radius of a point
 * GET  /api/reports/mine      — Get current user's reports
 * DELETE /api/reports/:id     — Delete own report
 *
 * Categories: poor_lighting, unsafe_area, obstruction, harassment, suspicious_activity,
 *             cctv, street_light, bus_stop, safe_space, dead_end, other
 */

const express = require('express');
const { supabase } = require('../lib/supabase');
const { requireAuth } = require('../middleware/authMiddleware');
const { checkFeatureLimit } = require('../middleware/subscriptionMiddleware');

const router = express.Router();

const VALID_CATEGORIES = [
  'poor_lighting',
  'unsafe_area',
  'obstruction',
  'harassment',
  'suspicious_activity',
  'cctv',
  'street_light',
  'bus_stop',
  'safe_space',
  'dead_end',
  'other',
];

const MAX_DESC = 500;

// ─── POST /api/reports ──────────────────────────────────────────────────────
// Submit a new safety report. Requires auth.
// Gated by safety_reports feature limit (free: 3/month, pro+: unlimited).
router.post('/', requireAuth, checkFeatureLimit('safety_reports'), async (req, res, next) => {
  try {
    const { lat, lng, category, description } = req.body;

    // Validate coordinates
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    if (isNaN(latN) || isNaN(lngN) || latN < -90 || latN > 90 || lngN < -180 || lngN > 180) {
      return res.status(400).json({ error: 'Valid lat/lng coordinates are required' });
    }

    // Validate category
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
      });
    }

    // Sanitise description
    const desc =
      typeof description === 'string'
        ? description.trim().slice(0, MAX_DESC)
        : '';

    const { data, error } = await supabase
      .from('safety_reports')
      .insert({
        user_id: req.user.id,
        lat: latN,
        lng: lngN,
        category,
        description: desc,
      })
      .select('id, lat, lng, category, description, created_at')
      .single();

    if (error) {
      console.error('[reports] Insert error:', error.message);
      return res.status(500).json({ error: 'Failed to submit report' });
    }

    // Log a usage event for the report submission
    await supabase
      .from('usage_events')
      .insert({
        user_id: req.user.id,
        event_type: 'safety_report',
        value_text: category,
      })
      .then(({ error: evtErr }) => {
        if (evtErr) console.error('[reports] Usage event insert error:', evtErr.message);
      });

    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reports ───────────────────────────────────────────────────────
// Get all unresolved reports (public — no auth required for reading).
// Used to overlay hazard pins on the map for all users.
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('safety_reports')
      .select('id, lat, lng, category, description, created_at')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[reports] Fetch error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch reports' });
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reports/nearby ────────────────────────────────────────────────
// Get reports within ~1km of a point. Public endpoint.
// Query params: lat, lng, radius_km (optional, default 1)
router.get('/nearby', async (req, res, next) => {
  try {
    const latN = parseFloat(req.query.lat);
    const lngN = parseFloat(req.query.lng);
    const radiusKm = parseFloat(req.query.radius_km) || 1;

    if (isNaN(latN) || isNaN(lngN)) {
      return res.status(400).json({ error: 'lat and lng query params are required' });
    }

    // Rough bounding box (1 degree ≈ 111km)
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.cos((latN * Math.PI) / 180));

    const { data, error } = await supabase
      .from('safety_reports')
      .select('id, lat, lng, category, description, created_at')
      .is('resolved_at', null)
      .gte('lat', latN - dLat)
      .lte('lat', latN + dLat)
      .gte('lng', lngN - dLng)
      .lte('lng', lngN + dLng)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[reports] Nearby error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch nearby reports' });
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reports/mine ──────────────────────────────────────────────────
// Get current user's reports. Requires auth.
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('safety_reports')
      .select('id, lat, lng, category, description, created_at, resolved_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[reports] Mine error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch your reports' });
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/reports/:id ────────────────────────────────────────────────
// Delete own report. Requires auth.
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Only allow deleting own reports
    const { data: existing } = await supabase
      .from('safety_reports')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Report not found' });
    }
    if (existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own reports' });
    }

    const { error } = await supabase
      .from('safety_reports')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[reports] Delete error:', error.message);
      return res.status(500).json({ error: 'Failed to delete report' });
    }

    res.json({ message: 'Report deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
