/*
* Service worker for the installable, offline-capable Academy. Only registered when $PWA_ENABLED is on (config.php).
*
* Updates matter more than offline: a worker that keeps serving last version's scripts after an upload is worse than
* none. So:
*   - The worker is registered at service-worker.js?v=<site version>. A new site version is a new worker, which installs,
*     takes over at once (skipWaiting + clients.claim), and deletes every cache that isn't its own.
*   - Pages are network-first. The cached copy is only used when the network fails or is slow.
*   - Versioned files (?v=...) are cache-first, which is safe because a new version changes their URL.
*   - Everything else passes through untouched: other methods (including the HEAD probes the Academy menu makes),
*     cross-origin requests, and the Train mode's PHP data endpoints.
*
* Offline works for the Academy and for whatever else was opened while online. Train and Battle need more data than
* is cached, and ranking files are only cached once a format has been opened.
*/

var VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
var ASSET_CACHE = 'assets-' + VERSION;
var PAGE_CACHE = 'pages-' + VERSION;
var MAX_PAGES = 40;
var SLOW_NETWORK_MS = 4000;

self.addEventListener('install', function () {
	self.skipWaiting();
});

self.addEventListener('activate', function (event) {
	event.waitUntil(
		caches.keys().then(function (names) {
			return Promise.all(names.filter(function (n) { return n !== ASSET_CACHE && n !== PAGE_CACHE; }).map(function (n) { return caches.delete(n); }));
		}).then(function () {
			return self.clients.claim();
		})
	);
});

function trim(cache) {
	return cache.keys().then(function (keys) {
		if (keys.length <= MAX_PAGES) {
			return null;
		}

		return Promise.all(keys.slice(0, keys.length - MAX_PAGES).map(function (k) { return cache.delete(k); }));
	});
}

function offlinePage() {
	return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title>' +
		'<body style="font-family:sans-serif;padding:24px;line-height:1.5"><h1>You are offline</h1><p>This page has not been saved on this device yet. Open it once while online and it will be available next time.</p>',
		{ status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Network first; fall back to the saved copy when the network fails or is slow
function pageStrategy(request) {
	return caches.open(PAGE_CACHE).then(function (cache) {
		var network = fetch(request).then(function (response) {
			if (response && response.ok) {
				cache.put(request, response.clone()).then(function () { return trim(cache); });
			}

			return response;
		});

		return cache.match(request).then(function (saved) {
			if (!saved) {
				return network.catch(offlinePage);
			}

			var slow = new Promise(function (resolve) { setTimeout(function () { resolve(saved); }, SLOW_NETWORK_MS); });

			return Promise.race([network.catch(function () { return saved; }), slow]);
		});
	});
}

// Versioned files never change under the same URL
function cacheFirst(request) {
	return caches.open(ASSET_CACHE).then(function (cache) {
		return cache.match(request).then(function (saved) {
			if (saved) {
				return saved;
			}

			return fetch(request).then(function (response) {
				if (response && response.ok) {
					cache.put(request, response.clone());
				}

				return response;
			});
		});
	});
}

// Images and fonts carry no version: show the saved copy and refresh it in the background
function staleWhileRevalidate(request) {
	return caches.open(ASSET_CACHE).then(function (cache) {
		return cache.match(request).then(function (saved) {
			var refresh = fetch(request).then(function (response) {
				if (response && response.ok) {
					cache.put(request, response.clone());
				}

				return response;
			});

			return saved || refresh;
		});
	});
}

self.addEventListener('fetch', function (event) {
	var request = event.request;
	var url = new URL(request.url);

	if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('range')) {
		return;
	}

	// The Train mode's database endpoints and any other PHP data endpoint are always live
	if (/\/data\/.*\.php$/.test(url.pathname)) {
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(pageStrategy(request));
	} else if (url.searchParams.has('v') || /\/js\/libs\//.test(url.pathname)) {
		event.respondWith(cacheFirst(request));
	} else if (request.destination === 'image' || request.destination === 'font') {
		event.respondWith(staleWhileRevalidate(request));
	}
});
