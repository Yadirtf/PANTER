import {
  AccessTokenClaimsSchema,
  AuthRoutes,
  JWT_AUDIENCE,
  JWT_ISSUER,
  type AccessTokenClaims,
} from '@panter/contracts';
import {
  createRemoteJWKSet,
  customFetch,
  errors,
  jwtVerify,
  type FetchImplementation,
  type JWTVerifyGetKey,
} from 'jose';

/** Llaves con las que se verifica el access token (JWKS remoto en producción, local en pruebas). */
export type AccessTokenKeys = JWTVerifyGetKey;

/** Tolerancia de reloj entre la API y la web. */
const CLOCK_TOLERANCE_SECONDS = 5;

/**
 * JWKS público de la API. jose lo guarda en memoria del isolate del Worker: solo se vuelve a
 * pedir al vencer `cacheMaxAge` o si llega un `kid` desconocido (rotación de llaves), con un
 * mínimo de `cooldownDuration` entre descargas.
 */
export function createApiJwks(apiUrl: string, fetchImpl?: FetchImplementation): AccessTokenKeys {
  const base = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;
  return createRemoteJWKSet(new URL(AuthRoutes.JWKS.replace(/^\//, ''), base), {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
    timeoutDuration: 5 * 1000,
    ...(fetchImpl ? { [customFetch]: fetchImpl } : {}),
  });
}

export type AccessTokenResult =
  | { status: 'valid'; claims: AccessTokenClaims }
  /** Firma correcta pero vencido: se puede refrescar. */
  | { status: 'expired' }
  /** Firma, emisor, audiencia o claims incorrectos. */
  | { status: 'invalid' }
  /** No se pudo obtener el JWKS (red, tiempo agotado o respuesta inválida de la API). */
  | { status: 'unavailable' };

function isKeysUnavailable(error: unknown): boolean {
  if (!(error instanceof errors.JOSEError)) return true;
  return error instanceof errors.JWKSTimeout || error.code === 'ERR_JOSE_GENERIC';
}

/** Verifica un access token RS256 de panter-api (iss, aud, exp) y valida sus claims. */
export async function verifyAccessToken(
  token: string,
  keys: AccessTokenKeys,
): Promise<AccessTokenResult> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    const claims = AccessTokenClaimsSchema.safeParse(payload);
    return claims.success ? { status: 'valid', claims: claims.data } : { status: 'invalid' };
  } catch (error) {
    if (error instanceof errors.JWTExpired) return { status: 'expired' };
    if (isKeysUnavailable(error)) return { status: 'unavailable' };
    return { status: 'invalid' };
  }
}
