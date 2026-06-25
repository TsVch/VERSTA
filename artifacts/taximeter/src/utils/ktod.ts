import { KtodCoefficients } from '../types';

/**
 * Determine Ktod coefficient automatically based on current date/time.
 * Weekends = Saturday (6) and Sunday (0).
 * 
 * Rules:
 * - Weekday day   (Mon-Fri, 06:00–22:00) → 1.0
 * - Weekday night (Mon-Fri, 22:00–06:00) → 1.5
 * - Weekend day   (Sat-Sun, 09:00–22:00) → 1.5
 * - Weekend night (Sat-Sun, 22:00–09:00) → 2.0
 */
export function computeKtod(now: Date, coefs: KtodCoefficients): number {
  const day = now.getDay(); // 0=Sun, 6=Sat
  const hour = now.getHours();
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) {
    const isDayTime = hour >= 9 && hour < 22;
    return isDayTime ? coefs.weekendDay : coefs.weekendNight;
  } else {
    const isDayTime = hour >= 6 && hour < 22;
    return isDayTime ? coefs.weekdayDay : coefs.weekdayNight;
  }
}

export function getKtodLabel(now: Date): string {
  const day = now.getDay();
  const hour = now.getHours();
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) {
    return hour >= 9 && hour < 22 ? 'Выходные (день)' : 'Выходные (ночь)';
  } else {
    return hour >= 6 && hour < 22 ? 'Будни (день)' : 'Будни (ночь)';
  }
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Calculate fare:  P = S + D_real(km) * rd + T_real(min) * rt * Ktod
 */
export function calculatePrice(
  S: number,
  rd: number,
  rt: number,
  distanceMeters: number,
  elapsedSeconds: number,
  ktod: number
): number {
  const distKm = distanceMeters / 1000;
  const timeMin = elapsedSeconds / 60;
  return S + distKm * rd + timeMin * rt * ktod;
}
