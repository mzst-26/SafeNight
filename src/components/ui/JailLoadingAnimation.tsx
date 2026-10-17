/**
 * JailLoadingAnimation — A glossy 3D glass cube with a thin progress line tracing its outline,
 * plus rotating safety facts. Transparent background, neutral palette.
 *
 * Progress strategy:
 *   1. Starts immediately at 20% to confirm work has begun.
 *   2. Follows the progress value supplied by the screen state (client-driven).
 *   3. While loading, progress is clamped to 20–90 and completes at 100 on done.
 * Visuals:
 *   – A rounded-square glass body with a top gloss, bottom shading and a bevelled rim.
 *   – The progress line runs around the cube's outline, starting at the top-left corner.
 *   – The cube breathes slowly; motion is disabled when the OS asks for reduced motion.
 * Text strategy:
 *   – Rotates through safety facts, one every 5 s. Facts stay high-contrast (WCAG AA).
 */
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';

type JailLoadingAnimationProps = {
  progressPct?: number | null;
  statusMessage?: string | null;
};

const LOADING_FACTS = [
  'Building a walkable road graph from OpenStreetMap geometry around your route.',
  'Tracing realistic corridor boundaries so we score the streets you can actually walk.',
  'Street-light density matters: better-lit segments usually reduce nighttime risk.',
  'Nearby CCTV coverage can raise confidence and improve segment safety weighting.',
  'Recent crime patterns are weighted by category, not every incident equally.',
  'Open venues add passive guardianship by increasing eyes-on-street at night.',
  'Transit stops can improve safety by keeping routes in active, visible corridors.',
  'Dead-end heavy stretches are penalized because escape options are limited.',
  'Main-road exposure is balanced with comfort so the route is safer, not just shorter.',
  'Sidewalk presence is scored because separated walking space reduces conflict with traffic.',
  'Night routing prioritizes visibility and activity where possible.',
  'Distance-only shortest paths are compared against safety-optimized alternatives.',
  'We rank candidates by multi-factor safety score, then keep practical travel time in check.',
  'Sampling node connectivity to avoid sending you through isolated fragments.',
  'Footway and pedestrian segments are evaluated differently from vehicle-heavy roads.',
  'No single signal dominates: lighting, crime, roads, and activity are blended together.',
  'Each segment receives a local score before total route safety is computed.',
  'Map data quality varies by area, so confidence is considered during route ranking.',
  'Higher-risk micro-segments are softened by finding nearby safer alternatives.',
  'We stitch safe segments into continuous paths that still feel natural to walk.',
  'Urban routes often gain from denser lighting and services after dark.',
  'Quiet park or path segments may be scenic but can score lower at night if isolated.',
  'Progress updates reflect backend phases so your progress bar is deterministic.',
  'Route candidates are validated for connectivity before final ranking.',
  'If one data source slows down, fallback logic keeps routing resilient.',
  'Caching helps repeated searches complete faster with less redundant computation.',
  'Safety scoring is computed server-side so your device stays responsive.',
  'Local context matters: the same distance can have very different night risk by street.',
  'Final candidates are compared side-by-side before the safest practical route is returned.',
  'Goal: reduce exposure to low-light and high-risk segments without huge detours.',
  'Longer trips trigger wider corridor analysis to capture realistic route options.',
  'Dynamic weighting keeps route selection consistent even when data density changes.',
  'Graph search explores multiple branches, not just one straight-line guess.',
  'Road class influences comfort and predictability during nighttime walking.',
  'Safety score is interpretable: road type, lighting, crime, CCTV, and activity all contribute.',
  'Assembling your final options now and preparing map overlays.',
];

const CUBE_SIZE = 176;
const INSET = 10; // space for the progress line and its glow
const CUBE_RADIUS = 46;
const LINE_WIDTH = 1.6;
const BODY_W = CUBE_SIZE - INSET * 2;
const BODY_H = CUBE_SIZE - INSET * 2;
const PERIMETER = 2 * (BODY_W - 2 * CUBE_RADIUS) + 2 * (BODY_H - 2 * CUBE_RADIUS) + 2 * Math.PI * CUBE_RADIUS;

// Path for the rounded-square outline, clockwise from the top-left corner's end.
const OUTLINE_PATH = [
  `M ${INSET + CUBE_RADIUS} ${INSET}`,
  `L ${INSET + BODY_W - CUBE_RADIUS} ${INSET}`,
  `A ${CUBE_RADIUS} ${CUBE_RADIUS} 0 0 1 ${INSET + BODY_W} ${INSET + CUBE_RADIUS}`,
  `L ${INSET + BODY_W} ${INSET + BODY_H - CUBE_RADIUS}`,
  `A ${CUBE_RADIUS} ${CUBE_RADIUS} 0 0 1 ${INSET + BODY_W - CUBE_RADIUS} ${INSET + BODY_H}`,
  `L ${INSET + CUBE_RADIUS} ${INSET + BODY_H}`,
  `A ${CUBE_RADIUS} ${CUBE_RADIUS} 0 0 1 ${INSET} ${INSET + BODY_H - CUBE_RADIUS}`,
  `L ${INSET} ${INSET + CUBE_RADIUS}`,
  `A ${CUBE_RADIUS} ${CUBE_RADIUS} 0 0 1 ${INSET + CUBE_RADIUS} ${INSET}`,
  'Z',
].join(' ');

/** Point at distance `distance` along the outline (clockwise from the top-left corner). */
function pointOnOutline(distance: number): { x: number; y: number } {
  const straightTop = BODY_W - 2 * CUBE_RADIUS;
  const straightSide = BODY_H - 2 * CUBE_RADIUS;
  const arc = (Math.PI / 2) * CUBE_RADIUS;
  const segments: Array<{ len: number; at: (t: number) => { x: number; y: number } }> = [];
  const x0 = INSET;
  const y0 = INSET;
  const x1 = INSET + BODY_W;
  const y1 = INSET + BODY_H;
  const r = CUBE_RADIUS;

  segments.push({ len: straightTop, at: (t) => ({ x: x0 + r + straightTop * t, y: y0 }) });
  segments.push({ len: arc, at: (t) => cornerPoint(x1 - r, y0 + r, r, -Math.PI / 2 + Math.PI / 2 * t) });
  segments.push({ len: straightSide, at: (t) => ({ x: x1, y: y0 + r + straightSide * t }) });
  segments.push({ len: arc, at: (t) => cornerPoint(x1 - r, y1 - r, r, Math.PI / 2 * t) });
  segments.push({ len: straightTop, at: (t) => ({ x: x1 - r - straightTop * t, y: y1 }) });
  segments.push({ len: arc, at: (t) => cornerPoint(x0 + r, y1 - r, r, Math.PI / 2 + Math.PI / 2 * t) });
  segments.push({ len: straightSide, at: (t) => ({ x: x0, y: y1 - r - straightSide * t }) });
  segments.push({ len: arc, at: (t) => cornerPoint(x0 + r, y0 + r, r, Math.PI + Math.PI / 2 * t) });

  let remaining = Math.max(0, Math.min(PERIMETER, distance));
  for (const seg of segments) {
    if (remaining <= seg.len) return seg.at(seg.len === 0 ? 0 : remaining / seg.len);
    remaining -= seg.len;
  }
  return { x: x0 + r, y: y0 };
}

function cornerPoint(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

export function JailLoadingAnimation({ progressPct = null, statusMessage = null }: JailLoadingAnimationProps) {
  const MIN_START_PCT = 20;
  const MAX_LOADING_PCT = 90;

  const [factIdx, setFactIdx] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const breathAnim = useRef(new Animated.Value(1)).current;
  // Displayed progress 0→1 (driven by the screen-provided progressPct)
  const barAnim = useRef(new Animated.Value(0)).current;
  const [displayPct, setDisplayPct] = useState(MIN_START_PCT);
  const [fraction, setFraction] = useState(MIN_START_PCT / 100);

  // Mirror the animated value into state so the SVG line can follow it.
  useEffect(() => {
    const id = barAnim.addListener(({ value }) => setFraction(value));
    return () => barAnim.removeListener(id);
  }, [barAnim]);

  // Respect the OS "reduce motion" setting.
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((enabled) => {
      if (mounted) setReduceMotion(!!enabled);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // ── Fact rotation: every 5 s, cross-fade to next fact ──
  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(fadeAnim, { toValue: 0.4, duration: 200, useNativeDriver: true }).start(() => {
        setFactIdx((prev) => (prev + 1) % LOADING_FACTS.length);
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [fadeAnim]);

  // ── Slow breathing of the cube (skipped with reduced motion) ──
  useEffect(() => {
    if (reduceMotion) {
      breathAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathAnim, { toValue: 1.02, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathAnim, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathAnim, reduceMotion]);

  // Start instantly at 20% so users see immediate feedback.
  useEffect(() => {
    Animated.timing(barAnim, {
      toValue: MIN_START_PCT / 100,
      duration: 250,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Follow incoming progress, clamped to 20..90 while loading ──
  useEffect(() => {
    const hasServerPct = typeof progressPct === 'number' && Number.isFinite(progressPct) && progressPct >= 0;
    const incoming = !hasServerPct
      ? MIN_START_PCT
      : progressPct >= 100
        ? 100
        : Math.max(MIN_START_PCT, Math.min(MAX_LOADING_PCT, Math.round(progressPct)));

    let nextPct = incoming;
    setDisplayPct((prev) => {
      nextPct = Math.max(prev, incoming);
      return nextPct;
    });

    Animated.timing(barAnim, {
      toValue: nextPct / 100,
      duration: 500,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [progressPct, barAnim]);

  const fact = LOADING_FACTS[factIdx];
  const backendStatus = statusMessage?.trim() || null;
  const clamped = Math.max(0, Math.min(1, fraction));
  const dashOffset = PERIMETER * (1 - clamped);
  const head = pointOnOutline(PERIMETER * clamped);

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Analysing routes</Text>

      <Animated.View style={[styles.cubeWrap, { transform: [{ scale: breathAnim }] }]}>
        <Svg width={CUBE_SIZE} height={CUBE_SIZE} style={styles.svg}>
          <Defs>
            {/* Glass layer: barely tinted, so the background shows through like a widget */}
            <LinearGradient id="cubeBody" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
              <Stop offset="1" stopColor="#ffffff" stopOpacity="0.06" />
            </LinearGradient>
            {/* Very light bottom shading gives the layer depth */}
            <LinearGradient id="cubeShade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.6" stopColor="#475467" stopOpacity="0" />
              <Stop offset="1" stopColor="#475467" stopOpacity="0.06" />
            </LinearGradient>
            {/* Gloss along the top edge */}
            <LinearGradient id="cubeGloss" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
              <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </LinearGradient>
            {/* Outline: bright at the top, darker toward the bottom, like a polished edge */}
            <LinearGradient id="edgeStroke" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity="1" />
              <Stop offset="1" stopColor="#98a2b3" stopOpacity="0.7" />
            </LinearGradient>
            {/* Progress line: graphite, so it reads on a light glass background */}
            <LinearGradient id="progressStroke" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#1d2939" />
              <Stop offset="1" stopColor="#667085" />
            </LinearGradient>
          </Defs>

          {/* Cube body */}
          <Path d={OUTLINE_PATH} fill="url(#cubeBody)" />
          <Path d={OUTLINE_PATH} fill="url(#cubeShade)" />
          {/* Top gloss, inset from the edge */}
          <Path
            d={`M ${INSET + 18} ${INSET + 14} Q ${CUBE_SIZE / 2} ${INSET - 2} ${CUBE_SIZE - INSET - 18} ${INSET + 14} Q ${CUBE_SIZE / 2} ${INSET + 44} ${INSET + 18} ${INSET + 14} Z`}
            fill="url(#cubeGloss)"
            opacity={0.7}
          />
          {/* Bevelled edge: a bright inner rim so the body looks 3D */}
          <Path
            d={OUTLINE_PATH}
            fill="none"
            stroke="rgba(255, 255, 255, 0.9)"
            strokeWidth={1.5}
          />
          <Path
            d={OUTLINE_PATH}
            fill="none"
            stroke="url(#edgeStroke)"
            strokeWidth={1}
            opacity={0.55}
          />

          {/* Progress line track */}
          <Path d={OUTLINE_PATH} fill="none" stroke="rgba(15, 23, 42, 0.08)" strokeWidth={LINE_WIDTH} />
          {/* Progress line with a 3D touch: a soft shadow below, a light highlight above */}
          <Path
            d={OUTLINE_PATH}
            fill="none"
            stroke="rgba(15, 23, 42, 0.28)"
            strokeWidth={LINE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={`${PERIMETER} ${PERIMETER}`}
            strokeDashoffset={dashOffset}
            transform="translate(0 0.9)"
          />
          <Path
            d={OUTLINE_PATH}
            fill="none"
            stroke="url(#progressStroke)"
            strokeWidth={LINE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={`${PERIMETER} ${PERIMETER}`}
            strokeDashoffset={dashOffset}
          />
          <Path
            d={OUTLINE_PATH}
            fill="none"
            stroke="rgba(255, 255, 255, 0.85)"
            strokeWidth={LINE_WIDTH * 0.3}
            strokeLinecap="round"
            strokeDasharray={`${PERIMETER} ${PERIMETER}`}
            strokeDashoffset={dashOffset}
            transform="translate(0 -0.4)"
          />
          {/* Head marker at the end of the progress line */}
          {clamped > 0.02 && (
            <>
              <Circle cx={head.x} cy={head.y} r={6} fill="#1d2939" opacity={0.12} />
              <Circle cx={head.x} cy={head.y} r={3.2} fill="#ffffff" stroke="#1d2939" strokeWidth={1.5} />
            </>
          )}
        </Svg>

        <View style={styles.percentWrap} pointerEvents="none">
          <Text style={styles.percentText}>{displayPct}%</Text>
          <Text style={styles.percentLabel}>analysed</Text>
        </View>
      </Animated.View>

      <Animated.Text style={[styles.factText, { opacity: fadeAnim }]}>{fact}</Animated.Text>

      {backendStatus ? <Text style={styles.statusText}>{backendStatus}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: 420,
    width: '100%',
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 16,
    backgroundColor: 'transparent',
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '600',
    color: '#344054',
    letterSpacing: 0.2,
  },
  cubeWrap: {
    width: CUBE_SIZE,
    height: CUBE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  svg: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
  percentWrap: {
    alignItems: 'center',
  },
  percentText: {
    fontSize: 34,
    fontWeight: '600',
    color: '#0f172a',
    letterSpacing: -0.8,
  },
  percentLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#344054',
    marginTop: -2,
  },
  factText: {
    fontSize: 13,
    fontWeight: '400',
    color: '#475467',
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 300,
  },
  statusText: {
    fontSize: 12,
    color: '#667085',
    fontWeight: '500',
    textAlign: 'center',
  },
});
