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
}

/** Tipo de contexto de Hono para toda la app. */
export interface AppBindings {
  Bindings: Env;
}
