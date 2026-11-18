import {
  ApiErrorCode,
  AuthRoutes,
  ConsentRoutes,
  type ConsentStatus,
  type MeResponse,
  PRIVACY_POLICY,
  PRIVACY_POLICY_VERSION,
} from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { resolveRootGroup } from '../../navigation/root-group';
import { ERROR_MESSAGES } from '../../shared/api/error-messages';
import { ClientErrorCode, type ApiError } from '../../shared/api/errors';
import { createHttpClient } from '../../shared/api/http-client';
import {
  apiError,
  BASE_URL,
  deferred,
  fakeFetch,
  jsonResponse,
  makeTokenPair,
  makeUser,
  type RecordedRequest,
  type Route,
} from '../../test/fake-api';
import { createAuthApi } from '../auth/api/auth-api';
import { SessionManager } from '../auth/session/session-manager';
import { createMemoryKeyValueStore, createSessionStorage } from '../auth/session/session-storage';
import { acceptConsent, outcomeMessage } from './accept-consent';
import { createConsentApi } from './api/consent-api';

const START = 1_800_000_000_000;
const NEXT_VERSION = '2027-03-v2';

function consent(overrides: Partial<ConsentStatus> = {}): ConsentStatus {
  return {
    currentVersion: PRIVACY_POLICY_VERSION,
    acceptedVersion: null,
    acceptedAt: null,
    required: true,
    ...overrides,
  };
}

const ACCEPTED = consent({
  acceptedVersion: PRIVACY_POLICY_VERSION,
  acceptedAt: '2026-11-18T15:00:00.000Z',
  required: false,
});

/** App con la API simulada y una sesión iniciada con `user`. */
async function setup(route: Route, user: MeResponse = makeUser({ consent: consent() })) {
  const kv = createMemoryKeyValueStore();
  const storage = createSessionStorage(kv);
  const fetch = fakeFetch(route);
  const http = createHttpClient({ baseUrl: BASE_URL, fetch });
  const manager = new SessionManager({ api: createAuthApi(http), storage, now: () => START });
  http.setAuthHandler(manager);
  await manager.load();
  await manager.signIn(makeTokenPair(1, { user }));
  const api = createConsentApi(http);
  const accept = () => acceptConsent({ api, session: manager });
  const group = () => resolveRootGroup(manager.getState());
  return { fetch, storage, manager, api, accept, group };
}

const consentCalls = (calls: RecordedRequest[]) =>
  calls.filter((c) => c.path === ConsentRoutes.ME_CONSENT);

describe('acceptConsent', () => {
  it('envía POST /me/consent con la versión del aviso y accepted: true, con el token', async () => {
    const t = await setup(() => jsonResponse(200, ACCEPTED));
    expect(t.group()).toBe('(consent)');

    await expect(t.accept()).resolves.toEqual({ outcome: 'accepted' });

    const [call] = consentCalls(t.fetch.calls);
    expect(call).toMatchObject({
      method: 'POST',
      body: { version: PRIVACY_POLICY_VERSION, accepted: true },
      headers: { Authorization: 'Bearer access-1' },
    });
    expect(PRIVACY_POLICY.version).toBe(PRIVACY_POLICY_VERSION);
  });

  it('con la respuesta actualiza la sesión y la navegación sigue a su grupo', async () => {
    const t = await setup(
      () => jsonResponse(200, ACCEPTED),
      makeUser({
        roles: ['PASSENGER', 'DRIVER'],
        activeMode: 'driver',
        consent: consent(),
      }),
    );
    await t.accept();
    expect(t.manager.getState().user?.consent).toEqual(ACCEPTED);
    expect(t.group()).toBe('(driver)');
    // También queda guardado: al reabrir sin red no vuelve a pedirlo.
    expect((await t.storage.load())?.user.consent).toEqual(ACCEPTED);
  });

  it('CONSENT_VERSION_OUTDATED: refresca GET /me y vuelve a mostrar el aviso', async () => {
    const me = makeUser({ fullName: 'Ana', consent: consent({ acceptedVersion: '2026-01-v0' }) });
    const t = await setup((req) => {
      if (req.path === ConsentRoutes.ME_CONSENT) {
        return apiError(409, ApiErrorCode.CONSENT_VERSION_OUTDATED);
      }
      if (req.path === AuthRoutes.ME) return jsonResponse(200, me);
      return jsonResponse(500, {});
    });

    const result = await t.accept();
    expect(result).toEqual({ outcome: 'outdated' });
    expect(outcomeMessage(result)).toBe(ERROR_MESSAGES.CONSENT_VERSION_OUTDATED);
    expect(t.fetch.calls.map((c) => c.path)).toEqual([ConsentRoutes.ME_CONSENT, AuthRoutes.ME]);
    expect(t.manager.getState().user?.fullName).toBe('Ana');
    expect(t.group()).toBe('(consent)');
  });

  it('si la versión vigente no es la del texto de la app, pide actualizar la app', async () => {
    const t = await setup((req) =>
      req.path === ConsentRoutes.ME_CONSENT
        ? apiError(409, ApiErrorCode.CONSENT_VERSION_OUTDATED)
        : jsonResponse(200, makeUser({ consent: consent({ currentVersion: NEXT_VERSION }) })),
    );
    const result = await t.accept();
    expect(result).toEqual({ outcome: 'appOutdated' });
    expect(outcomeMessage(result)).toBe(ERROR_MESSAGES[ClientErrorCode.CONSENT_APP_OUTDATED]);
    expect(t.group()).toBe('(consent)');
  });

  it('si la API responde que sigue pendiente, no sale del aviso', async () => {
    const t = await setup(() => jsonResponse(200, consent({ currentVersion: NEXT_VERSION })));
    await expect(t.accept()).resolves.toEqual({ outcome: 'appOutdated' });
    expect(t.group()).toBe('(consent)');
  });

  it.each([
    ['sin red', () => Promise.reject(new TypeError('Network request failed')), 'NETWORK_ERROR'],
    ['error del servidor', () => apiError(500, 'INTERNAL_ERROR'), 'INTERNAL_ERROR'],
    ['validación', () => apiError(400, 'VALIDATION_ERROR'), 'VALIDATION_ERROR'],
    ['respuesta fuera de contrato', () => jsonResponse(200, { ok: true }), 'INVALID_RESPONSE'],
  ] as [string, Route, string][])(
    '%s: lanza el error y la sesión sigue en el aviso',
    async (_name, route, code) => {
      const t = await setup(route);
      await expect(t.accept()).rejects.toMatchObject({ code } satisfies Partial<ApiError>);
      expect(t.manager.getState().status).toBe('signedIn');
      expect(t.group()).toBe('(consent)');
    },
  );

  it('si la sesión se cerró mientras se aceptaba, no la revive', async () => {
    const response = deferred<Response>();
    const t = await setup((req) =>
      req.path === ConsentRoutes.ME_CONSENT ? response.promise : jsonResponse(200, {}),
    );
    const pending = t.accept();
    await vi.waitFor(() => expect(consentCalls(t.fetch.calls)).toHaveLength(1));
    await t.manager.signOut();
    response.resolve(jsonResponse(200, ACCEPTED));
    await pending;
    expect(t.manager.getState().status).toBe('signedOut');
    expect(t.group()).toBe('(auth)');
  });

  it('un GET /me que salió antes de aceptar no vuelve a pedir el aviso', async () => {
    const me = deferred<Response>();
    const t = await setup((req) =>
      req.path === AuthRoutes.ME ? me.promise : jsonResponse(200, ACCEPTED),
    );
    const refreshing = t.manager.refreshProfile();
    await vi.waitFor(() => expect(t.fetch.calls).toHaveLength(1));
    await t.accept();
    me.resolve(jsonResponse(200, makeUser({ fullName: 'Ana', consent: consent() })));
    await refreshing;
    expect(t.manager.getState().user).toMatchObject({ fullName: 'Ana', consent: ACCEPTED });
    expect(t.group()).toBe('(passenger)');
  });
});

describe('consentimiento en la sesión', () => {
  it('una versión nueva en GET /me al abrir vuelve a pedir el aviso', async () => {
    const t = await setup(
      () =>
        jsonResponse(
          200,
          makeUser({
            consent: consent({
              currentVersion: NEXT_VERSION,
              acceptedVersion: PRIVACY_POLICY_VERSION,
            }),
          }),
        ),
      makeUser({ consent: ACCEPTED }),
    );
    expect(t.group()).toBe('(passenger)');
    await t.manager.refreshProfile();
    expect(t.group()).toBe('(consent)');
  });

  it('si la API aún no envía consent, no bloquea', async () => {
    const t = await setup(() => jsonResponse(200, makeUser()), makeUser());
    await t.manager.refreshProfile();
    expect(t.manager.getState().user?.consent).toBeUndefined();
    expect(t.group()).toBe('(passenger)');
  });

  it('"No acepto" cierra la sesión con el motivo CONSENT_DECLINED para el login', async () => {
    const t = await setup(() => new Response(null, { status: 204 }));
    await t.manager.signOut(ClientErrorCode.CONSENT_DECLINED);
    expect(t.manager.getState()).toMatchObject({
      status: 'signedOut',
      signedOutReason: 'CONSENT_DECLINED',
    });
    expect(t.group()).toBe('(auth)');
    expect(await t.storage.load()).toBeNull();
    expect(t.fetch.calls.map((c) => c.path)).toContain(AuthRoutes.LOGOUT);
    expect(ERROR_MESSAGES.CONSENT_DECLINED).toMatch(/no es posible usar PANTER/);
  });
});

describe('aviso de privacidad', () => {
  it('trae título, versión vigente y secciones con texto', () => {
    expect(PRIVACY_POLICY.title).not.toBe('');
    expect(PRIVACY_POLICY.version).toBe(PRIVACY_POLICY_VERSION);
    expect(PRIVACY_POLICY.sections.length).toBeGreaterThan(0);
    for (const section of PRIVACY_POLICY.sections) {
      expect(section.title).not.toBe('');
      expect(section.paragraphs.length).toBeGreaterThan(0);
    }
  });
});
