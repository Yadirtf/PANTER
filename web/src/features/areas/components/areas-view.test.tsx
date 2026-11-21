import { ApiErrorCode } from '@panter/contracts';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminDashboardPlaceholder } from '@/features/admin/components/admin-dashboard-placeholder';
import { API_URL, apiError, jsonResponse } from '@/features/auth/server/test-helpers';
import { CATALOG_ERROR_MESSAGES } from '@/features/catalog/lib/messages';
import { createCatalogApi } from '@/features/catalog/server/catalog-api';
import { ALL_AREAS, summary } from '@/features/catalog/server/catalog-test-data';
import { loadAreasPage } from '@/features/catalog/server/load-catalog';
import { mockFetch, type Handler } from '@/features/drivers/server/drivers-test-data';
import { ADMIN_AREAS_PATH } from '../lib/areas';
import { AREAS_MAP_HELP } from './areas-editor';
import { AreasView } from './areas-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ACCESS = 'eyJhbGciOiJSUzI1NiJ9.secreto-del-access.firma';
const REFRESH = 'rt-secreto-de-la-cookie';
const TOKENS = { accessToken: ACCESS, refreshToken: REFRESH };

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

async function render(routes: Record<string, Handler>) {
  const fetchMock = mockFetch(routes);
  const load = await loadAreasPage(createCatalogApi({ apiUrl: API_URL, fetch: fetchMock }), TOKENS);
  if (load.kind === 'renew' || load.kind === 'consent') throw new Error(load.kind);
  return { fetchMock, html: renderToString(<AreasView areas={load} />) };
}

const OK: Record<string, Handler> = {
  'GET /areas': () => jsonResponse({ items: ALL_AREAS.map(summary) }),
};

describe('/admin/barrios (render del servidor)', () => {
  it('lista con Bearer en el servidor (incluye desactivados) y el token nunca llega al HTML', async () => {
    const { fetchMock, html } = await render(OK);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get('includeInactive')).toBe('true');
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS}`);
    expect(html).not.toContain(ACCESS);
    expect(html).not.toContain('secreto-del-access');
    expect(html).not.toContain(REFRESH);
  });

  it('mapa, herramientas y una fila por barrio o vereda con su tipo y estado', async () => {
    const { html } = await render(OK);
    expect(html).toContain('data-panter-map="Mapa de barrios y veredas de Villagarzón"');
    expect(html).toContain(escape(AREAS_MAP_HELP));
    for (const label of ['Dibujar barrio o vereda', 'Probar un punto', 'Importar GeoJSON']) {
      expect(html).toContain(label);
    }
    for (const name of ['Centro', 'San José', 'Alto Sinaí', 'Centro viejo']) {
      expect(html).toContain(`>${name}<`);
    }
    expect(html).toContain('Desactivado');
    expect(html).toContain('>Activar<');
    expect(html).toContain('4 en total.');
    expect(html).toContain('Cargando polígonos (0 de 4)…');
  });

  it('error de la API: mensaje en español', async () => {
    const { html } = await render({ 'GET /areas': () => apiError(403, ApiErrorCode.FORBIDDEN) });
    expect(html).toContain(escape(CATALOG_ERROR_MESSAGES[ApiErrorCode.FORBIDDEN]!));
  });

  it('sesión vencida: la página debe renovarla', async () => {
    const load = await loadAreasPage(
      createCatalogApi({
        apiUrl: API_URL,
        fetch: mockFetch({ 'GET /areas': () => apiError(401, ApiErrorCode.TOKEN_EXPIRED) }),
      }),
      TOKENS,
    );
    expect(load).toEqual({ kind: 'renew' });
  });
});

describe('panel /admin', () => {
  it('enlace "Barrios y veredas"', () => {
    const html = renderToString(<AdminDashboardPlaceholder />);
    expect(html).toContain(`href="${ADMIN_AREAS_PATH}"`);
    expect(html).toContain('Barrios y veredas');
  });
});
