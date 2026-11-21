// Reglas de selección del destino desde el catálogo (HU-311).
import {
  type Area,
  AREA_KIND_LABELS,
  type AreaSummary,
  type LatLng,
  type Place,
  pointInPolygon,
} from '@panter/contracts';

/** El destino de un lugar es su punto de recogida o entrada si lo tiene; si no, su ubicación. */
export function placeDestinationPoint(place: Pick<Place, 'location' | 'pickupPoint'>): LatLng {
  return place.pickupPoint ?? place.location;
}

/** "Barrio Centro", "Vereda Alto Guineo". */
export function areaLabel(area: Pick<AreaSummary, 'name' | 'kind'>): string {
  return `${AREA_KIND_LABELS[area.kind]} ${area.name}`;
}

/** El punto tocado está dentro del croquis (respeta huecos). */
export function isInsideArea(point: LatLng, area: Pick<Area, 'polygon'>): boolean {
  return pointInPolygon(point, area.polygon);
}

/** Croquis como GeoJSON (anillos cerrados) para el relleno y el borde. */
export function areaFeature(
  area: Pick<Area, 'id' | 'name' | 'polygon'>,
): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    id: area.id,
    properties: { name: area.name },
    geometry: {
      type: 'Polygon',
      coordinates: area.polygon.map((ring) => {
        const coords = ring.map((p) => [p.lng, p.lat]);
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first && last && (first.lat !== last.lat || first.lng !== last.lng)) {
          coords.push([first.lng, first.lat]);
        }
        return coords;
      }),
    },
  };
}

/** Puntos para encuadrar la cámara en el barrio (el anillo exterior). */
export function areaFramePoints(area: Pick<Area, 'polygon' | 'center'>): LatLng[] {
  const outer = area.polygon[0];
  return outer && outer.length > 0 ? [...outer] : [area.center];
}

/**
 * Un punto clave tocado en el mapa (capa `panter-places`, coordenada fija del estilo) se
 * reemplaza por el lugar del catálogo con el mismo slug: su nombre y su punto de recogida o
 * ubicación real (HU-310). Si no está en el catálogo, queda como se tocó.
 */
export function resolveCatalogPoi<
  T extends { name: string; point: LatLng; placeSlug: string | null },
>(
  poi: T,
  places: readonly Pick<Place, 'slug' | 'name' | 'location' | 'pickupPoint' | 'active'>[],
): T {
  if (!poi.placeSlug) return poi;
  const place = places.find((p) => p.active && p.slug === poi.placeSlug);
  return place ? { ...poi, name: place.name, point: placeDestinationPoint(place) } : poi;
}
