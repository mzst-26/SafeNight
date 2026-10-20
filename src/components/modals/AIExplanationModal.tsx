import { glassSurface, glassScrim } from '@/src/components/ui/glass';
/**
 * AIExplanationModal — Modal showing AI-generated route safety insights.
 */
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { UseAIExplanationState } from '@/src/hooks/useAIExplanation';

interface AIExplanationModalProps {
  visible: boolean;
  ai: UseAIExplanationState;
  onClose: () => void;
}

export function AIExplanationModal({ visible, ai, onClose }: AIExplanationModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons name="sparkles" size={20} color="#7c3aed" />
              <Text style={styles.title}>AI Route Insights</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color="#667085" />
            </Pressable>
          </View>

          {ai.status === 'loading' && (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color="#7c3aed" />
              <Text style={styles.loadingText}>Thinking…</Text>
            </View>
          )}

          {ai.status === 'ready' && ai.explanation && (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              <Text style={styles.explanation}>{ai.explanation}</Text>
            </ScrollView>
          )}

          {ai.status === 'error' && (
            <View style={styles.errorWrap}>
              <Text style={styles.errorText}>{ai.error}</Text>
              <Pressable style={styles.retryButton} onPress={ai.ask}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    ...glassScrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '70%',
    borderRadius: 20,
    ...glassSurface,
    padding: 20,
    ...(Platform.OS === 'web' ? { boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)' } : {}),
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#101828',
  },
  loading: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 32,
  },
  loadingText: {
    fontSize: 14,
    color: '#7c3aed',
    fontWeight: '500',
  },
  body: {
    maxHeight: 320,
  },
  explanation: {
    fontSize: 15,
    lineHeight: 23,
    color: '#344054',
  },
  errorWrap: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
  },
  errorText: {
    fontSize: 14,
    color: '#d92d20',
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#7c3aed',
  },
  retryText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
});
