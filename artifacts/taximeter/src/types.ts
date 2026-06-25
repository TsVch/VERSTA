export type TariffType =
  | 'economy'
  | 'comfort'
  | 'comfort_plus'
  | 'business'
  | 'minivan_premium';

export interface TariffConfig {
  name: string;
  nameRu: string;
  S: number;   // базовая стоимость подачи, ₽
  rd: number;  // руб/км
  rt: number;  // руб/мин
}

export const TARIFFS: Record<TariffType, TariffConfig> = {
  economy:         { name: 'economy',         nameRu: 'Эконом',          S: 80,  rd: 30,  rt: 10 },
  comfort:         { name: 'comfort',         nameRu: 'Комфорт',         S: 120, rd: 40,  rt: 10 },
  comfort_plus:    { name: 'comfort_plus',    nameRu: 'Комфорт+',        S: 160, rd: 50,  rt: 15 },
  business:        { name: 'business',        nameRu: 'Бизнес',          S: 200, rd: 80,  rt: 15 },
  minivan_premium: { name: 'minivan_premium', nameRu: 'Минивэн Премиум', S: 300, rd: 100, rt: 20 },
};

/** Ordered list of tariff types for display */
export const TARIFF_ORDER: TariffType[] = [
  'economy', 'comfort', 'comfort_plus', 'business', 'minivan_premium',
];

export type KtodMode = 'auto' | 'manual';

export interface KtodCoefficients {
  weekdayDay: number;
  weekdayNight: number;
  weekendDay: number;
  weekendNight: number;
}

export const DEFAULT_KTOD: KtodCoefficients = {
  weekdayDay: 1.0,
  weekdayNight: 1.5,
  weekendDay: 1.5,
  weekendNight: 2.0,
};

export interface GpsPoint {
  lat: number;
  lon: number;
  accuracy: number;
  speed: number | null; // m/s from GPS chip (Doppler — more stable than position)
  timestamp: number;
  heading?: number | null;
  quality: GpsQuality;  // tier assigned by filter
}

/** GPS quality tier */
export type GpsQuality =
  | 'good'       // accuracy ≤ 50m  — use position + speed
  | 'degraded'   // accuracy 50–200m — use position cautiously + prefer speed DR
  | 'poor'       // accuracy 200–500m — skip position, speed DR only
  | 'dead_reck'  // no GPS update, dead reckoning from last speed
  | 'sim';       // simulator point

export interface LogEntry {
  ts: number;
  type: 'info' | 'warn' | 'gps' | 'error' | 'system' | 'dr';
  msg: string;
}

export type TripStatus = 'idle' | 'running' | 'paused' | 'finished';

// ── GPS Filter Thresholds ─────────────────────────────────────────────────────
/** Accept fully (position + speed) */
export const GPS_TIER_GOOD     = 50;   // meters
/** Accept position with caution; prefer Doppler speed */
export const GPS_TIER_DEGRADED = 200;  // meters
/** Reject position; use coords.speed only for dead reckoning */
export const GPS_TIER_POOR     = 500;  // meters
/** Impossible speed jump — discard point (m/s); ~200 km/h */
export const GPS_MAX_SPEED_MS  = 55;   // m/s
/** Minimum move to count as real movement */
export const GPS_MIN_DISTANCE  = 4;    // meters
/** Seconds without GPS before dead reckoning kicks in */
export const GPS_DR_GAP_S      = 4;    // seconds
/** Smoothing factor for position EMA (0=ignore new, 1=trust fully) */
export const GPS_SMOOTH_ALPHA  = 0.7;
