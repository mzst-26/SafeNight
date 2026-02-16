/**
 * SubscriptionModal.tsx — Upgrade / Manage subscription UI.
 *
 * Shows available plans, current plan status, and handles:
 *   - Upgrade via Stripe Checkout (opens browser)
 *   - Manage/Cancel via Stripe Customer Portal (opens browser)
 *
 * Works on both mobile (Linking.openURL) and web (window.open).
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Linking,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { stripeApi, type StripePlan, type SubscriptionStatus } from '@/src/services/stripeApi';

interface Props {
  visible: boolean;
  currentTier: string;
  onClose: () => void;
  /** Called after a successful action so the parent can refresh user data */
  onSubscriptionChanged?: () => void;
}

const TIER_COLORS: Record<string, string> = {
  free: '#6B7280',
  pro: '#7C3AED',
};

const TIER_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  free: 'shield-outline',
  pro: 'shield-checkmark',
};

const FEATURE_HIGHLIGHTS: Record<string, string[]> = {
  pro: [
    'Unlimited route searches',
    'Up to 10km walking routes',
    'Unlimited navigation sessions',
    '5 emergency contacts',
    '10 AI explanations/day',
    'Unlimited live sharing',
  ],
};

export function SubscriptionModal({ visible, currentTier, onClose, onSubscriptionChanged }: Props) {
  const [plans, setPlans] = useState<StripePlan[]>([]);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load plans and status when modal opens
  useEffect(() => {
    if (!visible) return;

    setLoading(true);
    setError(null);

    Promise.all([
      stripeApi.getPlans().catch(() => [] as StripePlan[]),
      stripeApi.getStatus().catch(() => null),
    ]).then(([fetchedPlans, fetchedStatus]) => {
      setPlans(fetchedPlans);
      setStatus(fetchedStatus);
      setLoading(false);
    });
  }, [visible]);

  const openUrl = useCallback((url: string) => {
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  }, []);

  const handleUpgrade = useCallback(
    async (tier: 'pro') => {
      setActionLoading(tier);
      setError(null);

      try {
        const result = await stripeApi.createCheckout(tier);
        openUrl(result.url);
        // Close modal after redirecting
        setTimeout(() => {
          onClose();
          onSubscriptionChanged?.();
        }, 1000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start checkout');
      } finally {
        setActionLoading(null);
      }
    },
    [openUrl, onClose, onSubscriptionChanged],
  );

  const handleManage = useCallback(async () => {
    setActionLoading('manage');
    setError(null);

    try {
      const result = await stripeApi.createPortal();
      openUrl(result.url);
      setTimeout(() => {
        onClose();
        onSubscriptionChanged?.();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open subscription manager');
    } finally {
      setActionLoading(null);
    }
  }, [openUrl, onClose, onSubscriptionChanged]);

  const isPaid = currentTier === 'pro';
  const stripeSub = status?.stripeSubscription;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {isPaid ? 'Manage Subscription' : 'Upgrade Your Plan'}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#374151" />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#7C3AED" />
              <Text style={styles.loadingText}>Loading plans...</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Current plan badge */}
              <View style={[styles.currentPlanBadge, { backgroundColor: TIER_COLORS[currentTier] + '15' }]}>
                <Ionicons
                  name={TIER_ICONS[currentTier] || 'shield-outline'}
                  size={20}
                  color={TIER_COLORS[currentTier]}
                />
                <Text style={[styles.currentPlanText, { color: TIER_COLORS[currentTier] }]}>
                  Current plan: {currentTier === 'pro' ? 'Guarded' : 'Free'}
                </Text>
              </View>

              {/* Active Stripe subscription info */}
              {stripeSub && (
                <View style={styles.subInfoCard}>
                  <Text style={styles.subInfoTitle}>Subscription Details</Text>
                  <View style={styles.subInfoRow}>
                    <Text style={styles.subInfoLabel}>Status</Text>
                    <Text style={[
                      styles.subInfoValue,
                      { color: stripeSub.status === 'active' ? '#10B981' : '#F59E0B' },
                    ]}>
                      {stripeSub.status.charAt(0).toUpperCase() + stripeSub.status.slice(1)}
                    </Text>
                  </View>
                  <View style={styles.subInfoRow}>
                    <Text style={styles.subInfoLabel}>Renews</Text>
                    <Text style={styles.subInfoValue}>
                      {new Date(stripeSub.currentPeriodEnd).toLocaleDateString()}
                    </Text>
                  </View>
                  {stripeSub.cancelAtPeriodEnd && (
                    <View style={styles.cancelNotice}>
                      <Ionicons name="warning" size={14} color="#F59E0B" />
                      <Text style={styles.cancelNoticeText}>
                        Cancels at end of billing period
                      </Text>
                    </View>
                  )}
                  <Pressable
                    style={styles.manageButton}
                    onPress={handleManage}
                    disabled={actionLoading === 'manage'}
                  >
                    {actionLoading === 'manage' ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="settings-outline" size={16} color="#fff" />
                        <Text style={styles.manageButtonText}>Manage Subscription</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              )}

              {/* Plan cards */}
              {plans
                .filter((p) => p.tier !== currentTier)
                .map((plan) => (
                  <View
                    key={plan.tier}
                    style={[styles.planCard, { borderColor: TIER_COLORS[plan.tier] }]}
                  >
                    <View style={styles.planHeader}>
                      <Ionicons
                        name={TIER_ICONS[plan.tier] || 'shield'}
                        size={28}
                        color={TIER_COLORS[plan.tier]}
                      />
                      <View style={styles.planHeaderText}>
                        <Text style={styles.planName}>{plan.name}</Text>
                        <Text style={styles.planPrice}>
                          £{plan.priceGBP.toFixed(2)}
                          <Text style={styles.planPeriod}>/month</Text>
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.planDescription}>{plan.description}</Text>

                    {/* Feature list */}
                    <View style={styles.featureList}>
                      {(FEATURE_HIGHLIGHTS[plan.tier] || []).map((feature, i) => (
                        <View key={i} style={styles.featureRow}>
                          <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                          <Text style={styles.featureText}>{feature}</Text>
                        </View>
                      ))}
                    </View>

                    <Pressable
                      style={[
                        styles.upgradeButton,
                        { backgroundColor: TIER_COLORS[plan.tier] },
                        !plan.available && styles.disabledButton,
                      ]}
                      onPress={() => handleUpgrade(plan.tier as 'pro')}
                      disabled={!plan.available || actionLoading === plan.tier}
                    >
                      {actionLoading === plan.tier ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.upgradeButtonText}>
                          {!plan.available
                            ? 'Coming Soon'
                            : isPaid
                              ? `Switch to ${plan.name}`
                              : `Upgrade to ${plan.name}`}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                ))}

              {/* Cancel / downgrade for paid users without Stripe sub info */}
              {isPaid && !stripeSub && (
                <Pressable
                  style={styles.cancelButton}
                  onPress={handleManage}
                  disabled={actionLoading === 'manage'}
                >
                  {actionLoading === 'manage' ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <Text style={styles.cancelButtonText}>Cancel Subscription</Text>
                  )}
                </Pressable>
              )}

              {/* Error */}
              {error && (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle" size={16} color="#DC2626" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {/* Footer note */}
              <Text style={styles.footer}>
                Payments processed securely by Stripe.{'\n'}
                Cancel anytime from the subscription manager.
              </Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  container: {
    backgroundColor: '#fff',
    borderRadius: 20,
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }
      : { elevation: 20 }),
  } as any,
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingWrap: {
    padding: 48,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  currentPlanBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  currentPlanText: {
    fontSize: 14,
    fontWeight: '600',
  },
  subInfoCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  subInfoTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  subInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subInfoLabel: {
    fontSize: 13,
    color: '#6B7280',
  },
  subInfoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  cancelNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  cancelNoticeText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '500',
  },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#374151',
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
  },
  manageButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  planCard: {
    borderWidth: 2,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  planHeaderText: {
    flex: 1,
  },
  planName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  planPrice: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  planPeriod: {
    fontSize: 14,
    fontWeight: '400',
    color: '#6B7280',
  },
  planDescription: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  featureList: {
    gap: 6,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureText: {
    fontSize: 13,
    color: '#374151',
    flex: 1,
  },
  upgradeButton: {
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.5,
  },
  cancelButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    padding: 12,
    borderRadius: 10,
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
    flex: 1,
  },
  footer: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 4,
  },
});
