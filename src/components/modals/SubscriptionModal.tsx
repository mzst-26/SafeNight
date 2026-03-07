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
import { memo, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { stripeApi, type SubscriptionStatus } from '@/src/services/stripeApi';

/** Local plan definitions — no need to fetch from Stripe API */
interface LocalPlan {
  tier: string;
  name: string;
  description: string;
  priceGBP: number;
  period: string;
  features: string[];
}

const LOCAL_PLANS: LocalPlan[] = [
  {
    tier: 'pro',
    name: 'Guarded',
    description: 'Full safety suite for regular walkers',
    priceGBP: 4.99,
    period: '/month',
    features: [
      'Unlimited route searches',
      'Up to 6 mile walking routes',
      'Unlimited navigation sessions',
      '5 emergency contacts',
      '10 AI explanations/day',
      'Unlimited live sharing',
    ],
  },
];

interface Props {
  visible: boolean;
  currentTier: string;
  isGift?: boolean;
  isFamilyPack?: boolean;
  subscriptionEndsAt?: string | null;
  onClose: () => void;
  /** Called after a successful action so the parent can refresh user data */
  onSubscriptionChanged?: () => void;
  /** Open the Family Pack modal */
  onOpenFamilyPack?: () => void;
}

const TIER_COLORS: Record<string, string> = {
  free: '#6B7280',
  pro: '#7C3AED',
};

const TIER_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  free: 'shield-outline',
  pro: 'shield-checkmark',
};

function SubscriptionModalInner({ visible, currentTier, isGift, isFamilyPack, subscriptionEndsAt, onClose, onSubscriptionChanged, onOpenFamilyPack }: Props) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /** Turn raw errors into user-friendly messages */
  const friendlyError = (err: unknown, fallback: string): string => {
    const msg = err instanceof Error ? err.message : '';
    if (/network|failed to fetch|timeout|econnrefused|unreachable|load failed/i.test(msg)) {
      return 'Oops! The server seems unreachable. Please reload and try again later.';
    }
    return err instanceof Error ? err.message : fallback;
  };

  // Only fetch subscription status (not plans — those are defined locally)
  useEffect(() => {
    if (!visible) return;

    const controller = new AbortController();
    setStatusLoading(true);
    setError(null);
    setSuccess(null);

    const startTime = Date.now();
    stripeApi.getStatus(controller.signal)
      .then((fetchedStatus) => {
        console.log(`[SubscriptionModal] getStatus SUCCESS (${Date.now() - startTime}ms):`);
        if (!controller.signal.aborted) {
          setStatus(fetchedStatus);
        }
      })
      .catch((err) => {
        console.error(`[SubscriptionModal] getStatus FAILED (${Date.now() - startTime}ms):`, err?.message ?? err);
        if (!controller.signal.aborted) {
          const msg = friendlyError(err, 'Failed to load subscription status');
          setError(msg);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatusLoading(false);
      });

    return () => {
      console.log('[SubscriptionModal] Cleanup — aborting fetch');
      controller.abort();
    };
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
        setError(friendlyError(err, 'Failed to start checkout'));
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
      setError(friendlyError(err, 'Failed to open subscription manager'));
    } finally {
      setActionLoading(null);
    }
  }, [openUrl, onClose, onSubscriptionChanged]);

  const handleCancel = useCallback(async () => {
    const doCancel = async () => {
      setActionLoading('cancel');
      setError(null);
      setSuccess(null);
      try {
        const result = await stripeApi.cancelSubscription();
        setSuccess(result.message);
        // Refresh status so UI updates (e.g. cancelAtPeriodEnd becomes true)
        const refreshed = await stripeApi.getStatus().catch(() => null);
        setStatus(refreshed);
        onSubscriptionChanged?.();
      } catch (err) {
        setError(friendlyError(err, 'Failed to cancel subscription'));
      } finally {
        setActionLoading(null);
      }
    };

    if (Platform.OS === 'web') {
      if (confirm('Cancel your subscription? If this is your first subscription and you are within 14 days of your billing date, you will receive a full refund. Otherwise your subscription stays active until the end of the billing period.')) {
        doCancel();
      }
    } else {
      Alert.alert(
        'Cancel Subscription',
        'If this is your first subscription and you are within 14 days of your billing date, you will receive a full refund. The 14-day cooling-off refund applies to first subscriptions only. Otherwise your subscription stays active until the end of the billing period.',
        [
          { text: 'Keep Subscription', style: 'cancel' },
          { text: 'Cancel Subscription', style: 'destructive', onPress: doCancel },
        ],
      );
    }
  }, [onSubscriptionChanged]);

  // Family pack members are always on the 'pro' tier, even if the profile
  // denormalized field hasn't been updated yet. Avoid "Free (Family Pack)".
  const effectiveTier = isFamilyPack ? 'pro' : currentTier;
  const isPaid = effectiveTier === 'pro';
  const stripeSub = status?.stripeSubscription;

  const filteredPlans = LOCAL_PLANS.filter((p) => p.tier !== effectiveTier);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.container, Platform.OS !== 'web' && { height: Dimensions.get('window').height * 0.85 }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {isPaid || isFamilyPack ? 'Manage Subscription' : 'Upgrade Your Plan'}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#374151" />
            </Pressable>
          </View>

          <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Current plan badge */}
              <View style={[styles.currentPlanBadge, { backgroundColor: TIER_COLORS[effectiveTier] + '15' }]}>
                <Ionicons
                  name={TIER_ICONS[effectiveTier] || 'shield-outline'}
                  size={20}
                  color={TIER_COLORS[effectiveTier]}
                />
                <Text style={[styles.currentPlanText, { color: TIER_COLORS[effectiveTier] }]}>
                  Current plan: {effectiveTier === 'pro' ? 'Guarded' : 'Free'}
                  {isGift ? ' (Gift)' : ''}
                  {isFamilyPack ? ' (Family Pack)' : ''}
                </Text>
              </View>

              {/* Gift subscription info */}
              {isGift && subscriptionEndsAt && currentTier === 'pro' && (
                <View style={styles.giftInfoCard}>
                  <View style={styles.giftInfoHeader}>
                    <Text style={styles.giftInfoEmoji}>🎁</Text>
                    <Text style={styles.giftInfoTitle}>Gifted Subscription</Text>
                  </View>
                  <Text style={styles.giftInfoText}>
                    You were gifted a Guarded subscription for being one of our first users!
                  </Text>
                  <View style={styles.giftInfoDateRow}>
                    <Ionicons name="calendar-outline" size={16} color="#7C3AED" />
                    <Text style={styles.giftInfoDate}>
                      Gift ends: {new Date(subscriptionEndsAt).toLocaleDateString('en-GB', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </Text>
                  </View>
                </View>
              )}

              {/* Subscription end date (non-gift, paid) */}
              {!isGift && subscriptionEndsAt && currentTier === 'pro' && !stripeSub && (
                <View style={styles.endDateCard}>
                  <Ionicons name="time-outline" size={18} color="#6B7280" />
                  <Text style={styles.endDateCardText}>
                    Subscription ends: {new Date(subscriptionEndsAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </Text>
                </View>
              )}

              {/* Subscription details — inline loader while status is fetching */}
              {statusLoading && (
                <View style={styles.statusLoadingRow}>
                  <ActivityIndicator size="small" color="#7C3AED" />
                  <Text style={styles.statusLoadingText}>Loading subscription details…</Text>
                </View>
              )}

              {/* Active Stripe subscription info */}
              {!statusLoading && stripeSub && (
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
                        Your subscription will end on {new Date(stripeSub.currentPeriodEnd).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'long', year: 'numeric',
                        })}. No further charges will be made.
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
                  {!stripeSub.cancelAtPeriodEnd && !isFamilyPack && (
                    <Pressable
                      style={styles.cancelButton}
                      onPress={handleCancel}
                      disabled={actionLoading === 'cancel'}
                    >
                      {actionLoading === 'cancel' ? (
                        <ActivityIndicator size="small" color="#EF4444" />
                      ) : (
                        <Text style={styles.cancelButtonText}>Cancel Subscription</Text>
                      )}
                    </Pressable>
                  )}
                </View>
              )}

              {/* Plan cards — only show plans the user is NOT currently on */}
              {filteredPlans.length === 0 && (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: '#6B7280' }}>You're on the top plan!</Text>
                </View>
              )}
              {filteredPlans
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
                          <Text style={styles.planPeriod}>{plan.period}</Text>
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.planDescription}>{plan.description}</Text>

                    {/* Feature list */}
                    <View style={styles.featureList}>
                      {plan.features.map((feature, i) => (
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
                      ]}
                      onPress={() => handleUpgrade(plan.tier as 'pro')}
                      disabled={actionLoading === plan.tier}
                    >
                      {actionLoading === plan.tier ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.upgradeButtonText}>
                          {isPaid
                            ? `Switch to ${plan.name}`
                            : `Upgrade to ${plan.name}`}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                ))}

              {/* Family Pack sub-user: show info notice instead of cancel */}
              {!statusLoading && isPaid && isFamilyPack && !stripeSub && (
                <View style={styles.familyNotice}>
                  <Ionicons name="information-circle" size={20} color="#7C3AED" />
                  <Text style={styles.familyNoticeText}>
                    Your subscription is managed by your Family Pack owner. To cancel, please ask the pack owner.
                  </Text>
                </View>
              )}

              {/* Cancel / downgrade for paid users without Stripe sub info (non-family) */}
              {!statusLoading && isPaid && !isFamilyPack && !stripeSub && (
                <Pressable
                  style={styles.cancelButton}
                  onPress={handleCancel}
                  disabled={actionLoading === 'cancel'}
                >
                  {actionLoading === 'cancel' ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <Text style={styles.cancelButtonText}>Cancel Subscription</Text>
                  )}
                </Pressable>
              )}

              {/* Family & Friends Pack option */}
              {onOpenFamilyPack && (
                <Pressable
                  style={styles.familyPackCard}
                  onPress={() => {
                    onClose();
                    setTimeout(() => onOpenFamilyPack(), 300);
                  }}
                >
                  <View style={styles.familyPackHeader}>
                    <Ionicons name="people" size={24} color="#7C3AED" />
                    <View style={styles.familyPackHeaderText}>
                      <Text style={styles.familyPackTitle}>Family & Friends Pack</Text>
                      <Text style={styles.familyPackPrice}>
                        £3<Text style={styles.familyPackPriceSub}>/user/month</Text>
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.familyPackDesc}>
                    {isFamilyPack
                      ? 'Manage your Family Pack members and billing.'
                      : 'Get Guarded for 3+ people at £3/each. Save £1.99 per person!'}
                  </Text>
                  <View style={styles.familyPackCta}>
                    <Text style={styles.familyPackCtaText}>
                      {isFamilyPack ? 'Manage Pack' : 'Create Pack'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color="#7C3AED" />
                  </View>
                </Pressable>
              )}

              {/* Error */}
              {error && (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle" size={16} color="#DC2626" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {/* Debug banner removed (was showing Platform/API debugInfo) */}

              {/* Success */}
              {success && (
                <View style={styles.successBanner}>
                  <Ionicons name="checkmark-circle" size={16} color="#059669" />
                  <Text style={styles.successText}>{success}</Text>
                </View>
              )}

              {/* Footer note */}
              <Text style={styles.footer}>
                Payments processed securely by Stripe.{'\n'}
                14-day cooling-off: cancel within 14 days for a full refund (first subscription only).
              </Text>
            </ScrollView>
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
    flexShrink: 1,
    flexGrow: 0,
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
  statusLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
  },
  statusLoadingText: {
    fontSize: 13,
    color: '#6B7280',
  },
  scroll: {
    flexGrow: 1,
    flexShrink: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
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
  cancelButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  familyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#7C3AED10',
    padding: 14,
    borderRadius: 10,
    marginTop: 4,
  },
  familyNoticeText: {
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
    lineHeight: 18,
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
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    padding: 12,
    borderRadius: 10,
  },
  successText: {
    fontSize: 13,
    color: '#059669',
    flex: 1,
  },
  footer: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 4,
  },
  giftInfoCard: {
    backgroundColor: '#F5F3FF',
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  giftInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  giftInfoEmoji: {
    fontSize: 20,
  },
  giftInfoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#7C3AED',
  },
  giftInfoText: {
    fontSize: 13,
    color: '#6D28D9',
    lineHeight: 18,
  },
  giftInfoDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  giftInfoDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7C3AED',
  },
  endDateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  endDateCardText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
  },
  familyPackCard: {
    borderWidth: 2,
    borderColor: '#DDD6FE',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    backgroundColor: '#FAFAFF',
  },
  familyPackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  familyPackHeaderText: {
    flex: 1,
  },
  familyPackTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  familyPackPrice: {
    fontSize: 20,
    fontWeight: '800',
    color: '#7C3AED',
  },
  familyPackPriceSub: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6B7280',
  },
  familyPackDesc: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  familyPackCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F5F3FF',
    paddingVertical: 10,
    borderRadius: 10,
  },
  familyPackCtaText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7C3AED',
  },
});

export const SubscriptionModal = memo(SubscriptionModalInner);
