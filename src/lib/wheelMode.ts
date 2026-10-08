/** Key Wheel / table notation preference. */
export type WheelMode = 'camelot' | 'musical' | 'openkey'

export const WHEEL_MODE_KEY = 'keybpm:wheel-mode'

export function readWheelMode(): WheelMode {
  try {
    const v = localStorage.getItem(WHEEL_MODE_KEY)
    if (v === 'camelot' || v === 'musical' || v === 'openkey') return v
  } catch {
    /* private mode */
  }
  return 'camelot'
}

export function writeWheelMode(mode: WheelMode): void {
  try {
    localStorage.setItem(WHEEL_MODE_KEY, mode)
  } catch {
    /* ignore */
  }
}
