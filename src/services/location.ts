import * as Location from 'expo-location';

import { AppError } from '@/src/types/errors';
import type { LatLng } from '@/src/types/geo';

export type LocationPermissionStatus = Location.PermissionStatus;

const toLatLng = (coords: Location.LocationObjectCoords): LatLng => ({
  latitude: coords.latitude,
  longitude: coords.longitude,
});

export const requestForegroundLocationPermission = async (): Promise<LocationPermissionStatus> => {
  const { status } = await Location.requestForegroundPermissionsAsync();

  return status;
};

/** A cached fix older than this is not shown as the user's location. */
const MAX_CACHED_LOCATION_AGE_MS = 10 * 60 * 1000;

export const getLastKnownLocation = async (): Promise<LatLng | null> => {
  try {
    const position = await Location.getLastKnownPositionAsync();
    if (!position?.coords) return null;
    const ageMs = Date.now() - Number(position.timestamp);
    if (!Number.isFinite(ageMs) || ageMs > MAX_CACHED_LOCATION_AGE_MS) return null;
    return toLatLng(position.coords);
  } catch {
    return null;
  }
};

export const getCurrentLocation = async (): Promise<LatLng> => {
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return toLatLng(position.coords);
  } catch (error) {
    throw new AppError('location_unavailable', 'Unable to fetch current location', error);
  }
};
