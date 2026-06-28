import { createContext } from 'react';
import type { Track } from '../types';

export interface PlayerContextType {
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

export const PlayerContext = createContext<PlayerContextType | undefined>(undefined);
