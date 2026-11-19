import type { DriverApplyBody, DriverProfile } from '@panter/contracts';
import type { Actor } from '../../auth/domain/actor';
import { toDriverProfile, type Vehicle } from '../domain/driver-profile';
import { DriverAction, nextStatus } from '../domain/driver-status';
import { DriverErrors } from './errors';
import type { DriverRepository } from './ports';

/** POST /drivers/apply */
export type ApplyAsDriver = (actor: Actor, body: DriverApplyBody) => Promise<DriverProfile>;

/**
 * Solicitud para ser conductor (HU-201).
 * - Sin perfil: lo crea en PENDING con el vehículo. No otorga DRIVER (eso es HU-204).
 * - Perfil REJECTED: reenvío (máquina de estados `resubmit`), actualiza el vehículo y vuelve a
 *   PENDING. Los documentos aprobados se conservan; los rechazados se vuelven a subir.
 * - Perfil en cualquier otro estado → 409 DRIVER_ALREADY_APPLIED.
 * - Placa de otra cuenta → 409 PLATE_ALREADY_REGISTERED (índice único driver_profiles_plate_key).
 */
export function makeApplyAsDriver(deps: { repo: DriverRepository }): ApplyAsDriver {
  return async (actor, body) => {
    const vehicle: Vehicle = {
      vehicleType: body.vehicleType,
      plate: body.plate,
      brand: body.brand,
      model: body.model,
      color: body.color,
      year: body.year,
    };
    const existing = await deps.repo.findProfile(actor.userId);
    if (existing) {
      if (nextStatus(existing.verificationStatus, DriverAction.RESUBMIT) === null) {
        throw DriverErrors.alreadyApplied();
      }
      const result = await deps.repo.resubmit(actor.userId, vehicle);
      if (!result.ok) {
        throw result.reason === 'plate_taken'
          ? DriverErrors.plateTaken()
          : DriverErrors.alreadyApplied();
      }
      return toDriverProfile(result.profile, await deps.repo.listDocuments(actor.userId));
    }
    const result = await deps.repo.create(actor.userId, vehicle);
    if (!result.ok) {
      throw result.reason === 'plate_taken'
        ? DriverErrors.plateTaken()
        : DriverErrors.alreadyApplied();
    }
    return toDriverProfile(result.profile, []);
  };
}

/** GET /drivers/me */
export type GetMyDriverProfile = (actor: Actor) => Promise<DriverProfile>;

export function makeGetMyDriverProfile(deps: { repo: DriverRepository }): GetMyDriverProfile {
  return async (actor) => {
    const profile = await deps.repo.findProfile(actor.userId);
    if (!profile) throw DriverErrors.notApplied();
    return toDriverProfile(profile, await deps.repo.listDocuments(actor.userId));
  };
}
