import {
  ApiErrorCode,
  PRIVACY_POLICY,
  type AcceptConsentBody,
  type ConsentStatus,
  type PrivacyPolicyResponse,
} from '@panter/contracts';
import { AppError } from '../../../shared/errors/app-error';
import { consentEvidence, consentStatus } from '../domain/consent';
import type { ConsentRepository } from './ports';

/** Errores del consentimiento (HU-109). */
export const ConsentErrors = {
  versionOutdated: (currentVersion: string) =>
    new AppError(
      ApiErrorCode.CONSENT_VERSION_OUTDATED,
      'El aviso de privacidad cambió. Léelo de nuevo y acepta la versión vigente.',
      { status: 409, details: { currentVersion } },
    ),
  required: (currentVersion: string) =>
    new AppError(
      ApiErrorCode.CONSENT_REQUIRED,
      'Para continuar debes leer y aceptar el aviso de privacidad.',
      { status: 403, details: { currentVersion } },
    ),
  unauthenticated: () =>
    new AppError(ApiErrorCode.UNAUTHENTICATED, 'Inicia sesión para continuar.', { status: 401 }),
};

/** Estado del consentimiento de un usuario frente a la versión vigente del aviso. */
export type GetConsentStatus = (userId: string) => Promise<ConsentStatus>;

export function makeGetConsentStatus(deps: {
  repo: ConsentRepository;
  currentVersion?: string;
}): GetConsentStatus {
  const current = deps.currentVersion ?? PRIVACY_POLICY.version;
  return async (userId) => consentStatus(await deps.repo.latest(userId), current);
}

export interface AcceptConsentInput extends AcceptConsentBody {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export type AcceptConsent = (input: AcceptConsentInput) => Promise<ConsentStatus>;

/**
 * POST /me/consent: registra la aceptación de la versión vigente con fecha, IP y User-Agent.
 * Otra versión (el cliente mostró un aviso viejo) → 409 `CONSENT_VERSION_OUTDATED` con la
 * versión vigente en `details`. Idempotente: aceptar dos veces conserva la primera fecha.
 */
export function makeAcceptConsent(deps: {
  repo: ConsentRepository;
  currentVersion?: string;
}): AcceptConsent {
  const current = deps.currentVersion ?? PRIVACY_POLICY.version;
  const status = makeGetConsentStatus({ repo: deps.repo, currentVersion: current });
  return async ({ userId, version, ip, userAgent }) => {
    if (version !== current) throw ConsentErrors.versionOutdated(current);
    const exists = await deps.repo.accept({
      userId,
      version,
      ...consentEvidence({ ip, userAgent }),
    });
    if (!exists) throw ConsentErrors.unauthenticated();
    return status(userId);
  };
}

/** GET /privacy-policy: versión vigente del aviso. El texto lo muestran los clientes desde contracts. */
export function getPrivacyPolicy(): PrivacyPolicyResponse {
  return { version: PRIVACY_POLICY.version, effectiveFrom: PRIVACY_POLICY.effectiveFrom };
}
