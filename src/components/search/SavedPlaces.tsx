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
import { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { SavedPlace } from '@/src/hooks/useSavedPlaces';
import { PLACE_PRESETS } from '@/src/hooks/useSavedPlaces';

interface SavedPlacesProps {
  places: SavedPlace[];
  onSelect: (place: SavedPlace) => void;
  onSave: (place: Omit<SavedPlace, 'id' | 'createdAt'>) => void;
  onRemove: (id: string) => void;
  onToast?: (msg: string, icon?: string) => void;
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
  currentDestination,
  visible,
}: SavedPlacesProps) {
  const [addingCustom, setAddingCustom] = useState(false);
  const [customLabel, setCustomLabel] = useState('');

  const existingLabels = new Set(places.map((p) => p.label.toLowerCase()));

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

  /** Tap an empty preset → save current destination under that label */
  const handleTapPreset = useCallback(
    (preset: { label: string; icon: string }) => {
      if (!currentDestination) {
        onToast?.(`Search a place first, then tap ${preset.label}`, 'information-circle-outline');
        return;
      }
      const isUpdate = existingLabels.has(preset.label.toLowerCase());
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
    [currentDestination, existingLabels, onSave, onToast],
  );

  /** Confirm custom label */
  const confirmCustom = useCallback(() => {
    const label = customLabel.trim();
    if (!label || !currentDestination) return;
    const isUpdate = existingLabels.has(label.toLowerCase());
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
  }, [customLabel, currentDestination, existingLabels, onSave, onToast]);

  if (!visible) return null;

  const emptyPresets = PLACE_PRESETS.filter(
    (p) => !existingLabels.has(p.label.toLowerCase()),
  );

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="always"
      >
        {/* Saved places — small pills */}
        {places.map((place) => (
          <Pressable
            key={place.id}
            style={({ pressed }) => [
              styles.pill,
              styles.pillSaved,
              pressed && styles.pillPressed,
            ]}
            onPress={() => handleTapSaved(place)}
            onLongPress={() => handleLongPressSaved(place)}
            delayLongPress={500}
          >
            <Ionicons name={place.icon as any} size={13} color="#1570ef" />
            <Text style={styles.pillLabel} numberOfLines={1}>
              {place.label}
            </Text>
          </Pressable>
        ))}

        {/* Empty preset pills */}
        {emptyPresets.map((preset) => (
          <Pressable
            key={preset.label}
            style={({ pressed }) => [
              styles.pill,
              styles.pillEmpty,
              pressed && styles.pillPressed,
            ]}
            onPress={() => handleTapPreset(preset)}
          >
            <Ionicons name={preset.icon as any} size={13} color="#98a2b3" />
            <Text style={styles.pillLabelEmpty} numberOfLines={1}>
              {preset.label}
            </Text>
          </Pressable>
        ))}

        {/* Add custom label pill */}
        <Pressable
          style={({ pressed }) => [
            styles.pill,
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
      </ScrollView>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
  },
  scrollContent: {
    paddingHorizontal: 2,
    gap: 6,
    alignItems: 'center',
  },

  // ── Pill base ──
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 16,
  },
  pillSaved: {
    backgroundColor: '#eff8ff',
    borderWidth: 1,
    borderColor: '#b2ddff',
  },
  pillEmpty: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e4e7ec',
    borderStyle: 'dashed',
  },
  pillAdd: {
    backgroundColor: '#eff8ff',
    borderWidth: 1,
    borderColor: '#b2ddff',
    borderStyle: 'dashed',
    paddingHorizontal: 6,
  },
  pillPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.95 }],
  },
  pillLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1570ef',
    maxWidth: 64,
  },
  pillLabelEmpty: {
    fontSize: 11,
    fontWeight: '500',
    color: '#98a2b3',
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
});
