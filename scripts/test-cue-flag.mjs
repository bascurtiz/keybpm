import assert from 'node:assert';
import { cueFlag } from '../src/lib/dj/cue-flag.ts';

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
// The design-size strip keeps the label it always had
// ---------------------------------------------------------------------------
{
  const design = cueFlag(22);
  near(design.font, 9, 0.01, 'a 22 px strip keeps the 9 px cue label');
  near(design.baseline, 8, 0.01, 'on its original baseline');
  near(design.stripe, 2, 0.01, 'with the original 2 px stripe');
}

// ---------------------------------------------------------------------------
// The phone strip is shorter: label and baseline come down with it
// ---------------------------------------------------------------------------
{
  // The surface a landscape phone measures for this canvas (h-6 at the 0.675 fit).
  const phone = cueFlag(15);
  ok(phone.font < 9, `the phone label is smaller than the design one (got ${phone.font})`);
  near(phone.font, 6.14, 0.01, 'at the same share of the strip as the design label');
  ok(phone.font < 15, 'the label stays inside the strip');
  ok(phone.baseline > 0 && phone.baseline + 0.5 < 15, 'the baseline stays inside the strip');
  ok(phone.baseline < 8, 'the label sits higher than it used to');
  ok(phone.stripe >= 1 && phone.stripe <= 2, 'the stripe thins but stays visible');
}

// ---------------------------------------------------------------------------
// Across every size: proportional, never grows past the design, never NaN
// ---------------------------------------------------------------------------
{
  for (const stripH of [1, 4, 11, 15, 18, 20, 22, 24, 40, 96]) {
    const f = cueFlag(stripH);
    ok(f.font > 0, `a ${stripH} px strip still has a label`);
    ok(f.font <= 9 + 1e-9, `the label never grows past the design 9 px (${stripH} px)`);
    ok(f.baseline >= 0 && f.baseline <= stripH, `the baseline is on the strip at ${stripH} px`);
    ok(f.stripe >= 1 && f.stripe <= 2 + 1e-9, `the stripe stays 1-2 px at ${stripH} px`);
  }

  // Monotonic: a taller strip never gets a smaller label.
  let prev = 0;
  for (let stripH = 1; stripH <= 100; stripH += 1) {
    const font = cueFlag(stripH).font;
    ok(font >= prev - 1e-9, `the label does not shrink when the strip grows (${stripH} px)`);
    prev = font;
  }

  // Unmeasured strips draw nothing rather than NaN geometry.
  for (const bad of [0, -10, NaN]) {
    const f = cueFlag(bad);
    ok(f.font === 0 && f.baseline === 0 && f.stripe === 0, `an unmeasured strip (${bad}) has no flag`);
  }
}

console.log(`cue flag: ${checks} checks passed`);
