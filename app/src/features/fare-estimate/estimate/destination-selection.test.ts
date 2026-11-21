// Selección del destino por lugar, barrio o establecimiento del mapa (HU-311) en el flujo del
// estimado, con los avisos de HU-307.
import { encodePolyline } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { CENTRO_CENTER, makeArea, makePlace } from '../../catalog/test-helpers';
import { makeEstimate } from '../test-helpers';
import {
  initialPlannerState,
  pendingRequest,
  type PlannerAction,
  plannerReducer,
  plannerRouteNotices,
  type PlannerState,
  plannerStep,
} from './planner';

const run = (...actions: PlannerAction[]) =>
  actions.reduce<PlannerState>(plannerReducer, initialPlannerState());

const centro = makeArea();
const INSIDE = { lat: 1.0302, lng: -76.6158 };
const OUTSIDE = { lat: 1.04, lng: -76.6165 };

describe('destino por lugar del catálogo', () => {
  it('con punto de recogida: se cotiza hasta la entrada, con el nombre del lugar', () => {
    const pickupPoint = { lat: 0.9801, lng: -76.6047 };
    const state = run({ type: 'placeSelected', place: makePlace({ pickupPoint }) });
    expect(state.destination).toEqual({
      point: pickupPoint,
      name: 'Aeropuerto Cananguchal',
      placeId: makePlace().id,
    });
    expect(pendingRequest(state)?.body.destination).toEqual(pickupPoint);
  });

  it('sin punto de recogida: su ubicación', () => {
    const state = run({ type: 'placeSelected', place: makePlace() });
    expect(state.destination?.point).toEqual(makePlace().location);
  });
});

describe('destino por establecimiento del mapa base', () => {
  const poi = {
    name: 'Droguería La Económica',
    point: { lat: 1.0291, lng: -76.6159 },
    kind: null,
    placeSlug: null,
  };

  it('tocar un POI con nombre lo propone como destino en su posición, con su nombre', () => {
    let state = run({ type: 'mapPressed', point: { lat: 1.029, lng: -76.616 }, poi });
    expect(plannerStep(state)).toBe('confirm-destination');
    expect(state.candidate).toEqual({ point: poi.point, name: 'Droguería La Económica' });
    state = plannerReducer(state, { type: 'candidateConfirmed' });
    expect(state.destination).toEqual({ point: poi.point, name: poi.name, placeId: null });
    expect(pendingRequest(state)?.body.destination).toEqual(poi.point);
  });

  it('un toque sin POI es un punto sin nombre', () => {
    const state = run({ type: 'mapPressed', point: INSIDE, poi: null });
    expect(state.candidate).toEqual({ point: INSIDE, name: null });
  });
});

describe('destino por barrio o vereda', () => {
  it('elegir el barrio pide el punto exacto dentro del croquis', () => {
    const state = run({ type: 'areaChosen', area: centro });
    expect(plannerStep(state)).toBe('pick-in-area');
    expect(state.areaPick).toEqual({ area: centro, outside: false });
    expect(pendingRequest(state)).toBeNull();
  });

  it('un toque fuera del croquis avisa y no pone el pin', () => {
    const state = run({ type: 'areaChosen', area: centro }, { type: 'mapPressed', point: OUTSIDE });
    expect(state.areaPick?.outside).toBe(true);
    expect(state.candidate).toBeNull();
    expect(plannerStep(state)).toBe('pick-in-area');
  });

  it('un toque dentro propone el destino con el nombre del barrio; confirmar cotiza', () => {
    let state = run(
      { type: 'areaChosen', area: centro },
      { type: 'mapPressed', point: OUTSIDE },
      { type: 'mapPressed', point: INSIDE },
    );
    expect(state.areaPick?.outside).toBe(false);
    expect(state.candidate).toEqual({ point: INSIDE, name: 'Barrio Centro' });
    state = plannerReducer(state, { type: 'candidateConfirmed' });
    expect(state.areaPick).toBeNull();
    expect(state.destination).toEqual({ point: INSIDE, name: 'Barrio Centro', placeId: null });
    expect(pendingRequest(state)?.body.destination).toEqual(INSIDE);
  });

  it('un establecimiento dentro del barrio conserva su nombre; uno fuera no', () => {
    const inside = {
      name: 'Panadería El Trigal',
      point: CENTRO_CENTER,
      kind: 'bakery',
      placeSlug: null,
    };
    const state = run(
      { type: 'areaChosen', area: centro },
      { type: 'mapPressed', point: INSIDE, poi: inside },
    );
    expect(state.candidate).toEqual({ point: CENTRO_CENTER, name: 'Panadería El Trigal' });
    const outside = { name: 'Lejos', point: OUTSIDE, kind: null, placeSlug: null };
    expect(
      run({ type: 'areaChosen', area: centro }, { type: 'mapPressed', point: INSIDE, poi: outside })
        .candidate,
    ).toEqual({ point: INSIDE, name: 'Barrio Centro' });
  });

  it('cancelar el pin deja el croquis para tocar otra vez; "otro barrio" lo quita', () => {
    let state = run(
      { type: 'areaChosen', area: centro },
      { type: 'mapPressed', point: INSIDE },
      { type: 'candidateCancelled' },
    );
    expect(plannerStep(state)).toBe('pick-in-area');
    state = plannerReducer(state, { type: 'areaPickCancelled' });
    expect(plannerStep(state)).toBe('choose-destination');
  });

  it('elegir un lugar mientras se ubica en el barrio reemplaza el croquis', () => {
    const state = run(
      { type: 'areaChosen', area: centro },
      { type: 'placeSelected', place: makePlace() },
    );
    expect(state.areaPick).toBeNull();
    expect(plannerStep(state)).toBe('quote');
  });

  it('con los avisos de HU-307: mover el destino a la vía conserva el nombre del barrio', () => {
    let state = run(
      { type: 'areaChosen', area: centro },
      { type: 'mapPressed', point: INSIDE },
      { type: 'candidateConfirmed' },
    );
    const road = { lat: 1.0299, lng: -76.6158 };
    const base = makeEstimate();
    state = plannerReducer(state, {
      type: 'estimateSucceeded',
      requestId: pendingRequest(state)!.requestId,
      estimate: makeEstimate({
        route: {
          ...base.route,
          polyline: encodePolyline([state.origin.point, road]),
          quality: {
            originSnapMeters: 3,
            destinationSnapMeters: 85,
            detourRatio: 1.2,
            unusual: false,
            alternatives: 2,
          },
        },
      }),
    });
    expect(plannerRouteNotices(state).snaps[0]?.message).toBe(
      'Tu destino queda a 85 m de la vía más cercana',
    );
    state = plannerReducer(state, { type: 'snapPinMoved', end: 'destination' });
    expect(state.destination).toMatchObject({ point: road, name: 'Barrio Centro' });
  });
});
