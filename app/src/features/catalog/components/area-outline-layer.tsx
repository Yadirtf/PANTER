// Croquis del barrio o vereda elegido sobre <PanterMap>: relleno suave y borde.
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { Area } from '@panter/contracts';
import { useMemo } from 'react';
import { areaFeature } from '../selection';

const AREA_COLOR = '#7c3aed';

export function AreaOutlineLayer({ area, warning }: { area: Area; warning: boolean }) {
  const feature = useMemo(() => areaFeature(area), [area]);
  return (
    <GeoJSONSource id="destination-area" data={feature}>
      <Layer
        id="destination-area-fill"
        type="fill"
        paint={{ 'fill-color': AREA_COLOR, 'fill-opacity': 0.12 }}
      />
      <Layer
        id="destination-area-line"
        type="line"
        layout={{ 'line-join': 'round' }}
        paint={{
          'line-color': warning ? '#b42318' : AREA_COLOR,
          'line-width': 3,
          'line-opacity': 0.9,
        }}
      />
    </GeoJSONSource>
  );
}
