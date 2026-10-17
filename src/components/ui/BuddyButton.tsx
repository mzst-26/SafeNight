/**
 * BuddyButton.tsx — Small floating button on the map.
 *
 * Shows a QR/people icon. Tapping opens the BuddyModal.
 * When a contact is live (walking), shows a green pulse dot.
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import BuddyModal from '../modals/BuddyModal';
import { MapGlassButton } from './MapGlassButton';

interface Props {
  username: string | null;
  userId: string | null;
  hasLiveContacts?: boolean;
  onContactsChanged?: () => void;
}

export function BuddyButton({ username, userId, hasLiveContacts = false, onContactsChanged }: Props) {
  const [visible, setVisible] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for live contacts
  useEffect(() => {
    if (!hasLiveContacts) {
      pulseAnim.setValue(1);
      return;
    }

    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.4,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [hasLiveContacts, pulseAnim]);

  return (
    <>
      <View style={styles.container}>
        <MapGlassButton
          active={hasLiveContacts}
          onPress={() => setVisible(true)}
          icon={hasLiveContacts ? 'people' : 'qr-code'}
          iconColor="#101828"
          activeColor="#16A34A"
          label="Open Safety Circle"
        >
          {hasLiveContacts && (
            <Animated.View
              style={[
                styles.liveDot,
                { transform: [{ scale: pulseAnim }] },
              ]}
            />
          )}
        </MapGlassButton>
      </View>

      <BuddyModal
        visible={visible}
        onClose={() => setVisible(false)}
        username={username}
        userId={userId}
        onContactsChanged={onContactsChanged}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 100,
  },
  button: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  liveDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
});
