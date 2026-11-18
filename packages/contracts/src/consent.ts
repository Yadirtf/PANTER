import { z } from 'zod';

/**
 * Consentimiento de tratamiento de datos personales (Ley 1581 de 2012, HU-109).
 * Cada cambio del aviso de privacidad sube la versión y obliga a aceptar de nuevo.
 */
export const PRIVACY_POLICY_VERSION = '2026-11-v1';

export const ConsentRoutes = {
  /** POST: registra la aceptación de la versión vigente del aviso. */
  ME_CONSENT: '/me/consent',
  /** GET público: versión vigente del aviso (para la web y la app sin sesión). */
  PRIVACY_POLICY: '/privacy-policy',
} as const;

export const ConsentStatusSchema = z.object({
  /** Versión vigente del aviso de privacidad. */
  currentVersion: z.string().min(1),
  /** Última versión aceptada por el usuario, o null si nunca aceptó. */
  acceptedVersion: z.string().min(1).nullable(),
  acceptedAt: z.iso.datetime().nullable(),
  /** true si debe aceptar la versión vigente antes de seguir. */
  required: z.boolean(),
});
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

// POST /me/consent → 200 ConsentStatus. Si version no es la vigente: 409 CONSENT_VERSION_OUTDATED.
export const AcceptConsentBodySchema = z.object({
  version: z.string().min(1),
  accepted: z.literal(true),
});
export type AcceptConsentBody = z.infer<typeof AcceptConsentBodySchema>;

// GET /privacy-policy
export const PrivacyPolicyResponseSchema = z.object({
  version: z.string().min(1),
  /** Fecha desde la que rige esta versión (ISO 8601). */
  effectiveFrom: z.iso.date(),
});
export type PrivacyPolicyResponse = z.infer<typeof PrivacyPolicyResponseSchema>;
