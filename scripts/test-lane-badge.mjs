import assert from 'node:assert';
import { laneBadge } from '../src/lib/dj/lane-badge.ts';

let checks = 0;
function ok(cond, message) {
  checks++;
  assert.ok(cond, message);
}
function near(actual, expected, tol, message) {
  checks++;
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${message} (expected ${expected} +/- ${tol}, got ${actual})`
  );
}

// ---------------------------------------------------------------------------
// The console at its design size keeps the badge it always had
// ---------------------------------------------------------------------------
{
  // 95 px canvas at 0.675 scale => 48 px lanes at scale 1 (measured at 844x390).
  const design = laneBadge(48);
  ok(design.box === 36, `a 48 px design lane keeps the 36 px badge (got ${design.box})`);
  near(design.font, 15, 0.01, 'and the 15 px letter inside it');
  near(design.radius, 3, 0.01, 'with the original 3 px corners');
  ok(design.stroke === 1.5, 'and the original hairline border');
}

// ---------------------------------------------------------------------------
// A phone's lanes are half that: the badge has to come down with them
// ---------------------------------------------------------------------------
{
  const phone = laneBadge(32); // the surface a landscape phone actually measures
  ok(phone.box < 32, `the badge stays inside a 32 px lane (got ${phone.box})`);
  near(phone.box, 24, 0.01, 'at three quarters of the lane height');
  near(phone.font, 10, 0.01, 'and the letter scales with it');
  ok(phone.font < phone.box, 'the letter still has padding inside the box');
  ok(phone.box / 2 <= 32 / 2 + 1e-9, 'and the box fits in the lane half it is centred in');
}

// ---------------------------------------------------------------------------
// Smaller still, and no size ever escapes its lane or vanishes
// ---------------------------------------------------------------------------
{
  for (const laneH of [4, 8, 16, 24, 30, 36, 40, 47, 48, 60, 96, 240]) {
    const b = laneBadge(laneH);
    ok(b.box > 0, `a ${laneH} px lane still has a badge`);
    ok(b.box <= laneH, `the badge never exceeds its ${laneH} px lane (got ${b.box})`);
    ok(b.font > 0 && b.font < b.box, `the letter fits its box at ${laneH} px`);
    ok(b.box <= 36 + 1e-9, `the badge never grows past the design 36 px at ${laneH} px`);
  }

  // Monotonic: a taller lane never gets a smaller badge.
  let prev = 0;
  for (let laneH = 1; laneH <= 120; laneH += 1) {
    const box = laneBadge(laneH).box;
    ok(box >= prev - 1e-9, `the badge does not shrink when the lane grows (${laneH} px)`);
    prev = box;
  }

  // Unmeasured lanes draw nothing rather than NaN geometry.
  for (const bad of [0, -10, NaN]) {
    ok(laneBadge(bad).box === 0, `an unmeasured lane (${bad}) has no badge`);
  }
}

console.log(`lane badge: ${checks} checks passed`);
