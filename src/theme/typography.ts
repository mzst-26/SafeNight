/**
 * Type ramp. Screens use these named steps instead of raw font sizes.
 * Four steps only: a small label, body, a headline and a display size for the time.
 */
export const type = {
  caption: { fontSize: 12, fontWeight: "500" },
  label: { fontSize: 13, fontWeight: "600" },
  body: { fontSize: 14, fontWeight: "400" },
  headline: { fontSize: 16, fontWeight: "700" },
  display: { fontSize: 22, fontWeight: "700" },
} as const;
