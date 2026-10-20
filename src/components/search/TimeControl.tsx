/**
 * TimeControl (native): chip -> segmented [Leave now | Leave at | Arrive by] plus a compact
 * [-] HH:MM [+] stepper. No date-picker dependency; the web variant (TimeControl.web.tsx)
 * uses <input type="time">.
 * The stepper is bounded: it never goes before now (rounded up to 15 min) nor beyond now + 23h45m.
 * Edits go to the shell's draft via setDraft; the shell commits them on Done.
 */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { canStepTripTime, stepTripTime } from "@/src/utils/tripTime";
import { TimeControlShell, type TimeControlProps } from "./TimeControlShared";

export type { TimeControlProps };

export function TimeControl(props: TimeControlProps) {
  return (
    <TimeControlShell
      {...props}
      renderField={({ value, hhmm, isTomorrow, now, onChange: setDraft }) => {
        const step = (delta: number) => {
          const next = stepTripTime(value, delta, now());
          if (next.hhmm !== value.hhmm) setDraft(next);
        };
        const canEarlier = canStepTripTime(value, -15, now());
        const canLater = canStepTripTime(value, 15, now());
        return (
          <View style={localStyles.field}>
            <Pressable
              style={({ pressed }) => [
                localStyles.stepBtn,
                pressed && canEarlier && localStyles.stepBtnPressed,
                !canEarlier && localStyles.stepBtnDisabled,
              ]}
              onPress={() => step(-15)}
              disabled={!canEarlier}
              accessibilityRole="button"
              accessibilityLabel="Earlier by 15 minutes"
              accessibilityState={{ disabled: !canEarlier }}
            >
              <Ionicons name="remove" size={22} color="#344054" />
            </Pressable>
            <View
              style={localStyles.timeCell}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Trip time"
              accessibilityValue={{ text: isTomorrow ? `${hhmm}, tomorrow` : hhmm }}
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === "increment") step(15);
                else if (e.nativeEvent.actionName === "decrement") step(-15);
              }}
            >
              <Text style={localStyles.timeText} numberOfLines={1} adjustsFontSizeToFit>
                {hhmm}
              </Text>
              {/* Reserved line: keeps the layout identical whether or not "Tomorrow" shows. */}
              <View style={localStyles.daySlot} importantForAccessibility="no-hide-descendants">
                {isTomorrow && <Text style={localStyles.dayText}>Tomorrow</Text>}
              </View>
            </View>
            <Pressable
              style={({ pressed }) => [
                localStyles.stepBtn,
                pressed && canLater && localStyles.stepBtnPressed,
                !canLater && localStyles.stepBtnDisabled,
              ]}
              onPress={() => step(15)}
              disabled={!canLater}
              accessibilityRole="button"
              accessibilityLabel="Later by 15 minutes"
              accessibilityState={{ disabled: !canLater }}
            >
              <Ionicons name="add" size={22} color="#344054" />
            </Pressable>
          </View>
        );
      }}
    />
  );
}

const localStyles = StyleSheet.create({
  field: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#d0d5dd",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stepBtnPressed: {
    backgroundColor: "#f2f4f7",
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  timeCell: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  timeText: {
    fontSize: 32,
    fontWeight: "700",
    color: "#101828",
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  daySlot: {
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1849A9",
  },
});
