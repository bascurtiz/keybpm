/**
 * Theme preference — dark/light, applied as `data-theme` on <html>.
 * Default follows the prototype + AGENTS §26: no stored choice means
 * `prefers-color-scheme` decides (handled purely in CSS); storing a choice
 * pins it in either direction. index.html applies the stored value
 * pre-paint to avoid a flash.
 */

export type ThemeChoice = 'dark' | 'light'

const STORAGE_KEY = 'keydb-theme'

export function getStoredTheme(): ThemeChoice | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null
  }
}

/** Effective theme right now (stored choice, else system). */
export function getEffectiveTheme(): ThemeChoice {
  const stored = getStoredTheme()
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.setAttribute('data-theme', choice)
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    /* private mode — session-only theme is fine */
  }
}

/** Clear the stored choice → back to following the system. */
export function clearTheme(): void {
  document.documentElement.removeAttribute('data-theme')
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
