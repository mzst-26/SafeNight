/** One stylesheet for every route overlay element (badges, callout, pill, legend), shared by both templates. */
import { BADGES_CSS } from "@/src/components/maps/inline/badges";
import { LEGEND_CSS } from "@/src/components/maps/inline/legend";

export const ROUTE_OVERLAY_CSS = `${BADGES_CSS}${LEGEND_CSS}`;
