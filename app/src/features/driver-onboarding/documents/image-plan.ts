// Compresión de las fotos de documentos antes de subirlas (HU-203). Una foto de 12 MP pesa 3-6 MB;
// redimensionada a 1600 px de lado mayor y en JPEG 0,8 queda en ~250-500 KB, muy por debajo de
// DOCUMENT_MAX_BYTES (8 MB) y razonable con los datos móviles de Putumayo. A 1600 px un documento
// sigue siendo legible para la revisión.

export const DOCUMENT_MAX_SIDE_PX = 1600;
export const DOCUMENT_JPEG_QUALITY = 0.8;

/**
 * Redimensión a aplicar (solo un lado, para conservar la proporción) o `null` si la foto ya es
 * pequeña. Nunca se agranda.
 */
export function resizeFor(
  width: number,
  height: number,
  maxSide: number = DOCUMENT_MAX_SIDE_PX,
): { width: number } | { height: number } | null {
  if (width <= 0 || height <= 0) return null;
  if (Math.max(width, height) <= maxSide) return null;
  return width >= height ? { width: maxSide } : { height: maxSide };
}
