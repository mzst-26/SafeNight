/**
 * RouteList — Displays the list of route cards + start navigation button.
 */
import { Platform, StyleSheet, Text, View } from 'react-native';

import { RouteCard } from '@/src/components/routes/RouteCard';
import type { SafeRoute } from '@/src/services/safeRoutes';
import type { RouteComparison } from '@/src/utils/routeComparison';

const MAX_VISIBLE_ROUTES = 5;

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
  const hiddenCount = Math.max(0, routes.length - MAX_VISIBLE_ROUTES);
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
      {updatingLabel ? (
        // Stale cards are not tappable while the chosen time is still loading.
        <Text style={styles.waiting}>
          {`Waiting for routes for ${updatingLabel.replace(/^Updating for /, '')}`}
        </Text>
      ) : (
        <>
          {routes.slice(0, MAX_VISIBLE_ROUTES).map((route, index) => (
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
          {hiddenCount > 0 ? (
            <Text style={styles.overflow}>{`+${hiddenCount} more routes not shown`}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: '100%',
  },
  dimmed: { opacity: 0.55 },
  updating: { fontSize: 13, fontWeight: '600', color: '#475467', paddingBottom: 6 },
  waiting: { fontSize: 14, color: '#475467', paddingVertical: 12 },
  overflow: { fontSize: 13, color: '#475467', paddingTop: 8, textAlign: 'center' },
  columnWeb: {
    flex: 1,
    maxWidth: '50%' as any,
  },
});
