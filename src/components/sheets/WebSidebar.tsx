/**
 * WebSidebar — left sidebar for web only.
 *
 * Replaces the centered SearchBar + DraggableSheet bottom sheet on web.
 * Features:
 * - Left-anchored, expands rightward
 * - Search inputs at the top
 * - Route results + safety panel below
 * - Center toggle pill to collapse/expand
 * - Auto-expands when results arrive, auto-compacts on clear
 * - Minimum width preserves search inputs; cannot collapse below docked rail
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SiteFooterLinks } from '@/src/components/seo/SiteFooterLinks';

import {
  clampWebSidebarWidth,
  getWebSidebarCollapsedWidth,
  getWebSidebarOpenWidth,
} from './webSidebarLayout';

export interface WebSidebarProps {
  /** Whether route results are present */
  hasResults: boolean;
  /** Whether we're loading */
  isLoading: boolean;
  /** Whether there's an error */
  hasError: boolean;
  /** Called when user clicks the close/clear button on results */
  onClearResults: () => void;
  /** Controls whether the clear button is shown in the results header. */
  showClearButton?: boolean;
  /** Search bar element */
  searchBar: React.ReactNode;
  /** Download banner element */
  downloadBanner?: React.ReactNode;
  /** Login button for web guests */
  loginButton?: React.ReactNode;
  /** The sheet content (route list, safety, charts, etc.) */
  children: React.ReactNode;
  /** Reports the live width so the parent can keep overlays aligned. */
  onWidthChange?: (width: number) => void;
}

export function WebSidebar({
  hasResults,
  isLoading,
  hasError,
  onClearResults,
  showClearButton = hasResults,
  searchBar,
  downloadBanner,
  loginButton,
  children,
  onWidthChange,
}: WebSidebarProps) {
  const showContent = hasResults || isLoading || hasError;
  const [viewportWidth, setViewportWidth] = useState(() => Dimensions.get('window').width);

  const initialWidth = getWebSidebarOpenWidth(viewportWidth, showContent);
  const sidebarWidth = useRef(new Animated.Value(initialWidth)).current;
  const widthRef = useRef(initialWidth);
  const lastOpenWidthRef = useRef(initialWidth);
  const prevShowContent = useRef(showContent);

  const [isCollapsed, setIsCollapsed] = useState(false);

  const emitWidthChange = useCallback(
    (nextWidth: number) => {
      onWidthChange?.(nextWidth);
    },
    [onWidthChange],
  );

  const animateToWidth = useCallback(
    (target: number, options?: { immediate?: boolean; forceDocked?: boolean }) => {
      const nextWidth = clampWebSidebarWidth(
        target,
        viewportWidth,
        options?.forceDocked ? false : showContent,
      );
      widthRef.current = nextWidth;
      emitWidthChange(nextWidth);

      if (options?.immediate) {
        sidebarWidth.setValue(nextWidth);
        return;
      }

      Animated.spring(sidebarWidth, {
        toValue: nextWidth,
        useNativeDriver: false,
        tension: 70,
        friction: 12,
      }).start();
    },
    [emitWidthChange, sidebarWidth, showContent, viewportWidth],
  );

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', () => {
      const nextViewportWidth = Dimensions.get('window').width;
      setViewportWidth(nextViewportWidth);

      const nextWidth = clampWebSidebarWidth(
        widthRef.current,
        nextViewportWidth,
        showContent,
      );
      widthRef.current = nextWidth;
      emitWidthChange(nextWidth);
      sidebarWidth.setValue(nextWidth);
    });

    return () => sub.remove();
  }, [emitWidthChange, showContent, sidebarWidth]);

  useEffect(() => {
    emitWidthChange(widthRef.current);
  }, [emitWidthChange]);

  useEffect(() => {
    if (showContent && !prevShowContent.current) {
      const target = getWebSidebarOpenWidth(viewportWidth, true);
      lastOpenWidthRef.current = target;
      setIsCollapsed(false);
      animateToWidth(target);
    }

    if (!showContent) {
      setIsCollapsed(widthRef.current <= getWebSidebarCollapsedWidth(false) + 8);
    }

    prevShowContent.current = showContent;
  }, [animateToWidth, showContent, viewportWidth]);

  const handleToggle = useCallback(() => {
    if (isCollapsed) {
      const target = lastOpenWidthRef.current || getWebSidebarOpenWidth(viewportWidth, showContent);
      setIsCollapsed(false);
      animateToWidth(target);
      return;
    }

    lastOpenWidthRef.current = widthRef.current;
    // Collapse to the docked rail even when results are showing; the compact width is
    // the minimum for an open panel, not the collapsed size.
    const target = getWebSidebarCollapsedWidth(false);
    setIsCollapsed(true);
    animateToWidth(target, { forceDocked: true });
  }, [animateToWidth, isCollapsed, showContent, viewportWidth]);

  const handleClear = useCallback(() => {
    onClearResults();
    setIsCollapsed(false);
    animateToWidth(getWebSidebarOpenWidth(viewportWidth, false));
  }, [animateToWidth, onClearResults, viewportWidth]);

  return (
    <Animated.View
      style={[
        styles.sidebar,
        { width: sidebarWidth },
      ]}
    >
      <View style={styles.sidebarInner}>
        {!isCollapsed && downloadBanner}

        {!isCollapsed && (
          <View style={styles.searchArea}>
            {searchBar}
          </View>
        )}

        {!isCollapsed && loginButton && (
          <View style={styles.loginArea}>{loginButton}</View>
        )}

        {!isCollapsed && showContent && (
          <View style={styles.resultsArea}>
            {showClearButton && (
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

        {isCollapsed && (
          <View style={styles.collapsedContent}>
            <Ionicons name="shield-checkmark" size={24} color="#1570ef" />
          </View>
        )}

        {!isCollapsed && Platform.OS === 'web' && (
          <View style={styles.siteLinksFooter}>
            <SiteFooterLinks compact />
          </View>
        )}
      </View>

      <Pressable
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        accessibilityHint="Toggles the sidebar open or closed"
        style={styles.centerToggleButton}
      >
        <Ionicons
          name={isCollapsed ? 'chevron-forward' : 'chevron-back'}
          size={16}
          color="#344054"
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 15,
    flexDirection: 'row',
    overflow: 'visible',
  } as any,
  sidebarInner: {
    flex: 1,
    margin: 12,
    paddingHorizontal: 8,
    overflow: 'visible',
    backgroundColor: 'rgba(255, 255, 255, 0.74)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.7)',
    boxShadow: '0 12px 40px rgba(15, 23, 42, 0.14)',
    backdropFilter: 'blur(28px) saturate(180%)',
  } as any,
  searchArea: {
    paddingTop: 12,
    paddingHorizontal: 0,
  },
  loginArea: {
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  resultsArea: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: '#f2f4f7',
    marginTop: 8,
    // Keep results clear of the pinned site and legal links at the bottom
    // (site links row: up to 3 wrapped lines of ~18px plus 8px gap above it).
    // Reserves room for the site footer (about 60px with its delete row) plus its inset.
    marginBottom: 84,
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 4,
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
    paddingHorizontal: 4,
    paddingBottom: 24,
  },
  collapsedContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  siteLinksFooter: {
    // Single footer group pinned to the bottom of the panel.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    zIndex: 2,
    paddingHorizontal: 12,
  },
  centerToggleButton: {
    position: 'absolute',
    right: -4,
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 10px rgba(15, 23, 42, 0.12)',
    backdropFilter: 'blur(20px) saturate(180%)',
    zIndex: 999,
    cursor: 'pointer',
  } as any,
});
