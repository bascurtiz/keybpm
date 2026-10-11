import { Link } from 'react-router-dom'
import { SearchBar } from '@/components/SearchBar'
import { ActivityFeed } from '@/components/ActivityFeed'
import { CamelotBadge } from '@/components/badges'
import { stats, tracks, useCatalog } from '@/lib/data'
import { ALL_CAMELOT_CODES, CAMELOT_TO_KEY } from '@/types/track'
import { formatCount, shortKey } from '@/lib/format'
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
  // Re-render when the catalog changes (approved-queue overlay landing).
  useCatalog()
  usePageMeta('KeyBPM — Open Music Key & BPM Database', HOME_DESCRIPTION)

  // Track counts per Camelot position, in wheel order (1A 1B 2A 2B …) so
  // relative major/minor pairs sit side by side.
  // Hero numbers: coverage of the two fields a DJ looks up. `labels` only joins
  // them once the dataset actually has labels — an empty stat is noise.
  const heroStats = [
    { value: stats.tracks, label: 'tracks' },
    { value: stats.artists, label: 'artists' },
    { value: stats.withBpm, label: 'with BPM' },
    { value: stats.withKey, label: 'with key' },
    ...(stats.labels > 0 ? [{ value: stats.labels, label: 'labels' }] : []),
  ]

  const keyCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tracks) if (t.camelot) map.set(t.camelot, (map.get(t.camelot) ?? 0) + 1)
    return ALL_CAMELOT_CODES
      .map(code => ({ code, keyName: CAMELOT_TO_KEY[code], count: map.get(code) ?? 0 }))
      .sort((a, b) => parseInt(a.code, 10) - parseInt(b.code, 10) || a.code.localeCompare(b.code))
  }, [])

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-5 sm:py-8">
      {/* Hero card */}
      <div className="relative rounded-card border border-line bg-bg-card px-5 py-7 sm:px-7 sm:py-9 md:px-9 md:py-11">
        {/* Handwritten "Community powered" note (public/community-powered.svg),
            top-right of the card with the arrow gesturing down at the search
            bar. Desktop only; decorative. */}
        <div
          role="img"
          aria-label="Community powered"
          className="community-note pointer-events-none absolute right-9 top-11 hidden h-[216px] w-[192px] min-[1060px]:block"
        />
        <h1 className="text-[26px] font-bold leading-tight sm:text-3xl md:text-[40px]">
          The open music <b className="text-accent-hover">key &amp; BPM database.</b>
        </h1>
        <p className="mt-3 leading-relaxed text-text-muted">
          Real tracks. Real people. Real musical data.{' '}
          <br className="hidden sm:block" />
          Help build the most accurate, community-driven database for key, bpm and more.
        </p>

        <div className="mt-6 max-w-2xl">
          <SearchBar />
        </div>

        <div className="mt-6 flex flex-wrap gap-2.5 sm:gap-3">
          <Link to="/browse" className="btn-primary">Browse Tracks</Link>
          <Link to="/mix" className="btn-ghost">Mix Finder</Link>
          <Link to="/key" className="btn-ghost">Key Wheel</Link>
          <Link to="/tool" className="btn-ghost">Key Tool</Link>
        </div>

        <div
          className={`mt-7 grid grid-cols-2 gap-3 border-t border-line pt-5 sm:mt-8 sm:gap-4 sm:pt-6 ${
            heroStats.length > 4 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
          }`}
        >
          {heroStats.map(s => (
            <div key={s.label}>
              <div className="text-xl font-semibold leading-tight sm:text-[26px]">{formatCount(s.value)}</div>
              <div className="text-xs text-text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Browse by key */}
      <SectionHead title="Browse by key" to="/key" linkLabel="View all keys →" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6">
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

      {/* Community activity — what was added, corrected and verified lately.
          Replaces the old random "Discover" draw: real, dated events from the
          review queue, since the imported dataset has no per-row dates. */}
      <ActivityFeed />

      <p className="mt-10 text-xs text-text-dim">
        Key &amp; BPM data from duuzu&apos;s song key &amp; bpm database (v10) — see{' '}
        <Link to="/about" className="underline underline-offset-2 hover:text-text-muted">About</Link> for provenance.
      </p>
    </div>
  )
}
