import type { Env } from '../env';
import type { DriverAvailability, DriverModeEligibility } from '../modules/auth/application/ports';
import { makeApplyAsDriver, makeGetMyDriverProfile } from '../modules/drivers/application/apply';
import { makeCreateUploadUrl, makeUploadDocument } from '../modules/drivers/application/documents';
import {
  makeApproveDriver,
  makeCreateViewUrl,
  makeGetDriver,
  makeListDrivers,
  makeReadDocument,
  makeReinstateDriver,
  makeRejectDriver,
  makeReviewDocument,
  makeSuspendDriver,
} from '../modules/drivers/application/admin-review';
import type {
  Clock,
  DocumentStorage,
  DocumentUrlSigner,
  DriverRepository,
  DriverReviewRepository,
  EventPublisher,
  UploadUseLedger,
} from '../modules/drivers/application/ports';
import type { AdminDriverFactories } from '../modules/drivers/http/admin-routes';
import type { DriverFactories } from '../modules/drivers/http/routes';
import { createDrizzleDriverRepository } from '../modules/drivers/infrastructure/drizzle-driver-repository';
import { createDrizzleDriverReviewRepository } from '../modules/drivers/infrastructure/drizzle-driver-review-repository';
import { createHmacDocumentUrlSigner } from '../modules/drivers/infrastructure/hmac-document-url-signer';
import { createKvUploadLedger } from '../modules/drivers/infrastructure/kv-upload-ledger';
import { createQueueEventPublisher } from '../modules/drivers/infrastructure/queue-event-publisher';
import { createR2DocumentStorage } from '../modules/drivers/infrastructure/r2-document-storage';
import { requireConfig } from './config';
import { buildDb } from './db';

/** HU-202: largo mínimo de DOCUMENT_URL_SECRET (`openssl rand -hex 32` da 64 caracteres). */
export const DOCUMENT_URL_SECRET_MIN_LENGTH = 32;

export function requireDocumentUrlSecret(env: Pick<Env, 'DOCUMENT_URL_SECRET'>): string {
  const secret = requireConfig(env.DOCUMENT_URL_SECRET, 'DOCUMENT_URL_SECRET', 'secreto');
  if (secret.length < DOCUMENT_URL_SECRET_MIN_LENGTH) {
    throw new Error(
      `DOCUMENT_URL_SECRET es muy corto (${secret.length} caracteres; mínimo ${DOCUMENT_URL_SECRET_MIN_LENGTH}). Genera uno con: openssl rand -hex 32`,
    );
  }
  return secret;
}

/**
 * Adaptadores del módulo drivers para los puertos de auth (HU-104 → HU-201): disponibilidad
 * OFFLINE al pasar a pasajero y verificación APPROVED para el modo conductor. Perezosos: la
 * base de datos se abre solo si se consultan (p. ej. POST /auth/refresh de un pasajero no la
 * necesita).
 */
export const defaultDriverAvailability = (env: Env): DriverAvailability => ({
  setUnavailable: async (userId) =>
    createDrizzleDriverRepository(buildDb(env)).setUnavailable(userId),
});

export const defaultDriverEligibility = (env: Env): DriverModeEligibility => ({
  canUseDriverMode: async (userId) =>
    createDrizzleDriverRepository(buildDb(env)).canUseDriverMode(userId),
});

export interface DriverOverrides {
  repo?: (env: Env) => DriverRepository;
  storage?: (env: Env) => DocumentStorage;
  signer?: (env: Env) => DocumentUrlSigner;
  ledger?: (env: Env) => UploadUseLedger;
  clock?: Clock;
}

/** Raíz de composición del módulo drivers (E2). Los adaptadores se reemplazan en las pruebas. */
export function buildDriverFactories(overrides: DriverOverrides = {}): DriverFactories {
  const repo = overrides.repo ?? ((env: Env) => createDrizzleDriverRepository(buildDb(env)));
  const { clock } = overrides;
  // El secreto se exige al armar: sin él, la URL no se emite ni se acepta (500 con log claro).
  const signer =
    overrides.signer ?? ((env: Env) => createHmacDocumentUrlSigner(requireDocumentUrlSecret(env)));
  const storage = overrides.storage ?? ((env: Env) => createR2DocumentStorage(env.DOCUMENTS));
  const ledger = overrides.ledger ?? ((env: Env) => createKvUploadLedger(env.KV));
  return {
    apply: (env) => makeApplyAsDriver({ repo: repo(env) }),
    getMine: (env) => makeGetMyDriverProfile({ repo: repo(env) }),
    createUploadUrl: (env) => makeCreateUploadUrl({ repo: repo(env), signer: signer(env), clock }),
    uploadDocument: (env) =>
      makeUploadDocument({
        repo: repo(env),
        signer: signer(env),
        storage: storage(env),
        ledger: ledger(env),
        clock,
      }),
  };
}

export interface AdminDriverOverrides {
  repo?: (env: Env) => DriverReviewRepository;
  storage?: (env: Env) => DocumentStorage;
  signer?: (env: Env) => DocumentUrlSigner;
  events?: (env: Env) => EventPublisher;
  clock?: Clock;
}

/** Raíz de composición de la revisión por ADMIN (HU-204). */
export function buildAdminDriverFactories(
  overrides: AdminDriverOverrides = {},
): AdminDriverFactories {
  const { clock } = overrides;
  const repo = overrides.repo ?? ((env: Env) => createDrizzleDriverReviewRepository(buildDb(env)));
  const signer =
    overrides.signer ?? ((env: Env) => createHmacDocumentUrlSigner(requireDocumentUrlSecret(env)));
  const storage = overrides.storage ?? ((env: Env) => createR2DocumentStorage(env.DOCUMENTS));
  const events = overrides.events ?? ((env: Env) => createQueueEventPublisher(env.EVENTS));
  return {
    list: (env) => makeListDrivers({ repo: repo(env) }),
    detail: (env) => makeGetDriver({ repo: repo(env) }),
    viewUrl: (env) => makeCreateViewUrl({ repo: repo(env), signer: signer(env), clock }),
    readDocument: (env) => makeReadDocument({ signer: signer(env), storage: storage(env), clock }),
    reviewDocument: (env) => makeReviewDocument({ repo: repo(env) }),
    approve: (env) =>
      makeApproveDriver({
        repo: repo(env),
        events: events(env),
        clock,
        // La aprobación ya quedó guardada: el evento se registra para reenviarlo a mano.
        onPublishFailure: (error, event) =>
          console.error({
            event: 'driver_approved_publish_failed',
            error: error instanceof Error ? error.message : String(error),
            payload: event,
          }),
      }),
    reject: (env) => makeRejectDriver({ repo: repo(env) }),
    suspend: (env) => makeSuspendDriver({ repo: repo(env) }),
    reinstate: (env) => makeReinstateDriver({ repo: repo(env) }),
  };
}
