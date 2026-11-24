import { PLACES, SERVICE_AREA } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  fromGoogle,
  INITIAL_CAMERA,
  MAP_BOUNDARIES,
  mapStyleFor,
  NIGHT_STYLE,
  toGoogle,
} from './google-map';

describe('mapa de Google', () => {
  it('convierte coordenadas en los dos sentidos', () => {
    const p = PLACES.VILLAGARZON_CENTER;
    expect(toGoogle(p)).toEqual({ latitude: p.lat, longitude: p.lng });
    expect(fromGoogle(toGoogle(p))).toEqual(p);
  });

  it('cámara limitada al área de servicio y centrada en Villagarzón', () => {
    expect(MAP_BOUNDARIES.northEast).toEqual({
      latitude: SERVICE_AREA.north,
      longitude: SERVICE_AREA.east,
    });
    expect(MAP_BOUNDARIES.southWest).toEqual({
      latitude: SERVICE_AREA.south,
      longitude: SERVICE_AREA.west,
    });
    expect(INITIAL_CAMERA.center).toEqual(toGoogle(PLACES.VILLAGARZON_CENTER));
  });

  it('estilo nocturno solo con el tema oscuro', () => {
    expect(mapStyleFor('light')).toEqual([]);
    expect(mapStyleFor('dark')).toEqual(NIGHT_STYLE);
  });
});
