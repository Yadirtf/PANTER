// Utilidades solo para pruebas: llaves RS256 generadas en la prueba y tokens firmados con ellas.
import {
  ACCESS_TOKEN_TTL_SECONDS,
  ActiveMode,
  JWT_AUDIENCE,
  JWT_ISSUER,
  REFRESH_TOKEN_TTL_SECONDS,
  type Role,
  type TokenPairResponse,
} from '@panter/contracts';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JSONWebKeySet } from 'jose';
import { NextRequest } from 'next/server';

export const USER_ID = '3f0c8a52-6b1e-4c3a-9d2f-1a2b3c4d5e6f';
export const WEB_ORIGIN = 'https://web.panter.test';
export const API_URL = 'https://api.panter.test';

export interface TestKeys {
  privateKey: CryptoKey;
  jwks: JSONWebKeySet;
  kid: string;
}

export async function createTestKeys(kid = 'test-key-1'): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  return { privateKey, kid, jwks: { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] } };
}

export interface SignOptions {
  roles?: Role[];
  /** Segundos desde ahora; negativo para un token vencido. */
  expiresIn?: number;
  issuer?: string;
  audience?: string;
  sub?: string;
  kid?: string;
}

export function signAccessToken(keys: TestKeys, options: SignOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = options.expiresIn ?? ACCESS_TOKEN_TTL_SECONDS;
  return new SignJWT({ roles: options.roles ?? ['ADMIN'], activeMode: ActiveMode.PASSENGER })
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? keys.kid })
    .setSubject(options.sub ?? USER_ID)
    .setIssuer(options.issuer ?? JWT_ISSUER)
    .setAudience(options.audience ?? JWT_AUDIENCE)
    .setIssuedAt(Math.min(now, now + expiresIn - 60))
    .setExpirationTime(now + expiresIn)
    .setJti(crypto.randomUUID())
    .sign(keys.privateKey);
}

export async function tokenPair(
  keys: TestKeys,
  roles: Role[],
  refreshToken = 'rt-nuevo',
): Promise<TokenPairResponse> {
  return {
    tokenType: 'Bearer',
    accessToken: await signAccessToken(keys, { roles }),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    user: {
      id: USER_ID,
      email: 'personal@panter.test',
      fullName: 'Persona de prueba',
      phone: null,
      status: 'ACTIVE',
      roles,
      activeMode: ActiveMode.PASSENGER,
    },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function apiError(status: number, code: string, message = 'Error de la API'): Response {
  return jsonResponse({ error: { code, message } }, status);
}

export function pageRequest(path: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(new URL(path, WEB_ORIGIN), {
    headers: cookie ? { cookie } : {},
  });
}

/** Cookie de `Set-Cookie` por nombre, con sus atributos en minúsculas. */
export function setCookie(response: Response, name: string): Record<string, string> | undefined {
  const raw = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  if (!raw) return undefined;
  const [pair, ...attributes] = raw.split(';').map((part) => part.trim());
  const result: Record<string, string> = { value: pair!.slice(name.length + 1) };
  for (const attribute of attributes) {
    const [key, value = 'true'] = attribute.split('=');
    result[key!.toLowerCase()] = value;
  }
  return result;
}
