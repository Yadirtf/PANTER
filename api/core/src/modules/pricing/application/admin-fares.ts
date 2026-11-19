import type {
  FareConfigResponse,
  FareHistoryQuery,
  FareHistoryResponse,
  FareRule,
  FareRuleUpdateBody,
  Geofence,
  GeofenceUpdateBody,
  VehicleType,
} from '@panter/contracts';
import type { Actor } from '../../auth/domain/actor';
import { fareRuleIssues, normalizeVehicleTypes, polygonIssues } from '../domain/fare-policy';
import { decodeHistoryCursor, encodeHistoryCursor } from '../domain/history-cursor';
import { PricingErrors } from './errors';
import type {
  EditResult,
  FareChangeRepository,
  FareRuleRepository,
  GeofenceRepository,
} from './ports';

/** Se llama tras un cambio real (HU-402: invalida la caché de tarifas del isolate). */
export type OnFareConfigChange = () => void;

/** GET /admin/fares */
export type GetFareConfig = () => Promise<FareConfigResponse>;

export function makeGetFareConfig(deps: {
  rules: FareRuleRepository;
  geofences: GeofenceRepository;
}): GetFareConfig {
  return async () => {
    const [rules, geofences] = await Promise.all([deps.rules.list(), deps.geofences.list()]);
    return { rules, geofences };
  };
}

function checkEdit(result: EditResult, notFound: () => Error): void {
  if (!result.actorIsAdmin) throw PricingErrors.forbidden();
  if (!result.exists) throw notFound();
}

/** PUT /admin/fares/rules/:vehicleType */
export type UpdateFareRule = (
  actor: Actor,
  vehicleType: VehicleType,
  rule: FareRuleUpdateBody,
) => Promise<FareRule>;

/**
 * Edita la regla de un tipo de vehículo (HU-401, para HU-403). Valida las reglas de negocio
 * (`fareRuleIssues`) → 400 `VALIDATION_ERROR` con `details`; la regla no existe → 404
 * `FARE_RULE_NOT_FOUND`; quien edita ya no es ADMIN en la base de datos → 403. El historial
 * (antes, después y autor) se escribe en la misma sentencia; sin cambios no se registra nada.
 */
export function makeUpdateFareRule(deps: {
  rules: FareRuleRepository;
  onChange?: OnFareConfigChange;
}): UpdateFareRule {
  return async (actor, vehicleType, rule) => {
    const issues = fareRuleIssues(rule);
    if (issues.length > 0) throw PricingErrors.invalidRule(issues);
    const result = await deps.rules.update({ vehicleType, actorId: actor.userId, rule });
    checkEdit(result, PricingErrors.fareRuleNotFound);
    if (result.changed) deps.onChange?.();
    const saved = await deps.rules.get(vehicleType);
    if (!saved) throw PricingErrors.fareRuleNotFound();
    return saved;
  };
}

/** PUT /admin/fares/geofences/:id */
export type UpdateGeofence = (
  actor: Actor,
  id: string,
  geofence: GeofenceUpdateBody,
) => Promise<Geofence>;

/**
 * Edita una geocerca: nombre, polígono, recargo, tipos de vehículo y estado. El polígono se
 * valida aquí (anillos de ≥ 3 vértices distintos, dentro del área de servicio) y en PostGIS
 * (`ST_IsValid`: autointersecciones, huecos fuera del borde…) → 400 `VALIDATION_ERROR`.
 */
export function makeUpdateGeofence(deps: {
  geofences: GeofenceRepository;
  onChange?: OnFareConfigChange;
}): UpdateGeofence {
  return async (actor, id, body) => {
    const issues = body.polygon ? polygonIssues(body.polygon) : [];
    if (issues.length > 0) throw PricingErrors.invalidPolygon(issues);
    const geofence = {
      ...body,
      name: body.name.trim(),
      appliesTo: normalizeVehicleTypes(body.appliesTo),
    };
    const result = await deps.geofences.update({ id, actorId: actor.userId, geofence });
    if (!result.actorIsAdmin) throw PricingErrors.forbidden();
    if (result.exists && !result.polygonValid) {
      throw PricingErrors.invalidPolygon([
        {
          path: 'polygon',
          code: 'invalid_geometry',
          message: `El polígono no es válido (${result.polygonReason ?? 'geometría inválida'}). Revisa que los bordes no se crucen y que los huecos queden dentro de la zona.`,
        },
      ]);
    }
    checkEdit(result, PricingErrors.geofenceNotFound);
    if (result.changed) deps.onChange?.();
    const saved = await deps.geofences.get(id);
    if (!saved) throw PricingErrors.geofenceNotFound();
    return saved;
  };
}

/** GET /admin/fares/history */
export type ListFareHistory = (query: FareHistoryQuery) => Promise<FareHistoryResponse>;

export function makeListFareHistory(deps: { changes: FareChangeRepository }): ListFareHistory {
  return async ({ cursor, limit }) => {
    const after = cursor ? decodeHistoryCursor(cursor) : undefined;
    if (after === null) throw PricingErrors.invalidCursor();
    const page = await deps.changes.list({ limit, after });
    return { items: page.items, nextCursor: page.next ? encodeHistoryCursor(page.next) : null };
  };
}
