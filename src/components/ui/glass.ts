/**
 * Shared frosted-glass surface styles.
 *
 * Use these on every popup, modal, sheet and tab panel so they match the
 * sidebar, the search card and the bottom sheet.
 * Spread the object into a style: `style={{ ...glassSurface, padding: 16 }}`.
 */

/** A translucent white panel with a light border, soft shadow and background blur. */
export const glassSurface = {
  backgroundColor: 'rgba(255, 255, 255, 0.74)',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.7)',
  boxShadow: '0 12px 40px rgba(15, 23, 42, 0.14)',
  backdropFilter: 'blur(28px) saturate(180%)',
} as any;

/** The dimmed backdrop behind a modal: light enough to keep the map visible, blurred. */
export const glassScrim = {
  backgroundColor: 'rgba(15, 23, 42, 0.18)',
  backdropFilter: 'blur(6px)',
} as any;
