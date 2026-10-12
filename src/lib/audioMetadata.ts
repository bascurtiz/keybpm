import parseAudioMetadata from 'parse-audio-metadata'

export interface AudioMetadata {
  artist?: string
  title?: string
  album?: string
  year?: number
  coverUrl?: string
  hasTags: boolean
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Extracts ID3 / Vorbis / FLAC / MP4 metadata (artist, title, cover art)
 * from an uploaded audio File. If no embedded metadata is present,
 * returns hasTags: false without fabricating artificial fields.
 */
export async function extractAudioMetadata(file: File): Promise<AudioMetadata> {
  let artist: string | undefined
  let title: string | undefined
  let album: string | undefined
  let year: number | undefined
  let coverUrl: string | undefined

  try {
    const meta = await parseAudioMetadata(file)
    if (meta.artist && String(meta.artist).trim()) {
      artist = String(meta.artist).trim()
    }
    if (meta.title && String(meta.title).trim()) {
      title = String(meta.title).trim()
    }
    if (meta.album && String(meta.album).trim()) {
      album = String(meta.album).trim()
    }
    if (meta.year && Number(meta.year)) {
      year = Number(meta.year)
    }

    if (meta.picture) {
      const pic = meta.picture
      let picBlob: Blob | undefined

      if (pic instanceof Blob) {
        picBlob = pic
      } else if (pic.data && pic.data instanceof Uint8Array) {
        picBlob = new Blob([pic.data], { type: pic.format || 'image/jpeg' })
      } else if (pic.data && ArrayBuffer.isView(pic.data)) {
        picBlob = new Blob([pic.data.buffer], { type: pic.format || 'image/jpeg' })
      }

      if (picBlob) {
        try {
          coverUrl = await blobToDataUrl(picBlob)
        } catch {
          coverUrl = URL.createObjectURL(picBlob)
        }
      }
    }
  } catch (err) {
    console.warn('Audio metadata parsing skipped or no tags in file:', err)
  }

  const hasTags = Boolean(artist || title || coverUrl)

  return {
    artist,
    title,
    album,
    year,
    coverUrl,
    hasTags,
  }
}
