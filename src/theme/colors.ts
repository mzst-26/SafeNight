/**
 * Colour tokens. Values are the ones the search panel already uses, so screens keep their look
 * while new code imports from one place.
 */
export const colors = {
  primary: "#1570ef",
  primaryStrong: "#1849a9",
  primarySoft: "#f0f9ff",
  primaryBorder: "rgba(21, 112, 239, 0.25)",

  text: "#101828",
  textSecondary: "#475467",
  textMuted: "#667085",
  placeholder: "#98a2b3",

  surface: "#ffffff",
  surfaceMuted: "#f2f4f7",
  border: "#d0d5dd",
  borderSubtle: "#eaecf0",

  glass: "rgba(255, 255, 255, 0.7)",
  glassBorder: "rgba(255, 255, 255, 0.95)",
  glassShadow: "0 2px 8px rgba(15, 23, 42, 0.06)",

  danger: "#d92d20",
} as const;
