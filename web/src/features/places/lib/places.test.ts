import { PlaceCreateBodySchema, PlaceUpdateBodySchema } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { catalogDiff } from '@/features/catalog/lib/catalog-history';
import {
  ALL_PLACES,
  AIRPORT_PLACE,
  HOSPITAL,
  PARK_PLACE,
  PLACE_CHANGE,
  POZO_AZUL,
} from '@/features/catalog/server/catalog-test-data';
import {
  emptyPlaceForm,
  filterPlaces,
  formToPlaceBody,
  PLACE_FIELD_ERROR,
  PLACE_VALUE_LABELS,
  pickupWarning,
  placeAreaText,
  placeChanges,
  placeToForm,
  placeUpdateBody,
  suggestSlug,
  withName,
} from './places';

describe('identificador sugerido desde el nombre', () => {
  it('searchKey de contracts con guiones: sin tildes, sin mayúsculas, ñ → n', () => {
    expect(suggestSlug('Aeropuerto Cananguchal')).toBe('aeropuerto-cananguchal');
    expect(suggestSlug('  Río Guineo ')).toBe('rio-guineo');
    expect(suggestSlug('Peñas Blancas')).toBe('penas-blancas');
    expect(suggestSlug('Hospital José María Hernández (E.S.E.)')).toBe(
      'hospital-jose-maria-hernandez-e-s-e',
    );
    expect(suggestSlug('¡¡!!')).toBe('');
  });

  it('cumple el formato del contrato y no corta palabras al pasar de 60 caracteres', () => {
    const slug = suggestSlug(
      'Institución Educativa Rural Departamental Alto Sinaí sede principal Villagarzón',
    );
    expect(slug).toBe('institucion-educativa-rural-departamental-alto-sinai-sede');
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(PlaceCreateBodySchema.shape.slug.safeParse(slug).success).toBe(true);
    expect(suggestSlug('a'.repeat(70))).toHaveLength(60);
  });

  it('sigue al nombre hasta que el ADMIN lo cambia a mano', () => {
    const form = withName(emptyPlaceForm(), 'Terminal de transportes');
    expect(form.slug).toBe('terminal-de-transportes');
    const edited = withName({ ...form, slug: 'terminal', slugTouched: true }, 'Terminal nueva');
    expect(edited.slug).toBe('terminal');
  });
});

describe('lista de lugares', () => {
  it('búsqueda sin tildes y por identificador; filtro por categoría', () => {
    expect(filterPlaces(ALL_PLACES, { q: 'POZO', category: '' }).map((p) => p.id)).toEqual([
      POZO_AZUL.id,
    ]);
    expect(filterPlaces(ALL_PLACES, { q: 'cananguchal', category: '' })).toHaveLength(1);
    expect(filterPlaces(ALL_PLACES, { q: 'aeropuerto-can', category: '' })).toHaveLength(1);
    expect(filterPlaces(ALL_PLACES, { q: '', category: 'HEALTH' }).map((p) => p.id)).toEqual([
      HOSPITAL.id,
    ]);
    // Activos primero; el hospital está desactivado.
    expect(filterPlaces(ALL_PLACES, { q: '', category: '' }).at(-1)!.id).toBe(HOSPITAL.id);
  });
});

describe('formulario y cuerpos de la API', () => {
  const valid = {
    ...withName(emptyPlaceForm({ lat: 1.0301234567, lng: -76.6181234567 }), 'Hospital local'),
    category: 'HEALTH' as const,
    pickupPoint: { lat: 1.0303, lng: -76.6178 },
    source: 'GPS en sitio',
    verified: true,
  };

  it('crear: cuerpo del contrato con coordenadas redondeadas y punto de recogida', () => {
    const parsed = formToPlaceBody(valid);
    expect(parsed).toEqual({
      ok: true,
      body: {
        slug: 'hospital-local',
        name: 'Hospital local',
        category: 'HEALTH',
        location: { lat: 1.030123, lng: -76.618123 },
        pickupPoint: { lat: 1.0303, lng: -76.6178 },
        verified: true,
        source: 'GPS en sitio',
      },
    });
    expect(PlaceCreateBodySchema.safeParse(parsed.ok && parsed.body).success).toBe(true);
  });

  it('errores en español: sin ubicación, fuera del área, identificador y nombre inválidos', () => {
    expect(formToPlaceBody({ ...valid, location: null })).toEqual({
      ok: false,
      errors: { location: PLACE_FIELD_ERROR.location },
    });
    expect(
      formToPlaceBody({
        ...valid,
        location: { lat: 2.4, lng: -76.6 },
        pickupPoint: { lat: 3, lng: -76 },
      }),
    ).toEqual({
      ok: false,
      errors: { location: PLACE_FIELD_ERROR.location, pickupPoint: PLACE_FIELD_ERROR.pickupPoint },
    });
    expect(formToPlaceBody({ ...valid, slug: 'Hospital Local', name: 'H' })).toEqual({
      ok: false,
      errors: { slug: PLACE_FIELD_ERROR.slug, name: PLACE_FIELD_ERROR.name },
    });
  });

  it('editar: solo lo que cambió, nunca el identificador', () => {
    const form = placeToForm(POZO_AZUL);
    const same = formToPlaceBody(form);
    if (!same.ok) throw new Error('formulario inválido');
    expect(placeUpdateBody(POZO_AZUL, same.body)).toEqual({});
    const moved = formToPlaceBody({
      ...form,
      slug: 'otro-slug',
      location: { lat: 1.0512, lng: -76.6433 },
      verified: true,
    });
    if (!moved.ok) throw new Error('formulario inválido');
    const body = placeUpdateBody(POZO_AZUL, moved.body);
    expect(body).toEqual({ location: { lat: 1.0512, lng: -76.6433 }, verified: true });
    expect(PlaceUpdateBodySchema.safeParse(body).success).toBe(true);
    // Quitar el punto de recogida se envía como null.
    const noPickup = formToPlaceBody({ ...placeToForm(HOSPITAL), pickupPoint: null });
    if (!noPickup.ok) throw new Error('formulario inválido');
    expect(placeUpdateBody(HOSPITAL, noPickup.body)).toEqual({ pickupPoint: null });
  });

  it('confirmación con diff legible (categoría, ubicación y verificado)', () => {
    expect(
      placeChanges(POZO_AZUL, {
        category: 'PARK',
        location: { lat: 1.0512, lng: -76.6433 },
        verified: true,
      }),
    ).toEqual([
      { field: 'category', label: 'Categoría', before: 'Sitio turístico', after: 'Parque' },
      {
        field: 'location',
        label: 'Ubicación',
        before: '1,04500; −76,64000',
        after: '1,05120; −76,64330',
      },
      { field: 'verified', label: 'Ubicación verificada en sitio', before: 'No', after: 'Sí' },
    ]);
    expect(placeChanges(PARK_PLACE, { active: false })).toEqual([
      { field: 'active', label: 'Activo', before: 'Sí', after: 'No' },
    ]);
  });

  it('el historial de un lugar usa las mismas etiquetas', () => {
    expect(catalogDiff(PLACE_CHANGE.before, PLACE_CHANGE.after, PLACE_VALUE_LABELS)).toHaveLength(
      3,
    );
  });
});

describe('ubicación', () => {
  it('advierte si el punto de recogida queda a más de 500 m del lugar', () => {
    expect(pickupWarning(HOSPITAL.location, HOSPITAL.pickupPoint)).toBeNull();
    expect(pickupWarning(PARK_PLACE.location, AIRPORT_PLACE.location)).toMatch(
      /^El punto de recogida está a 5\.\d{3} m del lugar\./,
    );
    expect(pickupWarning(PARK_PLACE.location, null)).toBeNull();
  });

  it('barrio o vereda calculado por la API', () => {
    expect(placeAreaText(PARK_PLACE)).toBe('Barrio Centro');
    expect(placeAreaText(POZO_AZUL)).toBe('Fuera de los barrios y veredas registrados');
  });
});
