// Cuándo cambia el tema del mapa: a las 20:00 (oscuro) y a las 05:00 (claro), hora de Colombia,
// sin importar la zona horaria configurada en el teléfono.
import {
  colombiaMinuteOfDay,
  DARK_FROM_MINUTE,
  DARK_UNTIL_MINUTE,
  type MapTheme,
  themeFor,
} from '@panter/map-style';

const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 24 * 60;

/** Milisegundos que faltan para el próximo cambio de tema (siempre > 0). */
export function msUntilNextThemeChange(now: Date): number {
  const minute = colombiaMinuteOfDay(now);
  const msIntoMinute = ((now.getTime() % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
  const minutesTo = (boundary: number) =>
    (boundary - minute + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
  const minutes = Math.min(minutesTo(DARK_FROM_MINUTE), minutesTo(DARK_UNTIL_MINUTE));
  return minutes * MINUTE_MS - msIntoMinute;
}

export interface ThemeSchedule {
  theme: MapTheme;
  /** Cuándo volver a evaluar el tema. */
  nextChangeInMs: number;
}

/** Tema actual y cuánto esperar para reevaluarlo (lo usa el temporizador de `useMapTheme`). */
export function themeSchedule(now: Date): ThemeSchedule {
  return { theme: themeFor(now), nextChangeInMs: msUntilNextThemeChange(now) };
}
