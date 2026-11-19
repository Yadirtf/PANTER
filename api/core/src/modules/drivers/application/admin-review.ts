import {
  DocumentStatus,
  DomainEventType,
  type AdminDriver,
  type AdminDriversQuery,
  type AdminDriversResponse,
  type DocumentReviewBody,
  type DocumentType,
  type DocumentViewUrlResponse,
  type DriverApprovedEvent,
} from '@panter/contracts';
import type { Actor } from '../../auth/domain/actor';
import { encodeGrant, type ViewGrant } from '../domain/document-url';
import { decodeDriverCursor, encodeDriverCursor } from '../domain/driver-cursor';
import { documentsNotApproved, toAdminDriver } from '../domain/driver-profile';
import {
  allowedFrom,
  canReviewDocuments,
  DriverAction,
  nextStatus,
  REVIEWABLE_STATUSES,
} from '../domain/driver-status';
import { verifyGrant } from './documents';
import { DriverErrors } from './errors';
import type {
  Clock,
  DecisionResult,
  DocumentStorage,
  DocumentUrlSigner,
  DriverReviewRepository,
  EventPublisher,
  StoredDocument,
} from './ports';

/** Vigencia de la URL de lectura del ADMIN: corta (la imagen se ve al instante). */
export const DOCUMENT_VIEW_TTL_SECONDS = 5 * 60;
/** Ruta del GET firmado de lectura (la sirve este Worker desde R2). */
export const DOCUMENT_VIEW_PATH = '/drivers/documents/view';

/** GET /admin/drivers */
export type ListDrivers = (query: AdminDriversQuery) => Promise<AdminDriversResponse>;

export function makeListDrivers(deps: { repo: DriverReviewRepository }): ListDrivers {
  return async ({ status, cursor, limit }) => {
    const after = cursor ? decodeDriverCursor(cursor) : undefined;
    if (after === null) throw DriverErrors.invalidCursor();
    const page = await deps.repo.list({ status, limit, after });
    return {
      items: page.items.map(toAdminDriver),
      nextCursor: page.next ? encodeDriverCursor(page.next) : null,
    };
  };
}

/** GET /admin/drivers/:userId */
export type GetDriver = (userId: string) => Promise<AdminDriver>;

async function load(repo: DriverReviewRepository, userId: string) {
  const record = await repo.find(userId);
  if (!record) throw DriverErrors.driverNotFound();
  return record;
}

export function makeGetDriver(deps: { repo: DriverReviewRepository }): GetDriver {
  return async (userId) => toAdminDriver(await load(deps.repo, userId));
}

/** GET /admin/drivers/:userId/documents/:type/view-url */
export type CreateViewUrl = (input: {
  userId: string;
  type: DocumentType;
  origin: string;
}) => Promise<DocumentViewUrlResponse>;

export function makeCreateViewUrl(deps: {
  repo: DriverReviewRepository;
  signer: DocumentUrlSigner;
  clock?: Clock;
}): CreateViewUrl {
  const now = deps.clock ?? Date.now;
  return async ({ userId, type, origin }) => {
    const record = await load(deps.repo, userId);
    const doc = record.documents.find((d) => d.type === type);
    if (!doc) throw DriverErrors.documentNotFound(type);
    const exp = Math.floor(now() / 1000) + DOCUMENT_VIEW_TTL_SECONDS;
    const grant: ViewGrant = {
      purpose: 'view',
      userId,
      type,
      contentType: doc.contentType,
      key: doc.r2Key,
      exp,
    };
    const payload = encodeGrant(grant);
    const url = new URL(DOCUMENT_VIEW_PATH, origin);
    url.searchParams.set('token', `${payload}.${await deps.signer.sign(payload)}`);
    return { url: url.toString(), expiresAt: new Date(exp * 1000).toISOString() };
  };
}

/** GET firmado de lectura: el archivo desde R2 (sin Bearer; la firma es la autorización). */
export type ReadDocument = (
  token: string | undefined,
) => Promise<StoredDocument & { type: DocumentType }>;

export function makeReadDocument(deps: {
  signer: DocumentUrlSigner;
  storage: DocumentStorage;
  clock?: Clock;
}): ReadDocument {
  const now = deps.clock ?? Date.now;
  return async (token) => {
    // Firma, propósito `view`, vencimiento y clave drivers/<userId>/<type>/<uuid> (decodeGrant).
    const grant = await verifyGrant(deps.signer, token, now(), 'view');
    if (!grant) throw DriverErrors.viewUrlInvalid();
    const object = await deps.storage.get(grant.key);
    if (!object) throw DriverErrors.documentNotFound(grant.type);
    return { ...object, type: grant.type };
  };
}

function ensureDecided(result: DecisionResult) {
  if (!result.actorIsAdmin) throw DriverErrors.forbidden();
}

/** POST /admin/drivers/:userId/documents/:type/review */
export type ReviewDocument = (
  actor: Actor,
  input: { userId: string; type: DocumentType; body: DocumentReviewBody },
) => Promise<AdminDriver>;

/**
 * Aprueba o rechaza (con motivo) un documento. Solo con la solicitud PENDING o REJECTED; una ya
 * aprobada o suspendida → 409 INVALID_DRIVER_TRANSITION. Documento sin subir → 404.
 */
export function makeReviewDocument(deps: { repo: DriverReviewRepository }): ReviewDocument {
  return async (actor, { userId, type, body }) => {
    const record = await load(deps.repo, userId);
    const status = record.profile.verificationStatus;
    if (!canReviewDocuments(status)) throw DriverErrors.invalidTransition(status, 'review');
    if (!record.documents.some((d) => d.type === type)) throw DriverErrors.documentNotFound(type);
    const result = await deps.repo.reviewDocument({
      actorId: actor.userId,
      userId,
      type,
      status: body.decision,
      reason: body.decision === DocumentStatus.REJECTED ? body.reason : null,
      profileFrom: REVIEWABLE_STATUSES,
    });
    ensureDecided(result);
    const after = await load(deps.repo, userId);
    if (!result.changed) {
      throw DriverErrors.invalidTransition(after.profile.verificationStatus, 'review');
    }
    return toAdminDriver(after);
  };
}

/** Decisiones sobre la solicitud. `reason` solo en reject y suspend. */
export type DecideDriver = (
  actor: Actor,
  input: { userId: string; reason?: string },
) => Promise<AdminDriver>;

export interface ApproveDeps {
  repo: DriverReviewRepository;
  events: EventPublisher;
  clock?: Clock;
  newId?: () => string;
  /** La cola falló: la aprobación NO se revierte; queda en el log para reenviar. */
  onPublishFailure?: (error: unknown, event: DriverApprovedEvent) => void;
}

/**
 * POST /admin/drivers/:userId/approve (HU-204). Desde PENDING (o REJECTED ya corregida) y con los
 * cinco documentos APPROVED (si no, 409 DOCUMENTS_INCOMPLETE con `details.pending`). En una sola
 * sentencia: APPROVED, reviewed_*, rol DRIVER con granted_by y registro en role_audit. Después
 * publica DriverApproved en la cola EVENTS.
 */
export function makeApproveDriver(deps: ApproveDeps): DecideDriver {
  const now = deps.clock ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  return async (actor, { userId }) => {
    const before = await load(deps.repo, userId);
    const from = before.profile.verificationStatus;
    if (nextStatus(from, DriverAction.APPROVE) === null) {
      throw DriverErrors.invalidTransition(from, DriverAction.APPROVE);
    }
    const pending = documentsNotApproved(before.documents);
    if (pending.length > 0) throw DriverErrors.documentsIncomplete(pending);

    const result = await deps.repo.approve({
      actorId: actor.userId,
      userId,
      from: allowedFrom(DriverAction.APPROVE),
    });
    ensureDecided(result);
    const after = await load(deps.repo, userId);
    if (!result.changed) {
      // Carrera: otro ADMIN decidió o un documento cambió entre la lectura y la sentencia.
      const missing = documentsNotApproved(after.documents);
      if (
        nextStatus(after.profile.verificationStatus, DriverAction.APPROVE) !== null &&
        missing.length > 0
      ) {
        throw DriverErrors.documentsIncomplete(missing);
      }
      throw DriverErrors.invalidTransition(after.profile.verificationStatus, DriverAction.APPROVE);
    }

    const event: DriverApprovedEvent = {
      type: DomainEventType.DRIVER_APPROVED,
      version: 1,
      eventId: newId(),
      occurredAt: new Date(now()).toISOString(),
      payload: {
        userId,
        vehicleType: after.profile.vehicle.vehicleType,
        plate: after.profile.vehicle.plate,
        approvedBy: actor.userId,
      },
    };
    try {
      await deps.events.publish(event);
    } catch (error) {
      deps.onPublishFailure?.(error, event);
    }
    return toAdminDriver(after);
  };
}

function makeStatusChange(
  action: typeof DriverAction.REJECT | typeof DriverAction.SUSPEND | typeof DriverAction.REINSTATE,
  deps: { repo: DriverReviewRepository },
): DecideDriver {
  return async (actor, { userId, reason }) => {
    const before = await load(deps.repo, userId);
    const to = nextStatus(before.profile.verificationStatus, action);
    if (to === null)
      throw DriverErrors.invalidTransition(before.profile.verificationStatus, action);
    const result = await deps.repo.changeStatus({
      actorId: actor.userId,
      userId,
      from: allowedFrom(action),
      to,
      reason: action === DriverAction.REINSTATE ? null : (reason ?? null),
      setOffline: action === DriverAction.SUSPEND,
    });
    ensureDecided(result);
    const after = await load(deps.repo, userId);
    if (!result.changed)
      throw DriverErrors.invalidTransition(after.profile.verificationStatus, action);
    return toAdminDriver(after);
  };
}

/** POST /admin/drivers/:userId/reject { reason }: PENDING → REJECTED con motivo. */
export const makeRejectDriver = (deps: { repo: DriverReviewRepository }) =>
  makeStatusChange(DriverAction.REJECT, deps);

/**
 * POST /admin/drivers/:userId/suspend { reason }: APPROVED → SUSPENDED y availability OFFLINE.
 * Conserva el rol DRIVER; el modo conductor queda bloqueado (POST /me/mode exige APPROVED).
 */
export const makeSuspendDriver = (deps: { repo: DriverReviewRepository }) =>
  makeStatusChange(DriverAction.SUSPEND, deps);

/** POST /admin/drivers/:userId/reinstate: SUSPENDED → APPROVED, sin motivo. */
export const makeReinstateDriver = (deps: { repo: DriverReviewRepository }) =>
  makeStatusChange(DriverAction.REINSTATE, deps);
