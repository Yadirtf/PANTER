import { httpClient } from '../auth/session/instance';
import { createConsentApi } from './api/consent-api';

export const consentApi = createConsentApi(httpClient);
