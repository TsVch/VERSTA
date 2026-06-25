import { useRef, useCallback } from 'react';
import { GpsPoint } from '../types';
import { haversineMeters } from '../utils/haversine';

// Realistic Moscow city route with varied speeds
const SIMULATION_ROUTE: Array<[number, number]> = [
  [55.7558, 37.6173], [55.7570, 37.6190], [55.7585, 37.6210],
  [55.7600, 37.6235], [55.7615, 37.6260], [55.7630, 37.6280],
  [55.7640, 37.6300], [55.7650, 37.6325], [55.7662, 37.6350],
  [55.7675, 37.6370], [55.7690, 37.6390], [55.7705, 37.6410],
  [55.7720, 37.6430], [55.7735, 37.6445], [55.7748, 37.6460],
  [55.7755, 37.6480], [55.7760, 37.6500], [55.7765, 37.6520],
  [55.7770, 37.6545], [55.7775, 37.6570], [55.7780, 37.6595],
  [55.7785, 37.6620], [55.7790, 37.6640], [55.7795, 37.6665],
  [55.7800, 37.6690], [55.7805, 37.6710], [55.7810, 37.6730],
  [55.7818, 37.6750], [55.7825, 37.6768], [55.7832, 37.6785],
];

export interface SimCallbacks {
  onPoint: (pt: GpsPoint, distanceDelta: number) => void;
  onFinish: () => void;
}

export function useSimulator() {
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef  = useRef(0);
  const lastPtRef = useRef<GpsPoint | null>(null);

  const start = useCallback((callbacks: SimCallbacks, speedKmh = 40) => {
    indexRef.current  = 0;
    lastPtRef.current = null;

    const intervalMs = 1500;

    timerRef.current = setInterval(() => {
      const i = indexRef.current;
      if (i >= SIMULATION_ROUTE.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        callbacks.onFinish();
        return;
      }

      const [lat, lon] = SIMULATION_ROUTE[i];
      const noiseLat   = (Math.random() - 0.5) * 0.00002;
      const noiseLon   = (Math.random() - 0.5) * 0.00002;
      const speedMs    = (speedKmh / 3.6) * (0.85 + Math.random() * 0.3);

      const pt: GpsPoint = {
        lat: lat + noiseLat,
        lon: lon + noiseLon,
        accuracy: 8 + Math.random() * 10,
        speed: speedMs,
        timestamp: Date.now(),
        heading: null,
        quality: 'sim',
      };

      let distDelta = 0;
      if (lastPtRef.current) {
        distDelta = haversineMeters(
          lastPtRef.current.lat, lastPtRef.current.lon,
          pt.lat, pt.lon
        );
      }
      lastPtRef.current = pt;
      indexRef.current++;
      callbacks.onPoint(pt, distDelta);
    }, intervalMs);
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    lastPtRef.current = null;
    indexRef.current  = 0;
  }, []);

  return { start, stop };
}
