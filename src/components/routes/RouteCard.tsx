/**
 * RouteCard — One compact row per route: name, duration · distance, and one safety chip.
 * Safety details sit behind a collapsible toggle (Google-Maps style). With `hideSafety`
 * (during navigation) the safety chip, the score and the details toggle are not rendered.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { riskToColor } from "@/src/components/maps/routeLayers";
import { AIExplainButton } from "@/src/components/ui/AIExplainButton";
import { isV2SafeRoute, type RouteSafety, type SafeRoute } from "@/src/services/safeRoutes";
import { colors, radius, spacing, type } from "@/src/theme";
import { formatDistance, formatDuration } from "@/src/utils/format";
import type { RouteComparison } from "@/src/utils/routeComparison";
import { formatArrivalSummary, formatTimelineSummary } from "@/src/utils/tripTime";

/** Recommended-route accent. Not in the shared tokens yet, so it stays local. */
const BEST_ACCENT = "#22c55e";
const BEST_BACKGROUND = "#f0fdf4";
const BEST_LABEL_COLOR = "#15803D";

const METRES_PER_MILE = 1609.344;

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type ConfidenceTier = "verified" | "mostly" | "estimated";

/**
 * How much of the route's lighting is measured.
 * Estimated: lighting estimated, or certainty below 0.4 (the map's dashed cut-off).
 * Verified: lighting verified and certainty at least 0.6. Mostly mapped: mixed lighting, or
 * certainty from 0.4 up to 0.6. Null when the data says nothing either way.
 */
export function confidenceTier(safety: Partial<RouteSafety>): ConfidenceTier | null {
  const certainty = isFiniteNumber(safety.certainty) ? safety.certainty : null;
  const lighting = safety.dataQuality?.lighting;
  if (lighting === "estimated" || (certainty !== null && certainty < 0.4)) return "estimated";
  if (lighting === "verified" && certainty !== null && certainty >= 0.6) return "verified";
  if (lighting === "mixed" || (certainty !== null && certainty < 0.6)) return "mostly";
  return null;
}

/**
 * Compact delta of one route against the recommended route, e.g. "+0.6 mi · 5 pts safer" or
 * "0.4 mi shorter · 4 pts lower". Both inputs carry deltas against the fastest route, so their
 * difference is the delta against the recommended route. Returns null when nothing is worth
 * saying, and never produces NaN.
 */
export function formatRouteDelta(
  comparison: RouteComparison,
  recommended: RouteComparison,
): string | null {
  const parts: string[] = [];

  if (
    isFiniteNumber(comparison.deltaDistanceVsFastest) &&
    isFiniteNumber(recommended.deltaDistanceVsFastest)
  ) {
    const metres = comparison.deltaDistanceVsFastest - recommended.deltaDistanceVsFastest;
    const tenthsOfMile = Math.round((Math.abs(metres) / METRES_PER_MILE) * 10);
    if (tenthsOfMile > 0) {
      const amount = (tenthsOfMile / 10).toFixed(1);
      parts.push(metres > 0 ? `+${amount} mi` : `${amount} mi shorter`);
    }
  }

  if (
    isFiniteNumber(comparison.deltaScoreVsFastest) &&
    isFiniteNumber(recommended.deltaScoreVsFastest)
  ) {
    const points = Math.round(comparison.deltaScoreVsFastest - recommended.deltaScoreVsFastest);
    if (points !== 0) {
      const abs = Math.abs(points);
      const unit = abs === 1 ? "pt" : "pts";
      parts.push(points > 0 ? `${abs} ${unit} safer` : `${abs} ${unit} lower`);
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

interface RouteCardProps {
  route: SafeRoute;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  /** Full safety breakdown rendered inside the collapsible section */
  detailsPanel?: React.ReactNode;
  /** This route's row from routeComparison. Kept for callers; the compact card does not show deltas. */
  comparison?: RouteComparison | null;
  /** The recommended route's row from routeComparison. Kept for callers; the compact card does not show deltas. */
  recommendedComparison?: RouteComparison | null;
  /** Hide every safety element (score, chip, label, details). Used during navigation. Default false. */
  hideSafety?: boolean;
  /** Set on the recommended card only (desktop web): shows a small circle that opens the explanation. */
  onExplain?: () => void;
}

const TIER_TEXT: Record<ConfidenceTier, string> = {
  verified: "Verified",
  mostly: "Mostly mapped",
  estimated: "Estimated",
};

export function RouteCard({
  route,
  index,
  isSelected,
  onSelect,
  detailsPanel,
  comparison,
  recommendedComparison,
  hideSafety = false,
  onExplain,
}: RouteCardProps) {
  const safety = route.safety;
  const isBest = route.isSafest && !hideSafety;
  const label = isBest ? "Top Safety Score" : `Route ${index + 1}`;
  const [expanded, setExpanded] = useState(false);

  const isV2 = isV2SafeRoute(route);
  // One encoding for v2: the dot and tint use the same risk ramp as the map. v1 keeps the backend band colour.
  const dotColor = isV2 ? riskToColor(1 - safety.score / 100) : safety.color;
  const showDetails = !hideSafety && detailsPanel != null;

  // Safety facts shown under the row, outside navigation only. Never hidden silently: the lighting
  // caveat and the reason are what tell the user how much to trust the score.
  const tier = isV2 && !hideSafety ? confidenceTier(safety) : null;
  const reason =
    isBest && typeof safety.reason === "string" && safety.reason.trim() !== "" ? safety.reason : null;
  const detailLines = [
    tier !== null ? `Lighting: ${TIER_TEXT[tier]}` : null,
    reason,
  ].filter((line): line is string => line !== null);
  // Trip timing is not a safety figure, but it is hidden with the rest during navigation.
  // The departure is the same for every route, so only the recommended card shows it.
  const timelineText = hideSafety
    ? null
    : isBest
      ? formatTimelineSummary(safety.timeline)
      : formatArrivalSummary(safety.timeline);

  // Collapse whenever the card is deselected, or when safety is hidden
  useEffect(() => {
    if (!isSelected || hideSafety) setExpanded(false);
  }, [isSelected, hideSafety]);

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      style={[
        styles.card,
        isSelected && styles.cardSelected,
        isBest && styles.cardBest,
      ]}
    >
      {isBest && onExplain && (
        <View style={styles.explainCorner} pointerEvents="box-none">
          <AIExplainButton variant="circle" onPress={onExplain} />
        </View>
      )}
      {/* ── One row: name · duration · distance · safety chip ── */}
      <View style={styles.row}>
        <Text
          style={[
            styles.name,
            isSelected && styles.nameSelected,
            isBest && styles.nameBest,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {isBest && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Recommended</Text>
          </View>
        )}
        <Text style={styles.metrics} numberOfLines={1}>
          {formatDuration(route.durationSeconds)} · {formatDistance(route.distanceMeters)}
        </Text>
        {!hideSafety && (
          <View style={[styles.chip, { backgroundColor: dotColor + "20" }]}>
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <Text style={styles.chipText} numberOfLines={1}>
              {isFiniteNumber(safety.score) ? `${Math.round(safety.score)} · ` : ""}
              {safety.label}
            </Text>
          </View>
        )}
      </View>

      {(detailLines.length > 0 || timelineText !== null) && (
        <View style={styles.detailLines}>
          {detailLines.map((line) => (
            <Text key={line} style={styles.detailLine}>
              {line}
            </Text>
          ))}
          {timelineText !== null && (
            <Text style={styles.timelineLine}>{timelineText}</Text>
          )}
        </View>
      )}

      {/* ── Safety Details toggle (only when selected + data available) ── */}
      {isSelected && showDetails && (
        <Pressable
          style={styles.detailsToggle}
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? "Collapse safety details" : "Expand safety details"
          }
          hitSlop={8}
        >
          <Text style={styles.detailsToggleText}>Safety Details</Text>
          <Text style={[styles.chevron, expanded && styles.chevronOpen]}>
            ›
          </Text>
        </Pressable>
      )}

      {/* ── Collapsible body ─────────────────────────────────── */}
      {isSelected && expanded && showDetails && (
        <View style={styles.detailsWrap}>{detailsPanel}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Straddles the top-right corner, like a badge, so it stays off the name and safety row.
  explainCorner: {
    position: "absolute",
    top: -10,
    right: -6,
    zIndex: 2,
  },
  card: {
    marginBottom: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    justifyContent: "center",
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 2,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  cardBest: {
    borderColor: BEST_ACCENT,
    backgroundColor: BEST_BACKGROUND,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  name: {
    ...type.headline,
    fontSize: 15,
    color: colors.text,
    flexShrink: 1,
  },
  nameSelected: {
    color: colors.primaryStrong,
  },
  nameBest: {
    color: BEST_LABEL_COLOR,
  },
  metrics: {
    ...type.body,
    color: colors.textSecondary,
    marginLeft: "auto",
    flexShrink: 0,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    ...type.caption,
    color: colors.text,
  },
  detailsToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#dde3ef",
  },
  detailsToggleText: {
    ...type.label,
    color: colors.primaryStrong,
  },
  chevron: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.primaryStrong,
    transform: [{ rotate: "90deg" }],
  },
  chevronOpen: {
    transform: [{ rotate: "-90deg" }],
  },
  detailsWrap: {
    marginTop: spacing.md,
  },
  detailLines: {
    marginTop: spacing.xs,
    gap: 2,
  },
  detailLine: {
    ...type.caption,
    color: colors.textSecondary,
  },
  timelineLine: {
    ...type.caption,
    color: colors.primaryStrong,
    marginTop: spacing.xs,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: BEST_BACKGROUND,
    borderWidth: 1,
    borderColor: BEST_ACCENT,
    flexShrink: 0,
  },
  badgeText: {
    ...type.caption,
    fontWeight: "700",
    color: BEST_LABEL_COLOR,
  },
});
