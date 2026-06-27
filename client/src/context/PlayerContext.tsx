import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { Track } from '../types';

interface PlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  playbackProgress: number;
  duration: number;
  queue: Track[];
  currentIndex: number;
  isRateLimited: boolean;
  backoffSeconds: number;
  isShuffleEnabled: boolean;
  playTrack: (track: Track, newQueue?: Track[]) => void;
  togglePlay: () => void;
  playNext: () => void;
  playPrev: () => void;
  toggleShuffle: () => void;
  seekTo: (percentage: number) => void;
  addToQueue: (track: Track) => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackProgress, setPlaybackProgress] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isShuffleEnabled, setIsShuffleEnabled] = useState<boolean>(false);

  const fullLibraryRef = useRef<Track[]>([]);

  // 429 Rate Limit exponential backoff state
  const [isRateLimited, setIsRateLimited] = useState<boolean>(false);
  const [backoffSeconds, setBackoffSeconds] = useState<number>(0);
  const backoffCountRef = useRef<number>(0);

  // A/B Audio Elements for Gapless Playback
  const audioRefA = useRef<HTMLAudioElement | null>(null);
  const audioRefB = useRef<HTMLAudioElement | null>(null);
  const activePlayerRef = useRef<'A' | 'B'>('A');

  const currentTrack = currentIndex >= 0 && currentIndex < fullLibraryRef.current.length ? fullLibraryRef.current[currentIndex] : null;

  // Initialize Audio Elements
  useEffect(() => {
    const audioA = new Audio();
    const audioB = new Audio();

    audioRefA.current = audioA;
    audioRefB.current = audioB;

    return () => {
      audioA.pause();
      audioB.pause();
      audioRefA.current = null;
      audioRefB.current = null;
    };
  }, []);

  // Sync state transitions and progress
  useEffect(() => {
    const activeAudio = activePlayerRef.current === 'A' ? audioRefA.current : audioRefB.current;
    if (!activeAudio) return;

    const handleTimeUpdate = () => {
      if (activeAudio.duration) {
        setPlaybackProgress((activeAudio.currentTime / activeAudio.duration) * 100);
      }
    };

    const handleDurationChange = () => {
      setDuration(activeAudio.duration || 0);
    };

    const handleEnded = () => {
      playNext();
    };

    const handleError = (e: ErrorEvent | Event) => {
      const target = e.target as HTMLAudioElement;
      console.warn('Audio playback error occurred:', target.error);
      // Only trigger rate-limit if target.src explicitly reports 429
      if (target.src.includes('429')) {
        handleRateLimit();
      }
    };

    activeAudio.addEventListener('timeupdate', handleTimeUpdate);
    activeAudio.addEventListener('durationchange', handleDurationChange);
    activeAudio.addEventListener('ended', handleEnded);
    activeAudio.addEventListener('error', handleError);

    return () => {
      activeAudio.removeEventListener('timeupdate', handleTimeUpdate);
      activeAudio.removeEventListener('durationchange', handleDurationChange);
      activeAudio.removeEventListener('ended', handleEnded);
      activeAudio.removeEventListener('error', handleError);
    };
  }, [currentIndex, queue]);

  // MediaSession metadata integration
  useEffect(() => {
    if (currentTrack && 'mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || 'Unknown Title',
        artist: currentTrack.artist || 'Unknown Artist',
        album: currentTrack.album || 'Cloud Music Player',
        artwork: [
          { src: '/favicon.svg', sizes: '512x512', type: 'image/svg+xml' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => togglePlay());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
    }
  }, [currentTrack]);

  // Pre-buffer next track on Player B when Player A is active (Story 1.4 Gapless Preview)
  useEffect(() => {
    if (currentIndex >= 0 && currentIndex < queue.length - 1) {
      const nextTrack = queue[currentIndex + 1];
      const inactiveAudio = activePlayerRef.current === 'A' ? audioRefB.current : audioRefA.current;
      if (inactiveAudio) {
        // Prepare/preload the next track using Service Worker routing path
        inactiveAudio.src = nextTrack.id.startsWith('http') ? nextTrack.id : `/drive-stream/${nextTrack.id}`;
        inactiveAudio.load();
      }
    }
  }, [currentIndex, queue]);

  // Handle HTTP 429 Rate Limit simulation with Exponential Backoff
  const handleRateLimit = () => {
    setIsPlaying(false);
    setIsRateLimited(true);
    
    // Exponential backoff calculation: 2^count * 5 seconds
    const count = backoffCountRef.current;
    const delay = Math.min(60, Math.pow(2, count) * 5);
    setBackoffSeconds(delay);
    backoffCountRef.current += 1;

    const interval = setInterval(() => {
      setBackoffSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsRateLimited(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const playTrack = (track: Track, newQueue?: Track[]) => {
    const currentQueue = newQueue || fullLibraryRef.current;
    if (newQueue) {
      fullLibraryRef.current = newQueue;
    }

    const index = currentQueue.findIndex((t) => t.id === track.id);
    if (index === -1) {
      const updatedQueue = [...currentQueue, track];
      fullLibraryRef.current = updatedQueue;
      setCurrentIndex(updatedQueue.length - 1);
    } else {
      setCurrentIndex(index);
    }

    setIsPlaying(true);
    setPlaybackProgress(0);

    // Keep the reactive queue state small and high-performance
    const start = Math.max(0, index);
    setQueue(currentQueue.slice(start, start + 50));

    // Load active source
    const activeAudio = activePlayerRef.current === 'A' ? audioRefA.current : audioRefB.current;
    if (activeAudio) {
      activeAudio.src = track.id.startsWith('http') ? track.id : `/drive-stream/${track.id}`;
      activeAudio.play()
        .then(() => {
          // Reset rate limiting counts on successful play
          backoffCountRef.current = 0;
          setIsRateLimited(false);
        })
        .catch((err) => {
          console.warn('Audio play failed or was interrupted:', err);
          setIsPlaying(false);
        });
    }
  };

  const togglePlay = () => {
    const activeAudio = activePlayerRef.current === 'A' ? audioRefA.current : audioRefB.current;
    if (!activeAudio || !currentTrack) return;

    if (isPlaying) {
      activeAudio.pause();
      setIsPlaying(false);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    } else {
      activeAudio.play()
        .then(() => {
          setIsPlaying(true);
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
        })
        .catch((err) => {
          console.warn('Audio play toggle failed or was interrupted:', err);
          setIsPlaying(false);
        });
    }
  };

  const toggleShuffle = () => {
    setIsShuffleEnabled((prev) => !prev);
  };

  const playNext = () => {
    const currentQueue = fullLibraryRef.current.length > 0 ? fullLibraryRef.current : queue;
    if (currentQueue.length === 0) return;

    let nextIndex = currentIndex + 1;
    if (isShuffleEnabled) {
      // Pick a completely random index from the entire library
      nextIndex = Math.floor(Math.random() * currentQueue.length);
    }

    if (nextIndex >= 0 && nextIndex < currentQueue.length) {
      // Swap active audio element A/B
      const prevAudio = activePlayerRef.current === 'A' ? audioRefA.current : audioRefB.current;
      const nextAudio = activePlayerRef.current === 'A' ? audioRefB.current : audioRefA.current;

      if (prevAudio) {
        prevAudio.pause();
        prevAudio.currentTime = 0;
      }

      activePlayerRef.current = activePlayerRef.current === 'A' ? 'B' : 'A';
      setCurrentIndex(nextIndex);
      setIsPlaying(true);

      const nextTrack = currentQueue[nextIndex];
      if (nextAudio && nextAudio.src) {
        nextAudio.play()
          .then(() => {
            backoffCountRef.current = 0;
            setIsRateLimited(false);
          })
          .catch((err) => {
            console.error('Gapless play failed, fallback standard loading:', err);
            playTrack(nextTrack);
          });
      } else {
        playTrack(nextTrack);
      }
    } else {
      setIsPlaying(false);
      setPlaybackProgress(100);
    }
  };

  const playPrev = () => {
    const currentQueue = fullLibraryRef.current.length > 0 ? fullLibraryRef.current : queue;
    if (currentQueue.length === 0) return;

    let prevIndex = currentIndex - 1;
    if (isShuffleEnabled) {
      prevIndex = Math.floor(Math.random() * currentQueue.length);
    }

    if (prevIndex >= 0 && prevIndex < currentQueue.length) {
      const activeAudio = activePlayerRef.current === 'A' ? audioRefA.current : audioRefB.current;
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      }
      setCurrentIndex(prevIndex);
      const prevTrack = currentQueue[prevIndex];
      playTrack(prevTrack);
    }
  };

  // Sync lightweight sliding queue window when index changes
  useEffect(() => {
    const lib = fullLibraryRef.current;
    if (lib.length === 0) return;
    const start = Math.max(0, currentIndex);
    setQueue(lib.slice(start, start + 50));
  }, [currentIndex]);

  const seekTo = (percentage: number) => {
    const activeAudio = activePlayerRef.current === 'A' ? audioRefA.current : audioRefB.current;
    if (!activeAudio || !activeAudio.duration) return;

    const targetTime = (percentage / 100) * activeAudio.duration;
    activeAudio.currentTime = targetTime;
    setPlaybackProgress(percentage);
  };

  const addToQueue = (track: Track) => {
    setQueue((prev) => [...prev, track]);
    if (currentIndex === -1) {
      setCurrentIndex(0);
    }
  };

  // Listen to secure postMessages from the Service Worker (e.g. for real 429 events)
  useEffect(() => {
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'RATE_LIMIT_HIT') {
        handleRateLimit();
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      }
    };
  }, []);

  return (
    <PlayerContext.Provider
      value={{
        currentTrack,
        isPlaying,
        playbackProgress,
        duration,
        queue,
        currentIndex,
        isRateLimited,
        backoffSeconds,
        isShuffleEnabled,
        playTrack,
        togglePlay,
        playNext,
        playPrev,
        toggleShuffle,
        seekTo,
        addToQueue,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
};
