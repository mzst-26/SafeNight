const opening_hours = require("opening_hours");
const { londonHourOf } = require("../services/graph/clock");

const LONDON_HM_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const ALWAYS_OPEN = new Set([
  "hospital",
  "clinic",
  "pharmacy",
  "fuel",
  "atm",
  "police",
  "fire_station",
  "hotel",
  "hostel",
  "charging_station",
  "parking",
  "toilets",
]);

const EVENING_TYPES = new Set([
  "pub",
  "bar",
  "nightclub",
  "biergarten",
  "casino",
  "restaurant",
  "fast_food",
  "food_court",
  "ice_cream",
  "cafe",
]);

const EXTENDED_SHOP_TYPES = new Set([
  "convenience",
  "supermarket",
  "kiosk",
  "mall",
]);

function stripPH(str) {
  if (!str) return str;

  return (
    str
      .split(";")
      .map((s) => s.trim())
      .filter((s) => !/^\s*PH\b/.test(s))
      .map((s) => s.replace(/,\s*PH\b/g, ""))
      .filter(Boolean)
      .join("; ") || null
  );
}

/**
 * Open state at `at` (default: now); next-change times are London wall-clock, never the server's zone.
 */
function checkOpenNow(hoursString, at = new Date()) {
  if (!hoursString) return { open: null, nextChange: null };

  try {
    const cleaned = stripPH(hoursString);
    if (!cleaned) return { open: null, nextChange: null };

    const oh = new opening_hours(cleaned, { address: { country_code: "gb" } });
    const now = at instanceof Date ? at : new Date(at);
    const isOpen = oh.getState(now);
    let nextChange = null;

    try {
      const next = oh.getNextChange(now);
      if (next) {
        const hm = LONDON_HM_FORMAT.format(next);
        nextChange = isOpen ? `closes at ${hm}` : `opens at ${hm}`;
      }
    } catch {
      // Some opening-hours strings don't support getNextChange.
    }

    return { open: isOpen, nextChange };
  } catch {
    return { open: null, nextChange: null };
  }
}

/** Time-of-day heuristic at a London hour (0-23); defaults to the current London hour. */
function heuristicOpen(amenityType, hour = londonHourOf(new Date())) {
  const type = (amenityType || "").toLowerCase();

  if (ALWAYS_OPEN.has(type)) return { open: true, nextChange: "open 24/7" };

  if (EVENING_TYPES.has(type)) {
    if (hour >= 10 && hour < 24) {
      return { open: true, nextChange: "closes at 23:00" };
    }
    return { open: false, nextChange: "opens at 10:00" };
  }

  if (EXTENDED_SHOP_TYPES.has(type)) {
    if (hour >= 6 && hour < 23) {
      return { open: true, nextChange: "closes at 23:00" };
    }
    return { open: false, nextChange: "opens at 06:00" };
  }

  if (hour >= 7 && hour < 20) return { open: true, nextChange: "closes at 20:00" };
  return { open: false, nextChange: "opens at 07:00" };
}

function safetyLabel(score) {
  if (score >= 75) return { label: "Very Safe", color: "#2E7D32" };
  if (score >= 55) return { label: "Safe", color: "#558B2F" };
  if (score >= 35) return { label: "Moderate", color: "#F9A825" };
  return { label: "Use Caution", color: "#C62828" };
}

function segmentColor(safetyScore) {
  if (safetyScore >= 0.7) return "#4CAF50";
  if (safetyScore >= 0.5) return "#8BC34A";
  if (safetyScore >= 0.35) return "#FFC107";
  if (safetyScore >= 0.2) return "#FF9800";
  return "#F44336";
}

module.exports = {
  stripPH,
  checkOpenNow,
  heuristicOpen,
  safetyLabel,
  segmentColor,
};
