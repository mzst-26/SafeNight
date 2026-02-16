/**
 * MobileWebSheet — Bottom sheet for phone-size web.
 *
 * Simplified version of DraggableSheet optimised for phone-size web:
 * - Three snap points: peek (110px), half (45%), full (85%)
 * - Drag handle at top
 * - Auto-appears when results arrive, hides when cleared
 * - On web, uses mouse events for dragging (PanResponder is fine on DOM)
 */
import { useCallback, useRef } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

function getScreenHeight() {
  return Dimensions.get('window').height;
}

const SHEET_PEEK = 120;
const SHEET_HALF_RATIO = 0.45;
const SHEET_FULL_RATIO = 0.85;

function getSheetHalf() { return getScreenHeight() * SHEET_HALF_RATIO; }
function getSheetFull() { return getScreenHeight() * SHEET_FULL_RATIO; }

interface MobileWebSheetProps {
  children: React.ReactNode;
  visible: boolean;
}

export function MobileWebSheet({ children, visible }: MobileWebSheetProps) {
  const height = useRef(new Animated.Value(SHEET_PEEK)).current;
  const heightRef = useRef(SHEET_PEEK);

  const snapTo = useCallback((target: number) => {
    heightRef.current = target;
    Animated.spring(height, {
      toValue: target,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  }, [height]);

  const snap = useCallback((current: number, vy: number) => {
    const half = getSheetHalf();
    const full = getSheetFull();

    if (vy > 0.6) {
      // Flung down → peek or hide
      snapTo(SHEET_PEEK);
    } else if (vy < -0.6) {
      // Flung up → full
      snapTo(full);
    } else {
      // Snap to nearest
      const dPeek = Math.abs(current - SHEET_PEEK);
      const dHalf = Math.abs(current - half);
      const dFull = Math.abs(current - full);
      const min = Math.min(dPeek, dHalf, dFull);
      if (min === dPeek) snapTo(SHEET_PEEK);
      else if (min === dHalf) snapTo(half);
      else snapTo(full);
    }
  }, [snapTo]);

  // Auto-snap to half when sheet becomes visible
  const prevVisible = useRef(false);
  if (visible && !prevVisible.current) {
    prevVisible.current = true;
    requestAnimationFrame(() => snapTo(getSheetHalf()));
  }
  if (!visible && prevVisible.current) {
    prevVisible.current = false;
  }

  // Drag handle pan
  const handlePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        height.stopAnimation((v: number) => { heightRef.current = v; });
      },
      onPanResponderMove: (_, g) => {
        const next = Math.min(getSheetFull(), Math.max(SHEET_PEEK, heightRef.current - g.dy));
        height.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        snap(heightRef.current - g.dy, g.vy);
      },
    }),
  ).current;

  // Body scroll edges → drag
  const isAtTop = useRef(true);
  const isAtBottom = useRef(false);

  const bodyPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        if (Math.abs(g.dy) < 4) return false;
        if (g.dy < 0 && isAtBottom.current) return true;
        if (g.dy > 0 && isAtTop.current) return true;
        return false;
      },
      onPanResponderGrant: () => {
        height.stopAnimation((v: number) => { heightRef.current = v; });
      },
      onPanResponderMove: (_, g) => {
        const next = Math.min(getSheetFull(), Math.max(SHEET_PEEK, heightRef.current - g.dy));
        height.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        snap(heightRef.current - g.dy, g.vy);
      },
    }),
  ).current;

  const handleScroll = (e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    isAtTop.current = contentOffset.y <= 1;
    isAtBottom.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 1;
  };

  if (!visible) return null;

  return (
    <Animated.View style={[styles.sheet, { height }]}>
      {/* Drag handle */}
      <View {...handlePan.panHandlers} style={styles.dragZone}>
        <View style={styles.handle} />
      </View>

      {/* Content */}
      <ScrollView
        {...bodyPan.panHandlers}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        bounces={false}
        keyboardShouldPersistTaps="always"
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    boxShadow: '0 -4px 16px rgba(0,0,0,0.15)',
    zIndex: 40,
    overflow: 'hidden',
    userSelect: 'none',
    cursor: 'default',
  } as any,
  dragZone: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
    cursor: 'grab',
  } as any,
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d0d5dd',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
});
