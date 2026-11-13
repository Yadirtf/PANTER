/**
 * Error de configuración del Worker (falta un secreto o una var). Se lanza solo cuando un
 * endpoint necesita ese valor: /health y el resto de rutas siguen funcionando sin él.
 * El middleware de errores lo registra con su mensaje y responde 500 INTERNAL_ERROR genérico.
 */
export class MissingConfigError extends Error {
  constructor(name: string, kind: 'secreto' | 'var') {
    const how =
      kind === 'secreto'
        ? `wrangler secret put ${name} --env <ambiente>, o Cloudflare → Worker → Settings → Variables and Secrets`
        : `la var ${name} en api/core/wrangler.jsonc para el ambiente`;
    super(`Falta configurar el ${kind} ${name} del Worker panter-api (${how}).`);
    this.name = 'MissingConfigError';
  }
}

/** Devuelve el valor (sin espacios en los extremos) o lanza `MissingConfigError`. */
export function requireConfig(
  value: string | undefined,
  name: string,
  kind: 'secreto' | 'var',
): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new MissingConfigError(name, kind);
  return trimmed;
}
