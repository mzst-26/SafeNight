/**
 * Shared route safety legend: builder (DOM, from spec.legend) and stylesheet.
 *
 * The legend is a collapsible region: a header button (a full-width, 44px tall tap
 * target) toggling a body that holds one row of discrete colour swatches (Safer on the
 * left, Riskier on the right, colours only from spec.legend.ramp) and a dotted-line
 * sample with its label. The optional notes (e.g. "Crime data unavailable") are NOT in
 * the collapsible body: they sit right under the header and stay visible when collapsed.
 * Everything from the spec is set as text or validated as hex.
 *
 * Requires CORE_JS in the same script.
 */
import {
  RL_DEFAULT_DASHED_LABEL,
  RL_LEGEND_COLLAPSE_BELOW_PX,
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
      holder.style.display = shown ? '' : 'none';
    }

    /*
     * Builds the legend inside root (an empty element the renderer owns and positions) and
     * returns { update(legend), setVisible(on) }. opts.dashArray is the dotted-sample pattern.
     * Starts hidden. The first time it is shown it starts collapsed on narrow viewports;
     * after that the user's toggle is remembered.
     */
    function rlBuildLegend(root, opts){
      opts = opts || {};
      var dashArray = opts.dashArray || '0.1 15';
      var collapsed = false;
      var started = false;
      root.setAttribute('role', 'region');
      root.setAttribute('aria-label', 'Route safety legend');
      root.style.display = 'none';
      var head = rlEl('button', 'rl-legend-head');
      head.setAttribute('type', 'button');
      head.setAttribute('aria-controls', RL_LEGEND_BODY_ID);
      head.appendChild(rlEl('span', null, 'Route safety'));
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

      function applyCollapsed(){
        body.style.display = collapsed ? 'none' : '';
        head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        root.classList.toggle('rl-legend-collapsed', collapsed);
      }
      head.addEventListener('click', function(ev){
        if(ev){
          if(ev.preventDefault) ev.preventDefault();
          if(ev.stopPropagation) ev.stopPropagation();
        }
        collapsed = !collapsed;
        applyCollapsed();
      });
      applyCollapsed();

      return {
        update: function(legend){
          rlFillLegendBody(body, legend, dashArray);
          rlFillLegendNotes(notesLine, legend);
        },
        setVisible: function(on){
          if(on && !started){
            started = true;
            collapsed = (Number(window.innerWidth) || 0) < ${RL_LEGEND_COLLAPSE_BELOW_PX};
            applyCollapsed();
          }
          if(!on) started = false;
          root.style.display = on ? '' : 'none';
        }
      };
    }
`;

export const LEGEND_CSS = `
    .rl-legend{box-sizing:border-box;min-width:${RL_LEGEND_MIN_WIDTH}px;max-width:min(${RL_LEGEND_MAX_WIDTH}px,46vw);background:rgba(255,255,255,.95);color:#101828;border-radius:10px;padding:0;font:600 12px/1.3 ${FONT};box-shadow:0 2px 10px rgba(16,24,40,.18)}
    .rl-legend-head{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:${RL_TOUCH_TARGET_PX}px;border:0;background:transparent;padding:0 10px;margin:0;font:inherit;color:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .rl-legend-notes{padding:0 10px 6px}
    .rl-legend-body{padding:0 10px 8px}
    .rl-legend-swatches{display:flex;gap:${RL_LEGEND_SWATCH_GAP}px}
    .rl-legend-swatch{flex:1 1 0;min-width:0;height:${RL_LEGEND_SWATCH_HEIGHT}px;border-radius:2px}
    .rl-legend-scale{display:flex;justify-content:space-between;margin-top:3px;font-size:12px;color:#344054}
    .rl-legend-dash{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:#344054}
    .rl-legend-dash-sample{display:flex;flex:none}
    .rl-legend-note{margin:0;font-size:12px;font-weight:500;line-height:1.3;color:#344054}
    .rl-legend-note+.rl-legend-note{margin-top:3px}
`;
