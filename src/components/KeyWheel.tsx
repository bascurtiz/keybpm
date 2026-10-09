import { useCallback, useMemo, useState } from 'react'
import { camelotColor, camelotTint, camelotToOpenKey, getCompatibleKeys } from '@/lib/camelot'
import { CAMELOT_TO_KEY } from '@/types/track'
import { shortKey } from '@/lib/format'
import { CAMELOT_BLOCK, camelotBlockStyle } from '@/components/badges'
import { writeWheelMode, type WheelMode } from '@/lib/wheelMode'

export type { WheelMode }

type Ring = 'A' | 'B'

interface Node {
  code: string
  num: number
  ring: Ring
  /** x/y as percentages of the container (0–100). */
  x: number
  y: number
}

/** Camelot: 12 at top. Musical / Open Key: 8 (Am / C / 1m / 1d) at top. */
const TOP_NUM: Record<WheelMode, number> = { camelot: 12, musical: 8, openkey: 8 }

const MODE_LABELS: { id: WheelMode; label: string }[] = [
  { id: 'camelot', label: 'Camelot' },
  { id: 'musical', label: 'Musical' },
  { id: 'openkey', label: 'Open Key' },
]

/**
 * 24 nodes: A ring (minor, inner) and B ring (major, outer), as a radius in
 * percent of the container. The B ring is 15% wide, so its radius must stay
 * ≤ 42.5 for the nodes at 3/9 o'clock to fit inside the box — at 43 they poked
 * 0.5% outside, which showed up as a phantom horizontal scrollbar anywhere the
 * wheel sits in an overflow container (e.g. the mobile Scale Finder card).
 */
function buildNodes(topNum: number): Node[] {
  const nodes: Node[] = []
  for (const ring of ['A', 'B'] as Ring[]) {
    const r = ring === 'A' ? 30 : 42
    for (let n = 1; n <= 12; n++) {
      const steps = (n - topNum + 12) % 12
      const angle = (steps * 30 - 90) * (Math.PI / 180)
      nodes.push({
        code: `${n}${ring}`,
        num: n,
        ring,
        x: 50 + r * Math.cos(angle),
        y: 50 + r * Math.sin(angle),
      })
    }
  }
  return nodes
}

function nodeLabel(code: string, mode: WheelMode): string {
  if (mode === 'camelot') return code
  if (mode === 'openkey') return camelotToOpenKey(code) ?? code
  return shortKey(CAMELOT_TO_KEY[code] ?? code)
}

function ariaMode(mode: WheelMode): string {
  if (mode === 'camelot') return 'Camelot key wheel'
  if (mode === 'openkey') return 'Open Key wheel'
  return 'Musical key wheel'
}

/** Notation switcher — also renderable outside the wheel (e.g. in a card header). */
export function WheelModeSwitch({
  mode,
  onChange,
  compact = false,
}: {
  mode: WheelMode
  onChange: (mode: WheelMode) => void
  compact?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-center gap-1 rounded-lg border border-line bg-bg-card ${
        compact ? 'p-0.5' : 'p-1'
      }`}
      role="group"
      aria-label="Wheel notation"
    >
      {MODE_LABELS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`flex-1 rounded-md font-medium transition-colors ${
            compact ? 'whitespace-nowrap px-1.5 py-1 text-[11px]' : 'whitespace-nowrap px-2 py-1.5 text-xs'
          } ${mode === id ? 'bg-bg-hover text-text' : 'text-text-muted hover:text-text'}`}
          aria-pressed={mode === id}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * Circular key wheel with Camelot / musical / Open Key labels.
 * Camelot: 12A/12B on top. Musical & Open Key: Am/C (8A/8B = 1m/1d) on top.
 * Colors travel with each Camelot position.
 */
export function KeyWheel({
  selected,
  onSelect,
  mode,
  onModeChange,
  compact = false,
  hideModeSwitch = false,
  className,
}: {
  selected: string | null
  onSelect: (code: string) => void
  mode: WheelMode
  onModeChange: (mode: WheelMode) => void
  /** Smaller wheel for Key Tool so 1080p fits without vertical scroll. */
  compact?: boolean
  /** Render the notation switch elsewhere (card header) instead of above the wheel. */
  hideModeSwitch?: boolean
  className?: string
}) {
  const [hover, setHover] = useState<string | null>(null)

  const nodes = useMemo(() => buildNodes(TOP_NUM[mode]), [mode])

  const compatible = useMemo(
    () => new Set(selected ? getCompatibleKeys(selected) : []),
    [selected],
  )

  const focusCode = hover ?? selected
  const focusInfo = focusCode
    ? { code: focusCode, keyName: CAMELOT_TO_KEY[focusCode] ?? '' }
    : null

  const handleClick = useCallback((code: string) => onSelect(code), [onSelect])

  function setWheelMode(next: WheelMode) {
    writeWheelMode(next)
    onModeChange(next)
  }

  return (
    <div className={`mx-auto w-full ${compact ? 'max-w-[310px]' : 'max-w-[520px]'} ${className ?? ''}`.trim()}>
      {!hideModeSwitch && (
        <div className={compact ? 'mb-1.5' : 'mb-3'}>
          <WheelModeSwitch mode={mode} onChange={setWheelMode} compact={compact} />
        </div>
      )}

      <div
        className="relative aspect-square w-full"
        role="group"
        aria-label={ariaMode(mode)}
      >
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="30" fill="none" stroke="rgb(var(--line))" strokeWidth="0.3" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="rgb(var(--line))" strokeWidth="0.3" />
        </svg>

        <div className="pointer-events-none absolute left-1/2 top-1/2 w-[38%] -translate-x-1/2 -translate-y-1/2 text-center">
          {focusInfo ? (
            mode === 'camelot' ? (
              <>
                <div
                  className={`font-mono font-bold ${compact ? 'text-xl' : 'text-3xl'}`}
                  style={{ color: camelotColor(focusInfo.code) }}
                >
                  {focusInfo.code}
                </div>
                <div className={`text-text ${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-sm'}`}>{focusInfo.keyName}</div>
                {!compact && (
                  <div className="mt-0.5 text-xs text-text-muted">
                    {shortKey(focusInfo.keyName)} · {camelotToOpenKey(focusInfo.code)}
                  </div>
                )}
              </>
            ) : mode === 'openkey' ? (
              <>
                <div
                  className={`font-mono font-bold ${compact ? 'text-xl' : 'text-3xl'}`}
                  style={{ color: camelotColor(focusInfo.code) }}
                >
                  {camelotToOpenKey(focusInfo.code)}
                </div>
                <div className={`text-text ${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-sm'}`}>{focusInfo.keyName}</div>
                {!compact && (
                  <div className="mt-0.5 font-mono text-xs text-text-muted">
                    {focusInfo.code} · {shortKey(focusInfo.keyName)}
                  </div>
                )}
              </>
            ) : (
              <>
                <div
                  className={`font-mono font-bold ${compact ? 'text-xl' : 'text-3xl'}`}
                  style={{ color: camelotColor(focusInfo.code) }}
                >
                  {shortKey(focusInfo.keyName)}
                </div>
                <div className={`text-text ${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-sm'}`}>{focusInfo.keyName}</div>
                {!compact && (
                  <div className="mt-0.5 font-mono text-xs text-text-muted">
                    {focusInfo.code} · {camelotToOpenKey(focusInfo.code)}
                  </div>
                )}
              </>
            )
          ) : (
            <div className="text-xs text-text-muted">
              Select<br />a key
            </div>
          )}
        </div>

        {nodes.map(node => {
          const isSelected = node.code === selected
          const isCompatible = compatible.has(node.code)
          const color = camelotColor(node.code)
          const label = nodeLabel(node.code, mode)
          return (
            <button
              key={node.code}
              type="button"
              onClick={() => handleClick(node.code)}
              onMouseEnter={() => setHover(node.code)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(node.code)}
              onBlur={() => setHover(null)}
              aria-pressed={isSelected}
              aria-label={`${node.code}, ${CAMELOT_TO_KEY[node.code]}, ${camelotToOpenKey(node.code)}`}
              className={`absolute flex items-center justify-center rounded-full border font-mono font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                compact ? 'text-[9px]' : 'text-xs'
              } ${node.ring === 'A' ? 'h-[13%] w-[13%]' : 'h-[15%] w-[15%]'}`}
              style={{
                left: `${node.x}%`,
                top: `${node.y}%`,
                transform: 'translate(-50%, -50%)',
                color: isSelected ? 'rgb(var(--bg))' : color,
                backgroundColor: isSelected ? color : camelotTint(node.code, 0.08),
                borderColor: isSelected || isCompatible ? color : camelotTint(node.code, 0.27),
                borderWidth: isSelected ? 2 : isCompatible ? 1.5 : 1,
                opacity: selected && !isSelected && !isCompatible ? 0.55 : 1,
                zIndex: isSelected ? 2 : 1,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {!compact && (
        <div className="mt-4 space-y-2 text-center">
          <div className="flex items-center justify-center gap-4 text-2xs text-text-dim">
            {mode === 'openkey' ? (
              <>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full border border-text-muted" /> m = minor</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border border-text-muted" /> d = major</span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full border border-text-muted" /> A = minor</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border border-text-muted" /> B = major</span>
              </>
            )}
          </div>
          {selected && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-text-muted">Compatible:</span>
              {getCompatibleKeys(selected)
                .filter(c => c !== selected)
                .map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onSelect(c)}
                    className={`${CAMELOT_BLOCK} transition-opacity hover:opacity-80`}
                    style={camelotBlockStyle(c)}
                    title={`${c} · ${CAMELOT_TO_KEY[c]} · ${camelotToOpenKey(c)}`}
                  >
                    {nodeLabel(c, mode)}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
