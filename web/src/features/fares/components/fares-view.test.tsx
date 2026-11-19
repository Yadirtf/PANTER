import { ApiErrorCode } from '@panter/contracts';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminDashboardPlaceholder } from '@/features/admin/components/admin-dashboard-placeholder';
import { API_URL, apiError, jsonResponse } from '@/features/auth/server/test-helpers';
import { mockFetch, type Handler } from '@/features/drivers/server/drivers-test-data';
import { FARE_ERROR_MESSAGES } from '../lib/messages';
import { createFaresApi } from '../server/fares-api';
import { CONFIG, GEOFENCE_CHANGE, RULE_CHANGE } from '../server/fares-test-data';
import { faresRedirect, loadFaresPage } from '../server/load-fares';
import { PREVIEW_DISCLAIMER } from './fare-preview';
import { FaresView } from './fares-view';
import { MAP_HELP } from './geofences-editor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ACCESS = 'eyJhbGciOiJSUzI1NiJ9.secreto-del-access.firma';
const REFRESH = 'rt-secreto-de-la-cookie';
const TOKENS = { accessToken: ACCESS, refreshToken: REFRESH };

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

async function render(routes: Record<string, Handler>) {
  const fetchMock = mockFetch(routes);
  const load = await loadFaresPage(createFaresApi({ apiUrl: API_URL, fetch: fetchMock }), TOKENS);
  const { config, history } = load;
  if (config.kind === 'renew' || config.kind === 'consent') throw new Error(config.kind);
  if (history.kind === 'renew' || history.kind === 'consent') throw new Error(history.kind);
  return { fetchMock, html: renderToString(<FaresView config={config} history={history} />) };
}

const OK_ROUTES: Record<string, Handler> = {
  'GET /admin/fares': () => jsonResponse(CONFIG),
  'GET /admin/fares/history': () =>
    jsonResponse({ items: [RULE_CHANGE, GEOFENCE_CHANGE], nextCursor: 'c2' }),
};

describe('/admin/tarifas (render del servidor)', () => {
  it('carga con Bearer en el servidor y el token nunca llega al HTML', async () => {
    const { fetchMock, html } = await render(OK_ROUTES);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS}`);
    }
    expect(html).not.toContain(ACCESS);
    expect(html).not.toContain('secreto-del-access');
    expect(html).not.toContain(REFRESH);
  });

  it('una tarjeta por vehículo con montos "3.000", horas "20:00" y FLAT sin km ni minuto', async () => {
    const { html } = await render(OK_ROUTES);
    for (const label of ['Mototaxi', 'Taxi', 'Campero 4x4']) {
      expect(html).toContain(`>${label}</h3>`);
    }
    expect(html).toContain('id="MOTOTAXI-baseFare" type="text" inputMode="numeric"');
    expect(html).toMatch(/id="MOTOTAXI-baseFare"[^>]*value="3.000"/);
    expect(html).toMatch(/id="TAXI-nightStart" type="time"[^>]*value="20:00"/);
    expect(html).toMatch(/id="TAXI-nightEnd" type="time"[^>]*value="05:00"/);
    // FLAT (mototaxi) oculta por km y por minuto; METERED (taxi) los muestra.
    expect(html).not.toContain('id="MOTOTAXI-perKm"');
    expect(html).not.toContain('id="MOTOTAXI-perMinute"');
    expect(html).toContain('id="TAXI-perKm"');
    expect(html).toContain('id="TAXI-perMinute"');
    expect(html).toContain('de 8:00 p. m. a 5:00 a. m. (cruza la medianoche)');
  });

  it('vista previa de 3 casos con aviso de aproximación', async () => {
    const { html } = await render(OK_ROUTES);
    expect(html).toContain(escape(PREVIEW_DISCLAIMER));
    expect(html).toContain('Mototaxi en el centro');
    expect(html).toContain('Taxi del centro al aeropuerto');
    expect(html).toContain('Taxi del centro al aeropuerto, de noche');
    expect(html).toContain('Recargo Aeropuerto Cananguchal (VGZ)');
    expect(html).toContain('Recargo nocturno');
    expect(html.match(/Total aproximado/g)).toHaveLength(3);
    expect(html).toContain('$ 3.000');
  });

  it('geocercas en lista y sobre el mapa (cargado solo en el cliente)', async () => {
    const { html } = await render(OK_ROUTES);
    expect(html).toContain('Zona periférica de Villagarzón');
    expect(html).toContain('Zona periférica</dd>');
    expect(html).toContain('$ 5.000');
    expect(html).toContain('<dd>Mototaxi, Taxi</dd>');
    expect(html).toContain(escape(MAP_HELP));
    expect(html).toContain('Polígono: <!-- -->4 vértices y 1 hueco de 4 vértices');
    expect(html).toContain('Polígono: <!-- -->4 vértices</p>');
    // El mapa se arma en el navegador: en el HTML del servidor solo va su contenedor accesible.
    expect(html).toContain('data-panter-map="Mapa de geocercas de Villagarzón"');
    expect(html).toContain('Cargando el mapa…');
    expect(html).not.toContain('maplibregl-canvas');
    expect(html).toContain('Probar un punto');
    expect(html).toContain('Aeropuerto</li>');
  });

  it('historial con autor, fecha en hora de Colombia y diff legible', async () => {
    const { html } = await render(OK_ROUTES);
    expect(html).toContain('Tarifa de Taxi');
    expect(html).toContain('Geocerca Aeropuerto Cananguchal (VGZ)');
    expect(html).toContain('admin@panter.test<!-- --> · <!-- -->17 nov 2026, 20:30');
    expect(html).toContain('Sistema (valores iniciales)');
    expect(html).toContain('<del class="text-red-800 decoration-red-400">$ 6.000</del>');
    expect(html).toContain('$ 6.500</ins>');
    expect(html).toContain('19:00</ins>');
    expect(html).toContain('Cargar más');
  });

  it('mensajes en español si la API rechaza la carga', async () => {
    const { html } = await render({
      'GET /admin/fares': () => apiError(403, ApiErrorCode.FORBIDDEN),
      'GET /admin/fares/history': () => apiError(500, ApiErrorCode.INTERNAL_ERROR),
    });
    expect(html).toContain(escape(FARE_ERROR_MESSAGES[ApiErrorCode.FORBIDDEN]!));
    expect(html).toContain(escape(FARE_ERROR_MESSAGES[ApiErrorCode.INTERNAL_ERROR]!));
  });

  it('TOKEN_EXPIRED → renovar; CONSENT_REQUIRED → aviso de privacidad', async () => {
    const api = (code: string, status: number) =>
      createFaresApi({
        apiUrl: API_URL,
        fetch: mockFetch({
          'GET /admin/fares': () => apiError(status, code),
          'GET /admin/fares/history': () => jsonResponse({ items: [], nextCursor: null }),
        }),
      });
    expect(faresRedirect(await loadFaresPage(api(ApiErrorCode.TOKEN_EXPIRED, 401), TOKENS))).toBe(
      'renew',
    );
    expect(
      faresRedirect(await loadFaresPage(api(ApiErrorCode.CONSENT_REQUIRED, 403), TOKENS)),
    ).toBe('consent');
    expect(faresRedirect(await loadFaresPage(api(ApiErrorCode.NOT_FOUND, 404), TOKENS))).toBeNull();
  });

  it('el panel /admin enlaza a Tarifas', () => {
    expect(renderToString(<AdminDashboardPlaceholder />)).toContain('href="/admin/tarifas"');
  });
});
