import { useState, useRef, useCallback, useEffect } from 'react';
import {
  TariffType, TARIFFS, TARIFF_ORDER, TariffConfig, GpsPoint, LogEntry,
  KtodCoefficients, KtodMode, DEFAULT_KTOD, TripStatus,
} from '../types';
import { computeKtod, getKtodLabel, formatTime, calculatePrice } from '../utils/ktod';
import { useGPS, GpsStatus } from '../hooks/useGPS';
import { useIMU } from '../hooks/useIMU';
import { useSimulator } from '../hooks/useSimulator';
import { PlannedRoute, getRoute } from '../utils/routing';
import { snapToRoute, positionOnRoute, remainingRouteDistance } from '../utils/routeSnap';
import KtodTable from '../components/KtodTable';
import EventLog from '../components/EventLog';
import TripMap from '../components/TripMap';
import RoutePanel from '../components/RoutePanel';

// ── Tariff field (outside component to prevent hook-order errors) ─────────────
const MANUAL_KTOD_KEYS: Array<keyof KtodCoefficients> = [
  'weekdayDay', 'weekdayNight', 'weekendDay', 'weekendNight'
];

type CustomTariffs = Record<TariffType, Pick<TariffConfig, 'S' | 'rd' | 'rt'>>;

// ── Tariff colors per tier ────────────────────────────────────────────────────
const TARIFF_COLORS: Record<TariffType, string> = {
  economy:         'hsl(120 100% 60%)',
  comfort:         'hsl(180 100% 60%)',
  comfort_plus:    'hsl(200 100% 65%)',
  business:        'hsl(270 100% 75%)',
  minivan_premium: 'hsl(35  100% 65%)',
};

// ── localStorage persistence ──────────────────────────────────────────────────
const STORAGE_KEY_TARIFFS  = 'txmtr_custom_tariffs_v1';
const STORAGE_KEY_SELECTED = 'txmtr_selected_tariff_v1';

function initCustomTariffs(): CustomTariffs {
  const defaults = Object.fromEntries(
    TARIFF_ORDER.map(t => [t, { S: TARIFFS[t].S, rd: TARIFFS[t].rd, rt: TARIFFS[t].rt }])
  ) as CustomTariffs;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TARIFFS);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    if (typeof parsed !== 'object' || !parsed) return defaults;
    const result = { ...defaults };
    for (const t of TARIFF_ORDER) {
      const v = parsed[t] as Partial<{ S: number; rd: number; rt: number }> | undefined;
      if (
        v &&
        typeof v.S  === 'number' && v.S  > 0 && v.S  < 10000 &&
        typeof v.rd === 'number' && v.rd > 0 && v.rd < 10000 &&
        typeof v.rt === 'number' && v.rt > 0 && v.rt < 10000
      ) {
        result[t] = { S: v.S, rd: v.rd, rt: v.rt };
      }
    }
    return result;
  } catch {
    return defaults;
  }
}

function initSelectedTariff(): TariffType {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED);
    if (raw && (TARIFF_ORDER as string[]).includes(raw)) return raw as TariffType;
  } catch { /* ignore */ }
  return 'economy';
}

interface TariffFieldProps {
  t: TariffType; field: 'S' | 'rd' | 'rt'; label: string; unit: string; color: string;
  value: number; defaultValue: number; disabled: boolean;
  onChange: (t: TariffType, field: 'S' | 'rd' | 'rt', raw: string) => void;
}
function TariffField({ t, field, label, unit, color, value, defaultValue, disabled, onChange }: TariffFieldProps) {
  const changed = value !== defaultValue;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span style={{ color: 'hsl(180 30% 38%)', fontSize: '0.6rem' }}>{label}</span>
      <div className="flex items-center gap-0.5">
        <input type="number" min="0" step={field === 'S' ? '5' : '1'} value={value}
          onChange={e => onChange(t, field, e.target.value)} disabled={disabled}
          style={{
            width: '48px', padding: '2px 4px', fontSize: '0.75rem', textAlign: 'center',
            background: changed ? 'hsl(55 80% 8%)' : 'hsl(222 47% 7%)',
            border: `1px solid ${changed ? 'hsl(55 100% 35%)' : 'hsl(195 100% 15%)'}`,
            color: changed ? 'hsl(55 100% 65%)' : color, borderRadius: '4px', outline: 'none',
          }} />
        <span style={{ fontSize: '0.6rem', color: 'hsl(180 30% 35%)' }}>{unit}</span>
      </div>
    </div>
  );
}


const GPS_STATUS_CFG: Record<GpsStatus, { label: string; color: string; bg: string }> = {
  waiting:   { label: 'Ожидание GPS',   color: 'hsl(55 100% 55%)',  bg: 'hsl(55 80% 8%)' },
  good:      { label: 'GPS хороший',    color: 'hsl(120 100% 50%)', bg: 'hsl(120 80% 7%)' },
  degraded:  { label: 'GPS слабый',     color: 'hsl(40 100% 55%)',  bg: 'hsl(40 80% 8%)' },
  poor:      { label: 'GPS очень слаб', color: 'hsl(0 100% 55%)',   bg: 'hsl(0 80% 8%)' },
  dead_reck: { label: '⚡ Счисление',   color: 'hsl(270 100% 72%)', bg: 'hsl(270 80% 9%)' },
  error:     { label: 'GPS ошибка',     color: 'hsl(0 100% 60%)',   bg: 'hsl(0 80% 8%)' },
};

// How far off-route before showing a warning (meters)
const OFF_ROUTE_WARN_M = 250;

interface TaximeterProps {
  user?: { id: number; username: string; displayName?: string | null };
  onLogout?: () => void;
}

export default function Taximeter({ user, onLogout }: TaximeterProps = {}) {
  // ── Core state ──────────────────────────────────────────────────────────
  const [tariff, setTariff]                 = useState<TariffType>(initSelectedTariff);
  const [customTariffs, setCustomTariffs]   = useState<CustomTariffs>(initCustomTariffs);
  const [tripStatus, setTripStatus]         = useState<TripStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(0);
  const [track, setTrack]                   = useState<GpsPoint[]>([]);
  const [currentPoint, setCurrentPoint]     = useState<GpsPoint | null>(null);
  const [logs, setLogs]                     = useState<LogEntry[]>([]);
  const [ktodCoefs, setKtodCoefs]           = useState<KtodCoefficients>(DEFAULT_KTOD);
  const [ktodMode, setKtodMode]             = useState<KtodMode>('auto');
  const [manualKtodIndex, setManualKtodIndex] = useState(0);
  const [simSpeed, setSimSpeed]             = useState(40);
  const [showMap, setShowMap]               = useState(true);
  const [gpsAccuracy, setGpsAccuracy]       = useState<number | null>(null);
  const [gpsStatus, setGpsStatus]           = useState<GpsStatus>('waiting');
  const [isSimMode, setIsSimMode]           = useState(false);
  const [drCount, setDrCount]               = useState(0);

  // ── Route state ──────────────────────────────────────────────────────────
  const [plannedRoute, setPlannedRoute]         = useState<PlannedRoute | null>(null);
  const [routeCursorDistM, setRouteCursorDistM] = useState(0);    // cursor along route
  const [routeCursorPos, setRouteCursorPos]     = useState<{ lat: number; lon: number } | null>(null);
  const [offRoute, setOffRoute]                 = useState(false);
  const [remainingM, setRemainingM]             = useState<number | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef       = useRef<number | null>(null);
  const distRef            = useRef(0);
  const routeCursorRef     = useRef(0);   // mirrors routeCursorDistM for use in callbacks
  const plannedRouteRef    = useRef<PlannedRoute | null>(null); // mirrors plannedRoute
  // BUG FIX #2: track last GPS timestamp for per-update rate-limiting
  const lastGpsTimestampRef = useRef<number>(0);
  // Wake Lock — keeps the screen on during active trips so the browser
  // does not throttle setInterval / GPS callbacks when the display sleeps.
  const wakeLockRef        = useRef<WakeLockSentinel | null>(null);

  // ── Arrival modal state ───────────────────────────────────────────────────
  const [showArrivalModal, setShowArrivalModal] = useState(false);
  const arrivalReminderRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Rerouting state ───────────────────────────────────────────────────────
  const [isRerouting, setIsRerouting] = useState(false);
  const isReroutingRef    = useRef(false);
  const offRouteRef       = useRef(false);      // mirrors offRoute for callbacks
  const offRouteStartRef  = useRef<number | null>(null); // when off-route started

  const gps       = useGPS();
  const imu       = useIMU();
  const simulator = useSimulator();

  // ── Persist tariff settings to localStorage ───────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_TARIFFS, JSON.stringify(customTariffs)); } catch { /* ignore */ }
  }, [customTariffs]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_SELECTED, tariff); } catch { /* ignore */ }
  }, [tariff]);

  // Keep refs in sync
  useEffect(() => { plannedRouteRef.current = plannedRoute; }, [plannedRoute]);
  useEffect(() => { routeCursorRef.current = routeCursorDistM; }, [routeCursorDistM]);

  // ── Tariff helpers ────────────────────────────────────────────────────────
  const ct = customTariffs[tariff];

  const updateTariffField = useCallback(
    (t: TariffType, field: 'S' | 'rd' | 'rt', raw: string) => {
      const val = parseFloat(raw);
      if (isNaN(val) || val < 0) return;
      setCustomTariffs(prev => ({ ...prev, [t]: { ...prev[t], [field]: val } }));
    }, []
  );

  const resetTariff = useCallback((t: TariffType) => {
    setCustomTariffs(prev => ({
      ...prev, [t]: { S: TARIFFS[t].S, rd: TARIFFS[t].rd, rt: TARIFFS[t].rt },
    }));
  }, []);

  // ── Ktod ──────────────────────────────────────────────────────────────────
  const activeKtod = useCallback((): number => {
    if (ktodMode === 'auto') return computeKtod(new Date(), ktodCoefs);
    return ktodCoefs[MANUAL_KTOD_KEYS[manualKtodIndex]];
  }, [ktodMode, manualKtodIndex, ktodCoefs]);

  const ktodLabel = getKtodLabel(new Date());
  const price = calculatePrice(ct.S, ct.rd, ct.rt, distanceMeters, elapsedSeconds, activeKtod());

  // ── Log ───────────────────────────────────────────────────────────────────
  const addLog = useCallback((type: LogEntry['type'], msg: string) => {
    setLogs(prev => [...prev.slice(-300), { ts: Date.now(), type, msg }]);
  }, []);

  // ── Route distance advancement helper ────────────────────────────────────
  /**
   * Advance distance using the route cursor when a planned route is active.
   * BUG FIX #2: maxAdvanceM rate-limits single-step forward jumps.
   * BUG FIX #3: windowed snap prevents cursor freezing when off-route.
   * Returns the delta (meters) to add to distRef.
   */
  const advanceRouteDistance = useCallback((
    lat: number, lon: number, rawDistDelta: number, isDeadReck: boolean,
    maxAdvanceM = Infinity
  ): number => {
    const route = plannedRouteRef.current;
    if (!route) return rawDistDelta; // no route: use raw GPS/DR distance

    let newCursorDist: number;
    let snap = null;

    if (isDeadReck) {
      // DR: advance cursor along route by the computed delta (already rate-limited by speed)
      newCursorDist = Math.min(
        routeCursorRef.current + rawDistDelta,
        route.totalDistanceM
      );
    } else {
      // GPS point: snap to route with windowed search + rate-limit
      snap = snapToRoute(lat, lon, route, routeCursorRef.current, maxAdvanceM);
      newCursorDist = snap.distFromStart;

      const isOffRoute = snap.deviationM > OFF_ROUTE_WARN_M;
      setOffRoute(isOffRoute);
      offRouteRef.current = isOffRoute;
      if (!isOffRoute) offRouteStartRef.current = null;
      else if (!offRouteStartRef.current) offRouteStartRef.current = Date.now();

      // BUG FIX #3: if snap gave 0 advance but we have speed > 0 and are off-route,
      // fall back to DR advancement so cursor doesn't freeze.
      if (newCursorDist <= routeCursorRef.current && rawDistDelta > 0 && isOffRoute) {
        newCursorDist = Math.min(
          routeCursorRef.current + rawDistDelta,
          route.totalDistanceM
        );
      }
    }

    const delta = Math.max(0, newCursorDist - routeCursorRef.current);
    routeCursorRef.current = newCursorDist;
    setRouteCursorDistM(newCursorDist);

    const pos = positionOnRoute(newCursorDist, route);
    setRouteCursorPos(pos);
    setRemainingM(remainingRouteDistance(newCursorDist, route));

    if (snap && delta > 0) {
      addLog('gps',
        `📍 Маршрут: +${delta.toFixed(0)}м | откл ${snap.deviationM.toFixed(0)}м | осталось ${((route.totalDistanceM - newCursorDist)/1000).toFixed(2)}км`
      );
    }

    return delta;
  }, [addLog]);

  // ── Reroute ───────────────────────────────────────────────────────────────
  // Triggers a new OSRM request from current position to original destination.
  // Called automatically when off-route > 45s with good GPS signal.
  const triggerReroute = useCallback(async (
    from: { lat: number; lon: number },
    to: { lat: number; lon: number },
    toName: string,
  ) => {
    if (isReroutingRef.current) return;
    isReroutingRef.current = true;
    setIsRerouting(true);
    addLog('system', '🔄 Перестраиваю маршрут от текущей позиции…');
    try {
      const newRoute = await getRoute(from, to);
      if (newRoute) {
        newRoute.fromName = 'Текущая позиция';
        newRoute.toName   = toName;
        newRoute.toCoords = to;
        setPlannedRoute(newRoute);
        plannedRouteRef.current = newRoute;
        routeCursorRef.current  = 0;
        setRouteCursorDistM(0);
        offRouteRef.current      = false;
        offRouteStartRef.current = null;
        setOffRoute(false);
        addLog('system', `✅ Маршрут перестроен: ${(newRoute.totalDistanceM / 1000).toFixed(1)} км`);
      } else {
        addLog('warn', '⚠ Не удалось перестроить маршрут — нет пути');
      }
    } catch {
      addLog('warn', '⚠ Ошибка перестройки маршрута (нет интернета?)');
    } finally {
      isReroutingRef.current = false;
      setIsRerouting(false);
    }
  }, [addLog]);

  // ── GPS point handler ─────────────────────────────────────────────────────
  const handleGpsPoint = useCallback((pt: GpsPoint, rawDistDelta: number) => {
    const isDR = pt.quality === 'dead_reck';

    if (!isDR) {
      setCurrentPoint(pt);
      // Only add to visual track if quality is good or degraded (not poor/sim)
      if (pt.quality === 'good' || pt.quality === 'degraded') {
        setTrack(prev => [...prev, pt]);
      }
    }

    if (pt.speed !== null && pt.speed !== undefined && pt.speed > 0) {
      setCurrentSpeedKmh(pt.speed * 3.6);
    }

    if (isDR) setDrCount(n => n + 1);

    // BUG FIX #2: rate-limit max advance per GPS update
    // Max reasonable advance = GPS_MAX_SPEED_MS × timeDelta × 1.5 (50% safety margin)
    let maxAdvanceM = Infinity;
    const nowMs = Date.now();
    if (!isDR && lastGpsTimestampRef.current > 0) {
      const timeDeltaS = (nowMs - lastGpsTimestampRef.current) / 1000;
      if (timeDeltaS > 0 && timeDeltaS < 300) { // sanity: ignore if > 5 min gap
        maxAdvanceM = 55 * timeDeltaS * 1.5; // GPS_MAX_SPEED_MS=55 m/s * 1.5
      }
    }
    if (!isDR) lastGpsTimestampRef.current = nowMs;

    // Also rate-limit the rawDistDelta itself (for non-route mode)
    const clampedRawDelta = maxAdvanceM < Infinity
      ? Math.min(rawDistDelta, maxAdvanceM)
      : rawDistDelta;

    if (clampedRawDelta > 0 || isDR) {
      const delta = advanceRouteDistance(
        pt.lat, pt.lon,
        isDR ? rawDistDelta : clampedRawDelta,
        isDR,
        maxAdvanceM
      );
      if (delta > 0) {
        distRef.current += delta;
        setDistanceMeters(distRef.current);
      }
    }

    // ── Auto-reroute check ────────────────────────────────────────────────
    // Triggers when: GPS good + off-route > 45s + route has a destination
    if (!isDR && !isReroutingRef.current && offRouteRef.current && offRouteStartRef.current) {
      const offSec = (Date.now() - offRouteStartRef.current) / 1000;
      const route  = plannedRouteRef.current;
      if (offSec > 45 && pt.quality === 'good' && route?.toCoords) {
        triggerReroute(
          { lat: pt.lat, lon: pt.lon },
          route.toCoords,
          route.toName,
        );
      }
    }
  }, [advanceRouteDistance, triggerReroute]);

  // ── Wake Lock helpers ──────────────────────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request(type: 'screen'): Promise<WakeLockSentinel> } }).wakeLock.request('screen');
      wakeLockRef.current.addEventListener('release', () => {
        // Automatically re-acquire if the page becomes visible again while running
        // (lock is released by the OS when screen turns off, then we grab it back)
        wakeLockRef.current = null;
      });
    } catch { /* device doesn't support or user denied — non-fatal */ }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {/* ignore */});
    wakeLockRef.current = null;
  }, []);

  // Re-acquire wake lock when user returns to the tab while trip is running
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && tripStatus === 'running' && !wakeLockRef.current) {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [tripStatus, acquireWakeLock]);

  // ── Start ─────────────────────────────────────────────────────────────────
  const startTrip = useCallback(() => {
    if (tripStatus === 'running') return;
    const activeCt = customTariffs[tariff];
    setTripStatus('running');
    setDrCount(0);
    distRef.current = distanceMeters;
    startTimeRef.current = Date.now() - elapsedSeconds * 1000;
    acquireWakeLock();

    const routeMode = !!plannedRouteRef.current;
    addLog('system', `▶ Поездка начата | ${TARIFFS[tariff].nameRu} | S=${activeCt.S} rd=${activeCt.rd} rt=${activeCt.rt} | Ktod=${activeKtod().toFixed(1)}${routeMode ? ' | Режим: Маршрут' : ''}`);

    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - (startTimeRef.current ?? Date.now())) / 1000));
    }, 500);

    if (isSimMode) {
      addLog('system', `🎮 Симуляция GPS @ ${simSpeed} км/ч`);
      setGpsStatus('good');
      simulator.start({
        onPoint: handleGpsPoint,
        onFinish: () => { addLog('system', 'Симуляция завершена'); stopTrip(); },
      }, simSpeed);
    } else {
      addLog('system', 'Ожидание GPS...');
      setGpsStatus('waiting');
      // Request IMU permission (iOS user-gesture requirement) then start IMU
      imu.requestPermission().then(() => imu.start()).catch(() => imu.start());
      gps.start({
        onPoint: handleGpsPoint,
        onStatusChange: (status, acc) => {
          setGpsStatus(status);
          if (acc !== null) setGpsAccuracy(acc);
        },
        onLog: (type, msg) => addLog(type, msg),
        getIMU: imu.getSnapshot,
      });
    }
  }, [tripStatus, tariff, customTariffs, activeKtod, isSimMode, simSpeed,
      distanceMeters, elapsedSeconds, addLog, acquireWakeLock, handleGpsPoint, gps, imu, simulator]);

  // ── Stop ──────────────────────────────────────────────────────────────────
  const stopTrip = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (arrivalReminderRef.current) { clearTimeout(arrivalReminderRef.current); arrivalReminderRef.current = null; }
    releaseWakeLock();
    gps.stop();
    imu.stop();
    simulator.stop();
    // Reset rerouting / off-route tracking
    offRouteRef.current      = false;
    offRouteStartRef.current = null;
    isReroutingRef.current   = false;
    setIsRerouting(false);
    setShowArrivalModal(false);
    setTripStatus('finished');
    setGpsStatus('waiting');
    const activeCt = customTariffs[tariff];
    const finalPrice = calculatePrice(activeCt.S, activeCt.rd, activeCt.rt, distRef.current, elapsedSeconds, activeKtod());
    addLog('system', `■ Поездка завершена | ${(distRef.current / 1000).toFixed(2)} км | ${formatTime(elapsedSeconds)} | ${finalPrice.toFixed(0)} ₽`);
  }, [tariff, customTariffs, elapsedSeconds, activeKtod, addLog, releaseWakeLock, gps, imu, simulator]);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const resetTrip = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (arrivalReminderRef.current) { clearTimeout(arrivalReminderRef.current); arrivalReminderRef.current = null; }
    gps.stop();
    imu.stop();
    simulator.stop();
    setShowArrivalModal(false);
    setTripStatus('idle');
    setElapsedSeconds(0);
    setDistanceMeters(0);
    distRef.current = 0;
    setCurrentSpeedKmh(0);
    setTrack([]);
    setCurrentPoint(null);
    setGpsAccuracy(null);
    setGpsStatus('waiting');
    setDrCount(0);
    routeCursorRef.current = 0;
    setRouteCursorDistM(0);
    setRouteCursorPos(null);
    setOffRoute(false);
    offRouteRef.current      = false;
    offRouteStartRef.current = null;
    isReroutingRef.current   = false;
    setIsRerouting(false);
    setRemainingM(plannedRoute ? plannedRoute.totalDistanceM : null);
    addLog('system', '↺ Сброс — готов к новой поездке');
  }, [addLog, releaseWakeLock, gps, imu, simulator, plannedRoute]);

  // ── Route callbacks ───────────────────────────────────────────────────────
  const handleRouteReady = useCallback((route: PlannedRoute) => {
    setPlannedRoute(route);
    plannedRouteRef.current = route;
    routeCursorRef.current = 0;
    setRouteCursorDistM(0);
    setRouteCursorPos(route.coords[0] ? { lat: route.coords[0][0], lon: route.coords[0][1] } : null);
    setRemainingM(route.totalDistanceM);
    setOffRoute(false);
    addLog('system', `🗺 Маршрут: ${(route.totalDistanceM / 1000).toFixed(2)} км по дорогам | ${Math.round(route.totalDurationS / 60)} мин`);
  }, [addLog]);

  const handleRouteClear = useCallback(() => {
    setPlannedRoute(null);
    plannedRouteRef.current = null;
    setRouteCursorPos(null);
    setRemainingM(null);
    setOffRoute(false);
    addLog('system', '🗺 Маршрут сброшен — GPS-режим');
  }, [addLog]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (arrivalReminderRef.current) clearTimeout(arrivalReminderRef.current);
    gps.stop();
    imu.stop();
    simulator.stop();
  }, []);

  useEffect(() => {
    if (tripStatus === 'finished' && track.length > 0) {
      try {
        localStorage.setItem('taximeter_last_trip', JSON.stringify({
          date: new Date().toISOString(), tariff, distanceMeters, elapsedSeconds,
          price, ktod: activeKtod(), trackLength: track.length, customTariff: ct,
          routeDistanceM: plannedRoute?.totalDistanceM,
        }));
      } catch (_) {}
    }
  }, [tripStatus]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const isRunning  = tripStatus === 'running';
  const isFinished = tripStatus === 'finished';
  const speedColor = currentSpeedKmh > 100 ? 'neon-red' : currentSpeedKmh > 60 ? 'neon-yellow' : currentSpeedKmh > 0 ? 'neon-green' : '';
  const statusCfg  = GPS_STATUS_CFG[gpsStatus];
  const routeProgress = plannedRoute && routeCursorDistM > 0
    ? Math.min(100, (routeCursorDistM / plannedRoute.totalDistanceM) * 100)
    : 0;

  // ── Arrival detection (MUST be after routeProgress is declared) ───────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isRunning && plannedRoute && routeProgress >= 98 && !showArrivalModal) {
      setShowArrivalModal(true);
      addLog('system', '🏁 Достигнута конечная точка маршрута');
    }
  }, [routeProgress]);

  // ── Arrival modal helpers ─────────────────────────────────────────────────
  const dismissArrivalModal = (remindLater: boolean) => {
    setShowArrivalModal(false);
    if (remindLater) {
      if (arrivalReminderRef.current) clearTimeout(arrivalReminderRef.current);
      arrivalReminderRef.current = setTimeout(() => setShowArrivalModal(true), 5 * 60 * 1000);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen p-3 md:p-6 max-w-5xl mx-auto space-y-4">

      {/* ── Arrival modal ── */}
      {showArrivalModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'hsl(222 47% 5% / 0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px',
        }}>
          <div style={{
            background: 'hsl(222 47% 10%)',
            border: '2px solid hsl(120 100% 35%)',
            borderRadius: '16px',
            padding: '28px 24px',
            maxWidth: '360px', width: '100%',
            boxShadow: '0 0 40px hsl(120 100% 35% / 0.3)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🏁</div>
            <h2 style={{ color: 'hsl(120 100% 55%)', fontWeight: 900, fontSize: '1.1rem', marginBottom: '8px' }}>
              Вы доехали до конечной точки
            </h2>
            <p style={{ color: 'hsl(180 30% 55%)', fontSize: '0.85rem', marginBottom: '24px' }}>
              Завершить поездку и зафиксировать итоговую сумму?
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => { stopTrip(); }}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px', fontWeight: 900,
                  fontSize: '0.95rem', cursor: 'pointer',
                  background: 'hsl(120 80% 12%)',
                  border: '2px solid hsl(120 100% 40%)',
                  color: 'hsl(120 100% 60%)',
                  boxShadow: '0 0 16px hsl(120 100% 40% / 0.3)',
                }}
              >
                ✓ Да, завершить
              </button>
              <button
                onClick={() => dismissArrivalModal(true)}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px', fontWeight: 700,
                  fontSize: '0.9rem', cursor: 'pointer',
                  background: 'hsl(222 47% 14%)',
                  border: '1px solid hsl(195 100% 20%)',
                  color: 'hsl(180 30% 55%)',
                }}
              >
                Нет, продолжить
              </button>
            </div>
            <p style={{ color: 'hsl(180 30% 30%)', fontSize: '0.7rem', marginTop: '12px' }}>
              При «Нет» напомним через 5 минут
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <img src="/versta-logo.png" alt="VERSTA" className="h-10 w-10 object-contain" />
            <div>
              <h1 className="text-lg font-black tracking-wider leading-none" style={{ color: '#fff' }}>
                VERSTA <span style={{ color: 'hsl(120 80% 55%)' }}>taxometer</span>
              </h1>
              <p className="text-xs" style={{ color: 'hsl(180 30% 40%)' }}>Честные поездки</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(isRunning || gpsAccuracy !== null) && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold"
              style={{ background: statusCfg.bg, border: `1px solid ${statusCfg.color}30`, color: statusCfg.color }}>
              <span className={`w-2 h-2 rounded-full ${isRunning ? 'gps-dot-active' : ''}`}
                style={{ background: statusCfg.color, flexShrink: 0 }} />
              {statusCfg.label}
              {gpsAccuracy !== null && gpsAccuracy > 0 && (
                <span style={{ opacity: 0.75 }}>±{gpsAccuracy.toFixed(0)}м</span>
              )}
            </div>
          )}
          {plannedRoute && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold"
              style={{ background: 'hsl(200 80% 8%)', border: '1px solid hsl(200 100% 30%)', color: 'hsl(200 100% 65%)' }}>
              🗺 Маршрут
            </div>
          )}
          <a href="/manual.html" target="_blank" rel="noopener noreferrer"
            className="px-2 py-1 rounded text-xs font-semibold"
            style={{ background: 'hsl(240 40% 10%)', border: '1px solid hsl(240 30% 25%)', color: 'hsl(240 50% 75%)', textDecoration: 'none' }}
            title="Инструкция пользователя">
            📖
          </a>
          {user && onLogout && (
            <button onClick={onLogout}
              className="px-2 py-1 rounded text-xs font-semibold"
              style={{ background: 'hsl(0 40% 10%)', border: '1px solid hsl(0 30% 25%)', color: 'hsl(0 60% 65%)' }}
              title={`Выйти (${user.displayName ?? user.username})`}>
              ⏻
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full"
              style={{ background: isRunning ? 'hsl(120 100% 50%)' : isFinished ? 'hsl(55 100% 50%)' : 'hsl(0 100% 40%)' }} />
            <span className="text-xs" style={{ color: 'hsl(180 30% 50%)' }}>
              {isRunning ? 'В ПОЕЗДКЕ' : isFinished ? 'ЗАВЕРШЕНО' : 'ГОТОВ'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Route planner ── */}
      <RoutePanel
        onRouteReady={handleRouteReady}
        onRouteClear={handleRouteClear}
        isRunning={isRunning}
        currentRoute={plannedRoute}
        estimatedPrice={plannedRoute
          ? calculatePrice(ct.S, ct.rd, ct.rt, plannedRoute.totalDistanceM, plannedRoute.totalDurationS, activeKtod())
          : undefined}
      />

      {/* ── Rerouting indicator ── */}
      {isRerouting && (
        <div className="px-3 py-2 rounded text-xs font-semibold"
          style={{ background: 'hsl(200 80% 8%)', border: '1px solid hsl(200 100% 35%)', color: 'hsl(200 100% 65%)' }}>
          🔄 Перестраиваю маршрут от текущей позиции…
        </div>
      )}

      {/* ── Off-route warning ── */}
      {offRoute && isRunning && plannedRoute && !isRerouting && (
        <div className="px-3 py-2 rounded text-xs font-semibold"
          style={{ background: 'hsl(55 80% 8%)', border: '1px solid hsl(55 100% 35%)', color: 'hsl(55 100% 65%)' }}>
          ⚠ Отклонение от маршрута ({'>'}250м){plannedRoute.toCoords ? ' — маршрут будет перестроен через ~45с' : ' — постройте новый маршрут'}
        </div>
      )}

      {/* ── Tariff selector ── */}
      <div className="card-neon p-3">
        <div className="section-title mb-2">Тариф · ставки (редактируйте поля)</div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
          {TARIFF_ORDER.map(t => {
            const cfg        = TARIFFS[t];
            const isActive   = tariff === t;
            const ctv        = customTariffs[t];
            const anyChanged = ctv.S !== cfg.S || ctv.rd !== cfg.rd || ctv.rt !== cfg.rt;
            const fieldColor = TARIFF_COLORS[t];
            return (
              <div key={t}
                className={`tariff-btn active-${isActive ? t : ''}`}
                style={{ cursor: isRunning ? 'default' : 'pointer' }}
                onClick={e => { if ((e.target as HTMLElement).tagName !== 'INPUT' && !isRunning) setTariff(t); }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm">{cfg.nameRu}</span>
                  {anyChanged && (
                    <button className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: 'hsl(0 80% 15%)', border: '1px solid hsl(0 100% 35%)', color: 'hsl(0 100% 55%)', fontSize: '0.6rem' }}
                      onClick={e => { e.stopPropagation(); resetTariff(t); }} disabled={isRunning}>↺</button>
                  )}
                </div>
                <div className="flex justify-around gap-1" onClick={e => e.stopPropagation()}>
                  <TariffField t={t} field="S"  label="Подача" unit="₽"     color={fieldColor}
                    value={ctv.S}  defaultValue={cfg.S}  disabled={isRunning} onChange={updateTariffField} />
                  <TariffField t={t} field="rd" label="₽/км"   unit="₽/км"  color={fieldColor}
                    value={ctv.rd} defaultValue={cfg.rd} disabled={isRunning} onChange={updateTariffField} />
                  <TariffField t={t} field="rt" label="₽/мин"  unit="₽/мин" color={fieldColor}
                    value={ctv.rt} defaultValue={cfg.rt} disabled={isRunning} onChange={updateTariffField} />
                </div>
                <div className="mt-2 pt-1.5" style={{ borderTop: '1px solid hsl(195 100% 10%)' }}>
                  <span className="text-xs" style={{ color: 'hsl(180 30% 38%)' }}>Сейчас: </span>
                  <span className="font-bold font-mono text-sm" style={{ color: fieldColor }}>
                    {calculatePrice(ctv.S, ctv.rd, ctv.rt, distanceMeters, elapsedSeconds, activeKtod()).toFixed(0)} ₽
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main counters ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2 card-neon-highlight p-4 text-center">
          <div className="section-title mb-1">Стоимость поездки</div>
          <div className={`price-display neon-cyan ${isRunning ? 'price-tick' : ''}`}>
            {price.toFixed(0)}<span style={{ fontSize: '1.5rem', fontWeight: 600, opacity: 0.7 }}> ₽</span>
          </div>
          <div className="text-xs mt-1" style={{ color: 'hsl(180 30% 40%)' }}>
            {TARIFFS[tariff].nameRu} · Ktod {activeKtod().toFixed(1)} · {ktodLabel}
          </div>
        </div>
        <div className="card-neon p-4 text-center">
          <div className="section-title mb-2">Время</div>
          <div className="text-3xl font-black font-mono neon-purple">{formatTime(elapsedSeconds)}</div>
          <div className="text-xs mt-1" style={{ color: 'hsl(180 30% 40%)' }}>чч:мм:сс</div>
        </div>
        <div className="card-neon p-4 text-center">
          <div className="section-title mb-2">Расстояние</div>
          <div className="text-3xl font-black font-mono neon-green">
            {distanceMeters >= 1000 ? (distanceMeters / 1000).toFixed(2) : distanceMeters.toFixed(0)}
          </div>
          <div className="text-xs mt-1" style={{ color: 'hsl(180 30% 40%)' }}>
            {distanceMeters >= 1000 ? 'км' : 'метров'}
          </div>
        </div>
      </div>

      {/* ── Route progress bar ── */}
      {plannedRoute && (
        <div className="card-neon p-3 space-y-2">
          <div className="flex items-center justify-between text-xs flex-wrap gap-1">
            <span className="section-title">Прогресс по маршруту</span>
            <div className="flex gap-4">
              <span style={{ color: 'hsl(180 30% 45%)' }}>
                Пройдено: <span className="neon-green font-mono font-bold">{(routeCursorDistM / 1000).toFixed(2)} км</span>
              </span>
              {remainingM !== null && (
                <span style={{ color: 'hsl(180 30% 45%)' }}>
                  Осталось: <span className="neon-cyan font-mono font-bold">{(remainingM / 1000).toFixed(2)} км</span>
                </span>
              )}
              <span style={{ color: 'hsl(180 30% 45%)' }}>
                Всего: <span style={{ color: 'hsl(200 100% 65%)' }} className="font-mono">{(plannedRoute.totalDistanceM / 1000).toFixed(2)} км</span>
              </span>
            </div>
          </div>
          {/* Progress bar */}
          <div style={{ background: 'hsl(222 47% 12%)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
            <div style={{
              width: `${routeProgress.toFixed(1)}%`,
              height: '100%',
              background: 'linear-gradient(90deg, hsl(120 100% 40%), hsl(180 100% 50%))',
              borderRadius: '4px',
              boxShadow: '0 0 8px hsl(150 100% 45% / 0.5)',
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div className="text-xs" style={{ color: 'hsl(180 30% 35%)' }}>
            {routeProgress.toFixed(1)}% · {plannedRoute.fromName && `${plannedRoute.fromName} → ${plannedRoute.toName}`}
          </div>
        </div>
      )}

      {/* ── Speed ── */}
      <div className="card-neon p-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="section-title">Скорость (телефон/авто)</div>
          <div className={`text-4xl font-black font-mono ${speedColor || ''}`}
            style={!speedColor ? { color: 'hsl(180 30% 35%)' } : {}}>
            {currentSpeedKmh.toFixed(1)}
            <span className="text-lg font-medium ml-1" style={{ color: 'hsl(180 30% 45%)' }}>км/ч</span>
          </div>
        </div>
        <div className="text-right space-y-1 text-xs">
          <div style={{ color: 'hsl(180 30% 40%)' }}>Точек GPS: <span className="neon-cyan">{track.length}</span></div>
          {drCount > 0 && <div style={{ color: 'hsl(270 100% 72%)' }}>⚡ DR: <span className="font-bold">{drCount}с</span></div>}
          <div style={{ color: 'hsl(180 30% 40%)' }}>Подача: <span className="neon-yellow">{ct.S} ₽</span></div>
          <div style={{ color: 'hsl(180 30% 40%)' }}>Тариф: <span className="neon-yellow">{ct.rd}₽/км · {ct.rt}₽/мин</span></div>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="card-neon p-3 space-y-3">
        <div className="section-title">Управление поездкой</div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div className="relative w-10 h-5 rounded-full transition-colors"
              style={{ background: isSimMode ? 'hsl(270 80% 30%)' : 'hsl(222 47% 15%)', border: '1px solid hsl(195 100% 20%)' }}
              onClick={() => { if (!isRunning) setIsSimMode(v => !v); }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
                style={{
                  background: isSimMode ? 'hsl(270 100% 72%)' : 'hsl(180 30% 40%)',
                  transform: isSimMode ? 'translateX(20px)' : 'translateX(2px)',
                }} />
            </div>
            <span className="text-xs" style={{ color: isSimMode ? 'hsl(270 100% 72%)' : 'hsl(180 30% 50%)' }}>
              {isSimMode ? '🎮 Симуляция GPS' : 'GPS телефона'}
            </span>
          </label>
          {isSimMode && (
            <label className="flex items-center gap-2 text-xs" style={{ color: 'hsl(180 30% 50%)' }}>
              Скорость:
              <input type="number" min="10" max="120" value={simSpeed}
                onChange={e => setSimSpeed(Number(e.target.value))}
                disabled={isRunning} style={{ width: '60px' }} />
              км/ч
            </label>
          )}
        </div>

        <div className="flex gap-3 flex-wrap">
          {!isRunning ? (
            <button className="btn-neon-green px-6 py-3 rounded-lg font-bold text-sm flex-1 min-w-[140px]" onClick={startTrip}>
              ▶ {tripStatus === 'idle' ? 'Начать поездку' : 'Продолжить'}
            </button>
          ) : (
            <button className="btn-neon-red px-6 py-3 rounded-lg font-bold text-sm flex-1 min-w-[140px]" onClick={stopTrip}>
              ■ Завершить поездку
            </button>
          )}
          <button className="btn-neon-cyan px-5 py-3 rounded-lg font-semibold text-sm" onClick={resetTrip} disabled={isRunning}>
            ↺ Сброс
          </button>
        </div>

        {isRunning && !isSimMode && gpsStatus === 'dead_reck' && (
          <div className="text-xs p-2 rounded"
            style={{ background: 'hsl(270 80% 7%)', border: '1px solid hsl(270 100% 35%)', color: 'hsl(270 100% 72%)' }}>
            ⚡ GPS не отвечает — расстояние считается по{plannedRoute ? ' маршруту' : ' последней скорости'}
          </div>
        )}

        {/* Receipt */}
        {isFinished && (
          <div className="mt-2 p-3 rounded-lg" style={{ background: 'hsl(55 80% 8%)', border: '1px solid hsl(55 100% 35%)' }}>
            <div className="section-title mb-2" style={{ color: 'hsl(55 100% 50%)' }}>Чек поездки</div>
            <div className="grid grid-cols-2 gap-y-1 text-xs">
              <span style={{ color: 'hsl(180 30% 50%)' }}>Тариф:</span>
              <span className="neon-yellow font-medium">{TARIFFS[tariff].nameRu}</span>
              <span style={{ color: 'hsl(180 30% 50%)' }}>Расстояние:</span>
              <span className="neon-green font-medium">{(distanceMeters / 1000).toFixed(2)} км</span>
              {plannedRoute && (
                <>
                  <span style={{ color: 'hsl(180 30% 50%)' }}>Маршрут:</span>
                  <span style={{ color: 'hsl(200 100% 65%)' }}>{(plannedRoute.totalDistanceM / 1000).toFixed(2)} км по дорогам</span>
                </>
              )}
              <span style={{ color: 'hsl(180 30% 50%)' }}>Время в пути:</span>
              <span className="neon-purple font-medium">{formatTime(elapsedSeconds)}</span>
              <span style={{ color: 'hsl(180 30% 50%)' }}>Ktod:</span>
              <span style={{ color: 'hsl(55 100% 55%)' }}>{activeKtod().toFixed(1)} ({ktodLabel})</span>
              {drCount > 0 && (
                <>
                  <span style={{ color: 'hsl(270 100% 72%)' }}>⚡ DR сегментов:</span>
                  <span style={{ color: 'hsl(270 100% 72%)' }}>{drCount}с</span>
                </>
              )}
              <span style={{ color: 'hsl(180 30% 50%)' }}>Итог:</span>
              <span className="neon-cyan font-black text-lg">{price.toFixed(0)} ₽</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Map + Ktod ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-neon p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="section-title">GPS-трек + Маршрут (OSM)</span>
            <button className="text-xs px-2 py-0.5 rounded"
              style={{ background: 'hsl(222 47% 12%)', border: '1px solid hsl(195 100% 15%)', color: 'hsl(180 30% 50%)' }}
              onClick={() => setShowMap(v => !v)}>
              {showMap ? 'Скрыть' : 'Показать'}
            </button>
          </div>
          {showMap ? (
            <div style={{ height: '300px' }}>
              <TripMap
                track={track}
                currentPoint={currentPoint}
                plannedRoute={plannedRoute}
                routeCursorPos={routeCursorPos}
                autoFollow={isRunning}
              />
            </div>
          ) : (
            <div className="text-center py-8 text-xs" style={{ color: 'hsl(180 30% 35%)' }}>
              Карта скрыта для экономии батареи
            </div>
          )}
        </div>
        <KtodTable
          coefs={ktodCoefs} activeKtod={activeKtod()} ktodMode={ktodMode}
          ktodLabel={ktodLabel} manualKtodIndex={manualKtodIndex}
          onCoefsChange={setKtodCoefs} onKtodModeChange={setKtodMode}
          onManualKtodChange={setManualKtodIndex}
          tariff={tariff} distanceMeters={distanceMeters} elapsedSeconds={elapsedSeconds}
        />
      </div>

      <EventLog logs={logs} onClear={() => setLogs([])} />

      {/* Formula */}
      <div className="card-neon p-3">
        <div className="section-title mb-2">Формула расчёта (текущие значения)</div>
        <div className="text-xs font-mono space-y-1" style={{ color: 'hsl(180 30% 50%)' }}>
          <div>
            <span className="neon-cyan">P</span> = <span className="neon-yellow">S</span> + <span className="neon-green">D</span>(км)×<span className="neon-green">rd</span> + <span className="neon-purple">T</span>(мин)×<span className="neon-purple">rt</span>×<span className="neon-yellow">Ktod</span>
          </div>
          <div style={{ color: 'hsl(180 30% 42%)' }}>
            = <span className="neon-yellow">{ct.S}</span> + <span className="neon-green">{(distanceMeters/1000).toFixed(3)}</span>×<span className="neon-green">{ct.rd}</span> + <span className="neon-purple">{(elapsedSeconds/60).toFixed(2)}</span>×<span className="neon-purple">{ct.rt}</span>×<span className="neon-yellow">{activeKtod().toFixed(1)}</span> = <span className="neon-cyan font-bold">{price.toFixed(2)} ₽</span>
          </div>
          <div style={{ color: 'hsl(180 30% 30%)' }}>
            {plannedRoute
              ? 'D = привязка GPS→маршрут (Haversine snap) + ⚡DR вдоль маршрута'
              : 'D = Σ Haversine(GPS) + ⚡DR(скорость×время) — НЕ прямая A→B'}
          </div>
        </div>
      </div>

      <div className="text-center text-xs pb-4" style={{ color: 'hsl(180 30% 30%)' }}>
        Геокодинг: Nominatim · Маршрут: OSRM · Карта: OpenStreetMap · Без платных API
      </div>
    </div>
  );
}
