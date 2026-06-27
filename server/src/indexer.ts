import { google } from 'googleapis';
import { Storage } from '@google-cloud/storage';
import * as zlib from 'zlib';
import * as dotenv from 'dotenv';

// Load environment variables for local testing
dotenv.config();

const rootFolderId = process.env.DRIVE_ROOT_ID;
const bucketName = process.env.GCS_BUCKET_NAME;

if (!rootFolderId) {
  console.error('Error: DRIVE_ROOT_ID environment variable is required.');
  process.exit(1);
}

if (!bucketName) {
  console.error('Error: GCS_BUCKET_NAME environment variable is required.');
  process.exit(1);
}

// Authenticate via Application Default Credentials (ADC) automatically inside Google Cloud
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const drive = google.drive({ version: 'v3', auth });
const storage = new Storage();

interface DriveFolder {
  name: string;
  parentId: string | null;
}

interface DriveAudioFile {
  id: string;
  name: string;
  parentId: string | null;
}

async function listAllFilesAndFolders() {
  const foldersMap = new Map<string, DriveFolder>();
  const audioFiles: DriveAudioFile[] = [];

  console.log(`Starting high-performance, strictly-scoped Google Drive index crawl under root ID: ${rootFolderId}...`);

  // Step 1: Scan folders recursively starting from DRIVE_ROOT_ID (Story 2.1 AC 2)
  const foldersToScan: string[] = [rootFolderId!];
  
  while (foldersToScan.length > 0) {
    // Process parent folders in chunks of 20 to optimize API speed and keep query length safe
    const chunk = foldersToScan.splice(0, 20);
    const parentQuery = chunk.map(id => `'${id}' in parents`).join(' or ');
    const q = `(${parentQuery}) and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

    let pageToken: string | undefined = undefined;
    do {
      const { data } = (await drive.files.list({
        q,
        fields: 'nextPageToken, files(id, name, parents)',
        pageSize: 1000,
        pageToken,
      })) as any;

      const files = data.files || [];
      for (const f of files) {
        if (f.id && f.name) {
          const parentId = f.parents && f.parents.length > 0 ? f.parents[0] : null;
          foldersMap.set(f.id, { name: f.name, parentId });
          foldersToScan.push(f.id); // Queue subfolder for recursive scanning
        }
      }
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
  }

  const allScopedFolderIds = [rootFolderId!, ...Array.from(foldersMap.keys())];
  console.log(`Successfully mapped ${foldersMap.size} folders strictly inside the designated root. Fetching audio files...`);

  // Step 2: Query audio files strictly mapped to our scoped folders in chunks of 20
  const foldersQueryQueue = [...allScopedFolderIds];
  while (foldersQueryQueue.length > 0) {
    const chunk = foldersQueryQueue.splice(0, 20);
    const parentQuery = chunk.map(id => `'${id}' in parents`).join(' or ');
    const q = `(${parentQuery}) and (mimeType = 'audio/mpeg' or mimeType = 'audio/mp3' or mimeType = 'audio/flac' or mimeType = 'audio/x-flac') and trashed = false`;

    let pageToken: string | undefined = undefined;
    do {
      const { data } = (await drive.files.list({
        q,
        fields: 'nextPageToken, files(id, name, parents)',
        pageSize: 1000,
        pageToken,
      })) as any;

      const files = data.files || [];
      for (const f of files) {
        if (f.id && f.name) {
          const parentId = f.parents && f.parents.length > 0 ? f.parents[0] : null;
          audioFiles.push({ id: f.id, name: f.name, parentId });
        }
      }
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
  }

  console.log(`Found ${audioFiles.length} audio files within the target root hierarchy. Reconstructing relative paths...`);

  // 3. Resolve paths relative to target root folder
  const indexMap: Record<string, string> = {};

  for (const file of audioFiles) {
    const pathParts: string[] = [file.name];
    let currentParentId = file.parentId;
    let isUnderRoot = false;

    while (currentParentId) {
      if (currentParentId === rootFolderId) {
        isUnderRoot = true;
        break;
      }

      const parentFolder = foldersMap.get(currentParentId);
      if (!parentFolder) {
        break;
      }

      pathParts.unshift(parentFolder.name);
      currentParentId = parentFolder.parentId;
    }

    if (isUnderRoot) {
      const relativePath = pathParts.join('/');
      indexMap[relativePath] = file.id;
    }
  }

  console.log(`Reconstruction complete. Indexed ${Object.keys(indexMap).length} tracks under designated root.`);
  return indexMap;
}

async function run() {
  try {
    const indexMap = await listAllFilesAndFolders();
    const jsonString = JSON.stringify(indexMap);
    const jsonBuffer = Buffer.from(jsonString, 'utf8');

    console.log('Compressing index with GZIP...');
    const gzippedBuffer = zlib.gzipSync(jsonBuffer);

    console.log(`Uploading index to GCS Bucket: gs://${bucketName!}/index.json ...`);
    const file = storage.bucket(bucketName!).file('index.json');

    await file.save(gzippedBuffer, {
      metadata: {
        contentType: 'application/json',
        contentEncoding: 'gzip',
        cacheControl: 'no-cache, no-store, must-revalidate',
      },
    });

    console.log('Drive index compilation complete! Uploaded to Google Cloud Storage successfully.');
  } catch (err) {
    console.error('Indexer job failed:', err);
    process.exit(1);
  }
}

run();
