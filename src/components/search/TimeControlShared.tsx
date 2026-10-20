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

import { colors, radius, spacing, type } from "@/src/theme";
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
  /** Header use: the panel floats over the content below the chip instead of pushing it down. */
  compact?: boolean;
  /** Desktop sidebar: the three mode buttons show directly, with no chip. Leave at shows its time. */
  inline?: boolean;
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

export function TimeControlShell({ value, onChange, now, renderField, compact = false, inline = false }: ShellProps) {
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
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt committed changes (including external ones) into the draft.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Don't let a pending commit or focus-return fire after unmount.
  useEffect(
    () => () => {
      cancelCommit();
      if (focusTimer.current) clearTimeout(focusTimer.current);
      focusTimer.current = null;
    },
    [],
  );

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
        // A time is chosen: fold the control back to its single chip.
        closePanel();
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
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      focusTimer.current = null;
      focusChip();
    }, 0);
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
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {!inline && (
      <View style={styles.chipRow}>
        <Pressable
          ref={chipRef}
          hitSlop={{ top: 7, bottom: 7 }}
          onPress={() => setOpen((v) => !v)}
          style={[styles.chip, value.mode !== "now" && styles.chipActive]}
          accessibilityRole="button"
          accessibilityLabel={`${summary}, change trip time`}
          accessibilityState={{ expanded: open }}
        >
          <Ionicons
            name="time-outline"
            size={13}
            color={value.mode !== "now" ? ACCENT : "#475467"}
          />
          <Text style={[styles.chipText, value.mode !== "now" && styles.chipTextActive]}>
            {summary}
          </Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={12} color="#667085" />
        </Pressable>
        {note !== null && <Text style={styles.noteText}>{note}</Text>}
      </View>
      )}
      {inline && note !== null && <Text style={styles.noteText}>{note}</Text>}

      {(inline || open) && (
        <View
          style={[
            styles.panel,
            compact && styles.panelCompact,
            inline && styles.panelSlim,
          ]}
          {...webKeyProps}
        >
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
                  hitSlop={{ top: 8, bottom: 8 }}
                  onPress={() => pickMode(mode)}
                  style={[styles.segment, selected && styles.segmentSelected]}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                    {inline && mode === "leave_at" && draft.mode === "leave_at" && draft.hhmm ? draft.hhmm : label}
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
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  wrapCompact: { paddingHorizontal: 0, paddingVertical: 0, position: "relative", zIndex: 1000 },
  panelCompact: {
    position: "absolute",
    top: "100%",
    right: 0,
    width: 300,
    marginTop: spacing.xs,
    zIndex: 1000,
  } as any,
  // Desktop sidebar: the options sit in the card, slim and without extra padding.
  panelSlim: {
    marginTop: 0,
    padding: 4,
    borderRadius: 10,
    gap: 4,
  },
  // Centred on the row so the trip-time control sits on the panel's axis.
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { ...type.label, color: colors.textSecondary },
  chipTextActive: { color: ACCENT },
  noteText: { ...type.caption, color: colors.textSecondary },
  panel: {
    marginTop: spacing.xs,
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  segments: {
    flexDirection: "row",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
    padding: 1,
  },
  segment: {
    flex: 1,
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  segmentSelected: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  segmentText: { ...type.label, fontWeight: "500", color: colors.textSecondary },
  segmentTextSelected: { color: ACCENT, fontWeight: "700" },
  fieldSlot: { minHeight: 32 },
});
