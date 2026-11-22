import { AREA_KIND_LABELS, ApiErrorCode, type AreaKind } from '@panter/contracts';
import { AppError } from '../../../shared/errors/app-error';
import { SERVICE_AREA_TEXT, type CatalogIssue } from '../domain/geometry';

/** Errores del catálogo geográfico (E15). */
export const CatalogErrors = {
  areaNotFound: () => AppError.notFound('No encontramos ese barrio o vereda.'),
  areaNameTaken: (kind: AreaKind, name: string) =>
    new AppError(
      ApiErrorCode.AREA_NAME_TAKEN,
      `Ya existe ${kind === 'BARRIO' ? 'un barrio llamado' : 'una vereda llamada'} «${name}». Usa otro nombre o edita el existente.`,
      { status: 409, details: { kind, kindLabel: AREA_KIND_LABELS[kind], name } },
    ),
  /**
   * 422 INVALID_POLYGON: fuera del área de servicio, anillos sin 3 puntos o `ST_IsValid` falso.
   * `details.reason` trae el motivo (el de `ST_IsValidReason` si lo rechazó PostGIS).
   */
  invalidPolygon: (reason: string, issues: CatalogIssue[] = []) =>
    new AppError(
      ApiErrorCode.INVALID_POLYGON,
      'Revisa el dibujo: el polígono no es válido o se sale del área de servicio.',
      { status: 422, details: { reason, issues } },
    ),
  placeNotFound: () => AppError.notFound('No encontramos ese lugar.'),
  placeSlugTaken: (slug: string) =>
    new AppError(
      ApiErrorCode.PLACE_SLUG_TAKEN,
      `Ya hay un lugar con el identificador «${slug}». Usa otro (por ejemplo, agrega el barrio o la vereda).`,
      { status: 409, details: { slug } },
    ),
  /** El lugar o su punto de recogida quedó fuera del área de servicio. */
  placeOutOfServiceArea: (point: 'location' | 'pickupPoint') =>
    new AppError(
      ApiErrorCode.OUT_OF_SERVICE_AREA,
      point === 'location'
        ? `La ubicación del lugar está fuera del área de servicio de PANTER (${SERVICE_AREA_TEXT}).`
        : `El punto de recogida está fuera del área de servicio de PANTER (${SERVICE_AREA_TEXT}).`,
      { status: 422, details: { point } },
    ),
  pickupTooFar: (maxMeters: number) =>
    AppError.validation(
      `El punto de recogida debe estar a menos de ${maxMeters / 1000} km del lugar.`,
      [
        {
          path: 'pickupPoint',
          code: 'pickup_too_far',
          message: `El punto de recogida debe estar a menos de ${maxMeters / 1000} km del lugar.`,
        },
      ],
    ),
  forbidden: () =>
    new AppError(ApiErrorCode.FORBIDDEN, 'No tienes permiso para realizar esta acción.', {
      status: 403,
    }),
  polygonNeedsIds: () =>
    AppError.validation('Para traer los polígonos indica los barrios con `ids` (máximo 100).', [
      { path: 'include', code: 'ids_required', message: 'include=polygon requiere ids' },
    ]),
  invalidCursor: () => AppError.validation('El cursor de paginación no es válido.'),
  invalidName: () =>
    AppError.validation('El nombre debe tener letras o números.', [
      { path: 'name', code: 'invalid_name', message: 'El nombre debe tener letras o números.' },
    ]),
};
