/**
 * TimeControl (native): chip -> segmented [Leave now | Leave at | Arrive by] plus a +/-15 min
 * stepper. No date-picker dependency; the web variant (TimeControl.web.tsx) uses <input type="time">.
 * The stepper is bounded: it never goes before now (rounded up to 15 min) nor beyond now + 23h45m.
 */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { canStepTripTime, stepTripTime } from "@/src/utils/tripTime";
import { styles, TimeControlShell, type TimeControlProps } from "./TimeControlShared";

export type { TimeControlProps };

export function TimeControl(props: TimeControlProps) {
  const { onChange } = props;
  return (
    <TimeControlShell
      {...props}
      renderField={({ value, hhmm, isTomorrow, now }) => {
        const step = (delta: number) => {
          const next = stepTripTime(value, delta, now());
          if (next.hhmm !== value.hhmm) onChange(next);
        };
        const canEarlier = canStepTripTime(value, -15, now());
        const canLater = canStepTripTime(value, 15, now());
        return (
          <View style={styles.fieldRow}>
            <Pressable
              style={[styles.stepBtn, !canEarlier && styles.stepBtnDisabled]}
              onPress={() => step(-15)}
              disabled={!canEarlier}
              accessibilityRole="button"
              accessibilityLabel="Earlier by 15 minutes"
              accessibilityState={{ disabled: !canEarlier }}
            >
              <Ionicons name="remove" size={20} color="#344054" />
            </Pressable>
            <View
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Trip time"
              accessibilityValue={{ text: hhmm }}
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === "increment") step(15);
                else if (e.nativeEvent.actionName === "decrement") step(-15);
              }}
            >
              <Text style={styles.timeText}>{hhmm}</Text>
            </View>
            <Pressable
              style={[styles.stepBtn, !canLater && styles.stepBtnDisabled]}
              onPress={() => step(15)}
              disabled={!canLater}
              accessibilityRole="button"
              accessibilityLabel="Later by 15 minutes"
              accessibilityState={{ disabled: !canLater }}
            >
              <Ionicons name="add" size={20} color="#344054" />
            </Pressable>
            {isTomorrow && <Text style={styles.dayText}>Tomorrow</Text>}
          </View>
        );
      }}
    />
  );
}
