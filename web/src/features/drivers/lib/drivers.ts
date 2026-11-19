import {
  DOCUMENT_LABELS,
  DocumentStatus,
  DriverVerificationStatus,
  DriverVerificationStatusSchema,
  REQUIRED_DOCUMENTS,
  type AdminDriver,
  type AdminDriversResponse,
  type DocumentType,
  type DriverDocument,
} from '@panter/contracts';

/** Revisión de conductores por ADMIN (HU-204). Reglas de presentación, sin efectos. */

export const ADMIN_DRIVERS_PATH = '/admin/conductores';

export function adminDriverDetailPath(userId: string): string {
  return `${ADMIN_DRIVERS_PATH}/${encodeURIComponent(userId)}`;
}

/** Parámetro `?estado=` del listado. "todos" = sin filtro. */
export const ALL_STATUSES = 'todos';
export type DriversFilter = DriverVerificationStatus | typeof ALL_STATUSES;
export const DEFAULT_FILTER: DriversFilter = DriverVerificationStatus.PENDING;

/** Lee `?estado=`; cualquier valor desconocido vuelve al filtro por defecto (PENDING). */
export function parseDriversFilter(raw: string | string[] | undefined): DriversFilter {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.toLowerCase() === ALL_STATUSES) return ALL_STATUSES;
  const parsed = DriverVerificationStatusSchema.safeParse(value.toUpperCase());
  return parsed.success ? parsed.data : DEFAULT_FILTER;
}

/** Estado para la API, o `undefined` si se piden todos. */
export function statusForApi(filter: DriversFilter): DriverVerificationStatus | undefined {
  return filter === ALL_STATUSES ? undefined : filter;
}

export function driversListPath(filter: DriversFilter): string {
  return filter === DEFAULT_FILTER
    ? ADMIN_DRIVERS_PATH
    : `${ADMIN_DRIVERS_PATH}?estado=${filter === ALL_STATUSES ? ALL_STATUSES : filter}`;
}

export const FILTERS: readonly { value: DriversFilter; label: string }[] = [
  { value: DriverVerificationStatus.PENDING, label: 'Pendientes' },
  { value: DriverVerificationStatus.APPROVED, label: 'Aprobados' },
  { value: DriverVerificationStatus.REJECTED, label: 'Rechazados' },
  { value: DriverVerificationStatus.SUSPENDED, label: 'Suspendidos' },
  { value: ALL_STATUSES, label: 'Todos' },
];

export const DRIVER_STATUS_LABEL: Record<DriverVerificationStatus, string> = {
  PENDING: 'Pendiente de revisión',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  SUSPENDED: 'Suspendido',
};

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  SUBMITTED: 'En revisión',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
};

/**
 * Placa en formato visual: "ABC123" → "ABC 123" (carro), "ABC12D" → "ABC 12D" (moto).
 * Acepta también la placa sin normalizar.
 */
export function formatPlate(plate: string): string {
  const normalized = plate.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z]{3}[0-9A-Z]{3}$/.test(normalized)
    ? `${normalized.slice(0, 3)} ${normalized.slice(3)}`
    : normalized;
}

/** "Mototaxi · ABC 12D · AKT NKD 125 · Rojo · 2022" (sin el tipo: lo pone quien llama). */
export function vehicleDescription(vehicle: AdminDriver['vehicle']): string {
  return `${vehicle.brand} ${vehicle.model} · ${vehicle.color} · ${vehicle.year}`;
}

export function driverName(driver: Pick<AdminDriver, 'fullName' | 'email'>): string {
  return driver.fullName?.trim() || driver.email;
}

/** Documento subido de un tipo, si existe. */
export function documentOf(driver: AdminDriver, type: DocumentType): DriverDocument | undefined {
  return driver.documents.find((doc) => doc.type === type);
}

export interface DocumentsSummary {
  uploaded: number;
  required: number;
  approved: number;
  /** Etiquetas de los exigidos que no se han subido (en el orden de REQUIRED_DOCUMENTS). */
  missing: string[];
}

/** Subidos frente a faltantes, para la fila del listado. */
export function documentsSummary(driver: AdminDriver): DocumentsSummary {
  const uploadedTypes = new Set(driver.documents.map((doc) => doc.type));
  return {
    uploaded: REQUIRED_DOCUMENTS.filter((type) => uploadedTypes.has(type)).length,
    required: REQUIRED_DOCUMENTS.length,
    approved: REQUIRED_DOCUMENTS.filter(
      (type) => documentOf(driver, type)?.status === DocumentStatus.APPROVED,
    ).length,
    missing: REQUIRED_DOCUMENTS.filter((type) => !uploadedTypes.has(type)).map(
      (type) => DOCUMENT_LABELS[type],
    ),
  };
}

/** Documentos exigidos que aún no están APPROVED (sin subir, en revisión o rechazados). */
export function documentsNotApproved(driver: AdminDriver): DocumentType[] {
  return REQUIRED_DOCUMENTS.filter(
    (type) => documentOf(driver, type)?.status !== DocumentStatus.APPROVED,
  );
}

export type DriverAction = 'approve' | 'reject' | 'suspend' | 'reinstate';

export const DRIVER_ACTION_LABEL: Record<DriverAction, string> = {
  approve: 'Aprobar conductor',
  reject: 'Rechazar solicitud',
  suspend: 'Suspender conductor',
  reinstate: 'Reactivar conductor',
};

/** Acciones que piden motivo (ReasonBodySchema: 5 a 500 caracteres). */
export function actionNeedsReason(action: DriverAction): boolean {
  return action === 'reject' || action === 'suspend';
}

/**
 * Acciones disponibles según el estado (la API decide al final y responde
 * INVALID_DRIVER_TRANSITION si no aplica):
 * - PENDING: aprobar o rechazar.
 * - REJECTED: aprobar, si el solicitante ya corrigió y todos sus documentos quedaron aprobados.
 * - APPROVED: suspender.
 * - SUSPENDED: reactivar.
 */
export function actionsFor(status: DriverVerificationStatus): DriverAction[] {
  switch (status) {
    case DriverVerificationStatus.PENDING:
      return ['approve', 'reject'];
    case DriverVerificationStatus.REJECTED:
      return ['approve'];
    case DriverVerificationStatus.APPROVED:
      return ['suspend'];
    case DriverVerificationStatus.SUSPENDED:
      return ['reinstate'];
  }
}

/**
 * Motivo por el que "Aprobar conductor" está deshabilitado, o `null` si se puede aprobar.
 * La API exige los 5 documentos APPROVED (DOCUMENTS_INCOMPLETE).
 */
export function approveBlockedReason(driver: AdminDriver): string | null {
  const pending = documentsNotApproved(driver);
  if (pending.length === 0) return null;
  const labels = pending.map((type) => DOCUMENT_LABELS[type]);
  return `Para aprobar, los ${REQUIRED_DOCUMENTS.length} documentos deben estar aprobados. Faltan: ${labels.join(', ')}.`;
}

export function confirmText(action: DriverAction, driver: AdminDriver): string {
  const name = driverName(driver);
  switch (action) {
    case 'approve':
      return `¿Aprobar a ${name} como conductor? Recibirá el rol de conductor y podrá activar el modo conductor en la app.`;
    case 'reject':
      return `¿Rechazar la solicitud de ${name}? Verá el motivo y podrá corregir sus documentos.`;
    case 'suspend':
      return `¿Suspender a ${name}? No podrá usar el modo conductor; conserva su cuenta de pasajero.`;
    case 'reinstate':
      return `¿Reactivar a ${name}? Podrá volver a usar el modo conductor.`;
  }
}

export const DRIVER_ACTION_DONE: Record<DriverAction, string> = {
  approve: 'Conductor aprobado.',
  reject: 'Solicitud rechazada.',
  suspend: 'Conductor suspendido.',
  reinstate: 'Conductor reactivado.',
};

/** Lista paginada del listado. */
export interface DriversListState {
  items: AdminDriver[];
  nextCursor: string | null;
}

/** Agrega la página siguiente ("Cargar más") sin duplicar solicitudes. */
export function appendDriversPage(
  state: DriversListState,
  page: AdminDriversResponse,
): DriversListState {
  const seen = new Set(state.items.map((driver) => driver.userId));
  return {
    items: [...state.items, ...page.items.filter((driver) => !seen.has(driver.userId))],
    nextCursor: page.nextCursor,
  };
}

/** Texto del contador de pendientes en el panel: 3 → "3", 100 con más páginas → "100+". */
export function pendingCountLabel(page: AdminDriversResponse): string {
  return page.nextCursor ? `${page.items.length}+` : String(page.items.length);
}
