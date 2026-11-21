import type { RootGroup } from './root-group';

/**
 * Pantalla principal de cada grupo de rutas. El layout raíz la usa como `redirectTo` de cada
 * `Stack.Protected`: sin ella, Expo Router redirige al "anchor" del navegador raíz, que es `/`
 * (el login de `(auth)`). Al iniciar sesión `(auth)` queda protegido y la app terminaba en
 * "Unmatched Route" con la URL `panter:///`.
 *
 * Cada ruta debe existir como archivo dentro de su grupo (lo verifica group-home.test.ts).
 */
export const GROUP_HOME = {
  '(auth)': '/',
  '(consent)': '/consent',
  '(web-only)': '/use-web',
  '(onboarding)': '/onboarding',
  '(passenger)': '/passenger',
  '(driver)': '/driver',
} as const satisfies Record<RootGroup, string>;

export type GroupHome = (typeof GROUP_HOME)[RootGroup];

export function groupHome(group: RootGroup): GroupHome {
  return GROUP_HOME[group];
}
