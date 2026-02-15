/**
 * ReportModal — Google Maps-style hazard reporting popup.
 *
 * Quick-pick category grid + optional description.
 * Submits to reportsApi using the user's current location.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { reportsApi, type ReportCategory } from '@/src/services/userApi';

type IoniconsName = keyof typeof Ionicons.glyphMap;

interface CategoryOption {
  id: ReportCategory;
  label: string;
  icon: IoniconsName;
  color: string;
  bgColor: string;
}

const CATEGORIES: CategoryOption[] = [
  { id: 'poor_lighting', label: 'Poor Lighting', icon: 'flashlight-outline', color: '#F59E0B', bgColor: '#FEF3C7' },
  { id: 'unsafe_area', label: 'Unsafe Area', icon: 'warning-outline', color: '#EF4444', bgColor: '#FEE2E2' },
  { id: 'obstruction', label: 'Obstruction', icon: 'construct-outline', color: '#F97316', bgColor: '#FFEDD5' },
  { id: 'harassment', label: 'Harassment', icon: 'hand-left-outline', color: '#DC2626', bgColor: '#FECACA' },
  { id: 'other', label: 'Other', icon: 'alert-circle-outline', color: '#6B7280', bgColor: '#F3F4F6' },
];

interface Props {
  visible: boolean;
  location: { latitude: number; longitude: number } | null;
  onClose: () => void;
  onSubmitted: (category: ReportCategory) => void;
}

export function ReportModal({ visible, location, onClose, onSubmitted }: Props) {
  const [selected, setSelected] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!selected || !location) return;
    setSubmitting(true);
    setError(null);
    try {
      await reportsApi.submit({
        lat: location.latitude,
        lng: location.longitude,
        category: selected,
        description: description.trim(),
      });
      Alert.alert(
        'Report Submitted',
        'Thank you for helping keep others safe. Your report has been recorded.',
        [{ text: 'OK' }],
      );
      onSubmitted(selected);
      // Reset state
      setSelected(null);
      setDescription('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit report';
      setError(msg);
      Alert.alert(
        'Submission Failed',
        `Your report could not be submitted. ${msg}`,
        [{ text: 'OK' }],
      );
    } finally {
      setSubmitting(false);
    }
  }, [selected, location, description, onSubmitted]);

  const handleClose = useCallback(() => {
    setSelected(null);
    setDescription('');
    setError(null);
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <View style={styles.sheet}>
            {/* Handle bar */}
            <View style={styles.handleBar} />

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={styles.headerIcon}>
                  <Ionicons name="flag" size={20} color="#EF4444" />
                </View>
                <View>
                  <Text style={styles.title}>Report a Hazard</Text>
                  <Text style={styles.subtitle}>Help keep others safe</Text>
                </View>
              </View>
              <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={12}>
                <Ionicons name="close" size={22} color="#6B7280" />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              {/* Category grid */}
              <Text style={styles.sectionLabel}>What's the issue?</Text>
              <View style={styles.grid}>
                {CATEGORIES.map((cat) => {
                  const isSelected = selected === cat.id;
                  return (
                    <Pressable
                      key={cat.id}
                      onPress={() => setSelected(cat.id)}
                      style={[
                        styles.categoryCard,
                        { borderColor: isSelected ? cat.color : '#E5E7EB' },
                        isSelected && { backgroundColor: cat.bgColor },
                      ]}
                    >
                      <View style={[styles.categoryIcon, { backgroundColor: cat.bgColor }]}>
                        <Ionicons name={cat.icon} size={22} color={cat.color} />
                      </View>
                      <Text
                        style={[
                          styles.categoryLabel,
                          isSelected && { color: cat.color, fontWeight: '700' },
                        ]}
                      >
                        {cat.label}
                      </Text>
                      {isSelected && (
                        <View style={[styles.checkBadge, { backgroundColor: cat.color }]}>
                          <Ionicons name="checkmark" size={12} color="#fff" />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>

              {/* Description (optional) */}
              {selected && (
                <>
                  <Text style={styles.sectionLabel}>Details (optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Broken streetlight near the park entrance"
                    placeholderTextColor="#9CA3AF"
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    maxLength={500}
                    textAlignVertical="top"
                  />
                </>
              )}

              {/* No location warning */}
              {!location && (
                <View style={styles.warningBanner}>
                  <Ionicons name="location-outline" size={16} color="#F59E0B" />
                  <Text style={styles.warningText}>
                    Location unavailable — enable location services to report
                  </Text>
                </View>
              )}

              {/* Error */}
              {error && (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle" size={16} color="#EF4444" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
            </ScrollView>

            {/* Submit button */}
            <View style={styles.footer}>
              <Pressable
                onPress={handleSubmit}
                disabled={!selected || !location || submitting}
                style={[
                  styles.submitBtn,
                  (!selected || !location || submitting) && styles.submitBtnDisabled,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="send" size={16} color="#fff" />
                    <Text style={styles.submitText}>Submit Report</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  keyboardView: {
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
    marginBottom: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryCard: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
    position: 'relative',
  },
  categoryIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    flex: 1,
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    fontSize: 14,
    color: '#111827',
    minHeight: 80,
    maxHeight: 120,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  warningText: {
    fontSize: 13,
    color: '#92400E',
    flex: 1,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  errorText: {
    fontSize: 13,
    color: '#991B1B',
    flex: 1,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  submitBtn: {
    backgroundColor: '#EF4444',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  submitBtnDisabled: {
    backgroundColor: '#D1D5DB',
  },
  submitText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
