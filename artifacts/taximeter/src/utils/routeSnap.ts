/**
 * Route-snapping and along-route distance utilities.
 *
 * Core idea:
 *   Represent the car's position as a single number: distanceFromRouteStart (meters).
 *   This "route cursor" advances monotonically forward, never backwards.
 *
 * When GPS is active:
 *   - Snap the GPS point to the nearest point on the route polyline
 *   - Advance the cursor if the snapped position is ahead of the current cursor
 *
 * When GPS is lost (Dead Reckoning):
 *   - Advance the cursor by: lastSpeedMs × elapsedSeconds
 *
 * When GPS returns after a gap:
 *   - Snap to route within a forward search window (prevents huge jumps)
 *   - If nothing found in window → don't advance (stay on DR path)
 *
 * BUG FIX #3: Windowed search prevents cursor from snapping to a route point
 * that is far BEHIND the current cursor when the car is off-route.
 *
 * BUG FIX #2: maxAdvanceM rate-limit prevents single GPS jump of 1000m+.
 */

import { haversineMeters } from './haversine';
import { PlannedRoute } from './routing';

export interface SnapResult {
  /** Road distance from route start to the snapped point, meters */
  distFromStart: number;
  /** Snapped position for map display */
  lat: number;
  lon: number;
  /** How far (meters) the GPS point was from the nearest route segment */
  deviationM: number;
  /** Whether a valid snap was found in the search window */
  found: boolean;
}

/**
 * Project a point (pLat, pLon) onto the line segment (a→b).
 * Returns the fraction t ∈ [0,1] along the segment.
 */
function projectFraction(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number
): number {
  const dx = bLon - aLon;
  const dy = bLat - aLat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  const t = ((pLon - aLon) * dx + (pLat - aLat) * dy) / lenSq;
  return Math.max(0, Math.min(1, t));
}

/**
 * Find the index range in cumulativeM within [minDist, maxDist].
 * Since cumulativeM is monotonically increasing, binary search works.
 */
function findIndexRange(
  cumulativeM: number[],
  minDist: number,
  maxDist: number
): [number, number] {
  let lo = 0;
  let hi = cumulativeM.length - 1;

  // Lower bound: first index where cumulativeM[i] >= minDist
  let left = 0;
  lo = 0; hi = cumulativeM.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulativeM[mid] < minDist) lo = mid + 1;
    else hi = mid;
  }
  left = lo;

  // Upper bound: last index where cumulativeM[i] <= maxDist
  let right = cumulativeM.length - 1;
  lo = 0; hi = cumulativeM.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulativeM[mid] > maxDist) hi = mid - 1;
    else lo = mid;
  }
  right = lo;

  // Ensure we cover segments that overlap the window
  left = Math.max(0, left - 1);
  right = Math.min(cumulativeM.length - 2, right);

  return [left, right];
}

/**
 * Snap a GPS point to the nearest position on the route polyline.
 *
 * @param lat, lon - GPS position
 * @param route - planned route
 * @param currentCursorM - current route cursor (meters from start)
 * @param maxAdvanceM - max allowed forward advance from currentCursorM
 *   (prevents huge single-step jumps from GPS errors).
 *   Set to Infinity to disable rate-limiting (e.g., initial route setup).
 * @param searchBehindM - how far behind cursor to search (for GPS correction).
 *   Small value prevents wrong-way snapping. Default: 200m.
 */
export function snapToRoute(
  lat: number,
  lon: number,
  route: PlannedRoute,
  currentCursorM: number,
  maxAdvanceM = Infinity,
  searchBehindM = 200
): SnapResult {
  const { coords, cumulativeM } = route;
  const totalM = cumulativeM[cumulativeM.length - 1];

  // Search window: slightly behind cursor (for correction) to cursor + maxAdvance
  const searchMin = Math.max(0, currentCursorM - searchBehindM);
  const searchMax = Math.min(totalM, currentCursorM + maxAdvanceM);

  const [iMin, iMax] = findIndexRange(cumulativeM, searchMin, searchMax);

  let bestDist = Infinity;
  let bestDistFromStart = currentCursorM; // default: stay where we are
  let bestLat = lat;
  let bestLon = lon;
  let bestDeviation = Infinity;
  let found = false;

  for (let i = iMin; i <= iMax; i++) {
    const [aLat, aLon] = coords[i];
    const [bLat, bLon] = coords[i + 1];

    const t = projectFraction(lat, lon, aLat, aLon, bLat, bLon);
    const projLat = aLat + t * (bLat - aLat);
    const projLon = aLon + t * (bLon - aLon);
    const d = haversineMeters(lat, lon, projLat, projLon);

    if (d < bestDist) {
      bestDist = d;
      const segDistFromStart = cumulativeM[i] + t * (cumulativeM[i + 1] - cumulativeM[i]);
      // Monotonic: snap position must be ≥ current cursor
      bestDistFromStart = Math.max(currentCursorM, segDistFromStart);
      bestLat = projLat;
      bestLon = projLon;
      bestDeviation = d;
      found = true;
    }
  }

  return {
    distFromStart: bestDistFromStart,
    lat: bestLat,
    lon: bestLon,
    deviationM: bestDeviation,
    found,
  };
}

/**
 * Given a distance from route start, return the (lat, lon) on the route.
 * Used for map display of the Dead Reckoning position.
 */
export function positionOnRoute(
  distFromStart: number,
  route: PlannedRoute
): { lat: number; lon: number } {
  const { coords, cumulativeM } = route;
  const clampedDist = Math.min(distFromStart, cumulativeM[cumulativeM.length - 1]);

  let lo = 0;
  let hi = cumulativeM.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulativeM[mid] <= clampedDist) lo = mid;
    else hi = mid - 1;
  }

  const i = lo;
  const segLen = cumulativeM[i + 1] - cumulativeM[i];
  const t = segLen > 0 ? (clampedDist - cumulativeM[i]) / segLen : 0;
  return {
    lat: coords[i][0] + t * (coords[i + 1][0] - coords[i][0]),
    lon: coords[i][1] + t * (coords[i + 1][1] - coords[i][1]),
  };
}

/**
 * How many meters remain from a given distFromStart to the end of the route.
 */
export function remainingRouteDistance(distFromStart: number, route: PlannedRoute): number {
  return Math.max(0, route.totalDistanceM - distFromStart);
}
