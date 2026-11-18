import { PRIVACY_POLICY_VERSION } from './consent';

/**
 * Aviso de privacidad (Ley 1581 de 2012 y Decreto 1377 de 2013). Lo muestran la app y la web
 * con el mismo texto. BORRADOR para la etapa de pruebas: requiere revisión legal antes del
 * lanzamiento público (especificación §12). Si cambia el contenido, sube
 * PRIVACY_POLICY_VERSION para que todos acepten de nuevo.
 */
export interface PrivacyPolicySection {
  title: string;
  paragraphs: string[];
}

export const PRIVACY_POLICY = {
  version: PRIVACY_POLICY_VERSION,
  effectiveFrom: '2026-11-18',
  title: 'Aviso de privacidad y autorización de tratamiento de datos personales',
  draft: true,
  sections: [
    {
      title: 'Responsable del tratamiento',
      paragraphs: [
        'PANTER, plataforma de movilidad y ecoturismo de Villagarzón (Putumayo, Colombia), es responsable del tratamiento de los datos personales que recoge a través de su app y su sitio web.',
        'Canal de contacto para consultas y reclamos sobre tus datos: el correo de soporte que PANTER publique en la app y en la web.',
      ],
    },
    {
      title: 'Datos que recogemos',
      paragraphs: [
        'Datos de identificación y contacto: correo electrónico, nombre y teléfono.',
        'Datos de ubicación: tu posición GPS mientras pides o haces un viaje, y la de los conductores mientras están disponibles o en viaje.',
        'Datos de los viajes: origen, destino, ruta, horarios, valor pagado y calificaciones.',
        'Si te registras como conductor: cédula, licencia de conducción, tarjeta de propiedad, SOAT, revisión tecnomecánica y datos del vehículo.',
      ],
    },
    {
      title: 'Para qué los usamos',
      paragraphs: [
        'Crear y proteger tu cuenta, y enviarte el código de acceso.',
        'Asignar viajes, mostrar la ubicación del vehículo, calcular tarifas y registrar pagos y comisiones.',
        'Atender emergencias (botón SOS) y compartir el seguimiento del viaje con quien tú elijas.',
        'Verificar los documentos de los conductores y la seguridad del servicio.',
        'Mejorar el servicio con estadísticas que no te identifican.',
      ],
    },
    {
      title: 'Datos sensibles',
      paragraphs: [
        'Tu ubicación en tiempo real y los documentos de identidad pueden considerarse datos sensibles. No estás obligado a autorizar su tratamiento, pero sin ellos no es posible prestar el servicio de transporte.',
      ],
    },
    {
      title: 'Con quién los compartimos',
      paragraphs: [
        'Con el conductor o el pasajero de tu viaje, solo lo necesario para el servicio (nombre, ubicación y datos del vehículo).',
        'Con proveedores tecnológicos que alojan y procesan la información por encargo de PANTER (servidores, base de datos, correo y mapas), algunos ubicados fuera de Colombia, con medidas de seguridad adecuadas.',
        'Con autoridades, cuando la ley lo exija.',
      ],
    },
    {
      title: 'Tus derechos',
      paragraphs: [
        'Conocer, actualizar y rectificar tus datos; pedir prueba de esta autorización; ser informado sobre su uso; revocar la autorización o pedir que se eliminen cuando no exista un deber legal de conservarlos; y presentar quejas ante la Superintendencia de Industria y Comercio.',
        'Las consultas se responden en máximo 10 días hábiles y los reclamos en máximo 15 días hábiles.',
      ],
    },
    {
      title: 'Conservación y seguridad',
      paragraphs: [
        'Conservamos tus datos mientras tengas una cuenta activa y durante el tiempo que exijan las normas aplicables. Los documentos de los conductores se guardan en almacenamiento privado y solo los ve el personal autorizado.',
      ],
    },
    {
      title: 'Autorización',
      paragraphs: [
        'Al tocar "Acepto" autorizas de manera previa, expresa e informada el tratamiento de tus datos personales para las finalidades descritas. Guardamos la fecha y la versión de este aviso que aceptaste.',
      ],
    },
  ] satisfies PrivacyPolicySection[],
} as const;
