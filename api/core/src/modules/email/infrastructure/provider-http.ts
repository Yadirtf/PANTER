import { EmailSendError } from '../application/ports';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const EMAIL_PROVIDER_TIMEOUT_MS = 10_000;

/**
 * POST JSON a la API HTTP de un proveedor y traduce el resultado a `EmailSendError`.
 * No incluye el cuerpo de la respuesta en el mensaje del error: puede traer el destinatario.
 */
export async function postToProvider(
  provider: string,
  fetchFn: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new EmailSendError(provider, 'network', `${provider}: error de red o timeout`, { cause });
  }
  // Se consume el cuerpo siempre para liberar la conexión.
  const detail = await res.text().catch(() => '');
  if (res.ok) return;

  const status = res.status;
  const reason = status === 429 ? 'rate_limited' : status >= 500 ? 'unavailable' : 'rejected';
  const code = extractCode(detail);
  throw new EmailSendError(
    provider,
    reason,
    `${provider} respondió ${status}${code ? ` (${code})` : ''}`,
    { status },
  );
}

/** Solo el código de error del proveedor (`code` en Brevo, `name` en Resend), nunca el texto. */
function extractCode(detail: string): string | undefined {
  try {
    const json = JSON.parse(detail) as { code?: unknown; name?: unknown };
    const code = json.code ?? json.name;
    return typeof code === 'string' && /^[\w.-]{1,64}$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}
