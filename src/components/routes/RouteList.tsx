/**
 * RouteList — Displays the list of route cards + start navigation button.
 */
import { Platform, StyleSheet, View } from 'react-native';

import { RouteCard } from '@/src/components/routes/RouteCard';
import type { SafeRoute } from '@/src/services/safeRoutes';

interface RouteListProps {
  routes: SafeRoute[];
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  /** When true, skip the side-by-side web layout (used inside WebSidebar) */
  inSidebar?: boolean;
  /** Node rendered inside the selected card's collapsible safety section */
  detailsPanel?: React.ReactNode;
}

export function RouteList({
  routes,
  selectedRouteId,
  onSelectRoute,
  inSidebar,
  detailsPanel,
}: RouteListProps) {
  return (
    <View style={[styles.column, Platform.OS === 'web' && !inSidebar && styles.columnWeb]}>
      {routes.slice(0, 5).map((route, index) => (
        <RouteCard
          key={route.id}
          route={route}
          index={index}
          isSelected={route.id === selectedRouteId}
          onSelect={() => onSelectRoute(route.id)}
          detailsPanel={route.id === selectedRouteId ? detailsPanel : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: '100%',
  },
  columnWeb: {
    flex: 1,
    maxWidth: '50%' as any,
  },
});
