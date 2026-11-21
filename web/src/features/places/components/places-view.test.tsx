import { ApiErrorCode } from '@panter/contracts';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminDashboardPlaceholder } from '@/features/admin/components/admin-dashboard-placeholder';
import { API_URL, apiError, jsonResponse } from '@/features/auth/server/test-helpers';
import { createCatalogApi } from '@/features/catalog/server/catalog-api';
import { ALL_PLACES } from '@/features/catalog/server/catalog-test-data';
import { loadPlacesPage } from '@/features/catalog/server/load-catalog';
import { mockFetch, type Handler } from '@/features/drivers/server/drivers-test-data';
import { FaresView } from '@/features/fares/components/fares-view';
import { CONFIG } from '@/features/fares/server/fares-test-data';
import { ADMIN_PLACES_PATH } from '../lib/places';
import { PLACES_MAP_HELP, UNVERIFIED_BADGE } from './places-editor';
import { PlacesView } from './places-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ACCESS = 'eyJhbGciOiJSUzI1NiJ9.secreto-del-access.firma';
const REFRESH = 'rt-secreto-de-la-cookie';
const TOKENS = { accessToken: ACCESS, refreshToken: REFRESH };

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

async function render(routes: Record<string, Handler>) {
  const fetchMock = mockFetch(routes);
  const load = await loadPlacesPage(
    createCatalogApi({ apiUrl: API_URL, fetch: fetchMock }),
    TOKENS,
  );
  if (load.kind === 'renew' || load.kind === 'consent') throw new Error(load.kind);
  return { fetchMock, html: renderToString(<PlacesView places={load} />) };
}

const OK: Record<string, Handler> = { 'GET /places': () => jsonResponse({ items: ALL_PLACES }) };

describe('/admin/lugares (render del servidor)', () => {
  it('lista con Bearer (incluye desactivados) y el token nunca llega al HTML', async () => {
    const { fetchMock, html } = await render(OK);
    const [url, init] = fetchMock.mock.calls[0]!;
    const query = new URL(String(url)).searchParams;
    expect(query.get('includeInactive')).toBe('true');
    expect(query.get('limit')).toBe('100');
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS}`);
    expect(html).not.toContain(ACCESS);
    expect(html).not.toContain('secreto-del-access');
    expect(html).not.toContain(REFRESH);
  });

  it('mapa, categorías en español, "Sin verificar", barrio calculado y desactivados', async () => {
    const { html } = await render(OK);
    expect(html).toContain('data-panter-map="Mapa de lugares de Villagarzón"');
    expect(html).toContain(escape(PLACES_MAP_HELP));
    for (const label of ['Aeropuerto', 'Parque', 'Sitio turístico', 'Salud']) {
      expect(html).toContain(`>${label}</span>`);
    }
    // Parque principal y Pozo Azul (semilla) no están verificados.
    expect(html.split(`>${UNVERIFIED_BADGE}</span>`)).toHaveLength(3);
    expect(html).toContain('Barrio Centro · 1,02950; −76,61650');
    expect(html).toContain('Desactivado');
    expect(html).toContain('Nuevo lugar');
    expect(html).toContain('4 en total.');
  });

  it('error de la API: mensaje en español', async () => {
    const { html } = await render({ 'GET /places': () => apiError(403, ApiErrorCode.FORBIDDEN) });
    expect(html).toContain('solo para administradores');
  });
});

describe('panel /admin y /admin/tarifas', () => {
  it('enlace "Lugares"', () => {
    const html = renderToString(<AdminDashboardPlaceholder />);
    expect(html).toContain(`href="${ADMIN_PLACES_PATH}"`);
    expect(html).toContain('>Lugares<');
  });

  it('/admin/tarifas sigue mostrando su mapa con los lugares del catálogo como capa', () => {
    const html = renderToString(
      <FaresView
        config={{ kind: 'ok', data: CONFIG }}
        history={{ kind: 'ok', data: { items: [], nextCursor: null } }}
        places={ALL_PLACES}
      />,
    );
    expect(html).toContain('data-panter-map="Mapa de geocercas de Villagarzón"');
  });
});
