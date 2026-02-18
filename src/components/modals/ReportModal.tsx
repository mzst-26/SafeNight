/**
 * ReportModal — Centered pop-up two-step report flow.
 *
 * Step 1: "What are you reporting?" — Hazard or Safety Data
 * Step 2: Pick specific category + optional description → submit
 *
 * Renders as a centered pop-up dialog (not a bottom sheet or drawer)
 * with a dimmed backdrop. Keyboard pushes the dialog up naturally.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Keyboard,
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
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';

type IoniconsName = keyof typeof Ionicons.glyphMap;

type ReportType = 'hazard' | 'data';

interface CategoryOption {
  id: ReportCategory;
  label: string;
  icon: IoniconsName;
  color: string;
  bgColor: string;
}

const HAZARD_CATEGORIES: CategoryOption[] = [
  { id: 'poor_lighting', label: 'Poor Lighting', icon: 'flashlight-outline', color: '#F59E0B', bgColor: '#FEF3C7' },
  { id: 'unsafe_area', label: 'Unsafe Area', icon: 'warning-outline', color: '#EF4444', bgColor: '#FEE2E2' },
  { id: 'obstruction', label: 'Obstruction', icon: 'construct-outline', color: '#F97316', bgColor: '#FFEDD5' },
  { id: 'harassment', label: 'Harassment', icon: 'hand-left-outline', color: '#DC2626', bgColor: '#FECACA' },
  { id: 'suspicious_activity', label: 'Suspicious Activity', icon: 'eye-outline', color: '#7C3AED', bgColor: '#EDE9FE' },
  { id: 'dead_end', label: 'Dead End', icon: 'close-circle-outline', color: '#6B7280', bgColor: '#F3F4F6' },
  { id: 'other', label: 'Other Hazard', icon: 'alert-circle-outline', color: '#6B7280', bgColor: '#F3F4F6' },
];

const DATA_CATEGORIES: CategoryOption[] = [
  { id: 'cctv', label: 'CCTV Camera', icon: 'videocam-outline', color: '#8B5CF6', bgColor: '#EDE9FE' },
  { id: 'street_light', label: 'Street Light', icon: 'bulb-outline', color: '#F59E0B', bgColor: '#FEF3C7' },
  { id: 'bus_stop', label: 'Bus Stop', icon: 'bus-outline', color: '#3B82F6', bgColor: '#DBEAFE' },
  { id: 'safe_space', label: 'Safe Space / Shop', icon: 'storefront-outline', color: '#22C55E', bgColor: '#DCFCE7' },
];

const CCTV_TYPES = [
  { id: 'city_dome', label: 'City Dome / 360°', icon: 'globe-outline' as IoniconsName, desc: 'Dome-shaped city council camera' },
  { id: 'shop', label: 'Shop / Business', icon: 'storefront-outline' as IoniconsName, desc: 'Mounted on a shop or business' },
  { id: 'police', label: 'Police / Monitoring', icon: 'shield-outline' as IoniconsName, desc: 'Police or security monitoring' },
  { id: 'residential', label: 'Residential', icon: 'home-outline' as IoniconsName, desc: 'Doorbell or home security camera' },
  { id: 'traffic', label: 'Traffic Camera', icon: 'car-outline' as IoniconsName, desc: 'Road or intersection camera' },
];

const CCTV_COVERAGE = [
  { id: '360', label: '360° Panoramic', icon: 'sync-circle-outline' as IoniconsName, desc: 'Covers all directions' },
  { id: 'pointing', label: 'Directional', icon: 'navigate-outline' as IoniconsName, desc: 'Points in a specific direction' },
];

const CCTV_HEIGHTS = [
  { id: 'ground', label: 'Ground Level', icon: 'remove-outline' as IoniconsName, desc: '~1m — eye level or below' },
  { id: 'low', label: 'Low', icon: 'trending-up-outline' as IoniconsName, desc: '~2m — just above head height' },
  { id: 'medium', label: 'Medium', icon: 'resize-outline' as IoniconsName, desc: '~3–4m — first floor level' },
  { id: 'high', label: 'High', icon: 'arrow-up-outline' as IoniconsName, desc: '~5m+ — second floor or pole' },
  { id: 'very_high', label: 'Very High', icon: 'business-outline' as IoniconsName, desc: 'Building-mounted, very high up' },
];

const getCardinal = (deg: number): string => {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
};

const getCardinalFull = (deg: number): string => {
  const dirs = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
  return dirs[Math.round(deg / 45) % 8];
};

// ── Hazard follow-up questions per category ──────────────
interface HazardQuestion {
  title: string;
  options: { id: string; label: string; icon: IoniconsName }[];
}

const HAZARD_QUESTIONS: Record<string, HazardQuestion[]> = {
  poor_lighting: [
    {
      title: 'What is the lighting issue?',
      options: [
        { id: 'broken', label: 'Broken streetlight', icon: 'flash-off-outline' },
        { id: 'none', label: 'No lighting at all', icon: 'moon-outline' },
        { id: 'dim', label: 'Dim or flickering', icon: 'flashlight-outline' },
        { id: 'shadowed', label: 'Shadowed / obstructed', icon: 'partly-sunny-outline' },
        { id: 'timed_out', label: 'Light turns off too early', icon: 'time-outline' },
      ],
    },
    {
      title: 'How dark is this area?',
      options: [
        { id: 'pitch_black', label: 'Completely dark', icon: 'moon-outline' },
        { id: 'very_dim', label: 'Very dim — hard to see', icon: 'contrast-outline' },
        { id: 'partial', label: 'Partially lit — some visibility', icon: 'sunny-outline' },
      ],
    },
  ],
  unsafe_area: [
    {
      title: 'Why does this area feel unsafe?',
      options: [
        { id: 'crime', label: 'Known for crime', icon: 'skull-outline' },
        { id: 'isolated', label: 'Isolated / no people around', icon: 'person-outline' },
        { id: 'poor_visibility', label: 'Poor visibility', icon: 'eye-off-outline' },
        { id: 'drug_activity', label: 'Drug activity', icon: 'medkit-outline' },
        { id: 'abandoned', label: 'Abandoned buildings', icon: 'business-outline' },
        { id: 'other_unsafe', label: 'Other reason', icon: 'help-circle-outline' },
      ],
    },
    {
      title: 'When is it unsafe?',
      options: [
        { id: 'night_only', label: 'Night time only', icon: 'moon-outline' },
        { id: 'day_and_night', label: 'Day and night', icon: 'sunny-outline' },
        { id: 'weekends', label: 'Mostly weekends / evenings', icon: 'calendar-outline' },
      ],
    },
  ],
  obstruction: [
    {
      title: 'What type of obstruction?',
      options: [
        { id: 'broken_pavement', label: 'Broken pavement', icon: 'alert-circle-outline' },
        { id: 'construction', label: 'Construction work', icon: 'construct-outline' },
        { id: 'vegetation', label: 'Overgrown vegetation', icon: 'leaf-outline' },
        { id: 'blocked', label: 'Blocked path / barrier', icon: 'close-circle-outline' },
        { id: 'fallen_tree', label: 'Fallen tree / debris', icon: 'git-branch-outline' },
        { id: 'vehicle', label: 'Vehicle blocking path', icon: 'car-outline' },
      ],
    },
    {
      title: 'How severe is it?',
      options: [
        { id: 'minor', label: 'Minor — can still pass', icon: 'checkmark-circle-outline' },
        { id: 'moderate', label: 'Moderate — difficult to pass', icon: 'warning-outline' },
        { id: 'major', label: 'Major — impassable', icon: 'close-circle-outline' },
      ],
    },
  ],
  harassment: [
    {
      title: 'What type of harassment?',
      options: [
        { id: 'verbal', label: 'Verbal abuse / shouting', icon: 'megaphone-outline' },
        { id: 'following', label: 'Following / stalking', icon: 'footsteps-outline' },
        { id: 'catcalling', label: 'Catcalling', icon: 'chatbubble-ellipses-outline' },
        { id: 'intimidation', label: 'Intimidation / threats', icon: 'hand-left-outline' },
        { id: 'group', label: 'Group harassment', icon: 'people-outline' },
      ],
    },
    {
      title: 'When did this happen?',
      options: [
        { id: 'just_now', label: 'Just now', icon: 'time-outline' },
        { id: 'today', label: 'Earlier today', icon: 'today-outline' },
        { id: 'recurring', label: 'Recurring issue here', icon: 'repeat-outline' },
      ],
    },
  ],
  suspicious_activity: [
    {
      title: 'What did you observe?',
      options: [
        { id: 'loitering', label: 'Loitering / hanging around', icon: 'people-outline' },
        { id: 'drug_dealing', label: 'Suspected drug dealing', icon: 'medkit-outline' },
        { id: 'vandalism', label: 'Vandalism', icon: 'hammer-outline' },
        { id: 'following_people', label: 'Someone following people', icon: 'footsteps-outline' },
        { id: 'unusual_vehicle', label: 'Unusual / unmarked vehicle', icon: 'car-outline' },
        { id: 'break_in', label: 'Attempted break-in', icon: 'key-outline' },
      ],
    },
    {
      title: 'When did you see this?',
      options: [
        { id: 'just_now', label: 'Just now', icon: 'time-outline' },
        { id: 'today', label: 'Earlier today', icon: 'today-outline' },
        { id: 'recurring', label: 'Happens regularly here', icon: 'repeat-outline' },
      ],
    },
  ],
  dead_end: [
    {
      title: 'Where is the dead end?',
      options: [
        { id: 'main_path', label: 'On my path — can\'t continue', icon: 'walk-outline' },
        { id: 'side_street', label: 'Side street / adjacent road', icon: 'git-branch-outline' },
      ],
    },
    {
      title: 'What kind of dead end?',
      options: [
        { id: 'no_through', label: 'No through road', icon: 'close-circle-outline' },
        { id: 'blocked_path', label: 'Blocked path / gate', icon: 'lock-closed-outline' },
        { id: 'fenced', label: 'Fenced off area', icon: 'grid-outline' },
        { id: 'unsafe_end', label: 'Leads to unsafe area', icon: 'warning-outline' },
      ],
    },
  ],
};

const { height: SCREEN_H } = Dimensions.get('window');
const POPUP_MAX_H = SCREEN_H * 0.92;

interface Props {
  visible: boolean;
  location: { latitude: number; longitude: number } | null;
  onClose: () => void;
  onSubmitted: (category: ReportCategory) => void;
}

const countWords = (text: string): number =>
  text.trim() === '' ? 0 : text.trim().split(/\s+/).length;

const MAX_WORDS = 100;

export function ReportModal({ visible, location, onClose, onSubmitted }: Props) {
  const [step, setStep] = useState<'type' | 'category' | 'hazard_q1' | 'hazard_q2' | 'hazard_details' | 'deadend_direction' | 'cctv_type' | 'cctv_coverage' | 'cctv_height' | 'cctv_direction' | 'cctv_details'>('type');
  const [reportType, setReportType] = useState<ReportType | null>(null);
  const [selected, setSelected] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState('');
  const [openTime, setOpenTime] = useState('');
  const [closeTime, setCloseTime] = useState('');
  const [cctvType, setCctvType] = useState<string | null>(null);
  const [cctvCoverage, setCctvCoverage] = useState<'360' | 'pointing' | null>(null);
  const [cctvHeight, setCctvHeight] = useState<string | null>(null);
  const [cctvDirection, setCctvDirection] = useState<number | null>(null);
  const [cctvDirectionLocked, setCctvDirectionLocked] = useState(false);
  const [compassHeading, setCompassHeading] = useState(0);
  const compassAnim = useRef(new Animated.Value(0)).current;
  const smoothedHeading = useRef(0);
  const lastCardinalSlot = useRef(-1);
  const compassSampleCount = useRef(0);
  const [compassCalibrated, setCompassCalibrated] = useState(false);
  const [hazardAnswer1, setHazardAnswer1] = useState<string | null>(null);
  const [hazardAnswer2, setHazardAnswer2] = useState<string | null>(null);
  const [deadendDirection, setDeadendDirection] = useState<number | null>(null);
  const [deadendDirLocked, setDeadendDirLocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const popupTranslateY = useRef(new Animated.Value(0)).current;

  // Listen for keyboard and shift the popup upward so inputs stay visible
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = Keyboard.addListener(showEvent, (e) => {
      const kbHeight = e.endCoordinates.height;
      // Move popup up by ~40% of keyboard height so input area is visible
      Animated.timing(popupTranslateY, {
        toValue: -(kbHeight * 0.4),
        duration: Platform.OS === 'ios' ? (e.duration ?? 250) : 200,
        useNativeDriver: true,
      }).start();
      // Auto-scroll to bottom of content so active field is visible
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });

    const onHide = Keyboard.addListener(hideEvent, () => {
      Animated.timing(popupTranslateY, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });

    return () => { onShow.remove(); onHide.remove(); };
  }, [popupTranslateY]);

  // Compass heading for CCTV direction step and dead-end side direction
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    const needsCompass =
      (step === 'cctv_direction' && !cctvDirectionLocked) ||
      (step === 'deadend_direction' && !deadendDirLocked);
    if (needsCompass) {
      // Reset calibration state when compass step opens
      compassSampleCount.current = 0;
      setCompassCalibrated(false);
      (async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          sub = await Location.watchHeadingAsync((h) => {
            const raw = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;

            // Track samples for calibration gate (~30 samples at ~10Hz = 3 seconds)
            compassSampleCount.current += 1;
            if (!compassCalibrated && compassSampleCount.current >= 30) {
              setCompassCalibrated(true);
            }

            // Low-pass filter with 360/0 wraparound handling
            const prev = smoothedHeading.current;
            let delta = raw - prev;
            // Shortest-path: if delta > 180, go the other way
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            // Smoothing factor — lower = smoother
            const alpha = 0.08;
            let smoothed = prev + alpha * delta;
            // Normalise back to 0–360
            if (smoothed < 0) smoothed += 360;
            if (smoothed >= 360) smoothed -= 360;

            smoothedHeading.current = smoothed;
            setCompassHeading(smoothed);

            // Haptic tick every 45° (N, NE, E, SE, S, SW, W, NW)
            const slot = Math.floor(((smoothed + 22.5) % 360) / 45);
            if (slot !== lastCardinalSlot.current) {
              lastCardinalSlot.current = slot;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }

            // Animate the ring rotation smoothly
            Animated.timing(compassAnim, {
              toValue: -smoothed,
              duration: 300,
              useNativeDriver: true,
            }).start();
          });
        }
      })();
    }
    return () => { sub?.remove(); };
  }, [step, cctvDirectionLocked, deadendDirLocked, compassAnim]);

  const categories = reportType === 'hazard' ? HAZARD_CATEGORIES : DATA_CATEGORIES;
  const isHazard = reportType === 'hazard';
  const isSafeSpace = selected === 'safe_space';
  const wordCount = countWords(description);

  const handleDescriptionChange = (text: string) => {
    const words = text.trim().split(/\s+/);
    if (text.trim() === '' || words.length <= MAX_WORDS) {
      setDescription(text);
    } else {
      setDescription(words.slice(0, MAX_WORDS).join(' '));
    }
  };

  const handleTimeInput = (
    text: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
  ) => {
    const digits = text.replace(/[^0-9]/g, '').slice(0, 4);
    if (digits.length <= 2) setter(digits);
    else setter(digits.slice(0, 2) + ':' + digits.slice(2));
  };

  const resetState = useCallback(() => {
    setStep('type');
    setReportType(null);
    setSelected(null);
    setDescription('');
    setOpenTime('');
    setCloseTime('');
    setCctvType(null);
    setCctvCoverage(null);
    setCctvHeight(null);
    setCctvDirection(null);
    setCctvDirectionLocked(false);
    setCompassHeading(0);
    compassAnim.setValue(0);
    smoothedHeading.current = 0;
    compassSampleCount.current = 0;
    setCompassCalibrated(false);
    setHazardAnswer1(null);
    setHazardAnswer2(null);
    setDeadendDirection(null);
    setDeadendDirLocked(false);
    setError(null);
  }, []);

  const handleTypeChoice = (type: ReportType) => {
    setReportType(type);
    setStep('category');
    setSelected(null);
    setDescription('');
    setOpenTime('');
    setCloseTime('');
    setError(null);
  };

  const handleBack = () => {
    if (step === 'hazard_q1') {
      setSelected(null);
      setHazardAnswer1(null);
      setStep('category');
    } else if (step === 'hazard_q2') {
      setHazardAnswer2(null);
      setStep('hazard_q1');
    } else if (step === 'hazard_details') {
      // Dead-end side street flow goes back to compass
      if (selected === 'dead_end' && hazardAnswer1 === 'side_street') {
        setDeadendDirection(null);
        setDeadendDirLocked(false);
        setStep('deadend_direction');
      } else {
        setStep('hazard_q2');
      }
    } else if (step === 'deadend_direction') {
      setDeadendDirection(null);
      setDeadendDirLocked(false);
      setStep('hazard_q2');
    } else if (step === 'cctv_type') {
      setSelected(null);
      setCctvType(null);
      setStep('category');
    } else if (step === 'cctv_coverage') {
      setCctvCoverage(null);
      setStep('cctv_type');
    } else if (step === 'cctv_height') {
      setCctvHeight(null);
      setStep('cctv_coverage');
    } else if (step === 'cctv_direction') {
      setCctvDirection(null);
      setCctvDirectionLocked(false);
      setStep('cctv_height');
    } else if (step === 'cctv_details') {
      if (cctvCoverage === 'pointing') {
        setCctvDirection(null);
        setCctvDirectionLocked(false);
        setStep('cctv_direction');
      } else {
        setStep('cctv_height');
      }
    } else {
      resetState();
    }
  };

  const isCctvStep = step.startsWith('cctv_');
  const cctvStepNum = step === 'cctv_type' ? 1 : step === 'cctv_coverage' ? 2 : step === 'cctv_height' ? 3 : step === 'cctv_direction' ? 4 : step === 'cctv_details' ? (cctvCoverage === 'pointing' ? 5 : 4) : 0;
  const cctvTotalSteps = cctvCoverage === 'pointing' ? 5 : 4;

  const isHazardStep = step.startsWith('hazard_') || step.startsWith('deadend_');
  const hazardQuestions = selected ? HAZARD_QUESTIONS[selected] : undefined;
  const isDeadendSide = selected === 'dead_end' && hazardAnswer1 === 'side_street';
  const deadendExtraSteps = isDeadendSide ? 1 : 0; // compass
  const hazardTotalSteps = 3 + deadendExtraSteps;
  const hazardStepNum = step === 'hazard_q1' ? 1
    : step === 'hazard_q2' ? 2
    : step === 'deadend_direction' ? 3
    : step === 'hazard_details' ? hazardTotalSteps
    : 0;

  const handleCategorySelect = (catId: ReportCategory) => {
    setSelected(catId);
    setError(null);
    if (catId === 'cctv') {
      setStep('cctv_type');
    } else if (HAZARD_QUESTIONS[catId]) {
      setHazardAnswer1(null);
      setHazardAnswer2(null);
      setStep('hazard_q1');
    }
  };

  const handleSubmit = useCallback(async () => {
    if (!selected || !location) return;
    if (selected === 'safe_space' && (!openTime || !closeTime)) {
      setError('Please enter opening and closing times for this place.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Build structured metadata for fast querying
      let metadata: Record<string, unknown> | null = null;

      if (selected === 'cctv') {
        metadata = {
          cctv_type: cctvType,
          coverage: cctvCoverage,
          height: cctvHeight,
          ...(cctvCoverage === 'pointing' && cctvDirection != null
            ? {
                direction: Math.round(cctvDirection),
                direction_cardinal: getCardinalFull(cctvDirection),
              }
            : {}),
        };
      } else if (selected === 'safe_space') {
        metadata = {
          open_time: openTime,
          close_time: closeTime,
        };
      } else {
        // Hazard categories with follow-up questions
        const hQuestions = HAZARD_QUESTIONS[selected];
        if (hQuestions) {
          metadata = {
            question1: hazardAnswer1,
            question2: hazardAnswer2,
            ...(selected === 'dead_end' && hazardAnswer1 === 'side_street' && deadendDirection != null
              ? {
                  direction: Math.round(deadendDirection),
                  direction_cardinal: getCardinalFull(deadendDirection),
                }
              : {}),
          };
        }
      }

      await reportsApi.submit({
        lat: location.latitude,
        lng: location.longitude,
        category: selected,
        description: description.trim(),
        metadata,
      });
      Alert.alert(
        isHazard ? 'Hazard Reported' : 'Data Submitted',
        isHazard
          ? 'Thank you for helping keep others safe. Your hazard report has been recorded.'
          : 'Thank you! Your safety data report helps improve route scoring for everyone.',
        [{ text: 'OK' }],
      );
      onSubmitted(selected);
      resetState();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit report';
      setError(msg);
      Alert.alert('Submission Failed', msg, [{ text: 'OK' }]);
    } finally {
      setSubmitting(false);
    }
  }, [selected, location, description, openTime, closeTime, isHazard, onSubmitted, resetState, cctvType, cctvCoverage, cctvHeight, cctvDirection, hazardAnswer1, hazardAnswer2, deadendDirection]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const submitDisabled =
    !selected || !location || submitting ||
    (isSafeSpace && (!openTime || !closeTime)) ||
    (selected === 'cctv' && step !== 'cctv_details') ||
    (isHazardStep && step !== 'hazard_details');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.centeredWrap}>
          <Animated.View style={[styles.popup, { transform: [{ translateY: popupTranslateY }] }]}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                {(step === 'category' || isCctvStep || isHazardStep) && (
                  <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={12}>
                    <Ionicons name="arrow-back" size={18} color="#374151" />
                  </Pressable>
                )}
                <View style={[styles.headerIcon, { backgroundColor: isHazard ? '#FEE2E2' : '#DBEAFE' }]}>
                  <Ionicons
                    name={step === 'type' ? 'flag' : isCctvStep ? 'videocam' : isHazardStep ? 'warning' : isHazard ? 'warning' : 'information-circle'}
                    size={18}
                    color={step === 'type' ? '#EF4444' : isCctvStep ? '#8B5CF6' : isHazardStep ? '#EF4444' : isHazard ? '#EF4444' : '#3B82F6'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>
                    {step === 'type' ? 'Submit a Report'
                      : isCctvStep ? 'CCTV Report'
                      : isHazardStep ? (HAZARD_CATEGORIES.find(c => c.id === selected)?.label ?? 'Hazard Report')
                      : isHazard ? 'Report a Hazard'
                      : 'Report Safety Data'}
                  </Text>
                  <Text style={styles.subtitle}>
                    {step === 'type' ? 'What would you like to report?'
                      : isCctvStep ? `Step ${cctvStepNum} of ${cctvTotalSteps}`
                      : isHazardStep ? `Step ${hazardStepNum} of ${hazardTotalSteps}`
                      : isHazard ? 'Help keep others safe'
                      : 'Help improve route safety scoring'}
                  </Text>
                </View>
              </View>
              <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={12}>
                <Ionicons name="close" size={20} color="#6B7280" />
              </Pressable>
            </View>

            {/* Scrollable body */}
            <ScrollView
              ref={scrollRef}
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {/* Step 1 */}
              {step === 'type' && (
                <>
                  <Pressable style={styles.typeCard} onPress={() => handleTypeChoice('hazard')}>
                    <View style={[styles.typeIcon, { backgroundColor: '#FEE2E2' }]}>
                      <Ionicons name="warning" size={26} color="#EF4444" />
                    </View>
                    <View style={styles.typeInfo}>
                      <Text style={styles.typeTitle}>Report a Hazard</Text>
                      <Text style={styles.typeDesc}>
                        Poor lighting, unsafe area, obstruction, harassment, suspicious activity, dead end
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                  </Pressable>
                  <Pressable style={styles.typeCard} onPress={() => handleTypeChoice('data')}>
                    <View style={[styles.typeIcon, { backgroundColor: '#DBEAFE' }]}>
                      <Ionicons name="information-circle" size={26} color="#3B82F6" />
                    </View>
                    <View style={styles.typeInfo}>
                      <Text style={styles.typeTitle}>Report Safety Data</Text>
                      <Text style={styles.typeDesc}>
                        CCTV camera, street light, bus stop, safe space — things that make an area safer
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                  </Pressable>
                </>
              )}

              {/* Step 2 */}
              {step === 'category' && (
                <>
                  <Text style={styles.sectionLabel}>
                    {isHazard ? "What's the issue?" : 'What did you find?'}
                  </Text>
                  <View style={styles.grid}>
                    {categories.map((cat) => {
                      const isSel = selected === cat.id;
                      return (
                        <Pressable
                          key={cat.id}
                          onPress={() => handleCategorySelect(cat.id)}
                          style={[
                            styles.categoryCard,
                            { borderColor: isSel ? cat.color : '#E5E7EB' },
                            isSel && { backgroundColor: cat.bgColor },
                          ]}
                        >
                          <View style={[styles.categoryIcon, { backgroundColor: cat.bgColor }]}>
                            <Ionicons name={cat.icon} size={20} color={cat.color} />
                          </View>
                          <Text style={[styles.categoryLabel, isSel && { color: cat.color, fontWeight: '700' }]}>
                            {cat.label}
                          </Text>
                          {isSel && (
                            <View style={[styles.checkBadge, { backgroundColor: cat.color }]}>
                              <Ionicons name="checkmark" size={11} color="#fff" />
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Safe Space: opening / closing times */}
                  {isSafeSpace && (
                    <>
                      <Text style={styles.sectionLabel}>Opening Hours (required)</Text>
                      <View style={styles.timeRow}>
                        <View style={styles.timeField}>
                          <Text style={styles.timeLabel}>Opens</Text>
                          <TextInput
                            style={styles.timeInput}
                            placeholder="09:00"
                            placeholderTextColor="#9CA3AF"
                            value={openTime}
                            onChangeText={(t) => handleTimeInput(t, setOpenTime)}
                            keyboardType="number-pad"
                            maxLength={5}
                          />
                        </View>
                        <Ionicons name="arrow-forward" size={16} color="#9CA3AF" style={{ marginTop: 20 }} />
                        <View style={styles.timeField}>
                          <Text style={styles.timeLabel}>Closes</Text>
                          <TextInput
                            style={styles.timeInput}
                            placeholder="22:00"
                            placeholderTextColor="#9CA3AF"
                            value={closeTime}
                            onChangeText={(t) => handleTimeInput(t, setCloseTime)}
                            keyboardType="number-pad"
                            maxLength={5}
                          />
                        </View>
                      </View>
                    </>
                  )}

                  {/* Description (only for categories without their own wizard) */}
                  {selected && !HAZARD_QUESTIONS[selected] && selected !== 'cctv' && (
                    <>
                      <View style={styles.detailsHeader}>
                        <Text style={styles.sectionLabel}>Details (optional)</Text>
                        <Text style={[styles.wordCount, wordCount >= MAX_WORDS && styles.wordCountMax]}>
                          {wordCount}/{MAX_WORDS} words
                        </Text>
                      </View>
                      <TextInput
                        style={styles.input}
                        placeholder={
                          isHazard
                            ? 'e.g. Broken streetlight near the park entrance'
                            : isSafeSpace
                              ? 'e.g. 24h newsagent, friendly staff, well-lit'
                              : 'e.g. Working CCTV on the corner of High Street'
                        }
                        placeholderTextColor="#9CA3AF"
                        value={description}
                        onChangeText={handleDescriptionChange}
                        multiline
                        textAlignVertical="top"
                        onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200)}
                      />
                    </>
                  )}

                  {/* No location warning */}
                  {!location && (
                    <View style={styles.warningBanner}>
                      <Ionicons name="location-outline" size={14} color="#F59E0B" />
                      <Text style={styles.warningText}>
                        Location unavailable — enable location services to report
                      </Text>
                    </View>
                  )}

                  {/* Web platform restriction */}
                  {Platform.OS === 'web' && (
                    <View style={styles.webRestrictionBanner}>
                      <Ionicons name="phone-portrait-outline" size={18} color="#3B82F6" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.webRestrictionTitle}>Mobile App Required</Text>
                        <Text style={styles.webRestrictionText}>
                          Report submission is only available on the mobile app. Download the Android app to submit reports.
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Error */}
                  {error && (
                    <View style={styles.errorBanner}>
                      <Ionicons name="alert-circle" size={14} color="#EF4444" />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}

                  {/* Submit */}
                  {Platform.OS === 'web' ? (
                    <Pressable
                      onPress={() => window.open('https://github.com/Jrtowers-prog/PlymHack2026New/releases/download/latest/SafeNightHome.apk', '_blank', 'noopener,noreferrer')}
                      style={[styles.submitBtn, { backgroundColor: '#3B82F6' }]}
                    >
                      <Ionicons name="download-outline" size={14} color="#fff" />
                      <Text style={styles.submitText}>Download Android App</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={handleSubmit}
                      disabled={submitDisabled}
                      style={[
                        styles.submitBtn,
                        { backgroundColor: isHazard ? '#EF4444' : '#3B82F6' },
                        submitDisabled && styles.submitBtnDisabled,
                      ]}
                    >
                      {submitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="send" size={14} color="#fff" />
                          <Text style={styles.submitText}>
                            {isHazard ? 'Submit Hazard Report' : 'Submit Data Report'}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </>
              )}

              {/* Hazard Wizard — Step 1: First question */}
              {step === 'hazard_q1' && hazardQuestions && (
                <>
                  <Text style={styles.sectionLabel}>{hazardQuestions[0].title}</Text>
                  {hazardQuestions[0].options.map((opt) => (
                    <Pressable
                      key={opt.id}
                      style={styles.wizardCard}
                      onPress={() => { setHazardAnswer1(opt.id); setStep('hazard_q2'); }}
                    >
                      <View style={[styles.wizardCardIcon, { backgroundColor: '#FEE2E2' }]}>
                        <Ionicons name={opt.icon} size={22} color="#EF4444" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.wizardCardTitle}>{opt.label}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                    </Pressable>
                  ))}
                </>
              )}

              {/* Hazard Wizard — Step 2: Second question */}
              {step === 'hazard_q2' && hazardQuestions && (
                <>
                  <Text style={styles.sectionLabel}>{hazardQuestions[1].title}</Text>
                  {hazardQuestions[1].options.map((opt) => (
                    <Pressable
                      key={opt.id}
                      style={styles.wizardCard}
                      onPress={() => {
                        setHazardAnswer2(opt.id);
                        // Dead-end side street: need compass direction
                        if (selected === 'dead_end' && hazardAnswer1 === 'side_street') {
                          setStep('deadend_direction');
                        } else {
                          setStep('hazard_details');
                        }
                      }}
                    >
                      <View style={[styles.wizardCardIcon, { backgroundColor: '#FEF3C7' }]}>
                        <Ionicons name={opt.icon} size={22} color="#F59E0B" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.wizardCardTitle}>{opt.label}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                    </Pressable>
                  ))}
                </>
              )}

              {/* Dead End — Compass: point towards the dead-end street */}
              {step === 'deadend_direction' && (
                <>
                  <Text style={styles.sectionLabel}>
                    Point your phone towards the dead-end street
                  </Text>
                  {Platform.OS === 'web' && (
                    <View style={styles.webRestrictionBanner}>
                      <Ionicons name="phone-portrait-outline" size={18} color="#3B82F6" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.webRestrictionTitle}>Compass Not Available on Web</Text>
                        <Text style={styles.webRestrictionText}>
                          Direction selection requires device compass sensors. Please download the Android app to use this feature.
                        </Text>
                      </View>
                    </View>
                  )}
                  {Platform.OS === 'web' ? (
                    <Pressable
                      onPress={() => window.open('https://github.com/Jrtowers-prog/PlymHack2026New/releases/download/latest/SafeNightHome.apk', '_blank', 'noopener,noreferrer')}
                      style={[styles.submitBtn, { backgroundColor: '#3B82F6', marginTop: 16 }]}
                    >
                      <Ionicons name="download-outline" size={14} color="#fff" />
                      <Text style={styles.submitText}>Download Android App</Text>
                    </Pressable>
                  ) : (
                  <View style={styles.compassContainer}>
                    {/* Calibration notice */}
                    {!compassCalibrated && !deadendDirLocked && (
                      <View style={styles.calibrationNotice}>
                        <Text style={styles.calibrationIcon}>♾️</Text>
                        <Text style={styles.calibrationText}>
                          Move your phone in a figure-8 to calibrate the compass
                        </Text>
                      </View>
                    )}
                    {compassCalibrated && !deadendDirLocked && (
                      <View style={styles.calibrationReady}>
                        <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
                        <Text style={styles.calibrationReadyText}>Compass ready — point & lock</Text>
                      </View>
                    )}
                    {/* Fixed pointer — always at top, shows "you're pointing here" */}
                    <View style={styles.compassPointer} />
                    {/* Rotating ring — N always faces real-world north */}
                    <Animated.View
                      style={[
                        styles.compassRing,
                        !compassCalibrated && !deadendDirLocked && { opacity: 0.4 },
                        deadendDirLocked
                          ? { transform: [{ rotate: `${-(deadendDirection ?? 0)}deg` }] }
                          : {
                              transform: [{
                                rotate: compassAnim.interpolate({
                                  inputRange: [-360, 360],
                                  outputRange: ['-360deg', '360deg'],
                                }),
                              }],
                            },
                      ]}
                    >
                      {/* Tick marks every 15° */}
                      {Array.from({ length: 24 }, (_, i) => {
                        const deg = i * 15;
                        const isMajor = deg % 90 === 0;
                        const isMid = deg % 45 === 0 && !isMajor;
                        return (
                          <View
                            key={deg}
                            style={[
                              styles.compassTick,
                              {
                                transform: [{ rotate: `${deg}deg` }, { translateY: -93 }],
                                height: isMajor ? 12 : isMid ? 8 : 5,
                                width: isMajor ? 2.5 : isMid ? 2 : 1,
                                backgroundColor: isMajor ? '#374151' : isMid ? '#9CA3AF' : '#D1D5DB',
                              },
                            ]}
                          />
                        );
                      })}
                      <Text style={[styles.compassCardinal, styles.compassN]}>N</Text>
                      <Text style={[styles.compassCardinal, styles.compassE]}>E</Text>
                      <Text style={[styles.compassCardinal, styles.compassS]}>S</Text>
                      <Text style={[styles.compassCardinal, styles.compassW]}>W</Text>
                    </Animated.View>
                    {/* Friendly direction readout */}
                    <Text style={styles.compassFacingLabel}>You are facing</Text>
                    <Text style={styles.compassFacingDirection}>
                      {getCardinalFull(deadendDirLocked ? (deadendDirection ?? 0) : compassHeading)}
                    </Text>
                    <Text style={styles.compassFacingDegrees}>
                      {Math.round(deadendDirLocked ? (deadendDirection ?? 0) : compassHeading)}°
                    </Text>
                  </View>
                  )}
                  {deadendDirLocked ? (
                    <View style={styles.directionLockedRow}>
                      <View style={styles.directionLockedBadge}>
                        <Ionicons name="lock-closed" size={14} color="#22C55E" />
                        <Text style={styles.directionLockedText}>
                          Locked: {getCardinalFull(deadendDirection ?? 0)} ({Math.round(deadendDirection ?? 0)}°)
                        </Text>
                      </View>
                      <Pressable
                        style={styles.directionUnlockBtn}
                        onPress={() => { setDeadendDirLocked(false); setDeadendDirection(null); }}
                      >
                        <Text style={styles.directionUnlockText}>Re-aim</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      style={[styles.lockBtn, !compassCalibrated && styles.lockBtnDisabled]}
                      disabled={!compassCalibrated}
                      onPress={() => { setDeadendDirection(compassHeading); setDeadendDirLocked(true); }}
                    >
                      <Ionicons name="lock-closed" size={16} color="#fff" />
                      <Text style={styles.lockBtnText}>
                        {compassCalibrated ? 'Lock Direction' : 'Calibrating…'}
                      </Text>
                    </Pressable>
                  )}
                  {deadendDirLocked && (
                    <Pressable
                      style={[styles.submitBtn, { backgroundColor: '#6B7280', marginTop: 16 }]}
                      onPress={() => setStep('hazard_details')}
                    >
                      <Text style={styles.submitText}>Continue</Text>
                      <Ionicons name="arrow-forward" size={14} color="#fff" />
                    </Pressable>
                  )}
                </>
              )}

              {/* Hazard Wizard — Final Step: Summary + Details + Submit */}
              {step === 'hazard_details' && hazardQuestions && (
                <>
                  {/* Summary */}
                  <View style={[styles.cctvSummary, { backgroundColor: '#FEF2F2' }]}>
                    <Text style={[styles.cctvSummaryTitle, { color: '#991B1B' }]}>Report Summary</Text>
                    <View style={styles.cctvSummaryRow}>
                      <Ionicons name={(HAZARD_CATEGORIES.find(c => c.id === selected)?.icon ?? 'warning-outline') as IoniconsName} size={14} color="#EF4444" />
                      <Text style={styles.cctvSummaryText}>
                        {HAZARD_CATEGORIES.find(c => c.id === selected)?.label}
                      </Text>
                    </View>
                    <View style={styles.cctvSummaryRow}>
                      <Ionicons name={(hazardQuestions[0].options.find(o => o.id === hazardAnswer1)?.icon ?? 'help-outline') as IoniconsName} size={14} color="#EF4444" />
                      <Text style={styles.cctvSummaryText}>
                        {hazardQuestions[0].options.find(o => o.id === hazardAnswer1)?.label}
                      </Text>
                    </View>
                    <View style={styles.cctvSummaryRow}>
                      <Ionicons name={(hazardQuestions[1].options.find(o => o.id === hazardAnswer2)?.icon ?? 'help-outline') as IoniconsName} size={14} color="#EF4444" />
                      <Text style={styles.cctvSummaryText}>
                        {hazardQuestions[1].options.find(o => o.id === hazardAnswer2)?.label}
                      </Text>
                    </View>
                    {isDeadendSide && deadendDirection != null && (
                      <View style={styles.cctvSummaryRow}>
                        <Ionicons name="compass-outline" size={14} color="#EF4444" />
                        <Text style={styles.cctvSummaryText}>
                          Direction: {Math.round(deadendDirection)}° {getCardinalFull(deadendDirection)}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Optional description */}
                  <View style={styles.detailsHeader}>
                    <Text style={styles.sectionLabel}>Additional Details (optional)</Text>
                    <Text style={[styles.wordCount, wordCount >= MAX_WORDS && styles.wordCountMax]}>
                      {wordCount}/{MAX_WORDS} words
                    </Text>
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Any extra details about this hazard…"
                    placeholderTextColor="#9CA3AF"
                    value={description}
                    onChangeText={handleDescriptionChange}
                    multiline
                    textAlignVertical="top"
                    onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200)}
                  />

                  {/* No location warning */}
                  {!location && (
                    <View style={styles.warningBanner}>
                      <Ionicons name="location-outline" size={14} color="#F59E0B" />
                      <Text style={styles.warningText}>
                        Location unavailable — enable location services to report
                      </Text>
                    </View>
                  )}

                  {/* Web platform restriction */}
                  {Platform.OS === 'web' && (
                    <View style={styles.webRestrictionBanner}>
                      <Ionicons name="phone-portrait-outline" size={18} color="#3B82F6" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.webRestrictionTitle}>Mobile App Required</Text>
                        <Text style={styles.webRestrictionText}>
                          Report submission is only available on the mobile app. Download the Android app to submit reports.
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Error */}
                  {error && (
                    <View style={styles.errorBanner}>
                      <Ionicons name="alert-circle" size={14} color="#EF4444" />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}

                  {/* Submit */}
                  {Platform.OS === 'web' ? (
                    <Pressable
                      onPress={() => window.open('https://github.com/Jrtowers-prog/PlymHack2026New/releases/download/latest/SafeNightHome.apk', '_blank', 'noopener,noreferrer')}
                      style={[styles.submitBtn, { backgroundColor: '#3B82F6' }]}
                    >
                      <Ionicons name="download-outline" size={14} color="#fff" />
                      <Text style={styles.submitText}>Download Android App</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={handleSubmit}
                      disabled={!location || submitting}
                      style={[
                        styles.submitBtn,
                        { backgroundColor: '#EF4444' },
                        (!location || submitting) && styles.submitBtnDisabled,
                      ]}
                    >
                      {submitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="send" size={14} color="#fff" />
                          <Text style={styles.submitText}>Submit Hazard Report</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </>
              )}

              {/* CCTV Wizard — Step 1: Camera Type */}
              {step === 'cctv_type' && (
                <>
                  <Text style={styles.sectionLabel}>What type of camera?</Text>
                  {CCTV_TYPES.map((cam) => (
                    <Pressable
                      key={cam.id}
                      style={styles.wizardCard}
                      onPress={() => { setCctvType(cam.id); setStep('cctv_coverage'); }}
                    >
                      <View style={[styles.wizardCardIcon, { backgroundColor: '#EDE9FE' }]}>
                        <Ionicons name={cam.icon} size={22} color="#8B5CF6" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.wizardCardTitle}>{cam.label}</Text>
                        <Text style={styles.wizardCardDesc}>{cam.desc}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                    </Pressable>
                  ))}
                </>
              )}

              {/* CCTV Wizard — Step 2: Coverage */}
              {step === 'cctv_coverage' && (
                <>
                  <Text style={styles.sectionLabel}>Camera coverage</Text>
                  {CCTV_COVERAGE.map((cov) => (
                    <Pressable
                      key={cov.id}
                      style={styles.wizardCardLarge}
                      onPress={() => {
                        setCctvCoverage(cov.id as '360' | 'pointing');
                        setStep('cctv_height');
                      }}
                    >
                      <View style={[styles.wizardCardIconLarge, { backgroundColor: cov.id === '360' ? '#DBEAFE' : '#FEF3C7' }]}>
                        <Ionicons name={cov.icon} size={32} color={cov.id === '360' ? '#3B82F6' : '#F59E0B'} />
                      </View>
                      <Text style={styles.wizardCardLargeTitle}>{cov.label}</Text>
                      <Text style={styles.wizardCardDesc}>{cov.desc}</Text>
                    </Pressable>
                  ))}
                </>
              )}

              {/* CCTV Wizard — Step 3: Height */}
              {step === 'cctv_height' && (
                <>
                  <Text style={styles.sectionLabel}>Approximate camera height</Text>
                  {CCTV_HEIGHTS.map((ht) => (
                    <Pressable
                      key={ht.id}
                      style={styles.wizardCard}
                      onPress={() => {
                        setCctvHeight(ht.id);
                        if (cctvCoverage === 'pointing') setStep('cctv_direction');
                        else setStep('cctv_details');
                      }}
                    >
                      <View style={[styles.wizardCardIcon, { backgroundColor: '#F0FDF4' }]}>
                        <Ionicons name={ht.icon} size={22} color="#22C55E" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.wizardCardTitle}>{ht.label}</Text>
                        <Text style={styles.wizardCardDesc}>{ht.desc}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                    </Pressable>
                  ))}
                </>
              )}

              {/* CCTV Wizard — Step 4: Direction (compass) */}
              {step === 'cctv_direction' && (
                <>
                  <Text style={styles.sectionLabel}>
                    Point your phone in the direction the camera faces
                  </Text>
                  {Platform.OS === 'web' && (
                    <View style={styles.webRestrictionBanner}>
                      <Ionicons name="phone-portrait-outline" size={18} color="#3B82F6" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.webRestrictionTitle}>Compass Not Available on Web</Text>
                        <Text style={styles.webRestrictionText}>
                          Direction selection requires device compass sensors. Please download the Android app to use this feature.
                        </Text>
                      </View>
                    </View>
                  )}
                  {Platform.OS === 'web' ? (
                    <Pressable
                      onPress={() => window.open('https://github.com/Jrtowers-prog/PlymHack2026New/releases/download/latest/SafeNightHome.apk', '_blank', 'noopener,noreferrer')}
                      style={[styles.submitBtn, { backgroundColor: '#3B82F6', marginTop: 16 }]}
                    >
                      <Ionicons name="download-outline" size={14} color="#fff" />
                      <Text style={styles.submitText}>Download Android App</Text>
                    </Pressable>
                  ) : (
                  <View style={styles.compassContainer}>
                    {/* Calibration notice */}
                    {!compassCalibrated && !cctvDirectionLocked && (
                      <View style={styles.calibrationNotice}>
                        <Text style={styles.calibrationIcon}>♾️</Text>
                        <Text style={styles.calibrationText}>
                          Move your phone in a figure-8 to calibrate the compass
                        </Text>
                      </View>
                    )}
                    {compassCalibrated && !cctvDirectionLocked && (
                      <View style={styles.calibrationReady}>
                        <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
                        <Text style={styles.calibrationReadyText}>Compass ready — point & lock</Text>
                      </View>
                    )}
                    {/* Fixed pointer — always at top, shows "you're pointing here" */}
                    <View style={styles.compassPointer} />
                    {/* Rotating ring — N always faces real-world north */}
                    <Animated.View
                      style={[
                        styles.compassRing,
                        !compassCalibrated && !cctvDirectionLocked && { opacity: 0.4 },
                        cctvDirectionLocked
                          ? { transform: [{ rotate: `${-(cctvDirection ?? 0)}deg` }] }
                          : {
                              transform: [{
                                rotate: compassAnim.interpolate({
                                  inputRange: [-360, 360],
                                  outputRange: ['-360deg', '360deg'],
                                }),
                              }],
                            },
                      ]}
                    >
                      {/* Tick marks every 15° */}
                      {Array.from({ length: 24 }, (_, i) => {
                        const deg = i * 15;
                        const isMajor = deg % 90 === 0;
                        const isMid = deg % 45 === 0 && !isMajor;
                        return (
                          <View
                            key={deg}
                            style={[
                              styles.compassTick,
                              {
                                transform: [{ rotate: `${deg}deg` }, { translateY: -93 }],
                                height: isMajor ? 12 : isMid ? 8 : 5,
                                width: isMajor ? 2.5 : isMid ? 2 : 1,
                                backgroundColor: isMajor ? '#374151' : isMid ? '#9CA3AF' : '#D1D5DB',
                              },
                            ]}
                          />
                        );
                      })}
                      <Text style={[styles.compassCardinal, styles.compassN]}>N</Text>
                      <Text style={[styles.compassCardinal, styles.compassE]}>E</Text>
                      <Text style={[styles.compassCardinal, styles.compassS]}>S</Text>
                      <Text style={[styles.compassCardinal, styles.compassW]}>W</Text>
                    </Animated.View>
                    {/* Friendly direction readout */}
                    <Text style={styles.compassFacingLabel}>You are facing</Text>
                    <Text style={styles.compassFacingDirection}>
                      {getCardinalFull(cctvDirectionLocked ? (cctvDirection ?? 0) : compassHeading)}
                    </Text>
                    <Text style={styles.compassFacingDegrees}>
                      {Math.round(cctvDirectionLocked ? (cctvDirection ?? 0) : compassHeading)}°
                    </Text>
                  </View>
                  )}
                  {cctvDirectionLocked ? (
                    <View style={styles.directionLockedRow}>
                      <View style={styles.directionLockedBadge}>
                        <Ionicons name="lock-closed" size={14} color="#22C55E" />
                        <Text style={styles.directionLockedText}>
                          Locked: {getCardinalFull(cctvDirection ?? 0)} ({Math.round(cctvDirection ?? 0)}°)
                        </Text>
                      </View>
                      <Pressable
                        style={styles.directionUnlockBtn}
                        onPress={() => { setCctvDirectionLocked(false); setCctvDirection(null); }}
                      >
                        <Text style={styles.directionUnlockText}>Re-aim</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      style={[styles.lockBtn, !compassCalibrated && styles.lockBtnDisabled]}
                      disabled={!compassCalibrated}
                      onPress={() => { setCctvDirection(compassHeading); setCctvDirectionLocked(true); }}
                    >
                      <Ionicons name="lock-closed" size={16} color="#fff" />
                      <Text style={styles.lockBtnText}>
                        {compassCalibrated ? 'Lock Direction' : 'Calibrating…'}
                      </Text>
                    </Pressable>
                  )}
                  {cctvDirectionLocked && (
                    <Pressable
                      style={[styles.submitBtn, { backgroundColor: '#8B5CF6', marginTop: 16 }]}
                      onPress={() => setStep('cctv_details')}
                    >
                      <Text style={styles.submitText}>Continue</Text>
                      <Ionicons name="arrow-forward" size={14} color="#fff" />
                    </Pressable>
                  )}
                </>
              )}

              {/* CCTV Wizard — Final Step: Details + Submit */}
              {step === 'cctv_details' && (
                <>
                  {/* Summary of collected CCTV data */}
                  <View style={styles.cctvSummary}>
                    <Text style={styles.cctvSummaryTitle}>Camera Summary</Text>
                    <View style={styles.cctvSummaryRow}>
                      <Ionicons name="videocam-outline" size={14} color="#8B5CF6" />
                      <Text style={styles.cctvSummaryText}>
                        {CCTV_TYPES.find(t => t.id === cctvType)?.label ?? cctvType}
                      </Text>
                    </View>
                    <View style={styles.cctvSummaryRow}>
                      <Ionicons name={cctvCoverage === '360' ? 'sync-circle-outline' : 'navigate-outline'} size={14} color="#8B5CF6" />
                      <Text style={styles.cctvSummaryText}>
                        {cctvCoverage === '360' ? '360° Panoramic' : 'Directional'}
                      </Text>
                    </View>
                    <View style={styles.cctvSummaryRow}>
                      <Ionicons name="resize-outline" size={14} color="#8B5CF6" />
                      <Text style={styles.cctvSummaryText}>
                        Height: {CCTV_HEIGHTS.find(h => h.id === cctvHeight)?.label ?? cctvHeight}
                      </Text>
                    </View>
                    {cctvCoverage === 'pointing' && cctvDirection != null && (
                      <View style={styles.cctvSummaryRow}>
                        <Ionicons name="compass-outline" size={14} color="#8B5CF6" />
                        <Text style={styles.cctvSummaryText}>
                          Facing: {getCardinalFull(cctvDirection)} ({Math.round(cctvDirection)}°)
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Optional description */}
                  <View style={styles.detailsHeader}>
                    <Text style={styles.sectionLabel}>Additional Details (optional)</Text>
                    <Text style={[styles.wordCount, wordCount >= MAX_WORDS && styles.wordCountMax]}>
                      {wordCount}/{MAX_WORDS} words
                    </Text>
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Camera looks new, has IR LEDs for night vision"
                    placeholderTextColor="#9CA3AF"
                    value={description}
                    onChangeText={handleDescriptionChange}
                    multiline
                    textAlignVertical="top"
                    onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200)}
                  />

                  {/* No location warning */}
                  {!location && (
                    <View style={styles.warningBanner}>
                      <Ionicons name="location-outline" size={14} color="#F59E0B" />
                      <Text style={styles.warningText}>
                        Location unavailable — enable location services to report
                      </Text>
                    </View>
                  )}

                  {/* Web platform restriction */}
                  {Platform.OS === 'web' && (
                    <View style={styles.webRestrictionBanner}>
                      <Ionicons name="phone-portrait-outline" size={18} color="#3B82F6" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.webRestrictionTitle}>Mobile App Required</Text>
                        <Text style={styles.webRestrictionText}>
                          Report submission is only available on the mobile app. Download the Android app to submit reports.
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Error */}
                  {error && (
                    <View style={styles.errorBanner}>
                      <Ionicons name="alert-circle" size={14} color="#EF4444" />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}

                  {/* Submit */}
                  {Platform.OS === 'web' ? (
                    <Pressable
                      onPress={() => window.open('https://github.com/Jrtowers-prog/PlymHack2026New/releases/download/latest/SafeNightHome.apk', '_blank', 'noopener,noreferrer')}
                      style={[styles.submitBtn, { backgroundColor: '#3B82F6' }]}
                    >
                      <Ionicons name="download-outline" size={14} color="#fff" />
                      <Text style={styles.submitText}>Download Android App</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={handleSubmit}
                      disabled={!location || submitting}
                      style={[
                        styles.submitBtn,
                        { backgroundColor: '#8B5CF6' },
                        (!location || submitting) && styles.submitBtnDisabled,
                      ]}
                    >
                      {submitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="send" size={14} color="#fff" />
                          <Text style={styles.submitText}>Submit CCTV Report</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </>
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centeredWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popup: {
    width: '95%',
    maxWidth: Platform.OS === 'web' ? 520 : undefined,
    maxHeight: POPUP_MAX_H,
    backgroundColor: '#fff',
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  backBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 20,
  },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
    marginTop: 10,
  },
  typeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeInfo: {
    flex: 1,
  },
  typeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  typeDesc: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    lineHeight: 16,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginTop: 14,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryCard: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
    position: 'relative',
  },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
    flex: 1,
  },
  checkBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  wordCount: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  wordCountMax: {
    color: '#EF4444',
    fontWeight: '600',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  timeField: {
    flex: 1,
  },
  timeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 4,
  },
  timeInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 10,
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
    fontSize: 13,
    color: '#111827',
    minHeight: 70,
    maxHeight: 120,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFBEB',
    padding: 10,
    borderRadius: 10,
    marginTop: 10,
  },
  warningText: {
    fontSize: 12,
    color: '#92400E',
    flex: 1,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    padding: 10,
    borderRadius: 10,
    marginTop: 10,
  },
  errorText: {
    fontSize: 12,
    color: '#991B1B',
    flex: 1,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 16,
  },
  submitBtnDisabled: {
    backgroundColor: '#D1D5DB',
  },
  submitText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  // ── CCTV Wizard styles ──────────────────────────────────
  wizardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
    marginTop: 8,
  },
  wizardCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wizardCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  wizardCardDesc: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  wizardCardLarge: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
    marginTop: 10,
  },
  wizardCardIconLarge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  wizardCardLargeTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  // ── Compass ────────────────────────────────────────────
  compassContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  compassPointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 16,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#8B5CF6',
    marginBottom: -2,
    zIndex: 10,
  },
  compassRing: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 3,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
    position: 'relative',
  },
  compassCardinal: {
    position: 'absolute',
    fontSize: 14,
    fontWeight: '700',
    color: '#6B7280',
  },
  compassN: { top: 8, alignSelf: 'center' },
  compassE: { right: 10, top: '50%', marginTop: -8 },
  compassS: { bottom: 8, alignSelf: 'center' },
  compassW: { left: 10, top: '50%', marginTop: -8 },
  compassTick: {
    position: 'absolute',
    borderRadius: 1,
  },
  compassDegrees: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    marginTop: 4,
  },
  compassCardinalCenter: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8B5CF6',
    marginTop: 2,
  },
  compassFacingLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 12,
    fontWeight: '500',
  },
  compassFacingDirection: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    marginTop: 2,
  },
  compassFacingDegrees: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8B5CF6',
    marginTop: 2,
  },
  lockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#8B5CF6',
    marginTop: 12,
  },
  lockBtnDisabled: {
    backgroundColor: '#C4B5FD',
    opacity: 0.7,
  },
  lockBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  calibrationNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  calibrationIcon: {
    fontSize: 22,
  },
  calibrationText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
    lineHeight: 18,
  },
  calibrationReady: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 12,
  },
  calibrationReadyText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#166534',
  },
  directionLockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  directionLockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  directionLockedText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#166534',
  },
  directionUnlockBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  directionUnlockText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  // ── CCTV Summary ───────────────────────────────────────
  cctvSummary: {
    backgroundColor: '#F5F3FF',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    gap: 6,
  },
  cctvSummaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5B21B6',
    marginBottom: 4,
  },
  cctvSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cctvSummaryText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
  // ── Web restriction banner ────────────────────────────
  webRestrictionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 14,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  webRestrictionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 4,
  },
  webRestrictionText: {
    fontSize: 12,
    color: '#1E40AF',
    lineHeight: 17,
  },
});
