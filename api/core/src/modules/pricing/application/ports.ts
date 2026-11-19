import type {
  FareChange,
  FareRule,
  FareRuleUpdateBody,
  Geofence,
  GeofenceKind,
  GeofenceUpdateBody,
  LatLng,
  VehicleType,
} from '@panter/contracts';
import type { HistoryCursor } from '../domain/history-cursor';

/**
 * Resultado de una edición, decidido en una sola sentencia atómica (la misma que escribe el
 * historial en `fare_changes`):
 * - `actorIsAdmin`: quien edita sigue siendo ADMIN con la cuenta ACTIVE (manda la base de
 *   datos, no el token);
 * - `exists`: la regla o la geocerca existe;
 * - `changed`: hubo cambio real (false si los valores eran los mismos: no se registra nada).
 */
export interface EditResult {
  actorIsAdmin: boolean;
  exists: boolean;
  changed: boolean;
}

/** Puerto: reglas de tarifa (`fare_rules`). */
export interface FareRuleRepository {
  /** Todas, incluidas las inactivas, en el orden del enum de vehículos. */
  list(): Promise<FareRule[]>;
  get(vehicleType: VehicleType): Promise<FareRule | null>;
  /** Actualiza y escribe en `fare_changes` (antes, después y autor) en la misma transacción. */
  update(input: {
    vehicleType: VehicleType;
    actorId: string;
    rule: FareRuleUpdateBody;
  }): Promise<EditResult>;
}

/** Geocerca activa que cubre el origen o el destino de un viaje (HU-402). */
export interface GeofenceHit {
  id: string;
  name: string;
  kind: GeofenceKind;
  surcharge: number;
}

/** Puerto: geocercas (`geofences`, PostGIS). */
export interface GeofenceRepository {
  list(): Promise<Geofence[]>;
  get(id: string): Promise<Geofence | null>;
  /**
   * Geocercas activas que aplican al tipo de vehículo y cubren el origen o el destino
   * (`ST_Covers` con el índice GIST; el borde cuenta como dentro).
   */
  findCovering(input: {
    origin: LatLng;
    destination: LatLng;
    vehicleType: VehicleType;
  }): Promise<GeofenceHit[]>;
  /**
   * Actualiza y registra en `fare_changes`. PostGIS valida el polígono (`ST_IsValid`) en la
   * misma sentencia: si no es válido no se escribe nada y `polygonReason` dice por qué.
   */
  update(input: {
    id: string;
    actorId: string;
    geofence: GeofenceUpdateBody;
  }): Promise<EditResult & { polygonValid: boolean; polygonReason: string | null }>;
}

export interface FareChangesPage {
  items: FareChange[];
  next: HistoryCursor | null;
}

/** Puerto: historial inmutable de cambios (`fare_changes`). */
export interface FareChangeRepository {
  list(input: { limit: number; after?: HistoryCursor }): Promise<FareChangesPage>;
}
