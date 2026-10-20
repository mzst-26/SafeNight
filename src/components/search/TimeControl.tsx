/**
 * TimeControl (native): chip -> segmented [Leave now | Leave at | Arrive by] plus a +/-15 min
 * stepper. No date-picker dependency; the web variant (TimeControl.web.tsx) uses <input type="time">.
 */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { stepHhmm } from "@/src/utils/tripTime";
import { styles, TimeControlShell, type TimeControlProps } from "./TimeControlShared";

export type { TimeControlProps };

export function TimeControl(props: TimeControlProps) {
  const { onChange } = props;
  return (
    <TimeControlShell
      {...props}
      renderField={({ value, isTomorrow }) => (
        <View style={styles.fieldRow}>
          <Pressable
            style={styles.stepBtn}
            onPress={() => onChange({ ...value, hhmm: stepHhmm(value.hhmm as string, -15) })}
            accessibilityRole="button"
            accessibilityLabel="Earlier by 15 minutes"
          >
            <Ionicons name="remove" size={20} color="#344054" />
          </Pressable>
          <Text style={styles.timeText} accessibilityLiveRegion="polite">
            {value.hhmm}
          </Text>
          <Pressable
            style={styles.stepBtn}
            onPress={() => onChange({ ...value, hhmm: stepHhmm(value.hhmm as string, 15) })}
            accessibilityRole="button"
            accessibilityLabel="Later by 15 minutes"
          >
            <Ionicons name="add" size={20} color="#344054" />
          </Pressable>
          {isTomorrow && <Text style={styles.dayText}>Tomorrow</Text>}
        </View>
      )}
    />
  );
}
