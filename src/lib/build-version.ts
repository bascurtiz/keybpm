/**
 * The version string the app reports about itself.
 *
 * `package.json` carries the human semver (`1.0.1`); the fourth segment is a build counter that
 * advances once per commit, so the chip next to the "Mix it!" title always names the revision it
 * was built from. Bumping the number by hand is not part of the workflow.
 *
 * Two sources feed that counter, because no single one works everywhere:
 *
 *  - **git's commit count** (`git rev-list --count HEAD`) — exact on a full clone, and what a
 *    local `npm run dev` / `npm run build` reports. It reads **1** on a shallow clone, which is
 *    what every hosted builder hands you (Cloudflare Pages clones one commit; `actions/checkout`
 *    defaults to `fetch-depth: 1`). That is why the deployed chip said `v1.0.1.1` while the very
 *    same tree built on a laptop said `v1.0.1.174`: there was only one commit in the clone to
 *    count.
 *  - **the committed `build-number` file** — rewritten by `.githooks/pre-commit` to the ordinal
 *    of the commit being created, so it travels with the commit. A shallow clone has no history
 *    to count, but it does have the file.
 *
 * A complete clone prefers git, so a stale or hand-edited counter can never make a local build
 * lie; a shallow clone has nothing better than the file.
 *
 * Kept branch-free and free of Node imports so the build config can use it and
 * `scripts/test-build-version.mjs` can exercise it directly.
 */
export interface BuildVersionInput {
  /** `version` from package.json, e.g. `1.0.1`. */
  packageVersion: string
  /** `git rev-list --count HEAD`, or null when git is unavailable or this is not a repo. */
  commitCount: number | null
  /** True when the checkout is shallow (count is not the project's real commit count). */
  shallow: boolean
  /** Contents of the committed `build-number` file, or null when it is missing/unreadable. */
  counter: number | null
}

/** A usable positive integer from an external source, or null. */
function usable(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value > 0
}

export function resolveBuildVersion({
  packageVersion,
  commitCount,
  shallow,
  counter,
}: BuildVersionInput): string {
  const build = !shallow && usable(commitCount) ? commitCount : usable(counter) ? counter : null
  return build === null ? packageVersion : `${packageVersion}.${build}`
}
