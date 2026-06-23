# Cloud Music Player - Architectural Blueprint & Implementation Plan

## 1. Goal Statement
Build a personal cloud music player that reliably plays a ~30K-track Google Drive library (FLAC and MP3) with minimal infrastructure cost (< $10/month). The system will bypass server egress costs by streaming directly from Google Drive to the browser, using a lightweight JSON index for instant search and playlist resolution, and leveraging Service Workers to achieve true <10ms gapless playback.

## 2. Success Criteria & Constraints
- **Primary Objective:** Reliable, always-available playback from the full library.
- **Reliability SLA:** <= 1 failed track start per 100 plays (Failure = no audio within 5s).
- **Latency SLA:** Warm start <= 1s; Cold start <= 3s; Gapless transition <= 10ms.
- **Cost:** Leverage Cloud Run scale-to-zero and direct client-to-Drive streaming to minimize GCP egress costs.
- **Resilience:** Fallback to parsing file paths (`Albums/<Artist> - <Album>/<track#> - <Title>.<ext>`) if ID3 tags are missing.
- **Verification:** Manual testing log confirming latency targets on Wi-Fi and mobile data.

## 3. Architecture & Core Decisions
- **No Transcoding (Android/Chrome Only):** FLAC and MP3 files will be streamed directly in their native formats. Native browser FLAC support in Android/Chrome has superseded the need for server-side FFmpeg transcoding. (Note: iOS Safari is explicitly out of scope for v1).
- **Authentication (Server-Backed Personal OAuth):** To provide seamless, uninterrupted listening (avoiding 1-hour token expiration popups), we will use a hybrid OAuth flow. The user authorizes the app once. A Cloud Run server securely holds the Google Refresh Token and exposes a lightweight `/api/token` endpoint to vend fresh 1-hour Access Tokens to the client seamlessly in the background.
- **Direct Drive Streaming via Service Worker:** Standard `<audio>` tags cannot inject the `Authorization` headers required by Google Drive. We will use a **Service Worker Proxy** to intercept audio requests and inject OAuth tokens.
    - **Token Lifecycle:** The Service Worker will use `event.respondWith(async () => {...})` to await a synchronous-style read from IndexedDB (`DB: CloudMusic, Store: auth, Key: access_token`), eliminating race conditions.
    - **Range Headers:** The Service Worker will explicitly forward `Range: bytes=` headers to the Drive API and return `206 Partial Content` responses to ensure audio seeking works flawlessly.
- **Two-Audio-Element Engine:** To achieve gapless playback, we implement an A/B player system. Player B pre-buffers the next track. When Player A ends, Player B instantly executes `play()`.
- **Lightweight Indexing:** A Cloud Run Job will crawl a specific Drive folder (`DRIVE_ROOT_ID`) and emit a compressed JSON map (`{"Path": "FileID"}`) to Google Cloud Storage. The client performs a `HEAD` request on load, and if the `Last-Modified` header is new, downloads the JSON into `IndexedDB` for instant playlist resolution.

## 4. Tech Stack & Tooling
- **Frontend:** React 18, Vite, TypeScript.
- **Backend (Auth/Indexing):** Node.js, Express, TypeScript.
- **Hosting:** Firebase Hosting (Static Client), Google Cloud Run (Backend), Google Cloud Storage (Index JSON).
- **CI/CD:** GitHub Actions building to Google Artifact Registry.

---

## 4. Epics & User Stories

### Epic 0: Foundation & Infrastructure
*Goal: Establish the GCP environment, OAuth consent screen, and CI/CD pipelines.*

**Story 0.1: Google Cloud Project & OAuth Setup**
As a developer, I want to configure the GCP project and OAuth consent screen so users can sign in securely.
- **Acceptance Criteria:**
  1. GCP Project is created.
  2. Google Drive API is enabled in the GCP Console.
  3. OAuth Consent Screen is configured for "External" users (or Internal if using Workspace).
  4. OAuth 2.0 Client IDs (Web application) are generated.
  5. Scopes are explicitly set to `https://www.googleapis.com/auth/drive.readonly`.

**Story 0.2: CI/CD Pipeline (Deploy to Cloud Run)**
As a developer, I want my code to deploy automatically so I don't have to manually push containers.
- **Acceptance Criteria:**
  1. CI pipeline (e.g., GitHub Actions) is configured.
  2. Pushes to the main branch build the Docker container for the Node.js/Express server (used only for Indexing jobs now).
  3. The container is deployed to Google Cloud Run with the `min-instances=0` flag set.

**Story 0.3: Static Hosting Pipeline & Cloud Storage CORS**
As a developer, I want the client app deployed to a static host and my storage buckets configured for cross-origin access.
- **Acceptance Criteria:**
  1. CI pipeline builds the React/Vite app.
  2. Static assets are deployed to Firebase Hosting.
  3. A `cors.json` policy is applied to the Google Cloud Storage bucket to allow `GET` and `HEAD` requests from the Firebase Hosting origin.
  4. Environment variables (OAuth Client ID) are successfully injected into the Vite build.

---

### Epic 1: The Core Player
*Goal: Prove direct Drive-to-client streaming and gapless playback using Server-Backed OAuth.*

**Story 1.1: Server-Backed OAuth Login Flow**
As a user, I want to log in so the app can read my Drive files seamlessly without 1-hour expirations.
- **Acceptance Criteria:**
  1. UI features a "Sign in with Google" button triggering a server-side OAuth flow (authorization code).
  2. Cloud Run server exchanges the code, securely stores the Refresh Token (e.g., in Firestore or encrypted session), and returns a short-lived Access Token to the client.
  3. Client securely stores the Access Token in IndexedDB (`DB: CloudMusic, Store: auth, Key: access_token`).
  4. App silently calls `GET /api/token` to fetch a fresh access token when < 5 mins remain.
  5. UI displays appropriate error states (e.g., clear message and login prompt) on 401 Unauthorized errors.

**Story 1.2a: Core Player UI Scaffold**
As a user, I want a functional player interface with play, pause, and next controls.
- **Acceptance Criteria:**
  1. Basic React layout exists with a list view and a persistent bottom player bar.
  2. Audio Service state expects a standard `Track` object `{ id: string, path: string, artist?: string, title?: string }`.
  3. The UI implements `navigator.mediaSession` so lock-screen controls work on mobile devices.
  4. UI handles HTTP 429 (Rate Limit) errors with an exponential backoff visual indicator.

**Story 1.2b: PWA Shell & Manifest Scaffold**
As a user, I want the basic web app to install natively on my home screen.
- **Acceptance Criteria:**
  1. App initializes and registers a Service Worker.
  2. `manifest.json` is configured with a name ("Cloud Player"), theme color, and standalone display mode.
  3. Service Worker updates correctly on page refresh.

**Story 1.3: Service Worker Drive Proxy & Range Handling**
As a user, I want the Service Worker to fetch files from Google Drive securely and support seeking.
- **Acceptance Criteria:**
  1. Service Worker intercepts `/drive-stream/<fileId>` requests.
  2. SW uses `event.respondWith(async () => {...})` to await reading the Access Token from IndexedDB.
  3. SW attaches the `Authorization: Bearer <token>` header to the Drive API `alt=media` fetch.
  4. SW intercepts any `Range: bytes=` headers from the browser `<audio>` tag, passes them unaltered to Drive, and returns the `206 Partial Content` response natively.

**Story 1.4: Dual-Audio Gapless Engine**
As a user, I want the player to switch to the next track instantly without a click or pause.
- **Acceptance Criteria:**
  1. Audio Service logic manages two physical `<audio>` elements (A and B).
  2. When Player A is playing Track 1, Player B's `src` is set to `/drive-stream/<Track2_ID>`.
  3. When Player A fires the `ended` event, Player B instantly executes `play()`.
  4. Audibly gapless transition with no clicks/pops is verified via a manual listening test on a continuous mix album.

---

### Epic 2: Library Management & Playlists
*Goal: Parse 30K files instantly without hitting Drive API limits.*

**Story 2.1: Drive Indexing Cloud Run Job**
As a developer, I want a script that crawls my Drive and generates an index, bypassing standard HTTP timeouts.
- **Acceptance Criteria:**
  1. Script is executable as a standalone Google Cloud Run Job.
  2. Script requires a `DRIVE_ROOT_ID` environment variable defining the exact folder to scan.
  3. Script uses the Drive API `files.list` method to recursively find `.mp3` and `.flac` files within that specific root folder.
  4. Output is a gzipped JSON map (`{"Albums/Artist - Album/Track.mp3": "FileID"}`) uploaded to Google Cloud Storage.

**Story 2.2: Client Index Ingestion & IDB**
As a user, I want the app to load the library quickly after the first visit.
- **Acceptance Criteria:**
  1. On startup, client performs a lightweight HTTP `HEAD` request to the Cloud Storage JSON URL.
  2. Client compares the `Last-Modified` header against its local timestamp.
  3. If newer, client downloads the full JSON and saves the map into IndexedDB (using the `idb` library).
  4. Subsequent app loads read directly from IndexedDB, achieving `< 500ms` initialization time.

**Story 2.3: Metadata Parsing & Fallback**
As a user, I want to see Artist, Album, and Title even if the file lacks ID3 tags.
- **Acceptance Criteria:**
  1. Given a path string from the index (`Albums/Artist - Album/01 - Title.mp3`), extract the metadata using regex.
  2. Update the Player UI to display this parsed metadata when the song is queued or playing.

**Story 2.4: M3U Playlist Resolution**
As a user, I want to upload an `.m3u` file and have it immediately playable.
- **Acceptance Criteria:**
  1. UI provides a mechanism to load an `.m3u` file.
  2. Client matches `.m3u` paths against IndexedDB using a fuzzy match algorithm: extract the filename from the M3U path, find exact filename matches in the JSON index, and resolve conflicts by matching the parent folder name.
  3. Unmatched paths log a warning; matched IDs queue in the Audio Service.

**Story 2.5: Library Shuffle Mode**
As a user, I want to hit a button and play a random selection of my 30K songs.
- **Acceptance Criteria:**
  1. UI includes a "Shuffle All" button.
  2. Logic uses `idb` cursor to load all keys into a memory array, shuffles the array, and translates the first 50 keys to Drive IDs for the Audio Service queue.