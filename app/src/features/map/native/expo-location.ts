// Adaptador de expo-location para la lógica de permisos (location/location-status.ts).
import type { LatLng } from '@panter/contracts';
import * as Location from 'expo-location';
import { Linking } from 'react-native';
import type { LocationApi, PermissionInfo } from '../location/location-status';

const toInfo = (response: Location.LocationPermissionResponse): PermissionInfo => ({
  granted: response.granted,
  canAskAgain: response.canAskAgain,
});

export const expoLocationApi: LocationApi = {
  getPermission: async () => toInfo(await Location.getForegroundPermissionsAsync()),
  requestPermission: async () => toInfo(await Location.requestForegroundPermissionsAsync()),
  servicesEnabled: () => Location.hasServicesEnabledAsync(),
};

/** Pide a Android encender la ubicación (diálogo del sistema). Lanza si el usuario no acepta. */
export function askToEnableGps(): Promise<void> {
  return Location.enableNetworkProviderAsync();
}

export function openAppSettings(): Promise<void> {
  return Linking.openSettings();
}

/** Sigue la posición en primer plano. Devuelve la función para dejar de seguirla. */
export async function watchPosition(
  onPosition: (position: LatLng) => void,
  onError: () => void,
): Promise<() => void> {
  const subscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5_000 },
    ({ coords }) => onPosition({ lat: coords.latitude, lng: coords.longitude }),
    () => onError(),
  );
  return () => subscription.remove();
}
