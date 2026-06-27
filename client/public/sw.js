const CACHE_NAME = 'cloud-player-v1';

// Helper to retrieve the current Google Access Token statelessly from IndexedDB
function getAccessToken() {
  return new Promise((resolve) => {
    const request = indexedDB.open('CloudMusic', 2);
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('auth')) {
        resolve(null);
        return;
      }
      try {
        const transaction = db.transaction('auth', 'readonly');
        const store = transaction.objectStore('auth');
        const getReq = store.get('access_token');
        getReq.onerror = () => resolve(null);
        getReq.onsuccess = () => resolve(getReq.result || null);
      } catch (err) {
        resolve(null);
      }
    };
    request.onupgradeneeded = () => {
      request.result.createObjectStore('auth');
    };
  });
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Intercept audio streaming requests and proxy them securely to Google Drive
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept paths matching /drive-stream/<fileId>
  if (url.pathname.startsWith('/drive-stream/')) {
    const fileId = url.pathname.split('/').pop();
    if (fileId) {
      event.respondWith(handleDriveStream(event.request, fileId));
    }
  }
});

async function handleDriveStream(request, fileId) {
  try {
    const token = await getAccessToken();
    if (!token) {
      return new Response('Unauthorized: No Google access token found in IndexedDB.', {
        status: 401,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const headers = new Headers();

    // Story 1.3 AC 4: Extract and forward the browser's audio Range headers unaltered
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      headers.set('Range', rangeHeader);
    }

    // Story 1.3 AC 3: Securely attach the bearer authorization token
    headers.set('Authorization', `Bearer ${token}`);

    const response = await fetch(driveUrl, { headers });

    // Handle Google API specific error codes (pass status codes up to player context)
    if (!response.ok) {
      console.error(`Google Drive API returned error status ${response.status} for file ID ${fileId}`);
      if (response.status === 429) {
        // Broadcast rate limit hit to all frontend clients
        self.clients.matchAll().then((clients) => {
          for (const client of clients) {
            client.postMessage({ type: 'RATE_LIMIT_HIT' });
          }
        });
        return new Response('Rate Limit Exceeded', { status: 429 });
      }
      if (response.status === 401 || response.status === 403) {
        return new Response('Unauthorized Drive Access', { status: response.status });
      }
    }

    // Returns a 206 Partial Content response natively if Range was requested
    return response;
  } catch (err) {
    console.error('Service Worker secure stream fetch failed:', err);
    return new Response('Internal Stream Proxy Error', { status: 500 });
  }
}
