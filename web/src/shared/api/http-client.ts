import type { z } from 'zod';
import { ApiError, ApiErrorBodySchema, ClientErrorCode, toApiError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions<S extends z.ZodType> {
  /** Esquema Zod (idealmente de @panter/contracts) con el que se valida la respuesta. */
  schema: S;
  method?: HttpMethod;
  /** Se serializa como JSON. */
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface HttpClientConfig {
  baseUrl: string;
  /** Inyectable para pruebas; por defecto el `fetch` global. */
  fetch?: typeof fetch;
  /** Token de sesión (HU de auth); si devuelve un valor se envía como Bearer. */
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  defaultHeaders?: Record<string, string>;
}

export interface HttpClient {
  request<S extends z.ZodType>(path: string, options: RequestOptions<S>): Promise<z.output<S>>;
  get<S extends z.ZodType>(
    path: string,
    options: Omit<RequestOptions<S>, 'method' | 'body'>,
  ): Promise<z.output<S>>;
  post<S extends z.ZodType>(
    path: string,
    options: Omit<RequestOptions<S>, 'method'>,
  ): Promise<z.output<S>>;
  put<S extends z.ZodType>(
    path: string,
    options: Omit<RequestOptions<S>, 'method'>,
  ): Promise<z.output<S>>;
  patch<S extends z.ZodType>(
    path: string,
    options: Omit<RequestOptions<S>, 'method'>,
  ): Promise<z.output<S>>;
  delete<S extends z.ZodType>(
    path: string,
    options: Omit<RequestOptions<S>, 'method' | 'body'>,
  ): Promise<z.output<S>>;
}

export function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, QueryValue>,
): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(path.replace(/^\/+/, ''), base);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text.length === 0) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError({
      code: ClientErrorCode.INVALID_RESPONSE,
      message: 'La respuesta de la API no es JSON válido.',
      status: response.status,
    });
  }
}

function errorFromResponse(response: Response, body: unknown): ApiError {
  const parsed = ApiErrorBodySchema.safeParse(body);
  if (parsed.success) {
    return new ApiError({
      code: parsed.data.error.code,
      message: parsed.data.error.message,
      status: response.status,
      details: parsed.data.error.details,
    });
  }
  return new ApiError({
    code: ClientErrorCode.HTTP_ERROR,
    message: `La API respondió ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
    status: response.status,
  });
}

/** Cliente HTTP tipado: valida cada respuesta con Zod y normaliza todos los errores a `ApiError`. */
export function createHttpClient(config: HttpClientConfig): HttpClient {
  const doFetch = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<S extends z.ZodType>(
    path: string,
    options: RequestOptions<S>,
  ): Promise<z.output<S>> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...config.defaultHeaders,
      ...options.headers,
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const token = await config.getAccessToken?.();
    if (token) headers.authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await doFetch(buildUrl(config.baseUrl, path, options.query), {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      const normalized = toApiError(error);
      if (normalized.code === ClientErrorCode.ABORTED) throw normalized;
      throw new ApiError({
        code: ClientErrorCode.NETWORK_ERROR,
        message: 'No se pudo conectar con la API.',
        details: normalized.message,
      });
    }

    const body = await readBody(response);
    if (!response.ok) throw errorFromResponse(response, body);

    const parsed = options.schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError({
        code: ClientErrorCode.INVALID_RESPONSE,
        message: 'La respuesta de la API no cumple el contrato esperado.',
        status: response.status,
        details: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, options) => request(path, { ...options, method: 'POST' }),
    put: (path, options) => request(path, { ...options, method: 'PUT' }),
    patch: (path, options) => request(path, { ...options, method: 'PATCH' }),
    delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  };
}
