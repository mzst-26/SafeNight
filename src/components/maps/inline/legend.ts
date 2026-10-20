/**
 * Shared route safety legend: builder (DOM, from spec.legend) and stylesheet.
 *
 * The legend starts as a small round button (a safety icon, RL_TOUCH_TARGET_PX square) on the map. Tapping it
 * expands the legend: a header row toggling a body that holds one row of discrete colour
 * swatches (Safer on the left, Riskier on the right, colours only from spec.legend.ramp)
 * and a dotted-line sample with its label, plus any notes (e.g. "Crime data unavailable").
 * The expanded legend collapses back to the button on tapping the header again, or after
 * RL_LEGEND_IDLE_COLLAPSE_MS without any interaction inside it. Everything from the spec
 * is set as text or validated as hex.
 *
 * Requires CORE_JS in the same script.
 */
import {
  RL_DEFAULT_DASHED_LABEL,
  RL_LEGEND_MAX_WIDTH,
  RL_LEGEND_MIN_WIDTH,
  RL_LEGEND_SWATCH_GAP,
  RL_LEGEND_SWATCH_HEIGHT,
  RL_LINE_WIDTH,
  RL_TOUCH_TARGET_PX,
} from "@/src/components/maps/mapConstants";

const FONT = "system-ui,-apple-system,sans-serif";

/** Notes beyond this many lines are dropped (the legend must stay small). */
export const RL_LEGEND_MAX_NOTES = 4;

/** An expanded legend collapses back to its button after this long without interaction. */
export const RL_LEGEND_IDLE_COLLAPSE_MS = 4000;

/** Safety (shield with tick) icon for the collapsed button. Static markup, no external asset. */
export const RL_LEGEND_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#101828" stroke-width="2"/><path d="M9.5 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.5" fill="none" stroke="#101828" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="17.2" r="1.2" fill="#101828"/></svg>';

export const LEGEND_JS = `
    /* ── Shared legend (inline/legend.ts) ── */
    var RL_LEGEND_BODY_ID = 'rl-legend-body';

    /* Decorative dotted sample. dashArray is renderer specific (px) so it matches that renderer's dashed line. */
    function rlDashSampleMarkup(dashArray){
      return '<svg width="36" height="10" viewBox="0 0 36 10" aria-hidden="true" focusable="false"><line x1="2" y1="5" x2="34" y2="5" stroke="#344054" stroke-width="${RL_LINE_WIDTH}" stroke-linecap="round" stroke-dasharray="' + dashArray + '"/></svg>';
    }

    /* Fills the legend body from spec.legend. Colours are six-digit hex only; labels and notes are text. */
    function rlFillLegendBody(body, legend, dashArray){
      body.textContent = '';
      var ramp = (legend && Array.isArray(legend.ramp)) ? legend.ramp : [];
      var colours = [];
      for(var i=0;i<ramp.length;i++){
        var c = rlColor(ramp[i] ? ramp[i].color : null, null);
        if(c) colours.push(c);
      }
      if(colours.length){
        var swatches = rlEl('div', 'rl-legend-swatches');
        swatches.setAttribute('role', 'img');
        swatches.setAttribute('aria-label', 'Route risk scale, safer to riskier');
        for(var s=0;s<colours.length;s++){
          var swatch = rlEl('span', 'rl-legend-swatch');
          swatch.style.background = colours[s];
          swatches.appendChild(swatch);
        }
        body.appendChild(swatches);
        var scale = rlEl('div', 'rl-legend-scale');
        scale.appendChild(rlEl('span', null, 'Safer'));
        scale.appendChild(rlEl('span', null, 'Riskier'));
        body.appendChild(scale);
      }
      var dashed = (legend && typeof legend.dashedLabel === 'string' && legend.dashedLabel) ? legend.dashedLabel : ${JSON.stringify(RL_DEFAULT_DASHED_LABEL)};
      var dashRow = rlEl('div', 'rl-legend-dash');
      var sample = rlEl('span', 'rl-legend-dash-sample');
      sample.innerHTML = rlDashSampleMarkup(dashArray);
      dashRow.appendChild(sample);
      dashRow.appendChild(rlEl('span', 'rl-legend-dash-label', dashed));
      body.appendChild(dashRow);
      // Key for the other map markers. Text is set with textContent; the samples are static markup.
      var key = rlEl('div', 'rl-legend-key');
      key.appendChild(rlKeyRow(rlEl('span', 'rl-key-line'), 'Grey line: other route options'));
      key.appendChild(rlKeyRow(rlEl('span', 'rl-key-pill', '66'), 'Number on a route: its safety score. Dark is the selected route.'));
      key.appendChild(rlKeyRow(rlEl('span', 'rl-key-crime', '3'), 'Red circle: reported crimes nearby, with the count.'));
      body.appendChild(key);
    }

    function rlKeyRow(sample, text){
      var row = rlEl('div', 'rl-legend-key-row');
      var wrap = rlEl('span', 'rl-legend-key-sample');
      wrap.setAttribute('aria-hidden', 'true');
      wrap.appendChild(sample);
      row.appendChild(wrap);
      row.appendChild(rlEl('span', 'rl-legend-key-text', text));
      return row;
    }

    /* Fills the persistent notes line (outside the collapsible body). It is hidden while there are no notes. */
    function rlFillLegendNotes(holder, legend){
      holder.textContent = '';
      var notes = (legend && Array.isArray(legend.notes)) ? legend.notes : [];
      var shown = 0;
      for(var n=0;n<notes.length && shown<${RL_LEGEND_MAX_NOTES};n++){
        if(typeof notes[n] === 'string' && notes[n]){
          holder.appendChild(rlEl('div', 'rl-legend-note', notes[n]));
          shown++;
        }
      }
      holder.style.display = shown ? "" : "none";
      return shown;
    }

    /*
     * Builds the legend inside root (an empty element the renderer owns and positions) and
     * returns { update(legend), setVisible(on) }. opts.dashArray is the dotted-sample pattern.
     * Starts hidden. Each time it becomes visible it starts collapsed (the round button).
     * Expanded: any interaction inside it re-arms an idle timer; the timer collapses it after
     * RL_LEGEND_IDLE_MS, and tapping the header toggles it back to the button at once.
     */
    var RL_LEGEND_IDLE_MS = ${RL_LEGEND_IDLE_COLLAPSE_MS};
    function rlBuildLegend(root, opts){
      opts = opts || {};
      var dashArray = opts.dashArray || '0.1 15';
      var collapsed = true;
      var started = false;
      var idleTimer = null;
      root.setAttribute('role', 'region');
      root.setAttribute('aria-label', 'Route safety legend');
      root.style.display = 'none';
      var head = rlEl('button', 'rl-legend-head');
      head.setAttribute('type', 'button');
      head.setAttribute('aria-label', 'Route safety legend');
      head.setAttribute('aria-controls', RL_LEGEND_BODY_ID);
      var icon = rlEl('span', 'rl-legend-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = ${JSON.stringify(RL_LEGEND_ICON_SVG)};
      head.appendChild(icon);
      head.appendChild(rlEl('span', 'rl-legend-title', 'Route safety'));
      var chevron = rlEl('span', 'rl-legend-chevron', String.fromCharCode(9662));
      chevron.setAttribute('aria-hidden', 'true');
      head.appendChild(chevron);
      var notesLine = rlEl('div', 'rl-legend-notes');
      var body = rlEl('div', 'rl-legend-body');
      body.id = RL_LEGEND_BODY_ID;
      root.appendChild(head);
      root.appendChild(notesLine);
      root.appendChild(body);
      rlFillLegendBody(body, null, dashArray);
      rlFillLegendNotes(notesLine, null);

      function clearIdle(){
        if(idleTimer){ clearTimeout(idleTimer); idleTimer = null; }
      }
      function armIdle(){
        clearIdle();
        idleTimer = setTimeout(function(){
          idleTimer = null;
          collapsed = true;
          applyCollapsed();
        }, RL_LEGEND_IDLE_MS);
      }
      function applyCollapsed(){
        head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        root.classList.toggle('rl-legend-collapsed', collapsed);
        if(collapsed) clearIdle(); else armIdle();
      }
      head.addEventListener('click', function(ev){
        if(ev){
          if(ev.preventDefault) ev.preventDefault();
          if(ev.stopPropagation) ev.stopPropagation();
        }
        collapsed = !collapsed;
        applyCollapsed();
      });
      /* Any interaction inside an expanded legend restarts the idle countdown. */
      function touch(){
        if(!collapsed) armIdle();
      }
      var touchEvents = ['pointerdown', 'touchstart', 'keydown', 'focusin'];
      for(var t=0;t<touchEvents.length;t++) root.addEventListener(touchEvents[t], touch);
      applyCollapsed();

      return {
        update: function(legend){
          rlFillLegendBody(body, legend, dashArray);
          var noteCount = rlFillLegendNotes(notesLine, legend);
          // Caveats stay visible while collapsed: a dot on the button, and the label says so.
          root.classList.toggle('rl-legend-has-notes', noteCount > 0);
          head.setAttribute('aria-label', noteCount > 0 ? 'Route safety legend, has notes' : 'Route safety legend');
        },
        setVisible: function(on){
          if(on && !started){
            started = true;
            collapsed = true;
            applyCollapsed();
          }
          if(!on){
            started = false;
            clearIdle();
          }
          root.style.display = on ? '' : 'none';
        }
      };
    }
`;

export const LEGEND_CSS = `
    .rl-legend{box-sizing:border-box;min-width:${RL_LEGEND_MIN_WIDTH}px;max-width:min(${RL_LEGEND_MAX_WIDTH}px,46vw);background:rgba(255,255,255,.95);color:#101828;border-radius:10px;padding:0;font:600 12px/1.3 ${FONT};box-shadow:0 2px 10px rgba(16,24,40,.18)}
    .rl-legend-head{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:${RL_TOUCH_TARGET_PX}px;border:0;background:transparent;padding:0 10px;margin:0;font:inherit;color:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .rl-legend-head:focus-visible{outline:2px solid #344054;outline-offset:2px}
    .rl-legend-icon{display:flex;flex:none}
    .rl-legend-title{flex:1 1 auto;min-width:0;white-space:nowrap}
    .rl-legend.rl-legend-collapsed{width:${RL_TOUCH_TARGET_PX}px;height:${RL_TOUCH_TARGET_PX}px;min-width:0;max-width:none;border-radius:${RL_TOUCH_TARGET_PX / 2}px;box-shadow:0 2px 8px rgba(16,24,40,.22)}
    .rl-legend.rl-legend-collapsed .rl-legend-head{justify-content:center;width:${RL_TOUCH_TARGET_PX}px;height:${RL_TOUCH_TARGET_PX}px;min-height:0;padding:0;position:relative}
    .rl-legend.rl-legend-collapsed.rl-legend-has-notes .rl-legend-head::after{content:"";position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:4px;background:#d97706;box-shadow:0 0 0 1.5px #fff}
    .rl-legend.rl-legend-collapsed .rl-legend-title,.rl-legend.rl-legend-collapsed .rl-legend-chevron,.rl-legend.rl-legend-collapsed .rl-legend-notes,.rl-legend.rl-legend-collapsed .rl-legend-body{display:none}
    .rl-legend-notes{padding:0 10px 6px}
    .rl-legend-body{padding:0 10px 8px}
    .rl-legend-swatches{display:flex;gap:${RL_LEGEND_SWATCH_GAP}px}
    .rl-legend-swatch{flex:1 1 0;min-width:0;height:${RL_LEGEND_SWATCH_HEIGHT}px;border-radius:2px}
    .rl-legend-scale{display:flex;justify-content:space-between;margin-top:3px;font-size:12px;color:#344054}
    .rl-legend-dash{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:#344054}
    .rl-legend-dash-sample{display:flex;flex:none}
    .rl-legend-note{margin:0;font-size:12px;font-weight:500;line-height:1.3;color:#344054}
    .rl-legend-key{margin-top:8px;padding-top:8px;border-top:1px solid rgba(16,24,40,.08);display:flex;flex-direction:column;gap:6px}
    .rl-legend-key-row{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;line-height:1.3;color:#344054}
    .rl-legend-key-sample{display:flex;flex:none;width:34px;justify-content:center}
    .rl-key-line{display:block;width:30px;height:3px;border-radius:2px;background:#98a2b3}
    .rl-key-pill{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:18px;padding:0 6px;border-radius:999px;background:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.95);color:#101828;font:700 11px/1 system-ui,-apple-system,sans-serif;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 1px 3px rgba(15,23,42,.10)}
    .rl-key-crime{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#b42318;color:#ffffff;border:2px solid #ffffff;font:700 10px/1 system-ui,-apple-system,sans-serif;box-shadow:0 0 0 2px rgba(180,35,24,.35)}
    .rl-legend-key-text{min-width:0}
    .rl-legend-note+.rl-legend-note{margin-top:3px}
`;
