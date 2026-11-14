import { useEffect, useState } from 'react';
import { secondsUntilResend } from './resend-timer';

/** Segundos restantes para reenviar desde `sentAt`; se actualiza cada segundo hasta llegar a 0. */
export function useResendCountdown(sentAt: number, waitSeconds: number): number {
  const [remaining, setRemaining] = useState(() =>
    secondsUntilResend(sentAt, waitSeconds, Date.now()),
  );

  useEffect(() => {
    const tick = () => setRemaining(secondsUntilResend(sentAt, waitSeconds, Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sentAt, waitSeconds]);

  return remaining;
}
