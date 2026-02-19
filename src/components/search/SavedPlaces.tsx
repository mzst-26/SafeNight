/**
 * SavedPlaces — Quick-access saved destination squares.
 *
 * Displayed below the search input as compact squares (e.g. Home, Work).
 * - Tapping a saved place selects it as the destination
 * - Long-pressing opens an edit/delete menu
 * - An "Add" square lets users save the current search result
 * - Hidden when search predictions are visible
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
  /** Current destination from search (for "save this place" flow) */
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
  currentDestination,
  visible,
}: SavedPlacesProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');

  const handleTap = useCallback(
    (place: SavedPlace) => {
      if (expandedId === place.id) {
        // Already expanded — collapse
        setExpandedId(null);
      } else {
        // Select this place as destination
        onSelect(place);
      }
    },
    [expandedId, onSelect],
  );

  const handleLongPress = useCallback(
    (place: SavedPlace) => {
      if (Platform.OS === 'web') {
        // Web: toggle expand for delete option
        setExpandedId((prev) => (prev === place.id ? null : place.id));
        return;
      }
      Alert.alert(
        place.label,
        place.name,
        [
          {
            text: 'Navigate here',
            onPress: () => onSelect(place),
          },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => onRemove(place.id),
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    },
    [onSelect, onRemove],
  );

  const handleSaveNew = useCallback(() => {
    if (!currentDestination) return;
    setShowSaveModal(true);
    setSaveLabel('');
  }, [currentDestination]);

  const confirmSave = useCallback(
    (label: string) => {
      if (!currentDestination || !label.trim()) return;
      const preset = PLACE_PRESETS.find(
        (p) => p.label.toLowerCase() === label.trim().toLowerCase(),
      );
      onSave({
        label: label.trim(),
        name: currentDestination.name,
        address: currentDestination.address,
        lat: currentDestination.lat,
        lng: currentDestination.lng,
        icon: preset?.icon ?? 'star',
      });
      setShowSaveModal(false);
      setSaveLabel('');
    },
    [currentDestination, onSave],
  );

  if (!visible) return null;

  // Build items: existing saved places + suggested empty presets + add button
  const existingLabels = new Set(places.map((p) => p.label.toLowerCase()));
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
        {/* Saved places */}
        {places.map((place) => (
          <View key={place.id} style={styles.itemWrapper}>
            <Pressable
              style={({ pressed }) => [
                styles.square,
                styles.squareSaved,
                pressed && styles.squarePressed,
              ]}
              onPress={() => handleTap(place)}
              onLongPress={() => handleLongPress(place)}
              delayLongPress={500}
            >
              <Ionicons
                name={place.icon as any}
                size={20}
                color="#1570ef"
              />
              <Text style={styles.squareLabel} numberOfLines={1}>
                {place.label}
              </Text>
            </Pressable>
            {/* Expanded detail card */}
            {expandedId === place.id && (
              <View style={styles.expandedCard}>
                <Text style={styles.expandedName} numberOfLines={2}>
                  {place.name}
                </Text>
                {place.address && (
                  <Text style={styles.expandedAddr} numberOfLines={1}>
                    {place.address}
                  </Text>
                )}
                <View style={styles.expandedActions}>
                  <Pressable
                    style={styles.expandedBtn}
                    onPress={() => { onSelect(place); setExpandedId(null); }}
                  >
                    <Ionicons name="navigate" size={14} color="#fff" />
                    <Text style={styles.expandedBtnText}>Go</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.expandedBtn, styles.expandedBtnDanger]}
                    onPress={() => { onRemove(place.id); setExpandedId(null); }}
                  >
                    <Ionicons name="trash" size={14} color="#fff" />
                    <Text style={styles.expandedBtnText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        ))}

        {/* Empty preset suggestions */}
        {emptyPresets.map((preset) => (
          <Pressable
            key={preset.label}
            style={({ pressed }) => [
              styles.square,
              styles.squareEmpty,
              pressed && styles.squarePressed,
            ]}
            onPress={() => {
              if (currentDestination) {
                onSave({
                  label: preset.label,
                  name: currentDestination.name,
                  address: currentDestination.address,
                  lat: currentDestination.lat,
                  lng: currentDestination.lng,
                  icon: preset.icon,
                });
              } else {
                // No destination — just show label as hint
                if (Platform.OS === 'web') {
                  alert(`Search for a place first, then tap "${preset.label}" to save it.`);
                } else {
                  Alert.alert(
                    `Set ${preset.label}`,
                    `Search for a destination first, then tap "${preset.label}" to save it as a quick shortcut.`,
                  );
                }
              }
            }}
          >
            <Ionicons name={preset.icon as any} size={20} color="#98a2b3" />
            <Text style={styles.squareLabelEmpty} numberOfLines={1}>
              {preset.label}
            </Text>
          </Pressable>
        ))}

        {/* Add custom shortcut */}
        {currentDestination && (
          <Pressable
            style={({ pressed }) => [
              styles.square,
              styles.squareAdd,
              pressed && styles.squarePressed,
            ]}
            onPress={handleSaveNew}
          >
            <Ionicons name="add-circle-outline" size={20} color="#1570ef" />
            <Text style={styles.squareLabelAdd} numberOfLines={1}>
              Save
            </Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Inline save label input */}
      {showSaveModal && (
        <View style={styles.saveModal}>
          <Text style={styles.saveModalTitle}>Save as...</Text>
          <View style={styles.saveModalPresets}>
            {PLACE_PRESETS.filter((p) => !existingLabels.has(p.label.toLowerCase())).map(
              (preset) => (
                <Pressable
                  key={preset.label}
                  style={styles.savePresetChip}
                  onPress={() => confirmSave(preset.label)}
                >
                  <Ionicons name={preset.icon as any} size={14} color="#1570ef" />
                  <Text style={styles.savePresetText}>{preset.label}</Text>
                </Pressable>
              ),
            )}
          </View>
          <View style={styles.saveModalInput}>
            <TextInput
              value={saveLabel}
              onChangeText={setSaveLabel}
              placeholder="Custom label..."
              placeholderTextColor="#98a2b3"
              style={styles.saveInput}
              autoFocus
              onSubmitEditing={() => confirmSave(saveLabel)}
            />
            <Pressable
              style={[
                styles.saveConfirmBtn,
                !saveLabel.trim() && styles.saveConfirmBtnDisabled,
              ]}
              onPress={() => confirmSave(saveLabel)}
              disabled={!saveLabel.trim()}
            >
              <Text style={styles.saveConfirmText}>Save</Text>
            </Pressable>
          </View>
          <Pressable
            style={styles.saveCancelBtn}
            onPress={() => setShowSaveModal(false)}
          >
            <Text style={styles.saveCancelText}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
  },
  scrollContent: {
    paddingHorizontal: 4,
    gap: 8,
  },
  itemWrapper: {
    position: 'relative',
  },
  square: {
    width: 72,
    height: 68,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  squareSaved: {
    backgroundColor: '#eff8ff',
    borderWidth: 1,
    borderColor: '#b2ddff',
  },
  squareEmpty: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e4e7ec',
    borderStyle: 'dashed',
  },
  squareAdd: {
    backgroundColor: '#eff8ff',
    borderWidth: 1,
    borderColor: '#b2ddff',
    borderStyle: 'dashed',
  },
  squarePressed: {
    opacity: 0.7,
    transform: [{ scale: 0.95 }],
  },
  squareLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1570ef',
    maxWidth: 60,
    textAlign: 'center',
  },
  squareLabelEmpty: {
    fontSize: 11,
    fontWeight: '500',
    color: '#98a2b3',
    maxWidth: 60,
    textAlign: 'center',
  },
  squareLabelAdd: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1570ef',
    maxWidth: 60,
    textAlign: 'center',
  },

  // Expanded card
  expandedCard: {
    position: 'absolute',
    top: 74,
    left: -20,
    width: 180,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.15)' } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 12,
      },
    }),
  },
  expandedName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#101828',
    marginBottom: 2,
  },
  expandedAddr: {
    fontSize: 11,
    color: '#667085',
    marginBottom: 8,
  },
  expandedActions: {
    flexDirection: 'row',
    gap: 6,
  },
  expandedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1570ef',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  expandedBtnDanger: {
    backgroundColor: '#ef4444',
  },
  expandedBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },

  // Save modal
  saveModal: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
    marginHorizontal: 4,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.12)' } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 10,
      },
    }),
  },
  saveModalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#101828',
    marginBottom: 8,
  },
  saveModalPresets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  savePresetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eff8ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#b2ddff',
  },
  savePresetText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1570ef',
  },
  saveModalInput: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  saveInput: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#101828',
    borderWidth: 1,
    borderColor: '#e4e7ec',
  },
  saveConfirmBtn: {
    backgroundColor: '#1570ef',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  saveConfirmBtnDisabled: {
    opacity: 0.4,
  },
  saveConfirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  saveCancelBtn: {
    alignSelf: 'center',
    paddingVertical: 6,
    marginTop: 4,
  },
  saveCancelText: {
    fontSize: 12,
    color: '#667085',
  },
});
