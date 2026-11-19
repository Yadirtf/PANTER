// Permiso y estado de la ubicación en primer plano (HU-303). TypeScript puro: el adaptador de
// expo-location vive en native/expo-location.ts. El mapa funciona en todos los casos; solo
// cambia el aviso y si se muestra el punto del usuario.
import { isInServiceArea, type LatLng } from '@panter/contracts';

export interface PermissionInfo {
  granted: boolean;
  /** false si el usuario eligió "No volver a preguntar": solo se puede activar en Ajustes. */
  canAskAgain: boolean;
}

/** Lo que necesita la app de expo-location (inyectable en las pruebas). */
export interface LocationApi {
  getPermission(): Promise<PermissionInfo>;
  requestPermission(): Promise<PermissionInfo>;
  /** Ubicación (GPS) activada en el teléfono. */
  servicesEnabled(): Promise<boolean>;
}

export type LocationStatus =
  | { kind: 'checking' }
  /** Permiso negado; `canAskAgain` decide entre volver a pedirlo o ir a Ajustes. */
  | { kind: 'denied'; canAskAgain: boolean }
  | { kind: 'services-off' }
  /** Con permiso, esperando la primera lectura. */
  | { kind: 'locating' }
  | { kind: 'ok'; position: LatLng }
  | { kind: 'outside'; position: LatLng }
  /** Con permiso y GPS, pero no se pudo leer la posición. */
  | { kind: 'unavailable' };

/**
 * Revisa el permiso (y lo pide si `request` y aún se puede) y luego el GPS. Devuelve
 * `locating` si todo está listo para leer la posición.
 */
export async function checkLocationAccess(
  api: LocationApi,
  { request }: { request: boolean },
): Promise<LocationStatus> {
  let permission = await api.getPermission();
  if (!permission.granted && request && permission.canAskAgain) {
    permission = await api.requestPermission();
  }
  if (!permission.granted) return { kind: 'denied', canAskAgain: permission.canAskAgain };
  if (!(await api.servicesEnabled())) return { kind: 'services-off' };
  return { kind: 'locating' };
}

/** Estado según la posición leída: dentro o fuera del área de servicio. */
export function statusForPosition(position: LatLng): LocationStatus {
  return isInServiceArea(position) ? { kind: 'ok', position } : { kind: 'outside', position };
}

export type LocationAction = 'request' | 'settings' | 'enable-gps' | 'retry';

export interface LocationNotice {
  title: string;
  body: string;
  action: { kind: LocationAction; label: string } | null;
}

/** Aviso que se muestra sobre el mapa para cada estado, o `null` si no hace falta. */
export function locationNotice(status: LocationStatus): LocationNotice | null {
  switch (status.kind) {
    case 'checking':
    case 'locating':
    case 'ok':
      return null;
    case 'denied':
      return status.canAskAgain
        ? {
            title: 'Activa tu ubicación',
            body: 'PANTER necesita tu ubicación para mostrarte en el mapa y saber dónde recogerte.',
            action: { kind: 'request', label: 'Permitir ubicación' },
          }
        : {
            title: 'Ubicación bloqueada',
            body: 'Negaste el permiso de ubicación. Actívalo en Ajustes > Apps > PANTER > Permisos.',
            action: { kind: 'settings', label: 'Abrir Ajustes' },
          };
    case 'services-off':
      return {
        title: 'El GPS está apagado',
        body: 'Activa la ubicación del teléfono para verte en el mapa.',
        action: { kind: 'enable-gps', label: 'Activar ubicación' },
      };
    case 'outside':
      return {
        title: 'Estás fuera de la zona de servicio',
        body: 'PANTER funciona en Villagarzón, Mocoa y el corredor a Puerto Asís. El mapa sigue disponible.',
        action: null,
      };
    case 'unavailable':
      return {
        title: 'No encontramos tu ubicación',
        body: 'Sal a un lugar despejado o revisa que el GPS esté activo.',
        action: { kind: 'retry', label: 'Intentar de nuevo' },
      };
  }
}

/** El botón "centrar en mi ubicación" solo sirve con una posición dentro del área. */
export function canCenterOnUser(
  status: LocationStatus,
): status is { kind: 'ok'; position: LatLng } {
  return status.kind === 'ok';
}
