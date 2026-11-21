import type { LatLng } from '@panter/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { networkError } from '../../../shared/api/errors';
import { deferred } from '../../../test/fake-api';
import type { CatalogApi } from '../api/catalog-api';
import { AREAS, CENTRO_CENTER, makeArea, PLACES_CATALOG } from '../test-helpers';
import {
  createDescriptionRequester,
  createLocationDescriber,
  DESCRIBE_DEBOUNCE_MS,
  describeKey,
  type LocationDescription,
} from './location-describer';

const parque = PLACES_CATALOG[1]!;

function setup(overrides: Partial<Pick<CatalogApi, 'locateArea' | 'nearbyPlaces'>> = {}) {
  const api = {
    locateArea: vi.fn(async () => ({ area: AREAS[0]! })),
    nearbyPlaces: vi.fn(async () => ({ items: [{ ...parque, distanceMeters: 35 }] })),
    ...overrides,
  };
  const catalog = {
    knownAreas: vi.fn(async () => [makeArea()]),
    knownPlaces: vi.fn(async () => PLACES_CATALOG),
  };
  return { api, catalog, describer: createLocationDescriber({ api, catalog }) };
}

const offline = () => Promise.reject(networkError());

describe('descripción "Barrio X · cerca de Y"', () => {
  it('con /areas/locate y /places/nearby', async () => {
    const { describer, api } = setup();
    const description = await describer.describe(CENTRO_CENTER);
    expect(description).toMatchObject({
      text: 'Barrio Centro · cerca de Parque principal',
      source: 'network',
    });
    expect(api.nearbyPlaces).toHaveBeenCalledWith(CENTRO_CENTER, 1);
  });

  it('solo barrio, solo lugar o ninguno', async () => {
    const onlyArea = setup({ nearbyPlaces: vi.fn(async () => ({ items: [] })) });
    expect((await onlyArea.describer.describe(CENTRO_CENTER)).text).toBe('Barrio Centro');
    const onlyPlace = setup({ locateArea: vi.fn(async () => ({ area: null })) });
    expect((await onlyPlace.describer.describe(CENTRO_CENTER)).text).toBe(
      'cerca de Parque principal',
    );
    const none = setup({
      locateArea: vi.fn(async () => ({ area: null })),
      nearbyPlaces: vi.fn(async () => ({ items: [] })),
    });
    expect((await none.describer.describe(CENTRO_CENTER)).text).toBeNull();
  });

  it('caché por coordenada redondeada (~11 m): mover unos metros no vuelve a consultar', async () => {
    const { describer, api } = setup();
    await describer.describe({ lat: 1.02951, lng: -76.61651 });
    await describer.describe({ lat: 1.02954, lng: -76.61648 });
    expect(api.locateArea).toHaveBeenCalledTimes(1);
    expect(describer.peek({ lat: 1.0295, lng: -76.6165 })?.text).toContain('Barrio Centro');
    await describer.describe({ lat: 1.0301, lng: -76.6165 });
    expect(api.locateArea).toHaveBeenCalledTimes(2);
    expect(describeKey({ lat: 1.02951, lng: -76.61651 })).toBe('1.0295,-76.6165');
  });

  it('dos pedidos del mismo punto al tiempo comparten la consulta', async () => {
    const { describer, api } = setup();
    const [a, b] = await Promise.all([
      describer.describe(CENTRO_CENTER),
      describer.describe(CENTRO_CENTER),
    ]);
    expect(a).toBe(b);
    expect(api.locateArea).toHaveBeenCalledTimes(1);
  });

  it('sin señal: describe con la copia del catálogo y no la guarda en la caché', async () => {
    const { describer, api } = setup({ locateArea: vi.fn(offline), nearbyPlaces: vi.fn(offline) });
    const near = { lat: 1.0297, lng: -76.6163 };
    expect(await describer.describe(near)).toMatchObject({
      text: 'Barrio Centro · cerca de Parque principal',
      source: 'offline',
    });
    expect(describer.peek(near)).toBeNull();
    await describer.describe(near);
    expect(api.locateArea).toHaveBeenCalledTimes(2);
  });

  it('sin señal y lejos de todo: sin descripción', async () => {
    const { describer } = setup({ locateArea: vi.fn(offline), nearbyPlaces: vi.fn(offline) });
    expect((await describer.describe({ lat: 1.2, lng: -76.9 })).text).toBeNull();
  });
});

describe('debounce mientras se arrastra el pin', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const points: LatLng[] = [
    { lat: 1.025, lng: -76.61 },
    { lat: 1.026, lng: -76.611 },
    { lat: 1.027, lng: -76.612 },
  ];

  it('solo consulta el último punto, tras la pausa', async () => {
    const { describer, api } = setup();
    const results: [LatLng, LocationDescription][] = [];
    const requester = createDescriptionRequester(describer, (p, d) => results.push([p, d]));
    for (const point of points) {
      requester.request(point);
      await vi.advanceTimersByTimeAsync(DESCRIBE_DEBOUNCE_MS / 3);
    }
    expect(api.locateArea).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DESCRIBE_DEBOUNCE_MS);
    expect(api.locateArea).toHaveBeenCalledTimes(1);
    expect(api.locateArea).toHaveBeenCalledWith(points[2]);
    expect(results.map(([p]) => p)).toEqual([points[2]]);
  });

  it('un punto ya descrito responde enseguida, sin esperar ni consultar', async () => {
    const { describer, api } = setup();
    await describer.describe(points[0]!);
    const onResult = vi.fn();
    createDescriptionRequester(describer, onResult).request(points[0]!);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(api.locateArea).toHaveBeenCalledTimes(1);
  });

  it('descarta la respuesta de un punto reemplazado mientras se consultaba', async () => {
    const slow = deferred<{ area: (typeof AREAS)[number] | null }>();
    const locateArea = vi
      .fn()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementation(async () => ({ area: AREAS[1]! }));
    const { describer } = setup({ locateArea });
    const onResult = vi.fn();
    const requester = createDescriptionRequester(describer, onResult);

    requester.request(points[0]!);
    await vi.advanceTimersByTimeAsync(DESCRIBE_DEBOUNCE_MS);
    requester.request(points[1]!);
    await vi.advanceTimersByTimeAsync(DESCRIBE_DEBOUNCE_MS);
    slow.resolve({ area: AREAS[0]! });
    await vi.advanceTimersByTimeAsync(0);

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]![0]).toEqual(points[1]);
    expect(onResult.mock.calls[0]![1].text).toContain('Barrio San José');
  });

  it('cancel y punto null no consultan', async () => {
    const { describer, api } = setup();
    const requester = createDescriptionRequester(describer, vi.fn());
    requester.request(points[0]!);
    requester.cancel();
    requester.request(null);
    await vi.advanceTimersByTimeAsync(DESCRIBE_DEBOUNCE_MS * 2);
    expect(api.locateArea).not.toHaveBeenCalled();
  });
});
