import assert from 'node:assert';
import { registerHooks } from 'node:module';

/** The module under test imports its sibling as `./audio-latency`, the way the bundler wants it. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        /* fall through to the plain resolution below */
      }
    }
    return nextResolve(specifier, context);
  },
});

/**
 * The console profile decides how much work the mix console hands a phone. It is read once and
 * cached, so each case below imports a fresh copy of the module to exercise the read again.
 */

let checks = 0;
function ok(cond, message) {
  checks++;
  assert.ok(cond, message);
}

const setStorage = (value) => {
  if (value === null) delete globalThis.localStorage;
  else globalThis.localStorage = { getItem: (key) => (key === 'keybpm:handheld' ? value : null) };
};

const setUserAgent = (ua) => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ua },
    configurable: true,
  });
};

const setMatchMedia = (matches) => {
  globalThis.window = { matchMedia: (query) => ({ matches: matches.includes(query) }) };
};

let revision = 0;
const loadProfile = async () => {
  revision++;
  const mod = await import(`../src/lib/dj/device-profile.ts?case=${revision}`);
  return mod.consoleProfile();
};

// ---------------------------------------------------------------------------
// A desktop keeps the rate it was tuned for
// ---------------------------------------------------------------------------
{
  setStorage(null);
  delete globalThis.window;
  setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36');
  const profile = await loadProfile();
  ok(profile.handheld === false, 'a desktop is not hand-held');
  ok(profile.positionReportHz === 60, 'a desktop gets 60 playhead reports a second');
  ok(profile.canvasStride === 1, 'a desktop redraws the lanes every frame');
}

// ---------------------------------------------------------------------------
// A phone gets the cheaper profile: half the reports, half the redraws
// ---------------------------------------------------------------------------
{
  setStorage(null);
  delete globalThis.window;
  setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148');
  const profile = await loadProfile();
  ok(profile.handheld === true, 'an iPhone user agent is hand-held');
  ok(profile.positionReportHz === 30, 'a phone gets 30 playhead reports a second');
  ok(profile.canvasStride === 2, 'a phone redraws the lanes every second frame');
}

// An iPad presents itself as a desktop Mac, so the touch-first pointer is the signal.
{
  setStorage(null);
  setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15');
  setMatchMedia(['(pointer: coarse)']);
  const profile = await loadProfile();
  ok(profile.handheld === true, 'a touch-first device with no hover is hand-held');
  delete globalThis.window;
}

// ---------------------------------------------------------------------------
// The override wins over the device, both ways
// ---------------------------------------------------------------------------
{
  setStorage('1');
  delete globalThis.window;
  setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36');
  const profile = await loadProfile();
  ok(profile.handheld === true, 'keybpm:handheld=1 puts the hand-held profile on a desktop');
  ok(profile.positionReportHz === 30, 'the override changes the report rate');
}

{
  setStorage('0');
  delete globalThis.window;
  setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148');
  const profile = await loadProfile();
  ok(profile.handheld === false, 'keybpm:handheld=0 gives a phone the desktop budget back');
  ok(profile.positionReportHz === 60, 'and the desktop report rate');
  ok(profile.canvasStride === 1, 'and the desktop redraw cadence');
}

// ---------------------------------------------------------------------------
// Anything else is not an override; the device decides
// ---------------------------------------------------------------------------
{
  setStorage('maybe');
  delete globalThis.window;
  setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148');
  const profile = await loadProfile();
  ok(profile.handheld === true, 'an unparseable override falls back to the device');
}

// Storage being unavailable (private mode, a locked-down webview) must not throw.
{
  globalThis.localStorage = {
    getItem() {
      throw new Error('denied');
    },
  };
  delete globalThis.window;
  setUserAgent('Mozilla/5.0 (Linux; Android 14) Mobile');
  const profile = await loadProfile();
  ok(profile.handheld === true, 'a throwing localStorage is treated as no override');
}

console.log(`device profile: ${checks} checks passed`);
