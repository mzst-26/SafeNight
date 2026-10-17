import { glassSurface, glassScrim } from '@/src/components/ui/glass';
/**
 * CustomAlert — Styled replacement for React Native Alert.alert.
 *
 * Renders a centered modal card with icon, title, message, and action buttons.
 * Matches the SafeNight design language (rounded corners, indigo accents).
 */

import { Ionicons } from '@expo/vector-icons';
import {
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface Props {
  visible: boolean;
  title: string;
  message: string;
  buttons?: AlertButton[];
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  onDismiss?: () => void;
}

export function CustomAlert({
  visible,
  title,
  message,
  buttons = [{ text: 'OK', style: 'default' }],
  icon = 'information-circle',
  iconColor = '#6366F1',
  onDismiss,
}: Props) {
  const handlePress = (btn: AlertButton) => {
    btn.onPress?.();
    onDismiss?.();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, Platform.OS === 'web' && styles.webCard]}>
          {/* Icon */}
          <View style={[styles.iconCircle, { backgroundColor: `${iconColor}15` }]}>
            <Ionicons name={icon} size={32} color={iconColor} />
          </View>

          {/* Text */}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          {/* Buttons */}
          <View style={styles.buttonRow}>
            {buttons.map((btn, i) => {
              const isDestructive = btn.style === 'destructive';
              const isCancel = btn.style === 'cancel';
              const isPrimary = !isDestructive && !isCancel;

              return (
                <Pressable
                  key={i}
                  style={[
                    styles.button,
                    isPrimary && styles.buttonPrimary,
                    isDestructive && styles.buttonDestructive,
                    isCancel && styles.buttonCancel,
                    buttons.length === 1 && { flex: 1 },
                  ]}
                  onPress={() => handlePress(btn)}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isPrimary && styles.buttonTextPrimary,
                      isDestructive && styles.buttonTextDestructive,
                      isCancel && styles.buttonTextCancel,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
    maxWidth: 360,
    ...glassSurface,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    ...(Platform.OS !== 'web'
      ? {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.15,
          shadowRadius: 24,
          elevation: 12,
        }
      : {}),
  } as any,
  webCard: {
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  } as any,
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  buttonPrimary: {
    backgroundColor: '#6366F1',
  },
  buttonDestructive: {
    backgroundColor: '#EF4444',
  },
  buttonCancel: {
    backgroundColor: '#F1F5F9',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  buttonTextPrimary: {
    color: '#FFFFFF',
  },
  buttonTextDestructive: {
    color: '#FFFFFF',
  },
  buttonTextCancel: {
    color: '#64748B',
  },
});
