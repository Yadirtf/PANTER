import { themeFor, type MapTheme, type NightWindow } from '@panter/map-style';

/** 'auto' sigue la hora de Colombia (oscuro de 8:00 p. m. a 5:00 a. m.); o un tema fijo. */
export type MapThemePreference = 'auto' | MapTheme;

export function resolveMapTheme(
  preference: MapThemePreference,
  now: Date,
  night?: NightWindow,
): MapTheme {
  return preference === 'auto' ? themeFor(now, night) : preference;
}

/** Milisegundos hasta el siguiente minuto exacto: el tema solo puede cambiar al cambiar de minuto. */
export function msUntilNextMinute(now: Date): number {
  return 60_000 - (now.getTime() % 60_000);
}
