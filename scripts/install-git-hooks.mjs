/**
 * Point this checkout at the repository's own hooks (`.githooks/`).
 *
 * The version chip's fourth segment is a per-commit counter, and `build-number` is
 * what carries it into shallow clones — see `src/lib/build-version.ts`. The counter
 * only stays in step if the pre-commit hook runs, so the hook has to be enabled in
 * every clone. Doing that from `prepare` means `npm install` is the whole setup, on
 * any machine, with no separate step to remember.
 *
 * Deliberately quiet and always successful: a build machine or a tarball with no git
 * must not fail `npm install` over a cosmetic version string, and an existing
 * `core.hooksPath` (husky, a global hooks directory) is left untouched rather than
 * silently replaced.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';

function git(args) {
  try {
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

const HOOKS_PATH = '.githooks';

if (git(['rev-parse', '--git-dir']) === null) process.exit(0);

const current = git(['config', '--local', '--get', 'core.hooksPath']);
if (current === HOOKS_PATH) process.exit(0);
if (current) {
  console.log(`[hooks] core.hooksPath is already "${current}" — leaving it alone.`);
  console.log('[hooks] The version counter needs .githooks/pre-commit; see src/lib/build-version.ts.');
  process.exit(0);
}

if (git(['config', '--local', 'core.hooksPath', HOOKS_PATH]) === null) {
  console.log(`[hooks] Could not set core.hooksPath to ${HOOKS_PATH}; version counter will not advance.`);
  process.exit(0);
}

// Unix only requires the executable bit, and a checkout made on Windows records none,
// so set it here rather than expecting the file to arrive executable.
try {
  chmodSync(resolve(HOOKS_PATH, 'pre-commit'), 0o755);
} catch {
  /* git still runs the hook on Windows without it */
}

console.log(`[hooks] core.hooksPath → ${HOOKS_PATH} (keeps the build number in step with commits)`);
