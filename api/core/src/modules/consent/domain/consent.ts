import type { ConsentStatus } from '@panter/contracts';

/** Última aceptación registrada de un usuario. */
export interface ConsentRecord {
  version: string;
  /** ISO 8601. */
  acceptedAt: string;
}

/**
 * Estado del consentimiento (HU-109). Debe aceptar si nunca aceptó o si lo último que aceptó
 * no es la versión vigente del aviso (al cambiar el aviso se pide de nuevo).
 */
export function consentStatus(latest: ConsentRecord | null, currentVersion: string): ConsentStatus {
  return {
    currentVersion,
    acceptedVersion: latest?.version ?? null,
    acceptedAt: latest?.acceptedAt ?? null,
    required: latest?.version !== currentVersion,
  };
}

/** Largo máximo del User-Agent que se guarda como evidencia. */
export const USER_AGENT_MAX_LENGTH = 512;

/** IP y navegador o app desde donde se aceptó; vacíos → null, y el User-Agent recortado. */
export function consentEvidence(input: { ip?: string | null; userAgent?: string | null }): {
  ip: string | null;
  userAgent: string | null;
} {
  return {
    ip: input.ip?.trim() || null,
    userAgent: input.userAgent?.trim().slice(0, USER_AGENT_MAX_LENGTH) || null,
  };
}
