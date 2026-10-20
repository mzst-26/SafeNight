/**
 * SavedPlaces — Compact saved destination pills.
 *
 * Displayed below the search input as tiny icon pills (e.g. Home, Work).
 * - Tapping a saved pill navigates to that destination
 * - Tapping an empty preset pill saves the current search result under that label
 *   and shows a toast ("Home saved" / "Home updated")
 * - Long-press a saved pill to remove it
 * - "+" pill lets users create a custom label
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import type { SavedPlace } from '@/src/hooks/useSavedPlaces';
import { PLACE_PRESETS } from '@/src/hooks/useSavedPlaces';
import { colors, radius, spacing, type } from '@/src/theme';

interface SavedPlacesProps {
  places: SavedPlace[];
  onSelect: (place: SavedPlace) => void;
  onSave: (place: Omit<SavedPlace, 'id' | 'createdAt'>) => void;
  onRemove: (id: string) => void;
  onToast?: (msg: string, icon?: string) => void;
  onPopupBottomChange?: (bottomY: number | null) => void;
  /** Current destination from search (for save-on-tap flow) */
  currentDestination?: {
    name: string;
    address?: string;
    lat: number;
    lng: number;
  } | null;
  visible: boolean;
}

export function SavedPlaces({
  places,
  onSelect,
  onSave,
  onRemove,
  onToast,
  onPopupBottomChange,
  currentDestination,
  visible,
}: SavedPlacesProps) {
  const [addingCustom, setAddingCustom] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [showListPopup, setShowListPopup] = useState(false);
  // Geometry for the thin horizontal scroll indicator under the chips
  const [chipViewportW, setChipViewportW] = useState(0);
  const [chipContentW, setChipContentW] = useState(0);
  const [chipOffset, setChipOffset] = useState(0);
  const { width } = useWindowDimensions();

  const existingLabels = useMemo(
    () => new Set(places.map((p) => p.label.toLowerCase())),
    [places],
  );

  /** Tap a saved pill → navigate */
  const handleTapSaved = useCallback(
    (place: SavedPlace) => {
      onSelect(place);
    },
    [onSelect],
  );

  /** Long-press a saved pill → remove */
  const handleLongPressSaved = useCallback(
    (place: SavedPlace) => {
      if (Platform.OS === 'web') {
        if (confirm(`Remove "${place.label}"?`)) {
          onRemove(place.id);
          onToast?.(`${place.label} removed`, 'trash-outline');
        }
        return;
      }
      Alert.alert(
        place.label,
        place.name,
        [
          { text: 'Remove', style: 'destructive', onPress: () => { onRemove(place.id); onToast?.(`${place.label} removed`, 'trash-outline'); } },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    },
    [onRemove, onToast],
  );

  useEffect(() => {
    if (!showListPopup) {
      onPopupBottomChange?.(null);
      return;
    }

    return () => {
      onPopupBottomChange?.(null);
    };
  }, [onPopupBottomChange, showListPopup]);

  const handleListPopupLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!showListPopup) return;
      const { y, height } = event.nativeEvent.layout;
      onPopupBottomChange?.(y + height);
    },
    [onPopupBottomChange, showListPopup],
  );

  /** Tap an empty preset → save current destination under that label */
  const handleTapPreset = useCallback(
    (preset: { label: string; icon: string }) => {
      if (!currentDestination) {
        onToast?.(`Search a place first, then tap ${preset.label}`, 'information-circle-outline');
        return;
      }
      const result = onSave({
        label: preset.label,
        name: currentDestination.name,
        address: currentDestination.address,
        lat: currentDestination.lat,
        lng: currentDestination.lng,
        icon: preset.icon,
      } as any);
      Promise.resolve(result).then((r: any) => {
        if (!r || r.ok === undefined) {
          onToast?.(`${preset.label} saved`, preset.icon);
          return;
        }
        if (!r.ok) {
          onToast?.(`Location already saved as ${r.existingLabel}`, 'bookmark');
        } else {
          onToast?.(`${preset.label} ${r.updated ? 'updated' : 'saved'}`, preset.icon);
        }
      });
    },
    [currentDestination, onSave, onToast],
  );

  /** Confirm custom label */
  const confirmCustom = useCallback(() => {
    const label = customLabel.trim();
    if (!label || !currentDestination) return;
    const preset = PLACE_PRESETS.find(
      (p) => p.label.toLowerCase() === label.toLowerCase(),
    );
    const result = onSave({
      label,
      name: currentDestination.name,
      address: currentDestination.address,
      lat: currentDestination.lat,
      lng: currentDestination.lng,
      icon: preset?.icon ?? 'bookmark',
    } as any);
    Promise.resolve(result).then((r: any) => {
      if (!r || r.ok === undefined) {
        onToast?.(`${label} saved`, preset?.icon ?? 'bookmark');
      } else if (!r.ok) {
        onToast?.(`Location already saved as ${r.existingLabel}`, 'bookmark');
      } else {
        onToast?.(`${label} ${r.updated ? 'updated' : 'saved'}`, preset?.icon ?? 'bookmark');
      }
    });
    setAddingCustom(false);
    setCustomLabel('');
  }, [customLabel, currentDestination, onSave, onToast]);

  if (!visible) return null;

  const emptyPresets = PLACE_PRESETS.filter(
    (p) => !existingLabels.has(p.label.toLowerCase()),
  );
  const useSidePopup = Platform.OS === 'web' && width >= 1100;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="always"
        scrollEventThrottle={16}
        onLayout={(e) => setChipViewportW(e.nativeEvent.layout.width)}
        onContentSizeChange={(w) => setChipContentW(w)}
        onScroll={(e) => setChipOffset(e.nativeEvent.contentOffset.x)}
      >
        {/* Saved places — small pills */}
        {places.map((place) => (
          <Pressable
            key={place.id}
            style={({ pressed }) => [
              styles.circle,
              styles.circleSaved,
              pressed && styles.pillPressed,
            ]}
            onPress={() => handleTapSaved(place)}
            onLongPress={() => handleLongPressSaved(place)}
            delayLongPress={500}
            accessibilityRole="button"
            accessibilityLabel={place.label}
          >
            <Ionicons name={place.icon as any} size={18} color={colors.primary} />
          </Pressable>
        ))}

        {/* Empty preset pills */}
        {emptyPresets.map((preset) => (
          <Pressable
            key={preset.label}
            style={({ pressed }) => [
              styles.circle,
              styles.pillEmpty,
              pressed && styles.pillPressed,
            ]}
            onPress={() => handleTapPreset(preset)}
            accessibilityRole="button"
            accessibilityLabel={preset.label}
          >
            <Ionicons name={preset.icon as any} size={18} color={colors.textSecondary} />
          </Pressable>
        ))}

        {/* Add custom label pill */}
        <Pressable
          style={({ pressed }) => [
            styles.circle,
            styles.pillAdd,
            pressed && styles.pillPressed,
          ]}
          onPress={() => {
            if (!currentDestination) {
              onToast?.('Search a place first', 'information-circle-outline');
              return;
            }
            setAddingCustom(true);
            setCustomLabel('');
          }}
        >
          <Ionicons name="add" size={14} color="#1570ef" />
        </Pressable>

        {/* Saved list: icon only, sitting next to the add button */}
        <Pressable
          style={({ pressed }) => [
            styles.listIconPill,
            pressed && styles.pillPressed,
          ]}
          onPress={() => setShowListPopup((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel="Open saved locations list"
        >
          <Ionicons name="list-outline" size={15} color="#344054" />
        </Pressable>
      </ScrollView>

      {/* Thin scroll indicator: only when the chips overflow sideways */}
      {chipContentW > chipViewportW + 1 && chipViewportW > 0 && (
        <View style={styles.scrollTrack}>
          <View
            style={[
              styles.scrollThumb,
              {
                width: Math.max(24, (chipViewportW / chipContentW) * (chipViewportW - 24)),
                transform: [
                  {
                    translateX:
                      (chipOffset / (chipContentW - chipViewportW)) *
                      (chipViewportW - 24 - Math.max(24, (chipViewportW / chipContentW) * (chipViewportW - 24))),
                  },
                ],
              },
            ]}
          />
        </View>
      )}

      {/* Inline custom label input */}
      {addingCustom && (
        <View style={styles.customRow}>
          <TextInput
            value={customLabel}
            onChangeText={setCustomLabel}
            placeholder="Label name..."
            placeholderTextColor="#98a2b3"
            style={styles.customInput}
            autoFocus
            onSubmitEditing={confirmCustom}
            returnKeyType="done"
          />
          <Pressable
            style={[styles.customBtn, !customLabel.trim() && styles.customBtnDisabled]}
            onPress={confirmCustom}
            disabled={!customLabel.trim()}
          >
            <Ionicons name="checkmark" size={16} color="#fff" />
          </Pressable>
          <Pressable
            style={styles.customCancel}
            onPress={() => setAddingCustom(false)}
          >
            <Ionicons name="close" size={16} color="#667085" />
          </Pressable>
        </View>
      )}

      {showListPopup && (
        <View
          style={[
            styles.listPopup,
            useSidePopup ? styles.listPopupWeb : styles.listPopupInline,
          ]}
          onLayout={handleListPopupLayout}
        >
          <View style={styles.listHeaderRow}>
            <Text style={styles.listTitle}>Saved locations</Text>
            <Pressable
              style={styles.listCloseBtn}
              onPress={() => setShowListPopup(false)}
              accessibilityRole="button"
              accessibilityLabel="Close saved locations list"
            >
              <Ionicons name="close" size={15} color="#667085" />
            </Pressable>
          </View>

          {places.length === 0 ? (
            <Text style={styles.listEmptyText}>No saved locations yet.</Text>
          ) : (
            <ScrollView
              style={styles.listScroll}
              showsVerticalScrollIndicator
              nestedScrollEnabled
            >
              {places.map((place, idx) => (
                <Pressable
                  key={`list-${place.id}`}
                  style={({ pressed }) => [
                    styles.listRow,
                    idx === places.length - 1 && styles.listRowLast,
                    pressed && styles.listRowPressed,
                  ]}
                  onPress={() => {
                    handleTapSaved(place);
                    setShowListPopup(false);
                  }}
                >
                  <View style={styles.listIconWrap}>
                    <Ionicons name={place.icon as any} size={16} color="#1570ef" />
                  </View>
                  <View style={styles.listTextWrap}>
                    <Text style={styles.listLabel} numberOfLines={1}>
                      {place.label}
                    </Text>
                    <Text style={styles.listName} numberOfLines={1}>
                      {place.name}
                    </Text>
                    {place.address ? (
                      <Text style={styles.listAddress} numberOfLines={1}>
                        {place.address}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    style={styles.listDeleteBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      handleLongPressSaved(place);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${place.label}`}
                  >
                    <Ionicons name="trash-outline" size={15} color="#d92d20" />
                  </Pressable>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 0,
    position: 'relative',
    paddingTop: 10,
    paddingBottom: 12,
  },
  // Fills the viewport and centres the chips when they all fit; scrolls when they don't.
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
    alignItems: 'center',
  },

  scrollTrack: {
    alignSelf: 'center',
    width: '70%',
    height: 2,
    marginTop: 8,
    borderRadius: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.07)',
    overflow: 'hidden',
  },
  scrollThumb: {
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
  },
  listIconPill: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.06)',
  } as any,

  // ── Round glass button (icon only), the same style as the map and list buttons ──
  circle: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  circleSaved: {
    backgroundColor: 'rgba(21, 112, 239, 0.12)',
    borderColor: colors.primaryBorder,
  },

  // ── Pill base ──
  // Every chip shares one height so the row reads as a single line.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  pillSaved: {
    backgroundColor: 'rgba(21, 112, 239, 0.10)',
    borderColor: 'rgba(21, 112, 239, 0.25)',
  },
  pillEmpty: {
    backgroundColor: colors.glass,
    borderColor: colors.glassBorder,
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.9), ${colors.glassShadow}`,
  } as any,
  pillAdd: {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 10,
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.06)',
  } as any,
  pillList: {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderColor: 'rgba(255, 255, 255, 0.95)',
  },
  pillPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.95 }],
  },
  pillLabel: {
    ...type.label,
    color: colors.primary,
    maxWidth: 80,
  },
  pillLabelEmpty: {
    ...type.caption,
    color: colors.textSecondary,
    maxWidth: 80,
  },
  pillListLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#344054',
    maxWidth: 64,
  },

  // ── Custom label row ──
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  customInput: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: '#101828',
    borderWidth: 1,
    borderColor: '#e4e7ec',
  },
  customBtn: {
    backgroundColor: '#1570ef',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customBtnDisabled: {
    opacity: 0.35,
  },
  customCancel: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f4f7',
  },

  listPopup: {
    zIndex: 60,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4e7ec',
    minWidth: 280,
    maxWidth: 320,
    maxHeight: 360,
    boxShadow: '0 14px 32px rgba(16, 24, 40, 0.16)',
    elevation: 14,
  } as any,
  listPopupWeb: {
    position: 'absolute',
    top: 0,
    left: '100%',
    marginLeft: 12,
  },
  listPopupInline: {
    marginTop: 8,
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f4f7',
  },
  listTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#101828',
  },
  listCloseBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f4f7',
  },
  listEmptyText: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 12,
    color: '#667085',
  },
  listScroll: {
    maxHeight: 300,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f4f7',
  },
  listRowLast: {
    borderBottomWidth: 0,
  },
  listRowPressed: {
    backgroundColor: '#f8fbff',
  },
  listIconWrap: {
    width: 24,
    alignItems: 'center',
  },
  listTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  listLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1570ef',
  },
  listName: {
    marginTop: 1,
    fontSize: 12,
    color: '#1f2937',
    fontWeight: '500',
  },
  listAddress: {
    marginTop: 1,
    fontSize: 11,
    color: '#667085',
  },
  listDeleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
  },
});
