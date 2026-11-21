/**
 * Máximo de polígonos por petición a /api/admin/areas/details. Cada uno es una subpetición del
 * Worker a la API (GET /areas/:id) y Cloudflare limita las subpeticiones por invocación, así que
 * el navegador los pide por lotes.
 */
export const AREA_DETAILS_MAX_IDS = 25;
