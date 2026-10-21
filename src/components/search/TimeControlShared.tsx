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
  Animated,
  AccessibilityInfo,
  Modal,
  findNodeHandle,
  Easing,
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

/** Where the desktop time row sits on screen, for placing its popup. */
type Anchor = { x: number; y: number; w: number; h: number };

/**
 * Desktop: the time row opens as a popup. It is a Modal, so it is drawn above the whole screen
 * (the sidebar's own stacking would hide it behind the items below). It fades and slides in,
 * sits just under the mode buttons, and closes when the screen outside it is tapped.
 */
function InlinePopup({
  visible,
  anchor,
  onClose,
  children,
}: {
  visible: boolean;
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible, anim]);
  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close time options" />
      <Animated.View
        style={[
          styles.popup,
          {
            left: anchor.x,
            top: anchor.y + anchor.h + 6,
            width: anchor.w,
            opacity: anim,
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
          },
        ]}
      >
        {children}
      </Animated.View>
    </Modal>
  );
}

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
  // Desktop (inline): the time stepper row shows only while a time is being chosen.
  const [fieldOpen, setFieldOpen] = useState(false);
  const wrapRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor>({ x: 0, y: 0, w: 0, h: 0 });
  useEffect(() => {
    if (!inline || !fieldOpen) return;
    wrapRef.current?.measureInWindow?.((x, y, w, h) => setAnchor({ x, y, w, h }));
  }, [inline, fieldOpen]);
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
  // closeAfterCommit: false for a mode switch, so the desktop time row stays open until a time is chosen.
  const editDraft = (next: TripTimeState, closeAfterCommit = true) => {
    setDraft(next);
    cancelCommit();
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      const committed = valueRef.current;
      if (next.mode !== committed.mode || next.hhmm !== committed.hhmm) {
        onChangeRef.current(next);
        // A time is chosen: fold the control back (the chip, or on desktop the single row).
        if (inline) {
          if (closeAfterCommit) setFieldOpen(false);
        } else {
          closePanel();
        }
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
    if (mode === draft.mode) {
      // Inline: pressing the selected Leave at / Arrive by button reopens the time row.
      if (inline && mode !== "now") setFieldOpen((v) => !v);
      return;
    }
    if (inline && mode !== "now") setFieldOpen(true);
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
      false,
    );
  };

  const note = value.mode !== "now" ? timeZoneNote() : null;

  return (
    <View ref={wrapRef} style={[styles.wrap, compact && styles.wrapCompact, inline && styles.wrapInline]}>
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
            style={[styles.segments, inline && styles.segmentsSlim]}
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
                  style={[styles.segment, inline && styles.segmentSlim, selected && (inline ? styles.segmentSelectedGlass : styles.segmentSelected)]}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.segmentText, inline && styles.segmentTextSlim, selected && (inline ? styles.segmentTextSelectedGlass : styles.segmentTextSelected)]}>
                    {inline && mode === "leave_at" && draft.mode === "leave_at" && draft.hhmm ? draft.hhmm : label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {draft.mode !== "now" && draft.hhmm && (!inline || fieldOpen) ? (
            inline ? (
              <InlinePopup visible anchor={anchor} onClose={() => setFieldOpen(false)}>
                {renderField({
                  value: draft,
                  hhmm: draft.hhmm,
                  isTomorrow: draftResolved?.isTomorrow ?? false,
                  now: clock,
                  onChange: editDraft,
                })}
              </InlinePopup>
            ) : (
              <View style={styles.fieldSlot}>
                {renderField({
                  value: draft,
                  hhmm: draft.hhmm,
                  isTomorrow: draftResolved?.isTomorrow ?? false,
                  now: clock,
                  onChange: editDraft,
                })}
              </View>
            )
          ) : null}
        </View>
      )}
    </View>
  );
}

export const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  // Desktop: the popup is positioned against this wrap, so it floats over the items below.
  wrapInline: { position: "relative", paddingTop: spacing.md },
  popup: {
    position: "absolute",
    zIndex: 60,
    elevation: 12,
    padding: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    boxShadow: "0 10px 28px rgba(15, 23, 42, 0.16)",
  } as any,
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
  // Desktop: no outer container. The mode track is the only container, so its height is the circle size.
  panelSlim: {
    marginTop: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    gap: 0,
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
  // 13px is the minimum text size (see 8ddb6ac); the caption token is 12px.
  noteText: { ...type.caption, fontSize: 13, color: colors.textSecondary },
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
  // Desktop sidebar: a thinner row with smaller text.
  // Same height as the round place buttons beside it (40px).
  segmentsSlim: {
    height: 40,
    borderRadius: 999,
    borderWidth: 0,
    padding: 3,
    backgroundColor: "rgba(15, 23, 42, 0.06)",
  },
  segmentSlim: { height: 34, minHeight: 34, borderRadius: 999 },
  segmentTextSlim: { fontSize: 11, fontWeight: "600" },
  // Selected: a white glass pill with a soft lift, in the accent colour. No outline.
  segmentSelectedGlass: {
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderWidth: 0,
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.12)",
  } as any,
  segmentTextSelectedGlass: { color: colors.primaryStrong, fontWeight: "700" },
  segmentSelected: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  segmentText: { ...type.label, fontWeight: "500", color: colors.textSecondary },
  segmentTextSelected: { color: ACCENT, fontWeight: "700" },
  fieldSlot: { minHeight: 32 },
});
