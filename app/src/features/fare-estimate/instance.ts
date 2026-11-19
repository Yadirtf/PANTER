// Instancia única de la API de tarifas, sobre el cliente HTTP con sesión.
import { httpClient } from '../auth/session/instance';
import { createFaresApi } from './api/fares-api';

export const faresApi = createFaresApi(httpClient);
