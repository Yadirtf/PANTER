// Descripción "Barrio X · cerca de Y" de un punto que puede cambiar seguido (pin arrastrado, GPS).
import type { LatLng } from '@panter/contracts';
import { useEffect, useMemo, useState } from 'react';
import {
  createDescriptionRequester,
  describeKey,
  type LocationDescription,
} from '../describe/location-describer';
import { locationDescriber } from '../instance';

export function useLocationDescription(point: LatLng | null): LocationDescription | null {
  const [result, setResult] = useState<{ key: string; description: LocationDescription } | null>(
    null,
  );
  const requester = useMemo(
    () =>
      createDescriptionRequester(locationDescriber, (described, description) =>
        setResult({ key: describeKey(described), description }),
      ),
    [],
  );
  const key = point ? describeKey(point) : null;

  useEffect(() => {
    requester.request(point);
    // Solo cuando cambia la coordenada redondeada (no en cada render ni por micro-movimientos).
  }, [key]);
  useEffect(() => () => requester.cancel(), [requester]);

  // Mientras llega la del punto nuevo no se muestra la del anterior.
  return result && result.key === key ? result.description : null;
}
