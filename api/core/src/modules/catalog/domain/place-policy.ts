import { haversineMeters, isInServiceArea, type LatLng } from '@panter/contracts';

/**
 * El punto de recogida (portería, parqueadero, entrada) es parte del mismo lugar: más de 1 km
 * de la ubicación suele ser un pin puesto en otro sitio por error.
 */
export const PICKUP_MAX_DISTANCE_METERS = 1000;

export type PlacePointField = 'location' | 'pickupPoint';

/** Punto de un lugar fuera de SERVICE_AREA (primero la ubicación), o null si ambos están dentro. */
export function placePointOutside(
  location: LatLng,
  pickupPoint: LatLng | null,
): PlacePointField | null {
  if (!isInServiceArea(location)) return 'location';
  if (pickupPoint && !isInServiceArea(pickupPoint)) return 'pickupPoint';
  return null;
}

/** true si el punto de recogida está demasiado lejos del lugar. */
export function pickupTooFar(location: LatLng, pickupPoint: LatLng | null): boolean {
  return (
    pickupPoint !== null && haversineMeters(location, pickupPoint) > PICKUP_MAX_DISTANCE_METERS
  );
}
