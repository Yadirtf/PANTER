import { ApiErrorCode } from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/features/auth/server/test-helpers';
import { formatCop, formatDate } from '@/shared/lib/format';
import {
  driverAction,
  fetchDocumentViewUrl,
  fetchDriversPage,
  reviewDocument,
} from '../api/drivers-client';
import { completeDriver, DRIVER_2_ID, DRIVER_ID, pendingDriver } from '../server/drivers-test-data';
import {
  actionsFor,
  appendDriversPage,
  approveBlockedReason,
  documentsNotApproved,
  documentsSummary,
  driverName,
  driversListPath,
  formatPlate,
  parseDriversFilter,
  pendingCountLabel,
  statusForApi,
} from './drivers';
import { driverErrorMessage } from './messages';

describe('placas en formato visual', () => {
  it('separa letras y números: moto "ABC 12D" y carro "ABC 123"', () => {
    expect(formatPlate('ABC12D')).toBe('ABC 12D');
    expect(formatPlate('TQX123')).toBe('TQX 123');
    expect(formatPlate('abc-12d')).toBe('ABC 12D');
    expect(formatPlate('XYZ')).toBe('XYZ');
  });
});

describe('filtro por estado', () => {
  it('PENDING por defecto; acepta estados válidos y "todos"', () => {
    expect(parseDriversFilter(undefined)).toBe('PENDING');
    expect(parseDriversFilter('cualquiera')).toBe('PENDING');
    expect(parseDriversFilter('approved')).toBe('APPROVED');
    expect(parseDriversFilter(['SUSPENDED'])).toBe('PENDING');
    expect(parseDriversFilter('todos')).toBe('todos');
    expect(statusForApi('todos')).toBeUndefined();
    expect(statusForApi('REJECTED')).toBe('REJECTED');
    expect(driversListPath('PENDING')).toBe('/admin/conductores');
    expect(driversListPath('SUSPENDED')).toBe('/admin/conductores?estado=SUSPENDED');
  });
});

describe('documentos', () => {
  it('cuenta subidos, aprobados y faltantes con sus etiquetas', () => {
    expect(documentsSummary(pendingDriver())).toEqual({
      uploaded: 3,
      required: 5,
      approved: 1,
      missing: ['SOAT vigente', 'Revisión técnico-mecánica vigente'],
    });
    expect(documentsSummary(completeDriver()).missing).toEqual([]);
  });

  it('aprobar exige los 5 documentos aprobados y explica cuáles faltan', () => {
    expect(documentsNotApproved(pendingDriver())).toEqual([
      'LICENCIA',
      'TARJETA_PROPIEDAD',
      'SOAT',
      'TECNOMECANICA',
    ]);
    const reason = approveBlockedReason(pendingDriver());
    expect(reason).toMatch(/5 documentos deben estar aprobados/);
    expect(reason).toContain('Licencia de conducción');
    expect(reason).toContain('SOAT vigente');
    expect(reason).not.toContain('Cédula');
    expect(approveBlockedReason(completeDriver())).toBeNull();
  });
});

describe('acciones según el estado', () => {
  it('ofrece solo las transiciones que aplican', () => {
    expect(actionsFor('PENDING')).toEqual(['approve', 'reject']);
    expect(actionsFor('REJECTED')).toEqual(['approve']);
    expect(actionsFor('APPROVED')).toEqual(['suspend']);
    expect(actionsFor('SUSPENDED')).toEqual(['reinstate']);
  });

  it('usa el nombre o, si no hay, el correo', () => {
    expect(driverName(pendingDriver())).toBe('Carlos Mototaxista');
    expect(driverName(completeDriver())).toBe('taxi@panter.test');
  });
});

describe('paginación y contador', () => {
  it('"Cargar más" agrega sin duplicar', () => {
    const merged = appendDriversPage(
      { items: [pendingDriver()], nextCursor: 'c2' },
      { items: [pendingDriver(), completeDriver()], nextCursor: null },
    );
    expect(merged.items.map((d) => d.userId)).toEqual([DRIVER_ID, DRIVER_2_ID]);
    expect(merged.nextCursor).toBeNull();
  });

  it('muestra "N+" si hay más páginas de pendientes', () => {
    expect(pendingCountLabel({ items: [pendingDriver()], nextCursor: null })).toBe('1');
    expect(pendingCountLabel({ items: [pendingDriver()], nextCursor: 'x' })).toBe('1+');
  });
});

describe('mensajes de error en español', () => {
  it('tiene un mensaje propio para los errores de HU-204', () => {
    const fallback = driverErrorMessage('ALGO_RARO');
    const codes = [
      ApiErrorCode.DOCUMENTS_INCOMPLETE,
      ApiErrorCode.INVALID_DRIVER_TRANSITION,
      ApiErrorCode.NOT_FOUND,
      ApiErrorCode.FORBIDDEN,
    ];
    const messages = codes.map(driverErrorMessage);
    for (const message of messages) expect(message).not.toBe(fallback);
    expect(new Set(messages).size).toBe(codes.length);
    expect(driverErrorMessage(ApiErrorCode.DOCUMENTS_INCOMPLETE)).toMatch(/5 documentos/);
    expect(driverErrorMessage(ApiErrorCode.INVALID_DRIVER_TRANSITION)).toMatch(/estado actual/);
    expect(driverErrorMessage(ApiErrorCode.NOT_FOUND)).toMatch(/solicitud de conductor/);
    expect(driverErrorMessage(ApiErrorCode.FORBIDDEN)).toMatch(/solo para administradores/);
  });
});

describe('formatos compartidos', () => {
  it('fecha en hora de Colombia y pesos con separador de miles', () => {
    expect(formatDate('2026-11-10T14:00:00.000Z')).toBe('10 nov 2026, 09:00');
    expect(formatCop(3000)).toBe('$ 3.000');
    expect(formatCop(1_000_000)).toBe('$ 1.000.000');
    expect(formatCop(0)).toBe('$ 0');
    expect(formatCop(-500)).toBe('−$ 500');
  });
});

describe('cliente del navegador (BFF)', () => {
  const ORIGIN = 'https://web.panter.test';

  it('lista, URL firmada, revisión y acciones van a /api/admin/drivers sin Authorization', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ items: [], nextCursor: null })),
    );
    const config = { baseUrl: ORIGIN, fetch: fetchMock };
    await fetchDriversPage({ status: 'PENDING', cursor: 'c2' }, config);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ url: 'https://api.panter.test/f?sig=1', expiresAt: '2026-11-18T15:10:00Z' }),
    );
    await fetchDocumentViewUrl(DRIVER_ID, 'SOAT', config);
    await reviewDocument(DRIVER_ID, 'SOAT', { decision: 'REJECTED', reason: 'Vencido' }, config);
    await driverAction(DRIVER_ID, 'suspend', 'Quejas repetidas', config);
    await driverAction(DRIVER_ID, 'approve', undefined, config);

    const calls = fetchMock.mock.calls.map(([url, init]) => [
      init!.method,
      String(url).replace(ORIGIN, ''),
      init!.body,
    ]);
    expect(calls).toEqual([
      ['GET', '/api/admin/drivers?status=PENDING&cursor=c2', undefined],
      ['GET', `/api/admin/drivers/${DRIVER_ID}/documents/SOAT/view-url`, undefined],
      [
        'POST',
        `/api/admin/drivers/${DRIVER_ID}/documents/SOAT/review`,
        '{"decision":"REJECTED","reason":"Vencido"}',
      ],
      ['POST', `/api/admin/drivers/${DRIVER_ID}/suspend`, '{"reason":"Quejas repetidas"}'],
      ['POST', `/api/admin/drivers/${DRIVER_ID}/approve`, '{}'],
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init!.headers as Record<string, string>).authorization).toBeUndefined();
    }
  });
});
