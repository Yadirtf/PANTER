// Flujo de selección del pasajero (HU-404) como reducer puro:
// origen (GPS o pin arrastrado) → destino (toque + "Confirmar destino", o lugar frecuente) →
// vehículo → POST /fares/estimate → precio con vigencia, o error en español.
import {
  decodePolyline,
  type FareEstimateBody,
  type FareEstimateResponse,
  isInServiceArea,
  type LatLng,
  PLACES,
  VehicleType,
} from '@panter/contracts';
import type { FrequentPlace } from '../places/frequent-places';
import { estimateErrorView, type EstimateErrorView } from './estimate-errors';
import {
  type AcceptedSnaps,
  NO_ACCEPTED_SNAPS,
  NO_NOTICES,
  type RouteEnd,
  type RouteNotices,
  routeNotices,
} from './route-quality';

/** Vehículos que se pueden cotizar hoy; el 4x4 aparece como "Próximamente". */
export const QUOTABLE_VEHICLES = [VehicleType.MOTOTAXI, VehicleType.TAXI] as const;
export type QuotableVehicle = (typeof QUOTABLE_VEHICLES)[number];

export interface Origin {
  point: LatLng;
  /** gps: ubicación actual; manual: pin arrastrado; default: centro de Villagarzón sin GPS. */
  source: 'gps' | 'manual' | 'default';
}

export interface Destination {
  point: LatLng;
  /** Nombre del lugar frecuente, o `null` si se eligió tocando el mapa. */
  name: string | null;
  placeId: string | null;
}

export type QuoteState =
  | { status: 'none' }
  | {
      status: 'loading';
      requestId: number;
      body: FareEstimateBody;
      /** Cotización anterior que se está renovando (al vencer o al reintentar). */
      previous: FareEstimateResponse | null;
      /** Es la renovación automática al vencer. */
      renewal: boolean;
    }
  | {
      status: 'ready';
      estimate: FareEstimateResponse;
      route: LatLng[];
      /** Total anterior si este precio reemplaza a uno vencido ("Precio actualizado"). */
      updatedFrom: number | null;
    }
  /** Venció y ya se usó la renovación automática: se ofrece "Actualizar precio". */
  | { status: 'expired'; estimate: FareEstimateResponse; route: LatLng[] }
  | { status: 'error'; error: EstimateErrorView };

export interface PlannerState {
  origin: Origin;
  /** Pin tocado en el mapa, pendiente de "Confirmar destino". */
  candidate: LatLng | null;
  destination: Destination | null;
  vehicle: QuotableVehicle;
  quote: QuoteState;
  nextRequestId: number;
  /** Ya se renovó sola una vez la cotización de esta selección (cuida la cuota de rutas). */
  autoRenewed: boolean;
  /** Pines que el pasajero dejó "así" pese al aviso de ajuste a la vía (HU-307). */
  acceptedSnaps: AcceptedSnaps;
}

export type PlannerAction =
  | { type: 'userLocated'; point: LatLng }
  | { type: 'originDragged'; point: LatLng }
  | { type: 'mapPressed'; point: LatLng }
  | { type: 'candidateConfirmed' }
  | { type: 'candidateCancelled' }
  | { type: 'placeSelected'; place: FrequentPlace }
  | { type: 'vehicleSelected'; vehicle: QuotableVehicle }
  | { type: 'retry' }
  | { type: 'quoteExpired' }
  | { type: 'estimateSucceeded'; requestId: number; estimate: FareEstimateResponse }
  | { type: 'estimateFailed'; requestId: number; code: string }
  | { type: 'destinationCleared' }
  /** "Está bien así": oculta el aviso de ajuste a la vía de ese pin (HU-307). */
  | { type: 'snapAccepted'; end: RouteEnd }
  /** "Mover el pin a la vía": lleva el pin al inicio o fin de la ruta y vuelve a cotizar. */
  | { type: 'snapPinMoved'; end: RouteEnd };

export function initialPlannerState(): PlannerState {
  return {
    origin: { point: PLACES.VILLAGARZON_CENTER, source: 'default' },
    candidate: null,
    destination: null,
    vehicle: VehicleType.MOTOTAXI,
    quote: { status: 'none' },
    nextRequestId: 1,
    autoRenewed: false,
    acceptedSnaps: NO_ACCEPTED_SNAPS,
  };
}

function currentEstimate(quote: QuoteState): FareEstimateResponse | null {
  if (quote.status === 'ready' || quote.status === 'expired') return quote.estimate;
  if (quote.status === 'loading') return quote.previous;
  return null;
}

/** Pide una cotización nueva con el origen, destino y vehículo del estado. */
function requestQuote(
  state: PlannerState,
  { renewal = false, keepPrevious = false } = {},
): PlannerState {
  if (!state.destination) return { ...state, quote: { status: 'none' } };
  const body: FareEstimateBody = {
    origin: state.origin.point,
    destination: state.destination.point,
    vehicleType: state.vehicle,
  };
  return {
    ...state,
    nextRequestId: state.nextRequestId + 1,
    quote: {
      status: 'loading',
      requestId: state.nextRequestId,
      body,
      previous: keepPrevious ? currentEstimate(state.quote) : null,
      renewal,
    },
  };
}

export function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case 'userLocated': {
      // El GPS solo fija el origen si el pasajero no movió el pin y aún no hay cotización
      // (cada lectura no debe disparar otra consulta de ruta). Fuera del área no sirve de origen.
      if (state.origin.source === 'manual' || !isInServiceArea(action.point)) return state;
      if (state.quote.status !== 'none') return state;
      return { ...state, origin: { point: action.point, source: 'gps' } };
    }
    case 'originDragged': {
      const next = { ...state, origin: { point: action.point, source: 'manual' as const } };
      return next.destination ? requestQuote({ ...next, autoRenewed: false }) : next;
    }
    case 'mapPressed':
      return { ...state, candidate: action.point };
    case 'candidateCancelled':
      return { ...state, candidate: null };
    case 'candidateConfirmed': {
      if (!state.candidate) return state;
      return requestQuote({
        ...state,
        candidate: null,
        destination: { point: state.candidate, name: null, placeId: null },
        autoRenewed: false,
      });
    }
    case 'placeSelected':
      return requestQuote({
        ...state,
        candidate: null,
        destination: {
          point: action.place.position,
          name: action.place.name,
          placeId: action.place.id,
        },
        autoRenewed: false,
      });
    case 'vehicleSelected': {
      if (action.vehicle === state.vehicle) return state;
      return requestQuote({ ...state, vehicle: action.vehicle, autoRenewed: false });
    }
    case 'retry':
      return requestQuote(state, { keepPrevious: true });
    case 'quoteExpired': {
      if (state.quote.status !== 'ready') return state;
      if (state.autoRenewed) {
        return {
          ...state,
          quote: { status: 'expired', estimate: state.quote.estimate, route: state.quote.route },
        };
      }
      return requestQuote({ ...state, autoRenewed: true }, { renewal: true, keepPrevious: true });
    }
    case 'estimateSucceeded': {
      const { quote } = state;
      if (quote.status !== 'loading' || quote.requestId !== action.requestId) return state;
      return {
        ...state,
        quote: {
          status: 'ready',
          estimate: action.estimate,
          route: decodeRoute(action.estimate.route.polyline),
          updatedFrom: quote.previous ? quote.previous.total : null,
        },
      };
    }
    case 'estimateFailed': {
      const { quote } = state;
      if (quote.status !== 'loading' || quote.requestId !== action.requestId) return state;
      return {
        ...state,
        quote: { status: 'error', error: estimateErrorView(action.code, state.vehicle) },
      };
    }
    case 'destinationCleared':
      return {
        ...state,
        candidate: null,
        destination: null,
        quote: { status: 'none' },
        autoRenewed: false,
        acceptedSnaps: NO_ACCEPTED_SNAPS,
      };
    case 'snapAccepted': {
      const pin = action.end === 'origin' ? state.origin.point : state.destination?.point;
      if (!pin) return state;
      return { ...state, acceptedSnaps: { ...state.acceptedSnaps, [action.end]: pin } };
    }
    case 'snapPinMoved': {
      const notice = plannerRouteNotices(state).snaps.find((n) => n.end === action.end);
      const road = notice?.roadPoint;
      if (!road || !state.destination) return state;
      const next: PlannerState =
        action.end === 'origin'
          ? { ...state, origin: { point: road, source: 'manual' } }
          : { ...state, destination: { ...state.destination, point: road } };
      return requestQuote({ ...next, autoRenewed: false });
    }
  }
}

/** Avisos de ajuste a la vía y de ruta inusual de la cotización visible (HU-307). */
export function plannerRouteNotices(state: PlannerState): RouteNotices {
  const { quote, destination } = state;
  if ((quote.status !== 'ready' && quote.status !== 'expired') || !destination) return NO_NOTICES;
  return routeNotices({
    quality: quote.estimate.route.quality,
    route: quote.route,
    origin: state.origin.point,
    destination: destination.point,
    accepted: state.acceptedSnaps,
  });
}

/** Ruta de la polilínea; una polilínea inválida no rompe la pantalla (se dibuja sin ruta). */
export function decodeRoute(polyline: string): LatLng[] {
  try {
    return decodePolyline(polyline);
  } catch {
    return [];
  }
}

/** Petición que la pantalla debe enviar ahora (la cotización en `loading`), o `null`. */
export function pendingRequest(
  state: PlannerState,
): { requestId: number; body: FareEstimateBody } | null {
  return state.quote.status === 'loading'
    ? { requestId: state.quote.requestId, body: state.quote.body }
    : null;
}

/** Paso visible del panel inferior. */
export type PlannerStep = 'choose-destination' | 'confirm-destination' | 'quote';

export function plannerStep(state: PlannerState): PlannerStep {
  if (state.candidate) return 'confirm-destination';
  if (!state.destination) return 'choose-destination';
  return 'quote';
}
