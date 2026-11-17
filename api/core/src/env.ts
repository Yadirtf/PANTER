/**
 * Bindings y variables del Worker panter-api (ver wrangler.jsonc).
 * Declarados a mano para no versionar el archivo generado por `wrangler types`.
 */
export interface Env {
  ENVIRONMENT: string;
  APP_VERSION: string;
  GIT_COMMIT: string;
  /** Orígenes web autorizados por CORS, separados por comas (p. ej. la URL de panter-web). */
  CORS_ORIGINS: string;
  /** Caché, rate limiting, OTP y refresh tokens. */
  KV: KVNamespace;
  /** Documentos de conductores (privado, URLs firmadas). */
  DOCUMENTS: R2Bucket;
  /** Productor de eventos de dominio. */
  EVENTS: Queue;
  /** Service binding al Worker panter-realtime. */
  REALTIME: Fetcher;
  /**
   * Secreto: cadena de conexión de Neon de la rama del ambiente (staging → rama `staging`,
   * production → rama `main`). Se carga con `wrangler secret put DATABASE_URL --env <ambiente>`
   * y en local con `.dev.vars`. Opcional en el tipo porque las pruebas de Workers y los
   * endpoints sin base de datos (p. ej. /health) funcionan sin él; `createDb` falla si falta.
   */
  DATABASE_URL?: string;

  // --- Correo (HU-102). Ver Docs/GUIA-DESPLIEGUE.md → "Secretos y variables de M1 (login)". ---
  /** Var: proveedor principal, "brevo" (por defecto) o "resend". El otro queda de respaldo. */
  EMAIL_PROVIDER?: string;
  /** Var: remitente. Con Brevo sin dominio, el correo verificado en Brevo → Senders. */
  EMAIL_FROM?: string;
  /** Var: nombre visible del remitente ("PANTER"). */
  EMAIL_FROM_NAME?: string;
  /** Secreto: API key de Brevo (SMTP & API → API Keys). */
  BREVO_API_KEY?: string;
  /** Secreto: API key de Resend (para cuando haya dominio propio). */
  RESEND_API_KEY?: string;
  /** Var: "true" activa el eco del OTP en logs. Solo tiene efecto si ENVIRONMENT=staging. */
  OTP_DEV_ECHO?: string;
  /**
   * Correos de testers con eco del OTP, separados por comas. Como el repositorio es público,
   * se carga como secreto (`wrangler secret put OTP_DEV_ECHO_ALLOWLIST --env staging`) y no
   * se versiona en wrangler.jsonc.
   */
  OTP_DEV_ECHO_ALLOWLIST?: string;

  // --- Login OTP (HU-101) ---
  /** Secreto: llave del HMAC-SHA256 de los códigos y correos en KV (`openssl rand -hex 32`). */
  OTP_SECRET?: string;
}

/** Tipo de contexto de Hono para toda la app. */
export interface AppBindings {
  Bindings: Env;
}
