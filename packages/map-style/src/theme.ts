import { OPERATION_UTC_OFFSET_MINUTES } from '@panter/contracts';
import type { MapTheme } from './palette';

/**
 * Horario del tema oscuro, en minutos desde la medianoche en hora de Colombia. Es el mismo del
 * recargo nocturno por defecto de las tarifas (fare_rules.night_start_minute = 1200 → 8:00 p. m.,
 * night_end_minute = 300 → 5:00 a. m.).
 */
export const DARK_FROM_MINUTE = 20 * 60;
export const DARK_UNTIL_MINUTE = 5 * 60;

const MINUTES_PER_DAY = 24 * 60;

/** Minuto del día (0–1439) en hora de Colombia (UTC−5 todo el año, sin horario de verano). */
export function colombiaMinuteOfDay(date: Date): number {
  const utcMinutes = Math.floor(date.getTime() / 60_000);
  const local = utcMinutes + OPERATION_UTC_OFFSET_MINUTES;
  return ((local % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export interface NightWindow {
  /** Inicio (incluido). */
  startMinute: number;
  /** Fin (excluido). Si es menor que el inicio, el horario cruza la medianoche. */
  endMinute: number;
}

/**
 * Tema del mapa para un instante: 'dark' desde las 8:00 p. m. (incluida) hasta antes de las
 * 5:00 a. m. en hora de Colombia, sin importar la zona horaria del teléfono o del navegador.
 * Si la tarifa vigente usa otro horario nocturno, pásalo en `night` para que coincidan.
 */
export function themeFor(
  date: Date,
  night: NightWindow = { startMinute: DARK_FROM_MINUTE, endMinute: DARK_UNTIL_MINUTE },
): MapTheme {
  const minute = colombiaMinuteOfDay(date);
  const { startMinute, endMinute } = night;
  const isNight =
    startMinute <= endMinute
      ? minute >= startMinute && minute < endMinute
      : minute >= startMinute || minute < endMinute;
  return isNight ? 'dark' : 'light';
}
