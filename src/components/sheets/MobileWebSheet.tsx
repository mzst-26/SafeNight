/**
 * MobileWebSheet — Bottom sheet for phone-size web.
 *
 * Simplified version of DraggableSheet optimised for phone-size web:
 * - Three snap points: peek (120px), half (45%), full (85%)
 * - Drag handle at top for resizing
 * - ScrollView for content — scrolls only when sheet is at full height
 * - Uses native pointer/touch events for reliable web dragging
 * - Auto-appears when results arrive, hides when cleared
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
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

  // Drag state
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const isDragging = useRef(false);

  // Scroll state
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);

  // Whether the sheet is at full height (allow content scrolling)
  const isAtFull = currentSnap >= getSheetFull() - 10;

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

  // ── Drag handle handler using native DOM events ──
  const dragHandleRef = useRef<View>(null);

  useEffect(() => {
    const el = (dragHandleRef.current as any)?._nativeTag
      ? undefined
      : (dragHandleRef.current as any);

    // On web, View refs resolve to DOM elements
    const domEl: HTMLElement | null =
      el instanceof HTMLElement ? el : (el as any)?.getNode?.() ?? null;

    if (!domEl) return;

    let startY = 0;
    let startH = 0;
    let active = false;
    let lastTimestamp = 0;
    let lastY = 0;

    const onDown = (e: PointerEvent | TouchEvent) => {
      active = true;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      startY = clientY;
      lastY = clientY;
      startH = heightRef.current;
      lastTimestamp = Date.now();
      if ('setPointerCapture' in e.target! && 'pointerId' in e) {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
      e.preventDefault();
    };

    const onMove = (e: PointerEvent | TouchEvent) => {
      if (!active) return;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const dy = startY - clientY; // positive = dragging up
      const next = Math.min(getSheetFull(), Math.max(SHEET_PEEK, startH + dy));
      heightRef.current = next;
      animatedHeight.setValue(next);
      lastY = clientY;
      lastTimestamp = Date.now();
      e.preventDefault();
    };

    const onUp = (e: PointerEvent | TouchEvent) => {
      if (!active) return;
      active = false;
      const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : ('clientY' in e ? e.clientY : lastY);
      const dy = startY - clientY;
      const finalH = Math.min(getSheetFull(), Math.max(SHEET_PEEK, startH + dy));
      // Determine direction velocity
      const dirVelocity = dy > 30 ? -0.6 : dy < -30 ? 0.6 : 0;
      snapToNearest(finalH, dirVelocity);
    };

    domEl.addEventListener('pointerdown', onDown, { passive: false });
    domEl.addEventListener('pointermove', onMove, { passive: false });
    domEl.addEventListener('pointerup', onUp);
    domEl.addEventListener('pointercancel', onUp);
    domEl.addEventListener('touchstart', onDown, { passive: false });
    domEl.addEventListener('touchmove', onMove, { passive: false });
    domEl.addEventListener('touchend', onUp);

    return () => {
      domEl.removeEventListener('pointerdown', onDown);
      domEl.removeEventListener('pointermove', onMove);
      domEl.removeEventListener('pointerup', onUp);
      domEl.removeEventListener('pointercancel', onUp);
      domEl.removeEventListener('touchstart', onDown);
      domEl.removeEventListener('touchmove', onMove);
      domEl.removeEventListener('touchend', onUp);
    };
  }, [animatedHeight, snapToNearest]);

  // ── Scroll-edge detection → allow scroll-to-drag for the content area ──
  const contentRef = useRef<View>(null);

  useEffect(() => {
    const el = (contentRef.current as any);
    const domEl: HTMLElement | null =
      el instanceof HTMLElement ? el : (el as any)?.getNode?.() ?? null;

    if (!domEl) return;

    let startY = 0;
    let startH = 0;
    let active = false;

    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      active = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      const clientY = e.touches[0].clientY;
      const dy = startY - clientY; // positive = finger moving up

      // If at top of scroll and dragging down → resize sheet instead
      if (scrollOffset.current <= 1 && dy < -8 && !active) {
        active = true;
        startH = heightRef.current;
        startY = clientY;
      }

      if (active) {
        e.preventDefault();
        const sheetDy = startY - clientY;
        const next = Math.min(getSheetFull(), Math.max(SHEET_PEEK, startH + sheetDy));
        heightRef.current = next;
        animatedHeight.setValue(next);
      }
    };

    const onTouchEnd = () => {
      if (active) {
        active = false;
        const dirVelocity = heightRef.current < startH ? 0.6 : -0.6;
        snapToNearest(heightRef.current, dirVelocity);
      }
    };

    domEl.addEventListener('touchstart', onTouchStart, { passive: true });
    domEl.addEventListener('touchmove', onTouchMove, { passive: false });
    domEl.addEventListener('touchend', onTouchEnd);

    return () => {
      domEl.removeEventListener('touchstart', onTouchStart);
      domEl.removeEventListener('touchmove', onTouchMove);
      domEl.removeEventListener('touchend', onTouchEnd);
    };
  }, [animatedHeight, snapToNearest]);

  const handleScroll = useCallback((e: any) => {
    const { contentOffset } = e.nativeEvent;
    scrollOffset.current = contentOffset.y;
  }, []);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.sheet, { height: animatedHeight }]}>
      {/* Drag handle */}
      <View ref={dragHandleRef} style={styles.dragZone}>
        <View style={styles.handle} />
      </View>

      {/* Content */}
      <View ref={contentRef} style={styles.scrollWrap}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          scrollEnabled={isAtFull}
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
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
});
