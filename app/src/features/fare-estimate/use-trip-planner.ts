// Puente de React con el flujo del estimado: envía la cotización pendiente y avisa cuando vence.
import { useEffect, useReducer, useState } from 'react';
import { toApiError } from '../../shared/api/errors';
import { quoteValidity } from './estimate/quote-validity';
import { initialPlannerState, pendingRequest, plannerReducer } from './estimate/planner';
import { faresApi } from './instance';

export function useTripPlanner() {
  const [state, dispatch] = useReducer(plannerReducer, undefined, initialPlannerState);
  const pending = pendingRequest(state);
  const requestId = pending?.requestId ?? null;

  useEffect(() => {
    if (!pending) return;
    const { requestId: id, body } = pending;
    faresApi.estimate(body).then(
      (estimate) => dispatch({ type: 'estimateSucceeded', requestId: id, estimate }),
      (error: unknown) =>
        dispatch({ type: 'estimateFailed', requestId: id, code: toApiError(error).code }),
    );
    // Una vez por petición (cambia `requestId`); el reducer descarta respuestas de peticiones
    // reemplazadas, así que no hace falta cancelar la anterior.
  }, [requestId]);

  const now = useNow(state.quote.status === 'ready');
  const validUntil = state.quote.status === 'ready' ? state.quote.estimate.validUntil : null;
  const validity = validUntil ? quoteValidity(validUntil, now) : null;
  const expired = validity?.expired ?? false;

  useEffect(() => {
    if (expired) dispatch({ type: 'quoteExpired' });
  }, [expired]);

  return { state, dispatch, validity };
}

/** Hora actual que se actualiza cada segundo mientras `active`. */
function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
