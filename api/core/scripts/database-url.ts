// Diagnóstico de DATABASE_URL sin revelar la contraseña. Lo usa scripts/migrate.ts para que el
// log del workflow diga qué está mal en la cadena (copiada con la contraseña oculta, con
// comillas, con el comando psql, etc.) sin exponer el secreto.

export interface DatabaseUrlSummary {
  ok: boolean;
  /** Descripción segura para el log: host, usuario, base y largo de la contraseña. */
  description: string;
  /** Problemas detectados en la cadena, en español. */
  problems: string[];
}

export function describeDatabaseUrl(raw: string): DatabaseUrlSummary {
  const problems: string[] = [];
  const value = raw;

  if (value !== value.trim())
    problems.push('tiene espacios o saltos de línea al inicio o al final');
  const trimmed = value.trim();
  if (/^psql\s/i.test(trimmed)) problems.push('incluye el comando "psql": copia solo la URL');
  if (/^DATABASE_URL\s*=/.test(trimmed))
    problems.push('incluye "DATABASE_URL=": copia solo la URL');
  if (/^['"]|['"]$/.test(trimmed)) problems.push('tiene comillas al inicio o al final');

  let url: URL;
  try {
    url = new URL(trimmed.replace(/^psql\s+/i, '').replace(/^['"]|['"]$/g, ''));
  } catch {
    problems.push('no es una URL válida (debe empezar por postgresql://)');
    return { ok: false, description: 'cadena no reconocible como URL', problems };
  }

  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    problems.push(`el protocolo es "${url.protocol}" y debe ser "postgresql:"`);
  }
  const password = decodeURIComponent(url.password);
  if (!url.username) problems.push('falta el usuario');
  if (!password) problems.push('falta la contraseña');
  if (/\*{3,}/.test(password)) {
    problems.push(
      'la contraseña tiene asteriscos (****): se copió oculta. En Neon → Connect usa el botón de copiar o "Show password"',
    );
  }
  if (/^<.*>$|^\[.*\]$|^password$/i.test(password)) {
    problems.push('la contraseña parece un marcador de ejemplo, no la real');
  }
  const database = url.pathname.replace(/^\//, '');
  if (!database) problems.push('falta el nombre de la base de datos después del host');
  const isNeon = url.hostname.endsWith('.neon.tech');
  if (isNeon && url.searchParams.get('sslmode') !== 'require') {
    problems.push('falta "?sslmode=require" (Neon lo exige)');
  }

  const description = [
    `host=${url.hostname}${url.port ? `:${url.port}` : ''}`,
    `usuario=${url.username || '(vacío)'}`,
    `base=${database || '(vacía)'}`,
    `contraseña=${password ? `${password.length} caracteres` : '(vacía)'}`,
    `sslmode=${url.searchParams.get('sslmode') ?? '(no indicado)'}`,
    isNeon ? `pooler=${url.hostname.includes('-pooler') ? 'sí' : 'no'}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return { ok: problems.length === 0, description, problems };
}

/** Pistas para errores de conexión frecuentes, según el código de PostgreSQL. */
export function hintForPostgresError(code: string | undefined): string | null {
  switch (code) {
    case '28P01':
      return [
        'Neon rechazó la contraseña (28P01). La cadena tiene la forma correcta, pero la contraseña no es la actual:',
        '  1. Neon → proyecto panter → Connect → rama "staging", base "panter", formato "Connection string".',
        '  2. Copia con el botón de copiar (no seleccionando el texto: la contraseña aparece oculta).',
        '  3. Si reseteaste la contraseña del rol (Roles → Reset password), la cadena anterior ya no sirve.',
        '  4. Pégala en GitHub → Settings → Environments → staging → DATABASE_URL (y en el Worker de Cloudflare).',
      ].join('\n');
    case '3D000':
      return 'La base de datos indicada en la URL no existe en esa rama de Neon (debe ser "panter").';
    case '28000':
      return 'El usuario no existe o no tiene acceso a esa rama de Neon.';
    default:
      return null;
  }
}
