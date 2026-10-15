/// <reference types="vite/client" />

/** Injected by Vite at build time — see `define` in vite.config.ts. */
declare const __APP_VERSION__: string
/** ISO 8601 build timestamp, injected at build time. */
declare const __BUILD_DATE__: string
/** Short git SHA of the built revision, or "unknown" outside a repo. */
declare const __GIT_SHA__: string
/** Branch the build was taken from, or "unknown". */
declare const __GIT_BRANCH__: string
/** True when tracked files had uncommitted changes at build time. */
declare const __GIT_DIRTY__: boolean

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'onnxruntime-web' {
  export * from 'onnxruntime-common'
}

declare module 'parse-audio-metadata' {
  export default function parseAudioMetadata(file: Blob | File): Promise<any>
}

interface Window {
  ort?: typeof import('onnxruntime-common')
}

declare module 'audio-decode' {
  export interface AudioData {
    channelData: Float32Array[]
    sampleRate: number
    duration?: number
    length?: number
  }
  export default function decode(buf: ArrayBuffer | Uint8Array | Blob | Response): Promise<AudioData>
}
