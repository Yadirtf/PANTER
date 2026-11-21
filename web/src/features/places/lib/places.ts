import {
  AREA_KIND_LABELS,
  haversineMeters,
  isInServiceArea,
  PLACE_CATEGORY_LABELS,
  PlaceCategory,
  PlaceCreateBodySchema,
  searchKey,
  type LatLng,
  type Place,
  type PlaceCreateBody,
  type PlaceUpdateBody,
} from '@panter/contracts';
import { catalogDiff, type ValueLabels } from '@/features/catalog/lib/catalog-history';
import type { FieldErrors, ParseResult } from '@/features/fares/lib/fares';
import type { FieldChange } from '@/features/fares/lib/history';
import { roundCoord } from '@/features/geo-editor/lib/polygon-edit';

/** Lugares de interés en la web (HU-310): lista, formulario y cuerpos de la API. */

export const ADMIN_PLACES_PATH = '/admin/lugares';

export const PLACE_CATEGORIES: readonly PlaceCategory[] = Object.values(PlaceCategory);

/** Etiquetas de los valores de un lugar para el historial y la confirmación. */
export const PLACE_VALUE_LABELS: ValueLabels = { category: PLACE_CATEGORY_LABELS };

/** Id del lugar que se está creando (aún no existe en la API). */
export const NEW_PLACE_ID = 'nuevo';

const SLUG_MAX = 60;

/**
 * Identificador sugerido desde el nombre: searchKey de contracts (sin tildes ni mayúsculas) con
 * guiones. "Aeropuerto Cananguchal" → "aeropuerto-cananguchal", "Peñas Blancas" →
 * "penas-blancas". Máximo 60 caracteres, sin cortar una palabra a la mitad si se puede.
 */
export function suggestSlug(name: string): string {
  const words = searchKey(name).replace(/ñ/g, 'n').split(' ').filter(Boolean);
  let slug = '';
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > SLUG_MAX) {
      if (!slug) slug = word.slice(0, SLUG_MAX);
      break;
    }
    slug = next;
  }
  return slug;
}

export interface PlaceFilter {
  q: string;
  category: PlaceCategory | '';
}

/** Filtra por categoría y por nombre sin tildes; activos primero y luego por nombre. */
export function filterPlaces<T extends Pick<Place, 'name' | 'category' | 'active' | 'slug'>>(
  places: readonly T[],
  filter: PlaceFilter,
): T[] {
  const words = searchKey(filter.q).split(' ').filter(Boolean);
  return places
    .filter((place) => !filter.category || place.category === filter.category)
    .filter((place) => {
      const key = `${searchKey(place.name)} ${place.slug}`;
      return words.every((word) => key.includes(word));
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
    );
}

// --- Formulario ---

export interface PlaceForm {
  name: string;
  slug: string;
  /** El ADMIN cambió el identificador a mano: ya no se sugiere desde el nombre. */
  slugTouched: boolean;
  category: PlaceCategory;
  location: LatLng | null;
  pickupPoint: LatLng | null;
  source: string;
  verified: boolean;
}
export type PlaceFormField = 'name' | 'slug' | 'category' | 'location' | 'pickupPoint' | 'source';

export const PLACE_FIELD_ERROR: Record<PlaceFormField, string> = {
  name: 'Escribe un nombre de 2 a 80 caracteres.',
  slug: 'Usa solo minúsculas, números y guiones (p. ej. "parque-principal"), hasta 60 caracteres.',
  category: 'Elige una categoría.',
  location: 'Ubica el lugar en el mapa (dentro del área de servicio).',
  pickupPoint: 'El punto de recogida debe quedar dentro del área de servicio.',
  source: 'La fuente puede tener hasta 200 caracteres.',
};

export function emptyPlaceForm(location: LatLng | null = null): PlaceForm {
  return {
    name: '',
    slug: '',
    slugTouched: false,
    category: PlaceCategory.TOURISM,
    location,
    pickupPoint: null,
    source: '',
    verified: false,
  };
}

export function placeToForm(place: Place): PlaceForm {
  return {
    name: place.name,
    slug: place.slug,
    slugTouched: true,
    category: place.category,
    location: place.location,
    pickupPoint: place.pickupPoint,
    source: place.source ?? '',
    verified: place.verified,
  };
}

/** Cambia el nombre y, si el ADMIN no tocó el identificador, lo sugiere de nuevo. */
export function withName(form: PlaceForm, name: string): PlaceForm {
  return { ...form, name, slug: form.slugTouched ? form.slug : suggestSlug(name) };
}

const roundPoint = (p: LatLng): LatLng => ({ lat: roundCoord(p.lat), lng: roundCoord(p.lng) });

/** Valida el formulario con el esquema de contracts y el área de servicio. */
export function formToPlaceBody(form: PlaceForm): ParseResult<PlaceCreateBody, PlaceFormField> {
  const errors: FieldErrors<PlaceFormField> = {};
  if (!form.location || !isInServiceArea(form.location))
    errors.location = PLACE_FIELD_ERROR.location;
  if (form.pickupPoint && !isInServiceArea(form.pickupPoint)) {
    errors.pickupPoint = PLACE_FIELD_ERROR.pickupPoint;
  }
  const parsed = PlaceCreateBodySchema.safeParse({
    slug: form.slug,
    name: form.name,
    category: form.category,
    location: form.location ? roundPoint(form.location) : undefined,
    pickupPoint: form.pickupPoint ? roundPoint(form.pickupPoint) : null,
    verified: form.verified,
    source: form.source.trim() ? form.source : null,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as PlaceFormField;
      if (field in PLACE_FIELD_ERROR && !errors[field]) errors[field] = PLACE_FIELD_ERROR[field];
    }
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, body: parsed.data };
}

const samePoint = (a: LatLng | null, b: LatLng | null) =>
  a === b ||
  (!!a &&
    !!b &&
    roundCoord(a.lat) === roundCoord(b.lat) &&
    roundCoord(a.lng) === roundCoord(b.lng));

/** PATCH /admin/places/:id: solo lo que cambió (el identificador no se edita). `{}` sin cambios. */
export function placeUpdateBody(saved: Place, body: PlaceCreateBody): PlaceUpdateBody {
  const out: PlaceUpdateBody = {};
  if (body.name !== saved.name) out.name = body.name;
  if (body.category !== saved.category) out.category = body.category;
  if (!samePoint(body.location, saved.location)) out.location = body.location;
  if (!samePoint(body.pickupPoint ?? null, saved.pickupPoint)) {
    out.pickupPoint = body.pickupPoint ?? null;
  }
  if (body.verified !== saved.verified) out.verified = body.verified;
  if ((body.source ?? null) !== (saved.source ?? null)) out.source = body.source ?? null;
  return out;
}

const snapshot = (place: Partial<Place>) => ({
  slug: place.slug,
  name: place.name,
  category: place.category,
  location: place.location,
  pickupPoint: place.pickupPoint ?? null,
  verified: place.verified,
  source: place.source ?? null,
  active: place.active,
});

/** Diff legible para la confirmación (crear: todo nuevo; editar: lo que cambió). */
export function placeChanges(
  saved: Place | null,
  body: PlaceCreateBody | PlaceUpdateBody,
): FieldChange[] {
  if (!saved) return catalogDiff(null, snapshot({ ...body, active: true }), PLACE_VALUE_LABELS);
  const before = snapshot(saved);
  return catalogDiff(before, { ...before, ...body }, PLACE_VALUE_LABELS);
}

/** Distancia a partir de la cual el punto de recogida parece de otro lugar. */
export const PICKUP_WARNING_METERS = 500;

/** Advertencia (no bloquea) si el punto de recogida queda lejos del lugar. */
export function pickupWarning(location: LatLng | null, pickup: LatLng | null): string | null {
  if (!location || !pickup) return null;
  const meters = haversineMeters(location, pickup);
  if (meters <= PICKUP_WARNING_METERS) return null;
  return `El punto de recogida está a ${Math.round(meters).toLocaleString('es-CO')} m del lugar. Revisa que sea la entrada correcta.`;
}

/** Barrio o vereda que calculó la API para el lugar. */
export function placeAreaText(place: Pick<Place, 'area'>): string {
  return place.area
    ? `${AREA_KIND_LABELS[place.area.kind]} ${place.area.name}`
    : 'Fuera de los barrios y veredas registrados';
}
