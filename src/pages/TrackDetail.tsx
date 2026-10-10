import { useMemo, useState } from 'react'
import { usePageMeta } from '@/lib/meta'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getTrack, tracks, useCatalog } from '@/lib/data'
import { getCompatibleKeys, keyRelation, camelotColor } from '@/lib/camelot'
import { findMixes, DEFAULT_MIX_OPTIONS } from '@/lib/mix'
import { CAMELOT_TO_KEY } from '@/types/track'
import { BpmBadge, CamelotBadge, KeyBadge } from '@/components/badges'
import { ArtTile } from '@/components/ArtTile'
import { EmptyState } from '@/components/EmptyState'
import { CopyIcon, PencilIcon, SearchIcon, SoundcloudIcon, YoutubeIcon } from '@/components/icons'
import { formatBpm, formatConfidence, formatDate, formatDelta, formatDuration, shortKey, trackName } from '@/lib/format'

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }).catch(() => {})
      }}
      className="btn-ghost px-3 py-1.5 text-xs"
    >
      {copied ? '✓ Copied' : <><CopyIcon /> Copy {label}</>}
    </button>
  )
}

function DataRow({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-2 last:border-0">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-right text-sm">
        {value}
        {extra && <span className="ml-2 text-xs text-text-muted">{extra}</span>}
      </span>
    </div>
  )
}

/** Section heading — prototype's sentence-case h2 with optional right link. */
function H2({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-baseline justify-between text-lg font-semibold">
      {children}
      {right}
    </h2>
  )
}

/** The relation of `code` to the track's own key, as a human label. */
function relationLabel(source: string, code: string): string {
  const rel = keyRelation(source, code)
  if (rel === 'same') return 'same key'
  if (rel === 'relative') return 'relative'
  const sameRing = source.endsWith(code.slice(-1))
  if (rel === 'adjacent' && sameRing) {
    const a = parseInt(source, 10)
    const b = parseInt(code, 10)
    const diff = ((b - a + 12) % 12)
    return diff === 1 ? '+1' : '-1'
  }
  return 'compatible'
}

export function TrackDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  // Re-render when the catalog changes — notably when the approved-queue
  // overlay lands after this page already rendered with the pre-overlay track.
  useCatalog()
  const track = getTrack(id)

  usePageMeta(
    track
      ? [trackName(track), track.bpm !== null && `${formatBpm(track.bpm)} BPM`, track.key, track.camelot]
          .filter(Boolean).join(' | ')
      : 'Track not found — KeyBPM',
    track
      ? `${trackName(track)}: ${track.bpm !== null ? `${formatBpm(track.bpm)} BPM` : 'BPM unknown'}, ` +
        `${track.key ? `${track.key}${track.mode ? ` (${track.mode})` : ''} — Camelot ${track.camelot}` : 'no single key'}` +
        `${track.genre ? `, ${track.genre}` : ''}${track.label ? ` on ${track.label}` : ''}. Compatible keys and mixable tracks on KeyBPM.`
      : undefined,
  )

  const mixes = useMemo(() => {
    if (!track) return []
    return findMixes(track, tracks, DEFAULT_MIX_OPTIONS).slice(0, 8)
  }, [track])

  if (!track) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="Track not found"
          hint={<>No track with id <code className="font-mono">{id}</code> exists in the dataset.</>}
          action={<Link to="/browse" className="btn-primary">Back to Browse</Link>}
        />
      </div>
    )
  }

  const compatible = track.camelot ? getCompatibleKeys(track.camelot) : []
  const releaseRows = [
    ['Release', track.release],
    ['Label', track.label],
    ['Year', track.year !== null ? String(track.year) : null],
    ['Genre', track.genre],
    ['Duration', track.duration !== null ? formatDuration(track.duration) : null],
  ].filter((r): r is [string, string] => r[1] !== null)

  return (
    <article className="mx-auto max-w-4xl px-4 py-5 sm:py-6 lg:px-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-5 text-sm text-text-muted transition-colors hover:text-text sm:mb-6"
      >
        ← Back
      </button>

      {/* Title block — prototype: art tile + artist – title + tags */}
      <header className="flex flex-wrap items-center gap-4 sm:flex-nowrap sm:gap-5">
        <ArtTile track={track} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-xl font-semibold leading-tight sm:text-[22px]">{trackName(track)}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            {track.genre && <span className="tag">{track.genre}</span>}
            {track.label && <span className="tag">{track.label}</span>}
            {track.year !== null && <span className="tag">{track.year}</span>}
            {track.tags?.map(t => <span key={t} className="tag">{t}</span>)}
          </div>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-4 sm:mt-5">
        <span className="text-[22px] font-semibold leading-none sm:text-[26px]">
          <BpmBadge bpm={track.bpm} />
          <span className="ml-1.5 text-sm font-normal text-text-muted">BPM</span>
        </span>
        <span className="text-xl">
          <KeyBadge keyName={track.key} mode={track.mode} />
        </span>
        <CamelotBadge code={track.camelot} approximate={!!track.mode} className="px-2.5 py-1 text-sm" />
        {track.bpmRaw && (
          <span className="font-mono text-xs text-text-muted" title="BPM exactly as listed by the source">
            listed as {track.bpmRaw}
          </span>
        )}
      </div>
      {track.mode && track.camelot && (
        <p className="mt-2 text-xs text-text-dim">
          {track.mode[0].toUpperCase() + track.mode.slice(1)} track — {track.camelot} is the closest Camelot position, so harmonic matches are approximate.
        </p>
      )}

      {/* Actions */}
      <div className="mt-5 flex flex-wrap gap-2">
        {track.camelot && (
          <button type="button" className="btn-primary" onClick={() => navigate(`/mix?track=${track.id}`)}>
            <SearchIcon /> Find Mixes
          </button>
        )}
        {track.bpm !== null && <CopyButton value={String(track.bpm)} label="BPM" />}
        {track.key && <CopyButton value={track.key} label="Key" />}
        {track.camelot && <CopyButton value={track.camelot} label="Camelot" />}
        {track.youtube && (
          <a
            href={track.youtube}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            <YoutubeIcon className="text-[#FF0033]" /> YouTube
          </a>
        )}
        {track.soundcloud && (
          <a
            href={track.soundcloud}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            <SoundcloudIcon className="text-[#FF4100]" /> SoundCloud
          </a>
        )}
        <Link to={`/contribute?correct=${track.id}`} className="btn-ghost px-3 py-1.5 text-xs">
          <PencilIcon className="text-[#10B981]" /> Suggest correction
        </Link>
      </div>

      <div className={`mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 sm:mt-8 sm:gap-6 ${releaseRows.length ? 'md:grid-cols-2' : ''}`}>
        {releaseRows.length > 0 && (
          <section className="surface p-4">
            <H2>Release</H2>
            <div className="mt-1">
              {releaseRows.map(([label, value]) => <DataRow key={label} label={label} value={value} />)}
            </div>
          </section>
        )}

        {/* Provenance. The pill states what is actually known about the row: a
            reviewer approved it, or it came in through the queue — a plain
            imported row claims neither. */}
        <section className="surface p-4">
          <H2
            right={
              track.verifiedAt ? (
                <span className="pill-ok">Verified</span>
              ) : track.submittedBy ? (
                <span className="pill-neutral">Community</span>
              ) : undefined
            }
          >
            Data
          </H2>
          <DataRow
            label="BPM"
            value={formatBpm(track.bpm)}
            extra={[track.bpmRaw && `listed ${track.bpmRaw}`, track.bpmSource && `source: ${track.bpmSource}`].filter(Boolean).join(' · ') || undefined}
          />
          <DataRow
            label="Key"
            value={track.key ?? 'No single key'}
            extra={[track.keyRaw && `listed ${track.keyRaw}`, track.keySource && `source: ${track.keySource}`].filter(Boolean).join(' · ') || undefined}
          />
          {track.mode && <DataRow label="Mode" value={track.mode} />}
          {track.tuning !== undefined && (
            <DataRow label="Tuning" value={`${track.tuning > 0 ? '+' : ''}${track.tuning}¢`} extra={track.tuning > 0 ? 'sharp' : 'flat'} />
          )}
          {/* Community rows are attributed to the Discord member who submitted
              them (stamped by the API from their session); the sheet's own
              rows keep their source. A later correction is recorded as an
              editor, never as a new contributor. */}
          <DataRow
            label="Source"
            value={track.submittedBy ?? track.source}
            extra={
              !track.submittedBy && track.lastVerified
                ? `as of ${formatDate(track.lastVerified)}`
                : undefined
            }
          />
          {track.lastEditedBy && <DataRow label="Edited by" value={track.lastEditedBy} />}
          {track.confidence !== null && <DataRow label="Confidence" value={formatConfidence(track.confidence)} />}
          {/* Only a review counts as verification (see README); an unreviewed
              row shows no date rather than the source's snapshot date. */}
          {track.verifiedAt && (
            <DataRow
              label="Verified"
              value={formatDate(track.verifiedAt)}
              extra={track.verifiedBy ? `by ${track.verifiedBy}` : undefined}
            />
          )}
          {track.notes && <DataRow label="Note" value={track.notes} />}
        </section>
      </div>

      {track.camelot && <>
      {/* Compatible keys */}
      <section className="mt-8">
        <H2>Compatible keys</H2>
        <div className="flex flex-wrap gap-2">
          {compatible.map(code => {
            const isSelf = code === track.camelot
            const inner = (
              <>
                <CamelotBadge code={code} />
                <span className="font-mono text-xs text-text">{shortKey(CAMELOT_TO_KEY[code] ?? '')}</span>
                <span className="text-xs text-text-dim">
                  {isSelf ? 'this key' : relationLabel(track.camelot!, code)}
                </span>
              </>
            )
            const chip = 'inline-flex items-center gap-2 rounded-lg border bg-bg-card py-1 pl-1 pr-3'
            return isSelf ? (
              <span key={code} className={chip} style={{ borderColor: camelotColor(code) }}>
                {inner}
              </span>
            ) : (
              <Link
                key={code}
                to={`/browse?camelot=${code}`}
                className={`${chip} border-line transition-colors hover:border-line-hover hover:bg-bg-hover`}
              >
                {inner}
              </Link>
            )
          })}
        </div>
      </section>

      {/* Mixable tracks */}
      <section className="mt-8">
        <H2
          right={
            <Link to={`/mix?track=${track.id}`} className="text-xs font-normal text-text-muted hover:text-text">
              Open in Mix Finder →
            </Link>
          }
        >
          Mixable with this track
        </H2>

        {mixes.length === 0 ? (
          <EmptyState title="No compatible tracks" hint="Nothing in the dataset matches within the default ±4 BPM window." />
        ) : (
          <>
          <div className="surface hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-bg-subtle text-xs font-medium text-text-muted">
                  <th scope="col" className="px-3 py-2 text-left">Track</th>
                  <th scope="col" className="px-3 py-2 text-right">BPM</th>
                  <th scope="col" className="px-3 py-2 text-right">Key</th>
                  <th scope="col" className="px-3 py-2 text-right">Cam</th>
                  <th scope="col" className="px-3 py-2 text-right">Δ BPM</th>
                </tr>
              </thead>
              <tbody>
                {mixes.map(m => (
                  <tr
                    key={m.track.id}
                    onClick={() => navigate(`/track/${m.track.id}`)}
                    className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-bg-hover"
                  >
                    <td className="max-w-[280px] truncate px-3 py-2">
                      <span className="font-medium">{m.track.artist}</span>
                      <span className="ml-2 text-text-muted">{m.track.title}</span>
                    </td>
                    <td className="px-3 py-2 text-right"><BpmBadge bpm={m.track.bpm} raw={m.track.bpmRaw} className="text-text-muted" /></td>
                    <td className="px-3 py-2 text-right"><KeyBadge keyName={m.track.key} mode={m.track.mode} short className="font-medium text-text" /></td>
                    <td className="px-3 py-2 text-right"><CamelotBadge code={m.track.camelot} approximate={!!m.track.mode} /></td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      <span className={m.deltaBpm !== null && Math.abs(m.deltaBpm) <= 1 ? 'text-ok' : 'text-text-muted'}>
                        {formatDelta(m.deltaBpm)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: compact list — a 540px-wide table would just be a scrollbar (§22). */}
          <ul className="surface divide-y divide-line overflow-hidden md:hidden">
            {mixes.map(m => {
              const tight = m.deltaBpm !== null && Math.abs(m.deltaBpm) <= 1
              return (
                <li key={m.track.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/track/${m.track.id}`)}
                    className="block w-full px-4 py-3 text-left transition-colors hover:bg-bg-hover"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{m.track.artist}</span>
                      <span className={`shrink-0 font-mono text-xs tabular-nums ${tight ? 'text-ok' : 'text-text-dim'}`}>
                        Δ {formatDelta(m.deltaBpm)}
                      </span>
                    </div>
                    <div className="truncate text-sm text-text-muted">{m.track.title || '—'}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-dim">
                      <BpmBadge bpm={m.track.bpm} raw={m.track.bpmRaw} className="text-text-muted" />
                      <KeyBadge keyName={m.track.key} mode={m.track.mode} short className="font-medium text-text" />
                      <CamelotBadge code={m.track.camelot} approximate={!!m.track.mode} />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
          </>
        )}
      </section>
      </>}
    </article>
  )
}
