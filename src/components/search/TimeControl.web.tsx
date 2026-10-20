/**
 * TimeControl (web): chip -> segmented control plus a native <input type="time"> (15-minute step).
 */
import { Text, View } from "react-native";

import { styles, TimeControlShell, type TimeControlProps } from "./TimeControlShared";

export type { TimeControlProps };

export function TimeControl(props: TimeControlProps) {
  const { onChange } = props;
  return (
    <TimeControlShell
      {...props}
      renderField={({ value, isTomorrow }) => {
        const label = value.mode === "leave_at" ? "Leave at time" : "Arrive by time";
        return (
          <View style={styles.fieldRow}>
            <input
              type="time"
              step={900}
              value={value.hhmm ?? ""}
              aria-label={label}
              onChange={(e: { target: { value: string } }) => {
                const next = e.target.value;
                if (/^\d{2}:\d{2}$/.test(next)) onChange({ ...value, hhmm: next });
              }}
              style={{
                minHeight: 44,
                minWidth: 120,
                boxSizing: "border-box",
                padding: "0 12px",
                fontSize: 16,
                fontWeight: 700,
                color: "#101828",
                border: "1px solid #d0d5dd",
                borderRadius: 10,
                backgroundColor: "#ffffff",
                fontFamily: "inherit",
              }}
            />
            {isTomorrow && <Text style={styles.dayText}>Tomorrow</Text>}
          </View>
        );
      }}
    />
  );
}
