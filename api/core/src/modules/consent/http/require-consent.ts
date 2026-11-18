import type { MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { getActor } from '../../auth/http/require-auth';
import { ConsentErrors, type GetConsentStatus } from '../application/consent';

/**
 * Middleware `requireConsent()` (HU-109): exige que el usuario haya aceptado la versión vigente
 * del aviso de privacidad. Va después de `requireAuth()`:
 *
 *   router.use('/trips/*', requireAuth(), requireConsent());
 *
 * Si falta aceptar → 403 `CONSENT_REQUIRED` con `details.currentVersion`; el cliente muestra el
 * aviso, llama a POST /me/consent y reintenta.
 *
 * **Todavía no se aplica a ninguna ruta.** En M1 solo existen el login, /me y la
 * administración, que deben funcionar sin consentimiento (la app los usa para mostrar el aviso
 * y registrar la aceptación). Se activará en los endpoints de negocio (viajes, conductores)
 * cuando existan. Cuesta una consulta a la base de datos por petición.
 */
export function makeRequireConsent(
  buildStatus: (env: Env) => GetConsentStatus,
): () => MiddlewareHandler<AppBindings> {
  return () => async (c, next) => {
    const status = await buildStatus(c.env)(getActor(c).userId);
    if (status.required) throw ConsentErrors.required(status.currentVersion);
    await next();
  };
}
