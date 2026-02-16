/**
 * FamilyPackModal.tsx — Family/Friends Pack subscription UI.
 *
 * Allows creating a pack (3+ members), managing members, and
 * viewing pack status. £3/user/month (vs £4.99 individual).
 *
 * Two modes:
 *   - Setup: Enter member emails (min 2 others + you = 3 total)
 *   - Manage: View members, add/remove, see billing summary
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import {
    familyApi,
    type FamilyPackResult
} from '@/src/services/userApi';

interface Props {
  visible: boolean;
  onClose: () => void;
  onPackChanged?: () => void;
}

const PRICE_PER_USER = 3;
const MIN_MEMBERS = 3; // including owner

interface MemberInput {
  email: string;
  name: string;
}

export function FamilyPackModal({ visible, onClose, onPackChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Existing pack state
  const [packData, setPackData] = useState<FamilyPackResult | null>(null);

  // Setup mode state
  const [members, setMembers] = useState<MemberInput[]>([
    { email: '', name: '' },
    { email: '', name: '' },
  ]);
  const [packName, setPackName] = useState('');

  // Add member mode
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');

  const hasPack = !!packData?.pack;
  const isOwner = packData?.role === 'owner';

  // Load pack data when modal opens
  useEffect(() => {
    if (!visible) return;
    loadPack();
  }, [visible]);

  const loadPack = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await familyApi.getMyPack();
      setPackData(data);
    } catch (err) {
      // No pack is fine — show setup mode
      setPackData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Setup: add/remove member input rows ────────────────────────────────────

  const addMemberRow = useCallback(() => {
    setMembers((prev) => [...prev, { email: '', name: '' }]);
  }, []);

  const removeMemberRow = useCallback((index: number) => {
    setMembers((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateMember = useCallback((index: number, field: 'email' | 'name', value: string) => {
    setMembers((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  // ── Create pack ────────────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    setError(null);
    setSuccess(null);

    const validMembers = members.filter((m) => m.email.trim());
    if (validMembers.length < MIN_MEMBERS - 1) {
      setError(`Add at least ${MIN_MEMBERS - 1} other members (${MIN_MEMBERS} total including you).`);
      return;
    }

    // Validate emails
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const m of validMembers) {
      if (!emailRegex.test(m.email.trim())) {
        setError(`Invalid email: ${m.email}`);
        return;
      }
    }

    // Check for duplicates
    const emails = validMembers.map((m) => m.email.trim().toLowerCase());
    const unique = new Set(emails);
    if (unique.size !== emails.length) {
      setError('Duplicate emails found. Each member must have a unique email.');
      return;
    }

    setActionLoading(true);
    try {
      const result = await familyApi.create(
        validMembers.map((m) => ({ email: m.email.trim(), name: m.name.trim() || undefined })),
        packName.trim() || undefined,
      );
      setSuccess(result.message);
      await loadPack();
      onPackChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pack');
    } finally {
      setActionLoading(false);
    }
  }, [members, packName, loadPack, onPackChanged]);

  // ── Add member to existing pack ────────────────────────────────────────────

  const handleAddMember = useCallback(async () => {
    if (!newMemberEmail.trim()) return;
    setError(null);
    setActionLoading(true);
    try {
      const result = await familyApi.addMember(newMemberEmail.trim(), newMemberName.trim() || undefined);
      setSuccess(result.message);
      setNewMemberEmail('');
      setNewMemberName('');
      setShowAddMember(false);
      await loadPack();
      onPackChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setActionLoading(false);
    }
  }, [newMemberEmail, newMemberName, loadPack, onPackChanged]);

  // ── Remove member ──────────────────────────────────────────────────────────

  const handleRemoveMember = useCallback(async (email: string) => {
    const doRemove = async () => {
      setError(null);
      setActionLoading(true);
      try {
        const result = await familyApi.removeMember(email);
        setSuccess(result.message);
        await loadPack();
        onPackChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove member');
      } finally {
        setActionLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      if (confirm(`Remove ${email} from the pack?`)) {
        doRemove();
      }
    } else {
      Alert.alert(
        'Remove Member',
        `Remove ${email} from the pack? They will lose Guarded features.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: doRemove },
        ],
      );
    }
  }, [loadPack, onPackChanged]);

  // ── Cancel pack ────────────────────────────────────────────────────────────

  const handleCancel = useCallback(async () => {
    const doCancel = async () => {
      setError(null);
      setActionLoading(true);
      try {
        const result = await familyApi.cancel();
        setSuccess(result.message);
        setPackData(null);
        onPackChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to cancel pack');
      } finally {
        setActionLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      if (confirm('Cancel your Family Pack? All members will lose Guarded features.')) {
        doCancel();
      }
    } else {
      Alert.alert(
        'Cancel Pack',
        'All members will lose Guarded features and revert to the free plan.',
        [
          { text: 'Keep Pack', style: 'cancel' },
          { text: 'Cancel Pack', style: 'destructive', onPress: doCancel },
        ],
      );
    }
  }, [onPackChanged]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const totalMembers = hasPack
    ? packData!.stats.total
    : members.filter((m) => m.email.trim()).length + 1; // +1 for owner
  const totalPrice = totalMembers * PRICE_PER_USER;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="people" size={22} color="#7C3AED" />
              <Text style={styles.title}>Family & Friends Pack</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#374151" />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#7C3AED" />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* ── Pricing banner ── */}
              <View style={styles.pricingBanner}>
                <View style={styles.pricingRow}>
                  <Text style={styles.pricingAmount}>£3</Text>
                  <Text style={styles.pricingPer}>/user/month</Text>
                </View>
                <Text style={styles.pricingSave}>
                  Save £1.99 per person vs individual (£4.99/mo)
                </Text>
                <Text style={styles.pricingMin}>Minimum 3 members required</Text>
              </View>

              {hasPack ? (
                /* ── Manage existing pack ── */
                <>
                  {/* Pack info card */}
                  <View style={styles.packInfoCard}>
                    <View style={styles.packInfoHeader}>
                      <Ionicons name="shield-checkmark" size={20} color="#7C3AED" />
                      <Text style={styles.packInfoName}>{packData!.pack!.name}</Text>
                    </View>
                    <View style={styles.packInfoRow}>
                      <Text style={styles.packInfoLabel}>Status</Text>
                      <View style={[
                        styles.statusBadge,
                        { backgroundColor: packData!.pack!.status === 'active' ? '#DCFCE7' : '#FEF3C7' },
                      ]}>
                        <Text style={[
                          styles.statusText,
                          { color: packData!.pack!.status === 'active' ? '#166534' : '#92400E' },
                        ]}>
                          {packData!.pack!.status.charAt(0).toUpperCase() + packData!.pack!.status.slice(1)}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.packInfoRow}>
                      <Text style={styles.packInfoLabel}>Members</Text>
                      <Text style={styles.packInfoValue}>
                        {packData!.stats.active} active, {packData!.stats.pending} pending
                      </Text>
                    </View>
                    <View style={styles.packInfoRow}>
                      <Text style={styles.packInfoLabel}>Monthly total</Text>
                      <Text style={styles.packInfoPrice}>
                        £{packData!.pack!.totalMonthly.toFixed(2)}
                      </Text>
                    </View>
                    {!isOwner && (
                      <View style={styles.memberNotice}>
                        <Ionicons name="information-circle" size={16} color="#6366F1" />
                        <Text style={styles.memberNoticeText}>
                          Managed by {packData!.pack!.owner.name || packData!.pack!.owner.email}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Member list */}
                  <Text style={styles.sectionTitle}>Members</Text>
                  {(packData!.members || []).map((member) => (
                    <View key={member.id} style={styles.memberCard}>
                      <View style={styles.memberInfo}>
                        <View style={styles.memberNameRow}>
                          <Ionicons
                            name={member.role === 'owner' ? 'star' : 'person'}
                            size={16}
                            color={member.role === 'owner' ? '#F59E0B' : '#6B7280'}
                          />
                          <Text style={styles.memberName}>
                            {member.name || member.email}
                          </Text>
                          {member.role === 'owner' && (
                            <View style={styles.ownerBadge}>
                              <Text style={styles.ownerBadgeText}>Owner</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.memberEmail}>{member.email}</Text>
                        <View style={[
                          styles.memberStatusBadge,
                          {
                            backgroundColor:
                              member.status === 'active' ? '#DCFCE7' :
                              member.status === 'pending' ? '#FEF3C7' : '#FEE2E2',
                          },
                        ]}>
                          <Text style={[
                            styles.memberStatusText,
                            {
                              color:
                                member.status === 'active' ? '#166534' :
                                member.status === 'pending' ? '#92400E' : '#991B1B',
                            },
                          ]}>
                            {member.status === 'active' ? 'Active' :
                             member.status === 'pending' ? 'Pending' : 'Removed'}
                          </Text>
                        </View>
                      </View>
                      {isOwner && member.role !== 'owner' && (
                        <Pressable
                          style={styles.removeMemberBtn}
                          onPress={() => handleRemoveMember(member.email)}
                          disabled={actionLoading}
                        >
                          <Ionicons name="close-circle" size={22} color="#EF4444" />
                        </Pressable>
                      )}
                    </View>
                  ))}

                  {/* Add member (owner only) */}
                  {isOwner && (
                    <>
                      {showAddMember ? (
                        <View style={styles.addMemberForm}>
                          <TextInput
                            style={styles.input}
                            placeholder="Email address"
                            placeholderTextColor="#9CA3AF"
                            value={newMemberEmail}
                            onChangeText={setNewMemberEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                          />
                          <TextInput
                            style={styles.input}
                            placeholder="Name (optional)"
                            placeholderTextColor="#9CA3AF"
                            value={newMemberName}
                            onChangeText={setNewMemberName}
                          />
                          <View style={styles.addMemberBtns}>
                            <Pressable
                              style={styles.addMemberConfirm}
                              onPress={handleAddMember}
                              disabled={actionLoading}
                            >
                              {actionLoading ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <Text style={styles.addMemberConfirmText}>Add Member</Text>
                              )}
                            </Pressable>
                            <Pressable
                              style={styles.addMemberCancel}
                              onPress={() => setShowAddMember(false)}
                            >
                              <Text style={styles.addMemberCancelText}>Cancel</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <Pressable
                          style={styles.addMemberBtn}
                          onPress={() => setShowAddMember(true)}
                        >
                          <Ionicons name="add-circle-outline" size={20} color="#7C3AED" />
                          <Text style={styles.addMemberBtnText}>Add Member</Text>
                        </Pressable>
                      )}

                      {/* Cancel pack */}
                      <Pressable
                        style={styles.cancelPackBtn}
                        onPress={handleCancel}
                        disabled={actionLoading}
                      >
                        <Text style={styles.cancelPackBtnText}>Cancel Family Pack</Text>
                      </Pressable>
                    </>
                  )}
                </>
              ) : (
                /* ── Setup new pack ── */
                <>
                  <Text style={styles.sectionTitle}>Create Your Pack</Text>
                  <Text style={styles.setupDesc}>
                    Add at least 2 people below. You'll be included automatically as the owner.
                    Everyone gets full Guarded features.
                  </Text>

                  {/* Pack name */}
                  <TextInput
                    style={styles.input}
                    placeholder="Pack name (e.g. Smith Family)"
                    placeholderTextColor="#9CA3AF"
                    value={packName}
                    onChangeText={setPackName}
                  />

                  {/* Member inputs */}
                  {members.map((m, i) => (
                    <View key={i} style={styles.setupMemberRow}>
                      <View style={styles.setupMemberInputs}>
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          placeholder={`Member ${i + 1} email`}
                          placeholderTextColor="#9CA3AF"
                          value={m.email}
                          onChangeText={(v) => updateMember(i, 'email', v)}
                          keyboardType="email-address"
                          autoCapitalize="none"
                        />
                        <TextInput
                          style={[styles.input, { flex: 0.7 }]}
                          placeholder="Name"
                          placeholderTextColor="#9CA3AF"
                          value={m.name}
                          onChangeText={(v) => updateMember(i, 'name', v)}
                        />
                      </View>
                      {members.length > 2 && (
                        <Pressable
                          style={styles.removeRowBtn}
                          onPress={() => removeMemberRow(i)}
                        >
                          <Ionicons name="close-circle" size={22} color="#EF4444" />
                        </Pressable>
                      )}
                    </View>
                  ))}

                  <Pressable style={styles.addMemberBtn} onPress={addMemberRow}>
                    <Ionicons name="add-circle-outline" size={20} color="#7C3AED" />
                    <Text style={styles.addMemberBtnText}>Add Another Member</Text>
                  </Pressable>

                  {/* Price summary */}
                  <View style={styles.priceSummary}>
                    <View style={styles.priceRow}>
                      <Text style={styles.priceLabel}>Members (including you)</Text>
                      <Text style={styles.priceValue}>{totalMembers}</Text>
                    </View>
                    <View style={styles.priceRow}>
                      <Text style={styles.priceLabel}>Price per member</Text>
                      <Text style={styles.priceValue}>£{PRICE_PER_USER.toFixed(2)}/mo</Text>
                    </View>
                    <View style={[styles.priceRow, styles.priceTotalRow]}>
                      <Text style={styles.priceTotalLabel}>Monthly total</Text>
                      <Text style={styles.priceTotalValue}>£{totalPrice.toFixed(2)}</Text>
                    </View>
                    <Text style={styles.priceSavings}>
                      You save £{((4.99 - PRICE_PER_USER) * totalMembers).toFixed(2)}/month
                      vs {totalMembers} individual subscriptions
                    </Text>
                  </View>

                  {/* Create button */}
                  <Pressable
                    style={[
                      styles.createBtn,
                      totalMembers < MIN_MEMBERS && styles.createBtnDisabled,
                    ]}
                    onPress={handleCreate}
                    disabled={actionLoading || totalMembers < MIN_MEMBERS}
                  >
                    {actionLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.createBtnText}>
                        Create Pack — £{totalPrice.toFixed(2)}/month
                      </Text>
                    )}
                  </Pressable>
                </>
              )}

              {/* Error */}
              {error && (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle" size={16} color="#DC2626" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {/* Success */}
              {success && (
                <View style={styles.successBanner}>
                  <Ionicons name="checkmark-circle" size={16} color="#16A34A" />
                  <Text style={styles.successText}>{success}</Text>
                </View>
              )}

              <Text style={styles.footer}>
                All members get full Guarded features.{'\n'}
                The pack owner manages billing and members.
              </Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

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
    maxWidth: 440,
    maxHeight: '92%',
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  closeBtn: {
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
    gap: 14,
  },

  // ── Pricing banner ──
  pricingBanner: {
    backgroundColor: '#F5F3FF',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  pricingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  pricingAmount: {
    fontSize: 32,
    fontWeight: '800',
    color: '#7C3AED',
  },
  pricingPer: {
    fontSize: 14,
    color: '#6D28D9',
    fontWeight: '500',
  },
  pricingSave: {
    fontSize: 13,
    color: '#16A34A',
    fontWeight: '600',
    marginTop: 4,
  },
  pricingMin: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },

  // ── Pack info card ──
  packInfoCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  packInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  packInfoName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  packInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  packInfoLabel: {
    fontSize: 13,
    color: '#6B7280',
  },
  packInfoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  packInfoPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: '#7C3AED',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  memberNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EEF2FF',
    padding: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  memberNoticeText: {
    fontSize: 12,
    color: '#4338CA',
    fontWeight: '500',
  },

  // ── Section title ──
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
  },

  // ── Member card ──
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
  },
  memberInfo: {
    flex: 1,
    gap: 4,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  memberEmail: {
    fontSize: 12,
    color: '#6B7280',
  },
  ownerBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ownerBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  memberStatusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  memberStatusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  removeMemberBtn: {
    padding: 8,
  },

  // ── Add member ──
  addMemberBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: '#DDD6FE',
    borderRadius: 10,
    borderStyle: 'dashed',
  } as any,
  addMemberBtnText: {
    fontSize: 14,
    color: '#7C3AED',
    fontWeight: '600',
  },
  addMemberForm: {
    gap: 10,
    backgroundColor: '#F5F3FF',
    borderRadius: 12,
    padding: 14,
  },
  addMemberBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  addMemberConfirm: {
    flex: 1,
    backgroundColor: '#7C3AED',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  addMemberConfirmText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  addMemberCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  addMemberCancelText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '500',
  },

  // ── Cancel pack ──
  cancelPackBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelPackBtnText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },

  // ── Setup mode ──
  setupDesc: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#111827',
  },
  setupMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  setupMemberInputs: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  removeRowBtn: {
    padding: 4,
  },

  // ── Price summary ──
  priceSummary: {
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 13,
    color: '#6B7280',
  },
  priceValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  priceTotalRow: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 8,
    marginTop: 4,
  },
  priceTotalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  priceTotalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#7C3AED',
  },
  priceSavings: {
    fontSize: 12,
    color: '#16A34A',
    fontWeight: '500',
    textAlign: 'center',
  },

  // ── Create button ──
  createBtn: {
    backgroundColor: '#7C3AED',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnDisabled: {
    opacity: 0.5,
  },
  createBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },

  // ── Error / Success ──
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
    backgroundColor: '#F0FDF4',
    padding: 12,
    borderRadius: 10,
  },
  successText: {
    fontSize: 13,
    color: '#16A34A',
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
