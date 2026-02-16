/**
 * MobileWebSheet — Bottom sheet for phone-size web.
 *
 * Simplified version of DraggableSheet optimised for phone-size web:
 * - Three snap points: peek (120px), half (45%), full (85%)
 * - Drag handle at top for resizing (uses PanResponder for reliability)
 * - ScrollView for content — always scrollable
 * - Auto-appears when results arrive, hides when cleared
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const animatedHeight = useRef(new Animated.Value(SHEET_PEEK)).current;
  const heightRef = useRef(SHEET_PEEK);
  const [currentSnap, setCurrentSnap] = useState(SHEET_PEEK);

  // Scroll state
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const isAtTopRef = useRef(true);

  const snapTo = useCallback((target: number) => {
    heightRef.current = target;
    setCurrentSnap(target);
    Animated.spring(animatedHeight, {
      toValue: target,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  }, [animatedHeight]);

  const snapToNearest = useCallback((current: number, velocity: number) => {
    const half = getSheetHalf();
    const full = getSheetFull();

    if (velocity > 0.5) {
      snapTo(SHEET_PEEK);
    } else if (velocity < -0.5) {
      snapTo(full);
    } else {
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
  useEffect(() => {
    if (visible && !prevVisible.current) {
      prevVisible.current = true;
      requestAnimationFrame(() => snapTo(getSheetHalf()));
    }
    if (!visible && prevVisible.current) {
      prevVisible.current = false;
    }
  }, [visible, snapTo]);

  // ── Drag handle — PanResponder (reliable on all platforms including web) ──
  const handlePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        animatedHeight.stopAnimation((v: number) => {
          heightRef.current = v;
        });
      },
      onPanResponderMove: (_, g) => {
        const next = Math.min(
          getSheetFull(),
          Math.max(SHEET_PEEK, heightRef.current - g.dy),
        );
        animatedHeight.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const current = heightRef.current - g.dy;
        snapToNearest(current, g.vy);
      },
    }),
  ).current;

  // ── Body pan — captures only when scrolled to top and swiping down ──
  const bodyPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        if (Math.abs(g.dy) < 4) return false;
        // Only capture if swiping down while at top of scroll
        if (g.dy > 0 && isAtTopRef.current) return true;
        return false;
      },
      onPanResponderGrant: () => {
        animatedHeight.stopAnimation((v: number) => {
          heightRef.current = v;
        });
      },
      onPanResponderMove: (_, g) => {
        const next = Math.min(
          getSheetFull(),
          Math.max(SHEET_PEEK, heightRef.current - g.dy),
        );
        animatedHeight.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const current = heightRef.current - g.dy;
        snapToNearest(current, g.vy);
      },
    }),
  ).current;

  const handleScroll = useCallback((e: any) => {
    const { contentOffset } = e.nativeEvent;
    scrollOffset.current = contentOffset.y;
    isAtTopRef.current = contentOffset.y <= 1;
  }, []);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.sheet, { height: animatedHeight }]}>
      {/* Drag handle */}
      <View {...handlePanResponder.panHandlers} style={styles.dragZone}>
        <View style={styles.handle} />
      </View>

      {/* Content */}
      <View style={styles.scrollWrap}>
        <ScrollView
          {...bodyPanResponder.panHandlers}
          ref={scrollRef}
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
      </View>
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
    touchAction: 'none',
  } as any,
  dragZone: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 10,
    cursor: 'grab',
    touchAction: 'none',
  } as any,
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d0d5dd',
  },
  scrollWrap: {
    flex: 1,
    touchAction: 'pan-y',
  } as any,
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
});
