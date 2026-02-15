/**
 * WebSidebar — Google Maps-style left sidebar for web only.
 *
 * Replaces the centered SearchBar + DraggableSheet bottom sheet on web.
 * Features:
 * - Left-anchored, expands rightward
 * - Search inputs at the top
 * - Route results + safety panel below
 * - Drag handle on right edge to resize
 * - Toggle chevron button to collapse/expand
 * - Auto-expands when results arrive, auto-collapses on clear
 * - Minimum width preserves search inputs; can't collapse past results
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Pressable,
    ScrollView,
    StyleSheet,
    View
} from 'react-native';

// ── Constants ────────────────────────────────────────────────────────────────

const SIDEBAR_COLLAPSED = 380;     // Search-only width
const SIDEBAR_MIN_RESULTS = 380;   // Minimum when results are present
const MIN_SIDEBAR = 56;            // Absolute minimum (just the toggle)

function getMaxWidth() {
  return Math.floor(Dimensions.get('window').width * 0.5);
}

function getExpandedWidth() {
  // When results arrive, expand to a comfortable reading width
  return Math.min(480, getMaxWidth());
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface WebSidebarProps {
  /** Whether route results are present */
  hasResults: boolean;
  /** Whether we're loading */
  isLoading: boolean;
  /** Whether there's an error */
  hasError: boolean;
  /** Called when user clicks the close/clear button on results */
  onClearResults: () => void;
  /** Search bar element */
  searchBar: React.ReactNode;
  /** Download banner element */
  downloadBanner?: React.ReactNode;
  /** Login button for web guests */
  loginButton?: React.ReactNode;
  /** The sheet content (route list, safety, charts, etc.) */
  children: React.ReactNode;
}

// ── Component ────────────────────────────────────────────────────────────────

export function WebSidebar({
  hasResults,
  isLoading,
  hasError,
  onClearResults,
  searchBar,
  downloadBanner,
  loginButton,
  children,
}: WebSidebarProps) {
  const showContent = hasResults || isLoading || hasError;

  // --- Width state ---
  const sidebarWidth = useRef(new Animated.Value(SIDEBAR_COLLAPSED)).current;
  const widthRef = useRef(SIDEBAR_COLLAPSED);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [maxWidth, setMaxWidth] = useState(getMaxWidth);
  const prevShowContent = useRef(showContent);

  // Listen for window resize
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', () => {
      const newMax = getMaxWidth();
      setMaxWidth(newMax);
      // Clamp current width
      if (widthRef.current > newMax) {
        widthRef.current = newMax;
        sidebarWidth.setValue(newMax);
      }
    });
    return () => sub.remove();
  }, [sidebarWidth]);

  // Auto-expand when results arrive
  useEffect(() => {
    if (showContent && !prevShowContent.current) {
      const target = getExpandedWidth();
      widthRef.current = target;
      setIsCollapsed(false);
      Animated.spring(sidebarWidth, {
        toValue: target,
        useNativeDriver: false,
        bounciness: 4,
      }).start();
    }
    prevShowContent.current = showContent;
  }, [showContent, sidebarWidth]);

  // --- Drag logic (mouse events on right edge) ---
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handleDragStart = useCallback(
    (e: any) => {
      e.preventDefault?.();
      isDragging.current = true;
      dragStartX.current = e.clientX ?? e.nativeEvent?.pageX ?? 0;
      dragStartWidth.current = widthRef.current;

      const handleDragMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const dx = ev.clientX - dragStartX.current;
        const minW = showContent ? SIDEBAR_MIN_RESULTS : MIN_SIDEBAR;
        const clamped = Math.max(minW, Math.min(getMaxWidth(), dragStartWidth.current + dx));
        widthRef.current = clamped;
        sidebarWidth.setValue(clamped);
        setIsCollapsed(clamped <= MIN_SIDEBAR + 10);
      };

      const handleDragEnd = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
        // Snap to sensible widths
        if (widthRef.current < MIN_SIDEBAR + 30) {
          // Snap fully collapsed
          widthRef.current = MIN_SIDEBAR;
          setIsCollapsed(true);
          Animated.spring(sidebarWidth, { toValue: MIN_SIDEBAR, useNativeDriver: false, bounciness: 4 }).start();
        } else if (widthRef.current < SIDEBAR_COLLAPSED - 40 && !showContent) {
          // Snap to collapsed
          widthRef.current = SIDEBAR_COLLAPSED;
          setIsCollapsed(false);
          Animated.spring(sidebarWidth, { toValue: SIDEBAR_COLLAPSED, useNativeDriver: false, bounciness: 4 }).start();
        }
      };

      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
    },
    [showContent, sidebarWidth],
  );

  // --- Toggle collapse/expand ---
  const handleToggle = useCallback(() => {
    if (isCollapsed) {
      // Expand
      const target = showContent ? getExpandedWidth() : SIDEBAR_COLLAPSED;
      widthRef.current = target;
      setIsCollapsed(false);
      Animated.spring(sidebarWidth, { toValue: target, useNativeDriver: false, bounciness: 4 }).start();
    } else {
      // Collapse
      const target = showContent ? SIDEBAR_MIN_RESULTS : MIN_SIDEBAR;
      // If results present, collapse to min results width; otherwise fully collapse
      if (showContent) {
        // Just narrow it to the minimum results width
        widthRef.current = SIDEBAR_MIN_RESULTS;
        Animated.spring(sidebarWidth, { toValue: SIDEBAR_MIN_RESULTS, useNativeDriver: false, bounciness: 4 }).start();
      } else {
        widthRef.current = MIN_SIDEBAR;
        setIsCollapsed(true);
        Animated.spring(sidebarWidth, { toValue: MIN_SIDEBAR, useNativeDriver: false, bounciness: 4 }).start();
      }
    }
  }, [isCollapsed, showContent, sidebarWidth]);

  // --- Clear results ---
  const handleClear = useCallback(() => {
    onClearResults();
    // After clearing, collapse back to search width
    const target = SIDEBAR_COLLAPSED;
    widthRef.current = target;
    setIsCollapsed(false);
    Animated.spring(sidebarWidth, { toValue: target, useNativeDriver: false, bounciness: 4 }).start();
  }, [onClearResults, sidebarWidth]);

  return (
    <Animated.View style={[styles.sidebar, { width: sidebarWidth }]}>
      {/* Sidebar content */}
      <View style={styles.sidebarInner}>
        {/* Download banner inside sidebar */}
        {!isCollapsed && downloadBanner}

        {/* Search bar */}
        {!isCollapsed && (
          <View style={styles.searchArea}>
            {searchBar}
          </View>
        )}

        {/* Login button for web guests */}
        {!isCollapsed && loginButton && (
          <View style={styles.loginArea}>
            {loginButton}
          </View>
        )}

        {/* Results content */}
        {!isCollapsed && showContent && (
          <View style={styles.resultsArea}>
            {/* Clear button */}
            {hasResults && (
              <View style={styles.resultsHeader}>
                <Pressable
                  onPress={handleClear}
                  style={styles.clearButton}
                  accessibilityRole="button"
                  accessibilityLabel="Clear results"
                >
                  <Ionicons name="close" size={18} color="#667085" />
                </Pressable>
              </View>
            )}
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={true}
              bounces={false}
            >
              {children}
            </ScrollView>
          </View>
        )}

        {/* Collapsed state — just show logo/icon */}
        {isCollapsed && (
          <View style={styles.collapsedContent}>
            <Ionicons name="shield-checkmark" size={24} color="#1570ef" />
          </View>
        )}
      </View>

      {/* Right-edge drag handle */}
      <View
        style={styles.dragHandle}
        // @ts-ignore — web mouse events
        onMouseDown={handleDragStart}
      >
        <View style={styles.dragHandleBar} />
      </View>

      {/* Toggle chevron button */}
      <Pressable
        style={styles.toggleButton}
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <Ionicons
          name={isCollapsed ? 'chevron-forward' : 'chevron-back'}
          size={14}
          color="#667085"
        />
      </Pressable>
    </Animated.View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sidebar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    zIndex: 15,
    flexDirection: 'row',
    boxShadow: '4px 0 16px rgba(0, 0, 0, 0.08)',
    overflow: 'visible',
  } as any,
  sidebarInner: {
    flex: 1,
    overflow: 'hidden',
  },
  searchArea: {
    paddingTop: 12,
    paddingHorizontal: 0,
  },
  loginArea: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  resultsArea: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: '#f2f4f7',
    marginTop: 8,
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f2f4f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  collapsedContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragHandle: {
    width: 6,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'col-resize',
    backgroundColor: 'transparent',
  } as any,
  dragHandleBar: {
    width: 3,
    height: 40,
    borderRadius: 1.5,
    backgroundColor: '#d0d5dd',
    opacity: 0.6,
  },
  toggleButton: {
    position: 'absolute',
    right: -16,
    top: 16,
    width: 24,
    height: 40,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '2px 0 8px rgba(0, 0, 0, 0.1)',
    zIndex: 16,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: '#e5e7eb',
  } as any,
});
