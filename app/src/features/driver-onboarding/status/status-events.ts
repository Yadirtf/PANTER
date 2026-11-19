// Disparadores del refresco del estado de la solicitud (HU-205).
//
// PUNTO DE EXTENSIÓN PARA E10 (notificaciones push): cuando llegue la notificación de
// DriverApproved / DriverRejected / suspensión, el manejador de push solo tiene que llamar
//
//   notifyDriverStatusChanged('push');
//
// y el estado de la pantalla de onboarding (GET /drivers/me) se refresca como al volver a primer
// plano. La sesión (rol DRIVER) se refresca al tocar "Pasar a modo conductor". No se implementa
// la notificación aquí: E10 registra el token del dispositivo y decide cuándo llamar a esta
// función.
export type StatusRefreshReason = 'foreground' | 'pull' | 'push';

type Listener = (reason: StatusRefreshReason) => void;

const listeners = new Set<Listener>();

/** Avisa que el estado de la solicitud pudo cambiar en el servidor. */
export function notifyDriverStatusChanged(reason: StatusRefreshReason): void {
  for (const listener of listeners) listener(reason);
}

export function onDriverStatusChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Volver a primer plano: de background/inactive a active. */
export function isForegroundTransition(previous: string | null, next: string): boolean {
  return next === 'active' && previous !== null && previous !== 'active';
}
