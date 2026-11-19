// Tema del mapa según la hora de Colombia, reevaluado justo al pasar las 20:00 y las 05:00 y al
// volver la app a primer plano (los temporizadores no corren con la app en segundo plano).
import type { MapTheme } from '@panter/map-style';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { themeSchedule } from '../theme/theme-clock';

/** Holgura para que el temporizador no dispare un instante antes del cambio. */
const SLACK_MS = 1_000;

export function useMapTheme(): MapTheme {
  const [theme, setTheme] = useState<MapTheme>(() => themeSchedule(new Date()).theme);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const evaluate = () => {
      const schedule = themeSchedule(new Date());
      setTheme(schedule.theme);
      clearTimeout(timer);
      timer = setTimeout(evaluate, schedule.nextChangeInMs + SLACK_MS);
    };
    evaluate();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') evaluate();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return theme;
}
