/// <reference types="vite/client" />

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
