import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { stats, bpmBounds, yearBounds, allCamelots } from '@/lib/data'
import { formatCount } from '@/lib/format'

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-10 text-lg font-semibold">{children}</h2>
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-6 text-sm font-semibold text-text">{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-text-muted">{children}</p>
}

/** One sheet annotation: code + meaning. */
function Anno({ code, children }: { code: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm text-text-muted">
      <code className="w-24 shrink-0 font-mono text-xs text-text">{code}</code>
      <span>{children}</span>
    </li>
  )
}

export function About() {
  useEffect(() => {
    document.title = 'About — KeyBPM'
  }, [])

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8">
      {/* Same heading scale as every other page h1 (text-lg font-semibold). */}
      <h1 className="text-lg font-semibold">
        About Key<span className="text-accent">BPM</span>
      </h1>
      <p className="mt-2 text-text-muted">
        An open, portable music Key &amp; BPM database built for DJs, producers and music researchers —
        a dedicated web app inspired by the{' '}
        <a
          href="https://docs.google.com/document/d/1WcHNaTo6KHNG88yUWxrCULuwHPuQCGQ8UtItgzzK50Q/edit?tab=t.0"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-accent-hover"
        >
          duuzu&#39;s key &amp; bpm database spreadsheet
        </a>.
      </p>

      <H2>What it does</H2>
      <ul className="list-disc space-y-1 pl-5 text-sm text-text-muted">
        <li>Search with music-aware queries: <code className="font-mono text-text">128 11A</code>, <code className="font-mono text-text">F#m 125-130</code>, <code className="font-mono text-text">daft punk 8A</code>, <code className="font-mono text-text">dorian 120-130</code></li>
        <li>Filter by BPM range, key, Camelot, genre, label and year — all reflected in the URL</li>
        <li>Explore harmonic relationships on the <Link to="/key" className="text-accent hover:text-accent-hover">Key Wheel</Link></li>
        <li>Find compatible tracks with explainable reasons in the <Link to="/mix" className="text-accent hover:text-accent-hover">Mix Finder</Link></li>
        <li>Export any filtered view to CSV or JSON</li>
      </ul>

      <H2>Contributing</H2>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-text-muted">
        <li>
          <strong className="text-text">Sign in with Discord</strong> (header), then open{' '}
          <Link to="/contribute" className="text-accent hover:text-accent-hover">Contribute</Link> or{' '}
          <span className="text-text">Suggest correction</span> on a track.
        </li>
        <li>
          Submissions go to a review queue. Trusted/mod users review them on{' '}
          <Link to="/review" className="text-accent hover:text-accent-hover">Review</Link>. Approve makes a track
          searchable; maintainers run{' '}
          <code className="font-mono text-xs text-text">npm run data:apply-queue</code> to write it into{' '}
          <code className="font-mono text-xs text-text">data/tracks.json</code> for deploy — see README.
        </li>
      </ol>

      <H2>How to read the data</H2>
      <p className="text-sm text-text-muted">
        The {formatCount(stats.tracks)} tracks come from <strong className="text-text">duuzu&apos;s song key &amp; bpm &lsquo;database&rsquo;</strong>{' '}
        (version 10, last updated 15 June 2025) — keys and tempos worked out by ear. All credit for the data goes to
        duuzu. The notes below are duuzu&apos;s original guide from the sheet, lightly formatted for the web.
      </p>

      <div className="surface mt-4 space-y-1 p-5">
        <P>
          Tracks are listed under each key. The key a track is listed under refers to the key of the track.
          Within the keys, tracks are organised alphabetically by artist, and chronologically within each artist.
        </P>

        <H3>Key order</H3>
        <P>The order the keys are listed in is as follows:</P>
        <p className="mt-2 font-mono text-xs leading-relaxed text-text">
          Amin, Cmaj, A#min, C#maj, Bmin, Dmaj, Cmin, Ebmaj, C#min, Emaj, Dmin, Fmaj, D#min, F#maj, Emin, Gmaj, Fmin, Abmaj, F#min, Amaj, Gmin, Bbmaj, G#min, Bmaj, other
        </p>

        <H3>BPM</H3>
        <P>
          BPMs are listed at the end of every entry in brackets, eg. <code className="font-mono text-xs text-text">(120)</code>.
          Most BPMs are only approximate. BPMs that start with <code className="font-mono text-xs text-text">~</code> are
          definitely approximate and will vary throughout the track, due to being performed live.
        </P>
        <P>
          Faster or slower BPMs will also have multiples of the BPM listed, to account for differing interpretations of
          the BPM. For example, a track at a BPM of 80 could also be considered to be at a BPM of 160, so the BPM will
          be listed as <code className="font-mono text-xs text-text">(80/160)</code>.
        </P>

        <H3>Modes &amp; annotations</H3>
        <P>
          If a track is not simply in a major or minor key, further information will be provided in brackets.
        </P>
        <ul className="mt-3 space-y-2">
          <Anno code="(Xmaj)">means major</Anno>
          <Anno code="(Xdr)">means dorian mode</Anno>
          <Anno code="(Xphr)">means phrygian mode</Anno>
          <Anno code="(Xphrdom)">means dominant phrygian mode (phrygian mode but with a raised third)</Anno>
          <Anno code="(Xlyd)">means lydian mode</Anno>
          <Anno code="(Xmx)">means mixolydian mode</Anno>
          <Anno code="(Xmin)">means minor</Anno>
          <Anno code="(Xharm)">means harmonic/dominant minor</Anno>
          <Anno code="(Xmpic)">
            means the track uses picardy third (a raised &lsquo;major&rsquo; third in an otherwise minor track).
            Traditionally this term only applies to the final chord of a passage, but I have not found any terminology
            that refers to this technique being applied throughout a whole song so I&apos;m appropriating
            &ldquo;picardy third&rdquo; for this new definition
          </Anno>
          <Anno code="(Xloc)">means locrian mode</Anno>
          <Anno code="(Xblues)">
            means the track is based on the blues. (Blues theory uses lots of major chords with minor melodies, and
            doesn&apos;t properly fit into any regular key. Often similar to mpic, mx or dr. Can work as major or minor
            depending on context. Further music theory knowledge will help you!)
          </Anno>
        </ul>

        <ul className="mt-4 space-y-2">
          <Anno code="(aca)">means the track is acapella</Anno>
          <Anno code="(inst)">means the track is instrumental</Anno>
          <Anno code="(perc)">
            means the track&apos;s instrumental is almost entirely percussive and has few or no pitched instruments
          </Anno>
        </ul>

        <P>
          maj, lyd &amp; mx are listed under major keys. dr, phr, phrdom, min, harm, mpic &amp; loc are listed under
          minor keys. Blues will be listed under either major or minor, varying from track to track depending on many
          factors, such as the melody.
        </P>

        <H3>Tuning</H3>
        <P>
          Many tracks are detuned from the standard pitch of 440Hz. If a track is detuned, the amount of cents that it
          is detuned by will be listed in brackets. This tuning value is rounded to the nearest 5 cents, as a
          difference of less than 5 is almost imperceptible.
        </P>
        <P>
          For example, <code className="font-mono text-xs text-text">(-20)</code> means the track is 20 cents flat. To
          get it in tune with standard tuning, it will need to be pitched up 20 cents. (In music, a cent is a 100th of
          a semitone.)
        </P>

        <H3>Example</H3>
        <P>To conclude, if a track is listed as the following:</P>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-bg px-3 py-2 font-mono text-xs text-text">
          {'• Artist - Track (Aphr+30) (~75/150)'}
        </pre>
        <P>
          then the track is in A phrygian, is 30 cents sharp, and has a BPM of around 75 or 150, depending on how you
          count the BPM.
        </P>
        <P>
          Other important information, such as time signatures/rhythms, chord progressions, or notable lyrics, may also
          be listed in brackets.
        </P>
        <P>
          If you have any questions, reach out to me (duuzu)!
        </P>
      </div>

      <p className="mt-4 text-sm text-text-muted">
        In KeyBPM, those annotations become fields like <code className="font-mono text-xs text-text">mode</code>,{' '}
        <code className="font-mono text-xs text-text">tuning</code>, <code className="font-mono text-xs text-text">bpmRaw</code>,{' '}
        <code className="font-mono text-xs text-text">tags</code> and <code className="font-mono text-xs text-text">notes</code>.
        Camelot codes are derived from the listed key (closest position for modal tracks). About{' '}
        {formatCount(stats.tracks - stats.withBpm)} tracks have no BPM listed; tracks that change key throughout have
        no Camelot code.
      </p>

      <H2>Schema</H2>
      <pre className="surface overflow-x-auto p-4 font-mono text-xs leading-relaxed text-text-muted">{`{
  "id": "aesop-rock-costco",
  "artist": "Aesop Rock",
  "title": "Costco",
  "bpm": 80,
  "bpmRaw": "80/160",      // optional: tempo exactly as listed
  "key": "A minor",        // null when there's no single key
  "camelot": "8A",
  "mode": "phrygian",      // optional: beyond plain major/minor
  "keyRaw": "Aphr",        // optional: key annotation as listed
  "tuning": -20,           // optional: cents flat/sharp
  "tags": ["instrumental"],// optional: instrumental | acapella | percussive
  "notes": "some Dmin",    // optional
  "youtube": "https://www.youtube.com/watch?v=…", // optional: thumbnail + link
  "soundcloud": "https://soundcloud.com/…/…",    // optional: artwork thumbnail + link
  "genre": null, "label": null, "release": null, "year": null,
  "source": "duuzu's key & bpm database v10",
  "lastVerified": "2025-06-15"
}`}</pre>

      <H2>Camelot compatibility</H2>
      <p className="text-sm text-text-muted">
        Standard harmonic mixing rules, implemented once in <code className="font-mono text-xs">src/lib/camelot.ts</code>:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-muted">
        <li><strong>Same key</strong> — e.g. 11A → 11A</li>
        <li><strong>Adjacent</strong> — ±1 on the same ring: 10A / 12A</li>
        <li><strong>Relative</strong> — major/minor swap: 11A → 11B</li>
      </ul>

      <H2>Run it locally</H2>
      <pre className="surface overflow-x-auto p-4 font-mono text-xs leading-relaxed text-text-muted">{`npm install
npm run dev       # http://localhost:5173
npm run build     # static assets → dist/
npm run preview   # serve the production build

npm run data:import # re-import the sheet export → data/tracks.json + .csv
npm run data:csv    # re-export data/tracks.csv from the JSON`}</pre>
      <p className="mt-2 text-sm text-text-muted">
        No backend required — deploy <code className="font-mono text-xs">dist/</code> to Cloudflare Pages
        or GitHub Pages for free. See README.md for details.
      </p>

      <H2>Dataset</H2>
      <p className="text-sm text-text-muted">
        {formatCount(stats.tracks)} tracks · {formatCount(stats.artists)} artists ·
        {stats.labels > 0 && <> {formatCount(stats.labels)} labels ·</>}
        {' '}BPM {bpmBounds.min}–{bpmBounds.max}
        {yearBounds.min > 0 && <> · years {yearBounds.min}–{yearBounds.max}</>} ·
        {' '}{allCamelots.length} of 24 Camelot positions covered.
      </p>
      <p className="mt-2 text-sm text-text-muted">
        The data lives in <code className="font-mono text-xs">data/tracks.json</code> (canonical) and{' '}
        <code className="font-mono text-xs">data/tracks.csv</code> — both are plain, portable files you can
        diff in Git, feed to Python scripts, or consume from other tools.
      </p>
    </div>
  )
}
