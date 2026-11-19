import { OPERATION_TIME_ZONE } from '@panter/contracts';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: OPERATION_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Minutos desde la medianoche en la hora de Colombia (`OPERATION_TIME_ZONE`) para un instante.
 * No depende de la zona horaria del servidor: el Worker corre en UTC y las pruebas en cualquiera.
 */
export function colombiaMinuteOfDay(epochMs: number): number {
  let hour = 0;
  let minute = 0;
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type === 'hour') hour = Number(part.value);
    if (part.type === 'minute') minute = Number(part.value);
  }
  return hour * 60 + minute;
}

/**
 * true si el minuto cae en el horario nocturno [inicio, fin). Si inicio > fin, el horario cruza
 * la medianoche (20:00–05:00: las 20:00 ya son noche y las 05:00 ya son día). Si inicio = fin
 * no hay horario nocturno.
 */
export function isNightMinute(minute: number, startMinute: number, endMinute: number): boolean {
  if (startMinute === endMinute) return false;
  if (startMinute < endMinute) return minute >= startMinute && minute < endMinute;
  return minute >= startMinute || minute < endMinute;
}
