import { ApiErrorCode, Role } from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/features/auth/server/test-helpers';
import { fetchUsersPage, grantRole, revokeRole } from '../api/admin-client';
import { ADMIN_ID, adminUser, OTHER_ID, otherUser, THIRD_ID } from '../server/admin-test-data';
import { adminErrorMessage, requiresLogin } from './messages';
import {
  appendPage,
  canRevoke,
  formatDate,
  grantableRoles,
  grantDescription,
  replaceUser,
} from './users';

describe('mensajes de error de la gestión de roles', () => {
  it('tiene un mensaje propio en español para cada error de HU-108', () => {
    const fallback = adminErrorMessage('ALGO_RARO');
    const codes = [
      ApiErrorCode.CANNOT_REVOKE_OWN_ADMIN,
      ApiErrorCode.ROLE_NOT_GRANTABLE,
      ApiErrorCode.FORBIDDEN,
      ApiErrorCode.NOT_FOUND,
    ];
    const messages = codes.map(adminErrorMessage);
    for (const message of messages) expect(message).not.toBe(fallback);
    expect(new Set(messages).size).toBe(codes.length);
    expect(adminErrorMessage(ApiErrorCode.CANNOT_REVOKE_OWN_ADMIN)).toMatch(/propio rol/);
    expect(adminErrorMessage(ApiErrorCode.FORBIDDEN)).toMatch(/administradores/);
    expect(adminErrorMessage(ApiErrorCode.NOT_FOUND)).toMatch(/No encontramos/);
    expect(adminErrorMessage(ApiErrorCode.ROLE_NOT_GRANTABLE)).toMatch(/no se puede otorgar/);
    expect(fallback).toMatch(/Intenta de nuevo/);
  });

  it('detecta cuándo hay que volver a iniciar sesión', () => {
    expect(requiresLogin(ApiErrorCode.UNAUTHENTICATED)).toBe(true);
    expect(requiresLogin(ApiErrorCode.REFRESH_TOKEN_INVALID)).toBe(true);
    expect(requiresLogin(ApiErrorCode.FORBIDDEN)).toBe(false);
  });
});

describe('reglas de la tabla', () => {
  it('no ofrece retirar el propio ADMIN ni roles que no son de personal', () => {
    const me = adminUser();
    expect(canRevoke(ADMIN_ID, me, Role.ADMIN)).toBe(false);
    expect(canRevoke(ADMIN_ID, me, Role.PASSENGER)).toBe(false);
    expect(canRevoke(ADMIN_ID, me, Role.DRIVER)).toBe(false);
    expect(canRevoke(ADMIN_ID, me, Role.DISPATCHER)).toBe(true);
    expect(canRevoke(ADMIN_ID, otherUser(), Role.ADMIN)).toBe(true);
  });

  it('ofrece otorgar solo los roles de personal que faltan', () => {
    expect(grantableRoles(adminUser())).toEqual([Role.DISPATCHER, Role.TOUR_OPERATOR]);
    expect(grantableRoles(otherUser())).toEqual([Role.TOUR_OPERATOR]);
  });

  it('describe quién y cuándo otorgó el rol, en hora de Colombia', () => {
    expect(formatDate('2026-01-01T03:05:00.000Z')).toBe('31 dic 2025, 22:05');
    expect(
      grantDescription({
        role: Role.ADMIN,
        grantedAt: '2026-11-18T20:00:00.000Z',
        grantedBy: 'ana@panter.test',
      }),
    ).toBe('Otorgado por ana@panter.test el 18 nov 2026, 15:00');
    expect(
      grantDescription({
        role: Role.PASSENGER,
        grantedAt: '2026-11-18T20:00:00Z',
        grantedBy: null,
      }),
    ).toBe('Otorgado automáticamente el 18 nov 2026, 15:00');
  });
});

describe('paginación', () => {
  it('"Cargar más" agrega la página siguiente sin duplicar y guarda el nuevo cursor', () => {
    const first = { items: [adminUser(), otherUser()], nextCursor: 'c2' };
    const second = {
      items: [otherUser(), adminUser({ id: THIRD_ID, email: 'tercero@panter.test' })],
      nextCursor: null,
    };
    const merged = appendPage(first, second);
    expect(merged.items.map((user) => user.id)).toEqual([ADMIN_ID, OTHER_ID, THIRD_ID]);
    expect(merged.nextCursor).toBeNull();
  });

  it('reemplaza el usuario actualizado tras otorgar o retirar', () => {
    const state = { items: [adminUser(), otherUser()], nextCursor: 'c2' };
    const updated = otherUser({ roles: [] });
    expect(replaceUser(state, updated)).toEqual({
      items: [adminUser(), updated],
      nextCursor: 'c2',
    });
  });
});

describe('cliente del navegador (BFF)', () => {
  const ORIGIN = 'https://web.panter.test';

  it('pide la página siguiente a /api/admin/users con q y cursor, sin Authorization', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ items: [otherUser()], nextCursor: 'c3' })),
    );
    const page = await fetchUsersPage(
      { q: 'panter', cursor: 'c2' },
      { baseUrl: ORIGIN, fetch: fetchMock },
    );
    expect(page.nextCursor).toBe('c3');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${ORIGIN}/api/admin/users?q=panter&cursor=c2`);
    expect((init!.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('otorga con POST y retira con DELETE en las rutas BFF', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(otherUser())));
    const config = { baseUrl: ORIGIN, fetch: fetchMock };
    await grantRole(OTHER_ID, Role.TOUR_OPERATOR, config);
    await revokeRole(OTHER_ID, Role.DISPATCHER, config);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${ORIGIN}/api/admin/users/${OTHER_ID}/roles`);
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST');
    expect(fetchMock.mock.calls[0]![1]!.body).toBe('{"role":"TOUR_OPERATOR"}');
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      `${ORIGIN}/api/admin/users/${OTHER_ID}/roles/DISPATCHER`,
    );
    expect(fetchMock.mock.calls[1]![1]!.method).toBe('DELETE');
  });
});
