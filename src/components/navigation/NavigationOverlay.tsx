/**
 * NavigationOverlay — Turn-by-turn UI during active navigation.
 *
 * Layout: one full-screen overlay with two groups stacked at the edges.
 *  - Top group: instruction card + report flag (same row), then the alert banner.
 *  - Bottom group: recenter pill (right edge, above the bar), then the bottom bar with Stop.
 * Both groups share a 16px side gutter, so every card lines up on the same left/right edges.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { NavigationInfo } from '@/src/hooks/useNavigation';
import type { NavAlert } from '@/src/hooks/useNavAlerts';
import { colors, radius, spacing, type } from '@/src/theme';
import { formatDuration, formatNavDistance, maneuverIcon, stripHtml } from '@/src/utils/format';

let _useIsInPip: () => { isInPipMode: boolean } = () => ({ isInPipMode: false });
try {
  const ExpoPip = require('expo-pip').default;
  if (ExpoPip?.useIsInPip) _useIsInPip = ExpoPip.useIsInPip;
} catch {}

interface NavigationOverlayProps {
  nav: NavigationInfo;
  topInset: number;
  bottomInset: number;
  liveSharingNotice?: string | null;
  navAlert?: NavAlert | null;
  showReportButton?: boolean;
  onPressReport?: () => void;
  showRecenter?: boolean;
  onRecenter?: () => void;
}

export function NavigationOverlay({ nav, topInset, bottomInset, liveSharingNotice, navAlert, showReportButton = false, onPressReport, showRecenter = false, onRecenter }: NavigationOverlayProps) {
  const { isInPipMode } = _useIsInPip();
  const isActive = nav.state === 'navigating' || nav.state === 'off-route';
  const [clockTickMs, setClockTickMs] = useState(Date.now());
  const stopCompactAnimRef = useRef(new Animated.Value(showRecenter ? 1 : 0));
  const stopCompactAnim = stopCompactAnimRef.current;

  // Alert fade animation
  const alertAnimRef = useRef(new Animated.Value(0));
  const alertAnim = alertAnimRef.current;
  useEffect(() => {
    Animated.timing(alertAnim, {
      toValue: navAlert ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [navAlert, alertAnim]);

  useEffect(() => {
    Animated.timing(stopCompactAnim, {
      toValue: showRecenter ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [showRecenter, stopCompactAnim]);

  const stopButtonWidth = stopCompactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [112, 44],
  });
  const stopTextOpacity = stopCompactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });
  const stopTextTranslateX = stopCompactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 10],
  });
  const stopTextContainerWidth = stopCompactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [36, 0],
  });
  const stopTextContainerMarginLeft = stopCompactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [6, 0],
  });

  useEffect(() => {
    if (!isActive) return;
    // One second, so the remaining distance and ETA in the bottom bar stay live.
    const timer = setInterval(() => {
      setClockTickMs(Date.now());
    }, 1_000);
    return () => clearInterval(timer);
  }, [isActive]);

  // Measured PiP window width — gate updates to >= 6px changes to avoid
  // a re-render storm during Android's PiP window resize animation.
  const [pipW, setPipW] = useState(0);
  const pipWRef = useRef(0);
  const onPipLayout = useCallback((e: any) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - pipWRef.current) >= 6) {
      pipWRef.current = w;
      setPipW(w);
    }
  }, []);

  if (!isActive && nav.state !== 'arrived') return null;

  // ── PiP overlay — transparent, map visible. Two slim strips. ───────────
  if (isInPipMode && isActive) {
    const scale = pipW > 0 ? Math.min(1.0, Math.max(0.50, pipW / 220)) : 0.85;
    const iconCircle = Math.round(28 * scale);
    const iconSz     = Math.round(15 * scale);
    const distFont   = Math.round(12 * scale);
    const instrFont  = Math.round(10 * scale);
    const etaFont    = Math.round(9  * scale);
    const hPad       = Math.round(8  * scale);
    const vPadTop    = Math.round(6  * scale);
    const vPadBot    = Math.round(4  * scale);
    const stripGap   = Math.round(5  * scale);
    const minTopH    = Math.round(40 * scale);
    const minBotH    = Math.round(20 * scale);

    return (
      <View style={styles.pipRoot} onLayout={onPipLayout} pointerEvents="none">
        {/* ── Top strip: icon + distance + turn instruction ── */}
        <View style={[
          styles.pipTopStrip,
          { paddingHorizontal: hPad, paddingVertical: vPadTop, minHeight: minTopH, gap: stripGap },
        ]}>
          <View style={[styles.pipIconCircle, { width: iconCircle, height: iconCircle, borderRadius: iconCircle / 2 }]}>
            <Ionicons
              name={maneuverIcon(nav.currentStep?.maneuver) as any}
              size={iconSz}
              color="#ffffff"
            />
          </View>
          <View style={styles.pipTextBlock}>
            {nav.distanceToNextTurn > 30 ? (
              <Text style={[styles.pipDistanceText, { fontSize: distFont }]} numberOfLines={1}>
                {formatNavDistance(nav.distanceToNextTurn)}
              </Text>
            ) : null}
            <Text
              style={[styles.pipInstructionText, { fontSize: instrFont, lineHeight: instrFont + 3 }]}
              numberOfLines={2}
            >
              {stripHtml(nav.currentStep?.instruction ?? 'Continue on route')}
            </Text>
          </View>
        </View>

        {/* Map shows through this spacer */}
        <View style={{ flex: 1 }} />

        {/* ── Bottom strip: remaining distance + ETA ── */}
        <View style={[
          styles.pipBottomStrip,
          { paddingHorizontal: hPad, paddingVertical: vPadBot, minHeight: minBotH },
        ]}>
          {nav.state === 'off-route' ? (
            <Text style={[styles.pipOffRouteText, { fontSize: etaFont }]} numberOfLines={1}>
              ⚠ Off route…
            </Text>
          ) : (
            <Text style={[styles.pipEtaText, { fontSize: etaFont }]} numberOfLines={1}>
              {formatNavDistance(nav.remainingDistance)}
              {'  ·  ETA '}
              {new Date(clockTickMs + nav.remainingDuration * 1000)
                .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>
      </View>
    );
  }

  // Alert banner styles by kind
  const alertStyles = {
    crime: { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B', icon: 'warning-outline' as const, iconColor: '#DC2626' },
    cctv:  { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', icon: 'eye-outline' as const, iconColor: '#B45309' },
    street:{ bg: '#F3F4F6', border: '#E5E7EB', text: '#374151', icon: 'location-outline' as const, iconColor: '#6B7280' },
  };

  return (
    <>
      {isActive && (
        <View
          style={[
            styles.overlay,
            { paddingTop: topInset + spacing.sm, paddingBottom: bottomInset + spacing.sm },
          ]}
          pointerEvents="box-none"
        >
          {/* ── Top group: instruction card + report flag, then alert banner ── */}
          <View style={styles.topGroup} pointerEvents="box-none">
            <View style={styles.topRow} pointerEvents="box-none">
              <View style={styles.instructionCard}>
                <View style={styles.iconRow}>
                  <Ionicons
                    name={maneuverIcon(nav.currentStep?.maneuver) as any}
                    size={28}
                    color={colors.primary}
                  />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    {nav.distanceToNextTurn > 30 ? (
                      <Text style={styles.distance}>
                        In {formatNavDistance(nav.distanceToNextTurn)}
                      </Text>
                    ) : null}
                    <Text style={styles.instruction} numberOfLines={2}>
                      {stripHtml(nav.currentStep?.instruction ?? 'Continue on route')}
                    </Text>
                  </View>
                </View>
              </View>

              {showReportButton && onPressReport ? (
                <Pressable
                  onPress={onPressReport}
                  style={styles.reportButton}
                  hitSlop={spacing.sm}
                  accessibilityRole="button"
                  accessibilityLabel="Report a hazard"
                >
                  <Ionicons name="flag-outline" size={20} color="#EF4444" />
                </Pressable>
              ) : null}
            </View>

            {navAlert ? (
              <Animated.View
                style={[
                  styles.alertBanner,
                  {
                    opacity: alertAnim,
                    transform: [{ translateY: alertAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
                    backgroundColor: alertStyles[navAlert.kind].bg,
                    borderColor: alertStyles[navAlert.kind].border,
                  },
                ]}
              >
                <Ionicons
                  name={alertStyles[navAlert.kind].icon as any}
                  size={16}
                  color={alertStyles[navAlert.kind].iconColor}
                />
                <Text style={[styles.alertBannerText, { color: alertStyles[navAlert.kind].text }]} numberOfLines={2}>
                  {navAlert.text}
                </Text>
              </Animated.View>
            ) : null}
          </View>

          {/* ── Bottom group: recenter pill (right edge), then bottom bar ── */}
          <View style={styles.bottomGroup} pointerEvents="box-none">
            {showRecenter && onRecenter ? (
              <Pressable
                style={styles.recenterButton}
                onPress={onRecenter}
                accessibilityRole="button"
                accessibilityLabel="Recenter map"
              >
                <Ionicons name="locate" size={16} color={colors.surface} />
                <Text style={styles.recenterText}>Recenter</Text>
              </Pressable>
            ) : null}

            <View style={styles.bottomBar}>
              <View style={styles.metaBlock}>
                {nav.state === 'off-route' ? (
                  <Text style={styles.offRoute}>Off route — rerouting…</Text>
                ) : (
                  <Text style={styles.etaText} numberOfLines={1}>
                    {formatNavDistance(nav.remainingDistance)}
                    {'  ·  ETA '}
                    {new Date(clockTickMs + nav.remainingDuration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                )}
              </View>
              <Pressable onPress={nav.stop} accessibilityRole="button" accessibilityLabel="Stop navigation">
                <Animated.View style={[styles.stopButton, { width: stopButtonWidth }]}>
                  <Ionicons name="stop-circle" size={20} color="#ffffff" />
                  <Animated.View
                    style={[
                      styles.stopTextWrap,
                      {
                        width: stopTextContainerWidth,
                        marginLeft: stopTextContainerMarginLeft,
                      },
                    ]}
                  >
                    <Animated.Text
                      style={[
                        styles.stopText,
                        {
                          opacity: stopTextOpacity,
                          transform: [{ translateX: stopTextTranslateX }],
                        },
                      ]}
                    >
                      Stop
                    </Animated.Text>
                  </Animated.View>
                </Animated.View>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {nav.state === 'arrived' && (
        <View style={[styles.arrivedBanner, { bottom: bottomInset + spacing.lg }]}>
          <Ionicons name="checkmark-circle" size={28} color="#22c55e" />
          <Text style={styles.arrivedText}>You have arrived!</Text>
          <Pressable style={styles.dismissButton} onPress={nav.stop}>
            <Text style={styles.dismissText}>Done</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

const cardShadow = Platform.OS === 'web' ? { boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)' } : {};

const styles = StyleSheet.create({
  // ── PiP overlay ─────────────────────────────────────────────────
  pipRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'column',
  },
  pipTopStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 12, 22, 0.86)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    minHeight: 44,
  },
  pipIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1570EF',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pipTextBlock: {
    flex: 1,
    justifyContent: 'center',
    gap: 1,
  },
  pipDistanceText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  pipInstructionText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.90)',
    lineHeight: 14,
  },
  pipBottomStrip: {
    backgroundColor: 'rgba(8, 12, 22, 0.80)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignItems: 'center',
    minHeight: 24,
    justifyContent: 'center',
  },
  pipEtaText: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.80)',
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  pipOffRouteText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ef4444',
    textAlign: 'center',
  },

  // ── Normal overlay ──────────────────────────────────────────────
  // Full-screen and transparent to touches (box-none); only the cards take taps.
  // Side gutter is spacing.lg (16) for every child, so edges line up.
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    justifyContent: 'space-between',
    zIndex: 15,
    elevation: 15,
  },
  topGroup: {
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  instructionCard: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    ...cardShadow,
    elevation: 10,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  distance: {
    ...type.display,
    color: colors.text,
  },
  instruction: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    ...(Platform.OS === 'web' ? { boxShadow: '0 2px 10px rgba(0,0,0,0.10)' } : {}),
    elevation: 5,
  },
  alertBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  bottomGroup: {
    gap: spacing.sm,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    ...cardShadow,
    elevation: 10,
  },
  metaBlock: {
    flex: 1,
    minWidth: 0,
  },
  offRoute: {
    ...type.label,
    color: '#ef4444',
  },
  etaText: {
    ...type.label,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  // Recenter: compact blue pill, right-aligned above the bottom bar (same 16px gutter).
  recenterButton: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    ...(Platform.OS === 'web' ? { boxShadow: '0 2px 8px rgba(0,0,0,0.15)' } : {}),
    elevation: 8,
  },
  recenterText: {
    ...type.label,
    color: colors.surface,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: '#ef4444',
    overflow: 'hidden',
  },
  stopText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  stopTextWrap: {
    overflow: 'hidden',
    alignItems: 'flex-start',
  },
  // Report flag: sits in the top row beside the card, raised above it so it is never covered.
  reportButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    ...(Platform.OS === 'web' ? { boxShadow: '0 2px 8px rgba(0,0,0,0.12)' } : {}),
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  arrivedBanner: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    ...cardShadow,
    elevation: 10,
    zIndex: 15,
  },
  arrivedText: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  dismissButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: '#22c55e',
  },
  dismissText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
