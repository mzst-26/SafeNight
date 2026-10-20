/**
 * Shared inline-script core: escaping, colour whitelists, a tiny DOM helper and
 * the route-layer constants as `var`s.
 *
 * The exports are STRINGS of plain JavaScript (no TypeScript syntax) that both
 * map templates (Leaflet in RouteMap.web.tsx, MapLibre in RouteMap.native.tsx)
 * interpolate into their <script>. Everything here must work in a bare browser
 * page, so it uses `var` and function declarations only.
 *
 * Values come from mapConstants.ts, never from literals here.
 */
import {
  RL_FALLBACK_BLUE,
  RL_GREY,
  RL_LIGHT_ZOOM,
  RL_POINT_COLORS,
  SAFETY_MARKER_COLORS,
  SAFETY_MARKER_FALLBACK_COLOR,
} from "@/src/components/maps/mapConstants";

export const CORE_JS = `
    /* ── Shared core (inline/core.ts): constants, escaping, colour whitelists ── */
    var RL_GREY = ${JSON.stringify(RL_GREY)};
    var RL_FALLBACK_BLUE = ${JSON.stringify(RL_FALLBACK_BLUE)};
    var RL_LIGHT_ZOOM = ${RL_LIGHT_ZOOM};
    var RL_POINT_COLORS = ${JSON.stringify(RL_POINT_COLORS)};
    var SAFETY_MARKER_COLORS = ${JSON.stringify(SAFETY_MARKER_COLORS)};
    var SAFETY_MARKER_FALLBACK_COLOR = ${JSON.stringify(SAFETY_MARKER_FALLBACK_COLOR)};

    /* Escapes text for the few places that still build markup strings. */
    function safeLabel(text){
      return String(text||'')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
    }

    function rlIsNum(v){ return typeof v==='number' && isFinite(v); }

    /* Six-digit hex only: anything else (including markup) falls back. */
    function rlColor(c, fallback){
      return (typeof c==='string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : fallback;
    }

    /* Three- or six-digit hex for user-facing pin colours. */
    function normalizePinColor(color){
      var value = String(color || '').trim();
      if(/^#[0-9a-fA-F]{6}$/.test(value) || /^#[0-9a-fA-F]{3}$/.test(value)){
        return value;
      }
      return '#ef4444';
    }

    /* Element with a class and optional TEXT (never parsed as markup). */
    function rlEl(tag, className, text){
      var el = document.createElement(tag);
      if(className) el.className = className;
      if(text !== undefined && text !== null) el.textContent = String(text);
      return el;
    }
`;
