import { DriverVerificationStatus } from '@panter/contracts';

/**
 * Máquina de estados de la verificación del conductor (HU-201 y HU-204). Pura: sin base de
 * datos ni HTTP. Los repositorios aplican el cambio con la condición `verification_status =
 * <estado de origen>`, así que una carrera entre dos administradores no salta la tabla.
 *
 *   (solicitud) ─▶ PENDING ──approve──▶ APPROVED ──suspend──▶ SUSPENDED
 *                    │  ▲                   ▲                     │
 *                 reject resubmit           └──────reinstate──────┘
 *                    ▼  │
 *                  REJECTED
 *
 * - `resubmit` lo hace el solicitante (POST /drivers/apply tras un rechazo).
 * - `approve`, `reject`, `suspend` y `reinstate` los hace un ADMIN.
 * - Un rechazado no se suspende ni un aprobado se rechaza: para retirar a un conductor
 *   aprobado se suspende (conserva su historial y su rol DRIVER).
 */
export const DriverAction = {
  RESUBMIT: 'resubmit',
  APPROVE: 'approve',
  REJECT: 'reject',
  SUSPEND: 'suspend',
  REINSTATE: 'reinstate',
} as const;
export type DriverAction = (typeof DriverAction)[keyof typeof DriverAction];

const { PENDING, APPROVED, REJECTED, SUSPENDED } = DriverVerificationStatus;

const TRANSITIONS: Record<
  DriverAction,
  { from: DriverVerificationStatus; to: DriverVerificationStatus }
> = {
  resubmit: { from: REJECTED, to: PENDING },
  approve: { from: PENDING, to: APPROVED },
  reject: { from: PENDING, to: REJECTED },
  suspend: { from: APPROVED, to: SUSPENDED },
  reinstate: { from: SUSPENDED, to: APPROVED },
};

/** Estado de origen exigido por la acción. */
export function requiredStatusFor(action: DriverAction): DriverVerificationStatus {
  return TRANSITIONS[action].from;
}

/** Estado siguiente, o null si la acción no se permite desde `from`. */
export function nextStatus(
  from: DriverVerificationStatus,
  action: DriverAction,
): DriverVerificationStatus | null {
  const rule = TRANSITIONS[action];
  return rule.from === from ? rule.to : null;
}

/** El solicitante solo cambia documentos mientras su solicitud no está decidida a favor. */
export function canEditDocuments(status: DriverVerificationStatus): boolean {
  return status === PENDING || status === REJECTED;
}

/** Modo conductor (§5.3): exige el rol DRIVER y la verificación APPROVED (no SUSPENDED). */
export function canUseDriverMode(status: DriverVerificationStatus | null): boolean {
  return status === APPROVED;
}
