import { describe, expect, it } from 'vitest';
import { describeDatabaseUrl, hintForPostgresError } from '../../scripts/database-url';

const GOOD =
  'postgresql://panter_owner:npg_AbC123xyz@ep-cool-name-a1b2c3-pooler.us-east-1.aws.neon.tech/panter?sslmode=require';

describe('describeDatabaseUrl', () => {
  it('acepta una cadena de Neon correcta y no muestra la contraseña', () => {
    const res = describeDatabaseUrl(GOOD);
    expect(res.ok).toBe(true);
    expect(res.problems).toEqual([]);
    expect(res.description).toContain('usuario=panter_owner');
    expect(res.description).toContain('base=panter');
    expect(res.description).toContain('contraseña=13 caracteres');
    expect(res.description).toContain('pooler=sí');
    expect(res.description).not.toContain('npg_AbC123xyz');
  });

  it('detecta la contraseña copiada oculta con asteriscos', () => {
    const res = describeDatabaseUrl(GOOD.replace('npg_AbC123xyz', '****************'));
    expect(res.ok).toBe(false);
    expect(res.problems.join()).toMatch(/asteriscos/);
  });

  it('detecta psql, comillas, prefijo DATABASE_URL= y espacios', () => {
    expect(describeDatabaseUrl(`psql '${GOOD}'`).problems.join()).toMatch(/psql/);
    expect(describeDatabaseUrl(`'${GOOD}'`).problems.join()).toMatch(/comillas/);
    expect(describeDatabaseUrl(`DATABASE_URL=${GOOD}`).ok).toBe(false);
    expect(describeDatabaseUrl(`${GOOD}\n`).problems.join()).toMatch(/espacios/);
  });

  it('detecta faltantes: sslmode en Neon, base, contraseña y URL inválida', () => {
    expect(describeDatabaseUrl(GOOD.replace('?sslmode=require', '')).problems.join()).toMatch(
      /sslmode/,
    );
    expect(describeDatabaseUrl(GOOD.replace('/panter?', '/?')).problems.join()).toMatch(/base/);
    expect(describeDatabaseUrl(GOOD.replace(':npg_AbC123xyz', '')).problems.join()).toMatch(
      /contraseña/,
    );
    expect(describeDatabaseUrl('no es una url').ok).toBe(false);
  });

  it('acepta un PostgreSQL local sin sslmode', () => {
    expect(describeDatabaseUrl('postgres://postgres:postgres@localhost:5432/panter').ok).toBe(true);
  });
});

describe('hintForPostgresError', () => {
  it('explica la contraseña rechazada (28P01)', () => {
    expect(hintForPostgresError('28P01')).toMatch(/Neon rechazó la contraseña/);
    expect(hintForPostgresError('XX000')).toBeNull();
  });
});
