import { VehicleType } from '@panter/contracts';
import {
  encodePng,
  rasterize,
  toBase64,
  toSvg,
  type Point,
  type RgbaImage,
  type Shape,
} from './raster';

/**
 * Íconos propios de PANTER (§6.1): puntos clave y marcadores por tipo de vehículo. Cada ícono es
 * una insignia redonda (borde blanco, fondo de color) con una figura simple, legible a 32 px.
 * Están definidos como figuras geométricas, así que se exportan como SVG, como imagen RGBA lista
 * para `map.addImage` y como PNG en data URL para la app.
 */

export const PLACE_ICON_IDS = [
  'place-airport',
  'place-park',
  'place-pool',
  'place-river',
  'place-waterfall',
  'place-nature',
] as const;
export type PlaceIconId = (typeof PLACE_ICON_IDS)[number];

export const VEHICLE_ICON_IDS = ['vehicle-mototaxi', 'vehicle-taxi', 'vehicle-4x4'] as const;
export type VehicleIconId = (typeof VEHICLE_ICON_IDS)[number];

export type MapIconId = PlaceIconId | VehicleIconId;

/** Ícono del marcador de cada tipo de vehículo de contracts. */
export const VEHICLE_ICON: Record<VehicleType, VehicleIconId> = {
  [VehicleType.MOTOTAXI]: 'vehicle-mototaxi',
  [VehicleType.TAXI]: 'vehicle-taxi',
  [VehicleType.JEEP_4X4]: 'vehicle-4x4',
};

/** Tamaño lógico (px a pixelRatio 1) de todos los íconos. */
export const ICON_SIZE = 32;

const WHITE = '#ffffff';
const INK = '#1f2937';

const rect = (x0: number, y0: number, x1: number, y1: number, fill: string): Shape => ({
  kind: 'polygon',
  points: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ],
  fill,
});
const circle = (cx: number, cy: number, r: number, fill: string): Shape => ({
  kind: 'circle',
  cx,
  cy,
  r,
  fill,
});
const polygon = (points: Point[], fill: string): Shape => ({ kind: 'polygon', points, fill });

/** Banda ondulada (ríos, agua) entre x0 y x1, centrada en y. */
function wave(x0: number, x1: number, y: number, amplitude: number, thickness: number): Point[] {
  const top: Point[] = [];
  const bottom: Point[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const dy = Math.sin((i / steps) * Math.PI * 2) * amplitude;
    top.push([x, y + dy - thickness / 2]);
    bottom.push([x, y + dy + thickness / 2]);
  }
  return [...top, ...bottom.reverse()];
}

/** Hoja (lente entre dos arcos), inclinada 45°, con centro en (16, 15). */
function leaf(): Point[] {
  const points: Point[] = [];
  const steps = 14;
  const half = 7.5;
  const bulge = 4.2;
  const angle = -Math.PI / 4;
  const rotate = ([x, y]: Point): Point => [
    16 + x * Math.cos(angle) - y * Math.sin(angle),
    15 + x * Math.sin(angle) + y * Math.cos(angle),
  ];
  for (let i = 0; i <= steps; i++) {
    const t = -half + (2 * half * i) / steps;
    points.push(rotate([t, -bulge * (1 - (t / half) ** 2)]));
  }
  for (let i = steps - 1; i > 0; i--) {
    const t = -half + (2 * half * i) / steps;
    points.push(rotate([t, bulge * (1 - (t / half) ** 2)]));
  }
  return points;
}

/** Insignia: borde blanco y fondo del color del ícono. */
const badge = (color: string): Shape[] => [
  circle(16, 16, 15.5, WHITE),
  circle(16, 16, 13.5, color),
];

/** Rueda: llanta blanca con rin del color de fondo. */
const wheel = (cx: number, cy: number, r: number, bg: string): Shape[] => [
  circle(cx, cy, r, WHITE),
  circle(cx, cy, r * 0.4, bg),
];

export interface MapIcon {
  id: MapIconId;
  /** Nombre en español (accesibilidad y leyendas). */
  label: string;
  /** Color de fondo de la insignia. */
  color: string;
  shapes: readonly Shape[];
}

const COLORS = {
  airport: '#1d4ed8',
  park: '#1f7a3f',
  water: '#0e7490',
  nature: '#4d7c0f',
  mototaxi: '#c2410c',
  taxi: '#facc15',
  jeep: '#7c4a1e',
} as const;

export const MAP_ICONS: Record<MapIconId, MapIcon> = {
  'place-airport': {
    id: 'place-airport',
    label: 'Aeropuerto',
    color: COLORS.airport,
    shapes: [
      ...badge(COLORS.airport),
      polygon(
        [
          [16, 6],
          [17.6, 8],
          [17.6, 13],
          [25, 17.5],
          [25, 19.5],
          [17.6, 17],
          [17.6, 22],
          [20, 24],
          [20, 25.5],
          [16, 24.5],
          [12, 25.5],
          [12, 24],
          [14.4, 22],
          [14.4, 17],
          [7, 19.5],
          [7, 17.5],
          [14.4, 13],
          [14.4, 8],
        ],
        WHITE,
      ),
    ],
  },
  'place-park': {
    id: 'place-park',
    label: 'Parque',
    color: COLORS.park,
    shapes: [
      ...badge(COLORS.park),
      polygon(
        [
          [16, 6],
          [22.5, 15],
          [19.5, 15],
          [24, 21.5],
          [8, 21.5],
          [12.5, 15],
          [9.5, 15],
        ],
        WHITE,
      ),
      rect(14.75, 21.5, 17.25, 26, WHITE),
    ],
  },
  'place-pool': {
    id: 'place-pool',
    label: 'Pozo',
    color: COLORS.water,
    shapes: [
      ...badge(COLORS.water),
      polygon(
        [
          [16, 6],
          [21.4, 16.5],
          [10.6, 16.5],
        ],
        WHITE,
      ),
      circle(16, 19, 6, WHITE),
      circle(14, 19.5, 1.6, COLORS.water),
    ],
  },
  'place-river': {
    id: 'place-river',
    label: 'Río',
    color: COLORS.water,
    shapes: [
      ...badge(COLORS.water),
      polygon(wave(8, 24, 11, 1.4, 2.4), WHITE),
      polygon(wave(8, 24, 16, 1.4, 2.4), WHITE),
      polygon(wave(8, 24, 21, 1.4, 2.4), WHITE),
    ],
  },
  'place-waterfall': {
    id: 'place-waterfall',
    label: 'Cascada',
    color: COLORS.water,
    shapes: [
      ...badge(COLORS.water),
      rect(8, 7.5, 24, 10.5, WHITE),
      rect(10.5, 10.5, 12.5, 21, WHITE),
      rect(15, 10.5, 17, 22, WHITE),
      rect(19.5, 10.5, 21.5, 21, WHITE),
      polygon(wave(8, 24, 24, 1, 2.2), WHITE),
    ],
  },
  'place-nature': {
    id: 'place-nature',
    label: 'Naturaleza',
    color: COLORS.nature,
    shapes: [
      ...badge(COLORS.nature),
      polygon(leaf(), WHITE),
      polygon(
        [
          [9.5, 23.5],
          [10.6, 24.6],
          [15, 20.2],
          [13.9, 19.1],
        ],
        WHITE,
      ),
    ],
  },
  'vehicle-mototaxi': {
    id: 'vehicle-mototaxi',
    label: 'Mototaxi',
    color: COLORS.mototaxi,
    shapes: [
      ...badge(COLORS.mototaxi),
      rect(10, 8.5, 23, 10.5, WHITE),
      rect(11, 10.5, 12.5, 15, WHITE),
      rect(21.5, 10.5, 23, 15, WHITE),
      polygon(
        [
          [7.5, 20],
          [11, 15],
          [24, 15],
          [24.5, 20],
        ],
        WHITE,
      ),
      ...wheel(10.5, 21.5, 3, COLORS.mototaxi),
      ...wheel(21.5, 21.5, 3, COLORS.mototaxi),
    ],
  },
  'vehicle-taxi': {
    id: 'vehicle-taxi',
    label: 'Taxi',
    color: COLORS.taxi,
    shapes: [
      ...badge(COLORS.taxi),
      rect(14, 9, 18, 11.5, INK),
      polygon(
        [
          [6, 20.5],
          [6, 17],
          [9, 16.5],
          [12, 12.5],
          [20, 12.5],
          [23, 16.5],
          [26, 17],
          [26, 20.5],
        ],
        INK,
      ),
      polygon(
        [
          [12.8, 13.6],
          [15.5, 13.6],
          [15.5, 16.4],
          [10.8, 16.4],
        ],
        COLORS.taxi,
      ),
      polygon(
        [
          [16.5, 13.6],
          [19.2, 13.6],
          [21.2, 16.4],
          [16.5, 16.4],
        ],
        COLORS.taxi,
      ),
      circle(11, 21, 2.6, INK),
      circle(11, 21, 1, COLORS.taxi),
      circle(21, 21, 2.6, INK),
      circle(21, 21, 1, COLORS.taxi),
    ],
  },
  'vehicle-4x4': {
    id: 'vehicle-4x4',
    label: 'Campero 4x4',
    color: COLORS.jeep,
    shapes: [
      ...badge(COLORS.jeep),
      rect(8, 9.5, 20, 14, WHITE),
      rect(10, 10.8, 18.5, 14, COLORS.jeep),
      rect(6, 14, 25, 20.5, WHITE),
      rect(25, 15, 27, 19.5, WHITE),
      ...wheel(11, 21, 3.4, COLORS.jeep),
      ...wheel(20.5, 21, 3.4, COLORS.jeep),
    ],
  },
};

/** SVG del ícono (32×32). */
export function iconSvg(id: MapIconId): string {
  return toSvg(MAP_ICONS[id].shapes, ICON_SIZE);
}

/** SVG en data URL (p. ej. para un <img> o un marcador HTML en la web). */
export function iconSvgDataUrl(id: MapIconId): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(id))}`;
}

/**
 * Imagen RGBA para `map.addImage(id, image, { pixelRatio })` de maplibre-gl, sin canvas.
 * `pixelRatio` 2 o 3 en pantallas densas.
 */
export function iconImage(id: MapIconId, pixelRatio = 2): RgbaImage {
  return rasterize(MAP_ICONS[id].shapes, ICON_SIZE, pixelRatio);
}

/** PNG en data URL, para `<Images images={{ [id]: { uri } }} />` de maplibre-react-native. */
export function iconPngDataUrl(id: MapIconId, pixelRatio = 2): string {
  return `data:image/png;base64,${toBase64(encodePng(iconImage(id, pixelRatio)))}`;
}

export const ALL_ICON_IDS: readonly MapIconId[] = [...PLACE_ICON_IDS, ...VEHICLE_ICON_IDS];
