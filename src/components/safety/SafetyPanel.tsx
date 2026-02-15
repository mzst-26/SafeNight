/**
 * SafetyPanel — Hero score + 2×2 grid + detailed breakdown cards.
 */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { CircleProgress } from '@/src/components/ui/CircleProgress';
import type { SafeRoute } from '@/src/services/safeRoutes';
import type { SafetyMapResult } from '@/src/services/safetyMapData';

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

  return (
    <View style={[styles.column, Platform.OS === 'web' && !inSidebar && styles.columnWeb]}>
      {/* Hero Score */}
      <View style={[styles.heroCard, { borderColor: safetyResult.safetyColor + '44' }]}>
        <CircleProgress
          size={Platform.OS === 'web' ? 64 : 52}
          strokeWidth={5}
          progress={safetyResult.safetyScore}
          color={safetyResult.safetyColor}
        />
        <Text style={[styles.heroLabel, { color: safetyResult.safetyColor }]}>
          {safetyResult.safetyLabel}
        </Text>
      </View>

      {/* 2×2 grid */}
      <View style={styles.grid}>
        <GridCard emoji="🔴" value={safetyResult.crimeCount} label="Crimes" color="#ef4444" onPress={() => onCategoryPress?.('crime')} />
        <GridCard emoji="💡" value={safetyResult.streetLights} label="Lights" color="#eab308" onPress={() => onCategoryPress?.('light')} />
        <GridCard emoji="📷" value={safetyResult.cctvCount} label="CCTV" color="#6366f1" onPress={() => onCategoryPress?.('cctv')} />
        <GridCard emoji="🏪" value={safetyResult.openPlaces} label="Open" color="#22c55e" onPress={() => onCategoryPress?.('shop')} />
      </View>

      {/* Detailed route stats */}
      {stats && (
        <>
          <Text style={styles.sectionLabel}>Route Details</Text>

          <View style={styles.row}>
            <DetailCard icon="🛣️" value={`${selectedSafeRoute.safety.mainRoadRatio}%`} label="Main Roads" />
            <DetailCard icon="🚶" value={`${stats.sidewalkPct}%`} label="Sidewalks" />
            <DetailCard icon="🚏" value={`${stats.transitStopsNearby}`} label="Transit" />
          </View>
          <View style={styles.row}>
            <DetailCard
              icon="⛔"
              value={`${stats.deadEnds}`}
              label="Dead Ends"
              warn={stats.deadEnds > 0}
            />
            <DetailCard
              icon="🪨"
              value={`${stats.unpavedPct}%`}
              label="Unpaved"
              warn={stats.unpavedPct > 0}
            />
            <DetailCard icon="👣" value={`${selectedSafeRoute.safety.breakdown.traffic}%`} label="Foot Traffic" />
          </View>

          {/* Road type bar rendered externally for full width */}
        </>
      )}
    </View>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function GridCard({ emoji, value, label, color, onPress }: { emoji: string; value: number; label: string; color: string; onPress?: () => void }) {
  return (
    <Pressable
      style={[styles.gridCard, { borderColor: color + '44' }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Show ${label} on map`}
    >
      <Text style={[styles.gridIcon, { color }]}>{emoji}</Text>
      <View>
        <Text style={[styles.gridValue, { color }]}>{value}</Text>
        <Text style={styles.gridLabel}>{label}</Text>
      </View>
    </Pressable>
  );
}

function DetailCard({ icon, value, label, warn }: { icon: string; value: string; label: string; warn?: boolean }) {
  return (
    <View style={[styles.detailCard, warn && styles.detailCardWarning]}>
      <Text style={styles.detailIcon}>{icon}</Text>
      <Text style={[styles.detailValue, warn && { color: '#f97316' }]}>{value}</Text>
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
  gridIcon: {
    fontSize: 20,
  },
  gridValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  gridLabel: {
    fontSize: 11,
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
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    marginHorizontal: 3,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  detailCardWarning: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
  },
  detailIcon: {
    fontSize: 18,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
  },
  detailLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#64748b',
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
    fontSize: 11,
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
