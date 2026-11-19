import type { DocumentContentType } from './driver-profile';

/**
 * Tipo real de la imagen según sus primeros bytes (magic bytes), sin confiar en el
 * Content-Type que declara el cliente (HU-202):
 * - JPEG: FF D8 FF
 * - PNG:  89 50 4E 47 0D 0A 1A 0A
 * - WEBP: "RIFF" <4 bytes de tamaño> "WEBP"
 */
export function detectImageType(bytes: Uint8Array): DocumentContentType | null {
  const at = (i: number, ...values: number[]) => values.every((v, j) => bytes[i + j] === v);
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png';
  }
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return 'image/webp';
  }
  return null;
}
