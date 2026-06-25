/**
 * RoutePanel — address input, geocoding, route planning.
 * Nominatim (OSM) for geocoding + OSRM for routing (both free, no API keys).
 *
 * Mobile keyboard fix: AddrRow uses local state for the typed value.
 * Parent state is only updated on blur or Enter/Find, preventing the cascade
 * of re-renders that caused the iOS keyboard to dismiss on every keystroke.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { geocodeAddress, getRoute, GeocodedPlace, PlannedRoute } from '../utils/routing';

interface AddrState {
  raw: string;
  place: GeocodedPlace | null;
  loading: boolean;
  error: string | null;
}

interface AddrRowProps {
  label: string;
  color: string;
  state: AddrState;
  disabled: boolean;
  onRawChange: (v: string) => void;
  /** Now receives the current typed value to avoid stale closure issues */
  onFind: (currentValue: string) => void;
}

// ── Defined OUTSIDE RoutePanel to keep a stable component identity ────────────
function AddrRow({ label, color, state, disabled, onRawChange, onFind }: AddrRowProps) {
  // Local state: typing is local — parent only updated on blur/Enter/Find.
  // This prevents parent re-renders from dismissing the mobile keyboard.
  const [localVal, setLocalVal] = useState(state.raw);
  const prevStateRaw = useRef(state.raw);

  // Sync when parent resets or sets state.raw (e.g., after geocoding → display name)
  if (state.raw !== prevStateRaw.current) {
    prevStateRaw.current = state.raw;
    if (state.raw !== localVal) setLocalVal(state.raw);
  }

  // Also sync via effect for cases the render comparison misses
  useEffect(() => {
    setLocalVal(state.raw);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.raw]);

  function commitAndFind() {
    onRawChange(localVal);
    onFind(localVal);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        <span className="text-xs font-semibold" style={{ color }}>
          {label}
        </span>
        {state.loading && (
          <span className="text-xs" style={{ color: 'hsl(180 30% 40%)' }}>Геокодирование…</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Введите адрес…"
          value={localVal}
          disabled={disabled}
          onChange={e => setLocalVal(e.target.value)}
          onBlur={() => onRawChange(localVal)}          // sync to parent on blur
          onKeyDown={e => { if (e.key === 'Enter') commitAndFind(); }}
          style={{
            flex: 1,
            background: 'hsl(222 47% 7%)',
            border: `1px solid ${state.place ? color + '60' : 'hsl(195 100% 15%)'}`,
            borderRadius: '6px',
            color: state.place ? 'hsl(180 100% 85%)' : 'hsl(180 30% 65%)',
            padding: '6px 10px',
            fontSize: '0.8rem',
            outline: 'none',
          }}
        />
        <button
          onClick={commitAndFind}
          disabled={!localVal.trim() || state.loading || disabled}
          style={{
            padding: '6px 10px', borderRadius: '6px', fontSize: '0.75rem',
            background: 'hsl(222 47% 10%)', border: '1px solid hsl(195 100% 18%)',
            color: 'hsl(180 100% 55%)', cursor: 'pointer', flexShrink: 0,
          }}
        >
          Найти
        </button>
      </div>
      {state.error && (
        <p className="text-xs" style={{ color: 'hsl(0 100% 60%)' }}>{state.error}</p>
      )}
      {state.place && (
        <p className="text-xs" style={{ color: 'hsl(120 100% 45%)' }}>
          ✓ {state.place.lat.toFixed(5)}, {state.place.lon.toFixed(5)}
        </p>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const emptyAddr = (): AddrState => ({ raw: '', place: null, loading: false, error: null });

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}ч ${m}м` : `${m} мин`;
}

// ── RoutePanel ────────────────────────────────────────────────────────────────

interface Props {
  onRouteReady: (route: PlannedRoute) => void;
  onRouteClear: () => void;
  isRunning: boolean;
  currentRoute: PlannedRoute | null;
  estimatedPrice?: number;
}

export default function RoutePanel({
  onRouteReady, onRouteClear, isRunning, currentRoute, estimatedPrice,
}: Props) {
  const [from, setFrom]       = useState<AddrState>(emptyAddr());
  const [to, setTo]           = useState<AddrState>(emptyAddr());
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [expanded, setExpanded]     = useState(true);

  // ── Geocode — accept current value directly (avoids stale closure) ────────
  const geocodeFrom = useCallback(async (value: string) => {
    const v = value.trim();
    if (!v) return;
    setFrom(s => ({ ...s, raw: v, loading: true, error: null, place: null }));
    try {
      const place = await geocodeAddress(v);
      if (!place) {
        setFrom(s => ({ ...s, loading: false, error: 'Адрес не найден — уточните запрос' }));
      } else {
        setFrom(s => ({
          ...s, loading: false, place,
          raw: place.displayName.split(',').slice(0, 3).join(', '),
        }));
      }
    } catch {
      setFrom(s => ({ ...s, loading: false, error: 'Ошибка геокодирования' }));
    }
  }, []);

  const geocodeTo = useCallback(async (value: string) => {
    const v = value.trim();
    if (!v) return;
    setTo(s => ({ ...s, raw: v, loading: true, error: null, place: null }));
    try {
      const place = await geocodeAddress(v);
      if (!place) {
        setTo(s => ({ ...s, loading: false, error: 'Адрес не найден — уточните запрос' }));
      } else {
        setTo(s => ({
          ...s, loading: false, place,
          raw: place.displayName.split(',').slice(0, 3).join(', '),
        }));
      }
    } catch {
      setTo(s => ({ ...s, loading: false, error: 'Ошибка геокодирования' }));
    }
  }, []);

  // ── Build route ───────────────────────────────────────────────────────────
  const buildRoute = useCallback(async () => {
    if (!from.place || !to.place) return;
    setRouting(true);
    setRouteError(null);
    try {
      const route = await getRoute(from.place, to.place);
      if (!route) { setRouteError('Маршрут не найден'); return; }
      route.fromName = from.place.displayName.split(',').slice(0, 2).join(', ');
      route.toName   = to.place.displayName.split(',').slice(0, 2).join(', ');
      route.toCoords = { lat: to.place.lat, lon: to.place.lon };
      onRouteReady(route);
    } catch {
      setRouteError('Ошибка построения маршрута — попробуйте ещё раз');
    } finally {
      setRouting(false);
    }
  }, [from.place, to.place, onRouteReady]);

  const clearRoute = () => {
    setFrom(emptyAddr());
    setTo(emptyAddr());
    setRouteError(null);
    onRouteClear();
  };

  const canBuild = from.place && to.place && !routing && !isRunning;

  return (
    <div className="card-neon p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="section-title">Маршрут поездки</span>
          {currentRoute && (
            <span className="text-xs px-2 py-0.5 rounded font-semibold"
              style={{ background: 'hsl(120 80% 8%)', border: '1px solid hsl(120 100% 35%)', color: 'hsl(120 100% 55%)' }}>
              ✓ Маршрут построен
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentRoute && (
            <button onClick={clearRoute} disabled={isRunning}
              className="text-xs px-2 py-0.5 rounded"
              style={{ background: 'hsl(0 80% 12%)', border: '1px solid hsl(0 100% 35%)', color: 'hsl(0 100% 55%)', cursor: isRunning ? 'not-allowed' : 'pointer' }}>
              Сбросить
            </button>
          )}
          <button onClick={() => setExpanded(v => !v)}
            className="text-xs px-2 py-0.5 rounded"
            style={{ background: 'hsl(222 47% 12%)', border: '1px solid hsl(195 100% 15%)', color: 'hsl(180 30% 55%)', cursor: 'pointer' }}>
            {expanded ? '▲ Свернуть' : '▼ Развернуть'}
          </button>
        </div>
      </div>

      {/* Route summary */}
      {currentRoute && (
        <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg text-xs"
          style={{ background: 'hsl(120 80% 5%)', border: '1px solid hsl(120 100% 20%)' }}>
          <div>
            <span style={{ color: 'hsl(180 30% 45%)' }}>По дорогам: </span>
            <span className="neon-green font-bold font-mono">
              {(currentRoute.totalDistanceM / 1000).toFixed(2)} км
            </span>
          </div>
          <div>
            <span style={{ color: 'hsl(180 30% 45%)' }}>Время: </span>
            <span className="neon-purple font-semibold">
              {formatDuration(currentRoute.totalDurationS)}
            </span>
          </div>
          {estimatedPrice !== undefined && (
            <div>
              <span style={{ color: 'hsl(180 30% 45%)' }}>Примерная цена: </span>
              <span className="neon-cyan font-bold font-mono">
                ~{estimatedPrice.toFixed(0)} ₽
              </span>
            </div>
          )}
          <div>
            <span style={{ color: 'hsl(180 30% 45%)' }}>Точек: </span>
            <span className="neon-cyan">{currentRoute.coords.length}</span>
          </div>
        </div>
      )}

      {/* Address inputs */}
      {expanded && (
        <div className="space-y-3">
          <AddrRow
            label="Откуда (подача)"
            color="hsl(120 100% 50%)"
            state={from}
            disabled={isRunning}
            onRawChange={v => setFrom(s => ({ ...s, raw: v, place: null, error: null }))}
            onFind={geocodeFrom}
          />
          <AddrRow
            label="Куда (назначение)"
            color="hsl(0 100% 60%)"
            state={to}
            disabled={isRunning}
            onRawChange={v => setTo(s => ({ ...s, raw: v, place: null, error: null }))}
            onFind={geocodeTo}
          />

          {routeError && (
            <p className="text-xs" style={{ color: 'hsl(0 100% 60%)' }}>⚠ {routeError}</p>
          )}

          <button onClick={buildRoute} disabled={!canBuild}
            className="w-full py-2.5 rounded-lg font-bold text-sm transition-all"
            style={canBuild ? {
              background: 'linear-gradient(135deg, hsl(200 80% 18%), hsl(200 80% 12%))',
              border: '1px solid hsl(200 100% 45%)',
              color: 'hsl(200 100% 70%)',
              boxShadow: '0 0 14px hsl(200 100% 45% / 0.25)',
              cursor: 'pointer',
            } : {
              background: 'hsl(222 47% 9%)',
              border: '1px solid hsl(195 100% 12%)',
              color: 'hsl(180 30% 30%)',
              cursor: 'not-allowed',
            }}>
            {routing ? '⏳ Строю маршрут…' : '🗺 Построить маршрут по дорогам'}
          </button>

          <p className="text-xs" style={{ color: 'hsl(180 30% 30%)' }}>
            Геокодинг: Nominatim (OSM) · Маршрут: OSRM · Без платных API
          </p>
        </div>
      )}
    </div>
  );
}
