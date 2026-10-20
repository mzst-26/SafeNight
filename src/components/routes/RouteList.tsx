/**
 * RouteList — Displays the list of route cards + start navigation button.
 */
import { Platform, StyleSheet, Text, View } from 'react-native';

import { RouteCard } from '@/src/components/routes/RouteCard';
import type { SafeRoute } from '@/src/services/safeRoutes';
import type { RouteComparison } from '@/src/utils/routeComparison';

interface RouteListProps {
  routes: SafeRoute[];
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  /** When true, skip the side-by-side web layout (used inside WebSidebar) */
  inSidebar?: boolean;
  /** Node rendered inside the selected card's collapsible safety section */
  detailsPanel?: React.ReactNode;
  /** Per-route comparison rows (buildRouteComparison). Drives the v2 delta lines. */
  routeComparison?: RouteComparison[];
  /** 'Updating for 17:10' while shown routes lag behind the chosen time; cards are dimmed lightly. */
  updatingLabel?: string | null;
  /** Hide the safety score, chips and details on every card (during navigation). Default false. */
  hideSafety?: boolean;
}

export function RouteList({
  routes,
  selectedRouteId,
  onSelectRoute,
  inSidebar,
  detailsPanel,
  routeComparison,
  updatingLabel,
  hideSafety = false,
}: RouteListProps) {
  const recommendedId = routes.find((r) => r.isSafest)?.id;
  const recommendedComparison =
    routeComparison?.find((c) => c.routeId === recommendedId) ?? null;

  return (
    <View
      style={[
        styles.column,
        Platform.OS === 'web' && !inSidebar && styles.columnWeb,
        updatingLabel ? styles.dimmed : null,
      ]}
    >
      {updatingLabel ? (
        <Text style={styles.updating} accessibilityLiveRegion="polite">
          {updatingLabel}
        </Text>
      ) : null}
      {routes.slice(0, 5).map((route, index) => (
        <RouteCard
          key={route.id}
          route={route}
          index={index}
          isSelected={route.id === selectedRouteId}
          onSelect={() => onSelectRoute(route.id)}
          detailsPanel={route.id === selectedRouteId && !hideSafety ? detailsPanel : undefined}
          comparison={routeComparison?.find((c) => c.routeId === route.id) ?? null}
          recommendedComparison={recommendedComparison}
          hideSafety={hideSafety}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: '100%',
  },
  dimmed: { opacity: 0.55 },
  updating: { fontSize: 13, fontWeight: '600', color: '#475467', paddingBottom: 6 },
  columnWeb: {
    flex: 1,
    maxWidth: '50%' as any,
  },
});
