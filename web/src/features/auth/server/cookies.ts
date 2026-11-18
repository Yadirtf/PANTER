import type { TokenPairResponse } from '@panter/contracts';
import type { NextResponse } from 'next/server';

/**
 * Cookies de sesión de la web (BFF). Son httpOnly: el JavaScript del navegador nunca ve los
 * tokens. El prefijo `__Host-` obliga a Secure, path=/ y sin Domain (no se comparten con
 * subdominios).
 */
export const ACCESS_COOKIE = '__Host-panter_at';
export const REFRESH_COOKIE = '__Host-panter_rt';
/** Marca de consentimiento (HU-109): ver consent-gate.ts. No contiene datos sensibles. */
export const CONSENT_COOKIE = '__Host-panter_consent';

const COOKIE_BASE = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

export type SessionTokens = Pick<
  TokenPairResponse,
  'accessToken' | 'expiresIn' | 'refreshToken' | 'refreshExpiresIn'
>;

/** Guarda el par de tokens; cada cookie vive lo mismo que su token. */
export function setSessionCookies(response: NextResponse, tokens: SessionTokens): void {
  response.cookies.set({
    ...COOKIE_BASE,
    name: ACCESS_COOKIE,
    value: tokens.accessToken,
    maxAge: tokens.expiresIn,
  });
  response.cookies.set({
    ...COOKIE_BASE,
    name: REFRESH_COOKIE,
    value: tokens.refreshToken,
    maxAge: tokens.refreshExpiresIn,
  });
}

export function setConsentCookie(response: NextResponse, value: string, maxAge: number): void {
  response.cookies.set({ ...COOKIE_BASE, name: CONSENT_COOKIE, value, maxAge });
}

export function clearConsentCookie(response: NextResponse): void {
  response.cookies.set({ ...COOKIE_BASE, name: CONSENT_COOKIE, value: '', maxAge: 0 });
}

export function clearSessionCookies(response: NextResponse): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CONSENT_COOKIE]) {
    response.cookies.set({ ...COOKIE_BASE, name, value: '', maxAge: 0 });
  }
}
