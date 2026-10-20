/**
 * RouteCard — A single route in the route list.
 * Safety details are hidden behind a collapsible toggle (Google-Maps style).
 */
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { riskToColor } from "@/src/components/maps/routeLayers";
import type { RouteComparison } from "@/src/utils/routeComparison";
import { isV2SafeRoute, type RouteSafety, type SafeRoute } from "@/src/services/safeRoutes";
import { formatDistance, formatDuration } from "@/src/utils/format";

const METRES_PER_MILE = 1609.344;

/** Text shades (WCAG AA, 4.5:1 or better on the card backgrounds). Colour lives on the dot and tint only. */
const SCORE_TEXT_COLOR = "#101828";
const SECONDARY_TEXT_COLOR = "#475467";
const BEST_LABEL_COLOR = "#15803D";
const ACCENT_TEXT_COLOR = "#1849A9";

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type ConfidenceTier = "verified" | "mostly" | "estimated";

const TIER_TEXT: Record<ConfidenceTier, string> = {
  verified: "Verified",
  mostly: "Mostly mapped",
  estimated: "Estimated",
};

const TIER_ACCESSIBILITY_LABEL: Record<ConfidenceTier, string> = {
  verified: "Lighting verified",
  mostly: "Lighting partly mapped",
  estimated: "Lighting partly estimated",
};

/**
 * How much of the route's lighting is measured, for the small text tier on a v2 card.
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
  /** This route's row from routeComparison (v2 delta line). */
  comparison?: RouteComparison | null;
  /** The recommended route's row from routeComparison, the base for the delta line. */
  recommendedComparison?: RouteComparison | null;
}

export function RouteCard({
  route,
  index,
  isSelected,
  onSelect,
  detailsPanel,
  comparison,
  recommendedComparison,
}: RouteCardProps) {
  const isBest = route.isSafest;
  const safety = route.safety;
  const label = isBest ? "Top Safety Score" : `Route ${index + 1}`;
  const [expanded, setExpanded] = useState(false);

  const isV2 = isV2SafeRoute(route);
  const reason = isBest && typeof safety.reason === "string" && safety.reason.trim() !== "" ? safety.reason : null;
  const deltaLine =
    isV2 && !isBest && comparison && recommendedComparison
      ? formatRouteDelta(comparison, recommendedComparison)
      : null;
  const tier = isV2 ? confidenceTier(safety) : null;
  // One encoding for v2: the dot and tint use the same risk ramp as the map. v1 keeps the backend band colour.
  const dotColor = isV2 ? riskToColor(1 - safety.score / 100) : safety.color;

  // Collapse whenever the card is deselected
  useEffect(() => {
    if (!isSelected) setExpanded(false);
  }, [isSelected]);

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
      {/* ── Header: route name + score badge ─────────────────── */}
      <View style={styles.header}>
        <View style={styles.labelRow}>
          <Text
            style={[
              styles.label,
              isSelected && styles.labelSelected,
              isBest && styles.labelBest,
            ]}
          >
            {label}
          </Text>
          {isBest && (
            <View style={styles.bestBadge}>
              <Text style={styles.bestBadgeText}>★ Recommended</Text>
            </View>
          )}
          {tier !== null && (
            <View
              style={styles.tierChip}
              accessible
              accessibilityLabel={TIER_ACCESSIBILITY_LABEL[tier]}
            >
              <Text style={styles.tierChipText}>{TIER_TEXT[tier]}</Text>
            </View>
          )}
        </View>
        <View
          style={[styles.scoreChip, { backgroundColor: dotColor + "20" }]}
        >
          <View
            style={[styles.scoreChipDot, { backgroundColor: dotColor }]}
          />
          <Text style={styles.scoreChipText}>
            {safety.score}
          </Text>
        </View>
      </View>

      {/* ── Reason line (recommended v2 route only) ──────────── */}
      {reason !== null && (
        <Text style={styles.reason} numberOfLines={2}>
          {reason}
        </Text>
      )}

      {/* ── Summary line ─────────────────────────────────────── */}
      <View style={styles.summaryRow}>
        <Ionicons name="walk-outline" size={14} color={SECONDARY_TEXT_COLOR} />
        <Text style={styles.details}>
          {formatDistance(route.distanceMeters)} ·{" "}
          {formatDuration(route.durationSeconds)}
          {"  "}
          <Text style={styles.safetyInline}>
            {safety.label}
          </Text>
        </Text>
      </View>

      {/* ── Delta vs recommended route (other v2 routes only) ── */}
      {deltaLine !== null && <Text style={styles.deltaLine}>{deltaLine}</Text>}

      {/* ── Safety Details toggle (only when selected + data available) ── */}
      {isSelected && detailsPanel != null && (
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
      {isSelected && expanded && detailsPanel != null && (
        <View style={styles.detailsWrap}>{detailsPanel}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#eaecf0",
    backgroundColor: "#ffffff",
  },
  cardSelected: {
    borderColor: "#1570ef",
    backgroundColor: "#f0f9ff",
  },
  cardBest: {
    borderColor: "#22c55e",
    backgroundColor: "#f0fdf4",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  labelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#101828",
  },
  labelSelected: {
    color: ACCENT_TEXT_COLOR,
  },
  labelBest: {
    color: BEST_LABEL_COLOR,
  },
  bestBadge: {
    backgroundColor: "#DCFCE7",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  bestBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#047857",
  },
  tierChip: {
    backgroundColor: "#f2f4f7",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tierChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: SECONDARY_TEXT_COLOR,
  },
  reason: {
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY_TEXT_COLOR,
    marginBottom: 6,
  },
  deltaLine: {
    fontSize: 12,
    lineHeight: 16,
    color: SECONDARY_TEXT_COLOR,
    marginTop: 2,
  },
  scoreChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 5,
  },
  scoreChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  scoreChipText: {
    fontSize: 13,
    fontWeight: "700",
    color: SCORE_TEXT_COLOR,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 2,
  },
  details: {
    fontSize: 14,
    color: "#667085",
  },
  safetyInline: {
    fontSize: 13,
    fontWeight: "600",
    color: SECONDARY_TEXT_COLOR,
  },
  detailsToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#dde3ef",
  },
  detailsToggleText: {
    fontSize: 13,
    fontWeight: "600",
    color: ACCENT_TEXT_COLOR,
  },
  chevron: {
    fontSize: 18,
    fontWeight: "600",
    color: ACCENT_TEXT_COLOR,
    transform: [{ rotate: "90deg" }],
  },
  chevronOpen: {
    transform: [{ rotate: "-90deg" }],
  },
  detailsWrap: {
    marginTop: 12,
  },
});
