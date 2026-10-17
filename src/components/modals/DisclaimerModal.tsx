import { glassSurface } from '@/src/components/ui/glass';
/**
 * DisclaimerModal — Safety disclaimer that must be accepted before using the app.
 *
 * Shown once after login/signup if the user hasn't accepted yet.
 * Acceptance is persisted server-side (disclaimer_accepted_at in profiles).
 * The modal is non-dismissable — the user MUST scroll through and agree.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  onAccept: () => Promise<boolean>;
}

const DISCLAIMER_SECTIONS = [
  {
    title: 'Important Safety Notice',
    body: `SafeNight is a personal safety companion designed to help you make more informed decisions about your walking routes. However, it is essential that you understand the following before using this application.`,
  },
  {
    title: '1. Not a Guarantee of Safety',
    body: `SafeNight provides route safety scores and suggestions based on publicly available data, including street lighting data, crime statistics, road infrastructure, and user-submitted reports. These scores are estimates only and do not guarantee your personal safety. No app can ensure complete protection from harm. Always remain vigilant and aware of your surroundings regardless of what the app indicates.`,
  },
  {
    title: '2. Data Limitations',
    body: `Safety information may be incomplete, outdated, or inaccurate. Conditions can change rapidly — a well-lit street may experience temporary outages, roadworks, or unforeseen hazards. User-submitted reports are not independently verified. SafeNight does not monitor real-time incidents or emergencies.`,
  },
  {
    title: '3. Not a Replacement for Emergency Services',
    body: `SafeNight is not a substitute for emergency services. If you are in immediate danger, call 999 (UK), 911 (US), 112 (EU), or your local emergency number. The Safety Circle feature allows you to share your live location with trusted contacts, but this is a supplementary tool and should not be relied upon as your sole means of requesting help.`,
  },
  {
    title: '4. Location & Personal Data',
    body: `SafeNight collects location data to provide navigation and safety features. Your location is shared with your Safety Circle contacts only during active live sessions that you initiate. We do not sell your personal data. By using this app, you consent to the collection and processing of location data as described in our Privacy Policy.`,
  },
  {
    title: '5. AI-Generated Content',
    body: `Route explanations and safety summaries may be generated using artificial intelligence. AI outputs are informational only and may contain errors or omissions. Do not rely solely on AI-generated safety assessments when making decisions about your personal safety.`,
  },
  {
    title: '6. Your Responsibility',
    body: `You are solely responsible for your own safety while using SafeNight. The developers, contributors, and operators of SafeNight accept no liability for any loss, injury, damage, or harm arising from the use of this application, its safety scores, route suggestions, or any other feature. Use of this app is entirely at your own risk.`,
  },
  {
    title: '7. Age Requirement',
    body: `You must be at least 16 years old to use SafeNight. If you are under 18, you should have parental or guardian consent before using this application.`,
  },
  {
    title: '8. Acceptance',
    body: `By tapping "I Understand & Agree" below, you acknowledge that you have read, understood, and agree to this Safety Disclaimer. You accept that SafeNight is a supplementary tool and not a guarantee of safety.`,
  },
];

export default function DisclaimerModal({ visible, onAccept }: Props) {
  const insets = useSafeAreaInsets();
  const [hasScrolledToEnd, setHasScrolledToEnd] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const contentH = useRef(0);
  const layoutH = useRef(0);

  // Clear error when modal opens/closes
  useEffect(() => {
    if (!visible) {
      setAcceptError(null);
    }
  }, [visible]);

  // Check whether content is short enough that no scrolling is needed
  const checkIfNoScrollNeeded = useCallback(() => {
    if (contentH.current > 0 && layoutH.current > 0) {
      if (contentH.current <= layoutH.current + 40) {
        setHasScrolledToEnd(true);
      }
    }
  }, []);

  const handleContentSizeChange = useCallback(
    (_w: number, h: number) => {
      contentH.current = h;
      checkIfNoScrollNeeded();
    },
    [checkIfNoScrollNeeded],
  );

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      layoutH.current = e.nativeEvent.layout.height;
      checkIfNoScrollNeeded();
    },
    [checkIfNoScrollNeeded],
  );

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const distanceFromBottom =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      if (distanceFromBottom < 40) {
        setHasScrolledToEnd(true);
      }
    },
    [],
  );

  const handleAccept = useCallback(async () => {
    setIsAccepting(true);
    setAcceptError(null);
    try {
      await onAccept();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to accept disclaimer. Please try again.';
      setAcceptError(msg);
    } finally {
      setIsAccepting(false);
    }
  }, [onAccept]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      statusBarTranslucent
      onRequestClose={() => {}} // Not dismissable
    >
      <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.iconRow}>
            <Ionicons name="shield-checkmark" size={32} color="#1570EF" />
          </View>
          <Text style={styles.title}>Safety Disclaimer</Text>
          <Text style={styles.subtitle}>
            Please read the following carefully before using SafeNight
          </Text>
        </View>

        {/* Scrollable disclaimer text */}
        <ScrollView
          ref={scrollRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onContentSizeChange={handleContentSizeChange}
          onLayout={handleLayout}
        >
          {DISCLAIMER_SECTIONS.map((section, i) => (
            <View key={i} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionBody}>{section.body}</Text>
            </View>
          ))}

          <View style={styles.lastUpdated}>
            <Text style={styles.lastUpdatedText}>
              Last updated: February 2026
            </Text>
          </View>
        </ScrollView>

        {/* Scroll hint */}
        {!hasScrolledToEnd && (
          <View style={styles.scrollHint}>
            <Ionicons name="chevron-down" size={16} color="#667085" />
            <Text style={styles.scrollHintText}>
              Scroll down to read the full disclaimer
            </Text>
          </View>
        )}

        {/* Accept button */}
        <Pressable
          style={[
            styles.acceptBtn,
            (!hasScrolledToEnd || isAccepting) && styles.acceptBtnDisabled,
          ]}
          onPress={handleAccept}
          disabled={!hasScrolledToEnd || isAccepting}
        >
          {isAccepting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.acceptText}>I Understand & Agree</Text>
            </>
          )}
        </Pressable>

        {/* Error message or disabled hint */}
        {acceptError ? (
          <Text style={styles.errorHint}>{acceptError}</Text>
        ) : !hasScrolledToEnd ? (
          <Text style={styles.disabledHint}>
            You must read the full disclaimer before accepting
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    ...glassSurface,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  iconRow: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#EFF4FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#101828',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#667085',
    textAlign: 'center',
    marginTop: 6,
  },
  scrollArea: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#101828',
    marginBottom: 6,
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#344054',
  },
  lastUpdated: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  lastUpdatedText: {
    fontSize: 12,
    color: '#98A2B3',
    fontStyle: 'italic',
  },
  scrollHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  scrollHintText: {
    fontSize: 12,
    color: '#667085',
  },
  acceptBtn: {
    backgroundColor: '#1570EF',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : {}),
  },
  acceptBtnDisabled: {
    backgroundColor: '#B0C4DE',
  },
  acceptText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  disabledHint: {
    fontSize: 11,
    color: '#98A2B3',
    textAlign: 'center',
    marginTop: 6,
  },
  errorHint: {
    fontSize: 12,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 8,
    fontWeight: '500',
  },
});
