import { memo, useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  computeClusterPlacement,
  type MapControlLayoutInput,
} from '@/src/components/ui/mapControlLayout';

type ControlNodeRenderer = ReactNode | ((input: { compressed: boolean }) => ReactNode);

export interface MapControlRailProps {
  layoutInput: MapControlLayoutInput;
  profileControl: ControlNodeRenderer;
  safetyCircleControl: ControlNodeRenderer;
  liveLocationControl?: ControlNodeRenderer;
  reportControl: ControlNodeRenderer;
  currentLocationControl: ControlNodeRenderer;
  showLiveLocationWhenCompressed?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function resolveControlNode(
  control: ControlNodeRenderer | undefined,
  compressed: boolean,
): ReactNode {
  if (!control) {
    return null;
  }

  if (typeof control === 'function') {
    return control({ compressed });
  }

  return control;
}

function renderControlStack(
  controls: ReactNode[],
  gap: number,
  compressed: boolean,
): ReactNode[] {
  return controls
    .filter((control) => control != null)
    .map((control, index) => (
      <View
        key={`control-${index}`}
        style={[
          styles.controlItem,
          index > 0 ? { marginTop: gap } : null,
          compressed ? styles.controlItemCompressed : null,
        ]}
      >
        {control}
      </View>
    ));
}

function MapControlRailComponent({
  layoutInput,
  profileControl,
  safetyCircleControl,
  liveLocationControl,
  reportControl,
  currentLocationControl,
  showLiveLocationWhenCompressed = false,
  style,
  testID,
}: MapControlRailProps) {
  const placement = useMemo(() => computeClusterPlacement(layoutInput), [layoutInput]);
  const compressed = placement.utility.collapsed;

  const utilityControls = useMemo(() => {
    const controls: ReactNode[] = [
      resolveControlNode(profileControl, compressed),
      resolveControlNode(safetyCircleControl, compressed),
    ];

    if (!compressed || showLiveLocationWhenCompressed) {
      controls.push(resolveControlNode(liveLocationControl, compressed));
    }

    return controls.slice(0, placement.utility.visibleControlCount);
  }, [
    compressed,
    placement.utility.visibleControlCount,
    profileControl,
    safetyCircleControl,
    liveLocationControl,
    showLiveLocationWhenCompressed,
  ]);

  const actionControls = useMemo(
    () => [resolveControlNode(reportControl, compressed), resolveControlNode(currentLocationControl, compressed)],
    [reportControl, currentLocationControl, compressed],
  );

  return (
    <View pointerEvents="box-none" style={[styles.root, style]} testID={testID}>
      <View
        pointerEvents="box-none"
        style={[
          styles.cluster,
          styles.utilityCluster,
          {
            top: placement.utility.top,
          },
          compressed ? styles.clusterCompressed : null,
        ]}
      >
        {renderControlStack(utilityControls, placement.utility.controlGap, compressed)}
      </View>

      <View
        pointerEvents="box-none"
        style={[
          styles.cluster,
          styles.actionCluster,
          {
            top: placement.action.top,
          },
        ]}
      >
        {renderControlStack(actionControls, placement.action.controlGap, false)}
      </View>
    </View>
  );
}

export const MapControlRail = memo(MapControlRailComponent);

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 12,
    width: 56,
    zIndex: 100,
    alignItems: 'flex-end',
  },
  cluster: {
    position: 'absolute',
    right: 0,
    alignItems: 'center',
  },
  utilityCluster: {
    zIndex: 110,
  },
  actionCluster: {
    zIndex: 100,
  },
  clusterCompressed: {
    transform: [{ scale: 0.96 }],
  },
  controlItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlItemCompressed: {
    opacity: 0.98,
  },
});
