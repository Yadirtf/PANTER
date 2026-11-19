import { describe, expect, it } from 'vitest';
import { makeDocument, makeProfile, NOW } from '../test-helpers';
import type { UploadItem, UploadPhase } from '../upload/upload-types';
import {
  canCapture,
  documentRows,
  documentsProgress,
  documentStateLabel,
  framingGuideFor,
} from './document-states';
import { DOCUMENT_JPEG_QUALITY, DOCUMENT_MAX_SIDE_PX, resizeFor } from './image-plan';

function upload(type: UploadItem['type'], phase: UploadPhase, extra: Partial<UploadItem> = {}) {
  return {
    id: `${type}-1`,
    type,
    fileUri: `file:///docs/${type}.jpg`,
    contentType: 'image/jpeg',
    sizeBytes: 300_000,
    createdAt: NOW,
    attempts: 0,
    phase,
    progress: 0,
    signed: null,
    nextAttemptAt: null,
    lastErrorCode: null,
    ...extra,
  } satisfies UploadItem;
}

describe('documentRows', () => {
  it('lista los 5 documentos con DOCUMENT_LABELS, en el orden del contrato', () => {
    const rows = documentRows(null, []);
    expect(rows.map((r) => r.label)).toEqual([
      'Cédula de ciudadanía',
      'Licencia de conducción',
      'Tarjeta de propiedad del vehículo',
      'SOAT vigente',
      'Revisión técnico-mecánica vigente',
    ]);
    expect(rows.every((r) => r.state.kind === 'missing')).toBe(true);
  });

  it('mapea el estado de la API: en revisión, aprobado y rechazado con motivo', () => {
    const profile = makeProfile({
      documents: [
        makeDocument('CEDULA', { status: 'SUBMITTED' }),
        makeDocument('LICENCIA', { status: 'APPROVED' }),
        makeDocument('SOAT', { status: 'REJECTED', rejectionReason: 'El SOAT está vencido' }),
        makeDocument('TECNOMECANICA', { status: 'REJECTED', rejectionReason: '  ' }),
      ],
    });
    const states = Object.fromEntries(documentRows(profile, []).map((r) => [r.type, r.state]));
    expect(states).toEqual({
      CEDULA: { kind: 'inReview' },
      LICENCIA: { kind: 'approved' },
      TARJETA_PROPIEDAD: { kind: 'missing' },
      SOAT: { kind: 'rejected', reason: 'El SOAT está vencido' },
      TECNOMECANICA: { kind: 'rejected', reason: expect.stringContaining('no indicó el motivo') },
    });
  });

  it('una subida local manda sobre la API y muestra el progreso o la espera', () => {
    const profile = makeProfile({
      documents: [makeDocument('SOAT', { status: 'REJECTED', rejectionReason: 'Borroso' })],
    });
    const rows = documentRows(profile, [
      upload('SOAT', 'uploading', { progress: 0.42 }),
      upload('CEDULA', 'waitingNetwork'),
      upload('LICENCIA', 'retryScheduled'),
      upload('TECNOMECANICA', 'requestingUrl'),
      upload('TARJETA_PROPIEDAD', 'failed', { lastErrorCode: 'DOCUMENT_TOO_LARGE' }),
    ]);
    const states = Object.fromEntries(rows.map((r) => [r.type, r.state]));
    expect(states).toEqual({
      SOAT: { kind: 'uploading', progress: 0.42, waiting: null },
      CEDULA: { kind: 'uploading', progress: 0, waiting: 'offline' },
      LICENCIA: { kind: 'uploading', progress: 0, waiting: 'retry' },
      TECNOMECANICA: { kind: 'uploading', progress: 0, waiting: null },
      TARJETA_PROPIEDAD: {
        kind: 'uploadFailed',
        message: 'La foto es muy pesada. Tómala de nuevo con menos resolución.',
      },
    });
  });

  it('etiquetas del estado en español', () => {
    expect(documentStateLabel({ kind: 'missing' })).toBe('Falta');
    expect(documentStateLabel({ kind: 'uploading', progress: 0.5, waiting: null })).toBe(
      'Subiendo… 50 %',
    );
    expect(documentStateLabel({ kind: 'uploading', progress: 0, waiting: 'offline' })).toBe(
      'Sin señal: se subirá al volver la conexión',
    );
    expect(documentStateLabel({ kind: 'inReview' })).toBe('En revisión');
    expect(documentStateLabel({ kind: 'approved' })).toBe('Aprobado');
    expect(documentStateLabel({ kind: 'rejected', reason: 'x' })).toBe('Rechazado');
  });

  it('no deja volver a tomar un documento aprobado', () => {
    expect(canCapture({ kind: 'approved' })).toBe(false);
    expect(canCapture({ kind: 'rejected', reason: 'x' })).toBe(true);
    expect(canCapture({ kind: 'inReview' })).toBe(true);
  });
});

describe('documentsProgress', () => {
  it('cuenta los documentos en revisión o aprobados: "3 de 5 documentos"', () => {
    const profile = makeProfile({
      documents: [
        makeDocument('CEDULA'),
        makeDocument('LICENCIA', { status: 'APPROVED' }),
        makeDocument('SOAT'),
        makeDocument('TECNOMECANICA', { status: 'REJECTED', rejectionReason: 'Vencida' }),
      ],
    });
    expect(
      documentsProgress(documentRows(profile, [upload('TARJETA_PROPIEDAD', 'uploading')])),
    ).toEqual({ done: 3, total: 5, label: '3 de 5 documentos' });
  });
});

describe('guía de encuadre y compresión', () => {
  it('usa formato tarjeta para cédula, licencia y tarjeta de propiedad, y hoja para SOAT y RTM', () => {
    expect(framingGuideFor('CEDULA').aspectRatio).toBeCloseTo(1.585, 2);
    expect(framingGuideFor('TARJETA_PROPIEDAD').aspectRatio).toBeCloseTo(1.585, 2);
    expect(framingGuideFor('SOAT').aspectRatio).toBeLessThan(1);
    expect(framingGuideFor('TECNOMECANICA').hint).toMatch(/placa/);
  });

  it('reduce a 1600 px el lado mayor sin agrandar fotos pequeñas', () => {
    expect(DOCUMENT_MAX_SIDE_PX).toBe(1600);
    expect(DOCUMENT_JPEG_QUALITY).toBe(0.8);
    expect(resizeFor(4000, 3000)).toEqual({ width: 1600 });
    expect(resizeFor(3000, 4000)).toEqual({ height: 1600 });
    expect(resizeFor(1600, 1200)).toBeNull();
    expect(resizeFor(800, 600)).toBeNull();
    expect(resizeFor(0, 0)).toBeNull();
  });
});
