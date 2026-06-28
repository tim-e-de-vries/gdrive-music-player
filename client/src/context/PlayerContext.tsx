import React, { useCallback, useState, useEffect, useRef } from 'react';
import { PlayerContext } from './PlayerContextCore';
import type { Track } from '../types';

const getTrackSource = (track: Track) => track.id.startsWith('http') ? track.id : `/drive-stream/${track.id}`;

const resolveAudioSource = (src: string) => new URL(src, window.location.href).href;

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

  // Handle HTTP 429 Rate Limit simulation with Exponential Backoff
  const handleRateLimit = useCallback(() => {
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
  }, []);

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

  // Pre-buffer next track on Player B when Player A is active (Story 1.4 Gapless Preview)
  useEffect(() => {
    const currentQueue = fullLibraryRef.current.length > 0 ? fullLibraryRef.current : queue;
    if (currentIndex >= 0 && currentIndex < currentQueue.length - 1) {
      const nextTrack = currentQueue[currentIndex + 1];
      const inactiveAudio = activePlayerRef.current === 'A' ? audioRefB.current : audioRefA.current;
      if (inactiveAudio) {
        // Prepare/preload the next track using Service Worker routing path
        inactiveAudio.src = getTrackSource(nextTrack);
        inactiveAudio.load();
      }
    }
  }, [currentIndex, queue]);

  const playTrack = useCallback((track: Track, newQueue?: Track[]) => {
    let currentQueue = newQueue || fullLibraryRef.current;
    if (newQueue) {
      fullLibraryRef.current = newQueue;
    }

    let index = currentQueue.findIndex((t) => t.id === track.id);
    if (index === -1) {
      const updatedQueue = [...currentQueue, track];
      fullLibraryRef.current = updatedQueue;
      currentQueue = updatedQueue;
      index = updatedQueue.length - 1;
    } else {
      fullLibraryRef.current = currentQueue;
    }

    setCurrentIndex(index);

    setIsPlaying(true);
    setPlaybackProgress(0);

    // Keep the reactive queue state small and high-performance
    const start = Math.max(0, index);
    setQueue(currentQueue.slice(start, start + 50));

    // Load active source
    const activeAudio = activePlayerRef.current === 'A' ? audioRefA.current : audioRefB.current;
    if (activeAudio) {
      activeAudio.src = getTrackSource(track);
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
  }, []);

  const togglePlay = useCallback(() => {
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
  }, [currentTrack, isPlaying]);

  const toggleShuffle = useCallback(() => {
    setIsShuffleEnabled((prev) => {
      const willEnable = !prev;
      if (willEnable && fullLibraryRef.current.length > 0) {
        // Shuffle the remaining tracks in the queue
        const lib = [...fullLibraryRef.current];
        const startIdx = Math.max(0, currentIndex + 1);
        const remaining = lib.slice(startIdx);
        for (let i = remaining.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }
        fullLibraryRef.current = [...lib.slice(0, startIdx), ...remaining];
        
        // Update the reactive queue
        const start = Math.max(0, currentIndex);
        setQueue(fullLibraryRef.current.slice(start, start + 50));
      }
      return willEnable;
    });
  }, [currentIndex]);

  const playNext = useCallback(() => {
    const currentQueue = fullLibraryRef.current.length > 0 ? fullLibraryRef.current : queue;
    if (currentQueue.length === 0) return;

    let nextIndex = currentIndex + 1;

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
      const expectedSrc = resolveAudioSource(getTrackSource(nextTrack));
      if (nextAudio && nextAudio.src === expectedSrc) {
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
  }, [currentIndex, isShuffleEnabled, playTrack, queue]);

  const playPrev = useCallback(() => {
    const currentQueue = fullLibraryRef.current.length > 0 ? fullLibraryRef.current : queue;
    if (currentQueue.length === 0) return;

    let prevIndex = currentIndex - 1;

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
  }, [currentIndex, isShuffleEnabled, playTrack, queue]);

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
  }, [currentIndex, handleRateLimit, playNext, queue]);

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
  }, [currentTrack, playNext, playPrev, togglePlay]);

  // Sync lightweight sliding queue window when index changes
  useEffect(() => {
    const lib = fullLibraryRef.current;
    if (lib.length === 0) return;
    const start = Math.max(0, currentIndex);
    setQueue(lib.slice(start, start + 50));
  }, [currentIndex]);

  const seekTo = useCallback((percentage: number) => {
    const activeAudio = activePlayerRef.current === 'A' ? audioRefA.current : audioRefB.current;
    if (!activeAudio || !activeAudio.duration) return;

    const targetTime = (percentage / 100) * activeAudio.duration;
    activeAudio.currentTime = targetTime;
    setPlaybackProgress(percentage);
  }, []);

  const addToQueue = useCallback((track: Track) => {
    fullLibraryRef.current = [...fullLibraryRef.current, track];
    setQueue((prev) => [...prev, track]);
    if (currentIndex === -1) {
      setCurrentIndex(0);
    }
  }, [currentIndex]);

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
  }, [handleRateLimit]);

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
