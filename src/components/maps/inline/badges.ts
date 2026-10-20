/**
 * Shared overlay badges: crime count badge, worst-stretch callout and route
 * score pill. One builder and one stylesheet for both renderers.
 *
 * Builders return DOM elements and set text with textContent, so no untrusted
 * string is ever parsed as markup. Renderer-specific POSITIONING (Leaflet's
 * zero-size divIcon vs MapLibre marker anchors) is not here; see the templates.
 *
 * Requires CORE_JS and FORMAT_JS in the same script.
 */
import {
  RL_CRIME_SIZE,
  RL_CRIME_SIZE_LARGE,
  RL_GREY,
  RL_PILL_HEIGHT,
  RL_PILL_MIN_WIDTH,
  RL_TOUCH_TARGET_PX,
} from "@/src/components/maps/mapConstants";

const FONT = "system-ui,-apple-system,sans-serif";

export const BADGES_JS = `
    /* ── Shared badges (inline/badges.ts) ── */
    /* Crime count badge. Not interactive: it is announced as an image with the count. */
    function rlBuildCrimeBadge(count){
      var n = Math.floor(count);
      var el = rlEl('div', 'rl-crime' + (rlCrimeIsLarge(n) ? ' rl-crime-lg' : ''), rlCrimeLabel(n));
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', rlCrimeAria(n));
      return el;
    }

    /* Worst-stretch callout (text only). */
    function rlBuildCallout(text){
      return rlEl('div', 'rl-callout', text);
    }

    /*
     * Route score pill. The returned element is a transparent hit area of at least
     * ${RL_TOUCH_TARGET_PX}x${RL_TOUCH_TARGET_PX}px around a compact visible pill.
     * A tap on a non-selected pill calls onSelect(routeId) when given; the element
     * always swallows the tap so it never reaches the map underneath. Renderers that
     * rebuild the element from markup (Leaflet) bind selection to their own marker instead.
     */
    function rlBuildPill(badge, index, onSelect){
      var sel = badge.selected === true;
      var hit = rlEl('div', 'rl-pill-hit' + (sel ? ' rl-pill-hit-sel' : ''));
      hit.appendChild(rlEl('div', 'rl-pill' + (sel ? ' rl-pill-sel' : ''), badge.text));
      if(sel){
        hit.setAttribute('aria-current', 'true');
      } else {
        hit.setAttribute('role', 'button');
      }
      hit.setAttribute('aria-label', rlPillAria(index, badge.text, sel));
      hit.addEventListener('click', function(ev){
        if(ev){
          if(ev.preventDefault) ev.preventDefault();
          if(ev.stopPropagation) ev.stopPropagation();
        }
        if(!sel && typeof onSelect === 'function') onSelect(badge.routeId);
      });
      return hit;
    }
`;

export const BADGES_CSS = `
    .rl-crime{box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:${RL_CRIME_SIZE}px;height:${RL_CRIME_SIZE}px;border-radius:50%;background:#b42318;color:#ffffff;font:700 13px/1 ${FONT};border:2px solid #ffffff;box-shadow:0 0 0 2px rgba(180,35,24,.35),0 1px 4px rgba(0,0,0,.35);overflow:hidden;white-space:nowrap;pointer-events:none}
    .rl-crime-lg{width:${RL_CRIME_SIZE_LARGE}px;height:${RL_CRIME_SIZE_LARGE}px}
    .rl-callout{box-sizing:border-box;white-space:nowrap;background:#ffffff;color:#101828;font:600 13px/1.2 ${FONT};padding:5px 9px;border-radius:999px;box-shadow:0 2px 8px rgba(16,24,40,.25);pointer-events:none}
    .rl-pill-hit{box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-width:${RL_TOUCH_TARGET_PX}px;min-height:${RL_TOUCH_TARGET_PX}px;background:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
    .rl-pill-hit-sel{cursor:default}
    .rl-pill{box-sizing:border-box;min-width:${RL_PILL_MIN_WIDTH}px;height:${RL_PILL_HEIGHT}px;padding:0 9px;border-radius:999px;background:#ffffff;color:#101828;border:1px solid ${RL_GREY};font:700 13px/${RL_PILL_HEIGHT - 2}px ${FONT};text-align:center;white-space:nowrap;box-shadow:0 1px 4px rgba(16,24,40,.25)}
    .rl-pill-sel{background:#101828;color:#ffffff;border-color:#101828}
`;
