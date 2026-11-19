export const MAP_LOADING_TEXT = 'Cargando el mapa…';

/** Lo que se ve mientras llegan maplibre-gl y el mapa base (y en el HTML del servidor). */
export function MapLoading() {
  return (
    <div
      role="status"
      className="absolute inset-0 flex items-center justify-center bg-stone-100 text-sm text-stone-600"
    >
      {MAP_LOADING_TEXT}
    </div>
  );
}
