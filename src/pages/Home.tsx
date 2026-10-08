import { Link } from 'react-router-dom'
import { SearchBar } from '@/components/SearchBar'
import { ArtTile } from '@/components/ArtTile'
import { CamelotBadge } from '@/components/badges'
import { stats, tracks } from '@/lib/data'
import { ALL_CAMELOT_CODES, CAMELOT_TO_KEY } from '@/types/track'
import { formatBpm, formatCount, shortKey, trackName } from '@/lib/format'
import { usePageMeta } from '@/lib/meta'
import { useMemo } from 'react'

const HOME_DESCRIPTION =
  'Real tracks. Real people. Real musical data. Help build the most accurate, community-driven database for key, bpm and more.'

/** Prototype's `<h2>Title<a>View all →</a></h2>` section header. */
function SectionHead({ title, to, linkLabel }: { title: string; to: string; linkLabel: string }) {
  return (
    <h2 className="mb-3 mt-10 flex items-baseline justify-between text-lg font-semibold">
      {title}
      <Link to={to} className="text-xs font-normal text-accent hover:text-text">
        {linkLabel}
      </Link>
    </h2>
  )
}

export function Home() {
  usePageMeta('KeyBPM — Open Music Key & BPM Database', HOME_DESCRIPTION)

  // Track counts per Camelot position, in wheel order (1A 1B 2A 2B …) so
  // relative major/minor pairs sit side by side.
  const keyCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tracks) if (t.camelot) map.set(t.camelot, (map.get(t.camelot) ?? 0) + 1)
    return ALL_CAMELOT_CODES
      .map(code => ({ code, keyName: CAMELOT_TO_KEY[code], count: map.get(code) ?? 0 }))
      .sort((a, b) => parseInt(a.code, 10) - parseInt(b.code, 10) || a.code.localeCompare(b.code))
  }, [])

  // A fresh handful of fully-tagged tracks on every visit.
  const discover = useMemo(() => {
    const pool = tracks.filter(t => t.bpm !== null && t.camelot && t.title)
    const picks = new Set<number>()
    while (picks.size < Math.min(6, pool.length)) picks.add(Math.floor(Math.random() * pool.length))
    return [...picks].map(i => pool[i])
  }, [])

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-8">
      {/* Hero card */}
      <div className="relative rounded-card border border-line bg-bg-card px-7 py-9 md:px-9 md:py-11">
        {/* Handwritten "Community powered" note (public/community-powered.svg),
            top-right of the card with the arrow gesturing down at the search
            bar. Desktop only; decorative. */}
        <div
          role="img"
          aria-label="Community powered"
          className="community-note pointer-events-none absolute right-9 top-11 hidden h-[216px] w-[192px] min-[1060px]:block"
        />
        <h1 className="text-3xl font-bold leading-tight md:text-[40px]">
          The open music <b className="text-accent-hover">key &amp; BPM database.</b>
        </h1>
        <p className="mt-3 leading-relaxed text-text-muted">
          Real tracks. Real people. Real musical data.
          <br className="hidden sm:block" />
          Help build the most accurate, community-driven database for key, bpm and more.
        </p>

        <div className="mt-6 max-w-2xl">
          <SearchBar />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/browse" className="btn-primary">Browse Tracks</Link>
          <Link to="/mix" className="btn-ghost">Mix Finder</Link>
          <Link to="/key" className="btn-ghost">Key Wheel</Link>
          <Link to="/tool" className="btn-ghost">Key Tool</Link>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4 border-t border-line pt-6">
          <div>
            <div className="text-[26px] font-semibold leading-tight">{formatCount(stats.tracks)}</div>
            <div className="text-xs text-text-muted">tracks</div>
          </div>
          <div>
            <div className="text-[26px] font-semibold leading-tight">{formatCount(stats.artists)}</div>
            <div className="text-xs text-text-muted">artists</div>
          </div>
          {stats.labels > 0 ? (
            <div>
              <div className="text-[26px] font-semibold leading-tight">{formatCount(stats.labels)}</div>
              <div className="text-xs text-text-muted">labels</div>
            </div>
          ) : (
            <div>
              <div className="text-[26px] font-semibold leading-tight">{formatCount(stats.withBpm)}</div>
              <div className="text-xs text-text-muted">with BPM</div>
            </div>
          )}
        </div>
      </div>

      {/* Browse by key */}
      <SectionHead title="Browse by key" to="/key" linkLabel="View all keys →" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {keyCounts.map(({ code, keyName, count }) => (
          <Link
            key={code}
            to={`/key/${code}`}
            className="group flex items-start justify-between gap-2 rounded-[10px] border border-line bg-bg-card p-3 transition-colors hover:border-line-hover hover:bg-bg-hover"
          >
            <div className="min-w-0">
              <div className="truncate font-semibold">{keyName}</div>
              <div className="text-xs text-text-muted">
                {shortKey(keyName)} · {formatCount(count)} {count === 1 ? 'track' : 'tracks'}
              </div>
            </div>
            <CamelotBadge code={code} className="shrink-0" />
          </Link>
        ))}
      </div>

      {/* Discover */}
      <SectionHead title="Discover" to="/browse" linkLabel="View all →" />
      <div className="divide-y divide-line rounded-card border border-line bg-bg-card">
        {discover.map(t => (
          <div
            key={t.id}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-bg-hover"
          >
            <ArtTile track={t} />
            <Link to={`/track/${t.id}`} className="min-w-0 flex-1">
              <div className="truncate text-sm">{trackName(t)}</div>
              <div className="truncate text-xs text-text-muted">
                {t.key}{t.mode ? ` (${t.mode})` : ''} • {formatBpm(t.bpm)} BPM
              </div>
            </Link>
            <CamelotBadge code={t.camelot} approximate={!!t.mode} className="shrink-0" />
          </div>
        ))}
      </div>

      <p className="mt-10 text-xs text-text-dim">
        Key &amp; BPM data from duuzu&apos;s song key &amp; bpm database (v10) — see{' '}
        <Link to="/about" className="underline underline-offset-2 hover:text-text-muted">About</Link> for provenance.
      </p>
    </div>
  )
}
