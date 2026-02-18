/**
 * NavigationOverlay — Turn-by-turn UI during active navigation.
 */
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { NavigationInfo } from '@/src/hooks/useNavigation';
import { formatDuration, formatNavDistance, maneuverIcon, stripHtml } from '@/src/utils/format';

interface NavigationOverlayProps {
  nav: NavigationInfo;
  topInset: number;
  bottomInset: number;
}

export function NavigationOverlay({ nav, topInset, bottomInset }: NavigationOverlayProps) {
  const isActive = nav.state === 'navigating' || nav.state === 'off-route';

  if (!isActive && nav.state !== 'arrived') return null;

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
          <View style={[styles.bottomBar, { marginBottom: bottomInset + 8 }]}>
            <View>
              <Text style={styles.remaining}>
                {formatNavDistance(nav.remainingDistance)} remaining
              </Text>
              <Text style={styles.eta}>
                ETA{' '}
                <Text style={styles.arrivalTime}>
                  {new Date(Date.now() + nav.remainingDuration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                {' · '}{formatDuration(nav.remainingDuration)} walking
              </Text>
              {nav.state === 'off-route' && (
                <Text style={styles.offRoute}>Off route — rerouting…</Text>
              )}
            </View>
            <Pressable style={styles.stopButton} onPress={nav.stop}>
              <Ionicons name="stop-circle" size={20} color="#ffffff" />
              <Text style={styles.stopText}>Stop</Text>
            </Pressable>
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
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    margin: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)' } : {}),
    elevation: 10,
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
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: '#ef4444',
  },
  stopText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
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
