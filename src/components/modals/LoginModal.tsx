/**
 * LoginModal.tsx — Login modal with conditional auth methods.
 *
 * Flow:
 * 1. Enter email
 * 2. Check account
 *    - Existing user: choose OTP or password
 *    - New user: OTP only (auto-send)
 * 3. Verify OTP OR sign in with password
 * 4. Forgot password sends Supabase reset email
 *
 * Name/username are collected separately in WelcomeModal after first login.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { PathfindingAnimation } from '../PathfindingAnimation';

interface Props {
  visible: boolean;
  onClose: () => void;
  onCheckAuthOptions: (email: string) => Promise<{
    email: string;
    exists: boolean;
    methods: Array<'otp' | 'password'>;
    default_method: 'otp';
  } | null>;
  onSendMagicLink: (email: string, name: string) => Promise<boolean>;
  onSignInWithPassword: (email: string, password: string) => Promise<boolean>;
  onForgotPassword: (email: string) => Promise<{ message: string } | null>;
  onVerify: (email: string, token: string) => Promise<boolean>;
  error: string | null;
  dismissable?: boolean;
}

type Step = 'email' | 'method' | 'otp' | 'password';

export default function LoginModal({
  visible,
  onClose,
  onCheckAuthOptions,
  onSendMagicLink,
  onSignInWithPassword,
  onForgotPassword,
  onVerify,
  error,
  dismissable = true,
}: Props) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [availableMethods, setAvailableMethods] = useState<Array<'otp' | 'password'>>([]);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Parse rate-limit errors and start countdown
  const rawError = localError || error;
  useEffect(() => {
    if (rawError && rawError.startsWith('RATE_LIMIT:')) {
      const secs = parseInt(rawError.split(':')[1], 10) || 900;
      setCountdown(secs);
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            setLocalError(null);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [rawError]);

  // Auto-switch to OTP when password login is locked out (5 wrong attempts)
  useEffect(() => {
    if (rawError === 'LOCKED_OUT') {
      // Dismiss the raw sentinel immediately
      setLocalError(null);
      setPassword('');
      // Switch to OTP step and fire off a code so the user can get in right away
      setStep('otp');
      setInfoMessage('Too many wrong passwords. We\'ve sent an email code — use that to sign in instead.');
      onSendMagicLink(email.trim().toLowerCase(), '').catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawError]);

  // Build display error with countdown
  const isRateLimited = countdown > 0;
  const formatCountdown = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec.toString().padStart(2, '0')}s` : `${sec}s`;
  };
  // Never render the raw sentinel string — it's handled by the useEffect above
  const displayError = isRateLimited
    ? `Slow down! Try again in ${formatCountdown(countdown)}. We limit requests to keep SafeNight free for everyone.`
    : rawError === 'LOCKED_OUT' ? null : rawError;

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const sendOtpCode = useCallback(async () => {
    if (!isEmailValid) return;
    setInfoMessage(null);
    setLocalError(null);
    setIsLoading(true);
    const ok = await onSendMagicLink(email.trim().toLowerCase(), '');
    setIsLoading(false);
    if (ok) {
      setStep('otp');
      setInfoMessage('We sent a 6-digit code to your email.');
    }
    // error is shown via displayError from the hook
  }, [email, isEmailValid, onSendMagicLink]);

  const handleContinue = useCallback(async () => {
    if (!isEmailValid) return;
    setInfoMessage(null);
    setLocalError(null);
    setIsLoading(true);
    const options = await onCheckAuthOptions(email.trim().toLowerCase());
    setIsLoading(false);

    // If auth-options check fails for any reason (backend down, 404, network error),
    // fall back to plain OTP flow so login always works.
    if (!options) {
      await sendOtpCode();
      return;
    }

    setAvailableMethods(options.methods);

    // New users: OTP only (signup via OTP)
    if (!options.exists || !options.methods.includes('password')) {
      await sendOtpCode();
      return;
    }

    setStep('method');
  }, [email, isEmailValid, onCheckAuthOptions, sendOtpCode]);

  const handleVerify = useCallback(async () => {
    if (otp.length < 6) return;
    setInfoMessage(null);
    setLocalError(null);
    setIsLoading(true);
    const ok = await onVerify(email.trim().toLowerCase(), otp.trim());
    setIsLoading(false);
    if (ok) {
      setStep('email');
      setEmail('');
      setOtp('');
      setPassword('');
      setAvailableMethods([]);
      setLocalError(null);
      setInfoMessage(null);
      onClose();
    }
    // error is shown via displayError from the hook
  }, [email, otp, onVerify, onClose]);

  const handlePasswordLogin = useCallback(async () => {
    if (password.trim().length < 6) return;
    setInfoMessage(null);
    setLocalError(null);
    setIsLoading(true);
    const ok = await onSignInWithPassword(email.trim().toLowerCase(), password);
    setIsLoading(false);
    if (ok) {
      setStep('email');
      setEmail('');
      setOtp('');
      setPassword('');
      setAvailableMethods([]);
      setLocalError(null);
      setInfoMessage(null);
      onClose();
    }
  }, [email, password, onSignInWithPassword, onClose]);

  const handleForgotPassword = useCallback(async () => {
    if (!isEmailValid) return;
    setInfoMessage(null);
    setLocalError(null);
    setIsLoading(true);
    const result = await onForgotPassword(email.trim().toLowerCase());
    setIsLoading(false);
    if (result?.message) {
      setInfoMessage(result.message);
    }
  }, [email, isEmailValid, onForgotPassword]);

  const handleClose = useCallback(() => {
    setStep('email');
    setEmail('');
    setOtp('');
    setPassword('');
    setAvailableMethods([]);
    setLocalError(null);
    setInfoMessage(null);
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
      presentationStyle={Platform.OS === 'web' ? 'fullScreen' : 'pageSheet'}
      onRequestClose={dismissable ? handleClose : undefined}
      transparent={false}
    >
      {Platform.OS === 'web' ? (
        /* ─── Web layout: animation bg + centered card ─── */
        <View style={styles.webRoot}>
          <View style={styles.webBackground}>
            <PathfindingAnimation duration={18000} loop opacity={0.15} />
          </View>
          <View style={styles.webForeground}>
            <View style={styles.webCard}>
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.title}>
                  {step === 'email'
                    ? 'Log In'
                    : step === 'method'
                      ? 'Choose Sign-In Method'
                      : step === 'password'
                        ? 'Password Sign-In'
                        : 'Enter Code'}
                </Text>
                {dismissable && (
                  <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={12}>
                    <Ionicons name="close" size={24} color="#64748B" />
                  </Pressable>
                )}
              </View>

              <View style={styles.content}>
                {step === 'email' ? (
                  <>
                    <View style={styles.iconWrap}>
                      <Ionicons name="shield-checkmark" size={48} color="#6366F1" />
                    </View>
                    <Text style={styles.heading}>Sign in to SafeNight</Text>
                    <Text style={styles.subtitle}>
                      Enter your email to continue.
                    </Text>

                    <TextInput
                      style={styles.input}
                      placeholder="Email address"
                      placeholderTextColor="#94A3B8"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                    />

                    <Pressable
                      style={[
                        styles.button,
                        (!isEmailValid || isRateLimited) && styles.buttonDisabled,
                      ]}
                      onPress={handleContinue}
                      disabled={!isEmailValid || isLoading || isRateLimited}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={styles.buttonText}>Continue</Text>
                      )}
                    </Pressable>
                  </>
                ) : step === 'method' ? (
                  <>
                    <View style={styles.iconWrap}>
                      <Ionicons name="log-in-outline" size={48} color="#6366F1" />
                    </View>
                    <Text style={styles.heading}>Welcome back</Text>
                    <Text style={styles.subtitle}>
                      Choose how you want to sign in for{'\n'}
                      <Text style={styles.emailHighlight}>{email}</Text>
                    </Text>

                    <Pressable
                      style={[styles.button, isRateLimited && styles.buttonDisabled]}
                      onPress={sendOtpCode}
                      disabled={isLoading || isRateLimited || !availableMethods.includes('otp')}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={styles.buttonText}>Sign in with Email Code</Text>
                      )}
                    </Pressable>

                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => {
                        setOtp('');
                        setStep('password');
                      }}
                      disabled={isLoading || !availableMethods.includes('password')}
                    >
                      <Text style={styles.secondaryButtonText}>Sign in with Password</Text>
                    </Pressable>

                    <Pressable
                      style={styles.linkBtn}
                      onPress={() => {
                        setStep('email');
                        setOtp('');
                        setPassword('');
                        setInfoMessage(null);
                      }}
                    >
                      <Text style={styles.linkText}>Use a different email</Text>
                    </Pressable>
                  </>
                ) : step === 'password' ? (
                  <>
                    <View style={styles.iconWrap}>
                      <Ionicons name="lock-closed" size={48} color="#6366F1" />
                    </View>
                    <Text style={styles.heading}>Enter your password</Text>
                    <Text style={styles.subtitle}>
                      Signing in as{'\n'}
                      <Text style={styles.emailHighlight}>{email}</Text>
                    </Text>

                    <TextInput
                      style={styles.input}
                      placeholder="Password"
                      placeholderTextColor="#94A3B8"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                    />

                    <Pressable
                      style={[
                        styles.button,
                        (password.trim().length < 6 || isRateLimited) && styles.buttonDisabled,
                      ]}
                      onPress={handlePasswordLogin}
                      disabled={password.trim().length < 6 || isLoading || isRateLimited}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={styles.buttonText}>Sign In</Text>
                      )}
                    </Pressable>

                    <Pressable style={styles.linkBtn} onPress={handleForgotPassword}>
                      <Text style={styles.linkText}>Forgot password?</Text>
                    </Pressable>

                    <Pressable
                      style={styles.linkBtn}
                      onPress={() => {
                        setStep('method');
                        setPassword('');
                        setInfoMessage(null);
                      }}
                    >
                      <Text style={styles.linkText}>Back to sign-in options</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View style={styles.iconWrap}>
                      <Ionicons name="mail" size={48} color="#6366F1" />
                    </View>
                    <Text style={styles.heading}>Check your email</Text>
                    <Text style={styles.subtitle}>
                      We sent a 6-digit code to{'\n'}
                      <Text style={styles.emailHighlight}>{email}</Text>
                    </Text>

                    <TextInput
                      style={[styles.input, styles.otpInput]}
                      placeholder="000000"
                      placeholderTextColor="#94A3B8"
                      value={otp}
                      onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoFocus
                      textAlign="center"
                    />

                    <Pressable
                      style={[
                        styles.button,
                        (otp.length < 6 || isRateLimited) && styles.buttonDisabled,
                      ]}
                      onPress={handleVerify}
                      disabled={otp.length < 6 || isLoading || isRateLimited}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={styles.buttonText}>Verify</Text>
                      )}
                    </Pressable>

                    <Pressable
                      style={styles.linkBtn}
                      onPress={() => {
                        setStep(availableMethods.includes('password') ? 'method' : 'email');
                        setOtp('');
                      }}
                    >
                      <Text style={styles.linkText}>
                        {availableMethods.includes('password') ? 'Back to sign-in options' : 'Use a different email'}
                      </Text>
                    </Pressable>
                  </>
                )}

                {infoMessage && (
                  <View style={styles.infoBanner}>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={18}
                      color="#0F766E"
                      style={styles.errorIcon}
                    />
                    <Text style={styles.infoText}>{infoMessage}</Text>
                  </View>
                )}

                {displayError && (
                  <Pressable
                    style={[styles.errorBanner, isRateLimited && styles.rateLimitBanner]}
                    onPress={isRateLimited ? undefined : () => setLocalError(null)}
                  >
                    <Ionicons
                      name={isRateLimited ? 'time-outline' : displayError.includes('Server is down') ? 'cloud-offline-outline' : 'alert-circle-outline'}
                      size={18}
                      color={isRateLimited ? '#D97706' : '#DC2626'}
                      style={styles.errorIcon}
                    />
                    <Text style={[styles.errorText, isRateLimited && styles.rateLimitText]}>{displayError}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </View>
      ) : (
        /* ─── Native layout ─── */
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.card}>
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.title}>
                  {step === 'email'
                    ? 'Log In'
                    : step === 'method'
                      ? 'Choose Sign-In Method'
                      : step === 'password'
                        ? 'Password Sign-In'
                        : 'Enter Code'}
                </Text>
                {dismissable && (
                  <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={12}>
                    <Ionicons name="close" size={24} color="#64748B" />
                  </Pressable>
                )}
              </View>

              <View style={styles.content}>
                {step === 'email' ? (
                  <>
                    <View style={styles.iconWrap}>
                      <Ionicons name="shield-checkmark" size={48} color="#6366F1" />
                    </View>
                    <Text style={styles.heading}>Sign in to SafeNight</Text>
                    <Text style={styles.subtitle}>
                      Enter your email to continue.
                    </Text>

                    <TextInput
                      style={styles.input}
                      placeholder="Email address"
                      placeholderTextColor="#94A3B8"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                    />

                    <Pressable
                      style={[
                        styles.button,
                        (!isEmailValid || isRateLimited) && styles.buttonDisabled,
                      ]}
                      onPress={handleContinue}
                      disabled={!isEmailValid || isLoading || isRateLimited}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={styles.buttonText}>Continue</Text>
                      )}
                    </Pressable>
                  </>
                ) : step === 'method' ? (
                  <>
                    <View style={styles.iconWrap}>
                      <Ionicons name="log-in-outline" size={48} color="#6366F1" />
                    </View>
                    <Text style={styles.heading}>Welcome back</Text>
                    <Text style={styles.subtitle}>
                      Choose how you want to sign in for{'\n'}
                      <Text style={styles.emailHighlight}>{email}</Text>
                    </Text>

                    <Pressable
                      style={[styles.button, isRateLimited && styles.buttonDisabled]}
                      onPress={sendOtpCode}
                      disabled={isLoading || isRateLimited || !availableMethods.includes('otp')}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={styles.buttonText}>Sign in with Email Code</Text>
                      )}
                    </Pressable>

                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => {
                        setOtp('');
                        setStep('password');
                      }}
                      disabled={isLoading || !availableMethods.includes('password')}
                    >
                      <Text style={styles.secondaryButtonText}>Sign in with Password</Text>
                    </Pressable>

                    <Pressable
                      style={styles.linkBtn}
                      onPress={() => {
                        setStep('email');
                        setOtp('');
                        setPassword('');
                        setInfoMessage(null);
                      }}
                    >
                      <Text style={styles.linkText}>Use a different email</Text>
                    </Pressable>
                  </>
                ) : step === 'password' ? (
                  <>
                    <View style={styles.iconWrap}>
                      <Ionicons name="lock-closed" size={48} color="#6366F1" />
                    </View>
                    <Text style={styles.heading}>Enter your password</Text>
                    <Text style={styles.subtitle}>
                      Signing in as{'\n'}
                      <Text style={styles.emailHighlight}>{email}</Text>
                    </Text>

                    <TextInput
                      style={styles.input}
                      placeholder="Password"
                      placeholderTextColor="#94A3B8"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                    />

                    <Pressable
                      style={[
                        styles.button,
                        (password.trim().length < 6 || isRateLimited) && styles.buttonDisabled,
                      ]}
                      onPress={handlePasswordLogin}
                      disabled={password.trim().length < 6 || isLoading || isRateLimited}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={styles.buttonText}>Sign In</Text>
                      )}
                    </Pressable>

                    <Pressable style={styles.linkBtn} onPress={handleForgotPassword}>
                      <Text style={styles.linkText}>Forgot password?</Text>
                    </Pressable>

                    <Pressable
                      style={styles.linkBtn}
                      onPress={() => {
                        setStep('method');
                        setPassword('');
                        setInfoMessage(null);
                      }}
                    >
                      <Text style={styles.linkText}>Back to sign-in options</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View style={styles.iconWrap}>
                      <Ionicons name="mail" size={48} color="#6366F1" />
                    </View>
                    <Text style={styles.heading}>Check your email</Text>
                    <Text style={styles.subtitle}>
                      We sent a 6-digit code to{'\n'}
                      <Text style={styles.emailHighlight}>{email}</Text>
                    </Text>

                    <TextInput
                      style={[styles.input, styles.otpInput]}
                      placeholder="000000"
                      placeholderTextColor="#94A3B8"
                      value={otp}
                      onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoFocus
                      textAlign="center"
                    />

                    <Pressable
                      style={[
                        styles.button,
                        (otp.length < 6 || isRateLimited) && styles.buttonDisabled,
                      ]}
                      onPress={handleVerify}
                      disabled={otp.length < 6 || isLoading || isRateLimited}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={styles.buttonText}>Verify</Text>
                      )}
                    </Pressable>

                    <Pressable
                      style={styles.linkBtn}
                      onPress={() => {
                        setStep(availableMethods.includes('password') ? 'method' : 'email');
                        setOtp('');
                      }}
                    >
                      <Text style={styles.linkText}>
                        {availableMethods.includes('password') ? 'Back to sign-in options' : 'Use a different email'}
                      </Text>
                    </Pressable>
                  </>
                )}

                {infoMessage && (
                  <View style={styles.infoBanner}>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={18}
                      color="#0F766E"
                      style={styles.errorIcon}
                    />
                    <Text style={styles.infoText}>{infoMessage}</Text>
                  </View>
                )}

                {displayError && (
                  <Pressable
                    style={[styles.errorBanner, isRateLimited && styles.rateLimitBanner]}
                    onPress={isRateLimited ? undefined : () => setLocalError(null)}
                  >
                    <Ionicons
                      name={isRateLimited ? 'time-outline' : displayError.includes('Server is down') ? 'cloud-offline-outline' : 'alert-circle-outline'}
                      size={18}
                      color={isRateLimited ? '#D97706' : '#DC2626'}
                      style={styles.errorIcon}
                    />
                    <Text style={[styles.errorText, isRateLimited && styles.rateLimitText]}>{displayError}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  /* ─── Web-only styles ─── */
  webRoot: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  webBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  webForeground: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  webCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
    overflow: 'hidden',
  } as any,
  /* ─── Shared / Native styles ─── */
  scrollContent: {
    flexGrow: 1,
  },
  card: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1E293B',
  },
  closeBtn: {
    padding: 4,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 32,
    paddingBottom: 60,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22,
  },
  emailHighlight: {
    fontWeight: '700',
    color: '#6366F1',
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
    backgroundColor: '#FFF',
    marginBottom: 12,
  },
  otpInput: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 12,
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
  secondaryButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFF',
  },
  secondaryButtonText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 16,
  },
  linkBtn: {
    marginTop: 16,
    padding: 8,
  },
  linkText: {
    color: '#6366F1',
    fontWeight: '600',
    fontSize: 14,
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 16,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorIcon: {
    marginRight: 10,
    flexShrink: 0,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  infoBanner: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 16,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoText: {
    color: '#0F766E',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  rateLimitBanner: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  rateLimitText: {
    color: '#D97706',
  },
});
