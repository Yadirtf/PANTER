import { ApiErrorCode } from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/errors';
import { CENTRO } from '../server/catalog-test-data';
import { CatalogBffRoutes, createArea, fetchAreaDetails } from '../api/catalog-client';
import { CATALOG_ERROR_MESSAGES, catalogErrorMessage, catalogFailureMessage } from './messages';

describe('mensajes de error del catálogo', () => {
  it('INVALID_POLYGON muestra el motivo que dio la API (details.reason o el mensaje)', () => {
    expect(
      catalogFailureMessage({
        code: ApiErrorCode.INVALID_POLYGON,
        message: 'Polígono inválido',
        details: { reason: 'El polígono se cruza consigo mismo cerca de (1,0300; −76,6150).' },
      }),
    ).toBe(
      'La API rechazó el polígono: El polígono se cruza consigo mismo cerca de (1,0300; −76,6150). Corrígelo e intenta de nuevo.',
    );
    expect(
      catalogFailureMessage({
        code: ApiErrorCode.INVALID_POLYGON,
        message: 'El anillo exterior tiene menos de 4 puntos',
      }),
    ).toBe(
      'La API rechazó el polígono: El anillo exterior tiene menos de 4 puntos. Corrígelo e intenta de nuevo.',
    );
    expect(catalogFailureMessage({ code: ApiErrorCode.INVALID_POLYGON, message: '' })).toBe(
      CATALOG_ERROR_MESSAGES[ApiErrorCode.INVALID_POLYGON],
    );
  });

  it('AREA_NAME_TAKEN, fuera del área y errores genéricos en español', () => {
    expect(catalogErrorMessage(ApiErrorCode.AREA_NAME_TAKEN)).toBe(
      'Ya existe un barrio o vereda con ese nombre. Usa otro nombre o edita el que ya existe.',
    );
    expect(catalogFailureMessage({ code: ApiErrorCode.OUT_OF_SERVICE_AREA, message: 'x' })).toMatch(
      /fuera del área de servicio/,
    );
    expect(catalogErrorMessage(ApiErrorCode.FORBIDDEN)).toMatch(/solo para administradores/);
    expect(catalogErrorMessage('CODIGO_RARO')).toBe(
      'No pudimos guardar los cambios. Intenta de nuevo.',
    );
  });

  it('VALIDATION_ERROR con problemas del polígono los muestra', () => {
    expect(
      catalogFailureMessage({
        code: ApiErrorCode.VALIDATION_ERROR,
        message: 'Revisa los datos.',
        details: { issues: [{ path: 'polygon.0', message: 'Mínimo 3 puntos.' }] },
      }),
    ).toBe('Revisa los datos. Mínimo 3 puntos.');
  });
});

describe('cliente del navegador: solo el BFF del mismo origen, sin token', () => {
  const WEB = 'https://panter-web-staging.panter.workers.dev';

  it('crear un barrio: POST /api/admin/areas con el cuerpo JSON y sin Authorization', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(CENTRO, { headers: { 'content-type': 'application/json' } }),
    );
    const body = { name: 'Centro', kind: 'BARRIO' as const, polygon: CENTRO.polygon, source: null };
    const saved = await createArea(body, { baseUrl: WEB, fetch: fetchMock });
    expect(saved?.id).toBe(CENTRO.id);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${WEB}${CatalogBffRoutes.AREAS}`);
    expect(init!.method).toBe('POST');
    expect(JSON.parse(String(init!.body))).toEqual(body);
    expect(init!.headers as Record<string, string>).not.toHaveProperty('authorization');
  });

  it('los polígonos se piden por ids separados por comas', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ items: [CENTRO], missing: [] }),
    );
    await fetchAreaDetails([CENTRO.id, 'otro'], { baseUrl: WEB, fetch: fetchMock });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe(CatalogBffRoutes.AREA_DETAILS);
    expect(url.searchParams.get('ids')).toBe(`${CENTRO.id},otro`);
  });

  it('un error del BFF llega como ApiError con su código', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: ApiErrorCode.AREA_NAME_TAKEN, message: 'Nombre en uso' } },
        { status: 409 },
      ),
    );
    const failure = await createArea(
      { name: 'Centro', kind: 'BARRIO', polygon: CENTRO.polygon },
      { baseUrl: WEB, fetch: fetchMock },
    ).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe(ApiErrorCode.AREA_NAME_TAKEN);
  });
});
