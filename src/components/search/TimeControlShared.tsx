/**
 * Shared pieces of the leave-at / arrive-by control: the chip, the segmented mode picker and
 * styles. Platform files (TimeControl.tsx, TimeControl.web.tsx) supply the time field.
 *
 * The shell keeps a local draft so the picker responds at once, and commits it (props.onChange)
 * after COMMIT_DELAY_MS of no further edits. "Leave now" commits immediately.
 */
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  defaultTimeState,
  describeTripTime,
  NOW_STATE,
  resolveTripTime,
  timeZoneNote,
  type TripTimeMode,
  type TripTimeState,
} from "@/src/utils/tripTime";

export interface TimeControlProps {
  value: TripTimeState;
  onChange: (next: TripTimeState) => void;
  /** Clock override for tests. */
  now?: () => Date;
}

const ACCENT = "#1849A9";
/** Pause after the last time edit before the search is triggered. */
const COMMIT_DELAY_MS = 700;

const MODES: { mode: TripTimeMode; label: string }[] = [
  { mode: "now", label: "Leave now" },
  { mode: "leave_at", label: "Leave at" },
  { mode: "arrive_by", label: "Arrive by" },
];

interface ShellProps extends TimeControlProps {
  /**
   * Renders the time field for a non-"now" mode. `value` is the shell's draft; `onChange` edits it
   * and the shell commits it after a short pause.
   */
  renderField: (args: {
    value: TripTimeState;
    /** Chosen time, narrowed to a string (the field only renders when a time is set). */
    hhmm: string;
    isTomorrow: boolean;
    now: () => Date;
    onChange: (next: TripTimeState) => void;
  }) => ReactNode;
}

export function TimeControlShell({ value, onChange, now, renderField }: ShellProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TripTimeState>(value);
  const clock = now ?? (() => new Date());
  const current = clock();
  const summary = describeTripTime(value, current);
  const draftResolved = resolveTripTime(draft, current);

  const chipRef = useRef<View>(null);

  // Latest props for the debounced commit, which can fire after a re-render.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt committed changes (including external ones) into the draft.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => () => cancelCommit(), []);

  const cancelCommit = () => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
  };

  // Commit only when the trip time really changed, and only after the user pauses.
  const editDraft = (next: TripTimeState) => {
    setDraft(next);
    cancelCommit();
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      const committed = valueRef.current;
      if (next.mode !== committed.mode || next.hhmm !== committed.hhmm) {
        onChangeRef.current(next);
      }
    }, COMMIT_DELAY_MS);
  };

  const focusChip = () => {
    if (Platform.OS === "web") {
      // DOM element: focus() is enough. findNodeHandle throws on web.
      const node = chipRef.current as unknown as { focus?: () => void } | null;
      node?.focus?.();
      return;
    }
    const handle = findNodeHandle(chipRef.current);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  };

  const closePanel = () => {
    setOpen(false);
    // The panel (and the focused control) disappears: put focus back on the chip.
    setTimeout(focusChip, 0);
  };

  // Web only: Escape closes the panel.
  const onPanelKeyDown = (e: { key: string }) => {
    if (e.key === "Escape") closePanel();
  };
  const webKeyProps: object =
    Platform.OS === "web" ? { onKeyDown: onPanelKeyDown } : {};

  const pickMode = (mode: TripTimeMode) => {
    if (mode === draft.mode) return;
    if (mode === "now") {
      // Leave now commits immediately.
      cancelCommit();
      setDraft(NOW_STATE);
      if (value.mode !== "now") onChange(NOW_STATE);
      closePanel();
      return;
    }
    // Switching Leave at <-> Arrive by keeps the time already chosen in the draft.
    editDraft(
      draft.mode !== "now" && draft.hhmm
        ? { mode, hhmm: draft.hhmm }
        : defaultTimeState(mode, clock()),
    );
  };

  const note = value.mode !== "now" ? timeZoneNote() : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.chipRow}>
        <Pressable
          ref={chipRef}
          onPress={() => setOpen((v) => !v)}
          style={[styles.chip, value.mode !== "now" && styles.chipActive]}
          accessibilityRole="button"
          accessibilityLabel={`${summary}, change trip time`}
          accessibilityState={{ expanded: open }}
        >
          <Ionicons
            name="time-outline"
            size={16}
            color={value.mode !== "now" ? ACCENT : "#475467"}
          />
          <Text style={[styles.chipText, value.mode !== "now" && styles.chipTextActive]}>
            {summary}
          </Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color="#667085" />
        </Pressable>
        {note !== null && <Text style={styles.noteText}>{note}</Text>}
      </View>

      {open && (
        <View style={styles.panel} {...webKeyProps}>
          <View
            style={styles.segments}
            accessibilityRole="radiogroup"
            accessibilityLabel="Trip time, London"
          >
            {MODES.map(({ mode, label }) => {
              const selected = draft.mode === mode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => pickMode(mode)}
                  style={[styles.segment, selected && styles.segmentSelected]}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {draft.mode !== "now" && draft.hhmm ? (
            <View style={styles.fieldSlot}>
              {renderField({
                value: draft,
                hhmm: draft.hhmm,
                isTomorrow: draftResolved?.isTomorrow ?? false,
                now: clock,
                onChange: editDraft,
              })}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

export const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingVertical: 4 },
  chipRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d0d5dd",
    backgroundColor: "#ffffff",
  },
  chipActive: { borderColor: "#1570ef", backgroundColor: "#f0f9ff" },
  chipText: { fontSize: 14, fontWeight: "600", color: "#344054" },
  chipTextActive: { color: ACCENT },
  noteText: { fontSize: 12, color: "#475467" },
  panel: {
    marginTop: 6,
    gap: 6,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eaecf0",
    backgroundColor: "#ffffff",
  },
  segments: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#eaecf0",
    backgroundColor: "#f2f4f7",
    padding: 2,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  segmentSelected: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#1570ef" },
  segmentText: { fontSize: 14, fontWeight: "500", color: "#475467" },
  segmentTextSelected: { color: ACCENT, fontWeight: "700" },
  fieldSlot: { minHeight: 44 },
});
