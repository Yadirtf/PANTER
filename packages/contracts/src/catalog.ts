import { z } from 'zod';
import { LatLngSchema, PolygonRingsSchema } from './geo';

/**
 * Catálogo geográfico (E15): barrios y veredas con su polígono (HU-308) y lugares de interés
 * con su ubicación real (HU-310). Sirve para describir origen y destino ("Barrio X · cerca de
 * Y"), dibujar el croquis del barrio y que el conductor sepa exactamente a dónde ir.
 */

/** Texto para buscar sin distinguir mayúsculas ni tildes: "Pozo Azul" ≈ "pozo azul" ≈ "POZÓ". */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

const Name = z.string().trim().min(2).max(80);

// --- Barrios y veredas (HU-308) ---

export const AreaKind = {
  /** Barrio del casco urbano. */
  BARRIO: 'BARRIO',
  /** Vereda (zona rural). */
  VEREDA: 'VEREDA',
} as const;
export type AreaKind = (typeof AreaKind)[keyof typeof AreaKind];
export const AreaKindSchema = z.enum(AreaKind);

export const AREA_KIND_LABELS: Record<AreaKind, string> = {
  BARRIO: 'Barrio',
  VEREDA: 'Vereda',
};

export const AreaSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: AreaKindSchema,
  active: z.boolean(),
});
export type AreaSummary = z.infer<typeof AreaSummarySchema>;

export const AreaSchema = AreaSummarySchema.extend({
  polygon: PolygonRingsSchema,
  /** De dónde salió el límite (p. ej. "Alcaldía – POT 2024", "Dibujado por ADMIN"). */
  source: z.string().nullable(),
  /** Centro aproximado (para centrar el mapa y poner la etiqueta). */
  center: LatLngSchema,
  updatedAt: z.iso.datetime(),
  updatedBy: z.string().nullable(),
});
export type Area = z.infer<typeof AreaSchema>;

export const AreasQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  kind: AreaKindSchema.optional(),
  /** Solo para ADMIN: incluir los desactivados. */
  includeInactive: z.coerce.boolean().default(false),
});
export type AreasQuery = z.infer<typeof AreasQuerySchema>;

export const AreasResponseSchema = z.object({ items: z.array(AreaSummarySchema) });
export type AreasResponse = z.infer<typeof AreasResponseSchema>;

export const LocateQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export type LocateQuery = z.infer<typeof LocateQuerySchema>;

export const AreaLocateResponseSchema = z.object({ area: AreaSummarySchema.nullable() });
export type AreaLocateResponse = z.infer<typeof AreaLocateResponseSchema>;

export const AreaCreateBodySchema = z.object({
  name: Name,
  kind: AreaKindSchema,
  polygon: PolygonRingsSchema,
  source: z.string().trim().max(200).nullable().optional(),
});
export type AreaCreateBody = z.infer<typeof AreaCreateBodySchema>;

export const AreaUpdateBodySchema = AreaCreateBodySchema.partial().extend({
  active: z.boolean().optional(),
});
export type AreaUpdateBody = z.infer<typeof AreaUpdateBodySchema>;

/** Máximo de polígonos por importación (evita consultas gigantes a PostGIS). */
export const AREA_IMPORT_MAX_FEATURES = 500;

/**
 * Importación GeoJSON: FeatureCollection de Polygon (o MultiPolygon de una sola parte), con el
 * nombre y, opcionalmente, el tipo en las propiedades. `dryRun` valida sin guardar.
 */
export const AreaImportBodySchema = z.object({
  geojson: z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(z.unknown()).min(1).max(AREA_IMPORT_MAX_FEATURES),
  }),
  /** Propiedad con el nombre (por defecto "name" o "nombre"). */
  nameProperty: z.string().trim().min(1).max(40).optional(),
  /** Propiedad con el tipo BARRIO/VEREDA; si falta, se usa defaultKind. */
  kindProperty: z.string().trim().min(1).max(40).optional(),
  defaultKind: AreaKindSchema.default(AreaKind.BARRIO),
  source: z.string().trim().max(200).optional(),
  dryRun: z.boolean().default(true),
});
export type AreaImportBody = z.infer<typeof AreaImportBodySchema>;

export const AreaImportResultSchema = z.object({
  dryRun: z.boolean(),
  /** Polígonos válidos (con su nombre, tipo y si ya existía uno con ese nombre). */
  valid: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      name: z.string(),
      kind: AreaKindSchema,
      polygon: PolygonRingsSchema,
      replacesExisting: z.boolean(),
    }),
  ),
  /** Features rechazadas con el motivo, en español. */
  errors: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      name: z.string().nullable(),
      reason: z.string(),
    }),
  ),
  /** Guardados (0 en dryRun). */
  saved: z.number().int().nonnegative(),
});
export type AreaImportResult = z.infer<typeof AreaImportResultSchema>;

export const AreaRoutes = {
  /** GET público ?q=&kind= */
  LIST: '/areas',
  /** GET público ?lat=&lng= */
  LOCATE: '/areas/locate',
  /** GET público (con polígono) */
  DETAIL: '/areas/:id',
  /** POST (ADMIN) */
  ADMIN_CREATE: '/admin/areas',
  /** PATCH (ADMIN) */
  ADMIN_UPDATE: '/admin/areas/:id',
  /** POST (ADMIN) */
  ADMIN_IMPORT: '/admin/areas/import',
  /** GET (ADMIN) historial ?cursor= */
  ADMIN_HISTORY: '/admin/areas/:id/history',
} as const;

export const areaPath = (id: string) => `/areas/${encodeURIComponent(id)}`;
export const adminAreaPath = (id: string, history = false) =>
  `/admin/areas/${encodeURIComponent(id)}${history ? '/history' : ''}`;

// --- Lugares de interés (HU-310) ---

export const PlaceCategory = {
  AIRPORT: 'AIRPORT',
  TRANSPORT: 'TRANSPORT',
  PARK: 'PARK',
  TOURISM: 'TOURISM',
  HEALTH: 'HEALTH',
  EDUCATION: 'EDUCATION',
  GOVERNMENT: 'GOVERNMENT',
  COMMERCE: 'COMMERCE',
  FOOD: 'FOOD',
  LODGING: 'LODGING',
  RELIGION: 'RELIGION',
  OTHER: 'OTHER',
} as const;
export type PlaceCategory = (typeof PlaceCategory)[keyof typeof PlaceCategory];
export const PlaceCategorySchema = z.enum(PlaceCategory);

export const PLACE_CATEGORY_LABELS: Record<PlaceCategory, string> = {
  AIRPORT: 'Aeropuerto',
  TRANSPORT: 'Transporte',
  PARK: 'Parque',
  TOURISM: 'Sitio turístico',
  HEALTH: 'Salud',
  EDUCATION: 'Educación',
  GOVERNMENT: 'Entidad pública',
  COMMERCE: 'Comercio',
  FOOD: 'Restaurante',
  LODGING: 'Hospedaje',
  RELIGION: 'Iglesia',
  OTHER: 'Otro',
};

export const PlaceSchema = z.object({
  id: z.uuid(),
  /** Identificador estable y legible (p. ej. "aeropuerto-cananguchal"). */
  slug: z.string(),
  name: z.string(),
  category: PlaceCategorySchema,
  location: LatLngSchema,
  /** Punto exacto de recogida o entrada (portería, parqueadero), si difiere de `location`. */
  pickupPoint: LatLngSchema.nullable(),
  /** Barrio o vereda que contiene el lugar (calculado por la API). */
  area: AreaSummarySchema.nullable(),
  /** false mientras la ubicación no se haya confirmado en sitio. */
  verified: z.boolean(),
  active: z.boolean(),
  source: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type Place = z.infer<typeof PlaceSchema>;

export const PlacesQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: PlaceCategorySchema.optional(),
  includeInactive: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PlacesQuery = z.infer<typeof PlacesQuerySchema>;

export const PlacesResponseSchema = z.object({ items: z.array(PlaceSchema) });
export type PlacesResponse = z.infer<typeof PlacesResponseSchema>;

export const NearbyQuerySchema = LocateQuerySchema.extend({
  radiusMeters: z.coerce.number().int().min(10).max(2000).default(300),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export type NearbyQuery = z.infer<typeof NearbyQuerySchema>;

export const NearbyPlacesResponseSchema = z.object({
  items: z.array(PlaceSchema.extend({ distanceMeters: z.number().nonnegative() })),
});
export type NearbyPlacesResponse = z.infer<typeof NearbyPlacesResponseSchema>;

export const PlaceCreateBodySchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'Solo minúsculas, números y guiones' })
    .max(60),
  name: Name,
  category: PlaceCategorySchema,
  location: LatLngSchema,
  pickupPoint: LatLngSchema.nullable().optional(),
  verified: z.boolean().default(false),
  source: z.string().trim().max(200).nullable().optional(),
});
export type PlaceCreateBody = z.infer<typeof PlaceCreateBodySchema>;

export const PlaceUpdateBodySchema = PlaceCreateBodySchema.omit({ slug: true })
  .partial()
  .extend({ active: z.boolean().optional() });
export type PlaceUpdateBody = z.infer<typeof PlaceUpdateBodySchema>;

export const PlaceRoutes = {
  /** GET público ?q=&category= */
  LIST: '/places',
  /** GET público ?lat=&lng=&radiusMeters= */
  NEARBY: '/places/nearby',
  /** POST (ADMIN) */
  ADMIN_CREATE: '/admin/places',
  /** PATCH (ADMIN) */
  ADMIN_UPDATE: '/admin/places/:id',
  /** GET (ADMIN) historial */
  ADMIN_HISTORY: '/admin/places/:id/history',
} as const;

export const adminPlacePath = (id: string, history = false) =>
  `/admin/places/${encodeURIComponent(id)}${history ? '/history' : ''}`;

// --- Historial común (barrios y lugares) ---

export const CatalogChangeSchema = z.object({
  id: z.uuid(),
  entity: z.enum(['AREA', 'PLACE']),
  entityId: z.uuid(),
  action: z.enum(['CREATE', 'UPDATE', 'IMPORT']),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  changedBy: z.string().nullable(),
  changedAt: z.iso.datetime(),
});
export type CatalogChange = z.infer<typeof CatalogChangeSchema>;

export const CatalogHistoryResponseSchema = z.object({
  items: z.array(CatalogChangeSchema),
  nextCursor: z.string().nullable(),
});
export type CatalogHistoryResponse = z.infer<typeof CatalogHistoryResponseSchema>;

/** Descripción corta para mostrar: "Barrio Centro · cerca de Parque principal". */
export function describeLocation(
  area: Pick<AreaSummary, 'name' | 'kind'> | null,
  nearby: Pick<Place, 'name'> | null,
): string | null {
  const parts = [
    area ? `${AREA_KIND_LABELS[area.kind]} ${area.name}` : null,
    nearby ? `cerca de ${nearby.name}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}
