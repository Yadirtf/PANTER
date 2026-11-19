import { PLACES } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { AIRPORT, PERIPHERAL } from '../server/fares-test-data';
import {
  GEOFENCE_KIND_COLOR,
  geofencesAt,
  geofencesFeatureCollection,
  midpointFeatureCollection,
  shownGeofence,
  vertexFeatureCollection,
} from './geofence-map';
import { moveVertex, toEditable } from './polygon-edit';

const shown = [shownGeofence(AIRPORT), shownGeofence(PERIPHERAL)];

describe('geocercas como GeoJSON', () => {
  it('un polígono por geocerca, con color por tipo y los huecos como anillos interiores', () => {
    const fc = geofencesFeatureCollection(shown, PERIPHERAL.id);
    expect(fc.features).toHaveLength(2);
    const [airport, peripheral] = fc.features;
    expect(airport!.properties).toMatchObject({
      kind: 'AIRPORT',
      color: GEOFENCE_KIND_COLOR.AIRPORT,
      editing: false,
    });
    expect(peripheral!.properties).toMatchObject({
      kind: 'PERIPHERAL',
      color: GEOFENCE_KIND_COLOR.PERIPHERAL,
      editing: true,
    });
    expect(GEOFENCE_KIND_COLOR.AIRPORT).not.toBe(GEOFENCE_KIND_COLOR.PERIPHERAL);
    // [lng, lat], anillos cerrados: borde exterior + hueco del casco urbano.
    expect(peripheral!.geometry.coordinates).toHaveLength(2);
    expect(peripheral!.geometry.coordinates[1]![0]).toEqual([-76.628, 1.02]);
    expect(peripheral!.geometry.coordinates[1]!.at(-1)).toEqual([-76.628, 1.02]);
  });

  it('cierra los anillos abiertos del editor', () => {
    const open = shownGeofence(AIRPORT, toEditable(AIRPORT.polygon));
    const ring = geofencesFeatureCollection([open], null).features[0]!.geometry.coordinates[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it('vértices (con el seleccionado y los del hueco) y puntos medios para editar', () => {
    const rings = toEditable(PERIPHERAL.polygon);
    const vertices = vertexFeatureCollection(rings, { ring: 1, vertex: 2 });
    expect(vertices.features).toHaveLength(8);
    expect(vertices.features.filter((f) => f.properties.selected)).toEqual([
      expect.objectContaining({ properties: { ring: 1, vertex: 2, hole: true, selected: true } }),
    ]);
    expect(midpointFeatureCollection(rings).features[0]!.properties).toEqual({ ring: 0, side: 0 });
  });
});

describe('Probar un punto', () => {
  it('el aeropuerto cubre la pista; el centro no cobra recargo (hueco del casco urbano)', () => {
    expect(geofencesAt(PLACES.AIRPORT_VGZ, shown).map((g) => g.id)).toEqual([AIRPORT.id]);
    // El parque principal está dentro del hueco de la zona periférica: sin recargo.
    expect(geofencesAt(PLACES.VILLAGARZON_CENTER, shown)).toEqual([]);
  });

  it('un punto de la zona periférica fuera del casco urbano', () => {
    expect(geofencesAt({ lat: 1.05, lng: -76.64 }, shown).map((g) => g.id)).toEqual([
      PERIPHERAL.id,
    ]);
  });

  it('usa el polígono que se está editando, no el guardado', () => {
    const point = { lat: 0.99, lng: -76.6 }; // al norte del aeropuerto
    expect(geofencesAt(point, shown)).toEqual([]);
    const grown = moveVertex(
      toEditable(AIRPORT.polygon),
      { ring: 0, vertex: 2 },
      { lat: 0.995, lng: -76.598 },
    );
    const editing = [shownGeofence(AIRPORT, grown), shownGeofence(PERIPHERAL)];
    expect(geofencesAt(point, editing).map((g) => g.id)).toEqual([AIRPORT.id]);
  });
});
