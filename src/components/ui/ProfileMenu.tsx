/**
 * ProfileMenu.tsx — Profile / account floating button + dropdown.
 *
 * Shows a person-circle icon. Tapping opens a small dropdown with
 * the user's name/email and a logout button. Positioned near the
 * search bar for easy access.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View
} from 'react-native';

interface Props {
  name: string | null;
  email: string | null;
  subscriptionTier?: string;
  onLogout: () => void;
  onManageSubscription?: () => void;
}

export function ProfileMenu({ name, email, subscriptionTier, onLogout, onManageSubscription }: Props) {
  const [open, setOpen] = useState(false);

  const handleLogout = useCallback(() => {
    setOpen(false);
    onLogout();
  }, [onLogout]);

  return (
    <>
      {/* Trigger button */}
      <Pressable
        style={styles.button}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Open profile menu"
        hitSlop={8}
      >
        <Ionicons name="person-circle-outline" size={26} color="#1E293B" />
      </Pressable>

      {/* Dropdown modal */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.menu}>
            {/* User info */}
            <View style={styles.userSection}>
              <Ionicons name="person-circle" size={40} color="#1570EF" />
              <View style={styles.userInfo}>
                {name ? (
                  <Text style={styles.userName} numberOfLines={1}>{name}</Text>
                ) : null}
                {email ? (
                  <Text style={styles.userEmail} numberOfLines={1}>{email}</Text>
                ) : (
                  <Text style={styles.userName}>Account</Text>
                )}
              </View>
            </View>

            <View style={styles.divider} />

            {/* Subscription */}
            {onManageSubscription && (
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setOpen(false);
                  onManageSubscription();
                }}
                accessibilityRole="button"
                accessibilityLabel="Manage subscription"
              >
                <Ionicons name="diamond-outline" size={20} color="#7C3AED" />
                <Text style={styles.subscriptionText}>
                  {subscriptionTier === 'free' ? 'Upgrade Plan' : 'Manage Plan'}
                </Text>
                {subscriptionTier && subscriptionTier !== 'free' && (
                  <View style={styles.tierBadge}>
                    <Text style={styles.tierBadgeText}>
                      {subscriptionTier === 'pro' ? 'Guarded' : subscriptionTier.charAt(0).toUpperCase() + subscriptionTier.slice(1)}
                    </Text>
                  </View>
                )}
              </Pressable>
            )}

            <View style={styles.divider} />

            {/* Logout */}
            <Pressable
              style={styles.menuItem}
              onPress={handleLogout}
              accessibilityRole="button"
              accessibilityLabel="Log out"
            >
              <Ionicons name="log-out-outline" size={20} color="#DC2626" />
              <Text style={styles.logoutText}>Log out</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 100,
    paddingRight: 16,
  },
  menu: {
    width: 240,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0px 8px 24px rgba(0,0,0,0.15)' }
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.15,
          shadowRadius: 24,
          elevation: 8,
        }),
    overflow: 'hidden',
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B',
  },
  userEmail: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E2E8F0',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#DC2626',
  },
  subscriptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#7C3AED',
    flex: 1,
  },
  tierBadge: {
    backgroundColor: '#F5F3FF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tierBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7C3AED',
  },
});
