/**
 * useGPS — Multi-tier GPS hook with Dead Reckoning + IMU enhancement.
 *
 * Tier 1 (GOOD, acc ≤ 50m):   Haversine between smoothed positions.
 * Tier 2 (DEGRADED, 50–200m): Doppler speed × time. Never position diff.
 * Tier 3 (POOR, 200–500m):    Doppler speed × time (position unreliable).
 * Tier 4 (REJECTED, >500m):   Completely ignored. DR fires on its own timer.
 * Tier 5 (NO UPDATE > GAP_S): Dead Reckoning with time-decayed speed.
 *
 * IMU enhancement (optional):
 *   - heading from compass overrides null heading in DR point
 *   - isMoving flag keeps a minimum DR speed when accelerometer detects motion,
 *     preventing premature speed decay when car is accelerating without GPS.
 *
 * CRITICAL: lastUpdateTsRef updated ONLY for non-rejected events (acc ≤ 500m).
 */
import { useRef, useCallback } from 'react';
import {
  GpsPoint, GpsQuality,
  GPS_TIER_GOOD, GPS_TIER_DEGRADED, GPS_TIER_POOR,
  GPS_MAX_SPEED_MS, GPS_MIN_DISTANCE, GPS_DR_GAP_S, GPS_SMOOTH_ALPHA,
} from '../types';
import { haversineMeters } from '../utils/haversine';
import { IMUSnapshot } from './useIMU';

export type GpsStatus = 'waiting' | 'good' | 'degraded' | 'poor' | 'dead_reck' | 'error';

export interface GpsCallbacks {
  onPoint: (pt: GpsPoint, distanceDelta: number) => void;
  onStatusChange: (status: GpsStatus, accuracy: number | null) => void;
  onLog: (type: 'gps' | 'warn' | 'dr' | 'error', msg: string) => void;
  /** Optional: returns current IMU snapshot for DR enhancement */
  getIMU?: () => IMUSnapshot;
}

const DR_SPEED_HALF_LIFE_S = 60; // speed halves every 60s without good GPS
/** Minimum DR speed when IMU detects motion but GPS speed has decayed */
const IMU_MOTION_MIN_SPEED_MS = 0.8; // ~3 km/h

export function useGPS() {
  const watchIdRef          = useRef<number | null>(null);
  const drTimerRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPointRef        = useRef<GpsPoint | null>(null);
  const lastUpdateTsRef     = useRef<number>(0);
  const lastGoodSpeedMsRef  = useRef<number>(0);
  const lastGoodSpeedTsRef  = useRef<number>(0);
  const smoothLatRef        = useRef<number | null>(null);
  const smoothLonRef        = useRef<number | null>(null);
  /** Timestamp of the last DR tick — used to measure ACTUAL elapsed time per tick,
   *  immune to browser timer throttling when the screen is off or tab is backgrounded. */
  const lastDRTickRef       = useRef<number>(0);

  // ── helpers ──────────────────────────────────────────────────────────────

  function qualityTier(accuracy: number): GpsQuality {
    if (accuracy <= GPS_TIER_GOOD)     return 'good';
    if (accuracy <= GPS_TIER_DEGRADED) return 'degraded';
    return 'poor';
  }

  function statusFromQuality(q: GpsQuality): GpsStatus {
    if (q === 'good')     return 'good';
    if (q === 'degraded') return 'degraded';
    return 'poor';
  }

  function smoothPosition(lat: number, lon: number, alpha: number): [number, number] {
    if (smoothLatRef.current === null) {
      smoothLatRef.current = lat;
      smoothLonRef.current = lon;
    } else {
      smoothLatRef.current = alpha * lat + (1 - alpha) * smoothLatRef.current;
      smoothLonRef.current = alpha * lon + (1 - alpha) * smoothLonRef.current!;
    }
    return [smoothLatRef.current, smoothLonRef.current!];
  }

  /**
   * DR speed with time-decay.
   * IMU enhancement: if IMU detects motion but speed has decayed below minimum,
   * hold at IMU_MOTION_MIN_SPEED_MS so the car never appears stopped while moving.
   */
  function decayedDRSpeed(imu?: IMUSnapshot): number {
    const raw = lastGoodSpeedMsRef.current;
    if (raw < 0.3) {
      // GPS speed was effectively zero — only move if IMU detects motion
      return imu?.isMoving ? IMU_MOTION_MIN_SPEED_MS : 0;
    }
    const ageS = (Date.now() - lastGoodSpeedTsRef.current) / 1000;
    const decayed = raw * Math.pow(0.5, ageS / DR_SPEED_HALF_LIFE_S);

    // IMU moving → enforce minimum even as GPS speed decays
    const floor = imu?.isMoving ? IMU_MOTION_MIN_SPEED_MS : 0.3;
    return decayed < floor ? (imu?.isMoving ? floor : 0) : decayed;
  }

  // ── Dead Reckoning timer ──────────────────────────────────────────────────
  function startDRTimer(callbacks: GpsCallbacks) {
    stopDRTimer();
    lastDRTickRef.current = Date.now();
    drTimerRef.current = setInterval(() => {
      const now  = Date.now();
      const gapS = (now - lastUpdateTsRef.current) / 1000;
      if (gapS < GPS_DR_GAP_S) {
        // GPS is alive — reset DR tick reference so the next DR burst
        // doesn't accumulate phantom time from the "healthy" period.
        lastDRTickRef.current = now;
        return;
      }

      // CRITICAL: measure ACTUAL wall-clock time since the last DR tick.
      // Mobile browsers throttle setInterval when the screen is off or the
      // tab is backgrounded. Using a hardcoded "1.0 s" undercount distance
      // because the real interval may be 5–60 s or more.
      const dtS = Math.min((now - lastDRTickRef.current) / 1000, 30); // cap 30s to be safe
      lastDRTickRef.current = now;
      if (dtS < 0.05) return; // degenerate tick — skip

      const imu = callbacks.getIMU?.();
      const drSpeed = decayedDRSpeed(imu);
      if (drSpeed < 0.3) return; // stopped or speed unknown

      const distDelta = drSpeed * dtS; // actual elapsed time, not assumed 1.0 s

      // Use compass heading from IMU if available
      const heading = imu?.heading ?? null;

      const drPt: GpsPoint = {
        lat: smoothLatRef.current ?? 0,
        lon: smoothLonRef.current ?? 0,
        accuracy: -1,
        speed: drSpeed,
        timestamp: Date.now(),
        heading,
        quality: 'dead_reck',
      };
      callbacks.onPoint(drPt, distDelta);
      callbacks.onStatusChange('dead_reck', null);

      const decayPct = lastGoodSpeedMsRef.current > 0
        ? ((1 - drSpeed / lastGoodSpeedMsRef.current) * 100).toFixed(0)
        : '0';
      const imuTag = imu?.isMoving
        ? ` 📱IMU:▶` : imu?.heading != null ? ` 🧭${imu.heading.toFixed(0)}°` : '';
      callbacks.onLog('dr',
        `⚡DR: +${distDelta.toFixed(0)}м @ ${(drSpeed * 3.6).toFixed(1)}км/ч (GPS ${gapS.toFixed(0)}с, decay ${decayPct}%${imuTag})`
      );
    }, 1000);
  }

  function stopDRTimer() {
    if (drTimerRef.current !== null) {
      clearInterval(drTimerRef.current);
      drTimerRef.current = null;
    }
  }

  // ── Main GPS handler ──────────────────────────────────────────────────────
  const start = useCallback((callbacks: GpsCallbacks) => {
    if (!('geolocation' in navigator)) {
      callbacks.onLog('error', 'Geolocation API недоступно в этом браузере');
      return;
    }

    callbacks.onStatusChange('waiting', null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, speed, heading } = pos.coords;
        const ts = pos.timestamp || Date.now();

        // Reject cell-tower / WiFi positions (>500m accuracy)
        if (accuracy > GPS_TIER_POOR) {
          callbacks.onStatusChange('poor', accuracy);
          callbacks.onLog('warn',
            `GPS недоступен: точность ${accuracy.toFixed(0)}м (сотовая вышка) — ⚡DR активен`
          );
          return;
          // NOTE: lastUpdateTsRef NOT updated → DR timer will activate
        }

        // Update speed ref (before jump check — Doppler speed is independent of position)
        if (speed !== null && speed !== undefined && speed > 0.5 && speed <= GPS_MAX_SPEED_MS) {
          lastGoodSpeedMsRef.current = speed;
          lastGoodSpeedTsRef.current = Date.now();
        }

        const tier = qualityTier(accuracy);
        const alpha = tier === 'good' ? GPS_SMOOTH_ALPHA : 0.4;
        const [sLat, sLon] = smoothPosition(latitude, longitude, alpha);

        // Prefer GPS heading, fall back to compass
        const imu = callbacks.getIMU?.();
        const effectiveHeading = heading ?? imu?.heading ?? null;

        const pt: GpsPoint = {
          lat: sLat, lon: sLon, accuracy, speed, timestamp: ts,
          heading: effectiveHeading, quality: tier,
        };

        callbacks.onStatusChange(statusFromQuality(tier), accuracy);

        const prev = lastPointRef.current;
        if (!prev) {
          // First point: accept unconditionally
          lastUpdateTsRef.current = Date.now();
          lastPointRef.current = pt;
          callbacks.onPoint(pt, 0);
          callbacks.onLog('gps', `Первая точка GPS | acc:${accuracy.toFixed(0)}м | ${tier}`);
          return;
        }

        const dtS = Math.max(0.1, (ts - prev.timestamp) / 1000);

        let distDelta = 0;

        if (tier === 'good') {
          const rawDist = haversineMeters(prev.lat, prev.lon, sLat, sLon);
          const impliedSpeed = rawDist / dtS;
          if (impliedSpeed > GPS_MAX_SPEED_MS) {
            // ─── SPOOFING / JUMP GUARD ──────────────────────────────────────
            // CRITICAL: do NOT update smooth position, lastPointRef, or
            // lastUpdateTsRef to the bad position.
            //   • smooth stays at the last known-good location → next
            //     spoofed point will still fail the jump check.
            //   • lastUpdateTsRef stays old → DR timer activates after GAP_S.
            // Reset the EMA to current smooth (undo the bad smoothing step):
            smoothLatRef.current = prev.lat;
            smoothLonRef.current = prev.lon;
            callbacks.onLog('warn',
              `⚠ GPS-спуфинг/скачок ${(impliedSpeed * 3.6).toFixed(0)}км/ч — отброшено, DR активен`
            );
            return;
            // ────────────────────────────────────────────────────────────────
          }
          distDelta = rawDist >= GPS_MIN_DISTANCE ? rawDist : 0;

        } else if (tier === 'degraded') {
          if (speed !== null && speed !== undefined && speed > 0.5) {
            distDelta = speed * Math.min(dtS, 10);
          }
          // speed=0 → distDelta=0, DR timer handles it

        } else {
          // POOR (200-500m)
          if (speed !== null && speed !== undefined && speed > 0.5) {
            distDelta = speed * Math.min(dtS, 10);
          }
        }

        // Point accepted — mark GPS as alive (prevents spurious DR activation)
        lastUpdateTsRef.current = Date.now();
        lastPointRef.current = pt;
        callbacks.onPoint(pt, distDelta);

        const compassTag = effectiveHeading != null && heading == null ? ` 🧭${effectiveHeading.toFixed(0)}°` : '';
        callbacks.onLog('gps',
          `${tier.toUpperCase()} | acc:${accuracy.toFixed(0)}м | +${distDelta.toFixed(1)}м | ${((speed ?? 0) * 3.6).toFixed(1)}км/ч${compassTag}`
        );
      },
      (err) => {
        let msg = 'Ошибка GPS';
        if (err.code === err.PERMISSION_DENIED)
          msg = 'Нет разрешения на GPS — разрешите доступ к геолокации';
        else if (err.code === err.POSITION_UNAVAILABLE)
          msg = 'GPS сигнал недоступен';
        else if (err.code === err.TIMEOUT)
          msg = 'GPS таймаут — слабый сигнал';
        callbacks.onLog('error', msg);
        callbacks.onStatusChange('error', null);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    startDRTimer(callbacks);
  }, []);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    stopDRTimer();
    lastPointRef.current       = null;
    lastUpdateTsRef.current    = 0;
    lastGoodSpeedMsRef.current = 0;
    lastGoodSpeedTsRef.current = 0;
    smoothLatRef.current       = null;
    smoothLonRef.current       = null;
  }, []);

  return { start, stop };
}
