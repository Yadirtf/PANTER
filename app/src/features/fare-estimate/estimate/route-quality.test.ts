import {
  encodePolyline,
  type LatLng,
  PLACES,
  type RouteQuality,
  routeQuality,
  SNAP_WARNING_METERS,
} from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { makePlace } from '../../catalog/test-helpers';
import { makeEstimate } from '../test-helpers';
import {
  initialPlannerState,
  pendingRequest,
  type PlannerAction,
  plannerReducer,
  plannerRouteNotices,
  type PlannerState,
} from './planner';
import { formatRatio, formatSnapDistance, routeNotices } from './route-quality';

const ORIGIN = PLACES.VILLAGARZON_CENTER;
const DESTINATION = PLACES.AIRPORT_VGZ;
/** Donde ORS empezó y terminó la ruta (ajustados a la vía). */
const ROAD_START = { lat: 1.0301, lng: -76.6172 };
const ROAD_END = { lat: 0.9795, lng: -76.6049 };
const ROUTE: LatLng[] = [ROAD_START, { lat: 1.005, lng: -76.61 }, ROAD_END];

function quality(overrides: Partial<RouteQuality> = {}): RouteQuality {
  return {
    originSnapMeters: 8,
    destinationSnapMeters: 12,
    detourRatio: 1.3,
    unusual: false,
    alternatives: 3,
    ...overrides,
  };
}

const notices = (q: RouteQuality | undefined, route: LatLng[] = ROUTE) =>
  routeNotices({ quality: q, route, origin: ORIGIN, destination: DESTINATION });

describe('routeNotices (HU-307)', () => {
  it('sin quality (API anterior) no hay avisos', () => {
    expect(notices(undefined)).toEqual({ snaps: [], unusual: null });
  });

  it('ruta normal y pines sobre la vía: sin avisos', () => {
    expect(notices(quality())).toEqual({ snaps: [], unusual: null });
  });

  it(`avisa solo si el ajuste supera ${SNAP_WARNING_METERS} m (50 exactos no)`, () => {
    expect(notices(quality({ originSnapMeters: 50 })).snaps).toEqual([]);
    const { snaps } = notices(quality({ originSnapMeters: 50.4 }));
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ end: 'origin', meters: 50 });
  });

  it('origen lejos de la vía: mensaje y punto donde empieza la ruta', () => {
    const { snaps } = notices(quality({ originSnapMeters: 140 }));
    expect(snaps).toEqual([
      {
        end: 'origin',
        meters: 140,
        roadPoint: ROAD_START,
        message: 'Tu punto de recogida queda a 140 m de la vía más cercana',
      },
    ]);
  });

  it('destino lejos de la vía: mensaje y punto donde termina la ruta', () => {
    const { snaps } = notices(quality({ destinationSnapMeters: 1480 }));
    expect(snaps).toEqual([
      {
        end: 'destination',
        meters: 1480,
        roadPoint: ROAD_END,
        message: 'Tu destino queda a 1,5 km de la vía más cercana',
      },
    ]);
  });

  it('los dos lejos: dos avisos, primero el origen', () => {
    const { snaps } = notices(quality({ originSnapMeters: 90, destinationSnapMeters: 300 }));
    expect(snaps.map((s) => s.end)).toEqual(['origin', 'destination']);
  });

  it('sin polilínea no hay punto de la vía al que mover el pin', () => {
    const { snaps } = notices(quality({ originSnapMeters: 90 }), []);
    expect(snaps[0]?.roadPoint).toBeNull();
  });

  it('ruta inusual: mensaje con el factor y la línea recta origen → destino', () => {
    const q = routeQuality({
      routeMeters: 20_300,
      straightMeters: 6_000,
      originSnapMeters: 5,
      destinationSnapMeters: 5,
      alternatives: 3,
    });
    expect(q.unusual).toBe(true);
    const { unusual } = notices(q);
    expect(unusual).toEqual({
      detourRatio: 3.38,
      message:
        'Esta ruta es más larga de lo normal (3,4 veces la distancia en línea recta). Revisa el punto de recogida o el destino.',
      straightLine: [ORIGIN, DESTINATION],
    });
  });

  it('un factor alto en menos de 1 km no es inusual (lo decide la API)', () => {
    const q = routeQuality({
      routeMeters: 900,
      straightMeters: 200,
      originSnapMeters: 0,
      destinationSnapMeters: 0,
      alternatives: 1,
    });
    expect(notices(q).unusual).toBeNull();
  });

  it('formatos en español', () => {
    expect(formatSnapDistance(52.6)).toBe('53 m');
    expect(formatSnapDistance(2000)).toBe('2 km');
    expect(formatRatio(2.96)).toBe('3');
    expect(formatRatio(2.64)).toBe('2,6');
  });
});

describe('avisos en el flujo del estimado', () => {
  const airport = makePlace();
  const run = (...actions: PlannerAction[]) =>
    actions.reduce<PlannerState>(plannerReducer, initialPlannerState());

  function succeed(state: PlannerState, q: RouteQuality | undefined, route = ROUTE): PlannerState {
    const pending = pendingRequest(state)!;
    const base = makeEstimate();
    return plannerReducer(state, {
      type: 'estimateSucceeded',
      requestId: pending.requestId,
      estimate: makeEstimate({
        route: { ...base.route, polyline: encodePolyline(route), quality: q },
      }),
    });
  }

  it('sin quality el estimado se muestra como antes', () => {
    const state = succeed(run({ type: 'placeSelected', place: airport }), undefined);
    expect(state.quote.status).toBe('ready');
    expect(plannerRouteNotices(state)).toEqual({ snaps: [], unusual: null });
  });

  it('sin cotización lista no hay avisos', () => {
    expect(plannerRouteNotices(run({ type: 'placeSelected', place: airport }))).toEqual({
      snaps: [],
      unusual: null,
    });
  });

  it('"Mover el pin a la vía" lleva el origen al inicio de la ruta y vuelve a cotizar', () => {
    let state = succeed(
      run({ type: 'placeSelected', place: airport }),
      quality({ originSnapMeters: 120 }),
    );
    expect(plannerRouteNotices(state).snaps.map((s) => s.end)).toEqual(['origin']);

    state = plannerReducer(state, { type: 'snapPinMoved', end: 'origin' });
    expect(state.origin).toEqual({ point: ROAD_START, source: 'manual' });
    expect(pendingRequest(state)?.body).toMatchObject({
      origin: ROAD_START,
      destination: DESTINATION,
    });

    // La nueva ruta sale de la vía: el aviso desaparece.
    state = succeed(state, quality({ originSnapMeters: 0 }));
    expect(plannerRouteNotices(state).snaps).toEqual([]);
  });

  it('"Mover el pin a la vía" del destino conserva el nombre del lugar', () => {
    let state = succeed(
      run({ type: 'placeSelected', place: airport }),
      quality({ destinationSnapMeters: 400 }),
    );
    state = plannerReducer(state, { type: 'snapPinMoved', end: 'destination' });
    expect(state.destination).toMatchObject({ point: ROAD_END, name: 'Aeropuerto Cananguchal' });
    expect(pendingRequest(state)?.body.destination).toEqual(ROAD_END);
  });

  it('sin punto de la vía, "mover" no hace nada', () => {
    const state = succeed(
      run({ type: 'placeSelected', place: airport }),
      quality({ originSnapMeters: 120 }),
      [],
    );
    expect(plannerReducer(state, { type: 'snapPinMoved', end: 'origin' })).toBe(state);
  });

  it('"Está bien así" oculta el aviso de ese pin, también al renovar el precio', () => {
    const far = quality({ originSnapMeters: 120, destinationSnapMeters: 200 });
    let state = succeed(run({ type: 'placeSelected', place: airport }), far);
    state = plannerReducer(state, { type: 'snapAccepted', end: 'origin' });
    expect(plannerRouteNotices(state).snaps.map((s) => s.end)).toEqual(['destination']);
    expect(pendingRequest(state)).toBeNull();

    // Otro vehículo: mismos pines, el aviso aceptado sigue oculto.
    state = succeed(plannerReducer(state, { type: 'vehicleSelected', vehicle: 'TAXI' }), far);
    expect(plannerRouteNotices(state).snaps.map((s) => s.end)).toEqual(['destination']);

    // Si arrastra el pin a otro punto lejano, vuelve a avisar.
    state = succeed(
      plannerReducer(state, { type: 'originDragged', point: { lat: 1.04, lng: -76.63 } }),
      far,
    );
    expect(plannerRouteNotices(state).snaps.map((s) => s.end)).toEqual(['origin', 'destination']);
  });

  it('cambiar destino olvida los avisos aceptados', () => {
    let state = succeed(
      run({ type: 'placeSelected', place: airport }),
      quality({ originSnapMeters: 120 }),
    );
    state = plannerReducer(state, { type: 'snapAccepted', end: 'origin' });
    state = plannerReducer(state, { type: 'destinationCleared' });
    expect(state.acceptedSnaps).toEqual({ origin: null, destination: null });
  });

  it('ruta inusual: aviso con la línea recta entre los pines del pasajero', () => {
    const state = succeed(
      run({ type: 'placeSelected', place: airport }),
      quality({ unusual: true, detourRatio: 3.38 }),
    );
    expect(plannerRouteNotices(state).unusual?.straightLine).toEqual([ORIGIN, DESTINATION]);
  });
});
