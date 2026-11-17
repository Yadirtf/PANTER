import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenClaimsSchema,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '@panter/contracts';
import { errors, exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT, type JWK } from 'jose';
import type { AccessTokenSigner, AccessTokenVerifier } from '../application/ports';

export const JWT_ALG = 'RS256';
/** Tolerancia al desfase de relojes entre el Worker y quien verifica. */
export const CLOCK_TOLERANCE_SECONDS = 5;

/**
 * Normaliza un PEM pegado de cualquier forma: con `\n` literales (una sola línea), con espacios
 * en lugar de saltos (al pegarlo en un campo de una línea) o con saltos de Windows.
 */
export function normalizePem(pem: string, label: 'PRIVATE KEY' | 'PUBLIC KEY'): string {
  const text = pem.replace(/\\n/g, '\n').trim();
  const match = new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`).exec(text);
  if (!match) {
    throw new Error(
      label === 'PRIVATE KEY'
        ? 'JWT_PRIVATE_KEY no es un PEM PKCS8 ("-----BEGIN PRIVATE KEY-----"). Usa scripts/generar_llaves_jwt.sh.'
        : 'JWT_PUBLIC_KEY no es un PEM SPKI ("-----BEGIN PUBLIC KEY-----"). Usa scripts/generar_llaves_jwt.sh.',
    );
  }
  const body = (match[1] ?? '').replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [];
  return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`].join('\n');
}

// Las llaves importadas se reutilizan entre requests del mismo aislado (importar RSA cuesta
// algunos ms). La clave del caché es el PEM: si se rota el secreto, se importa la nueva.
type Key = Awaited<ReturnType<typeof importSPKI>>;
const keyCache = new Map<string, Promise<Key>>();

function cached(id: string, load: () => Promise<Key>): Promise<Key> {
  let key = keyCache.get(id);
  if (!key) {
    key = load();
    keyCache.set(id, key);
    key.catch(() => keyCache.delete(id));
  }
  return key;
}

function privateKey(pem: string) {
  const normalized = normalizePem(pem, 'PRIVATE KEY');
  return cached(`priv:${normalized}`, () => importPKCS8(normalized, JWT_ALG));
}

function publicKey(pem: string) {
  const normalized = normalizePem(pem, 'PUBLIC KEY');
  return cached(`pub:${normalized}`, () => importSPKI(normalized, JWT_ALG, { extractable: true }));
}

export interface SignerConfig {
  privateKeyPem: string;
  kid: string;
  /** Reloj (epoch ms). */
  now?: () => number;
  newId?: () => string;
}

/**
 * Firma access tokens RS256 de `ACCESS_TOKEN_TTL_SECONDS` (15 min) con los claims de
 * `AccessTokenClaimsSchema`: sub, roles, activeMode, iss "panter-api", aud "panter", iat, exp y
 * jti. El header lleva `kid` para que quien verifique elija la llave del JWKS.
 */
export function createJoseAccessTokenSigner(config: SignerConfig): AccessTokenSigner {
  const now = config.now ?? Date.now;
  const newId = config.newId ?? (() => crypto.randomUUID());
  return {
    async sign({ userId, roles, activeMode }) {
      const iat = Math.floor(now() / 1000);
      const token = await new SignJWT({ roles, activeMode })
        .setProtectedHeader({ alg: JWT_ALG, kid: config.kid, typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ACCESS_TOKEN_TTL_SECONDS)
        .setJti(newId())
        .sign(await privateKey(config.privateKeyPem));
      return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
    },
  };
}

export interface VerifierConfig {
  publicKeyPem: string;
  now?: () => number;
}

/**
 * Verifica firma (solo RS256), emisor, audiencia y vencimiento, y luego valida los claims con
 * `AccessTokenClaimsSchema`. Cualquier fallo que no sea el vencimiento es `invalid`.
 */
export function createJoseAccessTokenVerifier(config: VerifierConfig): AccessTokenVerifier {
  return {
    async verify(token) {
      // Fuera del try: una llave mal configurada es un error del servidor (500), no un 401.
      const key = await publicKey(config.publicKeyPem);
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: [JWT_ALG],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
          ...(config.now ? { currentDate: new Date(config.now()) } : {}),
        });
        const claims = AccessTokenClaimsSchema.safeParse(payload);
        if (!claims.success) return { ok: false, reason: 'invalid' };
        return {
          ok: true,
          actor: {
            userId: claims.data.sub,
            roles: claims.data.roles,
            activeMode: claims.data.activeMode,
            tokenId: claims.data.jti,
          },
        };
      } catch (error) {
        return { ok: false, reason: error instanceof errors.JWTExpired ? 'expired' : 'invalid' };
      }
    },
  };
}

export interface JwksDocument {
  keys: { kty: string; n?: string; e?: string; kid: string; alg: string; use: string }[];
}

/** JWKS público (`GET /.well-known/jwks.json`) con la llave de verificación y su `kid`. */
export async function buildJwks(publicKeyPem: string, kid: string): Promise<JwksDocument> {
  const { n, e }: JWK = await exportJWK(await publicKey(publicKeyPem));
  return { keys: [{ kty: 'RSA', n, e, kid, alg: JWT_ALG, use: 'sig' }] };
}
