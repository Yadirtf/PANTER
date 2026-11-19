// Íconos de @panter/map-style (lugares y vehículos) como PNG en data URL, para <Images>. Se
// rasterizan una sola vez, a 3x (la densidad de la mayoría de teléfonos Android actuales).
import type { ImageEntry } from '@maplibre/maplibre-react-native';
import { ALL_ICON_IDS, iconPngDataUrl } from '@panter/map-style';

const PIXEL_RATIO = 3;

let cache: Record<string, ImageEntry> | null = null;

export function mapImages(): Record<string, ImageEntry> {
  cache ??= Object.fromEntries(
    ALL_ICON_IDS.map((id) => [
      id,
      { source: { uri: iconPngDataUrl(id, PIXEL_RATIO), scale: PIXEL_RATIO } },
    ]),
  );
  return cache;
}
