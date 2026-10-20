/**
 * SafetyPanel — Hero score + 2×2 grid + detailed breakdown cards.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { riskToColor } from '@/src/components/maps/routeLayers';
import { CircleProgress } from '@/src/components/ui/CircleProgress';
import { isV2SafeRoute, type SafeRoute, type WorstStretch } from '@/src/services/safeRoutes';
import type { SafetyMapResult } from '@/src/services/safetyMapData';

type IconName = ComponentProps<typeof Ionicons>['name'];

const CRIME_UNAVAILABLE_LABEL = 'Crime data unavailable';

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * One line describing the route's weakest stretch, e.g. "Weakest stretch: 240 m, unlit".
 * Returns null when there is no stretch or its length is not a usable number.
 */
export function formatWorstStretch(stretch: WorstStretch | null | undefined): string | null {
  if (!stretch || !isFiniteNumber(stretch.lengthM) || stretch.lengthM <= 0) return null;
  const metres = Math.round(stretch.lengthM);
  const length = metres < 1000 ? `${metres} m` : `${(stretch.lengthM / 1000).toFixed(1)} km`;
  const cause = stretch.cause === 'lighting' ? 'unlit' : 'higher risk';
  return `Weakest stretch: ${length}, ${cause}`;
}

interface SafetyPanelProps {
  safetyResult: SafetyMapResult;
  selectedSafeRoute: SafeRoute;
  /** Called when user taps a grid card — category is the marker kind */
  onCategoryPress?: (category: string) => void;
  /** When true, skip the side-by-side web layout (used inside WebSidebar) */
  inSidebar?: boolean;
}

export function SafetyPanel({ safetyResult, selectedSafeRoute, onCategoryPress, inSidebar }: SafetyPanelProps) {
  const stats = selectedSafeRoute.routeStats;
  const crimeUnavailable = selectedSafeRoute.safety.dataQuality?.crime === 'unavailable';
  // v2 routes report the true crime total in routeStats; v1 keeps the panel's own count.
  const crimeValue: number | string = crimeUnavailable
    ? '–'
    : isFiniteNumber(stats?.crimeCount)
      ? stats.crimeCount
      : safetyResult.crimeCount;
  const weakestLine = formatWorstStretch(selectedSafeRoute.safety.worstStretch);
  // v2: the score ring uses the same risk ramp as the map and the route cards. v1 keeps the backend colour.
  const ringColor = isV2SafeRoute(selectedSafeRoute)
    ? riskToColor(1 - selectedSafeRoute.safety.score / 100)
    : safetyResult.safetyColor;

  return (
    <View style={[styles.column, Platform.OS === 'web' && !inSidebar && styles.columnWeb]}>
      {/* Hero Score */}
      <View style={[styles.heroCard, { borderColor: ringColor + '44' }]}>
        <CircleProgress
          size={Platform.OS === 'web' ? 64 : 52}
          strokeWidth={5}
          progress={safetyResult.safetyScore}
          color={ringColor}
        />
        <Text style={styles.heroLabel}>
          {safetyResult.safetyLabel}
        </Text>
      </View>

      {/* Route notes: data gaps and weakest stretch (v2 only) */}
      {(crimeUnavailable || weakestLine !== null) && (
        <View style={styles.notes}>
          {crimeUnavailable && (
            <View style={styles.crimeChip} accessible accessibilityLabel={CRIME_UNAVAILABLE_LABEL}>
              <Text style={styles.crimeChipText}>{CRIME_UNAVAILABLE_LABEL}</Text>
            </View>
          )}
          {weakestLine !== null && <Text style={styles.weakestLine}>{weakestLine}</Text>}
        </View>
      )}

      {/* 2×2 grid */}
      <View style={styles.grid}>
        <GridCard icon="warning-outline" value={crimeValue} label="Crimes" color="#ef4444" valueColor="#B42318" onPress={() => onCategoryPress?.('crime')} valueAccessibilityLabel={crimeUnavailable ? CRIME_UNAVAILABLE_LABEL : undefined} />
        <GridCard icon="bulb-outline" value={safetyResult.streetLights} label="Lights" color="#eab308" valueColor="#A15C07" onPress={() => onCategoryPress?.('light')} />
        <GridCard icon="videocam-outline" value={safetyResult.cctvCount} label="CCTV" color="#6366f1" valueColor="#4F46E5" onPress={() => onCategoryPress?.('cctv')} />
        <GridCard icon="storefront-outline" value={safetyResult.openPlaces} label="Open" color="#22c55e" valueColor="#15803D" onPress={() => onCategoryPress?.('shop')} />
      </View>

      {/* Detailed route stats */}
      {stats && (
        <>
          <Text style={styles.sectionLabel}>Route Details</Text>

          <View style={styles.row}>
            <DetailCard icon="car-outline" value={`${selectedSafeRoute.safety.mainRoadRatio}%`} label="Main Roads" />
            <DetailCard icon="walk-outline" value={`${stats.sidewalkPct}%`} label="Sidewalks" />
            <DetailCard icon="bus-outline" value={`${stats.transitStopsNearby}`} label="Transit" />
          </View>
          <View style={styles.row}>
            <DetailCard
              icon="close-circle-outline"
              value={`${stats.deadEnds}`}
              label="Dead Ends"
              warn={stats.deadEnds > 0}
            />
            <DetailCard
              icon="layers-outline"
              value={`${stats.unpavedPct}%`}
              label="Unpaved"
              warn={stats.unpavedPct > 0}
            />
            <DetailCard icon="people-outline" value={`${selectedSafeRoute.safety.breakdown.traffic}%`} label="Foot Traffic" />
          </View>

          {/* Road type bar rendered externally for full width */}
        </>
      )}
    </View>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function GridCard({ icon, value, label, color, valueColor, onPress, valueAccessibilityLabel }: { icon: IconName; value: number | string; label: string; color: string; /** Text colour for the value, where the accent colour is too light to read as text. */ valueColor?: string; onPress?: () => void; valueAccessibilityLabel?: string }) {
  return (
    <Pressable
      style={[styles.gridCard, { borderColor: color + '44' }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Show ${label} on map`}
    >
      <View style={[styles.gridIconWrap, { backgroundColor: color + '1A' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View>
        <Text style={[styles.gridValue, { color: valueColor ?? color }]} accessibilityLabel={valueAccessibilityLabel}>{value}</Text>
        <Text style={styles.gridLabel}>{label}</Text>
      </View>
    </Pressable>
  );
}

function DetailCard({ icon, value, label, warn }: { icon: IconName; value: string; label: string; warn?: boolean }) {
  return (
    <View style={[styles.detailCard, warn && styles.detailCardWarning]}>
      <Ionicons name={icon} size={18} color={warn ? '#c2410c' : '#1570ef'} style={styles.detailIcon} />
      <Text style={[styles.detailValue, warn && { color: '#C2410C' }]}>{value}</Text>
      <Text style={styles.detailLabel}>{label}</Text>
    </View>
  );
}

export function RoadTypeBreakdown({ roadTypes }: { roadTypes: Record<string, number> }) {
  const sorted = Object.entries(roadTypes).sort(([, a], [, b]) => b - a);
  const barColors: Record<string, string> = {
    primary: '#2563eb', secondary: '#3b82f6', tertiary: '#60a5fa',
    residential: '#93c5fd', footway: '#fbbf24', path: '#f59e0b',
    steps: '#f97316', pedestrian: '#34d399', service: '#94a3b8',
    cycleway: '#a78bfa', living_street: '#67e8f9', track: '#d97706',
    trunk: '#1d4ed8', unclassified: '#cbd5e1',
  };
  const labelMap: Record<string, string> = {
    primary: 'Main', secondary: 'Secondary', tertiary: 'Minor',
    residential: 'Residential', footway: 'Path', path: 'Path',
    steps: 'Steps', pedestrian: 'Pedestrian', service: 'Service',
    cycleway: 'Cycleway', living_street: 'Living St', track: 'Track',
    trunk: 'Highway', unclassified: 'Other',
  };

  return (
    <View style={styles.roadTypeWrap}>
      <Text style={styles.roadTypeTitle}>Road Type Breakdown</Text>
      <View style={styles.roadTypeBar}>
        {sorted.map(([type, pct]) => (
          <View key={type} style={[styles.roadTypeSeg, { flex: pct, backgroundColor: barColors[type] || '#94a3b8' }]} />
        ))}
      </View>
      <View style={styles.roadTypeLegend}>
        {sorted.slice(0, 4).map(([type, pct]) => (
          <Text key={type} style={styles.roadTypeLegendItem}>
            {labelMap[type] || type}: {pct}%
          </Text>
        ))}
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  column: {
    marginTop: 12,
    width: '100%',
  },
  columnWeb: {
    flex: 1,
    maxWidth: '50%' as any,
    marginTop: 0,
    position: 'sticky' as any,
    top: 0,
  },
  heroCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#eaecf0',
    marginBottom: 12,
    overflow: 'hidden',
  },
  heroLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
    color: '#475467',
  },
  notes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  crimeChip: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  crimeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#c2410c',
  },
  weakestLine: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridCard: {
    flexBasis: '44%' as any,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#eaecf0',
  },
  gridIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  gridLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#667085',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 8,
    marginTop: 16,
    letterSpacing: 0.3,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  detailCard: {
    flex: 1,
    minWidth: 85,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderRadius: 16,
    padding: 10,
    alignItems: 'center',
    marginHorizontal: 3,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    boxShadow: '0 4px 14px rgba(15, 23, 42, 0.08)',
  } as any,
  detailCardWarning: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
  },
  detailIcon: {
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475467',
    textAlign: 'center',
    marginTop: 1,
  },
  roadTypeWrap: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  roadTypeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  roadTypeBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  roadTypeSeg: {
    height: '100%' as any,
  },
  roadTypeLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    gap: 8,
  },
  roadTypeLegendItem: {
    flexDirection: 'row' as any,
    alignItems: 'center' as any,
    gap: 3,
  },
});
