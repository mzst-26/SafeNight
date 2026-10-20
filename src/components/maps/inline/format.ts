/**
 * Shared inline-script text helpers: crime badge label/size and the aria text of
 * the interactive overlay elements. Plain-JS string, see core.ts.
 */
import {
  RL_BADGE_LABEL_CAP,
  RL_BADGE_LARGE_FROM,
} from "@/src/components/maps/mapConstants";

export const FORMAT_JS = `
    /* ── Shared formatting (inline/format.ts) ── */
    /* Crime badge label: the count, capped at "99+". */
    function rlCrimeLabel(count){
      return count > ${RL_BADGE_LABEL_CAP} ? '${RL_BADGE_LABEL_CAP}+' : String(count);
    }

    /* Counts from 100 up use the large badge. */
    function rlCrimeIsLarge(count){ return count >= ${RL_BADGE_LARGE_FROM}; }

    function rlCrimeAria(count){
      return count + (count === 1 ? ' crime reported' : ' crimes reported');
    }

    /* index is the 0-based position among the pills; the score is the pill text. */
    function rlPillAria(index, text, selected){
      return 'Route ' + (index + 1) + ' score ' + text + (selected ? ', selected' : ', tap to select');
    }
`;
