/**
 * Storage keys shared by more than one module. Kept dependency-free so that
 * services and hooks can both import it without creating an import cycle.
 */

/** AsyncStorage key for the on-device saved places list (useSavedPlaces) */
export const SAVED_PLACES_STORAGE_KEY = '@safenight_saved_places';
