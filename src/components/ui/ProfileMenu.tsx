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
    Alert,
    Linking,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View
} from 'react-native';
import { authApi } from '../../services/userApi';
import { ChangePasswordModal } from '../modals/ChangePasswordModal';
import PrivacyPolicyModal from '../modals/PrivacyPolicyModal';
import RefundPolicyModal from '../modals/RefundPolicyModal';
import TermsModal from '../modals/TermsModal';

const POLICIES_URL = 'https://safenight.netlify.app/privacy';

interface Props {
  name: string | null;
  email: string | null;
  subscriptionTier?: string;
  isGift?: boolean;
  subscriptionEndsAt?: string | null;
  onLogout: () => void;
  onManageSubscription?: () => void;
  onChangePassword: (newPassword: string) => Promise<boolean>;
}

export function ProfileMenu({ name, email, subscriptionTier, isGift, subscriptionEndsAt, onLogout, onManageSubscription, onChangePassword }: Props) {
  const [open, setOpen] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [refundVisible, setRefundVisible] = useState(false);
  const [termsVisible, setTermsVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [changePasswordVisible, setChangePasswordVisible] = useState(false);

  const handleLogout = useCallback(() => {
    setOpen(false);
    onLogout();
  }, [onLogout]);

  const handleDeleteAccount = useCallback(() => {
    setOpen(false);
    const doDelete = async () => {
      setIsDeleting(true);
      try {
        await authApi.deleteAccount();
        if (Platform.OS === 'web') {
          window.alert('Your account and all data have been permanently deleted.');
        } else {
          Alert.alert('Account Deleted', 'Your account and all data have been permanently deleted.');
        }
      } catch (err: any) {
        const msg = err?.message || 'Failed to delete account';
        if (Platform.OS === 'web') {
          window.alert(msg);
        } else {
          Alert.alert('Error', msg);
        }
      } finally {
        setIsDeleting(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to permanently delete your account? All your data will be erased. This cannot be undone.')) {
        doDelete();
      }
    } else {
      Alert.alert(
        'Delete Account',
        'Are you sure you want to permanently delete your account? All your data will be erased. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete },
        ],
      );
    }
  }, []);

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
              <>
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
                        {isGift ? '🎁 Gift' : (subscriptionTier === 'pro' ? 'Guarded' : subscriptionTier.charAt(0).toUpperCase() + subscriptionTier.slice(1))}
                      </Text>
                    </View>
                  )}
                </Pressable>
                {subscriptionEndsAt && subscriptionTier !== 'free' && (
                  <View style={styles.endDateRow}>
                    <Ionicons name="calendar-outline" size={14} color="#6B7280" />
                    <Text style={styles.endDateText}>
                      {isGift ? 'Gift ends: ' : 'Renews: '}
                      {new Date(subscriptionEndsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Text>
                  </View>
                )}
              </>
            )}

            <View style={styles.divider} />

            {/* ── Settings section ── */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>SETTINGS</Text>
            </View>

            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setOpen(false);
                setChangePasswordVisible(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Change password"
            >
              <Ionicons name="lock-closed-outline" size={20} color="#475569" />
              <Text style={styles.settingsText}>Change Password</Text>
            </Pressable>

            <View style={styles.divider} />

            {/* Policies — single external link on native, individual modals on web */}
            {Platform.OS !== 'web' ? (
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setOpen(false);
                  Linking.openURL(POLICIES_URL);
                }}
                accessibilityRole="link"
                accessibilityLabel="SafeNight Policies"
              >
                <Ionicons name="document-text-outline" size={20} color="#1570EF" />
                <Text style={styles.privacyText}>SafeNight Policies</Text>
                <Ionicons name="open-outline" size={14} color="#94A3B8" style={{ marginLeft: 'auto' }} />
              </Pressable>
            ) : (
              <>
                <Pressable
                  style={styles.menuItem}
                  onPress={() => { setOpen(false); setPrivacyVisible(true); }}
                  accessibilityRole="button"
                  accessibilityLabel="Privacy Policy"
                >
                  <Ionicons name="shield-checkmark-outline" size={20} color="#1570EF" />
                  <Text style={styles.privacyText}>Privacy Policy</Text>
                </Pressable>
                <View style={styles.divider} />
                <Pressable
                  style={styles.menuItem}
                  onPress={() => { setOpen(false); setRefundVisible(true); }}
                  accessibilityRole="button"
                  accessibilityLabel="Refund & Payment Policy"
                >
                  <Ionicons name="card-outline" size={20} color="#1570EF" />
                  <Text style={styles.privacyText}>Refund & Payment</Text>
                </Pressable>
                <View style={styles.divider} />
                <Pressable
                  style={styles.menuItem}
                  onPress={() => { setOpen(false); setTermsVisible(true); }}
                  accessibilityRole="button"
                  accessibilityLabel="Terms & Conditions"
                >
                  <Ionicons name="reader-outline" size={20} color="#1570EF" />
                  <Text style={styles.privacyText}>Terms & Conditions</Text>
                </Pressable>
              </>
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

            <View style={styles.divider} />

            {/* Delete Account */}
            <Pressable
              style={styles.menuItem}
              onPress={handleDeleteAccount}
              disabled={isDeleting}
              accessibilityRole="button"
              accessibilityLabel="Delete account"
            >
              <Ionicons name="trash-outline" size={20} color="#991B1B" />
              <Text style={styles.deleteText}>
                {isDeleting ? 'Deleting…' : 'Delete Account'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Policy Modals (web only) */}
      <PrivacyPolicyModal
        visible={privacyVisible}
        onClose={() => setPrivacyVisible(false)}
      />
      <RefundPolicyModal
        visible={refundVisible}
        onClose={() => setRefundVisible(false)}
      />
      <TermsModal
        visible={termsVisible}
        onClose={() => setTermsVisible(false)}
      />
      <ChangePasswordModal
        visible={changePasswordVisible}
        onClose={() => setChangePasswordVisible(false)}
        onChangePassword={onChangePassword}
        email={email}
      />
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
  endDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 0,
    gap: 6,
  },
  endDateText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  privacyText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1570EF',
  },
  deleteText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#991B1B',
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  sectionHeaderText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1,
  },
  settingsText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1E293B',
  },
});
