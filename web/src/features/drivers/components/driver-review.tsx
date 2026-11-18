'use client';

import {
  DOCUMENT_LABELS,
  DocumentStatus,
  ReasonBodySchema,
  REQUIRED_DOCUMENTS,
  type AdminDriver,
  type DocumentType,
} from '@panter/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { handleAdminFailure } from '@/features/admin/lib/admin-failure';
import { formatDate } from '@/shared/lib/format';
import { driverAction, reviewDocument } from '../api/drivers-client';
import {
  actionNeedsReason,
  actionsFor,
  adminDriverDetailPath,
  approveBlockedReason,
  confirmText,
  documentOf,
  DOCUMENT_STATUS_LABEL,
  DRIVER_ACTION_DONE,
  DRIVER_ACTION_LABEL,
  driverName,
  type DriverAction,
} from '../lib/drivers';
import { driverErrorMessage } from '../lib/messages';
import type { ViewUrls } from '../server/load-drivers';
import { DocumentImage } from './document-image';

type Pending =
  | { kind: 'document'; type: DocumentType; decision: 'APPROVED' | 'REJECTED' }
  | { kind: 'driver'; action: DriverAction };

export const REASON_HINT = 'Escribe un motivo de al menos 5 caracteres (máximo 500).';

function needsReason(pending: Pending): boolean {
  return pending.kind === 'document'
    ? pending.decision === DocumentStatus.REJECTED
    : actionNeedsReason(pending.action);
}

function pendingText(pending: Pending, driver: AdminDriver): string {
  if (pending.kind === 'driver') return confirmText(pending.action, driver);
  const label = DOCUMENT_LABELS[pending.type];
  return pending.decision === DocumentStatus.APPROVED
    ? `¿Aprobar el documento "${label}" de ${driverName(driver)}?`
    : `¿Rechazar el documento "${label}"? El solicitante verá el motivo y podrá subirlo de nuevo.`;
}

const STATUS_STYLE: Record<DocumentStatus, string> = {
  SUBMITTED: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-red-100 text-red-900',
};

const button =
  'rounded-lg px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';

/** Documentos y acciones del detalle de un conductor (HU-204). */
export function DriverReview({ driver, viewUrls }: { driver: AdminDriver; viewUrls: ViewUrls }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const here = adminDriverDetailPath(driver.userId);
  const blocked = approveBlockedReason(driver);

  function ask(next: Pending) {
    setPending(next);
    setReason('');
    setReasonError(null);
    setError(null);
    setNotice(null);
  }

  async function confirm() {
    if (!pending) return;
    let validReason: string | undefined;
    if (needsReason(pending)) {
      const parsed = ReasonBodySchema.safeParse({ reason });
      if (!parsed.success) {
        setReasonError(REASON_HINT);
        return;
      }
      validReason = parsed.data.reason;
    }
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === 'document') {
        await reviewDocument(
          driver.userId,
          pending.type,
          pending.decision === DocumentStatus.APPROVED
            ? { decision: DocumentStatus.APPROVED }
            : { decision: DocumentStatus.REJECTED, reason: validReason! },
        );
        setNotice(
          pending.decision === DocumentStatus.APPROVED
            ? `Documento aprobado: ${DOCUMENT_LABELS[pending.type]}.`
            : `Documento rechazado: ${DOCUMENT_LABELS[pending.type]}.`,
        );
      } else {
        await driverAction(driver.userId, pending.action, validReason);
        setNotice(DRIVER_ACTION_DONE[pending.action]);
      }
      setPending(null);
      // Vuelve a cargar el detalle en el servidor: estado nuevo y URLs firmadas nuevas.
      router.refresh();
    } catch (failure) {
      setPending(null);
      handleAdminFailure(failure, here, driverErrorMessage, setError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div aria-live="polite" className="min-h-6">
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : notice ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>
        ) : null}
      </div>

      {pending ? (
        <div
          role="alertdialog"
          aria-labelledby="confirmar-accion"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4"
        >
          <p id="confirmar-accion" className="font-medium text-stone-900">
            {pendingText(pending, driver)}
          </p>
          {needsReason(pending) ? (
            <label className="mt-3 flex flex-col gap-1">
              <span className="text-sm font-medium text-stone-700">Motivo</span>
              <textarea
                value={reason}
                maxLength={500}
                rows={3}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(null);
                }}
                aria-invalid={reasonError ? true : undefined}
                aria-describedby="motivo-ayuda"
                className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 focus:outline-none"
              />
              <span
                id="motivo-ayuda"
                className={reasonError ? 'text-sm text-red-700' : 'text-xs text-stone-500'}
              >
                {reasonError ?? REASON_HINT}
              </span>
            </label>
          ) : null}
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={confirm}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {busy ? 'Guardando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending(null)}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <section aria-labelledby="acciones-conductor" className="flex flex-col gap-3">
        <h2 id="acciones-conductor" className="text-xl font-semibold text-stone-900">
          Decisión sobre el conductor
        </h2>
        <div className="flex flex-wrap gap-3">
          {actionsFor(driver.verificationStatus).map((action) => {
            const disabled = busy || (action === 'approve' && blocked !== null);
            const danger = action === 'reject' || action === 'suspend';
            return (
              <button
                key={action}
                type="button"
                disabled={disabled}
                aria-describedby={action === 'approve' && blocked ? 'aprobar-bloqueado' : undefined}
                onClick={() => ask({ kind: 'driver', action })}
                className={`${button} ${
                  danger
                    ? 'border border-red-300 text-red-800 hover:bg-red-50'
                    : 'bg-emerald-700 text-white hover:bg-emerald-800'
                }`}
              >
                {DRIVER_ACTION_LABEL[action]}
              </button>
            );
          })}
        </div>
        {actionsFor(driver.verificationStatus).includes('approve') && blocked ? (
          <p id="aprobar-bloqueado" className="text-sm text-amber-800">
            {blocked}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="documentos" className="flex flex-col gap-4">
        <h2 id="documentos" className="text-xl font-semibold text-stone-900">
          Documentos
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {REQUIRED_DOCUMENTS.map((type) => {
            const doc = documentOf(driver, type);
            const label = DOCUMENT_LABELS[type];
            return (
              <li
                key={type}
                className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-stone-900">{label}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      doc ? STATUS_STYLE[doc.status] : 'bg-stone-100 text-stone-700'
                    }`}
                  >
                    {doc ? DOCUMENT_STATUS_LABEL[doc.status] : 'Sin subir'}
                  </span>
                </div>
                {doc ? (
                  <>
                    <DocumentImage
                      userId={driver.userId}
                      type={type}
                      label={label}
                      initialUrl={viewUrls[type]?.url ?? null}
                    />
                    <p className="text-xs text-stone-500">
                      Subido el {formatDate(doc.uploadedAt)}
                      {doc.reviewedAt ? ` · Revisado el ${formatDate(doc.reviewedAt)}` : ''}
                    </p>
                    {doc.status === DocumentStatus.REJECTED && doc.rejectionReason ? (
                      <p className="text-sm text-red-800">Motivo: {doc.rejectionReason}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy || doc.status === DocumentStatus.APPROVED}
                        onClick={() => ask({ kind: 'document', type, decision: 'APPROVED' })}
                        className={`${button} bg-emerald-700 text-white hover:bg-emerald-800`}
                      >
                        Aprobar documento
                      </button>
                      <button
                        type="button"
                        disabled={busy || doc.status === DocumentStatus.REJECTED}
                        onClick={() => ask({ kind: 'document', type, decision: 'REJECTED' })}
                        className={`${button} border border-red-300 text-red-800 hover:bg-red-50`}
                      >
                        Rechazar documento
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-stone-600">
                    El solicitante todavía no ha subido este documento desde la app.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
