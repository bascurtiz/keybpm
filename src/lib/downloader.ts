/**
 * Where a user obtains an audio file from a YouTube link.
 *
 * One recommendation and a short fallback list, deliberately. The first version
 * of this pointed at exactly one site — cobalt.tools — and its main instance
 * then disabled YouTube downloads outright. Leading with one site is the right
 * interface; depending on only one is what broke.
 *
 * KeyBPM itself downloads nothing. It has no server and hands out no audio. The
 * user fetches the file and drops it into a deck, which is the same path a local
 * file takes — and therefore the only path that gets a beat grid, a keylock
 * stage and hot cues. YouTube's own IFrame cannot provide any of those: its
 * audio sits on another origin and cannot be tapped, which is a browser
 * boundary, not a missing feature.
 *
 * Every entry earns its place by handing back the ORIGINAL audio stream.
 * YouTube's ceiling is Opus at roughly 160 kbps, and a converter that re-encodes
 * to MP3 discards quality the user already had — KeyBPM then feeds that signal
 * to a tempo analyser that works to a few milliseconds. Offering Opus and M4A
 * passthrough is the whole reason AudioFetcher qualifies where most browser
 * converters do not; check for that before adding another one. Note also that
 * its lossless option is a trap: FLAC from a lossy source is a bigger file at
 * identical quality, not a better one.
 *
 * The fallbacks exist because the primary cannot be trusted to stay. AudioFetcher
 * is a closed site run by one developer on one domain, funded by donations — it
 * has no self-hosting escape and no fork, so it can vanish, and when it does the
 * tab must not become a dead end. OrpheusDL GUI is this project's own and cannot
 * be withdrawn unilaterally; yt-dlp is a project rather than a service and is
 * what the other two ultimately drive, so it keeps working when a front end does
 * not. Three entries failing in three different ways is the resilience, not the
 * redundancy.
 *
 * OrpheusDL GUI is this project's own sibling — the same author as KeyBPM. That
 * is stated in its note rather than left for the reader to discover, because a
 * recommendation list that quietly promotes its owner's other product costs a
 * project the credibility the rest of the list depends on. It also reaches
 * Beatport, Qobuz and Tidal, which is better provenance for a track whose key
 * and BPM the user is about to trust.
 */
export interface DownloaderOption {
  /** Label on the link. */
  name: string
  url: string
  /** One line on who it suits. */
  note: string
}

/** The single option the interface leads with: no install, one paste. */
export const DOWNLOADER_PRIMARY: DownloaderOption = {
  name: 'AudioFetcher',
  url: 'https://audiofetcher.com',
  note: 'Zero install — paste a link, keep the original Opus or M4A',
}

/**
 * Shown quietly beneath the primary, so a user who needs them can find them and
 * a user who does not is never asked to choose.
 */
export const DOWNLOADER_FALLBACKS: DownloaderOption[] = [
  {
    name: 'OrpheusDL GUI',
    url: 'https://github.com/bascurtiz/OrpheusDL-GUI',
    note: 'YouTube + Beatport + Qobuz + Tidal, lossless where available — needs setup (KeyBPM author)',
  },
  {
    name: 'yt-dlp',
    url: 'https://github.com/yt-dlp/yt-dlp',
    note: 'The command line engine the other two ultimately drive',
  },
]

/**
 * Copy text to the clipboard, reporting whether it worked.
 *
 * Never throws. The clipboard API rejects on a non-secure origin and when the
 * permission is denied, and neither is worth breaking a modal over — the caller
 * shows its own confirmation, and the link stays on screen to select by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
