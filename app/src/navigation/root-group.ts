// Grupo de rutas al que el layout raíz deja entrar.
// Por ahora no hay sesión, así que siempre es (auth). HU-106 implementará la regla real
// (sección 5 de la especificación): sin sesión → (auth); modo conductor sin aprobar →
// (onboarding); modo conductor aprobado → (driver); en otro caso → (passenger).

export const ROOT_GROUPS = ['(auth)', '(onboarding)', '(passenger)', '(driver)'] as const;
export type RootGroup = (typeof ROOT_GROUPS)[number];

export function resolveRootGroup(): RootGroup {
  return '(auth)';
}
