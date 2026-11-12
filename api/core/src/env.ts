/**
 * Bindings y variables del Worker panter-api (ver wrangler.jsonc).
 * Declarados a mano para no versionar el archivo generado por `wrangler types`.
 */
export interface Env {
  ENVIRONMENT: string;
  APP_VERSION: string;
  GIT_COMMIT: string;
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
}

/** Tipo de contexto de Hono para toda la app. */
export interface AppBindings {
  Bindings: Env;
}
