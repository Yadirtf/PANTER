// Par RSA de prueba generado al vuelo (nunca hay llaves en el repositorio).
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

export interface TestKeys {
  privateKeyPem: string;
  publicKeyPem: string;
}

let cached: Promise<TestKeys> | null = null;

export function testKeys(): Promise<TestKeys> {
  cached ??= (async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', {
      modulusLength: 2048,
      extractable: true,
    });
    return {
      privateKeyPem: await exportPKCS8(privateKey),
      publicKeyPem: await exportSPKI(publicKey),
    };
  })();
  return cached;
}

/** Otro par distinto (para probar firmas de una llave que no es la del servidor). */
export async function otherKeys(): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  return {
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
  };
}
