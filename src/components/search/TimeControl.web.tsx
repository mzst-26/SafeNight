/**
 * TimeControl (web): chip -> segmented control plus a 15-minute <select>. Options come from
 * tripTimeSlots, the same bounds as the native stepper, so past or out-of-range times can't be picked.
 * Edits go to the shell's draft via the renderField onChange arg; the shell commits after a short pause.
 */
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { tripTimeSlots } from "@/src/utils/tripTime";
import { TimeControlShell, type TimeControlProps } from "./TimeControlShared";

export type { TimeControlProps };

const styles = StyleSheet.create({
  row: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  tomorrow: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1849A9",
  },
});

type TimeSelectProps = {
  label: string;
  hhmm: string;
  options: string[];
  onPick: (hhmm: string) => void;
};

function TimeSelect({ label, hhmm, options, onPick }: TimeSelectProps) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      value={hhmm}
      aria-label={label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e: { target: { value: string } }) => onPick(e.target.value)}
      style={{
        flex: 1,
        minWidth: 0,
        height: 44,
        boxSizing: "border-box",
        padding: "0 12px",
        fontSize: 16,
        fontWeight: 700,
        fontFamily: "inherit",
        color: "#101828",
        backgroundColor: "#ffffff",
        border: "1px solid #d0d5dd",
        borderRadius: 10,
        colorScheme: "light",
        outline: focused ? "2px solid #1570ef" : "none",
        outlineOffset: 0,
      }}
    >
      {options.map((slot) => (
        <option key={slot} value={slot}>
          {slot}
        </option>
      ))}
    </select>
  );
}

export function TimeControl(props: TimeControlProps) {
  return (
    <TimeControlShell
      {...props}
      renderField={({ value, hhmm, isTomorrow, now, onChange }) => {
        const label = value.mode === "leave_at" ? "Leave at time" : "Arrive by time";
        const slots = tripTimeSlots(value.mode === "arrive_by" ? "arrive_by" : "leave_at", now());
        // Keep the current value selectable even if it has drifted outside the slot list.
        const options = slots.includes(hhmm) ? slots : [hhmm, ...slots];
        return (
          <View style={styles.row}>
            <TimeSelect
              label={label}
              hhmm={hhmm}
              options={options}
              onPick={(next) => onChange({ ...value, hhmm: next })}
            />
            {isTomorrow && <Text style={styles.tomorrow}>Tomorrow</Text>}
          </View>
        );
      }}
    />
  );
}
