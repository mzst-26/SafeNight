/**
 * WelcomeModal — Post-login onboarding wizard.
 *
 * Three steps:
 * 1. Welcome + username setup
 * 2. Location permission
 * 3. Buddy system intro
 *
 * Shown once after first login. Persisted via AsyncStorage.
 */

import { setOnboardingAccepted } from '@/src/services/onboarding';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
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

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

interface Props {
  visible: boolean;
  onComplete: () => void;
  userName: string;
  currentUsername: string | null;
  onSetUsername: (username: string) => Promise<boolean>;
  onSetName: (name: string) => Promise<boolean>;
  onAcceptLocation: () => void;
  hasLocationPermission: boolean;
}

type Step = 'welcome' | 'location' | 'buddy';

export default function WelcomeModal({
  visible,
  onComplete,
  userName,
  currentUsername,
  onSetUsername,
  onSetName,
  onAcceptLocation,
  hasLocationPermission,
}: Props) {
  // Determine which steps are already done based on DB data
  const hasName = Boolean(userName?.trim());
  const hasUsername = Boolean(currentUsername?.trim());
  const profileComplete = hasName && hasUsername;

  // Start at the first incomplete step
  const initialStep: Step = !profileComplete
    ? 'welcome'
    : !hasLocationPermission
      ? 'location'
      : 'buddy';

  const [step, setStep] = useState<Step>(initialStep);
  const [displayName, setDisplayName] = useState(userName || '');
  const [username, setUsername] = useState(currentUsername ?? '');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'granted' | 'denied'>(
    hasLocationPermission ? 'granted' : 'idle',
  );

  // Reset step when modal visibility or profile data changes
  useEffect(() => {
    if (!visible) return;
    const newStep: Step = !profileComplete
      ? 'welcome'
      : !hasLocationPermission
        ? 'location'
        : 'buddy';
    setStep(newStep);
    setDisplayName(userName || '');
    setUsername(currentUsername ?? '');
  }, [visible, profileComplete, hasLocationPermission]);

  // ─── Step 1: Welcome + Name + Username ─────────────────────────────────────

  const handleSaveProfile = useCallback(async () => {
    const cleanName = displayName.trim();
    const cleanUsername = username.trim();

    if (!cleanName || cleanName.length < 2) {
      setNameError('Please enter your name (at least 2 characters).');
      return;
    }
    if (!USERNAME_RE.test(cleanUsername)) {
      setUsernameError('3-20 characters, letters, numbers, and underscores only.');
      return;
    }

    setSaving(true);
    setUsernameError(null);
    setNameError(null);

    try {
      // Save name first
      const nameOk = await onSetName(cleanName);
      if (!nameOk) {
        setSaving(false);
        setNameError('Could not save your name. Please check your connection and try again.');
        return;
      }

      // Then set username
      const usernameOk = await onSetUsername(cleanUsername);
      setSaving(false);
      if (usernameOk) {
        setStep('location');
      } else {
        setUsernameError('Username taken. Try another one.');
      }
    } catch (err) {
      setSaving(false);
      setNameError('Something went wrong. Please check your connection and try again.');
      console.error('[WelcomeModal] handleSaveProfile error:', err);
    }
  }, [displayName, username, onSetName, onSetUsername]);

  // ─── Step 2: Location ──────────────────────────────────────────────────────

  const handleEnableLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      setLocationStatus('granted');
      onAcceptLocation();
      // Auto-advance after a beat
      setTimeout(() => setStep('buddy'), 600);
    } else {
      setLocationStatus('denied');
    }
  }, [onAcceptLocation]);

  const handleSkipLocation = useCallback(() => {
    setStep('buddy');
  }, []);

  // ─── Step 3: Buddy ────────────────────────────────────────────────────────

  const handleFinish = useCallback(async () => {
    // Mark old onboarding as done so OnboardingModal never shows
    await setOnboardingAccepted();
    onComplete();
  }, [onComplete]);

  // ─── Progress dots ─────────────────────────────────────────────────────────

  const steps: Step[] = ['welcome', 'location', 'buddy'];
  const stepIndex = steps.indexOf(step);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={() => {}}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.overlay}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
        <View style={[styles.card, Platform.OS === 'web' && styles.webCard]}>
          {/* Progress dots */}
          <View style={styles.dots}>
            {steps.map((s, i) => (
              <View
                key={s}
                style={[styles.dot, i <= stepIndex && styles.dotActive]}
              />
            ))}
          </View>

          {/* ─── Step 1: Welcome + Name + Username ─── */}
          {step === 'welcome' && (
            <View style={styles.stepContent}>
              <View style={styles.iconCircle}>
                <Ionicons name="hand-left" size={36} color="#6366F1" />
              </View>
              <Text style={styles.heading}>Welcome to SafeNight!</Text>
              <Text style={styles.subtext}>
                Tell us your name and pick a username so your friends can find you.
              </Text>

              <TextInput
                style={[styles.input, nameError && styles.inputError]}
                placeholder="Your name"
                placeholderTextColor="#94A3B8"
                value={displayName}
                onChangeText={(t) => {
                  setDisplayName(t);
                  setNameError(null);
                }}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={100}
              />
              {nameError && (
                <Text style={styles.errorText}>{nameError}</Text>
              )}

              <TextInput
                style={[styles.input, usernameError && styles.inputError]}
                placeholder="Username (e.g. nightwalker42)"
                placeholderTextColor="#94A3B8"
                value={username}
                onChangeText={(t) => {
                  setUsername(t.replace(/[^a-zA-Z0-9_]/g, ''));
                  setUsernameError(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
              />
              {usernameError && (
                <Text style={styles.errorText}>{usernameError}</Text>
              )}

              <Pressable
                style={[styles.button, (!username.trim() || !displayName.trim()) && styles.buttonDisabled]}
                onPress={handleSaveProfile}
                disabled={!username.trim() || !displayName.trim() || saving}
              >
                {saving ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Continue</Text>
                )}
              </Pressable>
            </View>
          )}

          {/* ─── Step 2: Location ─── */}
          {step === 'location' && (
            <View style={styles.stepContent}>
              <View style={[styles.iconCircle, { backgroundColor: '#ECFDF5' }]}>
                <Ionicons name="location" size={36} color="#10B981" />
              </View>
              <Text style={styles.heading}>Enable Location</Text>
              <Text style={styles.subtext}>
                SafeNight uses your location to find the safest walking routes near you. Your location is never shared without your permission.
              </Text>

              {locationStatus === 'granted' ? (
                <View style={styles.successRow}>
                  <Ionicons name="checkmark-circle" size={22} color="#10B981" />
                  <Text style={styles.successText}>Location enabled</Text>
                </View>
              ) : locationStatus === 'denied' ? (
                <>
                  <View style={styles.warningRow}>
                    <Ionicons name="alert-circle" size={22} color="#F59E0B" />
                    <Text style={styles.warningText}>
                      Permission denied. You can enable it later in Settings.
                    </Text>
                  </View>
                  <Pressable style={styles.button} onPress={handleSkipLocation}>
                    <Text style={styles.buttonText}>Continue</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable style={styles.button} onPress={handleEnableLocation}>
                    <Text style={styles.buttonText}>Enable Location</Text>
                  </Pressable>
                  <Pressable style={styles.skipBtn} onPress={handleSkipLocation}>
                    <Text style={styles.skipText}>Not now</Text>
                  </Pressable>
                </>
              )}

              {locationStatus === 'granted' && (
                <Pressable
                  style={[styles.button, { marginTop: 16 }]}
                  onPress={() => setStep('buddy')}
                >
                  <Text style={styles.buttonText}>Continue</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* ─── Step 3: Buddy System ─── */}
          {step === 'buddy' && (
            <View style={styles.stepContent}>
              <View style={[styles.iconCircle, { backgroundColor: '#FFF7ED' }]}>
                <Ionicons name="people" size={36} color="#F97316" />
              </View>
              <Text style={styles.heading}>Buddy System</Text>
              <Text style={styles.subtext}>
                Add emergency contacts and share your live location while walking. Your buddies get notified when you start a journey.
              </Text>

              <View style={styles.featureList}>
                <FeatureRow icon="qr-code" text="Pair with friends via QR code" />
                <FeatureRow icon="navigate" text="Share live location while navigating" />
                <FeatureRow icon="notifications" text="Buddies get notified if you need help" />
              </View>

              <Pressable style={styles.button} onPress={handleFinish}>
                <Text style={styles.buttonText}>Get Started</Text>
              </Pressable>
            </View>
          )}
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Check if the user has completed the welcome flow (legacy — kept for backward compat) */
export async function hasCompletedWelcome(): Promise<boolean> {
  // No longer used — DB profile is the source of truth.
  // Kept as export to avoid breaking any lingering imports.
  return true;
}

// ─── FeatureRow helper ───────────────────────────────────────────────────────

function FeatureRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureRow}>
      <Ionicons name={icon as any} size={20} color="#6366F1" style={styles.featureIcon} />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flexGrow: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    paddingTop: 60,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    ...(Platform.OS !== 'web'
      ? { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 12 }
      : {}),
  } as any,
  webCard: {
    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
  } as any,
  dots: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 8,
    marginBottom: 28,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
  },
  dotActive: {
    backgroundColor: '#6366F1',
    width: 24,
  },
  stepContent: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtext: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  input: {
    width: '100%',
    height: 52,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#1E293B',
    backgroundColor: '#F8FAFC',
    marginBottom: 8,
  },
  inputError: {
    borderColor: '#EF4444',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  button: {
    backgroundColor: '#6366F1',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 16,
  },
  skipBtn: {
    marginTop: 12,
    padding: 8,
  },
  skipText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 14,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  successText: {
    color: '#10B981',
    fontWeight: '600',
    fontSize: 15,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 12,
  },
  warningText: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  featureList: {
    width: '100%',
    gap: 14,
    marginBottom: 24,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureIcon: {
    width: 24,
  },
  featureText: {
    fontSize: 15,
    color: '#334155',
    fontWeight: '500',
    flex: 1,
  },
});
