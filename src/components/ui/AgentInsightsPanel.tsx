/**
 * AgentInsightsPanel — the AI Insights / Rethink sheet opened from the desktop bar above the
 * recommended route.
 *
 * It asks the agent endpoint once when it opens. The agent's actions (pan, zoom, fit, highlight)
 * run on the map. A reroute proposal waits for a yes. A switch changes the selected route only
 * when the walker taps "Use this route". "Keep my route" is always there.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
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

import { glassScrim, glassSurface } from '@/src/components/ui/glass';
import {
  postAgentInsights,
  type AgentContext,
  type AgentInsightsResponse,
  type CandidatePoint,
} from '@/src/services/agentClient';
import { runAgentActions } from '@/src/services/agentActions';
import { getMapController } from '@/src/services/mapController';
import type { LatLng } from '@/src/types/geo';

const ACCENT = '#6d28d9';
const INK = '#101828';
const MUTED = '#475467';

type Phase = 'idle' | 'loading' | 'ready' | 'error';

interface PendingConfirm {
  candidate: CandidatePoint;
  label: string;
  resolve: (accepted: boolean) => void;
}

export interface AgentInsightsPanelProps {
  visible: boolean;
  onClose: () => void;
  /** The request and candidates for the current search. Null while routes are not ready. */
  context: AgentContext | null;
  /** Selects the route the agent switched to. Called only when the walker taps "Use this route". */
  onUseRoute: (routeId: string) => void;
  /** Sets the via pin for a confirmed reroute. The app then searches again. */
  onSetViaPin: (point: LatLng) => void;
}

const FAILURE_TEXT = 'Could not reach AI Insights right now. Your route is unchanged.';

export function AgentInsightsPanel({
  visible,
  onClose,
  context,
  onUseRoute,
  onSetViaPin,
}: AgentInsightsPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [response, setResponse] = useState<AgentInsightsResponse | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  // Every new request bumps this; an answer to an older request is then ignored.
  const seqRef = useRef(0);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback(
    ({ candidate, label }: { candidate: CandidatePoint; label: string }) =>
      new Promise<boolean>((resolve) => {
        const next: PendingConfirm = { candidate, label, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );

  const settlePending = useCallback((accepted: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(accepted);
  }, []);

  const ask = useCallback(
    async (answer?: { questionId: string; choiceId: string }) => {
      if (!context) {
        setPhase('error');
        setErrorText('Route analysis is not ready yet.');
        return;
      }
      const seq = ++seqRef.current;
      setPhase('loading');
      setErrorText(null);
      try {
        const body = answer ? { ...context.body, answer } : context.body;
        const result = await postAgentInsights(body);
        if (seq !== seqRef.current) return;
        setResponse(result);
        setPhase('ready');
        await runAgentActions(result.actions, {
          candidates: context.candidates,
          routes: context.routes,
          controller: getMapController(),
          confirm,
          setViaPin: onSetViaPin,
        });
      } catch {
        if (seq !== seqRef.current) return;
        setPhase('error');
        setErrorText(FAILURE_TEXT);
      }
    },
    [context, confirm, onSetViaPin],
  );

  // The latest ask, so opening the panel does not re-run when the context object changes.
  const askRef = useRef(ask);
  askRef.current = ask;

  useEffect(() => {
    if (visible) {
      void askRef.current();
      return undefined;
    }
    // Closed: drop any answer still on its way, and resolve an open confirmation as no.
    seqRef.current++;
    settlePending(false);
    setResponse(null);
    setErrorText(null);
    setPhase('idle');
    return undefined;
  }, [visible, settlePending]);

  const switching = phase === 'ready' && response?.decision.kind === 'switch';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons name="sparkles" size={20} color={ACCENT} />
              <Text style={styles.title}>AI Insights</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close AI Insights">
              <Ionicons name="close" size={22} color="#667085" />
            </Pressable>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {phase === 'loading' && (
              <View style={styles.loading}>
                <ActivityIndicator size="small" color={ACCENT} />
                <Text style={styles.loadingText}>Checking your route</Text>
              </View>
            )}

            {phase === 'error' && errorText && (
              <View style={styles.errorWrap}>
                <Text style={styles.errorText}>{errorText}</Text>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void ask()}
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                >
                  <Text style={styles.secondaryText}>Try again</Text>
                </Pressable>
              </View>
            )}

            {phase === 'ready' && response && (
              <View>
                <Text style={styles.message}>{response.message}</Text>

                {response.decision.reasons.length > 0 && (
                  <View style={styles.reasons}>
                    {response.decision.reasons.map((reason, index) => (
                      <View key={`${index}-${reason}`} style={styles.reasonRow}>
                        <Text style={styles.bullet}>•</Text>
                        <Text style={styles.reasonText}>{reason}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {response.question && (
                  <View style={styles.question}>
                    <Text style={styles.questionText}>{response.question.text}</Text>
                    <View style={styles.choices}>
                      {response.question.choices.map((choice) => (
                        <Pressable
                          key={choice.id}
                          style={styles.choice}
                          onPress={() => void ask({ questionId: response.question!.id, choiceId: choice.id })}
                          accessibilityRole="button"
                          accessibilityLabel={choice.label}
                        >
                          <Text style={styles.choiceText}>{choice.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}

                {pending && (
                  <View style={styles.confirm}>
                    <Text style={styles.confirmTitle}>Reroute via this point?</Text>
                    <Text style={styles.confirmLabel}>{pending.label}</Text>
                    <View style={styles.confirmRow}>
                      <Pressable
                        style={styles.secondaryButton}
                        onPress={() => settlePending(false)}
                        accessibilityRole="button"
                        accessibilityLabel="No"
                      >
                        <Text style={styles.secondaryText}>No</Text>
                      </Pressable>
                      <Pressable
                        style={styles.primaryButton}
                        onPress={() => settlePending(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Yes"
                      >
                        <Text style={styles.primaryText}>Yes</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            {switching && response && (
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  onUseRoute(response.decision.routeId);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel="Use this route"
              >
                <Text style={styles.primaryText}>Use this route</Text>
              </Pressable>
            )}
            <Pressable
              style={styles.secondaryButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Keep my route"
            >
              <Text style={styles.secondaryText}>Keep my route</Text>
            </Pressable>
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
    maxWidth: 440,
    maxHeight: '75%',
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
    marginBottom: 14,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: INK },
  body: { flexGrow: 0 },
  loading: { alignItems: 'center', gap: 12, paddingVertical: 28 },
  loadingText: { fontSize: 14, color: ACCENT, fontWeight: '500' },
  errorWrap: { gap: 12, paddingVertical: 8 },
  errorText: { fontSize: 14, color: MUTED, lineHeight: 20 },
  message: { fontSize: 16, color: INK, lineHeight: 23, fontWeight: '500' },
  reasons: { marginTop: 12, gap: 8 },
  reasonRow: { flexDirection: 'row', gap: 8 },
  bullet: { fontSize: 14, color: MUTED, lineHeight: 20 },
  reasonText: { flex: 1, fontSize: 14, color: MUTED, lineHeight: 20 },
  question: { marginTop: 16, gap: 10 },
  questionText: { fontSize: 15, fontWeight: '600', color: INK },
  choices: { gap: 8 },
  choice: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d0d5dd',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  choiceText: { fontSize: 15, color: INK, fontWeight: '500' },
  confirm: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ddd6fe',
    backgroundColor: '#f5f3ff',
    gap: 6,
  },
  confirmTitle: { fontSize: 15, fontWeight: '700', color: INK },
  confirmLabel: { fontSize: 13, color: MUTED },
  confirmRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  footer: { marginTop: 16, gap: 10 },
  primaryButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    flex: 1,
  },
  primaryText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d0d5dd',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    flex: 1,
  },
  secondaryText: { color: INK, fontSize: 15, fontWeight: '600' },
});
