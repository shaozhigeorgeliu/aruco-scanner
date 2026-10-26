const CACHE = 'aruco-scanner-v1';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'detector.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png',
  'lib/cv.js', 'lib/aruco.js',
  ...['aruco_4x4_1000', 'aruco_5x5_1000', 'aruco_6x6_1000', 'aruco_7x7_1000', 'aruco_default_opencv', 'aruco_default',
      'aruco_mip_16h3', 'aruco_mip_25h7', 'aruco_mip_36h12', 'apriltag_16h5', 'apriltag_25h7', 'apriltag_25h9',
      'apriltag_36h9', 'apriltag_36h10', 'apriltag_36h11', 'artag', 'artoolkitplus', 'artoolkitplusbch'].map(n => `lib/dict/${n}.js`)
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// network-first so updates show up when online, cache fallback for offline use
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
