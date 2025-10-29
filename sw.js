/* sw.js - service worker for syncing queued positions to Firebase Realtime DB via REST
   Place alongside index.html and register it from the page.
   NOTE: For this to reliably work you should serve the site over HTTPS and configure DB rules
*/

const DB_URL = 'https://system-gps-ccn-default-rtdb.firebaseio.com'; // your realtime database REST base
const QUEUE_CACHE = 'gps-queue-v1';

self.addEventListener('install', event=>{
  self.skipWaiting();
});

self.addEventListener('activate', event=>{
  event.waitUntil(self.clients.claim());
});

// Hold a queue in memory (populated via postMessage)
let queuedPositions = [];

// Message channel: client will post queued positions when it stores them
self.addEventListener('message', event=>{
  const data = event.data || {};
  if(data.type === 'NEW_POSITIONS' && Array.isArray(data.positions)){
    queuedPositions = queuedPositions.concat(data.positions);
    // try immediate flush
    event.waitUntil(flushQueue());
  } else if(data.type === 'SYNC_NOW'){
    event.waitUntil(flushQueue());
  }
});

// Try to send queued positions to Firebase Realtime DB via REST.
// Structure: send to /ubicaciones/<deviceId>/<date>/<ts>.json using PUT to set that child.
// This requires the DB to accept writes unauthenticated or an auth token appended to URL (?auth=...).
async function flushQueue(){
  if(!queuedPositions.length) return;
  const sends = [];
  while(queuedPositions.length){
    const p = queuedPositions.shift();
    // p expected: { deviceId, date, key, lat, lon, ts }
    try {
      const path = `/ubicaciones/${encodeURIComponent(p.deviceId)}/${encodeURIComponent(p.date)}/${encodeURIComponent(p.key)}.json`;
      const url = DB_URL + path;
      const body = JSON.stringify({ lat: p.lat, lon: p.lon, ts: p.ts });
      // send with fetch
      sends.push(fetch(url, { method:'PUT', body, headers:{ 'Content-Type':'application/json' } }).then(r=> {
        if(!r.ok) {
          // requeue on failure
          queuedPositions.unshift(p);
        }
      }).catch(err=>{
        // on network error requeue
        queuedPositions.unshift(p);
      }));
    } catch(e){
      // malformed, skip
    }
    // break if browser goes offline
    if(!self.navigator.onLine) break;
  }
  try { await Promise.all(sends); } catch(e){}
}

// Background sync event (if registered)
self.addEventListener('sync', event=>{
  if(event.tag === 'sync-positions'){
    event.waitUntil(flushQueue());
  }
});

// Periodic sync (if supported)
self.addEventListener('periodicsync', event=>{
  if(event.tag === 'periodic-sync-positions'){
    event.waitUntil(flushQueue());
  }
});

// fetch fallback (not used but keep)
self.addEventListener('fetch', function(e){ /* noop */ });
