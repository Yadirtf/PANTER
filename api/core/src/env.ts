import type { Actor } from './modules/auth/domain/actor';

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
  // --- Mapa base (HU-301) ---
  /**
   * Bucket R2 público del mapa base: .pmtiles, glifos, sprites y basemap.json, servidos por
   * GET /tiles/:file. Opcional en el tipo: si falta, /tiles responde 503 y /health sigue bien.
   */
  TILES?: R2Bucket;
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
  /**
   * Secreto: remitente. Con Brevo sin dominio, el correo verificado en Brevo → Senders. Es
   * secreto (no var) para no publicar ese correo en el repositorio, que es público.
   */
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

  // --- Tokens JWT (HU-103). Generar con scripts/generar_llaves_jwt.sh. ---
  /** Secreto: llave privada RSA 2048 en PEM PKCS8 ("-----BEGIN PRIVATE KEY-----"). */
  JWT_PRIVATE_KEY?: string;
  /** Secreto: llave pública en PEM SPKI ("-----BEGIN PUBLIC KEY-----"). Se publica en el JWKS. */
  JWT_PUBLIC_KEY?: string;
  /** Var: identificador de la llave (`kid` del header y del JWKS). Cambiarlo al rotar llaves. */
  JWT_KID?: string;

  // --- Documentos de conductores (HU-202). Ver Docs/GUIA-DESPLIEGUE.md → "M2 · Documentos". ---
  /** Secreto: llave HMAC-SHA256 de las URLs firmadas de documentos (`openssl rand -hex 32`). */
  DOCUMENT_URL_SECRET?: string;

  // --- M2 · HU-305 Rutas. Ver Docs/GUIA-DESPLIEGUE.md → "M2 · Rutas con OpenRouteService". ---
  /** Secreto: API key de OpenRouteService. Sin ella, /routes y /fares/estimate responden 503. */
  ORS_API_KEY?: string;
  /**
   * Secreto: API key de Google Routes API. Si está, las rutas se calculan con Google en vez de
   * ORS (ver Docs/GUIA-DESPLIEGUE.md → "Rutas con Google Routes API"). Las condiciones de Google
   * exigen mostrar esas rutas sobre un mapa de Google.
   */
  GOOGLE_ROUTES_API_KEY?: string;
}

/** Tipo de contexto de Hono para toda la app. */
export interface AppBindings {
  Bindings: Env;
  Variables: {
    /** Lo pone `requireAuth` (modules/auth/http/require-auth.ts). */
    actor?: Actor;
  };
}
