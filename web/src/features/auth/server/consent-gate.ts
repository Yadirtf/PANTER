import {
  PRIVACY_POLICY_VERSION,
  REFRESH_TOKEN_TTL_SECONDS,
  type ConsentStatus,
} from '@panter/contracts';
import type { NextResponse } from 'next/server';
import { CONSENT_PATH } from '@/features/navigation/role-home';
import { clearConsentCookie, setConsentCookie } from './cookies';

/**
 * Consentimiento del personal (HU-109) sin llamar a la API en cada petición.
 *
 * Decisión: el middleware recuerda en la cookie httpOnly `__Host-panter_consent` que la API ya
 * dio por cumplido el consentimiento de ESTE usuario para ESTA versión del aviso. El valor es
 * `<sub>.<PRIVACY_POLICY_VERSION>` y va sin firmar, porque no es un control de seguridad:
 * - La autoridad es la API: guarda la aceptación con fecha y versión y puede rechazar con
 *   CONSENT_REQUIRED. La cookie solo evita preguntarle a /me en cada navegación.
 * - Falsificarla solo salta una pantalla en el propio navegador; no da acceso a nada ni deja
 *   constancia de una aceptación que no ocurrió.
 * - No tiene datos sensibles (el `sub` ya viaja en el JWT) y firmarla exigiría un secreto nuevo
 *   en la web sin ganar seguridad real.
 * Incluir el `sub` evita heredar la marca de otra persona en el mismo navegador, e incluir la
 * versión hace que al publicar un aviso nuevo todas las marcas dejen de valer y se vuelva a
 * consultar a la API (que decide si hay que aceptar de nuevo).
 */
export { CONSENT_PATH };

/**
 * Si la API todavía no envía `consent` (campo opcional del contrato) no se bloquea, pero la
 * marca dura poco para notar pronto cuando la API empiece a exigirlo.
 */
export const CONSENT_UNKNOWN_TTL_SECONDS = 10 * 60;
export const CONSENT_OK_TTL_SECONDS = REFRESH_TOKEN_TTL_SECONDS;

export function consentCookieValue(sub: string): string {
  return `${sub}.${PRIVACY_POLICY_VERSION}`;
}

/** ¿La cookie dice que este usuario ya cumplió con la versión vigente? */
export function hasConsentMark(cookie: string | undefined, sub: string): boolean {
  return cookie === consentCookieValue(sub);
}

/** `true` solo si la API dice explícitamente que falta aceptar. */
export function consentRequired(consent: ConsentStatus | undefined): boolean {
  return consent?.required === true;
}

/**
 * Escribe (o borra) la marca según lo que respondió la API: sin `consent` → marca corta; con
 * `required: false` → marca larga; con `required: true` → sin marca.
 */
export function applyConsentMark(
  response: NextResponse,
  sub: string,
  consent: ConsentStatus | undefined,
): void {
  if (consentRequired(consent)) {
    clearConsentCookie(response);
    return;
  }
  setConsentCookie(
    response,
    consentCookieValue(sub),
    consent ? CONSENT_OK_TTL_SECONDS : CONSENT_UNKNOWN_TTL_SECONDS,
  );
}

/** /consentimiento?next=… con el destino al que se irá después de aceptar. */
export function consentPathFor(next: string): string {
  return `${CONSENT_PATH}?next=${encodeURIComponent(next)}`;
}
