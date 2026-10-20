/**
 * Shared pieces of the leave-at / arrive-by control: the chip, the segmented mode picker and
 * styles. Platform files (TimeControl.tsx, TimeControl.web.tsx) supply the time field.
 */
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  defaultTimeState,
  describeTripTime,
  NOW_STATE,
  resolveTripTime,
  type TripTimeMode,
  type TripTimeState,
} from "@/src/utils/tripTime";

export interface TimeControlProps {
  value: TripTimeState;
  onChange: (next: TripTimeState) => void;
  /** Clock override for tests. */
  now?: () => Date;
}

const MODES: { mode: TripTimeMode; label: string }[] = [
  { mode: "now", label: "Leave now" },
  { mode: "leave_at", label: "Leave at" },
  { mode: "arrive_by", label: "Arrive by" },
];

interface ShellProps extends TimeControlProps {
  /** Renders the time field for a non-"now" mode. */
  renderField: (args: { value: TripTimeState; isTomorrow: boolean }) => ReactNode;
}

export function TimeControlShell({ value, onChange, now, renderField }: ShellProps) {
  const [open, setOpen] = useState(false);
  const clock = now ?? (() => new Date());
  const current = clock();
  const summary = describeTripTime(value, current);
  const resolved = resolveTripTime(value, current);

  const pickMode = (mode: TripTimeMode) => {
    if (mode === value.mode) return;
    onChange(mode === "now" ? NOW_STATE : defaultTimeState(mode, clock()));
    if (mode === "now") setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
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

      {open && (
        <View style={styles.panel}>
          <View style={styles.segments} accessibilityRole="radiogroup">
            {MODES.map(({ mode, label }) => {
              const selected = value.mode === mode;
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
          {value.mode !== "now" && value.hhmm
            ? renderField({ value, isTomorrow: resolved?.isTomorrow ?? false })
            : null}
        </View>
      )}
    </View>
  );
}

const ACCENT = "#1849A9";

export const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingVertical: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#d0d5dd",
    backgroundColor: "#ffffff",
  },
  chipActive: { borderColor: "#1570ef", backgroundColor: "#f0f9ff" },
  chipText: { fontSize: 14, fontWeight: "600", color: "#344054" },
  chipTextActive: { color: ACCENT },
  panel: { marginTop: 6, gap: 8 },
  segments: {
    flexDirection: "row",
    borderRadius: 12,
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
    borderRadius: 10,
  },
  segmentSelected: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#1570ef" },
  segmentText: { fontSize: 14, fontWeight: "500", color: "#475467" },
  segmentTextSelected: { color: ACCENT, fontWeight: "700" },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  stepBtn: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#d0d5dd",
    backgroundColor: "#ffffff",
  },
  timeText: { fontSize: 18, fontWeight: "700", color: "#101828", minWidth: 64, textAlign: "center" },
  dayText: { fontSize: 13, fontWeight: "600", color: ACCENT },
  fieldLabel: { fontSize: 13, color: "#475467" },
});
