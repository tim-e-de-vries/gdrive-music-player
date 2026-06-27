const DB_NAME = 'CloudMusic';
const STORE_NAME = 'auth';
const DB_VERSION = 2; // Upgraded version to trigger schema migration

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains('tracks')) {
        db.createObjectStore('tracks'); // Store: { key: path_string, value: drive_file_id }
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta'); // Store metadata like 'last_modified_timestamp'
      }
    };
  });
}

export async function getAuthValue<T = any>(key: string): Promise<T | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result !== undefined ? request.result : null);
    });
  } catch (error) {
    console.error('Failed to get value from IndexedDB:', error);
    return null;
  }
}

export async function setAuthValue(key: string, value: any): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('Failed to set value in IndexedDB:', error);
  }
}

export async function deleteAuthValue(key: string): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('Failed to delete value from IndexedDB:', error);
  }
}

// Bulk store operations for fast index ingestion
export async function clearTracksStore(): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('tracks', 'readwrite');
      const store = transaction.objectStore('tracks');
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('Failed to clear tracks object store:', error);
  }
}

export async function bulkSaveTracks(tracks: Record<string, string>): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      // Execute all puts in a single readwrite transaction (extremely fast <150ms)
      const transaction = db.transaction('tracks', 'readwrite');
      const store = transaction.objectStore('tracks');

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const [path, id] of Object.entries(tracks)) {
        store.put(id, path);
      }
    });
  } catch (error) {
    console.error('Failed to save bulk tracks in IndexedDB:', error);
  }
}

export async function getAllTracks(): Promise<{ path: string; id: string }[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('tracks', 'readonly');
      const store = transaction.objectStore('tracks');
      const request = store.openCursor();
      const results: { path: string; id: string }[] = [];

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          results.push({
            path: cursor.key as string,
            id: cursor.value as string,
          });
          cursor.continue();
        } else {
          resolve(results);
        }
      };
    });
  } catch (error) {
    console.error('Failed to fetch all tracks from IndexedDB:', error);
    return [];
  }
}

// Meta Store helpers (to track last-modified timestamps)
export async function getMetaValue<T = any>(key: string): Promise<T | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('meta', 'readonly');
      const store = transaction.objectStore('meta');
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result !== undefined ? request.result : null);
    });
  } catch (error) {
    console.error('Failed to get meta value from IndexedDB:', error);
    return null;
  }
}

export async function setMetaValue(key: string, value: any): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('meta', 'readwrite');
      const store = transaction.objectStore('meta');
      const request = store.put(value, key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('Failed to set meta value in IndexedDB:', error);
  }
}
