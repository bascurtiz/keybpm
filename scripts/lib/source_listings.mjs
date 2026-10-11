/**
 * How a published source listing is reconciled with the dataset's own chips.
 *
 * A source that publishes its key listing in-app (`data/source-keys/<id>.json`,
 * built by import_source_keys.mjs) has every chip deep-link to it:
 * `/source/<id>#<track-id>`, with the page highlighting that row. So the two
 * must agree, and they come from different places:
 *
 *   · The rows are built from the source's CSV and the consensus export's
 *     `Consensus_Sources` column.
 *   · The chips are what `data/tracks.json` records per track — which includes
 *     reports the export's column never named (the evidence layer records what
 *     each listing actually states), and states the key the chip's tooltip
 *     shows, where the export's `key_<source>` column is the first record the
 *     engine's fuzzy cluster matched — possibly another song, or another
 *     section of the same one (see rebuild_consensus_sources.mjs).
 *
 * The two bugs this guards, both live on the CamelotSound page: 148 chips
 * pointed at rows the export-only selection never built, so the click landed on
 * a page with nothing highlighted; and 43 chips whose row existed stated a
 * different key than the chip claimed, so the page contradicted the link that
 * opened it. A chip that opens nothing is the same dead end as a row nobody can
 * open, which is why every chip is anchored.
 */

/**
 * Anchors `chips` (dataset id → the row that chip must find) in `byTrack`
 * (dataset id → `[artist, title, camelot, id]`), in place.
 *
 * A chip whose track has no row gets one; a row that states another key is
 * re-keyed, since the chip is what the app showed the reader. Rows already
 * agreeing are left untouched, so the export's spelling (and any other
 * evidence the CSV carried) survives.
 *
 * @param {Map<string, [string, string, string, string]>} byTrack rows keyed by dataset id
 * @param {Map<string, { artist: string, title: string, camelot: string }>} chips
 * @returns {{ added: number, reKeyed: number }}
 */
export function anchorChips(byTrack, chips) {
  let added = 0
  let reKeyed = 0
  for (const [id, chip] of chips) {
    const existing = byTrack.get(id)
    if (!existing) {
      byTrack.set(id, [chip.artist, chip.title, chip.camelot, id])
      added++
      continue
    }
    if (existing[2] !== chip.camelot) {
      existing[2] = chip.camelot
      reKeyed++
    }
  }
  return { added, reKeyed }
}
