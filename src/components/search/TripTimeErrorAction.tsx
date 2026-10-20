/** Reset action shown inside the existing route-error banner when the chosen time was rejected. */
import { Pressable, StyleSheet, Text } from "react-native";

export function isTripTimeError(code: string | undefined | null): boolean {
  return code === "INVALID_TIME" || code === "TIME_OUT_OF_RANGE";
}

export function TripTimeErrorAction({
  code,
  onReset,
}: {
  code: string | undefined | null;
  onReset: () => void;
}) {
  if (!isTripTimeError(code)) return null;
  return (
    <Pressable
      onPress={onReset}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel="Back to Leave now"
    >
      <Text style={styles.text}>Back to Leave now</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 14,
    marginTop: 8,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#1570ef",
    backgroundColor: "#f0f9ff",
  },
  text: { fontSize: 14, fontWeight: "600", color: "#1849A9" },
});
