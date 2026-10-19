import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBuildVersion } from '../src/lib/build-version.ts';

/**
 * Two things make the version chip trustworthy: the resolver has to ignore a shallow
 * clone's bogus count of 1, and the pre-commit hook has to keep the committed counter
 * moving. Both are exercised here — the second in a throwaway repo, because the file's
 * whole job is to travel inside a commit.
 */

let checks = 0;
function ok(cond, message) {
  checks++;
  assert.ok(cond, message);
}

const pkg = { packageVersion: '1.0.1' };

// --- resolver ------------------------------------------------------------------------------

ok(
  resolveBuildVersion({ ...pkg, commitCount: 174, shallow: false, counter: 170 }) === '1.0.1.174',
  'a full clone reports git’s commit count',
);
ok(
  resolveBuildVersion({ ...pkg, commitCount: 1, shallow: true, counter: 174 }) === '1.0.1.174',
  'a shallow clone ignores its count of 1 and reads the committed counter',
);
ok(
  resolveBuildVersion({ ...pkg, commitCount: 1, shallow: true, counter: null }) === '1.0.1',
  'a shallow clone with no counter falls back to the bare package version, not “.1”',
);
ok(
  resolveBuildVersion({ ...pkg, commitCount: null, shallow: false, counter: 9 }) === '1.0.1.9',
  'without git, the committed counter is used',
);
ok(
  resolveBuildVersion({ ...pkg, commitCount: null, shallow: false, counter: null }) === '1.0.1',
  'without git or a counter, the bare package version is used',
);
ok(
  resolveBuildVersion({ ...pkg, commitCount: 12, shallow: false, counter: 0 }) === '1.0.1.12',
  'a zero counter is treated as missing',
);

// --- pre-commit hook ------------------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), 'keybpm-build-number-'));
const git = (args) =>
  execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const read = () => readFileSync(join(dir, 'build-number'), 'utf-8').trim();

try {
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'KeyDB test']);
  git(['config', 'core.hooksPath', '.githooks']);
  mkdirSync(join(dir, '.githooks'));
  cpSync(new URL('../.githooks/pre-commit', import.meta.url), join(dir, '.githooks/pre-commit'));
  writeFileSync(join(dir, 'build-number'), '0\n');
  writeFileSync(join(dir, 'track.txt'), 'a\n');
  git(['add', 'build-number', 'track.txt']);
  git(['commit', '-q', '-m', 'first']);

  ok(read() === '1', 'the hook numbers the first commit 1');
  ok(git(['show', 'HEAD:build-number']) === '1', 'the first commit carries its own build number');

  // The second commit relies on `-a`: the hook has to stage the file it just wrote,
  // otherwise the number would land one commit late.
  writeFileSync(join(dir, 'track.txt'), 'b\n');
  git(['commit', '-q', '-am', 'second']);

  ok(read() === '2', 'the hook advances the counter on the next commit');
  ok(git(['show', 'HEAD:build-number']) === '2', '`git commit -a` still commits the bumped counter');

  // A merge-free fast-forward of the same content must not skip a number: the hook
  // derives the value from history, so it lands back on the same answer.
  git(['add', 'build-number']);
  git(['commit', '-q', '--allow-empty', '-m', 'third']);
  ok(read() === '3', 'an empty commit still advances the counter');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`test-build-version: ${checks} checks passed`);
