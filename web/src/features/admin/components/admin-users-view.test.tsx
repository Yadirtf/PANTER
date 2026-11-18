import { ApiErrorCode } from '@panter/contracts';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { API_URL, apiError, jsonResponse } from '@/features/auth/server/test-helpers';
import { ADMIN_ERROR_MESSAGES } from '../lib/messages';
import { createAdminApi } from '../server/admin-api';
import { ADMIN_ID, adminUser, otherUser } from '../server/admin-test-data';
import { loadAdminUsers } from '../server/load-admin-users';
import { AdminUsersView } from './admin-users-view';

const ACCESS = 'eyJhbGciOiJSUzI1NiJ9.secreto-del-access.firma';
const REFRESH = 'rt-secreto-de-la-cookie';
const TOKENS = { accessToken: ACCESS, refreshToken: REFRESH };

function apiWith(response: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  return { fetchMock, admin: createAdminApi({ apiUrl: API_URL, fetch: fetchMock }) };
}

/** Lo que haría la página /admin/usuarios: carga en el servidor y renderiza a HTML. */
async function renderPage(response: () => Response, query = '') {
  const { fetchMock, admin } = apiWith(response);
  const load = await loadAdminUsers(admin, TOKENS, query);
  if (load.kind === 'renew' || load.kind === 'consent')
    throw new Error(`Carga inesperada: ${load.kind}`);
  const html = renderToString(
    <AdminUsersView query={query} load={load} currentUserId={ADMIN_ID} />,
  );
  return { html, fetchMock };
}

describe('/admin/usuarios (render del servidor)', () => {
  it('carga con Bearer en el servidor y el token nunca llega al HTML', async () => {
    const { html, fetchMock } = await renderPage(
      () => jsonResponse({ items: [adminUser(), otherUser()], nextCursor: 'c2' }),
      'panter',
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get('q')).toBe('panter');
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS}`);
    expect(html).not.toContain(ACCESS);
    expect(html).not.toContain('secreto-del-access');
    expect(html).not.toContain(REFRESH);
  });

  it('muestra correo, nombre, estado, roles y quién y cuándo los otorgó', async () => {
    const { html } = await renderPage(() =>
      jsonResponse({ items: [adminUser(), otherUser()], nextCursor: null }),
    );

    expect(html).toContain('admin@panter.test');
    expect(html).toContain('Ana Administradora');
    expect(html).toContain('Activa');
    expect(html).toContain('Administrador');
    expect(html).toContain('Despacho');
    expect(html).toContain('Otorgado por raiz@panter.test el');
    expect(html).toContain('Otorgado automáticamente el');
    // 2 nov 2026 15:30 UTC = 10:30 a. m. en Colombia.
    expect(html).toContain('Otorgado por raiz@panter.test el 2 nov 2026, 10:30');
  });

  it('el administrador no ve "Retirar" en su propio ADMIN, pero sí en el de otros', async () => {
    const self = renderToString(
      <AdminUsersView
        query=""
        load={{ kind: 'ok', data: { items: [adminUser()], nextCursor: null } }}
        currentUserId={ADMIN_ID}
      />,
    );
    expect(self).not.toContain('Retirar');

    const other = renderToString(
      <AdminUsersView
        query=""
        load={{ kind: 'ok', data: { items: [otherUser()], nextCursor: null } }}
        currentUserId={ADMIN_ID}
      />,
    );
    // ADMIN y DISPATCHER del otro usuario; PASSENGER nunca se retira desde aquí.
    expect(other.match(/>Retirar</g)).toHaveLength(2);
  });

  it('ofrece "Cargar más" solo si hay nextCursor', async () => {
    const withMore = await renderPage(() =>
      jsonResponse({ items: [otherUser()], nextCursor: 'c2' }),
    );
    expect(withMore.html).toContain('Cargar más');
    const last = await renderPage(() => jsonResponse({ items: [otherUser()], nextCursor: null }));
    expect(last.html).not.toContain('Cargar más');
  });

  it('muestra un mensaje en español si la API rechaza la carga', async () => {
    for (const code of [ApiErrorCode.FORBIDDEN, ApiErrorCode.NOT_FOUND]) {
      const { html } = await renderPage(() => apiError(code === 'FORBIDDEN' ? 403 : 404, code));
      expect(html).toContain(ADMIN_ERROR_MESSAGES[code]!.replace(/"/g, '&quot;'));
    }
  });

  it('pide renovar la sesión si la API responde TOKEN_EXPIRED (sin refrescar en el render)', async () => {
    const { admin, fetchMock } = apiWith(() => apiError(401, ApiErrorCode.TOKEN_EXPIRED));
    expect(await loadAdminUsers(admin, TOKENS, '')).toEqual({ kind: 'renew' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await loadAdminUsers(admin, { refreshToken: REFRESH }, '')).toEqual({ kind: 'renew' });
  });

  it('lleva al aviso de privacidad si la API responde CONSENT_REQUIRED (HU-109)', async () => {
    const { admin } = apiWith(() => apiError(403, ApiErrorCode.CONSENT_REQUIRED));
    expect(await loadAdminUsers(admin, TOKENS, '')).toEqual({ kind: 'consent' });
  });
});
