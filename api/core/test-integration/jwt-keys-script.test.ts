// scripts/generar_llaves_jwt.sh genera llaves que el Worker acepta (HU-103). Corre en Node con
// el openssl del sistema; no necesita base de datos.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildJwks,
  createJoseAccessTokenSigner,
  createJoseAccessTokenVerifier,
} from '../src/modules/auth/infrastructure/jose-access-tokens';

const script = resolve(import.meta.dirname, '../../../scripts/generar_llaves_jwt.sh');
const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version']);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasOpenssl)('scripts/generar_llaves_jwt.sh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'panter-jwt-'));
  const out = join(dir, 'llaves');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('genera PKCS8 + SPKI que firman y verifican, e imprime los comandos de wrangler', async () => {
    const stdout = execFileSync('bash', [script, 'staging', out], { encoding: 'utf8' });
    expect(stdout).toContain('wrangler secret put JWT_PRIVATE_KEY --env staging');
    expect(stdout).toContain('wrangler secret put JWT_PUBLIC_KEY --env staging');

    const privateKeyPem = readFileSync(join(out, 'jwt-private.pem'), 'utf8');
    const publicKeyPem = readFileSync(join(out, 'jwt-public.pem'), 'utf8');
    const kid = readFileSync(join(out, 'kid.txt'), 'utf8').trim();
    expect(privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
    expect(publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(kid).toMatch(/^panter-staging-\d{8}$/);

    const { token } = await createJoseAccessTokenSigner({ privateKeyPem, kid }).sign({
      userId: '6f9619ff-8b86-4d11-b42d-00c04fc964ff',
      roles: ['PASSENGER'],
      activeMode: 'passenger',
    });
    const check = await createJoseAccessTokenVerifier({ publicKeyPem }).verify(token);
    expect(check.ok).toBe(true);
    const jwks = await buildJwks(publicKeyPem, kid);
    // RSA 2048: el módulo ocupa 256 bytes (342 caracteres base64url).
    expect(jwks.keys[0]?.n).toHaveLength(342);
  });

  it('no sobrescribe llaves existentes ni acepta ambientes desconocidos', () => {
    expect(() => execFileSync('bash', [script, 'staging', out], { stdio: 'pipe' })).toThrow();
    expect(() =>
      execFileSync('bash', [script, 'qa', join(dir, 'otra')], { stdio: 'pipe' }),
    ).toThrow();
    expect(existsSync(join(dir, 'otra', 'jwt-private.pem'))).toBe(false);
  });

  it('se niega a guardar llaves dentro del repositorio', () => {
    const inside = resolve(import.meta.dirname, '../.tmp-llaves-jwt');
    try {
      expect(() => execFileSync('bash', [script, 'staging', inside], { stdio: 'pipe' })).toThrow();
      expect(existsSync(join(inside, 'jwt-private.pem'))).toBe(false);
    } finally {
      rmSync(inside, { recursive: true, force: true });
    }
  });
});
