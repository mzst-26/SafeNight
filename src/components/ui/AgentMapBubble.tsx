/**
 * AgentMapBubble — a small glass bubble that shows the agent's own map of the routes it is
 * checking. It is separate from the walker's main map and never changes it.
 *
 * The map inside is a RouteMap instance with instanceId "agent". The status line under the map
 * says what the agent is doing right now. The bubble has no buttons.
 */
import { StyleSheet, Text, View } from 'react-native';

import RouteMap from '@/src/components/maps/RouteMap';
import { glassSurface } from '@/src/components/ui/glass';
import type { DirectionsRoute, LatLng } from '@/src/types/geo';

export const AGENT_BUBBLE_SIZE = 180;

const DEFAULT_STATUS = 'Checking the map';
const INK_MUTED = '#475467';
const MAP_BACKGROUND = '#e9eef5';

export interface AgentMapBubbleProps {
  origin: LatLng | null;
  destination: LatLng | null;
  routes: DirectionsRoute[];
  selectedRouteId: string | null;
  /** One line of text under the map, e.g. "Checking the map". */
  status?: string;
}

export function AgentMapBubble({
  origin,
  destination,
  routes,
  selectedRouteId,
  status = DEFAULT_STATUS,
}: AgentMapBubbleProps) {
  return (
    <View style={styles.bubble}>
      <View style={styles.mapFrame}>
        <RouteMap
          instanceId="agent"
          origin={origin}
          destination={destination}
          routes={routes}
          selectedRouteId={selectedRouteId}
          showZoomControls={false}
          showExtraDetail={false}
        />
      </View>
      <Text style={styles.status} numberOfLines={1} accessibilityLiveRegion="polite">
        {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    width: AGENT_BUBBLE_SIZE,
    height: AGENT_BUBBLE_SIZE,
    borderRadius: 28,
    overflow: 'hidden',
    padding: 8,
    gap: 6,
    ...glassSurface,
  },
  mapFrame: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: MAP_BACKGROUND,
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    color: INK_MUTED,
    textAlign: 'center',
  },
});
