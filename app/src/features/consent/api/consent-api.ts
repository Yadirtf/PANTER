// Consentimiento de tratamiento de datos (HU-109): POST /me/consent.
import {
  type AcceptConsentBody,
  ConsentRoutes,
  type ConsentStatus,
  ConsentStatusSchema,
} from '@panter/contracts';
import type { HttpClient } from '../../../shared/api/http-client';

export interface ConsentApi {
  /** Registra la aceptación. 409 CONSENT_VERSION_OUTDATED si `version` ya no es la vigente. */
  accept(body: AcceptConsentBody): Promise<ConsentStatus>;
}

export function createConsentApi(http: HttpClient): ConsentApi {
  return {
    accept: (body) =>
      http.request({
        path: ConsentRoutes.ME_CONSENT,
        body,
        auth: true,
        schema: ConsentStatusSchema,
      }),
  };
}
