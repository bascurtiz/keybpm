import type { TrackKeyInfo } from './types'

export interface PendingDeckTrack {
  file?: File
  buffer?: AudioBuffer
  metadata?: {
    title?: string
    artist?: string
    genre?: string
    label?: string
    bpm?: number
    key?: string
    camelot?: string
    coverUrl?: string
  }
  keyInfo?: TrackKeyInfo
  bpm?: number
}

let pendingTrackDeckA: PendingDeckTrack | null = null

export function setPendingDeckTrackA(track: PendingDeckTrack) {
  pendingTrackDeckA = track
}

export function consumePendingDeckTrackA(): PendingDeckTrack | null {
  const t = pendingTrackDeckA
  pendingTrackDeckA = null
  return t
}
