/**
 * useIMU — DeviceMotion + DeviceOrientation hook.
 *
 * Provides:
 *   heading   — compass bearing (0-360°, 0=North, CW). Reliable on most phones.
 *   isMoving  — true when accelerometer detects horizontal motion > 0.4 m/s².
 *               Used to prevent premature DR speed decay (car is clearly moving).
 *
 * iOS requires a user-gesture to call requestPermission().
 * Call `await imu.requestPermission()` inside the "Start trip" button handler.
 * Android fires automatically without permission.
 *
 * If API unavailable or permission denied → getHeading() = null, getIsMoving() = false.
 */
import { useRef, useCallback } from 'react';

export interface IMUSnapshot {
  heading: number | null;
  isMoving: boolean;
}

export function useIMU() {
  const headingRef    = useRef<number | null>(null);
  const isMovingRef   = useRef(false);
  const hasStartedRef = useRef(false);

  // ── Listener refs (for cleanup) ───────────────────────────────────────────
  const orientListenerRef = useRef<EventListener | null>(null);
  const motionListenerRef = useRef<EventListener | null>(null);

  // ── Permission (iOS 13+) ──────────────────────────────────────────────────
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      // @ts-ignore — only on iOS 13+
      if (typeof DeviceMotionEvent?.requestPermission === 'function') {
        const result = await (DeviceMotionEvent as any).requestPermission();
        if (result !== 'granted') return false;
      }
      // @ts-ignore
      if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
        const result = await (DeviceOrientationEvent as any).requestPermission();
        if (result !== 'granted') return false;
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Start ─────────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    // Compass heading
    const orientHandler: EventListener = (evt: Event) => {
      const e = evt as DeviceOrientationEvent;
      // iOS: webkitCompassHeading (already true north, clockwise)
      const iosHeading = (e as any).webkitCompassHeading;
      if (typeof iosHeading === 'number') {
        headingRef.current = iosHeading;
        return;
      }
      // Android absolute: alpha is counter-clockwise from magnetic north → convert
      if (e.absolute && e.alpha != null) {
        headingRef.current = (360 - e.alpha) % 360;
      } else if (e.alpha != null) {
        // Non-absolute: best effort
        headingRef.current = (360 - e.alpha) % 360;
      }
    };

    // Try absolute first (Android), fall back to regular (iOS handles via webkitCompassHeading)
    window.addEventListener('deviceorientationabsolute', orientHandler, { passive: true });
    window.addEventListener('deviceorientation', orientHandler, { passive: true });
    orientListenerRef.current = orientHandler;

    // Accelerometer — only to detect movement (isMoving flag)
    const motionHandler: EventListener = (evt: Event) => {
      const e = evt as DeviceMotionEvent;
      // Use acceleration WITHOUT gravity (already gravity-corrected by OS)
      const ax = e.acceleration?.x ?? 0;
      const ay = e.acceleration?.y ?? 0;
      const mag = Math.sqrt(ax * ax + ay * ay);
      isMovingRef.current = mag > 0.4; // 0.4 m/s² threshold above sensor noise
    };
    window.addEventListener('devicemotion', motionHandler, { passive: true });
    motionListenerRef.current = motionHandler;
  }, []);

  // ── Stop ──────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    if (orientListenerRef.current) {
      window.removeEventListener('deviceorientationabsolute', orientListenerRef.current);
      window.removeEventListener('deviceorientation', orientListenerRef.current);
      orientListenerRef.current = null;
    }
    if (motionListenerRef.current) {
      window.removeEventListener('devicemotion', motionListenerRef.current);
      motionListenerRef.current = null;
    }
    headingRef.current  = null;
    isMovingRef.current = false;
    hasStartedRef.current = false;
  }, []);

  // ── Getters (called from GPS DR timer) ────────────────────────────────────
  const getSnapshot = useCallback((): IMUSnapshot => ({
    heading:  headingRef.current,
    isMoving: isMovingRef.current,
  }), []);

  return { requestPermission, start, stop, getSnapshot };
}
