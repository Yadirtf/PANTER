import { AccessTokenClaimsSchema, type AccessTokenClaims } from '@panter/contracts';
import { decodeJwt } from 'jose';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from './cookies';

/**
 * Claims de la sesión actual para pintar la interfaz (Server Components). El middleware ya
 * verificó la firma en esta misma petición; aquí solo se decodifica. No sirve para autorizar:
 * eso lo hace la API.
 */
export async function readSessionClaims(): Promise<AccessTokenClaims | null> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const parsed = AccessTokenClaimsSchema.safeParse(decodeJwt(token));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
