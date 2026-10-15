import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'

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
// Only tracked-file changes count as dirty. Untracked noise (dist/, build
// artifacts) must not flag every single build as modified.
const gitDirty = (git('status --porcelain --untracked-files=no') ?? '') !== ''

/**
 * Auto-derived version: package.json base + commit count + short SHA, so the
 * number advances on its own with every commit instead of needing a manual
 * bump. Falls back to the bare package version when git isn't available.
 */
const buildMeta = [gitCommits, gitSha].filter(Boolean).join('.')
const version = buildMeta
  ? `${pkg.version}+${buildMeta}${gitDirty ? '.dirty' : ''}`
  : pkg.version

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