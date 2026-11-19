// Transiciones de la solicitud vistas por la pantalla (HU-205): cada refresco (primer plano,
// deslizar o push de E10) consulta GET /drivers/me y avisa si el estado cambió.
import type { DriverProfile } from '@panter/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DriversApi } from '../api/drivers-api';
import { documentRows } from '../documents/document-states';
import { OnboardingController } from '../onboarding-controller';
import { makeProfile } from '../test-helpers';
import { onboardingView } from './onboarding-status';
import {
  isForegroundTransition,
  notifyDriverStatusChanged,
  onDriverStatusChanged,
  type StatusRefreshReason,
} from './status-events';

function setup(responses: (DriverProfile | null)[]) {
  const getMe = vi.fn<DriversApi['getMe']>(async () => responses.shift() ?? null);
  const controller = new OnboardingController({
    api: { apply: vi.fn(), getMe, requestUploadUrl: vi.fn() },
  });
  const kind = () => {
    const { profile } = controller.getState();
    return onboardingView(profile, documentRows(profile, [])).kind;
  };
  return { controller, getMe, kind };
}

let unsubscribe: (() => void) | null = null;
afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
});

describe('flujo de estados de la solicitud', () => {
  it('PENDING → APPROVED avisa "¡Tu solicitud fue aprobada!" y muestra "¡Ya eres conductor!"', async () => {
    const { controller, kind } = setup([
      makeProfile(),
      makeProfile({ verificationStatus: 'APPROVED' }),
    ]);
    await controller.refresh();
    expect(kind()).toBe('pending');
    expect(controller.getState().notice).toBeNull();

    await controller.refresh();
    expect(kind()).toBe('approved');
    expect(controller.getState().notice).toEqual({
      tone: 'success',
      message: '¡Tu solicitud fue aprobada!',
    });
    controller.dismissNotice();
    expect(controller.getState().notice).toBeNull();
  });

  it('PENDING → REJECTED → PENDING (corrección) → APPROVED → SUSPENDED', async () => {
    const { controller, kind } = setup([
      makeProfile(),
      makeProfile({ verificationStatus: 'REJECTED', rejectionReason: 'SOAT vencido' }),
      makeProfile(),
      makeProfile({ verificationStatus: 'APPROVED' }),
      makeProfile({ verificationStatus: 'SUSPENDED', rejectionReason: 'Quejas de pasajeros' }),
    ]);
    const seen: [string, string | undefined][] = [];
    for (let i = 0; i < 5; i += 1) {
      await controller.refresh();
      seen.push([kind(), controller.getState().notice?.tone]);
    }
    expect(seen).toEqual([
      ['pending', undefined],
      ['rejected', 'warning'],
      ['pending', 'info'],
      ['approved', 'success'],
      ['suspended', 'warning'],
    ]);
  });

  it('crear la solicitud (sin perfil → PENDING) invita a subir los documentos', async () => {
    const { controller, kind } = setup([null, makeProfile()]);
    await controller.refresh();
    expect(kind()).toBe('notApplied');
    await controller.refresh();
    expect(controller.getState().notice?.message).toBe(
      'Recibimos tu solicitud. Ahora sube tus documentos.',
    );
  });

  it('un refresco sin cambios conserva el aviso pendiente de cerrar', async () => {
    const { controller } = setup([
      makeProfile(),
      makeProfile({ verificationStatus: 'APPROVED' }),
      makeProfile({ verificationStatus: 'APPROVED' }),
    ]);
    await controller.refresh();
    await controller.refresh();
    await controller.refresh();
    expect(controller.getState().notice?.tone).toBe('success');
  });

  it('reset (cierre de sesión) no avisa al cargar la cuenta siguiente', async () => {
    const { controller } = setup([makeProfile(), makeProfile({ verificationStatus: 'APPROVED' })]);
    await controller.refresh();
    controller.reset();
    await controller.refresh();
    expect(controller.getState().notice).toBeNull();
  });
});

describe('disparadores del refresco (punto de extensión de E10)', () => {
  it('primer plano, deslizar y push refrescan GET /drivers/me', async () => {
    const { controller, getMe } = setup([makeProfile(), makeProfile(), makeProfile()]);
    const reasons: StatusRefreshReason[] = [];
    unsubscribe = onDriverStatusChanged((reason) => {
      reasons.push(reason);
      void controller.refresh();
    });
    notifyDriverStatusChanged('foreground');
    await controller.refresh();
    notifyDriverStatusChanged('pull');
    await controller.refresh();
    notifyDriverStatusChanged('push');
    await controller.refresh();
    expect(reasons).toEqual(['foreground', 'pull', 'push']);
    expect(getMe).toHaveBeenCalledTimes(3);
  });

  it('detecta la vuelta a primer plano', () => {
    expect(isForegroundTransition('background', 'active')).toBe(true);
    expect(isForegroundTransition('inactive', 'active')).toBe(true);
    expect(isForegroundTransition('active', 'active')).toBe(false);
    expect(isForegroundTransition('active', 'background')).toBe(false);
    expect(isForegroundTransition(null, 'active')).toBe(false);
  });
});
