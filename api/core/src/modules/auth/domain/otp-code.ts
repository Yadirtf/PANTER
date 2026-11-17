import { OTP_LENGTH } from '@panter/contracts';

/** Fuente de aleatoriedad criptográfica (por defecto `crypto.getRandomValues`). */
export type RandomValues = (array: Uint32Array) => Uint32Array;

const defaultRandom: RandomValues = (array) => crypto.getRandomValues(array);

/**
 * Código numérico de `OTP_LENGTH` dígitos (con ceros a la izquierda) con distribución uniforme.
 * Usa muestreo por rechazo: se descartan los valores de 32 bits por encima del mayor múltiplo
 * de 10^6, para que ningún código sea más probable que otro (sin sesgo de módulo).
 */
export function generateOtpCode(random: RandomValues = defaultRandom): string {
  const space = 10 ** OTP_LENGTH;
  const limit = Math.floor(0x1_0000_0000 / space) * space;
  const buffer = new Uint32Array(1);
  for (;;) {
    const value = random(buffer)[0] ?? 0;
    if (value < limit) return String(value % space).padStart(OTP_LENGTH, '0');
  }
}

/**
 * Compara dos cadenas en tiempo constante respecto de su contenido (recorre siempre toda la
 * longitud mayor). Se usa con hashes hexadecimales de longitud fija.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
