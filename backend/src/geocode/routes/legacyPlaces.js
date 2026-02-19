/**
 * legacyPlaces.js — Backward-compatibility shim.
 *
 * Mounts the same /api/places/autocomplete and /api/places/details paths
 * that the old gateway used, so any client (or gateway proxy) pointing
 * at the old URLs still works without changes.
 *
 * Internally delegates to the same geocode router logic.
 */

const express = require('express');
const geocodeRouter = require('./geocode');

const router = express.Router();

// /api/places/autocomplete  →  /api/geocode/autocomplete
router.get('/autocomplete', (req, res, next) => {
  req.url = '/autocomplete';
  geocodeRouter(req, res, next);
});

// /api/places/details  →  /api/geocode/details
router.get('/details', (req, res, next) => {
  req.url = '/details';
  geocodeRouter(req, res, next);
});

module.exports = router;
