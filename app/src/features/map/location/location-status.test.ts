import { PLACES } from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  canCenterOnUser,
  checkLocationAccess,
  type LocationApi,
  locationNotice,
  type PermissionInfo,
  statusForPosition,
} from './location-status';

function fakeApi(opts: {
  permission: PermissionInfo;
  afterRequest?: PermissionInfo;
  services?: boolean;
}) {
  const api = {
    getPermission: vi.fn(async () => opts.permission),
    requestPermission: vi.fn(async () => opts.afterRequest ?? opts.permission),
    servicesEnabled: vi.fn(async () => opts.services ?? true),
  } satisfies LocationApi;
  return api;
}

describe('checkLocationAccess', () => {
  it('con permiso y GPS → lista para leer la posición, sin volver a preguntar', async () => {
    const api = fakeApi({ permission: { granted: true, canAskAgain: true } });
    expect(await checkLocationAccess(api, { request: true })).toEqual({ kind: 'locating' });
    expect(api.requestPermission).not.toHaveBeenCalled();
  });

  it('pide el permiso la primera vez y sigue si lo conceden', async () => {
    const api = fakeApi({
      permission: { granted: false, canAskAgain: true },
      afterRequest: { granted: true, canAskAgain: true },
    });
    expect(await checkLocationAccess(api, { request: true })).toEqual({ kind: 'locating' });
    expect(api.requestPermission).toHaveBeenCalledOnce();
  });

  it('permiso negado: se puede volver a pedir', async () => {
    const api = fakeApi({ permission: { granted: false, canAskAgain: true } });
    expect(await checkLocationAccess(api, { request: false })).toEqual({
      kind: 'denied',
      canAskAgain: true,
    });
    expect(api.requestPermission).not.toHaveBeenCalled();
  });

  it('permiso bloqueado ("no volver a preguntar"): no insiste y lleva a Ajustes', async () => {
    const api = fakeApi({ permission: { granted: false, canAskAgain: false } });
    const status = await checkLocationAccess(api, { request: true });
    expect(status).toEqual({ kind: 'denied', canAskAgain: false });
    expect(api.requestPermission).not.toHaveBeenCalled();
    expect(locationNotice(status)?.action).toEqual({ kind: 'settings', label: 'Abrir Ajustes' });
  });

  it('GPS apagado', async () => {
    const api = fakeApi({ permission: { granted: true, canAskAgain: true }, services: false });
    const status = await checkLocationAccess(api, { request: true });
    expect(status).toEqual({ kind: 'services-off' });
    expect(locationNotice(status)).toMatchObject({
      title: 'El GPS está apagado',
      action: { kind: 'enable-gps' },
    });
  });
});

describe('posición y avisos', () => {
  it('dentro del área de servicio: sin aviso y se puede centrar', () => {
    const status = statusForPosition(PLACES.VILLAGARZON_CENTER);
    expect(status.kind).toBe('ok');
    expect(locationNotice(status)).toBeNull();
    expect(canCenterOnUser(status)).toBe(true);
  });

  it('fuera del área (p. ej. Bogotá): aviso claro y el mapa sigue', () => {
    const status = statusForPosition({ lat: 4.711, lng: -74.0721 });
    expect(status.kind).toBe('outside');
    expect(locationNotice(status)).toMatchObject({
      title: 'Estás fuera de la zona de servicio',
      action: null,
    });
    expect(locationNotice(status)?.body).toContain('Villagarzón');
    expect(canCenterOnUser(status)).toBe(false);
  });

  it('permiso negado con opción de pedirlo de nuevo', () => {
    expect(locationNotice({ kind: 'denied', canAskAgain: true })?.action).toEqual({
      kind: 'request',
      label: 'Permitir ubicación',
    });
  });

  it('sin lectura de posición: ofrece reintentar', () => {
    expect(locationNotice({ kind: 'unavailable' })?.action?.kind).toBe('retry');
    expect(locationNotice({ kind: 'checking' })).toBeNull();
    expect(locationNotice({ kind: 'locating' })).toBeNull();
  });
});
