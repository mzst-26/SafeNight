/**
 * NavigationOverlay — Turn-by-turn UI during active navigation.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { NavigationInfo } from '@/src/hooks/useNavigation';
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
  showRecenter?: boolean;
  onRecenter?: () => void;
}

export function NavigationOverlay({ nav, topInset, bottomInset, liveSharingNotice, showRecenter = false, onRecenter }: NavigationOverlayProps) {
  const { isInPipMode } = _useIsInPip();
  const isActive = nav.state === 'navigating' || nav.state === 'off-route';
  const [clockTickMs, setClockTickMs] = useState(Date.now());
  const stopCompactAnimRef = useRef(new Animated.Value(showRecenter ? 1 : 0));
  const stopCompactAnim = stopCompactAnimRef.current;

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
    const timer = setInterval(() => {
      setClockTickMs(Date.now());
    }, 30_000);
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
  // All sizes are proportional to the measured window width so the layout
  // remains readable whether the user makes the PiP window tiny or large.
  if (isInPipMode && isActive) {
    // Reference width: 220 px → scale 1.0. Shrinks down to 0.5 for narrow windows.
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

  return (
    <>
      {isActive && (
        <View style={[styles.overlay, { pointerEvents: 'box-none' }]}>
          {/* Instruction card */}
          <View style={[styles.instructionCard, { marginTop: topInset + 8 }]}>
            <View style={styles.iconRow}>
              <Ionicons
                name={maneuverIcon(nav.currentStep?.maneuver) as any}
                size={28}
                color="#1570EF"
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
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
            {nav.nextStep && (
              <Text style={styles.then} numberOfLines={1}>
                Then: {stripHtml(nav.nextStep.instruction)}
              </Text>
            )}
          </View>

          {/* Bottom bar */}
          <View style={[styles.bottomStack, { marginBottom: bottomInset + 8 }]}>
            <View style={styles.bottomBar}>
              <View style={styles.metaBlock}>
                <Text style={styles.remaining}>
                  {formatNavDistance(nav.remainingDistance)} remaining
                </Text>
                <Text style={styles.eta}>
                  ETA{' '}
                  <Text style={styles.arrivalTime}>
                    {new Date(clockTickMs + nav.remainingDuration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {' · '}{formatDuration(nav.remainingDuration)} walking
                </Text>
                {nav.state === 'off-route' && (
                  <Text style={styles.offRoute}>Off route — rerouting…</Text>
                )}
              </View>
              <View style={styles.actionsRow}>
                {showRecenter && onRecenter ? (
                  <Pressable style={styles.recenterButton} onPress={onRecenter}>
                    <Ionicons name="locate" size={16} color="#ffffff" />
                    <Text style={styles.recenterText}>Recenter</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={nav.stop}>
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
            {liveSharingNotice ? (
              <View style={styles.liveShareBadge}>
                <Ionicons name="radio-outline" size={12} color="#B54708" />
                <Text style={styles.liveShareBadgeText}>{liveSharingNotice}</Text>
              </View>
            ) : null}
          </View>
        </View>
      )}

      {nav.state === 'arrived' && (
        <View style={[styles.arrivedBanner, { bottom: bottomInset + 16 }]}>
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

const styles = StyleSheet.create({
  // ── PiP overlay — transparent, map shows through the middle ──────
  pipRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'column',
  },
  // Top strip — dark frosted band
  pipTopStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 12, 22, 0.86)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    // min height so it's always readable
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
  // Bottom strip — subtler dark band
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
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    zIndex: 15,
    elevation: 15,
  },
  instructionCard: {
    margin: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)' } : {}),
    elevation: 10,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  distance: {
    fontSize: 24,
    fontWeight: '800',
    color: '#101828',
  },
  instruction: {
    fontSize: 15,
    color: '#475467',
    marginTop: 2,
    lineHeight: 20,
  },
  then: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f2f4f7',
    fontSize: 13,
    color: '#667085',
  },
  bottomStack: {
    margin: 16,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)' } : {}),
    elevation: 10,
  },
  metaBlock: {
    flex: 1,
    minWidth: 0,
    marginRight: 12,
  },
  remaining: {
    fontSize: 15,
    fontWeight: '600',
    color: '#101828',
  },
  eta: {
    fontSize: 13,
    fontWeight: '500',
    color: '#667085',
    marginTop: 2,
  },
  arrivalTime: {
    fontSize: 14,
    fontWeight: '700',
    color: '#22c55e',
  },
  offRoute: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ef4444',
    marginTop: 2,
  },
  liveShareBadge: {
    marginTop: 8,
    marginHorizontal: 16,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#FFFAEB',
    borderWidth: 1,
    borderColor: '#FEC84B',
  },
  liveShareBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B54708',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  recenterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#1570EF',
  },
  recenterText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: 12,
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
  arrivedBanner: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)' } : {}),
    elevation: 10,
    zIndex: 15,
  },
  arrivedText: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#101828',
  },
  dismissButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#22c55e',
  },
  dismissText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
