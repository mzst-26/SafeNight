/**
 * HomeScreen — Main app screen.
 *
 * All business logic lives in useHomeScreen. Each UI section is a
 * standalone component, keeping this file under 200 lines.
 *
 * Android-specific: every overlay is absolutely positioned above the
 * flex-child RouteMap. This is the ONLY reliable z-ordering approach
 * on Android when a WebView (SurfaceView) is involved — no nesting
 * inside the map container.
 */
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
    Animated,
    AppState,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PageHead } from "@/src/components/seo/PageHead";

import { AndroidOverlayHost } from "@/src/components/android/AndroidOverlayHost";
import RouteMap from "@/src/components/maps/RouteMap";
import { AIExplanationModal } from "@/src/components/modals/AIExplanationModal";
import { BackgroundLocationModal } from "@/src/components/modals/BackgroundLocationModal";
import { DownloadAppModal } from "@/src/components/modals/DownloadAppModal";
import { FamilyPackModal } from "@/src/components/modals/FamilyPackModal";
import { LimitReachedModal } from "@/src/components/modals/LimitReachedModal";
import LoginModal from "@/src/components/modals/LoginModal";
import { OnboardingModal } from "@/src/components/modals/OnboardingModal";
import { ReportModal } from "@/src/components/modals/ReportModal";
import { SubscriptionModal } from "@/src/components/modals/SubscriptionModal";
import { NavigationOverlay } from "@/src/components/navigation/NavigationOverlay";
import { RouteList } from "@/src/components/routes/RouteList";
import {
    RoadTypeBreakdown,
    SafetyPanel,
} from "@/src/components/safety/SafetyPanel";
import { SafetyProfileChart } from "@/src/components/safety/SafetyProfileChart";
import { MobileWebSearchBar } from "@/src/components/search/MobileWebSearchBar";
import { SearchBar } from "@/src/components/search/SearchBar";
import {
    DraggableSheet,
    SHEET_DEFAULT,
    SHEET_MIN,
} from "@/src/components/sheets/DraggableSheet";
import { MobileWebSheet } from "@/src/components/sheets/MobileWebSheet";
import { WebSidebar } from "@/src/components/sheets/WebSidebar";
import { AndroidDownloadBanner } from "@/src/components/ui/AndroidDownloadBanner";
import { BuddyButton } from "@/src/components/ui/BuddyButton";
import { JailLoadingAnimation } from "@/src/components/ui/JailLoadingAnimation";
import { MapToast, type ToastConfig } from "@/src/components/ui/MapToast";
import { ProfileMenu } from "@/src/components/ui/ProfileMenu";
import { WebLoginButton } from "@/src/components/ui/WebLoginButton";
import { useAuth } from "@/src/hooks/useAuth";
import { useContacts } from "@/src/hooks/useContacts";
import { useFriendLocations } from "@/src/hooks/useFriendLocations";
import { useHomeScreen } from "@/src/hooks/useHomeScreen";
import { fetchPlacePredictions } from "@/src/services/osmDirections";
import type { PlacePrediction, LatLng } from "@/src/types/google";
import { useLiveTracking } from "@/src/hooks/useLiveTracking";
import { useSavedPlaces, type SavedPlace } from "@/src/hooks/useSavedPlaces";
import { useWebBreakpoint } from "@/src/hooks/useWebBreakpoint";
import { stripeApi } from "@/src/services/stripeApi";
import { subscriptionApi } from "@/src/services/userApi";
import {
    LimitError,
    onLimitReached,
    type LimitInfo,
} from "@/src/types/limitError";
import { formatDistance, formatDuration } from "@/src/utils/format";

const PLACE_CATEGORY_CHIPS: Array<{
  key: string;
  label: string;
  query: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { key: "fuel", label: "Fuel", query: "fuel station", icon: "car-sport-outline" },
  { key: "shop", label: "Shops", query: "shops", icon: "bag-handle-outline" },
  { key: "food", label: "Food", query: "restaurants", icon: "restaurant-outline" },
  { key: "parking", label: "Parking", query: "parking", icon: "car-outline" },
  { key: "pharmacy", label: "Pharmacy", query: "pharmacy", icon: "medkit-outline" },
  { key: "hospital", label: "Hospital", query: "hospital", icon: "medical-outline" },
  { key: "bank", label: "Bank", query: "bank", icon: "cash-outline" },
  { key: "hotel", label: "Hotel", query: "hotel", icon: "bed-outline" },
];

const MILES_TO_METERS = 1609.34;
const SEARCH_AROUND_MAX_MILES = 30;
const SHEET_RESULTS_RENDER_LIMIT = 20;
const SEARCH_DISTANCE_FILTER_OPTIONS_MILES = [1, 3, 5, 10] as const;

function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const deltaLatitude = toRadians(b.latitude - a.latitude);
  const deltaLongitude = toRadians(b.longitude - a.longitude);
  const latitudeA = toRadians(a.latitude);
  const latitudeB = toRadians(b.latitude);
  const x =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);
  const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return earthRadiusMeters * y;
}

function classifyPlaceCategory(input: {
  category?: string;
  placeType?: string;
  primaryText?: string;
  fullText?: string;
}): string | null {
  const bucket = `${input.category || ""} ${input.placeType || ""} ${input.primaryText || ""} ${input.fullText || ""}`.toLowerCase();
  if (/\bfuel\b|petrol|gas station|charging_station|charging station/.test(bucket)) return "fuel";
  if (/\bparking\b|car park|park and ride/.test(bucket)) return "parking";
  if (/restaurant|cafe|coffee|pub|bar|fast_food|takeaway|food/.test(bucket)) return "food";
  if (/pharmacy|chemist|drugstore/.test(bucket)) return "pharmacy";
  if (/hospital|clinic|doctor|medical/.test(bucket)) return "hospital";
  if (/bank|atm/.test(bucket)) return "bank";
  if (/hotel|guest house|accommodation|lodging/.test(bucket)) return "hotel";
  if (/shop|supermarket|convenience|store|retail|mall/.test(bucket)) return "shop";
  return null;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const h = useHomeScreen();
  const auth = useAuth();
  const { places: savedPlaces, savePlace, removePlace } = useSavedPlaces();
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [showFriendsOnMap, setShowFriendsOnMap] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [limitModal, setLimitModal] = useState<LimitInfo | null>(null);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [showFamilyPackModal, setShowFamilyPackModal] = useState(false);
  const [toast, setToast] = useState<ToastConfig | null>(null);
  const [isNavFollowing, setIsNavFollowing] = useState(true);
  const [isAtCurrentLocation, setIsAtCurrentLocation] = useState(false);
  const [isFindingCurrentLocation, setIsFindingCurrentLocation] =
    useState(false);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [outOfRangeCueSignal, setOutOfRangeCueSignal] = useState(0);
  const [showSelectedPlaceDetails, setShowSelectedPlaceDetails] = useState(true);
  const subscriptionTier = auth.user?.subscription ?? "free";
  const maxDistanceKm = auth.user?.routeDistanceKm ?? 3; // DB-driven, fallback to free tier

  // Responsive breakpoint — phone-size web gets a different layout
  const breakpoint = useWebBreakpoint();
  const isPhoneWeb = breakpoint === "phone";
  const isWeb = Platform.OS === "web";
  const isDesktopWeb = isWeb && !isPhoneWeb;
  const webSidebarOverlayOffset = isDesktopWeb ? 404 : 0;

  // Sheet scroll ref and search-around state
  const sheetScrollRef = useRef<any>(null);
  const [mapCenterForSearch, setMapCenterForSearch] = useState<LatLng | null>(null);
  const [showSearchAroundButton, setShowSearchAroundButton] = useState(false);
  const [accumulatedDestinationCandidates, setAccumulatedDestinationCandidates] = useState<PlacePrediction[]>([]);
  const [searchAnchor, setSearchAnchor] = useState<LatLng | null>(null);
  const [searchAroundLimitReached, setSearchAroundLimitReached] = useState(false);
  const [isSearchAroundLoading, setIsSearchAroundLoading] = useState(false);
  const [searchDistanceFilterMiles, setSearchDistanceFilterMiles] = useState<number>(3);
  const [activePlaceCategoryKey, setActivePlaceCategoryKey] = useState<string | null>(null);
  const [selectedSheetCandidateId, setSelectedSheetCandidateId] = useState<string | null>(null);
  const previousSearchQueryRef = useRef("");

  const maxDistanceFilterMiles = useMemo(() => {
    const tier = (subscriptionTier || "free").toLowerCase();
    return tier === "free" ? 3 : 10;
  }, [subscriptionTier]);

  const distanceFilterOptionsMiles = useMemo(
    () => SEARCH_DISTANCE_FILTER_OPTIONS_MILES.filter((miles) => miles <= maxDistanceFilterMiles),
    [maxDistanceFilterMiles],
  );

  useEffect(() => {
    setSearchDistanceFilterMiles((current) => Math.min(current, maxDistanceFilterMiles));
  }, [maxDistanceFilterMiles]);

  useEffect(() => {
    setSelectedSheetCandidateId(h.selectedDestinationCandidateId);
  }, [h.selectedDestinationCandidateId]);

  useEffect(() => {
    const query = (h.destSearch?.query || "").trim();
    const normalizedQuery = query.toLowerCase();

    if (normalizedQuery !== previousSearchQueryRef.current) {
      previousSearchQueryRef.current = normalizedQuery;
      setAccumulatedDestinationCandidates([]);
      setSearchAroundLimitReached(false);
      setShowSearchAroundButton(false);
      setSearchAnchor(h.location ?? h.effectiveOrigin ?? mapCenterForSearch ?? null);
      setSelectedSheetCandidateId(h.selectedDestinationCandidateId);
    }

    if (query.length < 2) {
      setShowSearchAroundButton(false);
      setSearchAroundLimitReached(false);
      setSearchAnchor(null);
      setAccumulatedDestinationCandidates([]);
      setSelectedSheetCandidateId(h.selectedDestinationCandidateId);
      return;
    }

    if (!searchAnchor) {
      const initialAnchor = h.location ?? h.effectiveOrigin ?? mapCenterForSearch;
      if (initialAnchor) {
        setSearchAnchor(initialAnchor);
      }
    }
  }, [
    h.destSearch?.query,
    h.location,
    h.location?.latitude,
    h.location?.longitude,
    h.effectiveOrigin,
    h.effectiveOrigin?.latitude,
    h.effectiveOrigin?.longitude,
    h.selectedDestinationCandidateId,
    mapCenterForSearch,
    mapCenterForSearch?.latitude,
    mapCenterForSearch?.longitude,
    searchAnchor,
  ]);

  const handleMapCenterChanged = useCallback((loc: LatLng) => {
    setMapCenterForSearch(loc);
    const q = (h.destSearch?.query || "").trim();
    if (q.length < 2) {
      setShowSearchAroundButton(false);
      return;
    }

    const anchor = searchAnchor ?? h.location ?? h.effectiveOrigin ?? loc;
    if (!searchAnchor) {
      setSearchAnchor(anchor);
    }

    const maxMeters = SEARCH_AROUND_MAX_MILES * MILES_TO_METERS;
    const movedDistance = haversineDistanceMeters(anchor, loc);
    if (movedDistance > maxMeters) {
      setSearchAroundLimitReached(true);
      setShowSearchAroundButton(false);
      return;
    }

    setSearchAroundLimitReached(false);
    setShowSearchAroundButton(true);
  }, [h.destSearch, h.location, h.effectiveOrigin, searchAnchor]);

  const performSearchAround = useCallback(async () => {
    if (!mapCenterForSearch || isSearchAroundLoading) return;
    const q = (h.destSearch?.query || "").trim();
    if (q.length < 2) return;

    const anchor = searchAnchor ?? h.location ?? h.effectiveOrigin ?? mapCenterForSearch;
    if (!searchAnchor) {
      setSearchAnchor(anchor);
    }

    const maxMeters = SEARCH_AROUND_MAX_MILES * MILES_TO_METERS;
    const movedDistance = haversineDistanceMeters(anchor, mapCenterForSearch);
    if (movedDistance > maxMeters) {
      setSearchAroundLimitReached(true);
      setShowSearchAroundButton(false);
      return;
    }

    const tier = (subscriptionTier || "free").toLowerCase();
    const radiusMiles = tier === "free" ? 3 : 5;
    const radiusMeters = Math.round(radiusMiles * MILES_TO_METERS);
    setIsSearchAroundLoading(true);
    try {
      const results = await fetchPlacePredictions(q, {
        locationBias: mapCenterForSearch,
        radiusMeters,
        subscriptionTier: tier,
      });
      setAccumulatedDestinationCandidates((prev) => {
        const map = new Map(prev.map((p) => [p.placeId, p]));
        for (const r of results) map.set(r.placeId, r);
        return Array.from(map.values());
      });
      setSearchAroundLimitReached(false);
    } catch {
      // ignore network errors for now
    } finally {
      setIsSearchAroundLoading(false);
      setShowSearchAroundButton(false);
    }
  }, [mapCenterForSearch, isSearchAroundLoading, h.destSearch, h.location, h.effectiveOrigin, searchAnchor, subscriptionTier]);

  // Web guest detection (also exposed from useHomeScreen)
  const isWebGuest = Platform.OS === "web" && !auth.isLoggedIn;

  // Extra top offset on web to clear the AndroidDownloadBanner (32px + 4px gap)
  const webBannerOffset = Platform.OS === "web" ? 36 : 0;

  // Open the login modal (dismissable) for web guests
  const promptLogin = useCallback(() => {
    setShowLoginPrompt(true);
  }, []);

  // Handle selecting a saved place as destination
  const handleSelectSavedPlace = useCallback(
    (place: SavedPlace) => {
      h.destSearch.setQuery(place.name);
      h.destSearch.selectPrediction({
        placeId: place.id,
        primaryText: place.name,
        secondaryText: place.address ?? "",
        fullText: place.name,
        location: { latitude: place.lat, longitude: place.lng },
      });
      h.setManualDest(null);
      h.handlePanTo({ latitude: place.lat, longitude: place.lng });
      h.clearSelectedRoute();
    },
    [h],
  );

  // Toast callback for saved places
  const handleSavedPlaceToast = useCallback((msg: string, icon?: string) => {
    setToast({
      message: msg,
      icon: (icon as any) ?? "bookmark",
      iconColor: "#1570ef",
      duration: 2000,
    });
  }, []);

  // Auto-dismiss login prompt when user logs in
  useEffect(() => {
    if (auth.isLoggedIn) {
      setShowLoginPrompt(false);
    }
  }, [auth.isLoggedIn]);

  // Listen for subscription limit events from any service
  useEffect(() => {
    const unsub = onLimitReached((info) => {
      setLimitModal(info);
    });
    return unsub;
  }, []);

  // Handle Stripe checkout redirect (?subscription=success or ?subscription=cancelled)
  // Security: URL params are cosmetic — we verify with the server before showing success.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const params = new URLSearchParams(window.location.search);
    const subResult = params.get("subscription");

    // Always clean up URL params immediately to prevent reuse / bookmarking
    if (subResult) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (subResult === "success") {
      // Verify the subscription is actually active on the server
      (async () => {
        try {
          const status = await stripeApi.getStatus();
          if (status.stripeSubscription?.status === "active") {
            auth.refreshProfile?.();
            setToast({
              message: `Subscription activated! Welcome to ${status.tier === "family" ? "Family Pack" : "Guarded"}.`,
              icon: "shield-checkmark",
              iconColor: "#7C3AED",
              duration: 5000,
            });
          } else {
            // Webhook may still be processing — show a softer message
            setToast({
              message:
                "Payment received — your subscription is being activated…",
              icon: "hourglass-outline",
              iconColor: "#F59E0B",
              duration: 5000,
            });
            // Retry after a short delay for webhook propagation
            setTimeout(async () => {
              try {
                const retry = await stripeApi.getStatus();
                if (retry.stripeSubscription?.status === "active") {
                  auth.refreshProfile?.();
                  setToast({
                    message: "Subscription activated! Welcome to Guarded.",
                    icon: "shield-checkmark",
                    iconColor: "#7C3AED",
                    duration: 4000,
                  });
                }
              } catch {
                /* silent retry */
              }
            }, 4000);
          }
        } catch {
          // Not logged in or network error — ignore
        }
      })();
    } else if (subResult === "cancelled") {
      setToast({
        message: "Subscription checkout was cancelled.",
        icon: "close-circle-outline",
        iconColor: "#6B7280",
        duration: 4000,
      });
    }
  }, []);

  // Only load contacts when logged in
  const {
    contacts,
    liveContacts,
    refresh: refreshContacts,
  } = useContacts(auth.isLoggedIn);

  // Friend locations — poll when the toggle is on and user has contacts
  const { friends: friendMarkers, checkNow: checkFriendLocations } =
    useFriendLocations(showFriendsOnMap && auth.isLoggedIn);

  // Callback when contacts change in BuddyModal — refresh parent state
  const handleContactsChanged = useCallback(() => {
    refreshContacts();
  }, [refreshContacts]);

  // Toggle friend locations with immediate check + toast
  const handleFriendToggle = useCallback(async () => {
    if (contacts.length === 0) {
      setToast({
        message: "Add contacts in Safety Circle first to see friend locations",
        icon: "people-outline",
        iconColor: "#F59E0B",
        duration: 3500,
      });
      return;
    }
    const next = !showFriendsOnMap;
    setShowFriendsOnMap(next);

    if (next) {
      setToast({
        message: "Checking friend locations…",
        icon: "search",
        iconColor: "#7C3AED",
        duration: 2000,
      });
      const { found, names } = await checkFriendLocations();
      if (found === 0) {
        setToast({
          message: "No friends are sharing their location right now",
          icon: "location-outline",
          iconColor: "#F59E0B",
          duration: 3500,
        });
      } else {
        const nameList =
          names.slice(0, 3).join(", ") +
          (names.length > 3 ? ` +${names.length - 3} more` : "");
        setToast({
          message: `Found ${found} friend${found > 1 ? "s" : ""} — showing ${nameList}`,
          icon: "people",
          iconColor: "#10B981",
          duration: 4000,
        });
      }
    } else {
      setToast({
        message: "Friend locations hidden",
        icon: "eye-off-outline",
        iconColor: "#6B7280",
        duration: 2000,
      });
    }
  }, [showFriendsOnMap, checkFriendLocations, contacts.length]);

  // Report category labels for toast
  const reportLabels: Record<string, string> = {
    poor_lighting: "Poor Lighting",
    unsafe_area: "Unsafe Area",
    obstruction: "Obstruction",
    harassment: "Harassment",
    other: "Other",
  };

  

  const handleReportSubmitted = useCallback((category: string) => {
    setShowReportModal(false);
    setToast({
      message: `${reportLabels[category] || "Report"} reported — thank you for keeping others safe!`,
      icon: "shield-checkmark",
      iconColor: "#10B981",
      duration: 4000,
    });
  }, []);

  const handleLocationHelp = useCallback(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.alert(
        "Location is blocked or unavailable.\n\nPlease:\n1) Click the site icon in your browser address bar\n2) Allow Location access\n3) Refresh the page and tap Retry Location",
      );
      return;
    }
    setToast({
      message:
        "Enable location permissions in your browser/app settings, then retry.",
      icon: "information-circle-outline",
      iconColor: "#1570ef",
      duration: 4500,
    });
  }, []);

  // Live tracking — auto-register push token on mount, share location during nav
  const live = useLiveTracking(auth.isLoggedIn);
  const liveStarted = useRef(false);
  // Keep stable references to avoid re-firing effects when live state changes
  const liveRef = useRef(live);
  liveRef.current = live;

  // Auto-start live tracking when navigation begins (if logged in with contacts)
  useEffect(() => {
    if (
      h.nav.state === "navigating" &&
      auth.isLoggedIn &&
      contacts.length > 0 &&
      !liveStarted.current
    ) {
      const dest = h.effectiveDestination;
      const destName =
        h.destSearch?.place?.name ?? h.manualDest?.name ?? undefined;
      // Set flag immediately to prevent duplicate calls while the async call is in flight
      liveStarted.current = true;
      // Build route_path from the selected route so contacts can see the planned route
      const routePath = h.selectedRoute?.path?.map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
      }));
      console.log(
        "[live] routePath debug — selectedRoute exists:",
        !!h.selectedRoute,
        "path length:",
        h.selectedRoute?.path?.length,
        "routePath length:",
        routePath?.length,
      );
      liveRef.current
        .startTracking({
          destination_lat: dest?.latitude,
          destination_lng: dest?.longitude,
          ...(destName ? { destination_name: destName } : {}),
          ...(routePath && routePath.length >= 2
            ? { route_path: routePath }
            : {}),
        })
        .then((result) => {
          if (result.ok) {
            setToast({
              message: destName
                ? `Your Safety Circle can see you heading to ${destName}`
                : "Your Safety Circle can now see where you are",
              icon: "shield-checkmark",
              iconColor: "#10B981",
              duration: 5000,
            });
          } else {
            // Start failed — reset flag so it can retry on next render
            liveStarted.current = false;
            if (result.reason === "limit-reached") {
              // LimitReachedModal handles this globally
            } else if (result.reason === "permission-denied") {
              // Background location is required — exit navigation
              h.nav.stop();
              setToast({
                message:
                  "Background location is required for safe navigation. Please allow it to continue.",
                icon: "location-outline",
                iconColor: "#ef4444",
                duration: 5000,
              });
            } else {
              setToast({
                message: result.message || "Could not start live sharing",
                icon: "alert-circle-outline",
                iconColor: "#ef4444",
                duration: 4000,
              });
            }
          }
        });
    }
  }, [
    h.nav.state,
    auth.isLoggedIn,
    contacts.length,
    h.effectiveDestination,
    h.destSearch?.place?.name,
  ]);

  // Auto-stop live tracking when navigation ends
  useEffect(() => {
    if (
      liveStarted.current &&
      (h.nav.state === "arrived" || h.nav.state === "idle")
    ) {
      liveStarted.current = false;
      liveRef.current.stopTracking(
        h.nav.state === "arrived" ? "completed" : "cancelled",
      );
    }
  }, [h.nav.state]);

  // --- PiP: auto-enter Picture-in-Picture when user leaves app during navigation (Android only) ---
  useEffect(() => {
    if (Platform.OS !== "android") return;

    let mod: typeof import("expo-pip").default | null = null;
    try {
      mod = require("expo-pip").default;
    } catch {
      return; // expo-pip not available in this build
    }
    if (!mod) return;
    const ExpoPip = mod;

    if (h.nav.state === "navigating") {
      ExpoPip.setPictureInPictureParams({
        width: 9,
        height: 16,
        autoEnterEnabled: true,
        title: "SafeNight Navigation",
        subtitle: h.destSearch?.place?.name ?? "Navigating...",
        seamlessResizeEnabled: true,
      });
    } else {
      ExpoPip.setPictureInPictureParams({
        autoEnterEnabled: false,
      });
    }
  }, [h.nav.state, h.destSearch?.place?.name]);

  // PiP fallback: manually enter PiP on older Android (< 12) when app goes to background during nav
  useEffect(() => {
    if (Platform.OS !== "android" || h.nav.state !== "navigating") return;

    let mod2: typeof import("expo-pip").default | null = null;
    try {
      mod2 = require("expo-pip").default;
    } catch {
      return;
    }
    if (!mod2) return;
    const pip = mod2;
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background") {
        pip.enterPipMode({ width: 9, height: 16 });
      }
    });

    return () => sub.remove();
  }, [h.nav.state]);

  const distanceLabel = h.selectedRoute
    ? `🚶 ${formatDistance(h.selectedRoute.distanceMeters)}`
    : "--";
  const durationLabel = h.selectedRoute
    ? formatDuration(h.selectedRoute.durationSeconds)
    : "--";
  const showSafety = Boolean(h.selectedRoute);
  const hasError = h.directionsStatus === "error";
  const hasLiveDestinationPredictions =
    h.destSearch.query.trim().length > 0 && h.destSearch.predictions.length > 0;

  const showDestinationCandidateSheet =
    !h.isNavActive &&
    !h.manualDest &&
    (h.destinationCandidates.length > 0 || hasLiveDestinationPredictions);
  const sheetVisible =
    (h.routes.length > 0 ||
      h.directionsStatus === "loading" ||
      hasError ||
      showDestinationCandidateSheet) &&
    !h.isNavActive;

  // Category label map for the highlight banner
  const categoryLabels: Record<string, string> = {
    crime: "Crimes",
    light: "Street Lights",
    cctv: "CCTV Cameras",
    shop: "Open Places",
    bus_stop: "Transit Stops",
    dead_end: "Dead Ends",
  };

  const handleCategoryPress = useCallback(
    (category: string) => {
      h.setHighlightCategory(category);
      // Collapse the sheet so the map markers are fully visible
      h.sheetHeightRef.current = SHEET_MIN;
      Animated.spring(h.sheetHeight, {
        toValue: SHEET_MIN,
        useNativeDriver: false,
        bounciness: 4,
      }).start();
    },
    [h.sheetHeight, h.sheetHeightRef, h.setHighlightCategory],
  );

  const handleClearHighlight = useCallback(() => {
    h.setHighlightCategory(null);
    // Re-expand the sheet
    h.sheetHeightRef.current = SHEET_DEFAULT;
    Animated.spring(h.sheetHeight, {
      toValue: SHEET_DEFAULT,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  }, [h.sheetHeight, h.sheetHeightRef, h.setHighlightCategory]);

  useEffect(() => {
    if (!h.isNavActive) setIsNavFollowing(true);
  }, [h.isNavActive]);

  const handleRecenterNavigation = useCallback(() => {
    setIsNavFollowing(true);
    setRecenterSignal((prev) => prev + 1);
  }, []);

  const handleStartNavigation = useCallback(async () => {
    if (Platform.OS === "web") {
      setShowDownloadModal(true);
      return;
    }

    try {
      await subscriptionApi.ensureFeatureAllowed("navigation_start");
      h.nav.start();
      await subscriptionApi.consume("navigation_start");
    } catch (err) {
      if (err instanceof LimitError) return;
      setToast({
        message:
          err instanceof Error ? err.message : "Unable to start navigation",
        icon: "alert-circle",
        iconColor: "#EF4444",
        duration: 2500,
      });
    }
  }, [h.nav, setToast]);

  const handleMoveToCurrentLocation = useCallback(() => {
    setIsFindingCurrentLocation(true);
    if (!h.location) return;
    h.handlePanTo(h.location);
  }, [h.location, h.handlePanTo]);

  const handleMapPress = useCallback(
    (coordinate: { latitude: number; longitude: number }) => {
      setIsAtCurrentLocation(false);
      setIsFindingCurrentLocation(false);
      h.handleMapPress(coordinate);
    },
    [h.handleMapPress],
  );

  const handleMapLongPress = useCallback(
    (coordinate: { latitude: number; longitude: number }) => {
      setIsAtCurrentLocation(false);
      setIsFindingCurrentLocation(false);
      h.handleMapLongPress(coordinate);
    },
    [h.handleMapLongPress],
  );

  const handleMapInteraction = useCallback(() => {
    setIsAtCurrentLocation(false);
    setIsFindingCurrentLocation(false);
  }, []);

  useEffect(() => {
    if (!isFindingCurrentLocation || !h.location) return;
    h.handlePanTo(h.location);
  }, [isFindingCurrentLocation, h.location, h.handlePanTo]);

  useEffect(() => {
    if (!h.location || !h.mapPanTo?.location) return;
    const nearThreshold = 0.00012;
    const atCurrentLocation =
      Math.abs(h.mapPanTo.location.latitude - h.location.latitude) <=
        nearThreshold &&
      Math.abs(h.mapPanTo.location.longitude - h.location.longitude) <=
        nearThreshold;

    setIsAtCurrentLocation(atCurrentLocation);
    if (atCurrentLocation) setIsFindingCurrentLocation(false);
  }, [
    h.location?.latitude,
    h.location?.longitude,
    h.mapPanTo?.key,
    h.mapPanTo?.location.latitude,
    h.mapPanTo?.location.longitude,
  ]);

  useEffect(() => {
    if (
      !h.outOfRange ||
      h.directionsStatus === "loading" ||
      !h.effectiveOrigin ||
      !h.effectiveDestination
    ) {
      return;
    }
    setOutOfRangeCueSignal((prev) => prev + 1);
  }, [
    h.outOfRange,
    h.outOfRangeMessage,
    h.directionsStatus,
    h.effectiveOrigin?.latitude,
    h.effectiveOrigin?.longitude,
    h.effectiveDestination?.latitude,
    h.effectiveDestination?.longitude,
  ]);

  const _baseSheetPlaces =
    h.destinationCandidates.length > 0
      ? h.destinationCandidates
      : hasLiveDestinationPredictions
        ? h.destSearch.predictions
        : [];

  const sheetPlaces =
    accumulatedDestinationCandidates.length > 0
      ? Array.from(
          new Map(
            [..._baseSheetPlaces, ...accumulatedDestinationCandidates].map(
              (p) => [p.placeId, p],
            ),
          ).values(),
        )
      : _baseSheetPlaces;

  const nearbyReference = h.location ?? h.effectiveOrigin ?? null;
  const maxDistanceMeters = searchDistanceFilterMiles * MILES_TO_METERS;
  const placeDistanceById = useMemo(() => {
    const distances = new Map<string, number>();
    if (!nearbyReference) return distances;

    for (const place of sheetPlaces) {
      if (!place.location) continue;
      distances.set(
        place.placeId,
        haversineDistanceMeters(nearbyReference, place.location),
      );
    }
    return distances;
  }, [sheetPlaces, nearbyReference]);

  const distanceFilteredSheetPlaces = useMemo(() => {
    if (!nearbyReference) return sheetPlaces;
    return sheetPlaces.filter((place) => {
      const distance = placeDistanceById.get(place.placeId);
      return typeof distance === "number" && distance <= maxDistanceMeters;
    });
  }, [sheetPlaces, nearbyReference, placeDistanceById, maxDistanceMeters]);

  const categoryFilteredSheetPlaces = useMemo(() => {
    if (!activePlaceCategoryKey) return distanceFilteredSheetPlaces;
    return distanceFilteredSheetPlaces.filter(
      (candidate) => classifyPlaceCategory(candidate) === activePlaceCategoryKey,
    );
  }, [distanceFilteredSheetPlaces, activePlaceCategoryKey]);

  const orderedSheetPlaces = useMemo(() => {
    if (!nearbyReference) return categoryFilteredSheetPlaces;
    return [...categoryFilteredSheetPlaces].sort((a, b) => {
      const aDistance = placeDistanceById.get(a.placeId) ?? Number.MAX_SAFE_INTEGER;
      const bDistance = placeDistanceById.get(b.placeId) ?? Number.MAX_SAFE_INTEGER;
      return aDistance - bDistance;
    });
  }, [categoryFilteredSheetPlaces, nearbyReference, placeDistanceById]);

  const filteredSheetPlaceIds = useMemo(
    () => new Set(categoryFilteredSheetPlaces.map((place) => place.placeId)),
    [categoryFilteredSheetPlaces],
  );

  const visibleSheetPlaces = useMemo(() => {
    const clipped = orderedSheetPlaces.slice(0, SHEET_RESULTS_RENDER_LIMIT);
    if (!selectedSheetCandidateId) return clipped;
    if (clipped.some((p) => p.placeId === selectedSheetCandidateId)) return clipped;
    const selected = orderedSheetPlaces.find(
      (p) => p.placeId === selectedSheetCandidateId,
    );
    return selected ? [...clipped, selected] : clipped;
  }, [orderedSheetPlaces, selectedSheetCandidateId]);

  const selectedPlace = useMemo(
    () =>
      sheetPlaces.find((p) => p.placeId === selectedSheetCandidateId) ??
      h.selectedDestinationCandidate,
    [sheetPlaces, selectedSheetCandidateId, h.selectedDestinationCandidate],
  );

  const selectedPlaceCategory = selectedPlace?.category
    ? selectedPlace.category
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : null;
  const selectedPlaceType = selectedPlace?.placeType
    ? selectedPlace.placeType
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : null;
  const selectedPlaceAddress = selectedPlace?.fullText ?? null;
  const selectedPlacePostcode = selectedPlace?.address?.postcode ?? null;
  const selectedPlaceCoords = selectedPlace?.location
    ? `${selectedPlace.location.latitude.toFixed(5)}, ${selectedPlace.location.longitude.toFixed(5)}`
    : null;

  const handleFindSafeRoutesForSelectedPlace = useCallback(() => {
    const candidate =
      sheetPlaces.find((p) => p.placeId === selectedSheetCandidateId) ?? null;
    if (!candidate) {
      h.activateSelectedDestinationCandidate();
      return;
    }

    const isBaseCandidate = h.destinationCandidates.some(
      (p) => p.placeId === candidate.placeId,
    );

    if (isBaseCandidate) {
      h.selectDestinationCandidate(candidate.placeId, true);
      h.activateSelectedDestinationCandidate();
      return;
    }

    h.destSearch.selectPrediction(candidate);
    h.setManualDest(null);
    if (candidate.location) {
      h.handlePanTo(candidate.location);
    }
    h.clearSelectedRoute();
  }, [
    h,
    selectedSheetCandidateId,
    sheetPlaces,
  ]);

  // Scroll sheet to center selected candidate when selection changes
  useEffect(() => {
    const id = selectedSheetCandidateId;
    if (!id || !sheetScrollRef?.current) return;
    const idx = visibleSheetPlaces.findIndex((p) => p.placeId === id);
    if (idx === -1) return;
    const approxItemHeight = 72; // approximate item height
    const centerOffset = Math.max(0, idx * approxItemHeight - 120);
    try {
      sheetScrollRef.current.scrollTo({ y: centerOffset, animated: true });
    } catch {
      // ignore
    }

    if (Platform.OS !== "web") {
      h.sheetHeightRef.current = SHEET_DEFAULT;
      Animated.spring(h.sheetHeight, {
        toValue: SHEET_DEFAULT,
        useNativeDriver: false,
        bounciness: 6,
      }).start();
    }
  }, [selectedSheetCandidateId, visibleSheetPlaces, h.sheetHeight, h.sheetHeightRef]);

  const sheetCategoryBubbles = useMemo(() => {
    if (!distanceFilteredSheetPlaces.length) return [];

    const counts = new Map<string, number>();
    for (const candidate of distanceFilteredSheetPlaces) {
      const category = classifyPlaceCategory(candidate);
      if (!category) continue;
      counts.set(category, (counts.get(category) || 0) + 1);
    }

    return PLACE_CATEGORY_CHIPS
      .map((chip) => ({ ...chip, count: counts.get(chip.key) || 0 }))
      .filter((chip) => chip.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [distanceFilteredSheetPlaces]);

  const handleSheetCategoryBubblePress = useCallback(
    (categoryKey: string) => {
      setActivePlaceCategoryKey((prev) =>
        prev === categoryKey ? null : categoryKey,
      );
      setSelectedSheetCandidateId(null);
      setShowSelectedPlaceDetails(false);
    },
    [],
  );

  const handleDistanceFilterPress = useCallback(
    (distance: number) => {
      setSearchDistanceFilterMiles(distance);
      setSelectedSheetCandidateId(null);
      setShowSelectedPlaceDetails(false);
    },
    [],
  );

  useEffect(() => {
    if (
      selectedSheetCandidateId &&
      visibleSheetPlaces.some((p) => p.placeId === selectedSheetCandidateId)
    ) {
      return;
    }

    if (visibleSheetPlaces.length === 0) {
      setSelectedSheetCandidateId(null);
      setShowSelectedPlaceDetails(false);
      return;
    }

    setSelectedSheetCandidateId(visibleSheetPlaces[0].placeId);
    setShowSelectedPlaceDetails(true);
  }, [visibleSheetPlaces, selectedSheetCandidateId]);

  useEffect(() => {
    if (!selectedPlace) return;
    setShowSelectedPlaceDetails(true);

    if (Platform.OS !== "web" && !h.isNavActive) {
      h.sheetHeightRef.current = SHEET_DEFAULT;
      Animated.spring(h.sheetHeight, {
        toValue: SHEET_DEFAULT,
        useNativeDriver: false,
        bounciness: 4,
      }).start();
    }
  }, [selectedPlace?.placeId, h.isNavActive, h.sheetHeight, h.sheetHeightRef]);

  const combinedDestinationCandidateMarkers = useMemo(() => {
    const markers = new Map<string, any>();

    for (const marker of h.destinationCandidateMarkers as any[]) {
      markers.set(marker.id, marker);
    }

    for (const candidate of accumulatedDestinationCandidates) {
      if (!candidate.location) continue;
      markers.set(`search-candidate:${candidate.placeId}`, {
        id: `search-candidate:${candidate.placeId}`,
        kind: "shop",
        coordinate: {
          latitude: candidate.location.latitude,
          longitude: candidate.location.longitude,
        },
        label: candidate.fullText || candidate.primaryText,
      });
    }

    return Array.from(markers.values());
  }, [h.destinationCandidateMarkers, accumulatedDestinationCandidates]);

  const filteredDestinationCandidateMarkers = useMemo(() => {
    return combinedDestinationCandidateMarkers.filter((marker: any) => {
      const markerId = String(marker?.id ?? "");
      if (!markerId.startsWith("search-candidate:")) return true;
      const placeId = markerId.slice("search-candidate:".length);
      return filteredSheetPlaceIds.has(placeId);
    });
  }, [combinedDestinationCandidateMarkers, filteredSheetPlaceIds]);

  const renderDestinationCandidatesSection = (keyPrefix: string) => {
    if (!showDestinationCandidateSheet) return null;

    return (
      <View style={styles.placeResultsPanel}>
        {/* Sticky Header — Index 0 for stickyHeaderIndices */}
        <View style={styles.stickyHeaderContainer}>
          {/* Category Chips */}
          {sheetCategoryBubbles.length > 0 && (
            <View style={styles.placeCategoryFiltersBlock}>
              <Text style={styles.placeFiltersHelperText}>
                Quick filters: tap a category to instantly narrow Places results.
              </Text>
              <View style={styles.placeCategoriesWrap}>
              {sheetCategoryBubbles.slice(0, 5).map((chip, idx, arr) => {
                const iconOnly = arr.length > 3;
                return (
                <Pressable
                  key={`${keyPrefix}-cat-${chip.key}`}
                  style={[
                    styles.placeCategoryBubble,
                    styles.placeCategoryBubbleEqual,
                    iconOnly ? styles.placeCategoryBubbleIconOnly : null,
                    activePlaceCategoryKey === chip.key
                      ? styles.placeCategoryBubbleActive
                      : null,
                  ]}
                  onPress={() => handleSheetCategoryBubblePress(chip.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter places by ${chip.label}`}
                  accessibilityHint="Filters the visible Places list immediately"
                >
                  <Ionicons name={chip.icon} size={14} color="#1570ef" />
                  {!iconOnly ? (
                    <Text style={styles.placeCategoryBubbleText}>{chip.label}</Text>
                  ) : null}
                  <Text style={styles.placeCategoryBubbleCount}>{chip.count}</Text>
                </Pressable>
                );
              })}
              </View>
            </View>
          )}
          
          {/* Distance Filter Controls */}
          <View style={styles.distanceFilterRow}>
            <Text style={styles.distanceFilterLabel}>Distance:</Text>
            <View style={styles.distanceFilterOptions}>
              {distanceFilterOptionsMiles.map((distance) => (
                <Pressable
                  key={`${keyPrefix}-distance-${distance}`}
                  style={[
                    styles.distanceFilterButton,
                    searchDistanceFilterMiles === distance && styles.distanceFilterButtonActive,
                  ]}
                  onPress={() => handleDistanceFilterPress(distance)}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter places to ${distance} miles`}
                  accessibilityHint="Applies distance filter to Places results"
                >
                  <Text
                    style={[
                      styles.distanceFilterButtonText,
                      searchDistanceFilterMiles === distance && styles.distanceFilterButtonTextActive,
                    ]}
                  >
                    {distance}mi
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.placeResultsHeader}>
          <Text style={styles.placeResultsTitle}>Places</Text>
        </View>
        {visibleSheetPlaces.map((candidate) => {
          const selected = candidate.placeId === selectedSheetCandidateId;
          return (
            <Pressable
              key={`${keyPrefix}-${candidate.placeId}`}
              style={[
                styles.placeResultItem,
                selected && styles.placeResultItemSelected,
              ]}
              onPress={() => {
                setSelectedSheetCandidateId(candidate.placeId);
                if (h.destinationCandidates.some((p) => p.placeId === candidate.placeId)) {
                  h.selectDestinationCandidate(candidate.placeId, true);
                } else {
                  if (candidate.location) {
                    h.handlePanTo(candidate.location);
                  }
                }
                if (selected) {
                  setShowSelectedPlaceDetails((prev) => !prev);
                } else {
                  setShowSelectedPlaceDetails(true);
                }
              }}
            >
              <View style={styles.placeResultTitleRow}>
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={16}
                  color={selected ? "#1570ef" : "#667085"}
                />
                <Text style={styles.placeResultTitle} numberOfLines={1}>
                  {candidate.primaryText}
                </Text>
                {selected && (
                  <Ionicons
                    name={showSelectedPlaceDetails ? "chevron-up" : "chevron-down"}
                    size={16}
                    color="#475467"
                  />
                )}
              </View>
              {candidate.secondaryText ? (
                <Text style={styles.placeResultSecondary} numberOfLines={1}>
                  {candidate.secondaryText}
                </Text>
              ) : null}

              {selected && showSelectedPlaceDetails && selectedPlace && (
                <View style={styles.placeResultDetailsWrap}>
                  {selectedPlace.fullText ? (
                    <Text style={styles.placeResultDetailsText}>
                      {selectedPlace.fullText}
                    </Text>
                  ) : null}
                  {!!(
                    selectedPlaceCategory ||
                    selectedPlaceType ||
                    selectedPlacePostcode
                  ) && (
                    <Text style={styles.placeResultDetailsMeta}>
                      {[
                        selectedPlaceCategory,
                        selectedPlaceType,
                        selectedPlacePostcode,
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </Text>
                  )}
                  {selectedPlaceCoords ? (
                    <Text style={styles.placeResultDetailsCoords}>
                      {selectedPlaceCoords}
                    </Text>
                  ) : null}
                  <View style={{ marginTop: 8 }}>
                    <Pressable
                      style={styles.placeResultsActionBtn}
                      onPress={handleFindSafeRoutesForSelectedPlace}
                    >
                      <Text style={styles.placeResultsActionText}>Find Safe Routes</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    );
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <PageHead path="/" />
      {/* ── Map (fills the screen as a flex child) ── */}
      <RouteMap
        origin={h.effectiveOrigin}
        destination={h.effectiveDestination}
        routes={isWebGuest ? [] : h.routes}
        selectedRouteId={isWebGuest ? null : h.selectedRouteId}
        safetyMarkers={
          isWebGuest
            ? []
            : [
                ...filteredDestinationCandidateMarkers,
                ...(h.poiMarkers as any),
                ...(h.viaPinLocation
                  ? [
                      {
                        kind: "via",
                        label: "Via point",
                        coordinate: h.viaPinLocation,
                      },
                    ]
                  : []),
              ]
        }
        routeSegments={isWebGuest ? [] : h.routeSegments}
        roadLabels={isWebGuest ? [] : h.roadLabels}
        panTo={h.mapPanTo}
        fitCandidateBoundsToken={h.destinationCandidatesFitToken}
        showZoomControls={isWeb && !isPhoneWeb}
        isNavigating={h.isNavActive}
        navigationLocation={h.nav.userLocation}
        navigationHeading={h.nav.userHeading}
        mapType={h.mapType}
        highlightCategory={h.highlightCategory}
        maxDistanceKm={maxDistanceKm}
        friendMarkers={friendMarkers}
        recenterSignal={recenterSignal}
        outOfRangeCueSignal={outOfRangeCueSignal}
        vizStreamUrl={h.vizStreamUrl}
        vizProgressPct={h.vizProgressPct}
        vizProgressMessage={h.vizProgressMessage}
        onSelectRoute={h.setSelectedRouteId}
        onSelectMarker={(markerId) => {
          h.handleMapMarkerSelect(markerId);
          if (!markerId.startsWith("search-candidate:")) return;

          const placeId = markerId.slice("search-candidate:".length);
          if (!placeId) return;

          setSelectedSheetCandidateId(placeId);
          setShowSelectedPlaceDetails(true);

          const markerPlace = sheetPlaces.find((p) => p.placeId === placeId);
          if (markerPlace?.location) {
            h.handlePanTo(markerPlace.location);
          }
        }}
        onLongPress={isWebGuest ? undefined : handleMapLongPress}
        onMapPress={isWebGuest ? undefined : handleMapPress}
        onNavigationFollowChange={setIsNavFollowing}
        onUserInteraction={isWebGuest ? undefined : handleMapInteraction}
        onMapCenterChanged={handleMapCenterChanged}
      />

      {/*
       * ── Overlay layer ──
       * On Android, AndroidOverlayHost creates a separate compositing layer
       * with high elevation so all UI renders above the native map view.
       * On iOS/web it's a no-op passthrough.
       */}
      <AndroidOverlayHost>
        {/* ══════════════════════════════════════════════════════════════
         * WEB LAYOUT — Google Maps-style left sidebar (tablet/desktop only)
         * ══════════════════════════════════════════════════════════════ */}
        {isWeb && !isPhoneWeb && !h.isNavActive && (
          <WebSidebar
            hasResults={h.routes.length > 0 || h.destinationCandidates.length > 0}
            isLoading={h.directionsStatus === "loading"}
            hasError={hasError}
            onClearResults={h.clearRouteResults}
            downloadBanner={<AndroidDownloadBanner embedded />}
            loginButton={
              isWebGuest ? <WebLoginButton onPress={promptLogin} /> : null
            }
            searchBar={
              <SearchBar
                topInset={0}
                location={h.location}
                isUsingCurrentLocation={h.isUsingCurrentLocation}
                setIsUsingCurrentLocation={h.setIsUsingCurrentLocation}
                originSearch={h.originSearch}
                manualOrigin={h.manualOrigin}
                setManualOrigin={h.setManualOrigin}
                destSearch={h.destSearch}
                manualDest={h.manualDest}
                setManualDest={h.setManualDest}
                pinMode={h.pinMode}
                setPinMode={h.setPinMode}
                onPanTo={h.handlePanTo}
                onClearRoute={h.clearSelectedRoute}
                onSwap={h.swapOriginAndDest}
                onGuestTap={isWebGuest ? promptLogin : undefined}
                destinationCandidates={h.destinationCandidates}
                selectedDestinationCandidateId={
                  h.selectedDestinationCandidateId
                }
                onSelectDestinationCandidate={h.selectDestinationCandidate}
                onFindSafeRoutes={h.activateSelectedDestinationCandidate}
                embedded
                savedPlaces={savedPlaces}
                onSelectSavedPlace={handleSelectSavedPlace}
                onSavePlace={savePlace}
                onRemoveSavedPlace={removePlace}
                onSavedPlaceToast={handleSavedPlaceToast}
              />
            }
          >
            {/* Sheet content rendered inside sidebar */}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {hasError && h.routes.length === 0 ? "Oops!!" : "Routes"}
              </Text>
              {!hasError && (
                <Text style={styles.sheetMeta}>
                  {distanceLabel} · {durationLabel}
                </Text>
              )}
            </View>

            {h.directionsStatus === "loading" && (
              <JailLoadingAnimation
                progressPct={h.vizProgressPct}
                statusMessage={h.vizProgressMessage}
              />
            )}

            {h.outOfRange && (
              <View style={styles.warningBanner}>
                <Ionicons name="ban-outline" size={20} color="#dc2626" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningTitle}>
                    Destination out of range
                  </Text>
                  <Text style={styles.warningText}>
                    {h.outOfRangeMessage ||
                      "Destination is too far away (max 6.2 mi walking distance)."}
                  </Text>
                  {h.directionsError?.details?.detail ? (
                    <Text style={styles.warningDetail}>
                      {String(h.directionsError.details.detail)}
                    </Text>
                  ) : null}
                  <Text style={styles.warningHint}>
                    💡 Try selecting a closer destination, or split your journey
                    into shorter legs.
                  </Text>
                </View>
              </View>
            )}

            {h.directionsError && !h.outOfRange && (
              <View
                style={[
                  styles.warningBanner,
                  h.directionsError.code === "INTERNAL_ERROR" && {
                    backgroundColor: "#fffbeb",
                  },
                ]}
              >
                <Ionicons
                  name={
                    h.directionsError.code === "NO_ROUTE_FOUND"
                      ? "git-branch-outline"
                      : h.directionsError.code === "NO_NEARBY_ROAD"
                        ? "location-outline"
                        : h.directionsError.code === "NO_WALKING_NETWORK"
                          ? "walk-outline"
                          : h.directionsError.code === "safe_routes_timeout"
                            ? "time-outline"
                            : h.directionsError.code === "INTERNAL_ERROR"
                              ? "cloud-offline-outline"
                              : "alert-circle"
                  }
                  size={20}
                  color={
                    h.directionsError.code === "safe_routes_timeout" ||
                    h.directionsError.code === "INTERNAL_ERROR"
                      ? "#d97706"
                      : "#dc2626"
                  }
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningTitle}>
                    {h.directionsError.code === "NO_ROUTE_FOUND"
                      ? "No route found"
                      : h.directionsError.code === "NO_NEARBY_ROAD"
                        ? "No road nearby"
                        : h.directionsError.code === "NO_WALKING_NETWORK"
                          ? "No walkable roads"
                          : h.directionsError.code === "safe_routes_timeout"
                            ? "Request timed out"
                            : h.directionsError.code === "INTERNAL_ERROR"
                              ? "Something went wrong"
                              : "Route error"}
                  </Text>
                  <Text style={styles.warningText}>
                    {h.directionsError.message}
                  </Text>
                  {h.directionsError.details?.detail ? (
                    <Text style={styles.warningDetail}>
                      {String(h.directionsError.details.detail)}
                    </Text>
                  ) : null}
                  <Text style={styles.warningHint}>
                    {h.directionsError.code === "NO_ROUTE_FOUND"
                      ? "💡 The two points are probably on separate road networks — try a destination on the same side of any rivers, motorways, or railways."
                      : h.directionsError.code === "NO_NEARBY_ROAD"
                        ? "💡 Move the pin closer to a visible street or footpath on the map."
                        : h.directionsError.code === "NO_WALKING_NETWORK"
                          ? "💡 This area only has motorways or private roads. Pick a more residential destination."
                          : h.directionsError.code === "safe_routes_timeout"
                            ? "💡 Shorter routes compute faster. Try somewhere within 3 mi."
                            : h.directionsError.code === "INTERNAL_ERROR"
                              ? "💡 This is usually temporary — wait a moment and try again."
                              : "💡 Try again, or pick a different destination."}
                  </Text>
                </View>
              </View>
            )}

            {/* Route cards + safety panel — stacked in sidebar */}
            <View style={styles.routeSafetyRow}>
              <RouteList
                routes={h.safeRoutes}
                selectedRouteId={h.selectedRouteId}
                onSelectRoute={h.setSelectedRouteId}
                inSidebar
              />

              {showSafety && h.safetyResult && h.selectedSafeRoute && (
                <SafetyPanel
                  safetyResult={h.safetyResult}
                  selectedSafeRoute={h.selectedSafeRoute}
                  onCategoryPress={handleCategoryPress}
                  inSidebar
                />
              )}
            </View>

            {h.selectedRouteId && h.nav.state === "idle" && (
              <Pressable
                style={styles.startNavButton}
                onPress={() => setShowDownloadModal(true)}
                accessibilityRole="button"
                accessibilityLabel="Start navigation"
              >
                <Ionicons name="navigate" size={20} color="#ffffff" />
                <Text style={styles.startNavButtonText}>Start Navigation</Text>
              </Pressable>
            )}

            {h.routes.length > 0 && h.nav.state === "idle" && (
              <View style={styles.viaRow}>
                <Pressable
                  style={styles.viaButton}
                  onPress={() => h.setPinMode("via")}
                  accessibilityRole="button"
                  accessibilityLabel="Re-route via a point"
                >
                  <Ionicons
                    name="git-branch-outline"
                    size={15}
                    color="#d946ef"
                  />
                  <Text style={styles.viaButtonText}>Re-route via…</Text>
                </Pressable>
                {h.viaPinLocation && (
                  <Pressable
                    style={styles.viaClearButton}
                    onPress={() => h.clearViaPin()}
                    accessibilityRole="button"
                    accessibilityLabel="Clear via point"
                  >
                    <Ionicons name="close-circle" size={15} color="#667085" />
                    <Text style={styles.viaClearText}>Clear via</Text>
                  </Pressable>
                )}
              </View>
            )}

            {showSafety &&
              h.selectedSafeRoute &&
              Object.keys(h.selectedSafeRoute.safety.roadTypes).length > 0 && (
                <RoadTypeBreakdown
                  roadTypes={h.selectedSafeRoute.safety.roadTypes}
                />
              )}

            {showSafety &&
              h.selectedSafeRoute?.enrichedSegments &&
              h.selectedSafeRoute.enrichedSegments.length > 1 && (
                <SafetyProfileChart
                  segments={h.routeSegments}
                  enrichedSegments={h.selectedSafeRoute.enrichedSegments}
                  roadNameChanges={
                    h.selectedSafeRoute.routeStats?.roadNameChanges ?? []
                  }
                  totalDistance={h.selectedSafeRoute.distanceMeters}
                />
              )}
          </WebSidebar>
        )}

        {/* ══════════════════════════════════════════════════════════════
         * PHONE WEB LAYOUT — Google Maps-style top pill + bottom sheet
         * Only for web viewports < 768px. Android/iOS unaffected.
         * ══════════════════════════════════════════════════════════════ */}
        {isPhoneWeb && !h.isNavActive && (
          <>
            {/* Download banner */}
            <AndroidDownloadBanner />

            {/* MobileWebSearchBar — collapsible pill */}
            <MobileWebSearchBar
              location={h.location}
              isUsingCurrentLocation={h.isUsingCurrentLocation}
              setIsUsingCurrentLocation={h.setIsUsingCurrentLocation}
              originSearch={h.originSearch}
              manualOrigin={h.manualOrigin}
              setManualOrigin={h.setManualOrigin}
              destSearch={h.destSearch}
              manualDest={h.manualDest}
              setManualDest={h.setManualDest}
              pinMode={h.pinMode}
              setPinMode={h.setPinMode}
              onPanTo={h.handlePanTo}
              onClearRoute={h.clearSelectedRoute}
              onSwap={h.swapOriginAndDest}
              onGuestTap={isWebGuest ? promptLogin : undefined}
              destinationCandidates={h.destinationCandidates}
              selectedDestinationCandidateId={h.selectedDestinationCandidateId}
              onSelectDestinationCandidate={h.selectDestinationCandidate}
              onFindSafeRoutes={h.activateSelectedDestinationCandidate}
              renderCandidatesInSheet
              hasResults={
                h.routes.length > 0 ||
                h.destinationCandidates.length > 0 ||
                hasLiveDestinationPredictions
              }
              savedPlaces={savedPlaces}
              onSelectSavedPlace={handleSelectSavedPlace}
              onSavePlace={savePlace}
              onRemoveSavedPlace={removePlace}
              onSavedPlaceToast={handleSavedPlaceToast}
            />

            {/* Login button for guest */}
            {isWebGuest && (
              <View
                style={{
                  position: "absolute",
                  top: 100,
                  left: 12,
                  right: 12,
                  zIndex: 45,
                  alignItems: "center",
                }}
              >
                <WebLoginButton onPress={promptLogin} />
              </View>
            )}

            {/* Phone web bottom sheet */}
            <MobileWebSheet visible={sheetVisible}>
              {renderDestinationCandidatesSection("sheet-candidate-web")}

              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>
                  {hasError && h.routes.length === 0 ? "Oops!!" : "Routes"}
                </Text>
                {!hasError && (
                  <Text style={styles.sheetMeta}>
                    {distanceLabel} · {durationLabel}
                  </Text>
                )}
                {h.routes.length > 0 && (
                  <Pressable
                    onPress={h.clearRouteResults}
                    hitSlop={8}
                    style={{ marginLeft: 8 }}
                  >
                    <Ionicons name="close" size={18} color="#667085" />
                  </Pressable>
                )}
              </View>

              {h.directionsStatus === "loading" && (
                <JailLoadingAnimation
                  progressPct={h.vizProgressPct}
                  statusMessage={h.vizProgressMessage}
                />
              )}

              {h.outOfRange && (
                <View style={styles.warningBanner}>
                  <Ionicons name="ban-outline" size={20} color="#dc2626" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.warningTitle}>
                      Destination out of range
                    </Text>
                    <Text style={styles.warningText}>
                      {h.outOfRangeMessage ||
                        "Destination is too far away (max 6.2 mi walking distance)."}
                    </Text>
                    {h.directionsError?.details?.detail ? (
                      <Text style={styles.warningDetail}>
                        {String(h.directionsError.details.detail)}
                      </Text>
                    ) : null}
                    <Text style={styles.warningHint}>
                      💡 Try selecting a closer destination, or split your
                      journey into shorter legs.
                    </Text>
                  </View>
                </View>
              )}

              {h.directionsError && !h.outOfRange && (
                <View
                  style={[
                    styles.warningBanner,
                    h.directionsError.code === "INTERNAL_ERROR" && {
                      backgroundColor: "#fffbeb",
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      h.directionsError.code === "NO_ROUTE_FOUND"
                        ? "git-branch-outline"
                        : h.directionsError.code === "NO_NEARBY_ROAD"
                          ? "location-outline"
                          : h.directionsError.code === "NO_WALKING_NETWORK"
                            ? "walk-outline"
                            : h.directionsError.code === "safe_routes_timeout"
                              ? "time-outline"
                              : h.directionsError.code === "INTERNAL_ERROR"
                                ? "cloud-offline-outline"
                                : "alert-circle"
                    }
                    size={20}
                    color={
                      h.directionsError.code === "safe_routes_timeout" ||
                      h.directionsError.code === "INTERNAL_ERROR"
                        ? "#d97706"
                        : "#dc2626"
                    }
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.warningTitle}>
                      {h.directionsError.code === "NO_ROUTE_FOUND"
                        ? "No route found"
                        : h.directionsError.code === "NO_NEARBY_ROAD"
                          ? "No road nearby"
                          : h.directionsError.code === "NO_WALKING_NETWORK"
                            ? "No walkable roads"
                            : h.directionsError.code === "safe_routes_timeout"
                              ? "Request timed out"
                              : h.directionsError.code === "INTERNAL_ERROR"
                                ? "Something went wrong"
                                : "Route error"}
                    </Text>
                    <Text style={styles.warningText}>
                      {h.directionsError.message}
                    </Text>
                    {h.directionsError.details?.detail ? (
                      <Text style={styles.warningDetail}>
                        {String(h.directionsError.details.detail)}
                      </Text>
                    ) : null}
                    <Text style={styles.warningHint}>
                      {h.directionsError.code === "NO_ROUTE_FOUND"
                        ? "💡 The two points are probably on separate road networks — try a destination on the same side of any rivers, motorways, or railways."
                        : h.directionsError.code === "NO_NEARBY_ROAD"
                          ? "💡 Move the pin closer to a visible street or footpath on the map."
                          : h.directionsError.code === "NO_WALKING_NETWORK"
                            ? "💡 This area only has motorways or private roads. Pick a more residential destination."
                            : h.directionsError.code === "safe_routes_timeout"
                              ? "💡 Shorter routes compute faster. Try somewhere within 3 mi."
                              : h.directionsError.code === "INTERNAL_ERROR"
                                ? "💡 This is usually temporary — wait a moment and try again."
                                : "💡 Try again, or pick a different destination."}
                    </Text>
                  </View>
                </View>
              )}

              <RouteList
                routes={h.safeRoutes}
                selectedRouteId={h.selectedRouteId}
                onSelectRoute={h.setSelectedRouteId}
                inSidebar
              />

              {showSafety && h.safetyResult && h.selectedSafeRoute && (
                <SafetyPanel
                  safetyResult={h.safetyResult}
                  selectedSafeRoute={h.selectedSafeRoute}
                  onCategoryPress={handleCategoryPress}
                  inSidebar
                />
              )}

              {h.selectedRouteId && h.nav.state === "idle" && (
                <Pressable
                  style={styles.startNavButton}
                  onPress={() => setShowDownloadModal(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Start navigation"
                >
                  <Ionicons name="navigate" size={20} color="#ffffff" />
                  <Text style={styles.startNavButtonText}>
                    Start Navigation
                  </Text>
                </Pressable>
              )}

              {h.routes.length > 0 && h.nav.state === "idle" && (
                <View style={styles.viaRow}>
                  <Pressable
                    style={styles.viaButton}
                    onPress={() => h.setPinMode("via")}
                    accessibilityRole="button"
                    accessibilityLabel="Re-route via a point"
                  >
                    <Ionicons
                      name="git-branch-outline"
                      size={15}
                      color="#d946ef"
                    />
                    <Text style={styles.viaButtonText}>Re-route via…</Text>
                  </Pressable>
                  {h.viaPinLocation && (
                    <Pressable
                      style={styles.viaClearButton}
                      onPress={() => h.clearViaPin()}
                      accessibilityRole="button"
                      accessibilityLabel="Clear via point"
                    >
                      <Ionicons name="close-circle" size={15} color="#667085" />
                      <Text style={styles.viaClearText}>Clear via</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {showSafety &&
                h.selectedSafeRoute &&
                Object.keys(h.selectedSafeRoute.safety.roadTypes).length >
                  0 && (
                  <RoadTypeBreakdown
                    roadTypes={h.selectedSafeRoute.safety.roadTypes}
                  />
                )}

              {showSafety &&
                h.selectedSafeRoute?.enrichedSegments &&
                h.selectedSafeRoute.enrichedSegments.length > 1 && (
                  <SafetyProfileChart
                    segments={h.routeSegments}
                    enrichedSegments={h.selectedSafeRoute.enrichedSegments}
                    roadNameChanges={
                      h.selectedSafeRoute.routeStats?.roadNameChanges ?? []
                    }
                    totalDistance={h.selectedSafeRoute.distanceMeters}
                  />
                )}
            </MobileWebSheet>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════
         * MOBILE LAYOUT — Original centered search + bottom sheet
         * ══════════════════════════════════════════════════════════════ */}

        {/* Mobile: Android download banner (also shows on web if sidebar not active) */}
        {!isWeb && <AndroidDownloadBanner />}

        {/* ── Pin-mode banner ── */}
        {h.pinMode && (
          <View style={[styles.pinBanner, { bottom: insets.bottom + 12 }]}>
            <View style={styles.pinBannerInner}>
              <Ionicons name="location" size={18} color="#ffffff" />
              <Text style={styles.pinBannerText}>
                {h.pinMode === "via"
                  ? "Tap the map to set a via point — routes will re-run through it"
                  : `Tap anywhere on the map to set your ${h.pinMode === "origin" ? "starting point" : "destination"}`}
              </Text>
            </View>
            <Pressable
              onPress={() => h.setPinMode(null)}
              style={styles.pinBannerCancel}
            >
              <Text style={styles.pinBannerCancelText}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {/* ── Search bar (mobile only — web uses sidebar) ── */}
        {!isWeb && !h.isNavActive && (
          <MobileWebSearchBar
            topInset={insets.top + webBannerOffset}
            location={h.location}
            isUsingCurrentLocation={h.isUsingCurrentLocation}
            setIsUsingCurrentLocation={h.setIsUsingCurrentLocation}
            originSearch={h.originSearch}
            manualOrigin={h.manualOrigin}
            setManualOrigin={h.setManualOrigin}
            destSearch={h.destSearch}
            manualDest={h.manualDest}
            setManualDest={h.setManualDest}
            pinMode={h.pinMode}
            setPinMode={h.setPinMode}
            onPanTo={h.handlePanTo}
            onClearRoute={h.clearSelectedRoute}
            onSwap={h.swapOriginAndDest}
            onGuestTap={isWebGuest ? promptLogin : undefined}
            destinationCandidates={h.destinationCandidates}
            selectedDestinationCandidateId={h.selectedDestinationCandidateId}
            onSelectDestinationCandidate={h.selectDestinationCandidate}
            onFindSafeRoutes={h.activateSelectedDestinationCandidate}
            renderCandidatesInSheet
            hasResults={
              h.routes.length > 0 ||
              h.destinationCandidates.length > 0 ||
              hasLiveDestinationPredictions
            }
            savedPlaces={savedPlaces}
            onSelectSavedPlace={handleSelectSavedPlace}
            onSavePlace={savePlace}
            onRemoveSavedPlace={removePlace}
            onSavedPlaceToast={handleSavedPlaceToast}
          />
        )}

        {!isDesktopWeb && !h.isNavActive && (showSearchAroundButton || searchAroundLimitReached) && (
          <View
            pointerEvents="box-none"
            style={[
              styles.searchAroundFloatingWrap,
              {
                top: isWeb
                  ? insets.top + webBannerOffset + (isPhoneWeb ? 142 : 96)
                  : insets.top + webBannerOffset + 102,
              },
            ]}
          >
            {showSearchAroundButton ? (
              <Pressable
                style={styles.searchAroundFloatingBtn}
                onPress={performSearchAround}
                disabled={isSearchAroundLoading}
                accessibilityRole="button"
                accessibilityLabel="Search around here"
              >
                {isSearchAroundLoading ? (
                  <View style={styles.searchAroundFloatingLoadingRow}>
                    <ActivityIndicator size="small" color="#ffffff" />
                    <Text style={styles.searchAroundFloatingBtnText}>Searching…</Text>
                  </View>
                ) : (
                  <Text style={styles.searchAroundFloatingBtnText}>Search around here</Text>
                )}
              </Pressable>
            ) : (
              <View style={styles.searchAroundFloatingLimit}>
                <Text style={styles.searchAroundFloatingLimitText}>
                  Search around unavailable beyond 30 miles.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── Profile / Logout button (logged in) ── */}
        {!h.isNavActive && auth.isLoggedIn && (
          <View
            style={{
              position: "absolute",
              top: isWeb
                ? insets.top + webBannerOffset + (isPhoneWeb ? 180 : 190)
                : "40%",
              marginTop: isWeb ? 0 : -50,
              right: 12,
              zIndex: 110,
            }}
          >
            <ProfileMenu
              name={auth.user?.name ?? auth.user?.username ?? null}
              email={auth.user?.email ?? null}
              subscriptionTier={subscriptionTier}
              isGift={auth.user?.isGift}
              subscriptionEndsAt={auth.user?.subscriptionEndsAt}
              onLogout={auth.logout}
              onManageSubscription={() => setShowSubscriptionModal(true)}
              onChangePassword={auth.changePassword}
            />
          </View>
        )}

        {/* ── Web guest: Login button (under search bar) — mobile only, web uses sidebar ── */}
        {!isWeb && !h.isNavActive && isWebGuest && (
          <View
            style={{
              position: "absolute",
              top: insets.top + webBannerOffset + 80,
              left: 0,
              right: 0,
              zIndex: 110,
              alignItems: "center",
              paddingHorizontal: 10,
            }}
          >
            <WebLoginButton onPress={promptLogin} />
          </View>
        )}

        {/* ── Safety Circle button (right under profile button) ── */}
        {!h.isNavActive && auth.isLoggedIn && (
          <View
            style={{
              position: "absolute",
              top: isWeb
                ? insets.top + webBannerOffset + (isPhoneWeb ? 230 : 290)
                : "40%",
              marginTop: isWeb ? 0 : 0,
              right: 12,
              zIndex: 100,
            }}
          >
            <BuddyButton
              username={auth.user?.username ?? null}
              userId={auth.user?.id ?? null}
              hasLiveContacts={liveContacts.length > 0}
              onContactsChanged={handleContactsChanged}
            />
          </View>
        )}

        {/* ── Show Friends on Map toggle (below Safety Circle) ── */}
        {!h.isNavActive && auth.isLoggedIn && (
          <View
            style={{
              position: "absolute",
              top: isWeb
                ? insets.top + webBannerOffset + (isPhoneWeb ? 285 : 345)
                : "40%",
              marginTop: isWeb ? 0 : 50,
              right: 12,
              zIndex: 100,
            }}
          >
            <Pressable
              onPress={handleFriendToggle}
              style={[
                styles.friendToggle,
                showFriendsOnMap && styles.friendToggleActive,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                showFriendsOnMap ? "Hide friends on map" : "Show friends on map"
              }
            >
              <Ionicons
                name={showFriendsOnMap ? "people" : "people-outline"}
                size={20}
                color={showFriendsOnMap ? "#fff" : "#7C3AED"}
              />
            </Pressable>
          </View>
        )}

        {/* ── Report hazard button (always available when logged in) ── */}
        {!h.isNavActive && (
          <View
            style={{
              position: "absolute",
              top: isWeb
                ? insets.top + webBannerOffset + (isPhoneWeb ? 392 : 452)
                : "40%",
              marginTop: isWeb ? 0 : 152,
              right: 12,
              zIndex: 100,
            }}
          >
            <Pressable
              onPress={handleMoveToCurrentLocation}
              style={[
                styles.currentLocationBtn,
                isAtCurrentLocation
                  ? styles.currentLocationBtnActive
                  : styles.currentLocationBtnInactive,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                isAtCurrentLocation
                  ? "You are at current location"
                  : isFindingCurrentLocation
                    ? "Finding current location"
                    : "Move to current location"
              }
            >
              {isAtCurrentLocation ? (
                <View style={styles.currentLocationDotOuter}>
                  <View style={styles.currentLocationDotInner} />
                </View>
              ) : (
                <Ionicons name="locate-outline" size={20} color="#E5E7EB" />
              )}
            </Pressable>
          </View>
        )}

        {/* ── Report hazard button (always available when logged in) ── */}
        {auth.isLoggedIn && (
          <View
            style={{
              position: "absolute",
              ...(h.isNavActive
                ? { bottom: insets.bottom + 100, right: 16 }
                : {
                    top: isWeb
                      ? insets.top + webBannerOffset + (isPhoneWeb ? 340 : 400)
                      : "40%",
                    marginTop: isWeb ? 0 : 100,
                    right: 12,
                  }),
              zIndex: 100,
            }}
          >
            <Pressable
              onPress={() => setShowReportModal(true)}
              style={styles.reportBtn}
              accessibilityRole="button"
              accessibilityLabel="Report a hazard"
            >
              <Ionicons name="flag-outline" size={20} color="#EF4444" />
            </Pressable>
          </View>
        )}

        {/* ── Category highlight banner — shows when user tapped a stat card ── */}
        {h.highlightCategory && (
          <View
            style={[
              styles.highlightBanner,
              {
                top: insets.top + 120,
                left: webSidebarOverlayOffset,
              },
            ]}
          >
            <Pressable
              style={styles.highlightBannerInner}
              onPress={handleClearHighlight}
              accessibilityRole="button"
              accessibilityLabel="Show all markers"
            >
              <Text style={styles.highlightBannerText}>
                Showing{" "}
                {(
                  categoryLabels[h.highlightCategory] || h.highlightCategory
                ).toLowerCase()}{" "}
                only · tap to view all
              </Text>
              <Ionicons
                name="close-circle"
                size={16}
                color="rgba(255,255,255,0.8)"
              />
            </Pressable>
          </View>
        )}

        {h.needsLocationRecovery && !h.isNavActive && (
          <View
            style={[
              styles.locationRecoveryWrap,
              { top: insets.top + 86, left: webSidebarOverlayOffset },
            ]}
          >
            <View style={styles.locationRecoveryCard}>
              <Ionicons name="locate-outline" size={16} color="#1570ef" />
              <Text style={styles.locationRecoveryText}>
                {h.locationRecoveryReason === "denied"
                  ? "Location permission is blocked. Enable it to stop defaulting to London."
                  : h.locationRecoveryReason === "error"
                    ? "We couldn't read your current location."
                    : "Still trying to get your location..."}
              </Text>
              <Pressable
                style={styles.locationRecoveryBtn}
                onPress={() => {
                  h.refreshLocation();
                }}
                accessibilityRole="button"
                accessibilityLabel="Retry location"
              >
                <Text style={styles.locationRecoveryBtnText}>Retry</Text>
              </Pressable>
              <Pressable
                style={styles.locationRecoveryLink}
                onPress={handleLocationHelp}
                accessibilityRole="button"
                accessibilityLabel="Location help"
              >
                <Text style={styles.locationRecoveryLinkText}>Help</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Selected place profile from map/search candidates ── */}
        {!h.isNavActive &&
          isDesktopWeb &&
          !h.manualDest &&
          !h.destSearch.place &&
          h.destinationCandidates.length > 0 &&
          selectedPlace && (
            <View
              style={[
                styles.placeProfileWrap,
                { bottom: insets.bottom + (isWeb ? 20 : SHEET_MIN + 18) },
              ]}
            >
              <View style={styles.placeProfileCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeProfileTitle} numberOfLines={1}>
                    {selectedPlace.primaryText}
                  </Text>
                  {selectedPlaceAddress ? (
                    <Text style={styles.placeProfileSubtitle} numberOfLines={2}>
                      {selectedPlaceAddress}
                    </Text>
                  ) : null}
                  {(selectedPlaceCategory || selectedPlaceType || selectedPlacePostcode) && (
                    <Text style={styles.placeProfileMeta} numberOfLines={1}>
                      {[selectedPlaceCategory, selectedPlaceType, selectedPlacePostcode]
                        .filter(Boolean)
                        .join(" • ")}
                    </Text>
                  )}
                  {selectedPlaceCoords ? (
                    <Text style={styles.placeProfileCoords} numberOfLines={1}>
                      {selectedPlaceCoords}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  style={styles.placeProfileAction}
                  onPress={() => {
                    h.activateSelectedDestinationCandidate();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Find safe routes to selected place"
                >
                  <Text style={styles.placeProfileActionText}>
                    Find Safe Routes
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

        {/* ── AI floating button (logged in only) ── */}
        {h.safetyResult &&
          !h.isNavActive &&
          h.routes.length > 0 &&
          auth.isLoggedIn &&
          !isWeb && (
            <Animated.View
              pointerEvents="box-none"
              style={[
                styles.aiWrap,
                {
                  bottom: Animated.add(h.sheetHeight, 12),
                },
              ]}
            >
              <Pressable
                style={styles.aiButton}
                onPress={() => {
                  h.setShowAIModal(true);
                  if (h.ai.status === "idle") h.ai.ask();
                }}
                accessibilityRole="button"
                accessibilityLabel="Why is this the safest route"
              >
                <Ionicons name="sparkles" size={16} color="#ffffff" />
                <Text style={styles.aiText}>Why is this the safest route?</Text>
              </Pressable>
            </Animated.View>
          )}

        {/* ── Bottom sheet (mobile only — web uses sidebar) ── */}
        {!isWeb && (
          <DraggableSheet
            visible={sheetVisible}
            bottomInset={insets.bottom}
            sheetHeight={h.sheetHeight}
            sheetHeightRef={h.sheetHeightRef}
            scrollRef={sheetScrollRef}
            stickyHeaderIndices={Platform.OS === 'android' ? undefined : [0]}
          >
            {renderDestinationCandidatesSection("sheet-candidate-native")}

            {/* Header — hide distance/duration when there's only an error */}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {hasError && h.routes.length === 0 ? "Oops!!" : "Routes"}
              </Text>
              {!hasError && (
                <Text style={styles.sheetMeta}>
                  {distanceLabel} · {durationLabel}
                </Text>
              )}
            </View>

            {/* Loading state */}
            {h.directionsStatus === "loading" && (
              <JailLoadingAnimation
                progressPct={h.vizProgressPct}
                statusMessage={h.vizProgressMessage}
              />
            )}

            {/* Out-of-range warning */}
            {h.outOfRange && (
              <View style={styles.warningBanner}>
                <Ionicons name="ban-outline" size={20} color="#dc2626" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningTitle}>
                    Destination out of range
                  </Text>
                  <Text style={styles.warningText}>
                    {h.outOfRangeMessage ||
                      "Destination is too far away (max 6.2 mi walking distance)."}
                  </Text>
                  {h.directionsError?.details?.detail ? (
                    <Text style={styles.warningDetail}>
                      {String(h.directionsError.details.detail)}
                    </Text>
                  ) : null}
                  <Text style={styles.warningHint}>
                    💡 Try selecting a closer destination, or split your journey
                    into shorter legs.
                  </Text>
                </View>
              </View>
            )}

            {h.directionsError && !h.outOfRange && (
              <View
                style={[
                  styles.warningBanner,
                  h.directionsError.code === "INTERNAL_ERROR" && {
                    backgroundColor: "#fffbeb",
                  },
                ]}
              >
                <Ionicons
                  name={
                    h.directionsError.code === "NO_ROUTE_FOUND"
                      ? "git-branch-outline"
                      : h.directionsError.code === "NO_NEARBY_ROAD"
                        ? "location-outline"
                        : h.directionsError.code === "NO_WALKING_NETWORK"
                          ? "walk-outline"
                          : h.directionsError.code === "safe_routes_timeout"
                            ? "time-outline"
                            : h.directionsError.code === "INTERNAL_ERROR"
                              ? "cloud-offline-outline"
                              : "alert-circle"
                  }
                  size={20}
                  color={
                    h.directionsError.code === "safe_routes_timeout" ||
                    h.directionsError.code === "INTERNAL_ERROR"
                      ? "#d97706"
                      : "#dc2626"
                  }
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningTitle}>
                    {h.directionsError.code === "NO_ROUTE_FOUND"
                      ? "No route found"
                      : h.directionsError.code === "NO_NEARBY_ROAD"
                        ? "No road nearby"
                        : h.directionsError.code === "NO_WALKING_NETWORK"
                          ? "No walkable roads"
                          : h.directionsError.code === "safe_routes_timeout"
                            ? "Request timed out"
                            : h.directionsError.code === "INTERNAL_ERROR"
                              ? "Something went wrong"
                              : "Route error"}
                  </Text>
                  <Text style={styles.warningText}>
                    {h.directionsError.message}
                  </Text>
                  {h.directionsError.details?.detail ? (
                    <Text style={styles.warningDetail}>
                      {String(h.directionsError.details.detail)}
                    </Text>
                  ) : null}
                  <Text style={styles.warningHint}>
                    {h.directionsError.code === "NO_ROUTE_FOUND"
                      ? "💡 The two points are probably on separate road networks — try a destination on the same side of any rivers, motorways, or railways."
                      : h.directionsError.code === "NO_NEARBY_ROAD"
                        ? "💡 Move the pin closer to a visible street or footpath on the map."
                        : h.directionsError.code === "NO_WALKING_NETWORK"
                          ? "💡 This area only has motorways or private roads. Pick a more residential destination."
                          : h.directionsError.code === "safe_routes_timeout"
                            ? "💡 Shorter routes compute faster. Try somewhere within 3 mi."
                            : h.directionsError.code === "INTERNAL_ERROR"
                              ? "💡 This is usually temporary — wait a moment and try again."
                              : "💡 Try again, or pick a different destination."}
                  </Text>
                </View>
              </View>
            )}

            {/* Route cards — safety details hidden behind per-card toggle */}
            <RouteList
              routes={h.safeRoutes}
              selectedRouteId={h.selectedRouteId}
              onSelectRoute={h.setSelectedRouteId}
              detailsPanel={
                showSafety && h.safetyResult && h.selectedSafeRoute ? (
                  <>
                    <SafetyPanel
                      safetyResult={h.safetyResult}
                      selectedSafeRoute={h.selectedSafeRoute}
                      onCategoryPress={handleCategoryPress}
                      inSidebar
                    />
                    {Object.keys(h.selectedSafeRoute.safety.roadTypes).length >
                      0 && (
                      <RoadTypeBreakdown
                        roadTypes={h.selectedSafeRoute.safety.roadTypes}
                      />
                    )}
                    {h.selectedSafeRoute.enrichedSegments &&
                      h.selectedSafeRoute.enrichedSegments.length > 1 && (
                        <SafetyProfileChart
                          segments={h.routeSegments}
                          enrichedSegments={
                            h.selectedSafeRoute.enrichedSegments
                          }
                          roadNameChanges={
                            h.selectedSafeRoute.routeStats?.roadNameChanges ??
                            []
                          }
                          totalDistance={h.selectedSafeRoute.distanceMeters}
                        />
                      )}
                  </>
                ) : undefined
              }
            />

            {/* Start navigation — full width */}
            {h.selectedRouteId && h.nav.state === "idle" && (
              <Pressable
                style={styles.startNavButton}
                onPress={handleStartNavigation}
                accessibilityRole="button"
                accessibilityLabel="Start navigation"
              >
                <Ionicons name="navigate" size={20} color="#ffffff" />
                <Text style={styles.startNavButtonText}>Start Navigation</Text>
              </Pressable>
            )}

            {/* Re-route via a point — shown when routes are ready and not navigating */}
            {h.routes.length > 0 &&
              h.nav.state === "idle" &&
              !h.isNavActive && (
                <View style={styles.viaRow}>
                  <TouchableOpacity
                    style={styles.viaButton}
                    onPress={() => h.setPinMode("via")}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Re-route via a point"
                  >
                    <Ionicons
                      name="git-branch-outline"
                      size={15}
                      color="#d946ef"
                    />
                    <Text style={styles.viaButtonText}>
                      Re-route via a point
                    </Text>
                  </TouchableOpacity>
                  {h.viaPinLocation && (
                    <TouchableOpacity
                      style={styles.viaClearButton}
                      onPress={() => h.clearViaPin()}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Clear via point"
                    >
                      <Ionicons name="close-circle" size={15} color="#667085" />
                      <Text style={styles.viaClearText}>Clear via point</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
          </DraggableSheet>
        )}

        {/* ── Modals / Overlays ── */}
        <AIExplanationModal
          visible={h.showAIModal}
          ai={h.ai}
          onClose={() => {
            h.setShowAIModal(false);
            h.ai.reset();
          }}
        />

        <OnboardingModal
          visible={h.showOnboarding}
          error={h.onboardingError}
          onAccept={h.handleAcceptOnboarding}
          onDismiss={() => h.setShowOnboarding(false)}
        />

        {Platform.OS !== "web" && (
          <NavigationOverlay
            nav={h.nav}
            topInset={insets.top}
            bottomInset={insets.bottom}
            showRecenter={h.isNavActive && !isNavFollowing}
            onRecenter={handleRecenterNavigation}
          />
        )}

        <DownloadAppModal
          visible={showDownloadModal}
          onClose={() => setShowDownloadModal(false)}
        />

        {/* ── Toast notifications ── */}
        <MapToast
          toast={toast}
          onDismiss={() => setToast(null)}
          webTopOffset={isDesktopWeb ? 16 : 12}
          webLeftOffset={webSidebarOverlayOffset}
        />

        {/* ── Report modal ── */}
        <ReportModal
          visible={showReportModal}
          location={h.location}
          onClose={() => setShowReportModal(false)}
          onSubmitted={handleReportSubmitted}
        />

        {/* ── Web guest login prompt (dismissable) ── */}
        <LoginModal
          visible={showLoginPrompt}
          onClose={() => setShowLoginPrompt(false)}
          onCheckAuthOptions={auth.checkAuthOptions}
          onSendMagicLink={auth.sendMagicLink}
          onSignInWithPassword={auth.signInWithPassword}
          onForgotPassword={auth.forgotPassword}
          onVerify={auth.verify}
          error={auth.error}
          dismissable={true}
        />

        {/* ── Background location disclosure (Android — Google Play requirement) ── */}
        <BackgroundLocationModal
          visible={live.showBackgroundDisclosure}
          onAllow={live.confirmBackgroundPermission}
          onDeny={live.denyBackgroundPermission}
        />

        {/* ── Subscription limit popup ── */}
        <LimitReachedModal
          visible={limitModal !== null}
          limitInfo={limitModal}
          onClose={() => setLimitModal(null)}
          onUpgrade={() => setShowSubscriptionModal(true)}
        />

        {/* ── Subscription upgrade / manage modal ── */}
        <SubscriptionModal
          visible={showSubscriptionModal}
          currentTier={subscriptionTier}
          isGift={auth.user?.isGift}
          isFamilyPack={auth.user?.isFamilyPack}
          subscriptionEndsAt={auth.user?.subscriptionEndsAt}
          onClose={() => setShowSubscriptionModal(false)}
          onSubscriptionChanged={() => auth.refreshProfile?.()}
          onOpenFamilyPack={() => setShowFamilyPackModal(true)}
        />

        {/* ── Family Pack modal ── */}
        <FamilyPackModal
          visible={showFamilyPackModal}
          onClose={() => setShowFamilyPackModal(false)}
          onPackChanged={() => auth.refreshProfile?.()}
        />

        {/* ── Profile fetch failed — auto-logout overlay (no buttons) ── */}
        {auth.profileFetchFailed && (
          <View style={styles.profileFailOverlay}>
            <View style={styles.profileFailCard}>
              <Ionicons
                name="warning-outline"
                size={40}
                color="#F59E0B"
                style={{ marginBottom: 12 }}
              />
              <Text style={styles.profileFailTitle}>
                Unable to load your profile
              </Text>
              <Text style={styles.profileFailBody}>
                Your session is active but we couldn&apos;t retrieve your data.{"\n"}
                Logging you out automatically…
              </Text>
            </View>
          </View>
        )}
      </AndroidOverlayHost>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  friendToggle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#7C3AED",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  friendToggleActive: {
    backgroundColor: "#7C3AED",
    borderColor: "#7C3AED",
  },
  reportBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  currentLocationBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  currentLocationBtnActive: {
    backgroundColor: "#fff",
    borderColor: "#1570EF",
  },
  currentLocationBtnInactive: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  currentLocationDotOuter: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(21,112,239,0.22)",
  },
  currentLocationDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#1570EF",
  },
  pinBanner: {
    position: "absolute",
    bottom: 12,
    left: 16,
    right: 16,
    backgroundColor: "#1570ef",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 12px rgba(21, 112, 239, 0.35)" }
      : {}),
    elevation: 10,
    zIndex: 10,
  },
  pinBannerInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  pinBannerText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  pinBannerCancel: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
  },
  pinBannerCancelText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 13,
  },
  aiWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 13,
  },
  aiButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: "#7c3aed",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 14px rgba(124, 58, 237, 0.4)" }
      : {}),
    elevation: 14,
  },
  aiText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  viaRow: {
    flexDirection: "column",
    gap: 6,
    marginBottom: 8,
    marginTop: 4,
  },
  viaButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#d946ef",
    backgroundColor: "rgba(217,70,239,0.06)",
  },
  viaButtonText: {
    color: "#d946ef",
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  viaClearButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d0d5dd",
    backgroundColor: "rgba(102,112,133,0.06)",
  },
  viaClearText: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "500",
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#101828",
  },
  sheetMeta: {
    fontSize: 14,
    color: "#667085",
    fontWeight: "500",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: "#fef2f2",
  },
  placeResultsPanel: {
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#f8fbff",
    overflow: "hidden",
  },
  placeCategoryFiltersBlock: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e6eefb",
    gap: 6,
  },
  placeFiltersHelperText: {
    fontSize: 11,
    color: "#475467",
    fontWeight: "500",
  },
  placeCategoriesWrap: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  placeCategoryBubble: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 0,
  },
  placeCategoryBubbleIconOnly: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
  },
  placeCategoryBubbleEqual: {
    flex: 1,
    minWidth: 0,
  },
  placeCategoryBubbleActive: {
    borderColor: "#1570ef",
    backgroundColor: "#dbeafe",
  },
  placeCategoryBubbleText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    flexShrink: 1,
  },
  placeCategoryBubbleCount: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1570ef",
    backgroundColor: "#dbeafe",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  placeResultsHeader: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e6eefb",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  searchAroundBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e6eefb",
  },
  searchAroundText: {
    color: "#334155",
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  searchAroundBtn: {
    backgroundColor: "#1570ef",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  searchAroundBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 12,
  },
  searchAroundFloatingWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 210,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  searchAroundFloatingBtn: {
    backgroundColor: "#1570ef",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 14px rgba(21,112,239,0.35)" }
      : {
          shadowColor: "#0f56b3",
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.28,
          shadowRadius: 8,
          elevation: 8,
        }),
  } as any,
  searchAroundFloatingBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  searchAroundFloatingLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchAroundFloatingLimit: {
    backgroundColor: "rgba(15,23,42,0.78)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchAroundFloatingLimitText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  placeResultsTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  placeResultsActionBtn: {
    borderRadius: 8,
    backgroundColor: "#1570ef",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  placeResultsActionText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
  },
  placeResultItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#edf2ff",
    gap: 3,
  },
  placeResultItemSelected: {
    backgroundColor: "#eef6ff",
  },
  placeResultTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  placeResultTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#101828",
  },
  placeResultSecondary: {
    fontSize: 12,
    fontWeight: "500",
    color: "#667085",
    paddingLeft: 24,
  },
  placeResultDetailsWrap: {
    marginTop: 6,
    marginLeft: 24,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  placeResultDetailsText: {
    fontSize: 12,
    color: "#334155",
    fontWeight: "500",
  },
  placeResultDetailsMeta: {
    fontSize: 11,
    color: "#1d4ed8",
    fontWeight: "700",
  },
  placeResultDetailsCoords: {
    fontSize: 11,
    color: "#475467",
    fontWeight: "500",
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 2,
  },
  warningText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#dc2626",
  },
  warningDetail: {
    fontSize: 12,
    fontWeight: "400",
    color: "#374151",
    marginTop: 4,
    lineHeight: 17,
  },
  warningHint: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
  error: {
    fontSize: 14,
    color: "#d92d20",
    paddingVertical: 8,
  },
  startNavButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#1570ef",
    width: "100%",
  } as any,
  startNavButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
  routeSafetyRow: {
    width: "100%",
  },
  routeSafetyRowWeb: {
    flexDirection: "row",
    gap: 16,
    alignItems: "flex-start",
  } as any,
  highlightBanner: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 220,
    alignItems: "center",
  },
  highlightBannerInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "rgba(21, 112, 239, 0.9)",
    maxWidth: 360,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }
      : {}),
    elevation: 14,
  } as any,
  highlightBannerText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  locationRecoveryWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 120,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  locationRecoveryCard: {
    width: "100%",
    maxWidth: 760,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 12px rgba(21,112,239,0.15)" }
      : {
          shadowColor: "#1570ef",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 10,
          elevation: 10,
        }),
  } as any,
  locationRecoveryText: {
    flex: 1,
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: "600",
  },
  locationRecoveryBtn: {
    borderRadius: 8,
    backgroundColor: "#1570ef",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  locationRecoveryBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  locationRecoveryLink: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#93c5fd",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  locationRecoveryLinkText: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: "700",
  },
  placeProfileWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 112,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  placeProfileCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e4e7ec",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 8px 24px rgba(16,24,40,0.14)" }
      : {
          shadowColor: "#101828",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.14,
          shadowRadius: 12,
          elevation: 16,
        }),
  } as any,
  placeProfileTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#101828",
  },
  placeProfileSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: "#667085",
    fontWeight: "500",
  },
  placeProfileMeta: {
    marginTop: 3,
    fontSize: 11,
    color: "#1d4ed8",
    fontWeight: "700",
  },
  placeProfileCoords: {
    marginTop: 2,
    fontSize: 11,
    color: "#475467",
    fontWeight: "500",
  },
  placeProfileAction: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: "#1570ef",
  },
  placeProfileActionText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  profileFailOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  } as any,
  profileFailCard: {
    backgroundColor: "#1F2937",
    borderRadius: 16,
    paddingVertical: 32,
    paddingHorizontal: 28,
    alignItems: "center",
    maxWidth: 340,
    width: "85%",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }
      : {}),
    elevation: 20,
  } as any,
  profileFailTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
  },
  profileFailBody: {
    color: "#9CA3AF",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  stickyHeaderContainer: {
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e6eefb",
  },
  distanceFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e6eefb",
  },
  distanceFilterLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475467",
  },
  distanceFilterOptions: {
    flexDirection: "row",
    gap: 6,
    flex: 1,
  },
  distanceFilterButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  distanceFilterButtonActive: {
    backgroundColor: "#1570ef",
    borderColor: "#1570ef",
  },
  distanceFilterButtonText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#475467",
  },
  distanceFilterButtonTextActive: {
    color: "#ffffff",
  },
});
