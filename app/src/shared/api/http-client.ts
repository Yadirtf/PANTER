// Cliente HTTP tipado de la app: `fetch` + validación con los esquemas Zod de @panter/contracts.
// - Toda respuesta exitosa se valida contra el contrato; si no cumple → INVALID_RESPONSE.
// - Todo error de la API (`{ error: { code, message } }`) se normaliza a `ApiError`.
// - Sin red o sin respuesta a tiempo → NETWORK_ERROR.
// - Peticiones autenticadas: pide el access token al `AuthHandler` (que lo refresca si está por
//   vencer) y, ante un 401 TOKEN_EXPIRED, refresca una sola vez y reintenta.
import { ApiErrorBodySchema, ApiErrorCode } from '@panter/contracts';
import { ApiError, ClientErrorCode, networkError } from './errors';

/** Lo mínimo de un esquema Zod que necesita el cliente (evita depender de `zod` en la app). */
export interface Schema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Puente con el store de sesión para las peticiones autenticadas. */
export interface AuthHandler {
  /** Access token vigente; lo refresca antes si está por vencer. Lanza si no hay sesión. */
  getAccessToken(): Promise<string>;
  /**
   * Se llama ante un 401 TOKEN_EXPIRED con el token que se usó. Devuelve uno nuevo (o el ya
   * refrescado por otra petición en curso). Lanza si el refresh falla.
   */
  refreshAccessToken(staleToken: string): Promise<string>;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  path: string;
  body?: unknown;
  /** Envía `Authorization: Bearer <access token>` con refresco automático. */
  auth?: boolean;
  headers?: Record<string, string>;
}

export interface HttpClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  /** Tiempo máximo de espera por petición (ms). */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

export interface HttpClient {
  /** Petición con respuesta JSON validada contra `schema`. */
  request<T>(options: RequestOptions & { schema: Schema<T> }): Promise<T>;
  /** Petición cuya respuesta no interesa (p. ej. 204). */
  send(options: RequestOptions): Promise<void>;
  /** Conecta el store de sesión. Sin él, las peticiones con `auth` fallan con UNAUTHENTICATED. */
  setAuthHandler(handler: AuthHandler | null): void;
}

function fallbackCode(status: number): string {
  if (status === 401) return ApiErrorCode.UNAUTHENTICATED;
  if (status === 403) return ApiErrorCode.FORBIDDEN;
  if (status === 404) return ApiErrorCode.NOT_FOUND;
  if (status >= 400 && status < 500) return ApiErrorCode.BAD_REQUEST;
  return ApiErrorCode.INTERNAL_ERROR;
}

async function readJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const text = await response.text();
    if (!text) return { ok: false };
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Convierte una respuesta no exitosa en `ApiError` usando el cuerpo uniforme de la API. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  const json = await readJson(response);
  if (json.ok) {
    const parsed = ApiErrorBodySchema.safeParse(json.value);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      return new ApiError(code, message, response.status, details);
    }
  }
  return new ApiError(
    fallbackCode(response.status),
    `La API respondió ${response.status}`,
    response.status,
  );
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let authHandler: AuthHandler | null = null;

  async function sendOnce(opts: RequestOptions, accessToken: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${opts.path}`, {
        method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch (error) {
      // fetch solo lanza si la petición no se completó (sin red, DNS, TLS o timeout).
      throw networkError(error);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw await errorFromResponse(response);
    return response;
  }

  async function execute(opts: RequestOptions): Promise<Response> {
    if (!opts.auth) return sendOnce(opts, null);
    if (!authHandler) {
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'No hay sesión activa', 401);
    }
    const handler = authHandler;
    const token = await handler.getAccessToken();
    try {
      return await sendOnce(opts, token);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== ApiErrorCode.TOKEN_EXPIRED) throw error;
      // Un solo reintento: si vuelve a fallar, el error llega tal cual a quien llamó.
      const fresh = await handler.refreshAccessToken(token);
      return sendOnce(opts, fresh);
    }
  }

  return {
    async request<T>(opts: RequestOptions & { schema: Schema<T> }): Promise<T> {
      const response = await execute(opts);
      const json = await readJson(response);
      const parsed = json.ok ? opts.schema.safeParse(json.value) : null;
      if (!parsed?.success) {
        throw new ApiError(
          ClientErrorCode.INVALID_RESPONSE,
          `Respuesta inesperada de ${opts.path}`,
          response.status,
          parsed?.error,
        );
      }
      return parsed.data;
    },
    async send(opts: RequestOptions): Promise<void> {
      await execute(opts);
    },
    setAuthHandler(handler) {
      authHandler = handler;
    },
  };
}
