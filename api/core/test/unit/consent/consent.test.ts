import {
  ApiErrorCode,
  ConsentStatusSchema,
  PRIVACY_POLICY,
  PRIVACY_POLICY_VERSION,
  PrivacyPolicyResponseSchema,
} from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  getPrivacyPolicy,
  makeAcceptConsent,
  makeGetConsentStatus,
} from '../../../src/modules/consent/application/consent';
import {
  consentEvidence,
  consentStatus,
  USER_AGENT_MAX_LENGTH,
} from '../../../src/modules/consent/domain/consent';
import { AppError } from '../../../src/shared/errors/app-error';
import { MemoryConsentRepository } from '../../support/consent-fakes';

const USER = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => {
      throw new Error('se esperaba un error');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe('estado del consentimiento (dominio)', () => {
  it('nunca aceptó → required', () => {
    expect(consentStatus(null, 'v2')).toEqual({
      currentVersion: 'v2',
      acceptedVersion: null,
      acceptedAt: null,
      required: true,
    });
  });

  it('aceptó una versión vieja → required; la vigente → no', () => {
    const at = '2026-11-18T12:00:00.000Z';
    expect(consentStatus({ version: 'v1', acceptedAt: at }, 'v2')).toMatchObject({
      acceptedVersion: 'v1',
      required: true,
    });
    const ok = consentStatus({ version: 'v2', acceptedAt: at }, 'v2');
    expect(ConsentStatusSchema.parse(ok)).toEqual({
      currentVersion: 'v2',
      acceptedVersion: 'v2',
      acceptedAt: at,
      required: false,
    });
  });

  it('evidencia: vacíos → null y User-Agent recortado', () => {
    expect(consentEvidence({})).toEqual({ ip: null, userAgent: null });
    expect(consentEvidence({ ip: ' 190.0.0.1 ', userAgent: '  ' })).toEqual({
      ip: '190.0.0.1',
      userAgent: null,
    });
    expect(consentEvidence({ userAgent: 'x'.repeat(2000) }).userAgent).toHaveLength(
      USER_AGENT_MAX_LENGTH,
    );
  });
});

describe('aceptar el aviso', () => {
  it('registra la versión vigente con IP y User-Agent, y devuelve el estado', async () => {
    const repo = new MemoryConsentRepository();
    const accept = makeAcceptConsent({ repo });
    const status = await accept({
      userId: USER,
      version: PRIVACY_POLICY_VERSION,
      accepted: true,
      ip: '190.1.2.3',
      userAgent: 'PANTER/1.0',
    });
    expect(status).toMatchObject({
      currentVersion: PRIVACY_POLICY_VERSION,
      acceptedVersion: PRIVACY_POLICY_VERSION,
      required: false,
    });
    expect(repo.accepted[0]).toMatchObject({ ip: '190.1.2.3', userAgent: 'PANTER/1.0' });
  });

  it('idempotente: aceptar dos veces conserva la primera fecha', async () => {
    const repo = new MemoryConsentRepository();
    const accept = makeAcceptConsent({ repo, currentVersion: 'v1' });
    const first = await accept({ userId: USER, version: 'v1', accepted: true });
    const second = await accept({ userId: USER, version: 'v1', accepted: true });
    expect(second.acceptedAt).toBe(first.acceptedAt);
    expect(repo.accepted).toHaveLength(1);
  });

  it('otra versión → 409 CONSENT_VERSION_OUTDATED con la vigente en details', async () => {
    const accept = makeAcceptConsent({ repo: new MemoryConsentRepository(), currentVersion: 'v2' });
    const err = await errorOf(accept({ userId: USER, version: 'v1', accepted: true }));
    expect([err.code, err.status, err.details]).toEqual([
      ApiErrorCode.CONSENT_VERSION_OUTDATED,
      409,
      { currentVersion: 'v2' },
    ]);
  });

  it('cuenta inexistente → 401 UNAUTHENTICATED', async () => {
    const repo = new MemoryConsentRepository();
    repo.knownUsers.add('otra');
    const err = await errorOf(
      makeAcceptConsent({ repo })({
        userId: USER,
        version: PRIVACY_POLICY_VERSION,
        accepted: true,
      }),
    );
    expect(err.status).toBe(401);
  });

  it('cambia la versión del aviso → se pide de nuevo', async () => {
    const repo = new MemoryConsentRepository();
    await makeAcceptConsent({ repo, currentVersion: 'v1' })({
      userId: USER,
      version: 'v1',
      accepted: true,
    });
    expect((await makeGetConsentStatus({ repo, currentVersion: 'v1' })(USER)).required).toBe(false);
    expect((await makeGetConsentStatus({ repo, currentVersion: 'v2' })(USER)).required).toBe(true);
    expect((await makeGetConsentStatus({ repo })(USER)).currentVersion).toBe(
      PRIVACY_POLICY.version,
    );
  });
});

describe('GET /privacy-policy (caso de uso)', () => {
  it('versión y vigencia desde contracts', () => {
    expect(PrivacyPolicyResponseSchema.parse(getPrivacyPolicy())).toEqual({
      version: PRIVACY_POLICY.version,
      effectiveFrom: PRIVACY_POLICY.effectiveFrom,
    });
  });
});
