// Deploy version timestamp: 2026-06-28
import { useEffect, useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import { PlayerProvider } from './context/PlayerContext';
import { usePlayer } from './context/usePlayer';
import { setAuthValue } from './utils/db';
import { syncLibrary, shuffleLibrary, resolveM3UPlaylist } from './utils/library';
import type { Track } from './types';
import './App.css';

// Component to handle Google OAuth callback redirection
function OAuthCallback({ onComplete }: { onComplete: () => void }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('access_token');
    const expiresAt = params.get('expires_at');
    const session = params.get('session');

    if (accessToken && expiresAt && session) {
      const saveAndRedirect = async () => {
        try {
          await setAuthValue('access_token', accessToken);
          await setAuthValue('session', session);
          await setAuthValue('expires_at', Number(expiresAt));
          onComplete();
        } catch (err) {
          console.error('Error saving OAuth state:', err);
          setError('Failed to save authentication session.');
        }
      };
      saveAndRedirect();
    } else {
      setError('OAuth callback parameters are missing.');
    }
  }, [onComplete]);

  return (
    <div className="auth-callback-container">
      {error ? (
        <div className="error-card">
          <h2>Authentication Error</h2>
          <p>{error}</p>
          <button onClick={() => { window.location.href = '/'; }}>Return Home</button>
        </div>
      ) : (
        <div className="loading-card">
          <h2>Completing Sign-In...</h2>
          <p>Securely storing your session. You will be redirected shortly.</p>
          <div className="spinner"></div>
        </div>
      )}
    </div>
  );
}

// Format duration in minutes:seconds
function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds === Infinity) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Mock Tracks for immediate testing of audio play, seek, and gapless engine
const MOCK_TRACKS: Track[] = [
  {
    id: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    path: 'Albums/Lofi Study/01 - SoundHelix Song 1.mp3',
    title: 'SoundHelix Groove 1',
    artist: 'Helix Ambient Project',
    album: 'Lofi Study'
  },
  {
    id: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    path: 'Albums/Lofi Study/02 - SoundHelix Song 2.mp3',
    title: 'SoundHelix Groove 2',
    artist: 'Helix Ambient Project',
    album: 'Lofi Study'
  },
  {
    id: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    path: 'Albums/Lofi Study/03 - SoundHelix Song 3.mp3',
    title: 'SoundHelix Groove 3',
    artist: 'Helix Ambient Project',
    album: 'Lofi Study'
  }
];

function AppContent() {
  const { isAuthenticated, isLoading, login, logout, accessToken, authError } = useAuth();
  const {
    currentTrack,
    isPlaying,
    playbackProgress,
    duration,
    queue,
    isRateLimited,
    backoffSeconds,
    isShuffleEnabled,
    playTrack,
    togglePlay,
    playNext,
    playPrev,
    toggleShuffle,
    seekTo,
  } = usePlayer();

  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [showToken, setShowToken] = useState(false);
  const [library, setLibrary] = useState<Track[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(150);

  // Sync client router path
  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener('popstate', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);

  // Synchronize Google Cloud Storage index to IndexedDB on startup
  useEffect(() => {
    if (!isAuthenticated) return;

    const loadLibrary = async () => {
      setIsSyncing(true);
      const tracks = await syncLibrary();
      if (tracks.length > 0) {
        setLibrary(tracks);
        setVisibleCount(150);
      } else {
        // Fallback to MOCK_TRACKS if Cloud Storage is empty or hasn't crawled yet
        setLibrary(MOCK_TRACKS);
        setVisibleCount(150);
      }
      setIsSyncing(false);
    };

    loadLibrary();
  }, [isAuthenticated]);

  const handleOAuthComplete = () => {
    window.history.replaceState({}, document.title, '/');
    setCurrentPath('/');
    window.location.reload();
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Initializing Cloud Music Player...</p>
      </div>
    );
  }

  if (currentPath === '/oauth-callback') {
    return <OAuthCallback onComplete={handleOAuthComplete} />;
  }

  return (
    <div className="app-container">
      {!isAuthenticated ? (
        <div className="login-card">
          <div className="logo-section">
            <svg className="player-logo" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
            </svg>
            <h1>Cloud Music Player</h1>
            <p className="subtitle">Stream your personal FLAC & MP3 collection directly from Google Drive with perfect gapless playback.</p>
          </div>

          <button className="google-signin-btn" onClick={login}>
            <svg viewBox="0 0 48 48" width="18" height="18" style={{ marginRight: '12px' }}>
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.5 24c0-1.55-.15-3.24-.47-4.77H24v9.03h12.75c-.55 2.97-2.22 5.5-4.77 7.2l7.4 5.73C43.7 37.07 46.5 31.14 46.5 24z"/>
              <path fill="#FBBC05" d="M10.54 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.98-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.4-5.73c-2.11 1.4-4.81 2.3-8.49 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {authError ? 'Sign in again' : 'Sign in with Google'}
          </button>
          {authError && (
            <div className="auth-error-message" role="alert">
              {authError}
            </div>
          )}
        </div>
      ) : (
        <div className="player-layout">
          {/* Exponential backoff Rate-Limit Visual Banner */}
          {isRateLimited && (
            <div className="rate-limit-banner">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>Google API Rate Limit Hit. Backing off... Retry in <strong>{backoffSeconds}s</strong></span>
            </div>
          )}

          {authError && (
            <div className="auth-warning-banner" role="alert">
              <span>{authError}</span>
              <button onClick={login}>Reconnect</button>
            </div>
          )}

          {/* Header */}
          <header className="player-header">
            <div className="header-branding">
              <svg className="branding-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
              </svg>
              <h2>Cloud Player</h2>
            </div>
            <div className="header-actions">
              <button className="sm-btn" onClick={() => setShowToken(!showToken)}>
                {showToken ? 'Hide Auth' : 'Show Auth'}
              </button>
              <button className="sm-logout-btn" onClick={logout}>Sign Out</button>
            </div>
          </header>

          {/* Auth details panel (collapsible) */}
          {showToken && (
            <div className="auth-drawer animate-fade">
              <div className="detail-row">
                <span className="label">Egress Server:</span>
                <span className="value text-success">Online (Scale-to-Zero)</span>
              </div>
              <div className="detail-row">
                <span className="label">Google OAuth Token:</span>
                <input type="text" readOnly className="token-text" value={accessToken || ''} />
              </div>
            </div>
          )}

          {/* Main Dashboard Workspace */}
          <main className="player-workspace">
            <section className="library-section">
              <div className="section-title-row">
                <h3>Music Library</h3>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                   <button
                    className="sm-btn"
                    onClick={async () => {
                      setIsSyncing(true);
                      const tracks = await syncLibrary(true); // Force fetch new last-modified from GCS
                      if (tracks.length > 0) {
                        setLibrary(tracks);
                        setVisibleCount(150);
                      }
                      setIsSyncing(false);
                    }}
                    disabled={isSyncing}
                  >
                    {isSyncing ? 'Syncing...' : 'Sync Index'}
                  </button>
                  <button
                    className="sm-btn"
                    onClick={async () => {
                      const selection = await shuffleLibrary();
                      if (selection.length > 0) {
                        if (!isShuffleEnabled) toggleShuffle();
                        playTrack(selection[0], selection);
                      }
                    }}
                  >
                    Shuffle All
                  </button>
                  <label className="sm-btn" style={{ margin: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                    Import M3U
                    <input
                      type="file"
                      accept=".m3u"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        const reader = new FileReader();
                        reader.onload = async (evt) => {
                          const content = evt.target?.result as string;
                          if (!content) return;

                          const resolvedTracks = await resolveM3UPlaylist(content);
                          if (resolvedTracks.length > 0) {
                            playTrack(resolvedTracks[0], resolvedTracks);
                          } else {
                            alert('No playlist tracks could be resolved against your index.');
                          }
                        };
                        reader.readAsText(file);
                      }}
                    />
                  </label>
                  <span className="track-count">{library.length} tracks</span>
                </div>
              </div>
              <div className="track-list">
                {library.slice(0, visibleCount).map((track) => {
                  const isCurrent = currentTrack?.id === track.id;
                  return (
                    <div
                      key={track.id}
                      className={`track-item ${isCurrent ? 'active-track' : ''}`}
                      onClick={() => playTrack(track, library)}
                    >
                      <div className="track-info">
                        <div className="track-title-row">
                          {isCurrent && isPlaying && (
                            <div className="playing-bars">
                              <div className="bar"></div>
                              <div className="bar"></div>
                              <div className="bar"></div>
                            </div>
                          )}
                          <span className="track-title">{track.title}</span>
                        </div>
                        <span className="track-artist">{track.artist} • {track.album}</span>
                      </div>
                      <span className="track-duration">Demo</span>
                    </div>
                  );
                })}
                {library.length > visibleCount && (
                  <button
                    className="load-more-btn animate-fade"
                    onClick={() => setVisibleCount((prev) => prev + 150)}
                  >
                    Load More Songs ({library.length - visibleCount} remaining)
                  </button>
                )}
              </div>
            </section>

            {/* Now Playing Panel */}
            <section className="now-playing-panel">
              {currentTrack ? (
                <div className="panel-content">
                  <div className="album-art-placeholder">
                    <svg viewBox="0 0 24 24" width="80" height="80" fill="none" stroke="currentColor" strokeWidth="1" className="music-icon animate-pulse">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  </div>
                  <h3>{currentTrack.title}</h3>
                  <p>{currentTrack.artist}</p>
                  <span className="album-name">{currentTrack.album}</span>

                  <div className="queue-overview">
                    <h4>Up Next</h4>
                    <div className="queue-mini-list">
                      {queue.slice(1, 4).map((t, i) => (
                        <div key={t.id} className="queue-mini-item">
                          <span className="num">{i + 1}</span>
                          <span className="title">{t.title}</span>
                        </div>
                      ))}
                      {queue.length <= 1 && (
                        <span className="empty-queue">Queue is empty. Shuffling soon.</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="panel-empty">
                  <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1" className="music-icon">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                  <p>No track selected</p>
                  <span>Pick a song from the library list to play.</span>
                </div>
              )}
            </section>
          </main>

          {/* Persistent Bottom Audio Player Bar */}
          <footer className="persistent-player-bar">
            {/* Seeker Slider */}
            <div className="seeker-container">
              <span className="time-display">{formatTime((playbackProgress / 100) * duration)}</span>
              <input
                type="range"
                className="seeker-range"
                min="0"
                max="100"
                value={playbackProgress}
                onChange={(e) => seekTo(Number(e.target.value))}
                disabled={!currentTrack}
              />
              <span className="time-display">{formatTime(duration)}</span>
            </div>

            <div className="player-controls-row">
              {/* Left track details */}
              <div className="footer-track-details">
                {currentTrack && (
                  <>
                    <span className="footer-title">{currentTrack.title}</span>
                    <span className="footer-artist">{currentTrack.artist}</span>
                  </>
                )}
              </div>

              {/* Center controls */}
              <div className="footer-controls">
                <button className="control-btn" onClick={playPrev} disabled={!currentTrack}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <polygon points="19 20 9 12 19 4 19 20" />
                    <line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>
                <button className="play-pause-btn" onClick={togglePlay} disabled={!currentTrack}>
                  {isPlaying ? (
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                </button>
                <button className="control-btn" onClick={playNext} disabled={!currentTrack}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <polygon points="5 4 15 12 5 20 5 4" />
                    <line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>
                <button
                  className={`control-btn ${isShuffleEnabled ? 'shuffle-active' : ''}`}
                  onClick={toggleShuffle}
                  title="Toggle Shuffle"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 3 21 3 21 8" />
                    <line x1="4" y1="20" x2="21" y2="3" />
                    <polyline points="21 16 21 21 16 21" />
                    <line x1="15" y1="15" x2="21" y2="21" />
                    <line x1="4" y1="4" x2="9" y2="9" />
                  </svg>
                </button>
              </div>

              {/* Right status badge */}
              <div className="footer-engine-status">
                {currentTrack && (
                  <span className="engine-badge animate-fade">
                    Gapless Active
                  </span>
                )}
              </div>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PlayerProvider>
        <AppContent />
      </PlayerProvider>
    </AuthProvider>
  );
}
