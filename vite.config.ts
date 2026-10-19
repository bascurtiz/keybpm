import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { resolveBuildVersion } from './src/lib/build-version'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

/**
 * Run a git command and return its trimmed stdout, or null when git is missing
 * or this isn't a repo (e.g. building from an exported tarball). Never throws —
 * a missing git binary must not break the build.
 */
function git(cmd: string): string | null {
  try {
    return execSync(`git ${cmd}`, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return null
  }
}

const gitCommits = git('rev-list --count HEAD')
const gitSha = git('rev-parse --short HEAD')
const gitBranch = git('rev-parse --abbrev-ref HEAD')
// A shallow clone still has a HEAD and a count — a count of 1. Hosted builders
// clone that way (Cloudflare Pages, `actions/checkout` at its default depth), so
// the count has to be treated as unknown there rather than as the real number.
const gitShallow = git('rev-parse --is-shallow-repository') === 'true'
// Only tracked-file changes count as dirty. Untracked noise (dist/, build
// artifacts) must not flag every single build as modified.
const gitDirty = (git('status --porcelain --untracked-files=no') ?? '') !== ''

/**
 * The committed per-commit counter, maintained by `.githooks/pre-commit`. It exists
 * for the shallow clones above, where git's count is 1 and the deployed chip would
 * otherwise read `v1.0.1.1` no matter how many commits the project had.
 */
function readBuildNumber(): number | null {
  try {
    const raw = readFileSync(resolve(__dirname, 'build-number'), 'utf-8').trim()
    return /^\d+$/.test(raw) ? Number(raw) : null
  } catch {
    return null
  }
}

/**
 * Auto-derived version: package.json's semver plus a counter that advances on
 * every commit, so the number moves on its own instead of needing a manual bump.
 * Kept to plain dotted digits — `1.0.1.175` — because the SHA, branch and dirty
 * flag are build provenance, not part of the version, and they made the chip
 * unreadable. They live in the tooltip instead. See `src/lib/build-version.ts`
 * for which counter wins and why.
 */
const version = resolveBuildVersion({
  packageVersion: pkg.version,
  commitCount: gitCommits === null ? null : Number(gitCommits),
  shallow: gitShallow,
  counter: readBuildNumber(),
})

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  define: {
    // Injected at build time — visible in the version chip next to the Mix It title
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __GIT_SHA__: JSON.stringify(gitSha ?? 'unknown'),
    __GIT_BRANCH__: JSON.stringify(gitBranch ?? 'unknown'),
    __GIT_DIRTY__: JSON.stringify(gitDirty),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true, // must match Discord redirect + APP_ORIGIN
    open: true,
    // Proxy API/auth to wrangler dev (default :8787) when VITE_API_BASE is unset.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/auth': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    outDir: 'dist',
    // The dataset chunk is large by design (~20k tracks); app code stays small.
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks: id => (id.includes('/data/tracks.json') ? 'tracks' : undefined),
      },
    },
  },
})