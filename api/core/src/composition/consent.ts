import type { Env } from '../env';
import { makeAcceptConsent, makeGetConsentStatus } from '../modules/consent/application/consent';
import type { ConsentRepository } from '../modules/consent/application/ports';
import { makeRequireConsent } from '../modules/consent/http/require-consent';
import type { ConsentFactories } from '../modules/consent/http/routes';
import { createDrizzleConsentRepository } from '../modules/consent/infrastructure/drizzle-consent-repository';
import { buildDb } from './db';

export type ConsentRepositoryFactory = (env: Env) => ConsentRepository;

export const defaultConsentRepository: ConsentRepositoryFactory = (env) =>
  createDrizzleConsentRepository(buildDb(env));

/** Raíz de composición del módulo consent (HU-109). `repo` se reemplaza en las pruebas. */
export function buildConsentFactories(
  overrides: { repo?: ConsentRepositoryFactory } = {},
): ConsentFactories {
  const repo = overrides.repo ?? defaultConsentRepository;
  return {
    acceptConsent: (env) => makeAcceptConsent({ repo: repo(env) }),
    consentStatus: (env) => makeGetConsentStatus({ repo: repo(env) }),
  };
}

/**
 * Middleware `requireConsent()` listo para usar después de `requireAuth()` (ver
 * modules/consent/http/require-consent.ts). Aún no se aplica a ninguna ruta.
 */
export const requireConsent = makeRequireConsent((env) =>
  makeGetConsentStatus({ repo: defaultConsentRepository(env) }),
);
