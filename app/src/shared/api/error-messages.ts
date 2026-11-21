// Mensajes en español para cada código de error. El `Record` obliga a cubrir todos los códigos
// de @panter/contracts: si el contrato agrega uno, TypeScript exige su mensaje aquí.
import { OTP_MAX_VERIFY_ATTEMPTS, OTP_TTL_SECONDS, OTP_WINDOW_SECONDS } from '@panter/contracts';
import { type AppErrorCode, isKnownErrorCode } from './errors';

const OTP_TTL_MINUTES = OTP_TTL_SECONDS / 60;
const OTP_WINDOW_MINUTES = OTP_WINDOW_SECONDS / 60;

export const ERROR_MESSAGES: Record<AppErrorCode, string> = {
  // Cliente
  NETWORK_ERROR: 'No hay conexión a internet. Revisa tus datos o el wifi e intenta de nuevo.',
  INVALID_RESPONSE: 'Recibimos una respuesta inesperada del servidor. Intenta de nuevo más tarde.',
  CONSENT_DECLINED:
    'Sin tu autorización para el tratamiento de tus datos personales no es posible usar PANTER. Si cambias de opinión, ingresa de nuevo y acepta el aviso de privacidad.',
  CONSENT_APP_OUTDATED:
    'El aviso de privacidad cambió y esta versión de la app no lo tiene. Descarga la última versión de PANTER para leerlo y aceptarlo.',
  // Genéricos
  NOT_FOUND: 'No encontramos lo que buscas.',
  VALIDATION_ERROR: 'Revisa los datos: hay un campo vacío o con un formato incorrecto.',
  BAD_REQUEST: 'No pudimos procesar la solicitud. Revisa los datos e intenta de nuevo.',
  INTERNAL_ERROR: 'Algo salió mal en el servidor. Intenta de nuevo en unos minutos.',
  // OTP
  OTP_RATE_LIMITED: `Pediste demasiados códigos. Espera unos ${OTP_WINDOW_MINUTES} minutos e intenta de nuevo.`,
  OTP_INVALID: 'El código no es correcto. Revísalo en tu correo y escríbelo de nuevo.',
  OTP_EXPIRED: `El código venció (dura ${OTP_TTL_MINUTES} minutos). Pide uno nuevo.`,
  OTP_TOO_MANY_ATTEMPTS: `Fallaste el código ${OTP_MAX_VERIFY_ATTEMPTS} veces. Pide un código nuevo.`,
  // Sesión
  UNAUTHENTICATED: 'Tu sesión terminó. Ingresa de nuevo con tu correo.',
  TOKEN_EXPIRED: 'Tu sesión venció. Ingresa de nuevo con tu correo.',
  REFRESH_TOKEN_INVALID: 'Tu sesión venció. Ingresa de nuevo con tu correo.',
  // Autorización
  FORBIDDEN: 'No tienes permiso para hacer esto.',
  MODE_NOT_ALLOWED:
    'Para usar el modo conductor debes ser un conductor aprobado. Completa tu registro de conductor.',
  MODE_CHANGE_ACTIVE_TRIP:
    'Tienes un viaje en curso. Termínalo o cancélalo antes de cambiar de modo.',
  ACCOUNT_SUSPENDED: 'Tu cuenta está suspendida. Comunícate con PANTER para más información.',
  // Correo
  EMAIL_DELIVERY_FAILED:
    'No pudimos enviarte el código por correo. Intenta de nuevo en unos minutos.',
  // Roles de personal (solo web; se incluyen para cubrir el contrato)
  ROLE_NOT_GRANTABLE: 'Ese rol no se puede asignar desde aquí.',
  CANNOT_REVOKE_OWN_ADMIN: 'No puedes quitarte tu propio rol de administrador.',
  // Consentimiento
  CONSENT_REQUIRED: 'Debes aceptar el aviso de privacidad para continuar.',
  CONSENT_VERSION_OUTDATED: 'El aviso de privacidad cambió. Léelo y acéptalo de nuevo.',
  // Onboarding de conductores
  DRIVER_ALREADY_APPLIED: 'Ya enviaste tu solicitud de conductor. Revisa su estado.',
  DRIVER_NOT_APPLIED: 'Primero registra tu vehículo para solicitar ser conductor.',
  PLATE_ALREADY_REGISTERED: 'Esa placa ya está registrada por otro conductor.',
  DOCUMENT_TOO_LARGE: 'La foto es muy pesada. Tómala de nuevo con menos resolución.',
  DOCUMENT_TYPE_NOT_ALLOWED: 'Solo se aceptan fotos JPG, PNG o WEBP.',
  UPLOAD_URL_INVALID: 'El enlace de carga venció. Intenta subir la foto de nuevo.',
  DOCUMENTS_INCOMPLETE: 'Faltan documentos por subir o aprobar.',
  INVALID_DRIVER_TRANSITION: 'Esa acción no es posible en el estado actual de tu solicitud.',
  // Mapas, rutas y tarifas
  OUT_OF_SERVICE_AREA: 'Ese lugar está fuera de la zona de servicio de PANTER.',
  ROUTE_NOT_FOUND: 'No encontramos una ruta entre esos dos puntos.',
  ROUTING_UNAVAILABLE: 'No pudimos calcular la ruta en este momento. Intenta de nuevo.',
  FARE_RULE_NOT_FOUND: 'Ese tipo de vehículo no tiene tarifa configurada.',
  // Catálogo geográfico
  AREA_NAME_TAKEN: 'Ya existe un barrio o vereda con ese nombre.',
  PLACE_SLUG_TAKEN: 'Ya existe un lugar con ese identificador.',
  INVALID_POLYGON:
    'El polígono no es válido: revisa que no se cruce y esté en la zona de servicio.',
};

/** Mensaje para mostrar al usuario a partir de un error normalizado `{ code }`. */
export function errorMessage(error: { code: string }): string {
  return isKnownErrorCode(error.code) ? ERROR_MESSAGES[error.code] : ERROR_MESSAGES.INTERNAL_ERROR;
}
