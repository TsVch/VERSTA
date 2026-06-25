/**
 * Haversine formula — great-circle distance between two GPS points.
 * Returns distance in meters.
 */
export function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate speed in km/h between two consecutive GPS points.
 */
export function speedBetweenPoints(
  lat1: number, lon1: number, ts1: number,
  lat2: number, lon2: number, ts2: number
): number {
  const distM = haversineMeters(lat1, lon1, lat2, lon2);
  const dtS = (ts2 - ts1) / 1000;
  if (dtS <= 0) return 0;
  return (distM / dtS) * 3.6; // km/h
}
