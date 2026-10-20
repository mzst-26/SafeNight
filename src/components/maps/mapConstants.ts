import { LIGHTS_MIN_ZOOM } from "@/src/components/maps/routeLayers";

export const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY ?? "";

export const MAPTILER_STREETS_STYLE_URL =
  `https://api.maptiler.com/maps/streets-v4/style.json?key=${MAPTILER_KEY}`;

export const MAPTILER_STREETS_RASTER_STYLE = {
  version: 8,
  sources: {
    maptilerStreets: {
      type: "raster",
      tiles: [
        `https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
      ],
      tileSize: 256,
      maxzoom: 22,
      attribution: "© MapTiler © OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "maptiler-streets-raster",
      type: "raster",
      source: "maptilerStreets",
    },
  ],
};

export const ROADMAP_STYLE = MAPTILER_STREETS_STYLE_URL;
export const USES_MAPTILER_STREETS = Boolean(MAPTILER_STREETS_STYLE_URL);

// ---------------------------------------------------------------------------
// Route layers (v2 safety model): constants shared by the Leaflet (web) and
// MapLibre (native) templates. The inline modules in ./inline turn these into
// plain-JS/CSS strings, so web and native cannot drift apart.
// ---------------------------------------------------------------------------

/** Colours of the safety marker kinds (legacy dots; also the fallback grey). */
export const SAFETY_MARKER_COLORS = {
  crime: "#ef4444",
  shop: "#22c55e",
  light: "#facc15",
  bus_stop: "#3b82f6",
  cctv: "#8b5cf6",
  dead_end: "#f97316",
  via: "#d946ef",
} as const;
export const SAFETY_MARKER_FALLBACK_COLOR = "#94a3b8";

/** Neutral grey of unselected route lines and the pill outline. */
export const RL_GREY = "#667085";

/** Selected route colour when the spec carries no usable line. */
export const RL_FALLBACK_BLUE = "#4285F4";

/** Colours of the highlightable point categories. */
export const RL_POINT_COLORS = {
  light: "#facc15",
  cctv: "#8b5cf6",
  shop: "#22c55e",
} as const;

/** Light points are drawn from this zoom up, unless lights are highlighted. */
export const RL_LIGHT_ZOOM = LIGHTS_MIN_ZOOM;

/** White casing drawn under every coloured selected-route line. */
export const RL_CASING_COLOR = "#ffffff";
export const RL_CASING_WIDTH = 11;
export const RL_CASING_OPACITY = 0.9;

/** Stroke width of the selected route's safety lines. */
export const RL_LINE_WIDTH = 7;

/** Visible width of an unselected route line. */
export const RL_UNSELECTED_WIDTH = 4;

/** Minimum touch target (px) for anything the user can tap. */
export const RL_TOUCH_TARGET_PX = 44;

/**
 * Width of the invisible hit line over each unselected route. Equal to the
 * minimum touch target so a finger can select a route without hitting it exactly.
 */
export const RL_HIT_WIDTH = RL_TOUCH_TARGET_PX;

/** Leaflet dashArray (px) for dashed (estimated) lines: dots with round caps. */
export const RL_DASH = "0.1 15";

/**
 * MapLibre dasharray units are multiples of the line width. [0.1, 2.1] at width 7 gives
 * dots that read like the web's "0.1 15" pattern at weight 7.
 */
export const RL_DASH_UNITS: [number, number] = [0.1, 2.1];

/** The same pattern in px, for the native SVG legend swatch (drawn at stroke-width RL_LINE_WIDTH). */
export const RL_DASH_PX: [number, number] = [
  Number((RL_DASH_UNITS[0] * RL_LINE_WIDTH).toFixed(2)),
  Number((RL_DASH_UNITS[1] * RL_LINE_WIDTH).toFixed(2)),
];

/** Legend label for dashed (estimated) lines when the spec does not supply one. */
export const RL_DEFAULT_DASHED_LABEL = "Estimated lighting";

/** Crime badge labels stop at this count and show "99+". */
export const RL_BADGE_LABEL_CAP = 99;

/** Crime badges at or above this count use the large size. */
export const RL_BADGE_LARGE_FROM = 100;

/** Crime badge diameters (px). */
export const RL_CRIME_SIZE = 32;
export const RL_CRIME_SIZE_LARGE = 36;

/** Score pill visual size (px). The tappable area is RL_TOUCH_TARGET_PX square at least. */
export const RL_PILL_MIN_WIDTH = 32;
export const RL_PILL_HEIGHT = 28;

/** Gap between the worst-stretch callout and the stretch midpoint (px, above the point). */
export const RL_CALLOUT_OFFSET_PX = 10;

/** Legend box: maximum width and swatch geometry (px). Six swatches share the row. */
export const RL_LEGEND_MAX_WIDTH = 200;
export const RL_LEGEND_MIN_WIDTH = 150;
export const RL_LEGEND_SWATCH_HEIGHT = 8;
export const RL_LEGEND_SWATCH_GAP = 2;

/** Narrower viewports start with the route safety legend collapsed. */
export const RL_LEGEND_COLLAPSE_BELOW_PX = 400;

/** Marker kinds replaced by the route safety layers when routeLayers is set. */
export const RL_REPLACED_KINDS = [
  "crime",
  "light",
  "cctv",
  "shop",
  "bus_stop",
  "dead_end",
  "via",
] as const;
