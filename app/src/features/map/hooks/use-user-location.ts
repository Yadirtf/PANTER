// Permiso y posición del usuario en primer plano (HU-303). Al volver a la app se revisa de nuevo:
// el usuario pudo dar el permiso o encender el GPS desde Ajustes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  checkLocationAccess,
  type LocationAction,
  type LocationStatus,
  statusForPosition,
} from '../location/location-status';
import {
  askToEnableGps,
  expoLocationApi,
  openAppSettings,
  watchPosition,
} from '../native/expo-location';

/** Sin lectura en este tiempo, se avisa que no se encontró la ubicación. */
const LOCATING_TIMEOUT_MS = 30_000;

export interface UserLocation {
  status: LocationStatus;
  act: (action: LocationAction) => void;
}

export function useUserLocation(): UserLocation {
  const [status, setStatus] = useState<LocationStatus>({ kind: 'checking' });
  const stopWatching = useRef<(() => void) | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async (request: boolean) => {
    const id = ++generation.current;
    stopWatching.current?.();
    stopWatching.current = null;
    const isCurrent = () => id === generation.current;
    let access: LocationStatus;
    try {
      access = await checkLocationAccess(expoLocationApi, { request });
    } catch {
      access = { kind: 'unavailable' };
    }
    if (!isCurrent()) return;
    setStatus(access);
    if (access.kind !== 'locating') return;

    let gotPosition = false;
    const timer = setTimeout(() => {
      if (isCurrent() && !gotPosition) setStatus({ kind: 'unavailable' });
    }, LOCATING_TIMEOUT_MS);
    try {
      const stop = await watchPosition(
        (position) => {
          gotPosition = true;
          if (isCurrent()) setStatus(statusForPosition(position));
        },
        () => {
          if (isCurrent()) setStatus({ kind: 'unavailable' });
        },
      );
      if (isCurrent()) {
        stopWatching.current = () => {
          clearTimeout(timer);
          stop();
        };
      } else {
        clearTimeout(timer);
        stop();
      }
    } catch {
      clearTimeout(timer);
      if (isCurrent()) setStatus({ kind: 'unavailable' });
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh(false);
    });
    return () => {
      generation.current++;
      subscription.remove();
      stopWatching.current?.();
      stopWatching.current = null;
    };
  }, [refresh]);

  const act = useCallback(
    (action: LocationAction) => {
      switch (action) {
        case 'request':
          void refresh(true);
          return;
        case 'settings':
          void openAppSettings();
          return;
        case 'enable-gps':
          askToEnableGps().then(
            () => void refresh(false),
            () => undefined,
          );
          return;
        case 'retry':
          void refresh(false);
          return;
      }
    },
    [refresh],
  );

  return { status, act };
}
