import {
  AREA_KIND_LABELS,
  AreaKind,
  searchKey,
  type AreaImportBody,
  type LatLng,
} from '@panter/contracts';
import { areaPolygonIssues, openRing } from './geometry';

/** Feature del archivo que pasó las validaciones sin base de datos. */
export interface ImportCandidate {
  index: number;
  name: string;
  /** `searchKey(name)`: unicidad por tipo sin tildes ni mayúsculas. */
  nameSearch: string;
  kind: AreaKind;
  polygon: LatLng[][];
}

export interface ImportIssue {
  index: number;
  name: string | null;
  reason: string;
}

export interface ParsedImport {
  candidates: ImportCandidate[];
  errors: ImportIssue[];
}

/** Propiedades donde se busca el nombre si no se indica `nameProperty`. */
export const DEFAULT_NAME_PROPERTIES = ['name', 'nombre'] as const;

type Props = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Valor de una propiedad sin distinguir mayúsculas: los archivos de la Alcaldía o del POT
 * suelen traer "NOMBRE" o "Nombre" (exportados de ArcGIS o QGIS).
 */
function prop(props: Props, name: string): unknown {
  if (name in props) return props[name];
  const lower = name.toLowerCase();
  const key = Object.keys(props).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : props[key];
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

class FeatureError extends Error {}

function position(value: unknown): LatLng {
  if (!Array.isArray(value) || value.length < 2) {
    throw new FeatureError(
      'Hay una coordenada mal formada: cada punto debe ser [longitud, latitud].',
    );
  }
  const [lng, lat] = value as unknown[];
  if (
    typeof lng !== 'number' ||
    typeof lat !== 'number' ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    throw new FeatureError(
      'Hay una coordenada fuera de rango. Revisa que el archivo esté en WGS 84 (EPSG:4326) y en el orden [longitud, latitud].',
    );
  }
  return { lat, lng };
}

function rings(value: unknown): LatLng[][] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new FeatureError('El polígono no tiene coordenadas.');
  }
  return value.map((ring) => {
    if (!Array.isArray(ring)) throw new FeatureError('Un borde del polígono está mal formado.');
    return openRing(ring.map(position));
  });
}

/** Polygon, o MultiPolygon de una sola parte (como lo exportan QGIS y ArcGIS). */
function polygonOf(geometry: unknown): LatLng[][] {
  if (!isObject(geometry)) throw new FeatureError('La feature no tiene geometría.');
  if (geometry.type === 'Polygon') return rings(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    const parts = geometry.coordinates;
    if (!Array.isArray(parts) || parts.length === 0) {
      throw new FeatureError('El polígono no tiene coordenadas.');
    }
    if (parts.length > 1) {
      throw new FeatureError(
        `La geometría tiene ${parts.length} partes (MultiPolygon). Deja una sola parte o sepárala en barrios distintos.`,
      );
    }
    return rings(parts[0]);
  }
  throw new FeatureError(
    `La geometría debe ser un polígono (Polygon) y es ${typeof geometry.type === 'string' ? geometry.type : 'desconocida'}.`,
  );
}

function kindOf(value: unknown, fallback: AreaKind, property: string): AreaKind {
  const raw = text(value);
  if (raw === null) return fallback;
  const key = searchKey(raw);
  if (key === 'barrio') return AreaKind.BARRIO;
  if (key === 'vereda') return AreaKind.VEREDA;
  throw new FeatureError(
    `El tipo «${raw}» (propiedad "${property}") no es válido: usa BARRIO o VEREDA.`,
  );
}

function nameOf(props: Props, nameProperty: string | undefined): string | null {
  if (nameProperty) return text(prop(props, nameProperty));
  for (const p of DEFAULT_NAME_PROPERTIES) {
    const value = text(prop(props, p));
    if (value) return value;
  }
  return null;
}

/**
 * Lee un FeatureCollection de barrios o veredas (HU-308) sin tocar la base de datos. Por cada
 * feature, en orden:
 * 1. es un objeto `Feature` con geometría Polygon (o MultiPolygon de una sola parte);
 * 2. nombre en `nameProperty` o en "name"/"nombre" (sin distinguir mayúsculas), de 2 a 80
 *    caracteres;
 * 3. tipo en `kindProperty` (BARRIO o VEREDA, sin distinguir tildes ni mayúsculas) o
 *    `defaultKind`;
 * 4. polígono dentro del área de servicio, con anillos de al menos 3 vértices;
 * 5. sin repetir (tipo, nombre sin tildes) dentro del mismo archivo.
 * Las válidas siguen a PostGIS (`ST_IsValid` y si ya existe una con ese nombre); las demás
 * quedan en `errors` con el índice y el motivo en español.
 */
export function parseAreaImport(body: AreaImportBody): ParsedImport {
  const candidates: ImportCandidate[] = [];
  const errors: ImportIssue[] = [];
  const seen = new Map<string, number>();

  body.geojson.features.forEach((feature, index) => {
    let name: string | null = null;
    try {
      if (!isObject(feature) || feature.type !== 'Feature') {
        throw new FeatureError('No es una Feature de GeoJSON.');
      }
      const props: Props = isObject(feature.properties) ? feature.properties : {};
      name = nameOf(props, body.nameProperty);
      const polygon = polygonOf(feature.geometry);
      if (!name) {
        throw new FeatureError(
          body.nameProperty
            ? `No tiene nombre en la propiedad "${body.nameProperty}".`
            : 'No tiene nombre: agrega la propiedad "name" o "nombre", o indica cuál usar.',
        );
      }
      if (name.length < 2 || name.length > 80) {
        throw new FeatureError('El nombre debe tener entre 2 y 80 caracteres.');
      }
      const nameSearch = searchKey(name);
      if (!nameSearch) throw new FeatureError('El nombre debe tener letras o números.');
      const kind = body.kindProperty
        ? kindOf(prop(props, body.kindProperty), body.defaultKind, body.kindProperty)
        : body.defaultKind;
      const issues = areaPolygonIssues(polygon);
      if (issues.length > 0) {
        throw new FeatureError([...new Set(issues.map((i) => i.message))].join(' '));
      }
      const dupKey = `${kind}|${nameSearch}`;
      const first = seen.get(dupKey);
      if (first !== undefined) {
        throw new FeatureError(
          `${AREA_KIND_LABELS[kind]} repetido en el archivo: ya aparece en la feature ${first}.`,
        );
      }
      seen.set(dupKey, index);
      candidates.push({ index, name, nameSearch, kind, polygon });
    } catch (error) {
      if (!(error instanceof FeatureError)) throw error;
      errors.push({ index, name, reason: error.message });
    }
  });

  return { candidates, errors };
}

/** Motivo en español de un polígono que PostGIS rechazó (`ST_IsValidReason`). */
export function invalidGeometryReason(reason: string | null): string {
  return `El polígono no es válido para PostGIS (${reason ?? 'geometría inválida'}). Revisa que los bordes no se crucen y que los huecos queden dentro del borde.`;
}
