import { SERVICE_AREA, VehicleType, isInServiceArea } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  ALL_ICON_IDS,
  ICON_SIZE,
  iconImage,
  iconPngDataUrl,
  iconSvg,
  iconSvgDataUrl,
  MAP_ICONS,
  VEHICLE_ICON,
} from './icons';
import { KEY_PLACES, keyPlacesGeoJson } from './places';
import { encodePng, rasterize, toBase64 } from './raster';

describe('íconos', () => {
  it('hay ícono para cada tipo de vehículo de contracts', () => {
    expect(Object.keys(VEHICLE_ICON).sort()).toEqual(Object.values(VehicleType).sort());
    for (const id of Object.values(VEHICLE_ICON)) expect(MAP_ICONS[id].label).toBeTruthy();
  });

  it.each(ALL_ICON_IDS)('%s: SVG bien formado de 32×32', (id) => {
    const svg = iconSvg(id);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="32" height="32"/);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toMatch(/NaN|undefined/);
    expect(iconSvgDataUrl(id)).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  });

  it.each(ALL_ICON_IDS)(
    '%s: imagen RGBA para addImage, opaca al centro y transparente en las esquinas',
    (id) => {
      const image = iconImage(id, 2);
      expect(image.width).toBe(ICON_SIZE * 2);
      expect(image.height).toBe(ICON_SIZE * 2);
      expect(image.data.length).toBe(64 * 64 * 4);
      const alpha = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3];
      expect(alpha(32, 32)).toBe(255);
      expect(alpha(0, 0)).toBe(0);
      expect(alpha(63, 63)).toBe(0);
    },
  );

  it('el borde de la insignia es blanco y el fondo es del color del ícono', () => {
    const image = iconImage('place-airport', 1);
    const rgb = (x: number, y: number) =>
      Array.from(image.data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 3));
    expect(rgb(16, 1)).toEqual([255, 255, 255]);
    expect(rgb(5, 16)).toEqual([0x1d, 0x4e, 0xd8]);
  });

  it('PNG válido: firma, IHDR con el tamaño y IEND', () => {
    const png = encodePng(iconImage('vehicle-taxi', 3));
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(view.getUint32(16)).toBe(96);
    expect(view.getUint32(20)).toBe(96);
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
    expect(iconPngDataUrl('vehicle-taxi')).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
  });

  it('PNG con más de 64 KB de datos usa varios bloques zlib', () => {
    const big = rasterize(
      [{ kind: 'circle', cx: 100, cy: 100, r: 90, fill: '#123456' }],
      200,
      1,
      1,
    );
    const png = encodePng(big);
    expect(png.length).toBeGreaterThan(160_000);
  });

  it('toBase64 coincide con la codificación estándar', () => {
    const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
    expect(toBase64(ascii('PANTER'))).toBe('UEFOVEVS');
    expect(toBase64(ascii('Man'))).toBe('TWFu');
    expect(toBase64(Uint8Array.from([0xff, 0xfe, 0xfd, 0x00]))).toBe('//79AA==');
    expect(toBase64(new Uint8Array([1]))).toBe('AQ==');
    expect(toBase64(new Uint8Array([1, 2]))).toBe('AQI=');
    expect(toBase64(new Uint8Array())).toBe('');
  });

  it('rechaza colores que no sean #rrggbb', () => {
    expect(() => rasterize([{ kind: 'circle', cx: 1, cy: 1, r: 1, fill: 'red' }], 2, 1)).toThrow(
      /#rrggbb/,
    );
  });
});

describe('puntos clave', () => {
  it('incluye los seis lugares de la especificación §6.1', () => {
    expect(KEY_PLACES.map((p) => p.name)).toEqual([
      'Aeropuerto Cananguchal',
      'Parque principal',
      'Pozo Azul',
      'Río Guineo',
      'Cascadas de Vica',
      'Mohano',
    ]);
  });

  it('todos están dentro del área de servicio y tienen ícono de lugar', () => {
    for (const place of KEY_PLACES) {
      expect(isInServiceArea(place.position), place.id).toBe(true);
      expect(place.icon.startsWith('place-')).toBe(true);
      expect(MAP_ICONS[place.icon]).toBeDefined();
    }
    expect(SERVICE_AREA.west).toBeLessThan(-76.6);
  });

  it('los no verificados están marcados como aproximados, con su incertidumbre y fuente', () => {
    const approximate = KEY_PLACES.filter((p) => p.approximate).map((p) => p.id);
    expect(approximate).toEqual(
      expect.arrayContaining(['pozo-azul', 'rio-guineo', 'cascadas-de-vica', 'mohano']),
    );
    for (const place of KEY_PLACES) {
      expect(place.uncertaintyMeters).toBeGreaterThan(0);
      expect(place.source.length).toBeGreaterThan(10);
      // Sin precisión inventada: los aproximados tienen como mucho 3 decimales (~100 m).
      if (place.approximate && !['parque-principal'].includes(place.id)) {
        expect(String(place.position.lat).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
        expect(String(place.position.lng).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
      }
    }
  });

  it('GeoJSON en orden [lng, lat] con el flag approximate', () => {
    const geo = keyPlacesGeoJson();
    expect(geo.features[0]).toMatchObject({
      geometry: { type: 'Point', coordinates: [-76.6053, 0.9789] },
      properties: { id: 'aeropuerto-cananguchal', approximate: false, icon: 'place-airport' },
    });
    expect(new Set(geo.features.map((f) => f.id)).size).toBe(KEY_PLACES.length);
  });
});
