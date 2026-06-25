/**
 * Service Worker — кэширует тайлы OpenStreetMap для работы офлайн.
 * Стратегия: Cache-First для тайлов (они редко меняются).
 * Все остальные запросы — сквозной проход.
 */

const CACHE_NAME = 'taximeter-osm-tiles-v1';

const OSM_HOSTNAMES = [
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
  'router.project-osrm.org',
  'nominatim.openstreetmap.org',
];

function isOsmRequest(url) {
  try {
    const u = new URL(url);
    return OSM_HOSTNAMES.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Clean up old caches
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  if (!isOsmRequest(url)) return; // let non-OSM requests pass through normally

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        if (cached) return cached; // serve from cache

        // Not cached: fetch, store, return
        return fetch(event.request, { credentials: 'omit' }).then(response => {
          // Only cache successful GET responses
          if (event.request.method === 'GET' && response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(() => cached); // if network fails and we have stale cache, use it
      })
    )
  );
});
