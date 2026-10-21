/**
 * AgentInsightsPanel — the AI Insights / Rethink sheet opened from the desktop bar above the
 * recommended route.
 *
 * When it opens it runs the agent in rounds (contract v3): post a round, run the returned actions on
 * the agent's own map (AgentMapBubble, instance 'agent'), capture that map, and post the next round
 * with the results and the picture, while the agent says 'continue' and round 5 is not reached.
 * The bubble's status line says what the agent is doing. The walker's main map is never touched.
 *
 * The walker chooses from options: "Keep my route" (always), "Use this route" (when the recommended
 * route differs from the best one), one "Reroute via [point]" per point the agent proposed, and any
 * question choices. Tapping "Reroute via" is the walker's consent: it sets the via pin, which makes
 * the app search again, and the panel closes with a short "Recalculating" line.
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

import { AgentMapBubble } from '@/src/components/ui/AgentMapBubble';
import { glassScrim, glassSurface } from '@/src/components/ui/glass';
import {
  AGENT_MAX_ROUNDS,
  buildAgentRouteInfos,
  getAgentSessionNumber,
  postAgentInsights,
  type AgentActionResult,
  type AgentAction,
  type AgentContext,
  type AgentInsightsRequest,
  type AgentInsightsResponse,
  type AgentRouteGeometry,
} from '@/src/services/agentClient';
import {
  rerouteOptions,
  rerouteVia,
  runAgentActions,
  type RerouteOption,
} from '@/src/services/agentActions';
import {
  EXPANDED_ROUTE_PREFIX,
  EXPANSION_MAX_ROUTES,
  fetchRouteThroughPoint,
  scoreExpandedRoutes,
} from '@/src/services/agentExpansion';
import { getMapController } from '@/src/services/mapController';
import { captureMapSnapshot } from '@/src/services/mapSnapshot';
import type { RouteScore } from '@/src/hooks/useAllRoutesSafety';
import type { SafeRoute } from '@/src/services/safeRoutes';
import type { LatLng } from '@/src/types/geo';

const ACCENT = '#6d28d9';
const INK = '#101828';
const MUTED = '#475467';
const RECALC_LINE_MS = 4000;
const AGENT_MAP = 'agent';
const DEFAULT_STATUS = 'Checking the map';
const DONE_STATUS = 'Done';
const FAILED_STATUS = 'Could not check the map';

/** The bubble's status line for a round: the first route the round looks at, else the default. */
const statusForActions = (actions: AgentAction[], routes: AgentRouteGeometry[]): string => {
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    if (action.type !== 'fit_route' && action.type !== 'show_findings') continue;
    const index = routes.findIndex((route) => route.id === action.routeId);
    if (index >= 0) return `Looking at Route ${index + 1}`;
  }
  return DEFAULT_STATUS;
};

type Phase = 'idle' | 'loading' | 'ready' | 'error';

export interface AgentInsightsPanelProps {
  visible: boolean;
  onClose: () => void;
  /** The request and candidates for the current search. Null while routes are not ready. */
  context: AgentContext | null;
  /** Selects the route the agent switched to. Called only when the walker taps "Use this route". */
  onUseRoute: (routeId: string) => void;
  /** Sets the via pin for a reroute the walker chose. The app then searches again. */
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
  const [options, setOptions] = useState<RerouteOption[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  // Kept apart from the sheet state so it outlives the sheet closing.
  const [recalcLabel, setRecalcLabel] = useState<string | null>(null);
  // Routes the agent's expand_search found this run; drawn on the agent map after the walker's routes.
  const [expandedMapRoutes, setExpandedMapRoutes] = useState<SafeRoute[]>([]);

  // Every new run bumps this; a run that is no longer the latest stops and changes nothing.
  const seqRef = useRef(0);

  /** One run of the agent: rounds until the agent is done or round AGENT_MAX_ROUNDS. */
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
      setOptions([]);
      setStatus(DEFAULT_STATUS);
      // This run's expansion routes, with their scores. A new run starts with none.
      let expanded: SafeRoute[] = [];
      let expandedScores: Record<string, RouteScore> = {};
      setExpandedMapRoutes([]);
      const onExpanded = (found: { routes: SafeRoute[]; scores: Record<string, RouteScore> }) => {
        expanded = [...expanded, ...found.routes];
        expandedScores = { ...expandedScores, ...found.scores };
        setExpandedMapRoutes(expanded);
      };
      try {
        let snapshot = await captureMapSnapshot(AGENT_MAP);
        let results: AgentActionResult[] = [];
        let round = 1;
        let result: AgentInsightsResponse;
        for (;;) {
          setStatus(DEFAULT_STATUS);
          // The walker's routes plus the ones this run added, never more than the map's total.
          const extraInfos = buildAgentRouteInfos(expanded, expandedScores, expanded);
          const extraGeometry: AgentRouteGeometry[] = expanded.map((route) => ({
            id: route.id,
            path: route.path,
            worstStretch: route.safety?.worstStretch ?? null,
          }));
          const routeGeometry = [...context.routes, ...extraGeometry];
          const request: AgentInsightsRequest = {
            ...context.body,
            routes: [...context.body.routes, ...extraInfos].slice(0, EXPANSION_MAX_ROUTES),
            ...(answer && round === 1 ? { answer } : {}),
            sessionNumber: getAgentSessionNumber(),
            round,
            results,
            ...(snapshot ? { snapshot } : {}),
          };
          result = await postAgentInsights(request);
          if (seq !== seqRef.current) return;

          setStatus(statusForActions(result.actions, routeGeometry));
          const origin = context.map?.origin ?? null;
          const destination = context.map?.destination ?? null;
          results = await runAgentActions(result.actions, {
            candidates: context.candidates,
            routes: routeGeometry,
            controller: getMapController(AGENT_MAP),
            expansion:
              origin && destination
                ? {
                    origin,
                    destination,
                    existingCount: context.body.routes.length + expanded.length,
                    fetchRoute: fetchRouteThroughPoint,
                    scoreRoutes: scoreExpandedRoutes,
                    onRoutes: onExpanded,
                  }
                : undefined,
          });
          if (seq !== seqRef.current) return;

          if (result.status !== 'continue' || round >= AGENT_MAX_ROUNDS) break;
          round += 1;
          snapshot = await captureMapSnapshot(AGENT_MAP);
        }

        setResponse(result);
        setOptions(rerouteOptions(result.actions, context.candidates));
        setStatus(DONE_STATUS);
        setPhase('ready');
      } catch (error) {
        if (seq !== seqRef.current) return;
        // Debugging: show the real cause in the dev console (kind and status only, never the body).
        if (__DEV__) console.warn('[AgentInsights] request failed', error);
        // A failed round must not leave the summary or reroute options of an earlier round on screen.
        setResponse(null);
        setOptions([]);
        setStatus(FAILED_STATUS);
        setPhase('error');
        setErrorText(FAILURE_TEXT);
      }
    },
    [context],
  );

  // The latest ask, so opening the panel does not re-run when the context object changes.
  const askRef = useRef(ask);
  askRef.current = ask;

  useEffect(() => {
    if (visible) {
      void askRef.current();
      return undefined;
    }
    // Closed: drop any run still on its way and clear the sheet.
    seqRef.current++;
    setResponse(null);
    setOptions([]);
    setErrorText(null);
    setStatus(DEFAULT_STATUS);
    setPhase('idle');
    return undefined;
  }, [visible]);

  useEffect(() => {
    if (!recalcLabel) return undefined;
    const timer = setTimeout(() => setRecalcLabel(null), RECALC_LINE_MS);
    return () => clearTimeout(timer);
  }, [recalcLabel]);

  const chooseReroute = useCallback(
    (option: RerouteOption) => {
      // One path for every reroute: the via pin is set, the app searches again.
      rerouteVia(option, onSetViaPin);
      setRecalcLabel(option.label);
      onClose();
    },
    [onSetViaPin, onClose],
  );

  // The route the agent recommends; "Use this route" is offered only when it is not the best route.
  const recommendedId = response ? (response.recommendedRouteId ?? response.decision.routeId) : null;
  // A route the agent found through a ring point is not in the walker's list, so it cannot be used directly.
  const recommendedIsExpanded = recommendedId?.startsWith(EXPANDED_ROUTE_PREFIX) ?? false;
  const switching =
    phase === 'ready' &&
    recommendedId !== null &&
    recommendedId !== context?.body.bestRouteId &&
    !recommendedIsExpanded;

  return (
    <>
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

            {context?.map && (
              <View style={styles.bubbleWrap}>
                <AgentMapBubble
                  origin={context.map.origin}
                  destination={context.map.destination}
                  routes={[...context.map.routes, ...expandedMapRoutes]}
                  selectedRouteId={context.map.selectedRouteId}
                  status={status}
                />
              </View>
            )}

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
                </View>
              )}
            </ScrollView>

            <View style={styles.footer}>
              {switching && recommendedId && (
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => {
                    onUseRoute(recommendedId);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Use this route"
                >
                  <Text style={styles.primaryText}>Use this route</Text>
                </Pressable>
              )}
              {options.map((option) => (
                <Pressable
                  key={option.candidateId}
                  style={styles.secondaryButton}
                  onPress={() => chooseReroute(option)}
                  accessibilityRole="button"
                  accessibilityLabel={`Reroute via ${option.label}`}
                >
                  <Text style={styles.secondaryText}>{`Reroute via ${option.label}`}</Text>
                </Pressable>
              ))}
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

      {recalcLabel && (
        <View style={styles.recalc} accessibilityLiveRegion="polite" pointerEvents="none">
          <Text style={styles.recalcText}>{`Recalculating your route via ${recalcLabel}`}</Text>
        </View>
      )}
    </>
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
  bubbleWrap: { alignItems: 'center', marginBottom: 12 },
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
  recalc: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    borderRadius: 12,
    backgroundColor: INK,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  recalcText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});
