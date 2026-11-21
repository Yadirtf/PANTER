import { PLACES } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { makePlace } from '../../catalog/test-helpers';
import { makeEstimate } from '../test-helpers';
import {
  initialPlannerState,
  pendingRequest,
  type PlannerAction,
  plannerReducer,
  type PlannerState,
  plannerStep,
} from './planner';

const GPS = { lat: 1.031, lng: -76.618 };
const TAP = { lat: 1.02, lng: -76.61 };
const airport = makePlace();

const run = (...actions: PlannerAction[]) =>
  actions.reduce<PlannerState>(plannerReducer, initialPlannerState());

/** Responde la petición pendiente con éxito. */
function succeed(state: PlannerState, total = 19_500): PlannerState {
  const pending = pendingRequest(state)!;
  return plannerReducer(state, {
    type: 'estimateSucceeded',
    requestId: pending.requestId,
    estimate: makeEstimate({ total }),
  });
}

describe('flujo del estimado', () => {
  it('arranca eligiendo destino, con origen por defecto en el centro de Villagarzón', () => {
    const state = initialPlannerState();
    expect(plannerStep(state)).toBe('choose-destination');
    expect(state.origin).toEqual({ point: PLACES.VILLAGARZON_CENTER, source: 'default' });
    expect(state.vehicle).toBe('MOTOTAXI');
    expect(pendingRequest(state)).toBeNull();
  });

  it('el GPS fija el origen; fuera del área no', () => {
    expect(run({ type: 'userLocated', point: GPS }).origin).toEqual({ point: GPS, source: 'gps' });
    expect(run({ type: 'userLocated', point: { lat: 4.71, lng: -74.07 } }).origin.source).toBe(
      'default',
    );
  });

  it('tocar el mapa pone un pin que hay que confirmar; luego se cotiza', () => {
    let state = run({ type: 'userLocated', point: GPS }, { type: 'mapPressed', point: TAP });
    expect(plannerStep(state)).toBe('confirm-destination');
    expect(pendingRequest(state)).toBeNull();

    state = plannerReducer(state, { type: 'candidateConfirmed' });
    expect(plannerStep(state)).toBe('quote');
    expect(state.destination).toEqual({ point: TAP, name: null, placeId: null });
    expect(pendingRequest(state)).toEqual({
      requestId: 1,
      body: { origin: GPS, destination: TAP, vehicleType: 'MOTOTAXI' },
    });
  });

  it('cancelar el pin vuelve a elegir destino', () => {
    const state = run({ type: 'mapPressed', point: TAP }, { type: 'candidateCancelled' });
    expect(plannerStep(state)).toBe('choose-destination');
  });

  it('un lugar del catálogo se cotiza de inmediato con su nombre', () => {
    const state = run({ type: 'placeSelected', place: airport });
    expect(state.destination).toMatchObject({ name: 'Aeropuerto Cananguchal' });
    expect(pendingRequest(state)?.body.destination).toEqual(PLACES.AIRPORT_VGZ);
  });

  it('respuesta lista: decodifica la ruta de la polilínea', () => {
    const state = succeed(run({ type: 'placeSelected', place: airport }));
    expect(state.quote.status).toBe('ready');
    if (state.quote.status !== 'ready') return;
    expect(state.quote.route).toHaveLength(2);
    expect(state.quote.route[1]).toEqual(PLACES.AIRPORT_VGZ);
    expect(state.quote.updatedFrom).toBeNull();
  });

  it('cambiar de vehículo o arrastrar el origen vuelve a cotizar', () => {
    let state = succeed(run({ type: 'placeSelected', place: airport }));
    state = plannerReducer(state, { type: 'vehicleSelected', vehicle: 'TAXI' });
    expect(pendingRequest(state)?.body.vehicleType).toBe('TAXI');

    state = succeed(state);
    const dragged = { lat: 1.025, lng: -76.62 };
    state = plannerReducer(state, { type: 'originDragged', point: dragged });
    expect(state.origin).toEqual({ point: dragged, source: 'manual' });
    expect(pendingRequest(state)?.body.origin).toEqual(dragged);
  });

  it('las lecturas del GPS no mueven un origen arrastrado ni disparan otra consulta', () => {
    let state = run({ type: 'originDragged', point: TAP }, { type: 'userLocated', point: GPS });
    expect(state.origin.source).toBe('manual');
    state = succeed(run({ type: 'placeSelected', place: airport }));
    const after = plannerReducer(state, { type: 'userLocated', point: GPS });
    expect(after).toBe(state);
  });

  it('descarta la respuesta de una petición reemplazada', () => {
    let state = run({ type: 'placeSelected', place: airport });
    const first = pendingRequest(state)!.requestId;
    state = plannerReducer(state, { type: 'vehicleSelected', vehicle: 'TAXI' });
    const stale = plannerReducer(state, {
      type: 'estimateSucceeded',
      requestId: first,
      estimate: makeEstimate(),
    });
    expect(stale.quote.status).toBe('loading');
    expect(
      plannerReducer(state, { type: 'estimateFailed', requestId: first, code: 'ROUTE_NOT_FOUND' })
        .quote.status,
    ).toBe('loading');
  });

  it('cambiar destino limpia la cotización', () => {
    const state = plannerReducer(succeed(run({ type: 'placeSelected', place: airport })), {
      type: 'destinationCleared',
    });
    expect(plannerStep(state)).toBe('choose-destination');
    expect(state.quote).toEqual({ status: 'none' });
  });
});

describe('vencimiento de la cotización', () => {
  it('al vencer se renueva sola una vez y avisa "precio actualizado" con el total anterior', () => {
    let state = succeed(run({ type: 'placeSelected', place: airport }), 19_500);
    state = plannerReducer(state, { type: 'quoteExpired' });
    expect(state.quote).toMatchObject({ status: 'loading', renewal: true });
    state = succeed(state, 21_000);
    expect(state.quote).toMatchObject({ status: 'ready', updatedFrom: 19_500 });
  });

  it('la segunda vez queda vencida hasta que el pasajero la actualice', () => {
    let state = succeed(run({ type: 'placeSelected', place: airport }));
    state = succeed(plannerReducer(state, { type: 'quoteExpired' }));
    state = plannerReducer(state, { type: 'quoteExpired' });
    expect(state.quote.status).toBe('expired');
    expect(pendingRequest(state)).toBeNull();

    state = plannerReducer(state, { type: 'retry' });
    expect(state.quote).toMatchObject({ status: 'loading', renewal: false });
    state = succeed(state, 19_500);
    expect(state.quote).toMatchObject({ status: 'ready', updatedFrom: 19_500 });
  });

  it('una selección nueva vuelve a permitir la renovación automática', () => {
    let state = succeed(run({ type: 'placeSelected', place: airport }));
    state = succeed(plannerReducer(state, { type: 'quoteExpired' }));
    state = succeed(plannerReducer(state, { type: 'vehicleSelected', vehicle: 'TAXI' }));
    state = plannerReducer(state, { type: 'quoteExpired' });
    expect(state.quote.status).toBe('loading');
  });
});

describe('errores del estimado', () => {
  const fail = (code: string, vehicle: 'MOTOTAXI' | 'TAXI' = 'MOTOTAXI') => {
    let state = run({ type: 'placeSelected', place: airport });
    if (vehicle !== state.vehicle)
      state = plannerReducer(state, { type: 'vehicleSelected', vehicle });
    const { requestId } = pendingRequest(state)!;
    return plannerReducer(state, { type: 'estimateFailed', requestId, code });
  };

  it('ROUTING_UNAVAILABLE: estado claro con reintento y sin precio', () => {
    const state = fail('ROUTING_UNAVAILABLE');
    expect(state.quote).toMatchObject({
      status: 'error',
      error: { code: 'ROUTING_UNAVAILABLE', title: 'No pudimos calcular la ruta', action: 'retry' },
    });
    const retried = plannerReducer(state, { type: 'retry' });
    expect(pendingRequest(retried)?.body.destination).toEqual(PLACES.AIRPORT_VGZ);
  });

  it('OUT_OF_SERVICE_AREA y ROUTE_NOT_FOUND piden otro punto', () => {
    expect(fail('OUT_OF_SERVICE_AREA').quote).toMatchObject({
      error: { title: 'Fuera de la zona de servicio', action: 'change-destination' },
    });
    expect(fail('ROUTE_NOT_FOUND').quote).toMatchObject({
      error: { title: 'No hay ruta por carretera', action: 'change-destination' },
    });
  });

  it('FARE_RULE_NOT_FOUND nombra el vehículo y sugiere otro', () => {
    const state = fail('FARE_RULE_NOT_FOUND', 'TAXI');
    expect(state.quote).toMatchObject({
      error: { title: 'Tarifa no disponible', action: 'change-vehicle' },
    });
    if (state.quote.status === 'error') expect(state.quote.error.message).toContain('taxi');
  });

  it('sin red: mensaje de conexión y reintento', () => {
    expect(fail('NETWORK_ERROR').quote).toMatchObject({
      error: { title: 'Sin conexión', action: 'retry' },
    });
  });
});
