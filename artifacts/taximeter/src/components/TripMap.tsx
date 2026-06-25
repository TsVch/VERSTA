/**
 * TripMap — Leaflet map with planned route, GPS track, and live position markers.
 *
 * Color legend:
 *   Blue dashed line  — planned route (OSRM road graph)
 *   Cyan solid line   — actual GPS track driven
 *   Orange dot        — current GPS position (raw phone coordinate)
 *   Purple dot        — ⚡ position cursor along route (snapped / DR)
 *   Green dot         — route start marker
 *   Red dot           — route destination marker
 *
 * Auto-follow: when `autoFollow` is true (trip running), map pans to keep
 * the route cursor (or GPS position) visible.
 */
import { useEffect, useRef } from 'react';
import { GpsPoint } from '../types';
import { PlannedRoute } from '../utils/routing';

interface Props {
  track: GpsPoint[];
  currentPoint: GpsPoint | null;
  plannedRoute: PlannedRoute | null;
  routeCursorPos: { lat: number; lon: number } | null;
  /** When true the map auto-pans to follow the current position */
  autoFollow?: boolean;
}

let L: typeof import('leaflet') | null = null;

export default function TripMap({
  track, currentPoint, plannedRoute, routeCursorPos, autoFollow = false,
}: Props) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<import('leaflet').Map | null>(null);
  const trackLineRef    = useRef<import('leaflet').Polyline | null>(null);
  const routeLineRef    = useRef<import('leaflet').Polyline | null>(null);
  const markerRef       = useRef<import('leaflet').CircleMarker | null>(null);
  const startMarkerRef  = useRef<import('leaflet').CircleMarker | null>(null);
  const destMarkerRef   = useRef<import('leaflet').CircleMarker | null>(null);
  const routeCursorRef  = useRef<import('leaflet').CircleMarker | null>(null);
  const userDraggedRef  = useRef(false);
  const dragTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    async function init() {
      if (!containerRef.current || mapRef.current) return;
      const leaflet = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      L = leaflet;
      if (!mounted || !containerRef.current) return;

      const map = leaflet.map(containerRef.current, {
        center: [55.7558, 37.6173],
        zoom: 13,
        zoomControl: true,
        attributionControl: false,
      });

      leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      // Disable auto-follow on manual drag for 30s
      map.on('dragstart', () => {
        userDraggedRef.current = true;
        if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
        dragTimerRef.current = setTimeout(() => { userDraggedRef.current = false; }, 30_000);
      });

      // Planned route line (neon orange)
      routeLineRef.current = leaflet.polyline([], {
        color: '#ff8800', weight: 5, opacity: 0.85,
      }).addTo(map);

      // Actual GPS track (cyan)
      trackLineRef.current = leaflet.polyline([], {
        color: '#00ffcc', weight: 3, opacity: 0.9,
      }).addTo(map);
    }
    init();
    return () => {
      mounted = false;
      if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
    };
  }, []);

  // ── Planned route ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !routeLineRef.current || !L) return;

    if (!plannedRoute) {
      routeLineRef.current.setLatLngs([]);
      startMarkerRef.current?.remove(); startMarkerRef.current = null;
      destMarkerRef.current?.remove();  destMarkerRef.current  = null;
      return;
    }

    const latlngs = plannedRoute.coords as [number, number][];
    routeLineRef.current.setLatLngs(latlngs);

    const startLL = latlngs[0];
    if (!startMarkerRef.current && startLL) {
      startMarkerRef.current = L.circleMarker(startLL, {
        radius: 8, color: '#00ff88', fillColor: '#00ff88', fillOpacity: 1, weight: 2,
      }).addTo(mapRef.current!).bindTooltip(plannedRoute.fromName || 'Откуда');
    } else if (startMarkerRef.current) {
      startMarkerRef.current.setLatLng(startLL);
    }

    const endLL = latlngs[latlngs.length - 1];
    if (!destMarkerRef.current && endLL) {
      destMarkerRef.current = L.circleMarker(endLL, {
        radius: 8, color: '#ff4444', fillColor: '#ff6666', fillOpacity: 1, weight: 2,
      }).addTo(mapRef.current!).bindTooltip(plannedRoute.toName || 'Куда');
    } else if (destMarkerRef.current) {
      destMarkerRef.current.setLatLng(endLL);
    }

    if (latlngs.length > 1) {
      mapRef.current!.fitBounds(routeLineRef.current.getBounds(), { padding: [30, 30] });
    }
  }, [plannedRoute]);

  // ── GPS track ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !trackLineRef.current || !L) return;
    const latlngs = track.map(pt => [pt.lat, pt.lon] as [number, number]);
    trackLineRef.current.setLatLngs(latlngs);

    if (latlngs.length >= 2 && !plannedRoute) {
      mapRef.current.fitBounds(trackLineRef.current.getBounds(), { padding: [20, 20] });
    }
  }, [track, plannedRoute]);

  // ── Current GPS position (orange) ─────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !L || !currentPoint) return;
    const ll: [number, number] = [currentPoint.lat, currentPoint.lon];

    if (!markerRef.current) {
      markerRef.current = L.circleMarker(ll, {
        radius: 9, color: '#ff6600', fillColor: '#ff9900', fillOpacity: 0.95, weight: 2,
      }).addTo(mapRef.current).bindTooltip('GPS-позиция');
    } else {
      markerRef.current.setLatLng(ll);
    }

    // Auto-follow: pan to current position when running (if user hasn't dragged)
    if (autoFollow && !userDraggedRef.current) {
      const followPos = routeCursorPos ?? { lat: currentPoint.lat, lon: currentPoint.lon };
      mapRef.current.panTo([followPos.lat, followPos.lon], { animate: true, duration: 0.8 });
    } else if (track.length <= 1 && !plannedRoute) {
      mapRef.current.setView(ll, 16);
    }
  }, [currentPoint, autoFollow, track.length, plannedRoute, routeCursorPos]);

  // ── Route cursor (purple) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !L) return;
    if (!routeCursorPos) {
      routeCursorRef.current?.remove(); routeCursorRef.current = null;
      return;
    }
    const ll: [number, number] = [routeCursorPos.lat, routeCursorPos.lon];
    if (!routeCursorRef.current) {
      routeCursorRef.current = L.circleMarker(ll, {
        radius: 7, color: '#cc44ff', fillColor: '#cc44ff', fillOpacity: 0.9, weight: 2,
      }).addTo(mapRef.current).bindTooltip('Позиция по маршруту');
    } else {
      routeCursorRef.current.setLatLng(ll);
    }
  }, [routeCursorPos]);

  // ── Clear on reset ────────────────────────────────────────────────────────
  useEffect(() => {
    if (track.length === 0) {
      trackLineRef.current?.setLatLngs([]);
      markerRef.current?.remove();      markerRef.current      = null;
      routeCursorRef.current?.remove(); routeCursorRef.current = null;
    }
  }, [track.length]);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div ref={containerRef}
        style={{ height: '100%', width: '100%', borderRadius: '8px', overflow: 'hidden' }} />

      {/* ── Legend ── */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8, zIndex: 1000,
        background: 'hsl(222 47% 9% / 0.92)',
        border: '1px solid hsl(195 100% 18%)',
        borderRadius: '6px', padding: '5px 8px',
        display: 'flex', flexDirection: 'column', gap: '4px',
      }}>
        {/* Blue line: planned route */}
        <LegendRow>
          <div style={{ width: 20, height: 3, background: '#4488ff', opacity: 0.6, borderRadius: 2 }} />
          <span style={{ color: 'hsl(180 30% 50%)' }}>Маршрут по дорогам</span>
        </LegendRow>

        {/* Cyan line: GPS track */}
        <LegendRow>
          <div style={{ width: 20, height: 3, background: '#00ffcc', borderRadius: 2 }} />
          <span style={{ color: 'hsl(180 30% 50%)' }}>GPS-трек</span>
        </LegendRow>

        {/* Orange dot: current GPS position */}
        {currentPoint && (
          <LegendRow>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: '#ff9900', border: '2px solid #ff6600',
              flexShrink: 0,
            }} />
            <span style={{ color: 'hsl(30 100% 65%)' }}>Текущая GPS-позиция</span>
          </LegendRow>
        )}

        {/* Purple dot: route cursor */}
        {routeCursorPos && (
          <LegendRow>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: '#cc44ff', flexShrink: 0,
            }} />
            <span style={{ color: 'hsl(270 100% 72%)' }}>⚡ Позиция по маршруту</span>
          </LegendRow>
        )}
      </div>
    </div>
  );
}

function LegendRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.62rem' }}>
      {children}
    </div>
  );
}
