/**
 * Regression tests for `src/lib/browser.ts` — run with `npm test`.
 *
 * The rule that matters is not "does it say Safari" but "does it stay quiet where
 * the console is supposed to work". Every Chromium browser and Firefox carries
 * `Safari/` in its user agent, and every iOS browser is WebKit underneath, so a
 * naive test would warn most of the audience. These cases are the ones that have
 * bitten browser sniffers before: Chrome and Edge on macOS, the `CriOS`/`FxiOS`
 * iOS builds, and an in-app webview that cannot act on the advice anyway.
 */
import assert from 'node:assert/strict'
import { isSafari } from '../src/lib/browser.ts'

let suite = 0
function it(name, fn) {
  suite++
  try {
    fn()
    console.log(`ok ${suite} - ${name}`)
  } catch (err) {
    console.error(`not ok ${suite} - ${name}`)
    throw err
  }
}

const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/132.0.6834.78 Mobile/15E148 Safari/604.1'
const MAC_EDGE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0'
const MAC_FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0'
const IOS_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/134.0 Mobile/15E148 Safari/605.1.15'
const MAC_OPERA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 OPR/117.0.0.0'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'
const IN_APP_WEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1'

it('flags macOS Safari', () => {
  assert.equal(isSafari(MAC_SAFARI), true)
})

it('flags iOS Safari', () => {
  assert.equal(isSafari(IOS_SAFARI), true)
})

it('flags iPad Safari in its desktop-mode user agent', () => {
  assert.equal(isSafari(IPAD_DESKTOP_MODE), true)
})

it('leaves Chrome alone, on macOS and Windows', () => {
  assert.equal(isSafari(MAC_CHROME), false)
  assert.equal(isSafari(WINDOWS_CHROME), false)
})

it('leaves the iOS builds of Chrome and Firefox alone', () => {
  assert.equal(isSafari(IOS_CHROME), false)
  assert.equal(isSafari(IOS_FIREFOX), false)
})

it('leaves Edge and Opera alone', () => {
  assert.equal(isSafari(MAC_EDGE), false)
  assert.equal(isSafari(MAC_OPERA), false)
})

it('leaves desktop and Android Firefox/Chrome alone', () => {
  assert.equal(isSafari(MAC_FIREFOX), false)
  assert.equal(isSafari(ANDROID_CHROME), false)
})

it('stays quiet in an in-app webview, which has no Version token', () => {
  assert.equal(isSafari(IN_APP_WEBVIEW), false)
})

it('stays quiet on an empty or missing user agent', () => {
  assert.equal(isSafari(''), false)
  // No navigator in Node: the default argument must not throw.
  assert.equal(isSafari(), false)
})

console.log(`\n${suite} browser-detection cases passed`)
