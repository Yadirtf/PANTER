// Croquis del barrio o vereda elegido sobre <PanterMap>: relleno suave y borde.
import type { Area } from '@panter/contracts';
import { useMemo } from 'react';
import { Polygon } from 'react-native-maps';
import { toGoogle } from '../../map/google-map';

const AREA_COLOR = '#7c3aed';
const AREA_FILL = 'rgba(124, 58, 237, 0.12)';
const WARNING_COLOR = '#b42318';

export function AreaOutlineLayer({ area, warning }: { area: Area; warning: boolean }) {
  const [outer, holes] = useMemo(() => {
    const rings = area.polygon.map((ring) => ring.map(toGoogle));
    return [rings[0] ?? [], rings.slice(1)] as const;
  }, [area]);
  if (outer.length < 3) return null;
  return (
    <Polygon
      coordinates={outer}
      holes={holes}
      fillColor={AREA_FILL}
      strokeColor={warning ? WARNING_COLOR : AREA_COLOR}
      strokeWidth={3}
      lineJoin="round"
    />
  );
}
