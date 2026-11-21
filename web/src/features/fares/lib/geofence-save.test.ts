import { GeofenceUpdateBodySchema as ContractSchema } from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/errors';
import { FaresBffRoutes, saveGeofence } from '../api/fares-client';
import { AIRPORT, AIRPORT_ID, PERIPHERAL } from '../server/fares-test-data';
import { geofenceBody, geofenceSaveBody, GeofenceUpdateBodySchema } from './fares';
import { fareErrorMessage, polygonRejectionMessage } from './messages';
import { insertMidpoint, moveVertex, toEditable } from '@/features/geo-editor/lib/polygon-edit';

const WEB = 'https://panter-web-staging.panter.workers.dev';

describe('cuerpo del PUT de una geocerca', () => {
  it('sin cambios en el mapa no envía polygon (la API conserva el actual)', () => {
    const fields = geofenceBody(AIRPORT);
    expect(geofenceSaveBody(fields, AIRPORT.polygon, null)).toEqual(fields);
    expect(
      geofenceSaveBody(fields, AIRPORT.polygon, toEditable(AIRPORT.polygon)),
    ).not.toHaveProperty('polygon');
  });

  it('con el polígono editado envía los anillos cerrados, huecos incluidos', () => {
    const fields = geofenceBody(PERIPHERAL);
    const edited = insertMidpoint(toEditable(PERIPHERAL.polygon), 0, 0).rings;
    const body = geofenceSaveBody(fields, PERIPHERAL.polygon, edited);
    expect(body.polygon).toHaveLength(2);
    expect(body.polygon![0]).toHaveLength(6); // 5 vértices + cierre
    expect(body.polygon![0]![0]).toEqual(body.polygon![0]!.at(-1));
    expect(body.polygon![1]).toEqual(PERIPHERAL.polygon[1]);
    // Cumple el contrato que valida el BFF y la API.
    expect(ContractSchema.safeParse(body).success).toBe(true);
    expect(GeofenceUpdateBodySchema.parse(body)).toEqual(body);
  });

  it('saveGeofence hace PUT al BFF del mismo origen con el polígono, sin token', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({})));
    const edited = moveVertex(
      toEditable(AIRPORT.polygon),
      { ring: 0, vertex: 2 },
      {
        lat: 0.99,
        lng: -76.597,
      },
    );
    const body = geofenceSaveBody(geofenceBody(AIRPORT), AIRPORT.polygon, edited);
    await saveGeofence(AIRPORT_ID, body, { baseUrl: WEB, fetch: fetchMock });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${WEB}${FaresBffRoutes.geofence(AIRPORT_ID)}`);
    expect(init?.method).toBe('PUT');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'Aeropuerto Cananguchal (VGZ)',
      surcharge: 5000,
      appliesTo: ['TAXI', 'MOTOTAXI'],
      active: true,
      polygon: [
        [
          { lat: 0.972, lng: -76.612 },
          { lat: 0.972, lng: -76.598 },
          { lat: 0.99, lng: -76.597 },
          { lat: 0.986, lng: -76.612 },
          { lat: 0.972, lng: -76.612 },
        ],
      ],
    });
  });
});

describe('rechazo del polígono por la API', () => {
  const apiMessage = 'Revisa el dibujo de la zona: el polígono no es válido.';

  it('muestra el mensaje de la API con el detalle (ST_IsValid)', () => {
    const error = new ApiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: apiMessage,
      details: [
        {
          path: 'polygon',
          code: 'invalid_geometry',
          message:
            'El polígono no es válido (Self-intersection[-76.6 0.98]). Revisa que los bordes no se crucen y que los huecos queden dentro de la zona.',
        },
      ],
    });
    expect(polygonRejectionMessage(error)).toBe(
      `${apiMessage} El polígono no es válido (Self-intersection[-76.6 0.98]). Revisa que los bordes no se crucen y que los huecos queden dentro de la zona.`,
    );
  });

  it('acepta el detalle del BFF ({ issues }) y une los mensajes sin repetir', () => {
    const error = {
      code: 'VALIDATION_ERROR',
      message: apiMessage,
      details: {
        issues: [
          { path: 'polygon.0', message: 'La zona debe quedar dentro del área de servicio.' },
          { path: 'polygon.0.3', message: 'La zona debe quedar dentro del área de servicio.' },
        ],
      },
    };
    expect(polygonRejectionMessage(error)).toBe(
      `${apiMessage} La zona debe quedar dentro del área de servicio.`,
    );
  });

  it('otros errores siguen con los mensajes de HU-403', () => {
    expect(
      polygonRejectionMessage({
        code: 'VALIDATION_ERROR',
        message: 'x',
        details: [{ path: 'surcharge', message: 'Monto inválido' }],
      }),
    ).toBeNull();
    expect(polygonRejectionMessage({ code: 'FORBIDDEN', message: 'x' })).toBeNull();
    expect(fareErrorMessage('FORBIDDEN')).toMatch(/No tienes permiso/);
  });
});
