import AsyncStorage from '@react-native-async-storage/async-storage';
import { MAP_GLASS_BUTTON_SIZE, MapGlassButton } from '@/src/components/ui/MapGlassButton';
import { nativeDockItems } from '@/src/components/ui/nativeDockMenu';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  PanResponder,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius } from '@/src/theme';
import {
  computeClusterPlacement,
  type MapControlLayoutInput,
} from '@/src/components/ui/mapControlLayout';

type ControlNodeRenderer = ReactNode | ((input: { compressed: boolean }) => ReactNode);

const PRIORITY_KEYS = ['profile', 'safety', 'live', 'report', 'currentLocation'] as const;

export interface MapControlRailProps {
  layoutInput: MapControlLayoutInput;
  /** Native: collapse the dock to current location and a menu button. Off during navigation. */
  menuCollapsible?: boolean;
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

/** Where the web dock was last dropped. Stored per browser (localStorage). */
// v2: positions saved by v1 are ignored, so everyone starts at the new default (right, mid-height).
const DOCK_POSITION_KEY = 'safenight.mapDock.position.v2';
const DOCK_THICKNESS = 56; // width of a vertical dock, height of a horizontal one
const DOCK_CHROME = 32; // padding + grip + gap, along the dock's length
const DOCK_ITEM_GAP = 12;
const DOCK_EDGE = 8; // minimum distance from the viewport edge

const DRAG_TAP_SLOP_PX = 4; // movement below this is a tap, not a drag
const DRAG_RESIST = 0.35; // share of an edge overshoot that the dock still follows
const FLICK_SPEED_PX_MS = 0.9; // release faster than this carries the dock on
const MAX_FLICK_SPEED_PX_MS = 2.5; // flick speed beyond this counts as this speed
const FLICK_PROJECTION_MS = 180; // how far ahead a flick carries the dock
const VELOCITY_WINDOW_MS = 100; // only recent movement decides flick speed
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const LIFT_TRANSITION = 'transform 180ms ease, box-shadow 180ms ease';
/** While held: the dock rises with a deeper shadow. Against an edge: an accent ring. */
const DOCK_LIFT_SHADOW = '0 18px 44px rgba(15, 23, 42, 0.22)';
const DOCK_EDGE_SHADOW =
  '0 0 0 3px rgba(21, 112, 239, 0.35), 0 18px 44px rgba(21, 112, 239, 0.25)';

type DockPos = { x: number; y: number };
/** A saved dock: where it was left and which layout it had there. */
type SavedDock = DockPos & { o?: DockOrientation };
type DockPhase = 'idle' | 'dragging' | 'edge';
type DockOrientation = 'vertical' | 'horizontal';
type DockSize = { w: number; h: number };

function clampRange(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/** Lets the dock follow past an edge at reduced strength instead of stopping dead. */
function resistRange(v: number, min: number, max: number): number {
  if (v < min) return min - (min - v) * DRAG_RESIST;
  if (v > max) return max + (v - max) * DRAG_RESIST;
  return v;
}

function sizeOf(o: DockOrientation, len: number): DockSize {
  return o === 'vertical' ? { w: DOCK_THICKNESS, h: len } : { w: len, h: DOCK_THICKNESS };
}

/** Keeps the whole dock inside the viewport. */
function clampToViewport(p: DockPos, vw: number, vh: number, size: DockSize): DockPos {
  return {
    x: clampRange(p.x, DOCK_EDGE, Math.max(DOCK_EDGE, vw - size.w - DOCK_EDGE)),
    y: clampRange(p.y, DOCK_EDGE, Math.max(DOCK_EDGE, vh - size.h - DOCK_EDGE)),
  };
}

/**
 * When the dock turns horizontal. It only turns horizontal inside the top or bottom
 * band, and only when that band is clearly closer than the side edges (the HYST
 * margin). Once horizontal it stays so until it leaves the band, so near a corner
 * it does not flicker between layouts.
 */
const ORIENT_ENTER_BAND = 64; // px from the top or bottom edge to turn horizontal
const ORIENT_LEAVE_BAND = 96; // px from the top or bottom edge before turning back
const ORIENT_HYSTERESIS = 24; // px margin against the side edges

function decideOrientation(
  p: DockPos,
  vw: number,
  vh: number,
  len: number,
  prev: DockOrientation,
): DockOrientation {
  // Use the footprint the dock currently has, so distances to the far edges are right.
  // Each layout is judged with its own footprint, so the answer for a given pointer
  // position does not depend on which layout the dock is currently in.
  const horizontalSize = { w: len, h: DOCK_THICKNESS };
  const verticalSize = { w: DOCK_THICKNESS, h: len };
  const asHorizontal = clampToViewport(p, vw, vh, horizontalSize);
  const asVertical = clampToViewport(p, vw, vh, verticalSize);
  // Distance from the top/bottom edge if horizontal, and from the left/right edge if vertical.
  const topBottom = Math.min(asHorizontal.y, vh - (asHorizontal.y + horizontalSize.h));
  const leftRight = Math.min(asVertical.x, vw - (asVertical.x + verticalSize.w));
  if (prev === 'horizontal') {
    // Stay horizontal inside the dead zone; leave only when clearly away from the edge.
    return topBottom > ORIENT_LEAVE_BAND || leftRight + ORIENT_HYSTERESIS < topBottom
      ? 'vertical'
      : 'horizontal';
  }
  return topBottom <= ORIENT_ENTER_BAND && topBottom + ORIENT_HYSTERESIS < leftRight
    ? 'horizontal'
    : 'vertical';
}

/** Places a dock: picks its orientation, keeps it inside the viewport, and re-checks once. */
function fitDock(
  p: DockPos,
  vw: number,
  vh: number,
  len: number,
  prev: DockOrientation,
): { pos: DockPos; o: DockOrientation; size: DockSize } {
  let o = decideOrientation(p, vw, vh, len, prev);
  let size = sizeOf(o, len);
  let pos = clampToViewport(p, vw, vh, size);
  const settled = decideOrientation(pos, vw, vh, len, o);
  if (settled !== o) {
    o = settled;
    size = sizeOf(o, len);
    pos = clampToViewport(pos, vw, vh, size);
  }
  return { pos, o, size };
}

/** Layout values for an orientation. Numbers are pixels; the DOM copy adds the unit. */
function orientationStyle(o: DockOrientation) {
  return o === 'vertical'
    ? { flexDirection: 'column' as const, paddingTop: 8, paddingBottom: 8, paddingLeft: 4, paddingRight: 4 }
    : { flexDirection: 'row' as const, paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8 };
}

function handleStyle(o: DockOrientation) {
  return o === 'vertical' ? { width: 28, height: 4 } : { width: 4, height: 28 };
}

/** Converts numeric layout values to CSS strings for direct DOM updates. */
function toDomStyle(values: Record<string, string | number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(values)) {
    const v = values[key];
    out[key] = typeof v === 'number' ? `${v}px` : String(v);
  }
  return out;
}

function savePosition(p: SavedDock) {
  try {
    localStorage.setItem(DOCK_POSITION_KEY, JSON.stringify(p));
  } catch {
    // Keep working for this session even if storage is unavailable.
  }
}

const NATIVE_DOCK_KEY = 'safenight.mapDock.position.native.v2';
const NATIVE_DOCK_GAP = 12;

/**
 * Native (Android and iOS) map dock: the same single glass container and the same drag
 * rules as the web dock. Drag it anywhere on the map. It resists past an edge, carries on
 * briefly after a fast flick, turns horizontal near the top or bottom edge, and remembers
 * where it was left. Taps still reach the buttons; only a real drag takes the gesture.
 * It starts above the bottom sheet, so the buttons sit higher than before.
 */
function NativeDraggableDock({
  items,
  controlsHeight,
}: {
  items: ReactNode[];
  controlsHeight: number;
}) {
  const { width: vw, height: vh } = useWindowDimensions();
  const len = controlsHeight + DOCK_CHROME;
  const [saved, setSaved] = useState<SavedDock | null>(null);
  // Default: right side of the screen, vertically centred.
  const defaultPos: DockPos = {
    x: vw - 12 - DOCK_THICKNESS,
    y: Math.round((vh - len) / 2),
  };
  const resting = fitDock(saved ?? defaultPos, vw, vh, len, saved?.o ?? 'vertical');
  // Set only while a gesture is running or the dock is settling after a release.
  const [live, setLive] = useState<{ pos: DockPos; o: DockOrientation } | null>(null);
  const shown = live ?? resting;
  const anim = useRef(new Animated.ValueXY(resting.pos)).current;
  const liveRef = useRef({ vw, vh, len, resting });
  liveRef.current = { vw, vh, len, resting };
  const gestureRef = useRef<{ origin: DockPos; pos: DockPos; o: DockOrientation } | null>(null);

  // Load the remembered position once.
  useEffect(() => {
    AsyncStorage.getItem(NATIVE_DOCK_KEY)
      .then((raw) => {
        if (!raw) return;
        const p = JSON.parse(raw);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') setSaved(p);
      })
      .catch(() => {
        // Storage can be unavailable; the default position still works.
      });
  }, []);

  // Follow the resting place (new viewport size, loaded position) while no gesture runs.
  useEffect(() => {
    if (!gestureRef.current) anim.setValue(resting.pos);
  }, [anim, resting.pos.x, resting.pos.y]);

  const panResponder = useMemo(() => {
    const endDrag = (g: { vx: number; vy: number }) => {
        const session = gestureRef.current;
        if (!session) return;
        const { vw: w, vh: h, len: l } = liveRef.current;
        // A fast flick carries the dock on briefly, as on web.
        const speed = Math.hypot(g.vx, g.vy);
        let target: DockPos = { x: session.pos.x, y: session.pos.y };
        if (speed > FLICK_SPEED_PX_MS) {
          const scale = Math.min(speed, MAX_FLICK_SPEED_PX_MS) / speed;
          target = {
            x: target.x + g.vx * scale * FLICK_PROJECTION_MS,
            y: target.y + g.vy * scale * FLICK_PROJECTION_MS,
          };
        }
        const final = fitDock(target, w, h, l, session.o);
        const next: SavedDock = { x: final.pos.x, y: final.pos.y, o: final.o };
        setSaved(next);
        AsyncStorage.setItem(NATIVE_DOCK_KEY, JSON.stringify(next)).catch(() => {});
        Animated.spring(anim, { toValue: final.pos, useNativeDriver: false, bounciness: 6, speed: 16 }).start(() => {
          gestureRef.current = null;
          setLive(null);
        });
        setLive({ pos: final.pos, o: final.o });
    
    };

    return PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => Math.hypot(g.dx, g.dy) > DRAG_TAP_SLOP_PX,
        onMoveShouldSetPanResponder: (_, g) => Math.hypot(g.dx, g.dy) > DRAG_TAP_SLOP_PX,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const r = liveRef.current.resting;
          const session = { origin: { x: r.pos.x, y: r.pos.y }, pos: r.pos, o: r.o };
          gestureRef.current = session;
          setLive({ pos: session.pos, o: session.o });
        },
        onPanResponderMove: (_, g) => {
          const session = gestureRef.current;
          if (!session) return;
          const { vw: w, vh: h, len: l } = liveRef.current;
          const raw = { x: session.origin.x + g.dx, y: session.origin.y + g.dy };
          const o = decideOrientation(raw, w, h, l, session.o);
          const size = sizeOf(o, l);
          const pos = {
            x: resistRange(raw.x, DOCK_EDGE, w - size.w - DOCK_EDGE),
            y: resistRange(raw.y, DOCK_EDGE, h - size.h - DOCK_EDGE),
          };
          anim.setValue(pos);
          const changed = o !== session.o;
          session.pos = pos;
          session.o = o;
          if (changed) setLive({ pos, o });
        },
        onPanResponderRelease: (_, g) => endDrag(g),
        onPanResponderTerminate: (_, g) => endDrag(g),
      });
  }, [anim]);

  const gap = shown.o === 'vertical' ? { marginTop: NATIVE_DOCK_GAP } : { marginLeft: NATIVE_DOCK_GAP };
  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.nativeDock,
        orientationStyle(shown.o),
        { width: shown.o === 'vertical' ? DOCK_THICKNESS : len, height: shown.o === 'vertical' ? len : DOCK_THICKNESS },
        { left: anim.x, top: anim.y },
        live ? styles.nativeDockLifted : null,
      ]}
    >
      <View style={[styles.dockHandle, handleStyle(shown.o)]} />
      {items.map((item, index) => (
        <View key={`dock-item-${index}`} style={[styles.controlItem, index > 0 ? gap : null]}>
          {item}
        </View>
      ))}
    </Animated.View>
  );
}

/**
 * Native map dock controls. Collapsed (before navigation) it shows current location and a menu
 * button. Tapping the menu expands it; tapping the screen outside the container collapses it.
 */
export function NativeDockMenu({
  collapsible,
  current,
  hidden,
  all,
}: {
  collapsible: boolean;
  current: ReactNode | null;
  hidden: ReactNode[];
  all: ReactNode[];
}) {
  const [open, setOpen] = useState(false);
  // Navigation hides the menu. Close it then, so a stale open menu cannot leave its backdrop over the screen.
  useEffect(() => {
    if (!collapsible) setOpen(false);
  }, [collapsible]);
  const menu = (
    <MapGlassButton
      key="dock-menu"
      icon="menu"
      label={open ? 'Close map menu' : 'Open map menu'}
      toggle
      active={open}
      onPress={() => setOpen((v) => !v)}
    />
  );
  const items = nativeDockItems<ReactNode>({ collapsible, expanded: open, current, menu, hidden, all });
  const count = items.length;
  const controlsHeight = count > 0 ? count * MAP_GLASS_BUTTON_SIZE + (count - 1) * NATIVE_DOCK_GAP : 0;
  return (
    <>
      {collapsible && open ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close map menu"
          onPress={() => setOpen(false)}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <NativeDraggableDock items={items} controlsHeight={controlsHeight} />
    </>
  );
}

/**
 * One frosted container for the whole map dock. Drag it anywhere on the map.
 *
 * Web drag model: pointer events go to the dock element with pointer capture,
 * so the drag keeps following when the pointer leaves the dock, the map, or the
 * browser window. Position and layout follow the pointer directly while held:
 * horizontal near the top or bottom edge, vertical near the left or right edge.
 * Past a viewport edge the dock resists, and on release a fast flick carries on
 * briefly while anything outside the viewport eases back in. The position is
 * saved on release.
 */
function DraggableDock({
  children,
  controlsHeight,
}: {
  children: ReactNode;
  controlsHeight: number;
}) {
  const { width: viewportW, height: viewportH } = useWindowDimensions();
  const len = controlsHeight + DOCK_CHROME;
  const [saved, setSaved] = useState<SavedDock | null>(null);
  const dockRef = useRef<any>(null);

  // Default: right side of the screen, vertically centred.
  const placed = fitDock(
    saved ?? { x: viewportW - 12 - DOCK_THICKNESS, y: Math.round((viewportH - len) / 2) },
    viewportW,
    viewportH,
    len,
    saved?.o ?? 'vertical',
  );

  // The DOM listeners below are attached once; they read the latest values from here.
  const liveRef = useRef({ len, o: placed.o });
  liveRef.current = { len, o: placed.o };

  // Load the remembered position once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DOCK_POSITION_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') setSaved(p);
      }
    } catch {
      // Storage can be blocked (private mode); the default position still works.
    }
  }, []);

  // Pointer handling on the dock element itself (web only).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = dockRef.current as HTMLElement | null;
    if (!node) return;

    type Sample = { t: number; x: number; y: number };
    type Session = {
      id: number;
      held: boolean; // the press itself reported a held button
      sx: number;
      sy: number;
      ox: number;
      oy: number;
      x: number;
      y: number;
      moved: boolean;
      captured: boolean;
      samples: Sample[];
    };

    let session: Session | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let suppressClick = false;
    let lastPhase: DockPhase = 'idle';
    let domOrientation: DockOrientation | null = null;

    // Visual states are applied straight to the element. A React re-render during a
    // drag would re-apply the saved left/top and undo the move.
    const setPhaseOnce = (p: DockPhase) => {
      if (p === lastPhase) return;
      lastPhase = p;
      node.style.transform = p === 'idle' ? '' : 'scale(1.04)';
      node.style.boxShadow =
        p === 'idle' ? '' : p === 'edge' ? DOCK_EDGE_SHADOW : DOCK_LIFT_SHADOW;
    };

    const place = (x: number, y: number) => {
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
    };

    /** Lays the dock out horizontally or vertically, with its size, directly on the element. */
    /**
     * Lays the dock out horizontally or vertically. A change of layout is animated:
     * each button (and the grip) flies from its old slot to its new one with its own
     * short delay and a small bounce, and the dock gives a little squish.
     */
    const applyLayout = (o: DockOrientation, size: DockSize) => {
      if (o === domOrientation) {
        node.style.width = `${size.w}px`;
        node.style.height = `${size.h}px`;
        return;
      }

      const kids = Array.from(node.children) as HTMLElement[];
      // Measure the real slots: stop any running motion and drop the dock's own
      // scale/transition, otherwise the measured positions are off and the buttons jump.
      node.getAnimations().forEach((a) => a.cancel());
      kids.forEach((k) => k.getAnimations().forEach((a) => a.cancel()));
      const savedTransform = node.style.transform;
      const savedTransition = node.style.transition;
      node.style.transition = 'none';
      node.style.transform = 'none';
      const before = kids.map((k) => k.getBoundingClientRect());

      domOrientation = o;
      Object.assign(node.style, toDomStyle(orientationStyle(o)));
      node.style.width = `${size.w}px`;
      node.style.height = `${size.h}px`;
      const handle = node.firstElementChild as HTMLElement | null;
      if (handle) Object.assign(handle.style, toDomStyle(handleStyle(o)));

      const after = kids.map((k) => k.getBoundingClientRect());
      node.style.transform = savedTransform;
      node.style.transition = savedTransition;

      if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        return;
      }

      kids.forEach((kid, i) => {
        const a = before[i];
        const b = after[i];
        const dx = a.left - b.left;
        const dy = a.top - b.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        kid.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(0.84)` },
            { transform: 'translate(0px, 0px) scale(1.06)', offset: 0.7 },
            { transform: 'translate(0px, 0px) scale(1)' },
          ],
          {
            duration: 560,
            delay: i * 60,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            fill: 'backwards',
          },
        );
      });

      node.animate(
        [
          { transform: 'scale(0.94)' },
          { transform: 'scale(1.03)', offset: 0.6 },
          { transform: 'scale(1)' },
        ],
        { duration: 460, easing: 'ease-out' },
      );
    };

    const onDown = (e: PointerEvent) => {
      if (session) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      // Presses on a button must reach the button. Elsewhere on the dock, stop the
      // press here so the map underneath does not start panning.
      const target = e.target as HTMLElement | null;
      const onControl = !!target?.closest?.('[role="button"], [role="switch"]');
      if (!onControl) e.stopPropagation();
      const start = { x: parseFloat(node.style.left) || 0, y: parseFloat(node.style.top) || 0 };
      // The layout React last rendered is the one on screen; flips are measured from it.
      domOrientation = liveRef.current.o;
      session = {
        id: e.pointerId,
        held: e.pointerType !== 'mouse' || e.buttons > 0,
        sx: e.clientX,
        sy: e.clientY,
        ox: start.x,
        oy: start.y,
        x: start.x,
        y: start.y,
        moved: false,
        captured: false,
        samples: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
      };
      // Grabbing the dock itself (not a button) captures the pointer now, so a fast
      // move that leaves the dock still reaches it. Buttons only capture once a drag starts.
      if (!onControl) {
        session.captured = true;
        try {
          node.setPointerCapture(e.pointerId);
        } catch {
          // Capture unsupported: moves still arrive while the pointer is over the dock.
        }
      }
      node.style.transition = LIFT_TRANSITION;
    };

    const onMove = (e: PointerEvent) => {
      const s = session;
      if (!s || e.pointerId !== s.id) return;
      // A mouse move with no button held, after the press showed a held button,
      // means the release was missed (it can happen when the pointer leaves the
      // browser window). End the drag here.
      if (s.held && e.pointerType === 'mouse' && e.buttons === 0) {
        finish(e.pointerId);
        return;
      }
      const dx = e.clientX - s.sx;
      const dy = e.clientY - s.sy;
      if (!s.moved && Math.hypot(dx, dy) < DRAG_TAP_SLOP_PX) return;
      if (!s.captured) {
        // Only a real drag captures the pointer, so taps keep their click target.
        s.captured = true;
        try {
          node.setPointerCapture(e.pointerId);
        } catch {
          // Capture unsupported: moves still arrive while the pointer is over the dock.
        }
      }
      s.moved = true;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const len = liveRef.current.len;
      const rawX = s.ox + dx;
      const rawY = s.oy + dy;
      const o = decideOrientation({ x: rawX, y: rawY }, vw, vh, len, domOrientation ?? liveRef.current.o);
      const size = sizeOf(o, len);
      const lo = clampToViewport({ x: 0, y: 0 }, vw, vh, size);
      const hi = clampToViewport({ x: vw, y: vh }, vw, vh, size);
      const x = resistRange(rawX, lo.x, hi.x);
      const y = resistRange(rawY, lo.y, hi.y);
      s.x = x;
      s.y = y;
      place(x, y);
      applyLayout(o, size);

      const now = performance.now();
      s.samples.push({ t: now, x: e.clientX, y: e.clientY });
      while (s.samples.length > 2 && now - s.samples[0].t > VELOCITY_WINDOW_MS) {
        s.samples.shift();
      }

      const atEdge = x !== rawX || y !== rawY;
      setPhaseOnce(atEdge ? 'edge' : 'dragging');
    };

    const finish = (pointerId: number) => {
      const s = session;
      if (!s || pointerId !== s.id) return;
      session = null;
      try {
        node.releasePointerCapture(s.id);
      } catch {
        // Capture already released by the browser.
      }

      if (!s.moved) {
        node.style.transition = '';
        setPhaseOnce('idle');
        return;
      }

      // The click that follows a drag must not press a button.
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);

      const first = s.samples[0];
      const last = s.samples[s.samples.length - 1];
      const dt = Math.max(1, last.t - first.t);
      const rawVx = (last.x - first.x) / dt;
      const rawVy = (last.y - first.y) / dt;
      const speed = Math.hypot(rawVx, rawVy);
      // Cap the speed so an extreme flick cannot throw the dock across the whole screen.
      const scale = speed > MAX_FLICK_SPEED_PX_MS ? MAX_FLICK_SPEED_PX_MS / speed : 1;
      const vx = rawVx * scale;
      const vy = rawVy * scale;
      const flick = speed > FLICK_SPEED_PX_MS;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const projected = flick
        ? { x: s.x + vx * FLICK_PROJECTION_MS, y: s.y + vy * FLICK_PROJECTION_MS }
        : { x: s.x, y: s.y };
      const fitted = fitDock(projected, vw, vh, liveRef.current.len, domOrientation ?? liveRef.current.o);
      const moveNeeded = fitted.pos.x !== s.x || fitted.pos.y !== s.y;
      const duration = flick ? 360 : 200;

      node.style.transition = moveNeeded
        ? `left ${duration}ms ${EASE}, top ${duration}ms ${EASE}, ${LIFT_TRANSITION}`
        : LIFT_TRANSITION;
      place(fitted.pos.x, fitted.pos.y);
      applyLayout(fitted.o, fitted.size);
      setPhaseOnce('idle');
      // React and the DOM now agree on the same position and layout.
      const dropped = { x: fitted.pos.x, y: fitted.pos.y, o: fitted.o };
      setSaved(dropped);
      savePosition(dropped);

      if (moveNeeded) {
        settleTimer = setTimeout(() => {
          node.style.transition = LIFT_TRANSITION;
          settleTimer = null;
        }, duration + 20);
      }
    };

    const onEnd = (e: PointerEvent) => finish(e.pointerId);

    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onEnd);
    node.addEventListener('pointercancel', onEnd);
    node.addEventListener('lostpointercapture', onEnd);
    node.addEventListener('click', onClickCapture, true);

    return () => {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onEnd);
      node.removeEventListener('pointercancel', onEnd);
      node.removeEventListener('lostpointercapture', onEnd);
      node.removeEventListener('click', onClickCapture, true);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, []);

  return (
    <View
      ref={dockRef}
      style={[
        styles.dock,
        {
          left: placed.pos.x,
          top: placed.pos.y,
          width: placed.size.w,
          height: placed.size.h,
          gap: DOCK_ITEM_GAP,
        },
        orientationStyle(placed.o),
      ]}
    >
      <View style={[styles.dockHandle, handleStyle(placed.o)]} />
      {children}
    </View>
  );
}

function MapControlRailComponent({
  layoutInput,
  menuCollapsible,
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

  // Clamp top positions into safe bounds so clusters never float too high/low
  const clamp = (desiredTop: number, clusterHeight: number) => {
    const minTop = placement.safeBounds.top;
    const maxTop = Math.max(placement.safeBounds.top, placement.safeBounds.bottom - clusterHeight);
    return Math.min(Math.max(desiredTop, minTop), maxTop);
  };

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

  const webDockControls = useMemo(
    () => [...utilityControls, ...actionControls].filter((control): control is ReactNode => control != null),
    [actionControls, utilityControls],
  );

  // When splitMode is enabled, split controls left/right using the priority mapping.
  const splitLeftControls = useMemo(() => {
    if (!layoutInput.splitMode) return null;
    // left: first two priorities
    const left: ReactNode[] = [];
    // map priorities to actual renderers
    const byKey: Record<string, ReactNode | undefined> = {
      profile: resolveControlNode(profileControl, compressed),
      safety: resolveControlNode(safetyCircleControl, compressed),
      live: resolveControlNode(liveLocationControl, compressed),
      report: resolveControlNode(reportControl, compressed),
      currentLocation: resolveControlNode(currentLocationControl, compressed),
    };
    const leftKeys = PRIORITY_KEYS.slice(0, 2);
    for (const k of leftKeys) {
      const c = byKey[k];
      if (c != null) left.push(c);
    }
    return left;
  }, [layoutInput.splitMode, profileControl, safetyCircleControl, liveLocationControl, reportControl, currentLocationControl, compressed]);

  const splitRightControls = useMemo(() => {
    if (!layoutInput.splitMode) return null;
    const byKey: Record<string, ReactNode | undefined> = {
      profile: resolveControlNode(profileControl, compressed),
      safety: resolveControlNode(safetyCircleControl, compressed),
      live: resolveControlNode(liveLocationControl, compressed),
      report: resolveControlNode(reportControl, compressed),
      currentLocation: resolveControlNode(currentLocationControl, compressed),
    };
    // right: remaining priorities (3)
    const rightKeys = PRIORITY_KEYS.slice(2);
    const right: ReactNode[] = [];
    for (const k of rightKeys) {
      const c = byKey[k];
      if (c != null) right.push(c);
    }
    return right;
  }, [layoutInput.splitMode, profileControl, safetyCircleControl, liveLocationControl, reportControl, currentLocationControl, compressed]);

  // Compute clamped tops
  const utilityTopClamped = clamp(placement.utility.top, placement.utility.height);
  const actionTopClamped = clamp(placement.action.top, placement.action.height);

  const actionSide = placement.action.side || 'right';
  const webDockHeight = webDockControls.length > 0
    ? webDockControls.length * 48 + Math.max(0, webDockControls.length - 1) * 12
    : 0;

  const rootStyle = [
    styles.root,
    Platform.OS === 'web' ? { zIndex: 1500 } : {},
    actionSide === 'right' ? styles.rootRight : styles.rootLeft,
    style,
  ];

  // Native: the same single dock as web, above the bottom sheet, draggable.
  if (Platform.OS !== 'web') {
    return (
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, style]} testID={testID}>
        <NativeDockMenu
          collapsible={!!menuCollapsible}
          current={resolveControlNode(currentLocationControl, false)}
          hidden={[
            resolveControlNode(profileControl, false),
            resolveControlNode(safetyCircleControl, false),
            resolveControlNode(liveLocationControl, false),
            resolveControlNode(reportControl, false),
          ].filter((node): node is ReactNode => node != null)}
          all={webDockControls}
        />
      </View>
    );
  }

  // Render split layout when requested
  if (layoutInput.splitMode) {
    return (
      <View pointerEvents="box-none" style={rootStyle} testID={testID}>
        {/* left cluster (two priority items) */}
        <View
          pointerEvents="box-none"
          style={[
            styles.cluster,
            styles.utilityCluster,
            styles.leftCluster,
            { top: utilityTopClamped },
            compressed ? styles.clusterCompressed : null,
          ]}
        >
          {renderControlStack(splitLeftControls || [], placement.utility.controlGap, compressed)}
        </View>

        {/* right cluster (remaining) */}
        <View
          pointerEvents="box-none"
          style={[
            styles.cluster,
            styles.actionCluster,
            styles.rightCluster,
            { top: actionTopClamped },
          ]}
        >
          {renderControlStack(splitRightControls || [], placement.action.controlGap, false)}
        </View>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    // Full-screen layer that lets map input through; the dock itself is draggable.
    return (
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 1500 }, style]} testID={testID}>
        <DraggableDock controlsHeight={webDockHeight}>
          {renderControlStack(webDockControls, 0, false)}
        </DraggableDock>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={rootStyle} testID={testID}>
      <View
        pointerEvents="box-none"
        style={[
          styles.cluster,
          styles.utilityCluster,
          {
            top: utilityTopClamped,
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
          actionSide === 'right' ? styles.rightCluster : styles.leftCluster,
          {
            top: actionTopClamped,
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
  nativeDock: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    boxShadow: colors.glassShadow,
  } as any,
  nativeDockLifted: {
    boxShadow: '0 10px 28px rgba(15, 23, 42, 0.18)',
  } as any,
  root: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 12,
    width: 56,
    zIndex: 100,
    alignItems: 'flex-end',
  },
  rootLeft: {
    left: 12,
    right: undefined,
    alignItems: 'flex-start',
  },
  rootRight: {
    right: 12,
    left: undefined,
    alignItems: 'flex-end',
  },
  cluster: {
    position: 'absolute',
    right: 0,
    alignItems: 'center',
  },
  leftCluster: {
    left: 0,
    right: undefined,
    alignItems: 'center',
  },
  rightCluster: {
    right: 0,
    left: undefined,
    alignItems: 'center',
  },
  utilityCluster: {
    zIndex: 110,
  },
  actionCluster: {
    zIndex: 100,
  },
  webDock: {
    // Transparent: each round glass button floats on its own, Apple-style.
    right: 0,
    alignItems: 'center',
  } as any,
  dock: {
    // One translucent glass container for all dock buttons. More transparent than
    // the buttons, so the map shows through it. Orientation sets the direction and padding.
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
    backdropFilter: 'blur(24px) saturate(180%)',
    cursor: 'grab',
    userSelect: 'none',
    touchAction: 'none',
  } as any,
  dockHandle: {
    borderRadius: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.22)',
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
