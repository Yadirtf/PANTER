import { ApiErrorCode, DOCUMENT_LABELS, REQUIRED_DOCUMENTS } from '@panter/contracts';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminDashboardPlaceholder } from '@/features/admin/components/admin-dashboard-placeholder';
import { API_URL, apiError, jsonResponse } from '@/features/auth/server/test-helpers';
import { DRIVER_ERROR_MESSAGES } from '../lib/messages';
import { createDriversApi } from '../server/drivers-api';
import {
  completeDriver,
  DRIVER_ID,
  mockFetch,
  pendingDriver,
  type Handler,
} from '../server/drivers-test-data';
import { loadDriverDetail, loadDrivers, loadPendingCount } from '../server/load-drivers';
import { DriverDetailView } from './driver-detail-view';
import { DriversListView } from './drivers-list-view';

// DriverReview usa useRouter (refresh tras cada acción); en el render de prueba no hay App Router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ACCESS = 'eyJhbGciOiJSUzI1NiJ9.secreto-del-access.firma';
const REFRESH = 'rt-secreto-de-la-cookie';
const TOKENS = { accessToken: ACCESS, refreshToken: REFRESH };

function api(routes: Record<string, Handler | Handler[]>) {
  const fetchMock = mockFetch(routes);
  return { fetchMock, drivers: createDriversApi({ apiUrl: API_URL, fetch: fetchMock }) };
}

const escape = (text: string) => text.replace(/"/g, '&quot;');

function expectNoTokens(html: string) {
  expect(html).not.toContain(ACCESS);
  expect(html).not.toContain('secreto-del-access');
  expect(html).not.toContain(REFRESH);
}

describe('/admin/conductores (render del servidor)', () => {
  it('pide PENDING por defecto con Bearer y el token nunca llega al HTML', async () => {
    const { fetchMock, drivers } = api({
      'GET /admin/drivers': () =>
        jsonResponse({ items: [pendingDriver(), completeDriver()], nextCursor: 'c2' }),
    });
    const load = await loadDrivers(drivers, TOKENS, 'PENDING');
    if (load.kind !== 'ok') throw new Error(load.kind);
    const html = renderToString(<DriversListView filter="PENDING" load={load} />);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get('status')).toBe('PENDING');
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS}`);
    expectNoTokens(html);

    // Fila: nombre o correo, vehículo completo, documentos y fecha de solicitud.
    expect(html).toContain('Carlos Mototaxista');
    expect(html).toContain('taxi@panter.test');
    expect(html).toContain('Mototaxi');
    expect(html).toContain('ABC 12D');
    expect(html).toContain('TQX 123');
    expect(html).toContain('AKT NKD 125 · Rojo · 2022');
    expect(html).toContain('3<!-- --> de <!-- -->5<!-- --> subidos');
    expect(html).toContain('Faltan: <!-- -->SOAT vigente, Revisión técnico-mecánica vigente');
    expect(html).toContain('10 nov 2026, 09:00');
    expect(html).toContain(`href="/admin/conductores/${DRIVER_ID}"`);
    expect(html).toContain('Cargar más');
    expect(html).toMatch(/aria-current="page"[^>]*>Pendientes</);
  });

  it('"todos" no envía estado a la API', async () => {
    const { fetchMock, drivers } = api({
      'GET /admin/drivers': () => jsonResponse({ items: [], nextCursor: null }),
    });
    const load = await loadDrivers(drivers, TOKENS, 'todos');
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.has('status')).toBe(false);
    if (load.kind !== 'ok') throw new Error(load.kind);
    const html = renderToString(<DriversListView filter="todos" load={load} />);
    expect(html).toContain('No hay solicitudes en este estado.');
    expect(html).not.toContain('Cargar más');
  });

  it('mensajes en español si la API rechaza la carga; renew y consent', async () => {
    for (const [status, code] of [
      [403, ApiErrorCode.FORBIDDEN],
      [404, ApiErrorCode.NOT_FOUND],
    ] as const) {
      const { drivers } = api({ 'GET /admin/drivers': () => apiError(status, code) });
      const load = await loadDrivers(drivers, TOKENS, 'PENDING');
      if (load.kind !== 'error') throw new Error(load.kind);
      const html = renderToString(<DriversListView filter="PENDING" load={load} />);
      expect(html).toContain(escape(DRIVER_ERROR_MESSAGES[code]!));
    }
    const expired = api({ 'GET /admin/drivers': () => apiError(401, ApiErrorCode.TOKEN_EXPIRED) });
    expect(await loadDrivers(expired.drivers, TOKENS, 'PENDING')).toEqual({ kind: 'renew' });
    const consent = api({
      'GET /admin/drivers': () => apiError(403, ApiErrorCode.CONSENT_REQUIRED),
    });
    expect(await loadDrivers(consent.drivers, TOKENS, 'PENDING')).toEqual({ kind: 'consent' });
  });
});

describe('/admin/conductores/[userId] (render del servidor)', () => {
  const viewUrl = (type: string) => `https://api.panter.test/files/${type}?exp=1&sig=firma-${type}`;

  function detailApi(driver = pendingDriver()) {
    const routes: Record<string, Handler> = {
      [`GET /admin/drivers/${driver.userId}`]: () => jsonResponse(driver),
    };
    for (const type of REQUIRED_DOCUMENTS) {
      routes[`GET /admin/drivers/${driver.userId}/documents/${type}/view-url`] = () =>
        type === 'LICENCIA'
          ? apiError(500, ApiErrorCode.INTERNAL_ERROR)
          : jsonResponse({ url: viewUrl(type), expiresAt: '2026-11-18T15:10:00.000Z' });
    }
    return api(routes);
  }

  it('pide las URLs firmadas en el servidor y muestra los 5 documentos con su etiqueta', async () => {
    const { fetchMock, drivers } = detailApi();
    const load = await loadDriverDetail(drivers, TOKENS, DRIVER_ID);
    if (load.kind !== 'ok') throw new Error(load.kind);
    const html = renderToString(<DriverDetailView load={load} />);

    // Detalle + una URL por documento subido (3), todas con Bearer.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS}`);
    }
    expectNoTokens(html);
    for (const type of REQUIRED_DOCUMENTS) expect(html).toContain(DOCUMENT_LABELS[type]);
    expect(html).toContain(`src="${viewUrl('CEDULA').replace(/&/g, '&amp;')}"`);
    expect(html).toContain(`src="${viewUrl('TARJETA_PROPIEDAD').replace(/&/g, '&amp;')}"`);
    // La URL de LICENCIA falló: se ofrece volver a cargarla, sin romper la página.
    expect(html).toContain('Volver a cargar');
    expect(html).toContain('Sin subir');
    expect(html).toContain('Motivo: <!-- -->La foto está borrosa');
    expect(html.match(/>Aprobar documento</g)).toHaveLength(3);
    expect(html.match(/>Rechazar documento</g)).toHaveLength(3);
    expect(html).toContain('ABC 12D');
  });

  it('"Aprobar conductor" queda deshabilitado con la explicación si falta algún documento', async () => {
    const { drivers } = detailApi();
    const load = await loadDriverDetail(drivers, TOKENS, DRIVER_ID);
    if (load.kind !== 'ok') throw new Error(load.kind);
    const html = renderToString(<DriverDetailView load={load} />);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-describedby="aprobar-bloqueado"[^>]*>Aprobar conductor</,
    );
    expect(html).toContain('Para aprobar, los 5 documentos deben estar aprobados.');
    expect(html).toContain('Rechazar solicitud');
    expect(html).not.toContain('Suspender conductor');
  });

  it('con los 5 aprobados se puede aprobar; un aprobado solo se puede suspender', async () => {
    const complete = completeDriver();
    const ready = await loadDriverDetail(detailApi(complete).drivers, TOKENS, complete.userId);
    if (ready.kind !== 'ok') throw new Error(ready.kind);
    const readyHtml = renderToString(<DriverDetailView load={ready} />);
    expect(readyHtml).not.toContain('aprobar-bloqueado');
    expect(readyHtml).toMatch(/<button type="button" class="[^"]*">Aprobar conductor</);

    const approved = completeDriver({ verificationStatus: 'APPROVED' });
    const load = await loadDriverDetail(detailApi(approved).drivers, TOKENS, approved.userId);
    if (load.kind !== 'ok') throw new Error(load.kind);
    const html = renderToString(<DriverDetailView load={load} />);
    expect(html).toContain('Suspender conductor');
    expect(html).not.toContain('Aprobar conductor');
    expect(html).not.toContain('Reactivar conductor');

    const suspended = completeDriver({ verificationStatus: 'SUSPENDED' });
    const s = await loadDriverDetail(detailApi(suspended).drivers, TOKENS, suspended.userId);
    if (s.kind !== 'ok') throw new Error(s.kind);
    expect(renderToString(<DriverDetailView load={s} />)).toContain('Reactivar conductor');
  });

  it('NOT_FOUND y FORBIDDEN se muestran en español', async () => {
    for (const [status, code] of [
      [404, ApiErrorCode.NOT_FOUND],
      [403, ApiErrorCode.FORBIDDEN],
    ] as const) {
      const { drivers } = api({
        [`GET /admin/drivers/${DRIVER_ID}`]: () => apiError(status, code),
      });
      const load = await loadDriverDetail(drivers, TOKENS, DRIVER_ID);
      if (load.kind !== 'error') throw new Error(load.kind);
      expect(renderToString(<DriverDetailView load={load} />)).toContain(
        escape(DRIVER_ERROR_MESSAGES[code]!),
      );
    }
  });
});

describe('panel /admin', () => {
  it('muestra el enlace "Conductores" con el número de pendientes', async () => {
    const { fetchMock, drivers } = api({
      'GET /admin/drivers': () =>
        jsonResponse({ items: [pendingDriver(), completeDriver()], nextCursor: null }),
    });
    const page = await loadPendingCount(drivers, TOKENS);
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('limit')).toBe('100');
    expect(page?.items).toHaveLength(2);
    const html = renderToString(<AdminDashboardPlaceholder pendingDrivers="2" />);
    expect(html).toContain('href="/admin/conductores"');
    expect(html).toContain('aria-label="2 pendientes"');
    expectNoTokens(html);
    expect(renderToString(<AdminDashboardPlaceholder />)).toContain('Conductores');
    const failing = api({ 'GET /admin/drivers': () => apiError(500, 'INTERNAL_ERROR') });
    expect(await loadPendingCount(failing.drivers, TOKENS)).toBeNull();
  });
});
