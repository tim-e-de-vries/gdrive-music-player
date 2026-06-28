import type { Track } from '../types';
import { getMetaValue, setMetaValue, clearTracksStore, bulkSaveTracks, getAllTracks } from './db';

if (import.meta.env.PROD && !import.meta.env.VITE_GCS_INDEX_URL) {
  throw new Error('VITE_GCS_INDEX_URL must be configured for production builds.');
}

const GCS_INDEX_URL = import.meta.env.VITE_GCS_INDEX_URL || 'https://storage.googleapis.com/gdrive-music-player-bucket/index.json';

/**
 * Story 2.3 AC 1 & 2: Parse Google Drive track paths into structured metadata Track objects
 */
export function parsePathToTrack(path: string, id: string): Track {
  const parts = path.split('/');
  const fileNameWithExt = parts[parts.length - 1];
  const fileName = fileNameWithExt.replace(/\.[^/.]+$/, ""); // strip extension (e.g., .mp3, .flac)

  let title = fileName;
  let artist = 'Unknown Artist';
  let album = 'Unknown Album';

  // Format: "Albums/Artist - Album/01 - Title.mp3"
  if (parts.length >= 3) {
    const parentFolder = parts[parts.length - 2]; // "Artist - Album"
    const folderParts = parentFolder.split(' - ');

    if (folderParts.length >= 2) {
      artist = folderParts[0].trim();
      album = folderParts.slice(1).join(' - ').trim();
    } else {
      album = parentFolder.trim();
    }

    // Strip track numbers from start of filename: e.g. "01 - TrackName" -> "TrackName"
    const trackNumMatch = fileName.match(/^\d+[\s._-]*(.+)$/);
    if (trackNumMatch) {
      title = trackNumMatch[1].trim();
    }
  }
  // Format: "Artist/Album/01 Title.mp3"
  else if (parts.length === 2) {
    artist = parts[0].trim();
    title = fileName.trim();
  }

  return {
    id,
    path,
    title,
    artist,
    album,
  };
}

/**
 * Story 2.2 AC 1-4: Performs lightweight GCS checks and synchronizes the library in under <500ms
 */
export async function syncLibrary(forceRefresh = false): Promise<Track[]> {
  try {
    console.log('Checking for library updates on Google Cloud Storage...');

    // Story 2.2 AC 1: Perform lightweight HTTP HEAD request to fetch last-modified headers
    const headResponse = await fetch(GCS_INDEX_URL, { method: 'HEAD' });
    const remoteLastModified = headResponse.headers.get('Last-Modified');
    const cachedLastModified = await getMetaValue<string>('last_modified');

    // If cache matches and we aren't forcing, load directly from local IndexedDB
    if (!forceRefresh && remoteLastModified && cachedLastModified === remoteLastModified) {
      console.log('Local library index is up-to-date. Ingesting from IndexedDB...');
      const cachedTracks = await getAllTracks();
      if (cachedTracks.length > 0) {
        return cachedTracks.map((t) => parsePathToTrack(t.path, t.id));
      }
    }

    // Story 2.2 AC 3: If remote is newer, download full gzipped index and sync to DB
    console.log('Library update found. Fetching full index from Cloud Storage...');
    const indexResponse = await fetch(GCS_INDEX_URL);
    if (!indexResponse.ok) {
      throw new Error(`Failed to fetch index.json from GCS. Status: ${indexResponse.status}`);
    }

    const indexMap: Record<string, string> = await indexResponse.json();
    console.log(`Downloaded ${Object.keys(indexMap).length} track definitions. Saving to IndexedDB...`);

    // Save index map to tracks store
    await clearTracksStore();
    await bulkSaveTracks(indexMap);

    if (remoteLastModified) {
      await setMetaValue('last_modified', remoteLastModified);
    }

    // Map and return parsed tracks
    return Object.entries(indexMap).map(([path, id]) => parsePathToTrack(path, id));
  } catch (err) {
    console.error('Failed to sync library with Cloud Storage:', err);
    // Fallback load whatever is left in local database
    const cachedTracks = await getAllTracks();
    return cachedTracks.map((t) => parsePathToTrack(t.path, t.id));
  }
}

/**
 * Story 2.5 AC 2: Loads all keys using IDB cursor, shuffles them, and translates the first 50 keys to Track queue
 */
export async function shuffleLibrary(): Promise<Track[]> {
  const cachedTracks = await getAllTracks();
  if (cachedTracks.length === 0) return [];

  // Shuffle the local tracks using Fisher-Yates algorithm
  const shuffled = [...cachedTracks];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Translate the full shuffled list to Track objects with parsed metadata fallback
  return shuffled.map((t) => parsePathToTrack(t.path, t.id));
}

/**
 * Story 2.4 AC 2: Matches .m3u paths against IndexedDB using a parent/filename conflict resolver
 */
export async function resolveM3UPlaylist(m3uContent: string): Promise<Track[]> {
  const lines = m3uContent.split(/\r?\n/);
  const m3uPaths: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (trimmed && !trimmed.startsWith('#')) {
      m3uPaths.push(trimmed);
    }
  }

  const cachedTracks = await getAllTracks();
  if (cachedTracks.length === 0) {
    console.warn('Cannot resolve playlist: local library index is empty.');
    return [];
  }

  // Pre-index local tracks by filename to achieve O(1) matching speed
  const filenameMap = new Map<string, { path: string; id: string }[]>();
  for (const track of cachedTracks) {
    const parts = track.path.split('/');
    const filename = parts[parts.length - 1].toLowerCase();

    if (!filenameMap.has(filename)) {
      filenameMap.set(filename, []);
    }
    filenameMap.get(filename)!.push(track);
  }

  const resolvedTracks: Track[] = [];

  for (const m3uPath of m3uPaths) {
    // Extract filename from M3U path: e.g. "C:\Music\Artist\01 - Title.mp3" -> "01 - title.mp3"
    const m3uParts = m3uPath.split(/[/\\]/);
    const m3uFilename = m3uParts[m3uParts.length - 1].toLowerCase();

    const matches = filenameMap.get(m3uFilename);
    if (!matches || matches.length === 0) {
      console.warn(`M3U Resolution Warning: Unmatched playlist path: "${m3uPath}"`);
      continue;
    }

    if (matches.length === 1) {
      resolvedTracks.push(parsePathToTrack(matches[0].path, matches[0].id));
      continue;
    }

    // Resolve conflicts by matching parent folder name
    const m3uParent = m3uParts.length >= 2 ? m3uParts[m3uParts.length - 2].toLowerCase() : '';
    let bestMatch = matches[0];

    for (const match of matches) {
      const matchParts = match.path.split('/');
      const matchParent = matchParts.length >= 2 ? matchParts[matchParts.length - 2].toLowerCase() : '';

      if (m3uParent && matchParent.includes(m3uParent)) {
        bestMatch = match;
        break;
      }
    }

    resolvedTracks.push(parsePathToTrack(bestMatch.path, bestMatch.id));
  }

  return resolvedTracks;
}
