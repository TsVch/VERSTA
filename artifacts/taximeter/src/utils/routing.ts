/**
 * Routing utilities using 100% free APIs:
 *  - Nominatim (openstreetmap.org) — address geocoding
 *  - OSRM demo server (router.project-osrm.org) — road routing
 *
 * OSRM returns GeoJSON geometry with [lon, lat] pairs (GeoJSON standard).
 * Internally we store everything as [lat, lon] for consistency with the rest of the app.
 */

import { haversineMeters } from './haversine';

export interface GeocodedPlace {
  lat: number;
  lon: number;
  displayName: string;
}

export interface PlannedRoute {
  /** Full detailed polyline: [lat, lon] pairs */
  coords: Array<[number, number]>;
  /** Cumulative road-distance from start to coords[i], in meters */
  cumulativeM: number[];
  /** Total road distance in meters */
  totalDistanceM: number;
  /** Estimated travel time in seconds */
  totalDurationS: number;
  /** From / to place names */
  fromName: string;
  toName: string;
  /** Destination coordinates — preserved for rerouting */
  toCoords?: { lat: number; lon: number };
}

// ── Nominatim geocoding ───────────────────────────────────────────────────────

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export async function geocodeAddress(query: string): Promise<GeocodedPlace | null> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '1',
    addressdetails: '0',
  });

  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: {
      // Nominatim policy: must set a descriptive User-Agent
      'Accept-Language': 'ru,en',
    },
  });

  if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
  const data = await res.json();
  if (!data.length) return null;

  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    displayName: data[0].display_name,
  };
}

// ── OSRM routing ──────────────────────────────────────────────────────────────

const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';

export async function getRoute(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): Promise<PlannedRoute | null> {
  const url = `${OSRM_URL}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=false`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM error: ${res.status}`);
  const data = await res.json();

  if (data.code !== 'Ok' || !data.routes?.length) return null;

  const route = data.routes[0];
  // GeoJSON coords are [lon, lat] — convert to [lat, lon]
  const rawCoords: Array<[number, number]> = route.geometry.coordinates.map(
    ([lon, lat]: [number, number]) => [lat, lon] as [number, number]
  );

  // Build cumulative distance array
  const cumulativeM: number[] = [0];
  for (let i = 1; i < rawCoords.length; i++) {
    const d = haversineMeters(
      rawCoords[i - 1][0], rawCoords[i - 1][1],
      rawCoords[i][0],     rawCoords[i][1]
    );
    cumulativeM.push(cumulativeM[i - 1] + d);
  }

  return {
    coords: rawCoords,
    cumulativeM,
    totalDistanceM: route.distance,
    totalDurationS: route.duration,
    fromName: '',
    toName: '',
  };
}
